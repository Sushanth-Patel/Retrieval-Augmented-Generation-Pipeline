"""Long-Term Memory store for Phase 3 LangGraph agent.

Stores persisted explicit facts across user sessions (e.g., project priorities,
architectural decisions, user preferences), saving directly to disk.
"""

import json
from pathlib import Path
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone


class MemoryStore:
    """Explicit persistent memory store for user and project facts."""

    def __init__(self, storage_path: str = "data/user_memory.json"):
        self.storage_path = Path(storage_path)
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
        else:
            # Seed default known facts for testing & demo
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

    def save(self):
        """Persists facts to disk."""
        self.storage_path.write_text(json.dumps(self.facts, indent=2), encoding="utf-8")

    def remember(self, key: str, fact: str, category: str = "general"):
        """Explicitly records or updates a learned fact."""
        self.facts[key] = {
            "fact": fact,
            "category": category,
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
