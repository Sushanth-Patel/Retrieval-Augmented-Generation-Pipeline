# Incident Postmortem: Unexpected PostgreSQL Standby Failover (2026-02-14)

**Date of Incident:** February 14, 2026  
**Severity:** SEV-1  
**Incident Commander:** Charlie Kim  
**Primary Responder:** Charlie Kim & Bob Martinez  
**Duration:** 18 minutes (08:12 UTC – 08:30 UTC)  

## Impact
- 100% of write requests to the primary database failed for 4 minutes during DNS promotion.
- Read replicas served stale reads during the split-brain detection window.
- 34 transactions were rolled back and returned HTTP 500 to end users.

## Root Cause
An underlying hypervisor node hardware degradation in AWS us-east-1 led to intermittent network packet drops (>40% loss). The Patroni cluster orchestrator detected 3 missed heartbeats from the leader and initiated an automatic failover to the designated standby in us-east-1b. However, the connection pooler (PgBouncer) held stale TCP sockets for 180 seconds due to missing `keepalives_idle` parameters.

## Timeline
- **08:12 UTC:** Network degradation on primary DB host.
- **08:14 UTC:** Patroni promoted standby `pg-replica-02` to leader.
- **08:16 UTC:** PgBouncer continued attempting writes to dead primary because TCP keepalive timed out after 300 seconds default.
- **08:20 UTC:** Charlie manually restarted PgBouncer pods, forcing immediate DNS re-resolution to the new leader.
- **08:25 UTC:** Writes resumed successfully; error rate returned to 0%.
- **08:30 UTC:** Cluster health verified; incident stood down.

## Action Items
- **INC-201 (Charlie):** Configure PgBouncer TCP keepalive: `tcp_keepidle = 10`, `tcp_keepintvl = 5`, `tcp_keepcnt = 3`.
- **INC-202 (Bob):** Implement application-level exponential backoff with jitter on SQL connection retry handlers.
- **INC-203 (Charlie):** Schedule chaos engineering drill for database failover in staging environment by March 1.
