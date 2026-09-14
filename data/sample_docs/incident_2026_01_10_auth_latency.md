# Incident Postmortem: Auth Service Latency Spike (2026-01-10)

**Date of Incident:** January 10, 2026  
**Severity:** SEV-2  
**Incident Commander:** Alice Johnson  
**Primary Responder:** Bob Martinez  
**Duration:** 42 minutes (14:18 UTC – 15:00 UTC)  

## Impact
- 12.4% of login requests experienced p99 latencies exceeding 4,500ms (normal: 120ms).
- Approximately 1,400 user sessions failed with HTTP 504 Gateway Timeout.
- No data corruption or unauthorized access occurred.

## Root Cause
A surge in automated third-party API client authentications triggered an un-cached database query on the `api_keys` table. The table was missing an index on `(hashed_key, revoked_at)`, causing full sequential scans on every incoming request when the cache expired.

## Timeline
- **14:18 UTC:** Alert triggered: `HighLatenciesAuthCluster` (> 2s for 3m).
- **14:24 UTC:** Bob acknowledged alert and checked database active queries in pg_stat_activity.
- **14:31 UTC:** Identified long-running sequential scans on `api_keys`.
- **14:40 UTC:** Applied hotfix index `idx_api_keys_hash_revoked` concurrently in production.
- **14:48 UTC:** Database CPU dropped from 94% to 11%. Latency normalized to 115ms.
- **15:00 UTC:** Incident closed after monitoring error rates.

## Action Items
- **INC-101 (Bob):** Audit all query plans for authentication lookups; ensure composite indexes exist.
- **INC-102 (Charlie):** Add automated rate limiting on `/api/v1/auth/tokens` to cap bursts at 500 req/min per IP.
- **INC-103 (Alice):** Document index review criteria in Engineering Onboarding Runbook.
