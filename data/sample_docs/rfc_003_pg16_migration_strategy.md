# RFC-003: Zero-Downtime Migration Strategy to PostgreSQL 16

**Author:** Charlie Kim & Bob Martinez  
**Status:** In Review  
**Date:** February 12, 2026  

## Background
Our production workload runs on PostgreSQL 14.10. PostgreSQL 16 introduces major enhancements in query parallelism, logical replication bi-directional support, and vacuum cost limit optimization.

## Migration Steps
1. **Logical Replication Setup:** Establish a PostgreSQL 16 target cluster and configure pglogical replication from the PG 14 source.
2. **Schema & Index Sync:** Apply schema v4.2 with composite tenant indexes.
3. **Dual-Read Validation:** Shadow 5% of read queries to the PG 16 cluster to detect query plan anomalies.
4. **Cutover Window (Scheduled March 12, 02:00 UTC):**
   - Drain active HTTP writes (pause incoming write endpoints for ~30 seconds).
   - Verify zero replication lag (`pg_stat_replication`).
   - Switch DNS CNAME for primary database endpoint.
   - Re-enable write endpoints.
5. **Rollback Contingency:** Reverse replication channel established from PG 16 back to PG 14 for 24 hours post-cutover.
