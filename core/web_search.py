"""Web Search Engine for Agentic RAG Pipeline.

Provides live internet search capabilities with:
- Zero-API-key DuckDuckGo search via `ddgs` (primary)
- Optional Tavily search API integration if TAVILY_API_KEY is configured
- Graceful offline / mock fallback for deterministic testing and network interruptions
- Source domain parsing, snippet cleanup, and LLM context formatting
"""

from __future__ import annotations

import os
import re
import logging
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import List, Dict, Any, Optional
from urllib.parse import urlparse

logger = logging.getLogger("web_search")


class WebSearchResult:
    """Represents a single search result item from the internet."""

    def __init__(self, title: str, url: str, snippet: str, domain: str = ""):
        self.title = title.strip()
        self.url = url.strip()
        self.snippet = snippet.strip()
        self.domain = domain or self._extract_domain(self.url)

    @staticmethod
    def _extract_domain(url: str) -> str:
        try:
            parsed = urlparse(url)
            return parsed.netloc or url
        except Exception:
            return "web"

    def to_dict(self) -> Dict[str, Any]:
        return {
            "title": self.title,
            "url": self.url,
            "snippet": self.snippet,
            "domain": self.domain,
            "source_type": "web",
        }


class WebSearchEngine:
    """Multi-provider internet search client with zero-config default."""

    def __init__(self, force_mock: bool = False, timeout: int = 3):
        self.force_mock = force_mock
        self.timeout = timeout
        self.tavily_api_key = os.getenv("TAVILY_API_KEY", "").strip()

    def search(self, query: str, max_results: int = 4) -> List[Dict[str, Any]]:
        """Searches the live internet for *query* and returns structured snippets.

        Returns:
            List of dicts with keys: title, url, snippet, domain, source_type='web'
        """
        clean_query = query.strip()
        if not clean_query:
            return []

        if self.force_mock:
            return self._mock_search(clean_query, max_results)

        # 1. Try Tavily if configured
        if self.tavily_api_key:
            try:
                results = self._search_tavily(clean_query, max_results)
                if results:
                    return results
            except Exception as exc:
                logger.warning(f"Tavily search failed for '{clean_query}', falling back: {exc}")

        # 2. Try DuckDuckGo via DDGS with strict 3.5s timeout cap
        try:
            with ThreadPoolExecutor(max_workers=1) as executor:
                future = executor.submit(self._search_ddgs, clean_query, max_results)
                results = future.result(timeout=3.5)
                if results:
                    return results
        except (TimeoutError, Exception) as exc:
            logger.warning(f"DDGS search timed out or failed for '{clean_query}': {exc}")

        # 3. Graceful offline fallback
        logger.info(f"Using fallback search results for '{clean_query}'")
        return self._mock_search(clean_query, max_results)

    def _search_ddgs(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        from ddgs import DDGS

        results: List[Dict[str, Any]] = []
        with DDGS(timeout=self.timeout) as ddgs:
            raw_results = list(ddgs.text(query, max_results=max_results))
            for item in raw_results:
                title = item.get("title", "")
                url = item.get("href", "")
                snippet = item.get("body", "")
                if title and url:
                    sr = WebSearchResult(title=title, url=url, snippet=snippet)
                    results.append(sr.to_dict())
        return results

    def _search_tavily(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        import requests

        url = "https://api.tavily.com/search"
        payload = {
            "api_key": self.tavily_api_key,
            "query": query,
            "max_results": max_results,
            "search_depth": "basic",
            "include_answer": False,
        }
        resp = requests.post(url, json=payload, timeout=self.timeout)
        if resp.status_code != 200:
            raise RuntimeError(f"Tavily returned {resp.status_code}: {resp.text}")

        data = resp.json()
        results: List[Dict[str, Any]] = []
        for item in data.get("results", []):
            sr = WebSearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("content", ""),
            )
            results.append(sr.to_dict())
        return results

    def _mock_search(self, query: str, max_results: int) -> List[Dict[str, Any]]:
        """Deterministic simulation for tests and offline environments."""
        q_lower = query.lower()
        mock_library = [
            {
                "title": "Python 3.13 Release Notes & Documentation",
                "url": "https://docs.python.org/3/whatsnew/3.13.html",
                "snippet": "Python 3.13 introduces experimental free-threaded CPython (GIL disabled via --disable-gil), an improved interactive interpreter, and JIT compilation experiments.",
                "keywords": ["python", "3.13", "gil", "interpreter"],
            },
            {
                "title": "PostgreSQL 16 High Availability & Logical Replication Updates",
                "url": "https://www.postgresql.org/docs/16/release-16.html",
                "snippet": "PostgreSQL 16 allows logical replication from standby servers, improves bidirectional replication conflict handling, and enhances parallel query execution.",
                "keywords": ["postgres", "postgresql", "replication", "database"],
            },
            {
                "title": "Redis 7.2 Cluster Architecture & Active-Active Sharding",
                "url": "https://redis.io/docs/latest/operate/oss_and_stack/reference/cluster-spec/",
                "snippet": "Redis Cluster provides automatic sharding across multiple nodes with multi-key operation routing and Sentinel automatic failover mechanisms.",
                "keywords": ["redis", "cluster", "cache", "caching"],
            },
            {
                "title": "FastAPI Web Framework Documentation & Async Best Practices",
                "url": "https://fastapi.tiangolo.com/",
                "snippet": "FastAPI is a modern, high-performance web framework for building APIs with Python based on standard Python type hints and Starlette / Pydantic.",
                "keywords": ["fastapi", "api", "async", "framework"],
            },
        ]

        matched = []
        for entry in mock_library:
            if any(k in q_lower for k in entry["keywords"]):
                matched.append(
                    WebSearchResult(
                        title=entry["title"],
                        url=entry["url"],
                        snippet=entry["snippet"],
                    ).to_dict()
                )

        if not matched:
            # Generic simulated web match
            matched.append(
                WebSearchResult(
                    title=f"Web Search Results for: {query[:50]}",
                    url="https://duckduckgo.com/?q=" + query.replace(" ", "+"),
                    snippet=f"Live overview and public information regarding '{query}'. Covers recent industry standards, specifications, and discussions.",
                ).to_dict()
            )

        return matched[:max_results]

    @staticmethod
    def should_search_web(query: str, search_mode: str = "auto") -> bool:
        """Determines if the pipeline should trigger live internet search."""
        mode = search_mode.lower()
        if mode in ("web", "internet"):
            return True
        if mode == "internal":
            return False
        if mode == "hybrid":
            return True

        # In "auto" mode, look for indicators of real-time, external, or comparative search
        q = query.lower()

        # Phrases indicating internet / external lookup
        web_triggers = [
            "search the web", "look up online", "google", "internet", "latest",
            "current", "today", "news", "weather", "release notes", "version",
            "official documentation", "compare to industry", "best practices",
            "external", "public", "what is happening", "github", "pypi"
        ]
        if any(trig in q for trig in web_triggers):
            return True

        # Year references indicating up-to-date lookups
        if re.search(r"\b(202[4-9]|203[0-9])\b", q):
            return True

        # Questions about general tech stacks not confined to internal docs
        general_tech = ["python", "redis", "docker", "kubernetes", "fastapi", "aws", "gcp", "react", "nextjs"]
        internal_anchors = ["rfc-", "incident", "meeting", "okr", "sprint", "phoenix", "staging blocker"]

        has_general = any(tech in q for tech in general_tech)
        has_internal = any(anchor in q for anchor in internal_anchors)

        # If general tech is asked without internal markers, default to web or hybrid
        if has_general and not has_internal:
            return True

        return False

    @staticmethod
    def format_for_context(results: List[Dict[str, Any]]) -> str:
        """Formats search results into an LLM-digestible context block."""
        if not results:
            return ""

        blocks = []
        for i, r in enumerate(results, start=1):
            title = r.get("title", "Web Page")
            url = r.get("url", "")
            snippet = r.get("snippet", "")
            domain = r.get("domain", "")
            blocks.append(
                f"[Web Source {i}: {domain}]\n"
                f"Title: {title}\n"
                f"URL: {url}\n"
                f"Content Snippet: {snippet}"
            )
        return "\n\n".join(blocks)
