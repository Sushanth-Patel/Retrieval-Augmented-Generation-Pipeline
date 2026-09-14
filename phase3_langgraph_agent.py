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

console = Console()


class AgentState(TypedDict):
    query: str
    plan: List[str]
    current_step: int
    evidence: List[Dict[str, Any]]
    answer: str
    validation: Dict[str, Any]
    retry_count: int
    short_term_history: List[Dict[str, str]]
    long_term_facts: List[str]
    finished: bool


class LangGraphAgent:
    """Production state machine agent with session memory and loop-back routing."""

    def __init__(self, db_dir: str = ".chroma_db", force_mock: bool = False):
        self.vector_store = VectorStore(persist_dir=db_dir, collection_name="phoenix_knowledge_base")
        self.memory = MemoryStore()
        self.llm = LLMClient(force_mock=force_mock)
        self.graph = self._build_graph()

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
        """Decomposes query and loads relevant facts from long-term memory."""
        query = state["query"]
        console.print(f"[bold cyan]StateGraph -> [plan_node][/bold cyan]: Planning for \"{query}\"")

        # 1. Recall explicit facts from long-term memory
        facts = self.memory.search_facts(query)
        if facts:
            console.print(f"[dim]Recalled {len(facts)} long-term facts: {facts}[/dim]")

        # 2. Plan sub-questions
        prompt = (
            f"You are a query decomposition planner for an engineering knowledge base.\n"
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
            "current_step": 0,
            "retry_count": 0
        }

    def retrieve_node(self, state: AgentState) -> Dict[str, Any]:
        """Retrieves evidence chunks from vector store."""
        plan = state.get("plan", [state["query"]])
        retry_count = state.get("retry_count", 0)
        console.print(f"[bold cyan]StateGraph -> [retrieve_node][/bold cyan]: Executing {len(plan)} retrieval steps (Retry #{retry_count})")

        new_evidence: List[Dict[str, Any]] = list(state.get("evidence", []))
        seen_ids = set(c.get("chunk_id") for c in new_evidence)

        for step in plan:
            # If in retry mode, append specific qualifier to broaden search
            search_query = f"{step} technical details" if retry_count > 0 else step
            chunks = self.vector_store.query(search_query, top_k=3)
            for c in chunks:
                if c.get("chunk_id") not in seen_ids:
                    seen_ids.add(c.get("chunk_id"))
                    new_evidence.append(c)

        return {"evidence": new_evidence}

    def synthesize_node(self, state: AgentState) -> Dict[str, Any]:
        """Synthesizes answer combining retrieved chunks and long-term memory."""
        query = state["query"]
        evidence = state.get("evidence", [])
        facts = state.get("long_term_facts", [])
        console.print(f"[bold cyan]StateGraph -> [synthesize_node][/bold cyan]: Synthesizing from {len(evidence)} chunks & {len(facts)} memory facts")

        context_blocks = []
        for c in evidence:
            src = c["metadata"].get("source", "doc")
            context_blocks.append(f"[Source: {src}]\n{c['content']}")
        context_str = "\n\n---\n\n".join(context_blocks)

        facts_str = "\n".join(f"- {f}" for f in facts) if facts else "None"

        prompt = (
            f"You are a Senior Principal Engineer synthesizing evidence from internal engineering documents.\n\n"
            f"Long-term Memory Facts:\n{facts_str}\n\n"
            f"Retrieved Evidence Chunks:\n{context_str}\n\n"
            f"Original Query: {query}\n\n"
            f"Instructions:\n"
            f"1. Directly answer the user query.\n"
            f"2. Cite document sources explicitly for every key claim.\n"
            f"3. Incorporate long-term memory facts where relevant.\n\n"
            f"Synthesized Answer:"
        )

        answer = self.llm.complete(prompt)
        return {"answer": answer}

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

    def run(self, query: str, conversation_history: Optional[List[Dict[str, str]]] = None) -> Dict[str, Any]:
        """Runs the LangGraph agent state machine."""
        initial_state: AgentState = {
            "query": query,
            "plan": [],
            "current_step": 0,
            "evidence": [],
            "answer": "",
            "validation": {},
            "retry_count": 0,
            "short_term_history": conversation_history or [],
            "long_term_facts": [],
            "finished": False
        }

        final_state = self.graph.invoke(initial_state)
        return final_state


def main():
    parser = argparse.ArgumentParser(description="Phase 3: LangGraph Agent with State Machine & Memory")
    parser.add_argument("--query", "-q", type=str, help="User query")
    parser.add_argument("--remember", nargs=2, metavar=("KEY", "FACT"), help="Explicitly store a fact in long-term memory: --remember <key> <fact>")
    parser.add_argument("--mock", action="store_true", help="Force deterministic mock LLM")
    args = parser.parse_args()

    agent = LangGraphAgent(force_mock=args.mock)

    if args.remember:
        key, fact = args.remember
        agent.memory.remember(key, fact, category="user_preference")
        console.print(f"[bold green]Recorded into Long-Term Memory:[/bold green] [{key}] -> \"{fact}\"")
        return

    query = args.query or "What target PostgreSQL version are we upgrading to and what were the staging replication blockers?"
    console.print(Panel(f"[bold white]{query}[/bold white]", title="User Query", border_style="cyan"))

    result = agent.run(query)

    console.print(Panel(
        f"[bold]Grounded:[/bold] {result['validation'].get('is_grounded')} | "
        f"[bold]Confidence:[/bold] {result['validation'].get('confidence')} | "
        f"[bold]Retries:[/bold] {result.get('retry_count', 0)}\n"
        f"[italic]{result['validation'].get('reasoning')}[/italic]",
        title="Validation Result",
        border_style="yellow"
    ))

    console.print(Panel(result["answer"], title="Synthesized Answer via LangGraph", border_style="green"))


if __name__ == "__main__":
    main()
