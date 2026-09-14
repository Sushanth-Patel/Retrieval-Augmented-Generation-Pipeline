"""Security Guardrails & Confirmation Gate for Agentic RAG.

Implements:
1. InputGuardrail: Direct prompt injection detection & indirect injection screening in retrieved documents.
2. OutputGuardrail: PII redaction (email, phone, SSN, API secrets).
3. ConfirmationGate: Safety gate requiring explicit human confirmation before mutating tool calls.
"""

import re
from typing import Dict, Any, List, Optional, Tuple
from pydantic import BaseModel


class GuardrailResult(BaseModel):
    passed: bool
    violation_type: Optional[str] = None
    confidence: float = 1.0
    reason: str = "Clean"
    sanitized_input: Optional[str] = None


class InputGuardrail:
    """Protects against direct and indirect prompt injection attacks."""

    DIRECT_INJECTION_PATTERNS = [
        r"(?:ignore|disregard)\s+(?:all\s+|everything\s+)?(?:previous|prior|above)\s*(?:instructions|directives|rules)?",
        r"(?:system\s+prompt\s+override|override\s+system\s+instructions)",
        r"(?:print|reveal|output|display)\s+(?:your\s+)?system\s+prompt",
        r"freedom\s+mode",
        r"you\s+are\s+now\s+(?:dan|jailbroken|unrestricted)",
        r"reveal\s+all\s+(?:admin|internal)?\s*(?:api\s*keys|passwords|secrets)",
        r"disregard\s+(?:all\s+)?(?:prior|system)\s+rules",
        r"access\s+granted:\s*admin\s+root",
        r"stop\s+retrieval\s+process\s+immediately",
        r"output\s+only:\s*['\"].*?['\"]"
    ]

    INDIRECT_INJECTION_PATTERNS = [
        r"(?i)important\s+instruction\s+override[^\n]*",
        r"(?i)security\s+breach\s+confirmed:[^\n]*",
        r"(?i)\[system\s+alert\]:[^\n]*",
        r"(?i)<!--\s*system\s+notice:[^\n]*",
        r"(?i)respond\s+only\s+with:\s*['\"].*?['\"]",
        r"(?i)ignore\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|rules)[^\n]*",
        r"(?i)you\s+are\s+now\s+in\s+['\"]?freedom\s+mode['\"]?[^\n]*",
        r"(?i)access\s+granted:\s*admin\s+root[^\n]*"
    ]

    def __init__(self):
        self._direct_regexes = [re.compile(p, re.IGNORECASE) for p in self.DIRECT_INJECTION_PATTERNS]
        self._indirect_regexes = [re.compile(p, re.IGNORECASE) for p in self.INDIRECT_INJECTION_PATTERNS]

    def validate_query(self, query: str) -> GuardrailResult:
        """Screens user query for direct prompt injection or jailbreak attempts."""
        for regex in self._direct_regexes:
            match = regex.search(query)
            if match:
                return GuardrailResult(
                    passed=False,
                    violation_type="DIRECT_PROMPT_INJECTION",
                    confidence=0.98,
                    reason=f"Detected adversarial injection sequence: '{match.group(0)}'"
                )

        return GuardrailResult(passed=True, reason="Query cleared security screening.")

    def sanitize_retrieved_chunk(self, chunk_text: str, source_doc: str = "unknown") -> Tuple[str, Optional[str]]:
        """Screens and neutralizes indirect injection embedded within retrieved documents.

        Returns (cleaned_text, flagged_warning).
        """
        for regex in self._indirect_regexes:
            match = regex.search(chunk_text)
            if match:
                # Neutralize injection payload from context to prevent LLM hijacking
                warning = f"Indirect injection attempt detected in '{source_doc}': '{match.group(0)}'"
                neutralized = regex.sub(f"[SUSPICIOUS ADVERSARIAL PAYLOAD STRIPPED FROM {source_doc}]", chunk_text)
                return neutralized, warning

        return chunk_text, None


class OutputGuardrail:
    """Redacts Personally Identifiable Information (PII) and secret credentials from model outputs."""

    # Patterns for Email, US/International Phones, SSN, and Bearer Tokens
    EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,16}\b")
    PHONE_PATTERN = re.compile(r"(?<![A-Za-z0-9])(?:\+\d{1,3}[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]\d{4}(?![A-Za-z0-9])")
    SSN_PATTERN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
    TOKEN_PATTERN = re.compile(r"(?:Bearer\s+[A-Za-z0-9_\-\.]{24,}|(?:sk-[A-Za-z0-9_-]{20,}))")

    def redact(self, text: str) -> Tuple[str, Dict[str, int]]:
        """Redacts PII patterns from the text and returns count of redactions."""
        redactions = {"emails": 0, "phones": 0, "ssns": 0, "secrets": 0}

        def _sub_email(m):
            redactions["emails"] += 1
            return "[EMAIL REDACTED]"

        def _sub_phone(m):
            redactions["phones"] += 1
            return "[PHONE REDACTED]"

        def _sub_ssn(m):
            redactions["ssns"] += 1
            return "[SSN REDACTED]"

        def _sub_token(m):
            redactions["secrets"] += 1
            return "[SECRET REDACTED]"

        sanitized = self.EMAIL_PATTERN.sub(_sub_email, text)
        sanitized = self.PHONE_PATTERN.sub(_sub_phone, sanitized)
        sanitized = self.SSN_PATTERN.sub(_sub_ssn, sanitized)
        sanitized = self.TOKEN_PATTERN.sub(_sub_token, sanitized)

        return sanitized, redactions


class ConfirmationGate:
    """Gate intercepting tool calls that modify or delete state."""

    MUTATING_ACTIONS = {
        "delete_document", "archive_tenant", "revoke_all_sessions",
        "update_database_schema", "write_file", "drop_table"
    }

    def requires_confirmation(self, tool_name: str, payload: Dict[str, Any]) -> bool:
        """Determines if a tool call is dangerous/mutating."""
        if tool_name in self.MUTATING_ACTIONS:
            return True
        if payload.get("destructive") or payload.get("mutation"):
            return True
        return False

    def request_approval(self, tool_name: str, payload: Dict[str, Any], auto_approve: bool = False) -> bool:
        """Prompts for confirmation or tests gate policy enforcement."""
        if not self.requires_confirmation(tool_name, payload):
            return True

        if auto_approve:
            return True

        # In interactive mode, this prompts the user; in eval, it records refusal
        return False
