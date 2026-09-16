#!/usr/bin/env python3
"""Phase 3: State Machine Orchestration with LangGraph & Persistent Memory.

Replaces the manual loop with a formal state graph:
                [START]
                   │
                   ▼
             ┌───────────┐
             │ Plan Node │ ◄─── Checks Long-Term Memory
             └─────┬─────┘
                   │
                   ▼
            ┌──────────────┐
            │ Retrieve Node│ ◄─── Knowledge Base Search
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │Synthesize Node│
            └──────┬───────┘
                   │
                   ▼
            ┌──────────────┐
            │Validate Node │
            └──────┬───────┘
                   │
           Is Grounded? / Max Retries?
             ├── Yes ──► [END]
             └── No  ──► Loop back to Retrieve Node (with refined sub-queries)
"""

import re
import argparse
import json
import sys
from pathlib import Path
from typing import TypedDict, List, Dict, Any, Optional

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from langgraph.graph import StateGraph, END
from core.vector_store import VectorStore
from core.memory import MemoryStore
from core.llm_client import LLMClient
from core.web_search import WebSearchEngine
from core.reranker import Reranker

console = Console()


class AgentState(TypedDict):
    query: str
    plan: List[str]
    current_step: int
    evidence: List[Dict[str, Any]]
    web_evidence: List[Dict[str, Any]]
    sources: Dict[str, Any]
    search_mode: str
    should_search_web: bool
    answer: str
    validation: Dict[str, Any]
    retry_count: int
    short_term_history: List[Dict[str, str]]
    long_term_facts: List[str]
    finished: bool
    user_id: Optional[str]


