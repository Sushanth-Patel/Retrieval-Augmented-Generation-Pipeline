import os
import tempfile
from typing import List, Dict, Any, Optional
from pathlib import Path

# Ensure writable cache directory for ChromaDB ONNX models & HuggingFace models
if "XDG_CACHE_HOME" not in os.environ:
    user_cache = os.path.expanduser("~/.cache")
    try:
        os.makedirs(user_cache, exist_ok=True)
        test_file = os.path.join(user_cache, ".permissions_test")
        with open(test_file, "w") as f:
            f.write("1")
        os.remove(test_file)
        os.environ["XDG_CACHE_HOME"] = user_cache
    except (PermissionError, OSError):
        tmp_cache = os.path.join(tempfile.gettempdir(), ".cache")
        os.makedirs(tmp_cache, exist_ok=True)
        os.environ["XDG_CACHE_HOME"] = tmp_cache

import hashlib
import math
import chromadb
from chromadb.config import Settings
from chromadb.api.types import EmbeddingFunction, Documents, Embeddings
from core.chunker import DocumentChunk
from core.bm25 import BM25Index, reciprocal_rank_fusion


class FastLightweightEmbeddingFunction(EmbeddingFunction):
    """Zero-memory 384-dim normalized hashing embedding function for restricted RAM containers (512MB free tier)."""
    def __call__(self, input: Documents) -> Embeddings:
        embeddings = []
        for text in input:
            vec = [0.0] * 384
            words = text.lower().split()
            for w in words:
                h = int(hashlib.sha256(w.encode("utf-8")).hexdigest(), 16)
                idx = h % 384
                val = 1.0 if (h % 2 == 0) else -1.0
                vec[idx] += val
            norm = math.sqrt(sum(v * v for v in vec)) or 1.0
            embeddings.append([v / norm for v in vec])
        return embeddings


