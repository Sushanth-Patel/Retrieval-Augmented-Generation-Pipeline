"""Document Parser — converts PDF, Word, Excel, and plain-text files to a
single string suitable for the NaiveChunker pipeline.

Supported extensions:
    .pdf   — pdfplumber (text-layer PDFs; scanned/image PDFs return empty string)
    .docx  — python-docx (paragraph extraction)
    .xlsx  — openpyxl  (cell-by-cell, all sheets, row-per-line)
    .xls   — openpyxl (legacy Excel via compatibility mode)
    .md    — read_text() directly
    .txt   — read_text() directly
    .json  — read_text() directly (raw JSON string, not parsed)

Usage:
    from core.document_parser import DocumentParser
    text = DocumentParser.to_text(Path("report.pdf"))
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path

logger = logging.getLogger("document_parser")


class DocumentParser:
    """Stateless converter: file path or Google Sheets URL → plain-text string."""

    SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".xls", ".md", ".txt", ".json"}

    @classmethod
    def to_text(cls, path: Path) -> str:
        """Extract text from *path* and return it as a UTF-8 string.

        Raises:
            ValueError: if the file extension is not supported.
            FileNotFoundError: if the file does not exist.
        """
        path = Path(path)
        if not path.exists():
            raise FileNotFoundError(f"Document not found: {path}")

        suffix = path.suffix.lower()
        if suffix not in cls.SUPPORTED_EXTENSIONS:
            raise ValueError(
                f"Unsupported file type '{suffix}'. "
                f"Supported: {sorted(cls.SUPPORTED_EXTENSIONS)}"
            )

        try:
            if suffix == ".pdf":
                return cls._parse_pdf(path)
            elif suffix == ".docx":
                return cls._parse_docx(path)
            elif suffix in (".xlsx", ".xls"):
                return cls._parse_excel(path)
            else:
                # .md, .txt, .json — plain UTF-8 read
                return path.read_text(encoding="utf-8", errors="replace")
        except Exception as exc:
            logger.error("Failed to parse '%s': %s", path.name, exc)
            raise

    @classmethod
    def parse_google_sheets_url(cls, url: str) -> str:
        """Extract tabular content from a public Google Sheets URL by fetching CSV export."""
        import urllib.request
        import csv
        import io

        match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url)
        if not match:
            raise ValueError("Invalid Google Sheets URL format. Expected 'https://docs.google.com/spreadsheets/d/<DOC_ID>/...'")

        doc_id = match.group(1)
        csv_url = f"https://docs.google.com/spreadsheets/d/{doc_id}/export?format=csv"

        try:
            req = urllib.request.Request(csv_url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=10) as resp:
                csv_raw = resp.read().decode("utf-8", errors="replace")

            reader = csv.reader(io.StringIO(csv_raw))
            rows = []
            for row in reader:
                line = "\t".join(row).strip()
                if line:
                    rows.append(line)

            if not rows:
                return f"[Google Sheet: {doc_id}] Empty sheet content."

            return f"[Google Sheet: {doc_id}]\n" + "\n".join(rows)
        except Exception as e:
            logger.error("Failed to fetch Google Sheet '%s': %s", url, e)
            raise ValueError(f"Failed to fetch public Google Sheet content: {e}") from e

    # ------------------------------------------------------------------
    # Format-specific parsers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_pdf(path: Path) -> str:
        """Extract text from a PDF using pdfplumber with pypdf fallback."""
        pages: list[str] = []

        try:
            import pdfplumber
            with pdfplumber.open(path) as pdf:
                for i, page in enumerate(pdf.pages, 1):
                    text = page.extract_text() or ""
                    if text.strip():
                        pages.append(f"[Page {i}]\n{text}")
        except Exception as exc:
            logger.debug("pdfplumber failed for '%s': %s", path.name, exc)

        # Fallback to pypdf if pdfplumber returns empty pages
        if not pages:
            try:
                import pypdf
                reader = pypdf.PdfReader(path)
                for i, page in enumerate(reader.pages, 1):
                    text = page.extract_text() or ""
                    if text.strip():
                        pages.append(f"[Page {i}]\n{text}")
            except Exception as exc:
                logger.debug("pypdf fallback failed for '%s': %s", path.name, exc)

        if not pages:
            logger.warning(
                "PDF '%s' yielded no text — may be a scanned/image-only PDF.",
                path.name,
            )
        return "\n\n".join(pages)

    @staticmethod
    def _parse_docx(path: Path) -> str:
        """Extract text from a .docx file using python-docx.

        Extracts all paragraph text in document order. Tables are
        converted to pipe-delimited rows.
        """
        from docx import Document  # lazy import

        doc = Document(str(path))
        parts: list[str] = []

        for block in doc.element.body:
            tag = block.tag.split("}")[-1]  # strip XML namespace

            if tag == "p":
                # Paragraph
                text = "".join(run.text for run in block.iterchildren()
                               if run.tag.endswith("}r"))
                # Fallback: use python-docx paragraph text
                try:
                    from docx.oxml.ns import qn
                    texts = [node.text for node in block.iter(qn("w:t"))
                             if node.text]
                    text = "".join(texts)
                except Exception:
                    pass
                if text.strip():
                    parts.append(text.strip())

            elif tag == "tbl":
                # Table — convert to pipe-delimited rows
                try:
                    from docx.oxml.ns import qn
                    rows = []
                    for tr in block.iter(qn("w:tr")):
                        cells = []
                        for tc in tr.iter(qn("w:tc")):
                            cell_text = "".join(
                                node.text for node in tc.iter(qn("w:t"))
                                if node.text
                            )
                            cells.append(cell_text.strip())
                        if any(cells):
                            rows.append(" | ".join(cells))
                    if rows:
                        parts.append("\n".join(rows))
                except Exception as exc:
                    logger.debug("Table parsing skipped: %s", exc)

        return "\n\n".join(parts)

    @staticmethod
    def _parse_excel(path: Path) -> str:
        """Extract text from .xlsx / .xls using openpyxl.

        Strategy: each row becomes one line, cells joined by tabs.
        Each sheet is prefixed with its name. Empty rows are skipped.

        Note: Excel stores numeric, date, and formula values — these are
        converted to string with str(). Formula results may show as None
        if the workbook was never opened in Excel after formula entry.
        """
        import openpyxl  # lazy import

        wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
        sections: list[str] = []

        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows: list[str] = []
            for row in ws.iter_rows(values_only=True):
                # Skip entirely-empty rows
                cells = [str(c) if c is not None else "" for c in row]
                line = "\t".join(cells).rstrip()
                if line.strip():
                    rows.append(line)
            if rows:
                sections.append(f"[Sheet: {sheet_name}]\n" + "\n".join(rows))

        wb.close()
        return "\n\n".join(sections)
