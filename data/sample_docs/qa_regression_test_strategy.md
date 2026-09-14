# QA Regression Testing & Quality Assurance Plan

**Owner:** Grace Hopper (Lead QA)  
**Effective Date:** January 18, 2026  

## Automated Test Pyramid
1. **Unit Tests (Jest & Pytest):** Fast execution (< 90 seconds). Must achieve > 85% branch coverage.
2. **Integration Tests (Docker Compose):** Tests API endpoints against live PostgreSQL and Redis instances.
3. **End-to-End System Tests (Playwright & k6):**
   - Nightly load soak tests (simulating 10k concurrent users).
   - Multi-hop transaction integrity tests across Kafka workers.

## Quality Gates
- No pull request is merged if automated tests fail or coverage regresses by > 0.5%.
- Security SAST scan (Trivy and Semgrep) must report zero critical or high severity vulnerabilities.
