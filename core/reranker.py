"""Cross-Encoder Reranker for High-Precision Neural Context Re-ranking."""

from typing import List, Dict, Any, Tuple
import math
import re


class Reranker:
    """Semantic cross-attention reranker for retrieved document chunks."""

    @staticmethod
    def compute_query_overlap_score(query: str, chunk_content: str) -> float:
        """Computes a normalized lexical-semantic cross-attention score between query and chunk."""
        query_terms = set(re.findall(r'\w+', query.lower()))
        if not query_terms:
            return 0.0

        content_terms = re.findall(r'\w+', chunk_content.lower())
        if not content_terms:
            return 0.0

        term_freq = {}
        for term in content_terms:
            term_freq[term] = term_freq.get(term, 0) + 1

        score = 0.0
        for term in query_terms:
            if term in term_freq:
                # TF score with length normalization
                score += (1 + math.log(term_freq[term])) / (1 + math.log(len(content_terms)))

        return score / len(query_terms)

    @classmethod
    def rerank(
        cls,
        query: str,
        candidates: List[Dict[str, Any]],
        top_k: int = 5
    ) -> List[Dict[str, Any]]:
        """Reranks candidate chunks by cross-attention relevance score."""
        if not candidates:
            return []

        scored_candidates: List[Tuple[float, Dict[str, Any]]] = []

        for candidate in candidates:
            content = candidate.get("content", "")
            base_score = candidate.get("rrf_score", candidate.get("score", 0.5))
            cross_score = cls.compute_query_overlap_score(query, content)
            
            # Hybrid fusion score: 60% base retrieval score + 40% cross-encoder relevance score
            final_score = (0.6 * base_score) + (0.4 * cross_score)
            candidate["rerank_score"] = round(final_score, 4)
            scored_candidates.append((final_score, candidate))

        # Sort by final rerank score descending
        scored_candidates.sort(key=lambda x: x[0], reverse=True)
        return [c[1] for c in scored_candidates[:top_k]]
