#!/usr/bin/env python3
"""Phase 0: Foundations — Naive Non-Agentic RAG Pipeline.

Demonstrates pure RAG fundamentals without framework abstractions:
1. Document ingestion and naive fixed-size chunking (500 chars, 50 overlap).
2. Vector embeddings & local storage in ChromaDB.
3. Top-k semantic retrieval.
4. Prompt stuffing and LLM completion with source citations.
"""

import argparse
import sys
from pathlib import Path
from typing import List, Dict, Any

from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from core.chunker import NaiveChunker
from core.vector_store import VectorStore
from core.llm_client import LLMClient

console = Console()


class NaiveRAG:
    """Non-agentic baseline RAG implementation."""

    def __init__(
        self,
        docs_dir: str = "data/sample_docs",
        db_dir: str = ".chroma_db",
        chunk_size: int = 500,
        chunk_overlap: int = 50,
        force_mock: bool = False
    ):
        self.docs_dir = Path(docs_dir)
        self.chunker = NaiveChunker(chunk_size=chunk_size, overlap=chunk_overlap)
        self.vector_store = VectorStore(persist_dir=db_dir, collection_name="phase0_naive_rag")
        self.llm = LLMClient(force_mock=force_mock)

    def ingest(self, force_reindex: bool = False) -> int:
        """Chunks documents in docs_dir and stores them in ChromaDB."""
        if not force_reindex and self.vector_store.count() > 0:
            console.print(f"[dim]Using existing vector index ({self.vector_store.count()} chunks).[/dim]")
            return self.vector_store.count()

        if force_reindex:
            self.vector_store.clear()

        console.print(f"[bold cyan]Ingesting documents from {self.docs_dir}...[/bold cyan]")
        chunks = self.chunker.chunk_directory(self.docs_dir, glob_pattern="*.md")
        self.vector_store.add_chunks(chunks)
        console.print(f"[bold green]Successfully indexed {len(chunks)} chunks into ChromaDB.[/bold green]")
        return len(chunks)

    def retrieve(self, query: str, top_k: int = 4) -> List[Dict[str, Any]]:
        """Retrieves top-k relevant chunks for the given query."""
        return self.vector_store.query(query, top_k=top_k)

    def generate_prompt(self, query: str, retrieved_chunks: List[Dict[str, Any]]) -> str:
        """Constructs the augmented prompt with context chunks."""
        context_parts = []
        for i, chunk in enumerate(retrieved_chunks, 1):
            source = chunk["metadata"].get("source", "unknown")
            score = chunk.get("similarity", 0.0)
            context_parts.append(
                f"[Document: {source} | Similarity: {score}]\n{chunk['content']}\n"
            )
        context_str = "\n---\n".join(context_parts)

        prompt = (
            f"You are a helpful engineering assistant answering questions strictly based on the provided documents.\n\n"
            f"Retrieved Chunks:\n"
            f"{context_str}\n\n"
            f"User Query: {query}\n\n"
            f"Instructions:\n"
            f"- Answer the user query using only the information in the retrieved chunks.\n"
            f"- Explicitly cite document names for each fact or decision.\n"
            f"- If the answer is not present in the retrieved chunks, state: 'I cannot find sufficient evidence in the provided documentation.'\n\n"
            f"Answer:"
        )
        return prompt

    def query(self, query_text: str, top_k: int = 4) -> Dict[str, Any]:
        """End-to-end Naive RAG query execution."""
        self.ingest()
        chunks = self.retrieve(query_text, top_k=top_k)
        prompt = self.generate_prompt(query_text, chunks)
        response = self.llm.complete(prompt)

        return {
            "query": query_text,
            "answer": response,
            "retrieved_chunks": chunks,
            "provider": self.llm.provider
        }


def display_results(result: Dict[str, Any]):
    """Pretty prints the query results and retrieved chunks."""
    console.print(Panel(f"[bold white]{result['query']}[/bold white]", title="Query", border_style="cyan"))

    table = Table(title=f"Retrieved Chunks (Top {len(result['retrieved_chunks'])})", show_lines=True)
    table.add_column("Rank", justify="center", style="cyan", width=6)
    table.add_column("Source Document", style="yellow", width=36)
    table.add_column("Similarity", justify="center", style="green", width=12)
    table.add_column("Excerpt", style="dim")

    for i, c in enumerate(result["retrieved_chunks"], 1):
        source = c["metadata"].get("source", "N/A")
        sim = f"{c.get('similarity', 0.0):.3f}"
        snippet = c["content"].replace("\n", " ")[:120] + "..."
        table.add_row(str(i), source, sim, snippet)

    console.print(table)
    console.print(Panel(result["answer"], title=f"LLM Generated Answer (Provider: {result['provider']})", border_style="green"))


def main():
    parser = argparse.ArgumentParser(description="Phase 0: Naive RAG Pipeline")
    parser.add_argument("--query", "-q", type=str, help="Query to run against the knowledge base")
    parser.add_argument("--reindex", action="store_true", help="Force re-indexing of documents into ChromaDB")
    parser.add_argument("--top_k", "-k", type=int, default=4, help="Number of chunks to retrieve")
    parser.add_argument("--mock", action="store_true", help="Force deterministic local mock LLM")
    args = parser.parse_args()

    rag = NaiveRAG(force_mock=args.mock)

    if args.reindex:
        rag.ingest(force_reindex=True)
        if not args.query:
            console.print("[green]Re-indexing complete.[/green]")
            return

    if args.query:
        result = rag.query(args.query, top_k=args.top_k)
        display_results(result)
    else:
        # Default sample queries demonstrating Phase 0
        sample_queries = [
            "What was the root cause of the auth latency incident on January 10?",
            "What are the specifications of the Redis cluster in RFC-001?",
            "What is the target cutover schedule for PostgreSQL 16?"
        ]
        console.print("[bold yellow]No query provided. Running 3 sample demonstration queries:[/bold yellow]\n")
        for q in sample_queries:
            console.rule(f"[bold cyan]Sample: {q}[/bold cyan]")
            result = rag.query(q, top_k=args.top_k)
            display_results(result)
            console.print("\n")


if __name__ == "__main__":
    main()
