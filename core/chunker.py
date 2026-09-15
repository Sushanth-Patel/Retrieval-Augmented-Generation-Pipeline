"""Document chunker for Naive & Agentic RAG.

Provides naive fixed-size chunking with configurable window size and overlap,
preserving metadata (source file, chunk index, start/end character offsets).
"""

from typing import List, Dict, Any
from pathlib import Path
from pydantic import BaseModel, Field


class DocumentChunk(BaseModel):
    chunk_id: str
    doc_name: str
    chunk_index: int
    content: str
    start_char: int
    end_char: int
    metadata: Dict[str, Any] = Field(default_factory=dict)


class NaiveChunker:
    """Fixed-size chunker with overlap."""

    def __init__(self, chunk_size: int = 500, overlap: int = 50):
        if overlap >= chunk_size:
            raise ValueError("Overlap must be strictly less than chunk_size")
        self.chunk_size = chunk_size
        self.overlap = overlap

    def chunk_text(self, text: str, doc_name: str, extra_metadata: Dict[str, Any] = None) -> List[DocumentChunk]:
        """Splits a single text into overlapping chunks."""
        chunks: List[DocumentChunk] = []
        if not text.strip():
            return chunks

        step = self.chunk_size - self.overlap
        start = 0
        chunk_idx = 0
        text_length = len(text)

        while start < text_length:
            end = min(start + self.chunk_size, text_length)
            chunk_content = text[start:end]

            chunk_id = f"{Path(doc_name).stem}_chunk_{chunk_idx:03d}"
            meta = {
                "source": doc_name,
                "chunk_index": chunk_idx,
                "length": len(chunk_content),
                **(extra_metadata or {})
            }

            chunks.append(
                DocumentChunk(
                    chunk_id=chunk_id,
                    doc_name=doc_name,
                    chunk_index=chunk_idx,
                    content=chunk_content,
                    start_char=start,
                    end_char=end,
                    metadata=meta
                )
            )

            chunk_idx += 1
            start += step
            if end >= text_length:
                break

        return chunks

    def chunk_file(self, file_path: Path) -> List[DocumentChunk]:
        """Reads a file and splits it into chunks using DocumentParser."""
        try:
            from core.document_parser import DocumentParser
            text = DocumentParser.to_text(file_path)
        except Exception:
            text = file_path.read_text(encoding="utf-8")
        return self.chunk_text(text, doc_name=file_path.name, extra_metadata={"file_path": str(file_path)})

    def chunk_directory(self, dir_path: Path, glob_pattern: str = None) -> List[DocumentChunk]:
        """Chunks all matching documents in a directory.
        If glob_pattern is None, chunks all files with extensions supported by DocumentParser.
        """
        all_chunks: List[DocumentChunk] = []
        if glob_pattern is not None:
            files = sorted(dir_path.glob(glob_pattern))
        else:
            try:
                from core.document_parser import DocumentParser
                supported = DocumentParser.SUPPORTED_EXTENSIONS
            except Exception:
                supported = {".md", ".txt", ".json", ".pdf", ".docx", ".xlsx", ".xls"}
            files = sorted([f for f in dir_path.iterdir() if f.is_file() and f.suffix.lower() in supported])
        for f in files:
            all_chunks.extend(self.chunk_file(f))
        return all_chunks
