# Monitoring, Metrics & Prometheus Alerting Thresholds

**Owner:** Charlie Kim (DevOps)  
**Cluster:** Phoenix Production (AWS EKS)  

## Key Prometheus Alert Rules
1. `HighHTTP5xxRate`:
   - Expression: `sum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m])) > 0.01`
   - Severity: SEV-1 if > 0.05, SEV-2 if > 0.01.
2. `AuthLatencyP99High`:
   - Expression: `histogram_quantile(0.99, rate(http_request_duration_seconds_bucket{service="auth"}[5m])) > 1.5`
   - Severity: SEV-2.
3. `PostgresReplicationLagHigh`:
   - Expression: `pg_replication_lag_bytes > 50000000` (50MB) for > 3 minutes.
   - Severity: SEV-2.
4. `RedisMemoryUtilization`:
   - Expression: `redis_memory_used_bytes / redis_memory_max_bytes > 0.85`
   - Severity: SEV-2.
