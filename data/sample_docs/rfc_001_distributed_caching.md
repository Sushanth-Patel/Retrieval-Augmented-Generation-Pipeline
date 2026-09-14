# RFC-001: Distributed Caching Strategy for Session & Metadata

**Author:** Alice Johnson  
**Status:** Approved  
**Date:** January 20, 2026  
**Target Delivery:** Sprint 24  

## Context & Problem Statement
Currently, user session tokens and tenant metadata are queried directly against PostgreSQL on every HTTP request. As our active user count crosses 150,000 DAU, database read IOPS have reached 80% saturation during business hours.

## Proposed Solution
Deploy an in-memory Redis 7.2 cluster (3 shards with 1 replica each).
- **Read Path:** Check Redis first using key pattern `session:{session_id}`. If cache hit, return immediately.
- **Write Path:** Write-through cache with a 24-hour TTL.
- **Cache Stampede Protection:** Use mutual exclusion locks (singleflight) during cache miss re-computation.

## Alternatives Considered
- **Memcached:** Lacks replication and persistence mechanisms needed for rapid recovery without cold-cache database spikes.
- **Local in-process LRU cache:** Leads to consistency drift across auto-scaled container pods.

## Security & Compliance
All cached session data must be encrypted in transit using TLS 1.3. Tenant isolation must be strictly enforced via prefixed namespaces.