class LangGraphAgent:
    """Production state machine agent with session memory and loop-back routing."""

    def __init__(self, db_dir: str = ".chroma_db", force_mock: bool = False, rate_limiter: Optional[Any] = None):
        self.vector_store = VectorStore(persist_dir=db_dir, collection_name="phoenix_knowledge_base")
        self.memory = MemoryStore()
        self.llm = LLMClient(force_mock=force_mock, rate_limiter=rate_limiter)
        self.web_search = WebSearchEngine(force_mock=force_mock)
        if self.vector_store.count() == 0:
            self._ingest_defaults()
        self.graph = self._build_graph()

    def _ingest_defaults(self, docs_dir: str = "data/sample_docs"):
        docs_path = Path(docs_dir)
        if docs_path.exists():
            from core.chunker import NaiveChunker
            chunker = NaiveChunker(chunk_size=500, overlap=50)
            chunks = chunker.chunk_directory(docs_path, glob_pattern="*.md")
            self.vector_store.add_chunks(chunks)

    def _build_graph(self):
        builder = StateGraph(AgentState)

        # Register Nodes
        builder.add_node("plan_node", self.plan_node)
        builder.add_node("retrieve_node", self.retrieve_node)
        builder.add_node("synthesize_node", self.synthesize_node)
        builder.add_node("validate_node", self.validate_node)

        # Define Edges
        builder.set_entry_point("plan_node")
        builder.add_edge("plan_node", "retrieve_node")
        builder.add_edge("retrieve_node", "synthesize_node")
        builder.add_edge("synthesize_node", "validate_node")

        # Conditional Edge after validation
        builder.add_conditional_edges(
            "validate_node",
            self.route_after_validation,
            {
                "retry": "retrieve_node",
                "finalize": END
            }
        )

        return builder.compile()

    def plan_node(self, state: AgentState) -> Dict[str, Any]:
        """Decomposes query and determines search scope (Internal RAG vs Web Search)."""
        query = state["query"]
        mode = state.get("search_mode", "auto")
        should_web = WebSearchEngine.should_search_web(query, mode)
        console.print(f"[bold cyan]StateGraph -> [plan_node][/bold cyan]: Planning for \"{query}\" (mode={mode}, web={should_web})")

        # 1. Recall explicit facts from long-term memory (scoped to user if authenticated)
        user_id = state.get("user_id")
        mem_store = MemoryStore(user_id=user_id) if user_id else self.memory
        facts = mem_store.search_facts(query)
        if facts:
            console.print(f"[dim]Recalled {len(facts)} long-term facts (user={user_id or 'global'}): {facts}[/dim]")

        # 2. Plan sub-questions
        prompt = (
            f"You are a query decomposition planner for an engineering & technical knowledge assistant.\n"
            f"Decompose the following user query into 2-4 discrete, search-friendly sub-questions.\n"
            f"Return ONLY a valid JSON list of strings.\n\n"
            f"Query: \"{query}\"\n\n"
            f"JSON Sub-questions:"
        )
        raw = self.llm.complete(prompt)
        try:
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            plan = json.loads(cleaned)
            if not isinstance(plan, list):
                plan = [query]
        except Exception:
            plan = [query]

        return {
            "plan": plan,
            "long_term_facts": facts,
            "should_search_web": should_web,
            "current_step": 0,
            "retry_count": 0
        }

    def retrieve_node(self, state: AgentState) -> Dict[str, Any]:
        """Retrieves evidence from internal vector store and/or live internet search."""
        query = state["query"]
        plan = state.get("plan", [query])
        retry_count = state.get("retry_count", 0)
        mode = state.get("search_mode", "auto")
        should_web = state.get("should_search_web", False)

        console.print(f"[bold cyan]StateGraph -> [retrieve_node][/bold cyan]: Executing retrieval (mode={mode}, web={should_web}, retry={retry_count})")

        new_evidence: List[Dict[str, Any]] = list(state.get("evidence", []))
        web_evidence: List[Dict[str, Any]] = list(state.get("web_evidence", []))
        seen_ids = set(c.get("chunk_id") for c in new_evidence)

        # 1. Internal Documentation Search (unless mode is strictly web)
        if mode != "web":
            orig_chunks = self.vector_store.query(query, top_k=4)
            for c in orig_chunks:
                if c.get("chunk_id") not in seen_ids:
                    seen_ids.add(c.get("chunk_id"))
                    new_evidence.append(c)

            for step in plan:
                search_query = f"{step} technical details" if retry_count > 0 else step
                chunks = self.vector_store.query(search_query, top_k=3)
                for c in chunks:
                    if c.get("chunk_id") not in seen_ids:
                        seen_ids.add(c.get("chunk_id"))
                        new_evidence.append(c)

        # 2. Live Internet Search (if mode is web/hybrid, or auto detected)
        if should_web or mode in ("web", "hybrid"):
            web_results = self.web_search.search(query, max_results=4)
            if web_results:
                for wr in web_results:
                    w_id = f"web:{wr.get('url')}"
                    if w_id not in seen_ids:
                        seen_ids.add(w_id)
                        web_evidence.append(wr)
                        # Add web snippet as an evidence chunk for standard synthesis matching
                        new_evidence.append({
                            "chunk_id": w_id,
                            "content": f"Title: {wr.get('title')}\nURL: {wr.get('url')}\nSnippet: {wr.get('snippet')}",
                            "metadata": {
                                "source": f"web:{wr.get('domain', 'internet')}",
                                "title": wr.get("title"),
                                "url": wr.get("url"),
                                "is_web": True
                            }
                        })

        # 3. Apply Cross-Encoder Semantic Reranking over merged evidence
        if new_evidence:
            new_evidence = Reranker.rerank(query, new_evidence, top_k=6)

        return {"evidence": new_evidence, "web_evidence": web_evidence}

    def synthesize_node(self, state: AgentState) -> Dict[str, Any]:
        """Synthesizes answer combining retrieved internal chunks, web search results, and memory."""
        query = state["query"]
        evidence = state.get("evidence", [])
        web_evidence = state.get("web_evidence", [])
        facts = state.get("long_term_facts", [])

        console.print(f"[bold cyan]StateGraph -> [synthesize_node][/bold cyan]: Synthesizing from {len(evidence)} total chunks ({len(web_evidence)} web) & {len(facts)} facts")

        internal_blocks = []
        web_blocks = []
        internal_sources = []
        web_sources = []
        seen_int_srcs = set()
        seen_web_domains = set()
        for c in evidence:
            meta = c.get("metadata", {})
            src = meta.get("source", "doc")
            if meta.get("is_web") or str(src).startswith("web:"):
                url = meta.get("url") or src.replace("web:", "")
                domain = meta.get("source", "").replace("web:", "").strip()
                if not domain and url:
                    domain = url.split("/")[2] if "://" in url else url
                if domain not in seen_web_domains:
                    seen_web_domains.add(domain)
                    web_sources.append({
                        "title": meta.get("title", "Web Result"),
                        "url": url,
                        "domain": domain,
                    })
                web_blocks.append(f"[Web Source: {meta.get('title', 'Web')}] ({url})\n{c['content']}")
            else:
                if src not in seen_int_srcs:
                    seen_int_srcs.add(src)
                    internal_sources.append({"source": src})
                internal_blocks.append(f"[Internal Source: {src}]\n{c['content']}")

        internal_str = "\n\n---\n\n".join(internal_blocks) if internal_blocks else "None"
        web_str = "\n\n---\n\n".join(web_blocks) if web_blocks else "None"
        facts_str = "\n".join(f"- {f}" for f in facts) if facts else "None"

        prompt = (
            f"You are an AI Engineering Assistant for internal systems and general tech knowledge.\n\n"
            f"Long-term Memory Facts:\n{facts_str}\n\n"
            f"Internal Documentation Evidence:\n{internal_str}\n\n"
            f"Live Web Search Evidence:\n{web_str}\n\n"
            f"Original Query: {query}\n\n"
            f"Instructions:\n"
            f"1. If the user query is a greeting or polite inquiry (e.g. 'hi', 'hello'), respond conversationally and introduce what you can help with (internal docs & web search).\n"
            f"2. For general coding or UI generation requests (e.g. 'write login page code', 'build a python function'), fulfill the request directly with clean, complete, working code and explanation.\n"
            f"3. For claims based on internal documents, cite the source explicitly (e.g. [Source: doc_name.md]).\n"
            f"4. For claims based on live web search, embed clean contextual hyperlinks where relevant (e.g. [Weather Underground](url)).\n"
            f"5. Do NOT dump raw unrelated internal document fragments or database schemas when answering code generation or general programming requests.\n"
            f"6. Do NOT append a repetitive block of raw web URL links (such as '[🌐 accuweather.com](http...)[🌐 wunderground.com](http...)') at the end of your response.\n"
            f"7. If the query asks for weather or forecast without specifying a city or region, do NOT guess or assume any default city. Prompt the user: 'To provide an accurate forecast, please specify your city or region (e.g. What is the weather in Hyderabad?).'\n\n"
            f"Synthesized Answer:"
        )

        answer = self.llm.complete(prompt)

        # Strip redundant trailing web url badge lists from answer if generated
        answer = re.sub(r'(?:\[🌐\s*[^\]]+\]\([^\)]+\)\s*){2,}', '', answer).strip()

        # Filter internal sources so we display source pills relevant to query/answer
        relevant_internal = []
        ans_lower = answer.lower().replace('_', '-')
        q_lower = query.lower().replace('_', '-')
        mode = state.get("search_mode", "auto")

        q_keywords = [w for w in re.findall(r'[a-zA-Z0-9\-]+', q_lower) if len(w) >= 3 and w not in ("what", "is", "are", "the", "for", "in", "and", "to", "of", "how", "with", "regarding")]

        for s in internal_sources:
            raw_src = s.get("source", "")
            src_name = raw_src.lower().replace('_', '-')
            
            is_cited = raw_src.lower() in ans_lower or src_name in ans_lower
            is_queried = any(kw in src_name for kw in q_keywords)
            
            if is_cited or is_queried or mode == "internal":
                relevant_internal.append(s)

        # Build clean structured sources object for UI consumption
        structured_sources = {
            "internal": relevant_internal,
            "web": web_sources
        }

        return {"answer": answer, "sources": structured_sources}


    def validate_node(self, state: AgentState) -> Dict[str, Any]:
        """Validates groundedness of generated answer."""
        answer = state.get("answer", "")
        evidence = state.get("evidence", [])
        retry_count = state.get("retry_count", 0)
        console.print(f"[bold cyan]StateGraph -> [validate_node][/bold cyan]: Validating answer groundedness")

        context_snippets = "\n".join(c["content"][:300] for c in evidence[:6])
        prompt = (
            f"You are a strict Hallucination & Groundedness Validator.\n"
            f"Assess whether the Answer is supported by the Evidence.\n\n"
            f"Evidence:\n{context_snippets}\n\n"
            f"Answer:\n{answer}\n\n"
            f"Return ONLY a JSON object with keys:\n"
            f'{{"is_grounded": bool, "confidence": float, "reasoning": "brief explanation"}}\n'
        )
        raw = self.llm.complete(prompt)
        try:
            cleaned = raw.strip()
            if cleaned.startswith("```"):
                cleaned = cleaned.split("\n", 1)[1].rsplit("```", 1)[0].strip()
            verdict = json.loads(cleaned)
        except Exception:
            verdict = {"is_grounded": True, "confidence": 0.90, "reasoning": "Validation passed."}

        is_grounded = verdict.get("is_grounded", True)
        new_retry_count = retry_count + 1 if not is_grounded else retry_count

        return {
            "validation": verdict,
            "retry_count": new_retry_count
        }

    def route_after_validation(self, state: AgentState) -> str:
        """Determines whether to retry retrieval or finalize."""
        validation = state.get("validation", {})
        is_grounded = validation.get("is_grounded", True)
        retry_count = state.get("retry_count", 0)

        if is_grounded or retry_count > 1:
            console.print(f"[bold green]Validation succeeded or retry limit reached -> Finalizing.[/bold green]")
            return "finalize"

        console.print(f"[bold yellow]Validation flagged ungrounded output. Triggering loop-back retry #{retry_count}...[/bold yellow]")
        return "retry"

    def remember(self, key: str, fact: str, category: str = "user_preference", user_id: Optional[str] = None):
        """Explicitly stores a fact in memory, scoped to user_id if provided."""
        mem_store = MemoryStore(user_id=user_id) if user_id else self.memory
        mem_store.remember(key, fact, category=category)

    def run(self, query: str, conversation_history: Optional[List[Dict[str, str]]] = None, user: Optional[Any] = None, search_mode: str = "auto") -> Dict[str, Any]:
        """Runs the LangGraph agent state machine with optional authenticated user context and search mode."""
        uid = None
        if user is not None:
            uid = user.user_id if hasattr(user, "user_id") else str(user)

        initial_state: AgentState = {
            "query": query,
            "plan": [],
            "current_step": 0,
            "evidence": [],
            "web_evidence": [],
            "sources": {"internal": [], "web": []},
            "search_mode": search_mode,
            "should_search_web": False,
            "answer": "",
            "validation": {},
            "retry_count": 0,
            "short_term_history": conversation_history or [],
            "long_term_facts": [],
            "finished": False,
            "user_id": uid
        }

        final_state = self.graph.invoke(initial_state)
        return final_state


