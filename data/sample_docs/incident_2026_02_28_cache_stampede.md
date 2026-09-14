# Incident Postmortem: Cache Stampede on Tenant Metadata Service (2026-02-28)

**Date of Incident:** February 28, 2026  
**Severity:** SEV-2  
**Incident Commander:** Alice Johnson  
**Primary Responder:** Bob Martinez  
**Duration:** 27 minutes (19:05 UTC – 19:32 UTC)  

## Impact
- Metadata lookup latency jumped from 4ms to 1,200ms for enterprise tenants.
- 5 enterprise customers experienced partial dashboard load failures.
- Postgres read connection pool reached maximum capacity (200/200 active connections).

## Root Cause
A scheduled deployment triggered a bulk cache invalidation of tenant feature flags. Because 8,000 concurrent client requests arrived simultaneously for the invalidated key without probabilistic early expiration or singleflight mutexes, every client hit the primary Postgres database directly (cache stampede / thundering herd problem).

## Timeline
- **19:05 UTC:** Deployment completed; feature flag cache purged.
- **19:07 UTC:** Postgres CPU spiked to 99%; PgBouncer queued 450 client connections.
- **19:15 UTC:** Bob enabled emergency query throttling for metadata queries.
- **19:22 UTC:** Manually warmed the top 50 tenant configuration entries in Redis.
- **19:28 UTC:** Postgres CPU dropped to 22%; query latency dropped back to sub-5ms.
- **19:32 UTC:** Incident closed.

## Action Items
- **INC-301 (Bob):** Implement singleflight request collapsing (Golang/Python mutex per key) so only one backend query executes on cache miss.
- **INC-302 (Alice):** Add XFetch probabilistic early expiration (jittered TTL) to tenant cache keys.
- **INC-303 (Charlie):** Set alert for `RedisCacheMissRateSpike` (>40% increase within 60 seconds).