class VectorStore:
    """Manages document embeddings and semantic/hybrid retrieval using ChromaDB & BM25."""

    def __init__(self, persist_dir: Optional[str] = "./.chroma_db", collection_name: str = "phoenix_knowledge_base"):
        self.persist_dir = persist_dir
        self.collection_name = collection_name
        self.bm25: Optional[BM25Index] = None
        self.client: Optional[Any] = None
        self._collection: Optional[Any] = None

    @property
    def collection(self):
        """Lazy-loaded ChromaDB collection to ensure fast container startup within 512MB RAM."""
        if self._collection is None:
            if self.persist_dir:
                Path(self.persist_dir).mkdir(parents=True, exist_ok=True)
                self.client = chromadb.PersistentClient(
                    path=self.persist_dir,
                    settings=Settings(anonymized_telemetry=False)
                )
            else:
                self.client = chromadb.Client(settings=Settings(anonymized_telemetry=False))

            use_fast = os.getenv("USE_LIGHTWEIGHT_EMBEDDINGS", "true").lower() in ("true", "1", "yes") or os.getenv("FORCE_MOCK", "false").lower() in ("true", "1", "yes")
            ef = FastLightweightEmbeddingFunction() if use_fast else None

            try:
                self._collection = self.client.get_or_create_collection(
                    name=self.collection_name,
                    embedding_function=ef,
                    metadata={"hnsw:space": "cosine"}
                )
            except ValueError:
                try:
                    self._collection = self.client.get_collection(
                        name=self.collection_name,
                        embedding_function=ef
                    )
                except Exception:
                    self._collection = self.client.get_collection(name=self.collection_name)
            if self.bm25 is None and self._collection.count() > 0:
                self._init_bm25_from_collection()
        return self._collection

    def _init_bm25_from_collection(self):
        """Builds in-memory BM25 index from persistent ChromaDB collection."""
        data = self.collection.get()
        if not data or not data["ids"]:
            self.bm25 = None
            return

        chunks: List[DocumentChunk] = []
        for cid, doc, meta in zip(data["ids"], data["documents"], data["metadatas"]):
            chunks.append(
                DocumentChunk(
                    chunk_id=cid,
                    doc_name=meta.get("source", "doc"),
                    chunk_index=meta.get("chunk_index", 0),
                    content=doc,
                    start_char=meta.get("start_char", 0),
                    end_char=meta.get("end_char", len(doc)),
                    metadata=meta
                )
            )
        self.bm25 = BM25Index(chunks)

    def count(self) -> int:
        """Returns the number of documents in the collection without forcing heavy ONNX model loading at startup."""
        if self._collection is None:
            if self.persist_dir and Path(self.persist_dir).exists():
                try:
                    c = chromadb.PersistentClient(path=self.persist_dir, settings=Settings(anonymized_telemetry=False))
                    cols = [col.name for col in c.list_collections()]
                    if self.collection_name not in cols:
                        return 0
                except Exception:
                    return 0
            else:
                return 0
        return self.collection.count()

    def clear(self):
        """Removes the existing collection and creates a fresh one."""
        self.client.delete_collection(name=self.collection_name)
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"}
        )
        self.bm25 = None

    def add_chunks(self, chunks: List[DocumentChunk], batch_size: int = 100):
        """Indexes DocumentChunk objects into ChromaDB and builds the BM25 index."""
        if not chunks:
            return

        for i in range(0, len(chunks), batch_size):
            batch = chunks[i:i + batch_size]
            ids = [c.chunk_id for c in batch]
            documents = [c.content for c in batch]
            metadatas = [
                {
                    "source": str(c.metadata.get("source", c.doc_name)),
                    "chunk_index": int(c.chunk_index),
                    "start_char": int(c.start_char),
                    "end_char": int(c.end_char)
                }
                for c in batch
            ]
            self.collection.upsert(
                ids=ids,
                documents=documents,
                metadatas=metadatas
            )

        # Build in-memory BM25 sparse index
        self.bm25 = BM25Index(chunks)

    def dense_query(self, query_text: str, top_k: int = 4) -> List[Dict[str, Any]]:
        """Executes pure dense semantic cosine retrieval against ChromaDB."""
        if self.count() == 0:
            return []

        results = self.collection.query(
            query_texts=[query_text],
            n_results=min(top_k, self.count())
        )

        formatted_results: List[Dict[str, Any]] = []
        if not results or not results["ids"] or not results["ids"][0]:
            return formatted_results

        ids = results["ids"][0]
        docs = results["documents"][0] if results["documents"] else []
        metas = results["metadatas"][0] if results["metadatas"] else []
        distances = results["distances"][0] if results.get("distances") else [0.0] * len(ids)

        for chunk_id, doc, meta, dist in zip(ids, docs, metas, distances):
            similarity = round(1.0 - dist, 4) if dist is not None else 1.0
            formatted_results.append({
                "chunk_id": chunk_id,
                "content": doc,
                "metadata": meta,
                "distance": dist,
                "similarity": similarity
            })

        return formatted_results

    def sparse_query(self, query_text: str, top_k: int = 4) -> List[Dict[str, Any]]:
        """Executes pure sparse lexical BM25 retrieval."""
        if not self.bm25 or self.count() == 0:
            return []

        raw_results = self.bm25.search(query_text, top_k=top_k)
        formatted: List[Dict[str, Any]] = []
        for chunk, score in raw_results:
            formatted.append({
                "chunk_id": chunk.chunk_id,
                "content": chunk.content,
                "metadata": {
                    "source": chunk.metadata.get("source", chunk.doc_name),
                    "chunk_index": chunk.chunk_index
                },
                "bm25_score": round(score, 4),
                "similarity": 0.0
            })
        return formatted

    def query(self, query_text: str, top_k: int = 4, mode: str = "hybrid") -> List[Dict[str, Any]]:
        """Queries knowledge base using dense, sparse, or hybrid (RRF) retrieval."""
        if self.count() == 0:
            return []

        if mode == "dense" or self.bm25 is None:
            return self.dense_query(query_text, top_k=top_k)

        if mode == "sparse":
            return self.sparse_query(query_text, top_k=top_k)

        # Hybrid RRF: Cormack constant k=60
        candidate_k = max(top_k * 2, 8)
        dense_hits = self.dense_query(query_text, top_k=candidate_k)
        sparse_hits = self.bm25.search(query_text, top_k=candidate_k)

        return reciprocal_rank_fusion(
            dense_results=dense_hits,
            sparse_results=sparse_hits,
            rrf_k=60,
            top_k=top_k
        )
