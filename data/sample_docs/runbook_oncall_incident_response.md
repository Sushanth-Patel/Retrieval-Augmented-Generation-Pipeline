# Runbook: On-Call Incident Management & Escalation

**Audience:** All Engineering Team Members  
**Last Updated:** January 12, 2026  
**Owner:** Charlie Kim (DevOps)  

## Severity Levels
- **SEV-1 (Critical Outage):** Core product unavailable for > 5% of users. Response SLA: 5 minutes.
- **SEV-2 (Major Degradation):** Elevated latency or specific feature failure with workaround. Response SLA: 15 minutes.
- **SEV-3 (Minor Bug / Glitch):** Non-blocking issue. Response SLA: next business day.

## Escalation Path
1. **Primary On-Call Responder:** Acknowledges PagerDuty alert, creates Slack war-room `#incident-{date}-{slug}`.
2. **Secondary On-Call / Incident Commander:** If no ack in 10 minutes, PagerDuty automatically escalates to secondary.
3. **Engineering Lead (Alice Johnson):** Escalated if SEV-1 lasts longer than 30 minutes without active mitigation.
4. **Communications Lead (Diana Prince):** Updates public status page every 20 minutes during SEV-1.

## Mitigation Playbooks
- **High DB CPU:** Inspect `pg_stat_activity`. Kill slow queries exceeding 10s if non-essential.
- **High Redis Memory:** Run `redis-cli info memory`. Trigger eviction policy check or shard scaling.