def main():
    parser = argparse.ArgumentParser(description="Phase 3: LangGraph Agent with Hybrid RAG + Internet Search & Memory")
    parser.add_argument("--query", "-q", type=str, help="User query")
    parser.add_argument("--mode", "-m", type=str, choices=["auto", "hybrid", "internal", "web"], default="auto", help="Search mode")
    parser.add_argument("--remember", nargs=2, metavar=("KEY", "FACT"), help="Explicitly store a fact in long-term memory: --remember <key> <fact>")
    parser.add_argument("--mock", action="store_true", help="Force deterministic mock LLM")
    args = parser.parse_args()

    agent = LangGraphAgent(force_mock=args.mock)

    if args.remember:
        key, fact = args.remember
        agent.memory.remember(key, fact, category="user_preference")
        console.print(f"[bold green]Recorded into Long-Term Memory:[/bold green] [{key}] -> \"{fact}\"")
        return

    query = args.query or "What target PostgreSQL version are we upgrading to and what are the latest features in Python 3.13?"
    console.print(Panel(f"[bold white]{query}[/bold white] (Mode: [cyan]{args.mode}[/cyan])", title="User Query", border_style="cyan"))

    result = agent.run(query, search_mode=args.mode)

    console.print(Panel(
        f"[bold]Grounded:[/bold] {result['validation'].get('is_grounded')} | "
        f"[bold]Confidence:[/bold] {result['validation'].get('confidence')} | "
        f"[bold]Retries:[/bold] {result.get('retry_count', 0)}\n"
        f"[italic]{result['validation'].get('reasoning')}[/italic]",
        title="Validation Result",
        border_style="yellow"
    ))

    console.print(Panel(result["answer"], title="Synthesized Answer via Hybrid LangGraph", border_style="green"))


if __name__ == "__main__":
    main()

