# RFC-006: Enterprise Knowledge Search via RAG & Vector Embeddings

**Author:** Alice Johnson  
**Status:** Approved  
**Date:** March 1, 2026  

## Objective
Enable contextual search across internal documentation, meeting records, and incident reports to empower on-call engineers and developers.

## Pipeline Architecture
1. **Document Ingestion:** Markdown documents and Notion exports parsed, cleaned, and split into chunks of 500 characters with 50-character overlap.
2. **Embedding Model:** Dense vector representations using `text-embedding-3-small` or local embedding models.
3. **Vector Store:** ChromaDB instance for fast cosine-similarity indexing and metadata filtering.
4. **Retrieval & Guardrails:** Top-k semantic chunk search combined with prompt-injection screening and PII sanitization.
5. **Agentic Orchestration:** Multi-hop query decomposition to answer complex questions across distributed project records.
