"""Long-Term Memory store for Phase 3 LangGraph agent.

Stores persisted explicit facts across user sessions (e.g., project priorities,
architectural decisions, user preferences), saving directly to disk.
"""

import json
import re
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone


class MemoryStore:
    """Explicit persistent memory store for user and project facts."""

    def __init__(self, storage_path: str = "data/user_memory.json", user_id: Optional[str] = None):
        # Sanitize user_id to prevent directory traversal and handle whitespace/empty tokens
        clean_uid = None
        if user_id:
            stripped = re.sub(r"[^a-zA-Z0-9_\-]", "_", str(user_id).strip())
            if stripped.replace("_", ""):
                clean_uid = stripped

        self.user_id = clean_uid
        p = Path(storage_path)

        # If user_id is specified and valid, store memory in per-user file for strong isolation
        if self.user_id:
            self.storage_path = p.parent / f"users/{self.user_id}_memory.json"
        else:
            # Global fallback partition for shared public engineering facts
            self.storage_path = p

        self.storage_path.parent.mkdir(parents=True, exist_ok=True)
        self.facts: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self):
        """Loads memory from disk if it exists."""
        if self.storage_path.exists():
            try:
                self.facts = json.loads(self.storage_path.read_text(encoding="utf-8"))
            except Exception:
                self.facts = {}
        elif not self.user_id:
            # Seed default known facts for shared global testing & demo
            self.facts = {
                "preferred_db_version": {
                    "fact": "Target PostgreSQL version for Project Phoenix is 16.2.",
                    "category": "architecture",
                    "updated_at": "2026-02-15T10:00:00Z"
                },
                "primary_oncall": {
                    "fact": "Launch night primary on-call engineer is Bob Martinez.",
                    "category": "operations",
                    "updated_at": "2026-03-05T12:00:00Z"
                }
            }
            self.save()
        else:
            self.facts = {}

    def save(self):
        """Persists facts to disk."""
        self.storage_path.write_text(json.dumps(self.facts, indent=2), encoding="utf-8")

    def remember(self, key: str, fact: str, category: str = "general"):
        """Explicitly records or updates a learned fact."""
        self.facts[key] = {
            "fact": fact,
            "category": category,
            "user_id": self.user_id,
            "updated_at": datetime.now(timezone.utc).isoformat()
        }
        self.save()

    def recall(self, key: str) -> Optional[str]:
        """Retrieves a specific fact by key."""
        entry = self.facts.get(key)
        return entry["fact"] if entry else None

    def search_facts(self, query: str) -> List[str]:
        """Returns facts whose key, category, or content matches words in the query."""
        terms = set(query.lower().split())
        matched = []
        for k, v in self.facts.items():
            text = f"{k} {v['category']} {v['fact']}".lower()
            if any(t in text for t in terms):
                matched.append(v["fact"])
        return matched

    def get_all_facts(self) -> Dict[str, Dict[str, Any]]:
        return self.facts
