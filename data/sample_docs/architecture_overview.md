# Architecture Overview: Project Phoenix Microservices

**Last Modified:** March 2, 2026  
**Architect:** Alice Johnson  

## High-Level Topology
Project Phoenix comprises five core services communicating over gRPC internally and exposing REST APIs to the web:

1. **API Gateway (Envoy/Kong):** Handles TLS termination, mTLS service mesh verification, rate limiting, and initial JWT validation.
2. **Auth Service (Go):** Manages user authentication, OAuth2 / OIDC token generation, and multi-factor authentication.
3. **Tenant Service (Python/FastAPI):** Stores organization metadata, billing subscriptions, and feature entitlement flags.
4. **Data Ingestion Worker (Rust):** Asynchronously ingests high-throughput telemetry from Kafka topics.
5. **Search & Intelligence Service (Python):** Powers vector indexing, semantic search, and RAG capabilities over internal documentation.

## Storage Tier
- **Relational DB:** PostgreSQL 16 on AWS Aurora Multi-AZ.
- **Cache:** Redis 7.2 Cluster (3 shards).
- **Object Storage:** AWS S3 with KMS encryption.
- **Vector DB:** ChromaDB for embedded knowledge bases.
