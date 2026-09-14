"""ChromaDB Vector Store wrapper for indexing and retrieval."""

from typing import List, Dict, Any, Optional
from pathlib import Path
import chromadb
from chromadb.config import Settings
from core.chunker import DocumentChunk


class VectorStore:
    """Manages document embeddings and top-k semantic retrieval using ChromaDB."""

    def __init__(self, persist_dir: Optional[str] = "./.chroma_db", collection_name: str = "phoenix_knowledge_base"):
        self.persist_dir = persist_dir
        self.collection_name = collection_name

        if persist_dir:
            Path(persist_dir).mkdir(parents=True, exist_ok=True)
            self.client = chromadb.PersistentClient(path=persist_dir)
        else:
            self.client = chromadb.Client()

        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"}
        )

    def count(self) -> int:
        """Returns the number of documents in the collection."""
        return self.collection.count()

    def clear(self):
        """Removes the existing collection and creates a fresh one."""
        self.client.delete_collection(name=self.collection_name)
        self.collection = self.client.get_or_create_collection(
            name=self.collection_name,
            metadata={"hnsw:space": "cosine"}
        )

    def add_chunks(self, chunks: List[DocumentChunk], batch_size: int = 100):
        """Indexes DocumentChunk objects into the ChromaDB collection."""
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

    def query(self, query_text: str, top_k: int = 4) -> List[Dict[str, Any]]:
        """Queries the vector store and returns top_k results with metadata and similarity scores."""
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
            # Chroma returns cosine distance (0 = identical, 1 = orthogonal, 2 = opposite).
            # Convert to similarity: 1 - dist
            similarity = round(1.0 - dist, 4) if dist is not None else 1.0
            formatted_results.append({
                "chunk_id": chunk_id,
                "content": doc,
                "metadata": meta,
                "distance": dist,
                "similarity": similarity
            })

        return formatted_results
