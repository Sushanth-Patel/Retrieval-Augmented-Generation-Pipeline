# Runbook: Production Deployment & Canary Verification

**Owner:** Charlie Kim  
**Status:** Active  
**Effective Date:** January 5, 2026  

## Deployment Pipeline Overview
All production code deployments follow a strict automated canary rollout process via ArgoCD.

## Pre-requisites
1. All PRs must have at least 2 approvals (including 1 Tech Lead approval).
2. GitHub Actions CI test suite and security vulnerability scans must be 100% passing.
3. No active SEV-1 or SEV-2 incidents.

## Rollout Stages
- **Canary (5% traffic):** Deployed to 2 pods. Monitored for 15 minutes. Error rate threshold: < 0.05%.
- **Stage 2 (25% traffic):** Monitored for 30 minutes.
- **Stage 3 (100% traffic):** Full cutover across all regional clusters.

## Emergency Rollback
To abort a release immediately:
```bash
argocd app rollback phoenix-production --prune
```
Canary traffic drops to 0% and previous stable replica set handles all incoming requests.
