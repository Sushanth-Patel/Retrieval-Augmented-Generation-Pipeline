"""BM25Okapi sparse lexical retrieval implementation for hybrid search."""

import math
import re
from collections import Counter
from typing import List, Dict, Any, Tuple
from core.chunker import DocumentChunk


def tokenize(text: str) -> List[str]:
    """Tokenizes text preserving technical identifiers (e.g. RFC-001, AI-101, snake_case, version numbers)."""
    return re.findall(r'[a-zA-Z0-9]+(?:[_\-\.][a-zA-Z0-9]+)*', text.lower())


class BM25Index:
    """Okapi BM25 sparse index implementation (Lucene/Okapi formula)."""

    def __init__(self, chunks: List[DocumentChunk], k1: float = 1.5, b: float = 0.75):
        self.chunks = chunks
        self.k1 = k1
        self.b = b
        self.corpus_size = len(chunks)
        self.doc_lengths: List[int] = []
        self.doc_token_counts: List[Counter] = []
        self.doc_freqs: Counter = Counter()

        for c in chunks:
            # Include both the document title/name and content in lexical tokens
            tokens = tokenize(f"{c.doc_name} {c.content}")
            self.doc_lengths.append(len(tokens))
            counts = Counter(tokens)
            self.doc_token_counts.append(counts)
            for t in counts:
                self.doc_freqs[t] += 1

        self.avgdl = sum(self.doc_lengths) / self.corpus_size if self.corpus_size > 0 else 1.0
        self.idf: Dict[str, float] = {}
        for token, df in self.doc_freqs.items():
            # Standard smoothed inverse document frequency
            self.idf[token] = math.log(1.0 + (self.corpus_size - df + 0.5) / (df + 0.5))

    def search(self, query: str, top_k: int = 8) -> List[Tuple[DocumentChunk, float]]:
        """Searches BM25 index and returns top_k (chunk, score) pairs."""
        q_tokens = tokenize(query)
        scores: List[Tuple[DocumentChunk, float]] = []

        for c, counts, doc_len in zip(self.chunks, self.doc_token_counts, self.doc_lengths):
            score = 0.0
            for t in q_tokens:
                if t in counts:
                    tf = counts[t]
                    idf = self.idf.get(t, 0.0)
                    denom = tf + self.k1 * (1.0 - self.b + self.b * (doc_len / self.avgdl))
                    score += idf * (tf * (self.k1 + 1.0)) / denom
            if score > 0.0:
                scores.append((c, score))

        scores.sort(key=lambda x: x[1], reverse=True)
        return scores[:top_k]


def reciprocal_rank_fusion(
    dense_results: List[Dict[str, Any]],
    sparse_results: List[Tuple[DocumentChunk, float]],
    rrf_k: int = 60,
    top_k: int = 4
) -> List[Dict[str, Any]]:
    """Merges dense and sparse rankings using standard Cormack et al. RRF formula.
    
    RRF(d) = sum(1 / (k + rank_i(d)))
    """
    chunk_map: Dict[str, Dict[str, Any]] = {}
    rrf_scores: Counter = Counter()
    dense_ranks: Dict[str, int] = {}
    sparse_ranks: Dict[str, int] = {}

    for rank, item in enumerate(dense_results, 1):
        cid = item["chunk_id"]
        dense_ranks[cid] = rank
        chunk_map[cid] = item
        rrf_scores[cid] += 1.0 / (rrf_k + rank)

    for rank, (chunk, bm25_score) in enumerate(sparse_results, 1):
        cid = chunk.chunk_id
        sparse_ranks[cid] = rank
        if cid not in chunk_map:
            chunk_map[cid] = {
                "chunk_id": cid,
                "content": chunk.content,
                "metadata": {
                    "source": chunk.metadata.get("source", chunk.doc_name),
                    "chunk_index": chunk.chunk_index
                },
                "similarity": 0.0,
                "distance": 1.0
            }
        rrf_scores[cid] += 1.0 / (rrf_k + rank)

    sorted_cids = sorted(rrf_scores.keys(), key=lambda cid: rrf_scores[cid], reverse=True)[:top_k]

    fused_results: List[Dict[str, Any]] = []
    for cid in sorted_cids:
        item = chunk_map[cid].copy()
        item["rrf_score"] = round(rrf_scores[cid], 5)
        item["dense_rank"] = dense_ranks.get(cid)
        item["sparse_rank"] = sparse_ranks.get(cid)
        fused_results.append(item)

    return fused_results
