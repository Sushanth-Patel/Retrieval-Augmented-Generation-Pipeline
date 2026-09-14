# RFC-004: Global API Rate Limiting & Abuse Prevention

**Author:** Bob Martinez  
**Status:** Approved  
**Date:** January 28, 2026  

## Motivation
Following Incident 2026-01-10, an edge rate limiting solution is needed to shield authentication and high-cost reporting endpoints from accidental or malicious distributed overload.

## Rate Limiting Rules
1. **Unauthenticated Public Endpoints (`/api/v1/auth/*`):**
   - 60 requests per minute per IP.
   - Burst allowance of 10 requests.
2. **Authenticated API Key Endpoints (`/api/v1/data/*`):**
   - Standard Tier: 1,200 requests/minute per tenant.
   - Enterprise Tier: 10,000 requests/minute per tenant.
3. **Internal Administrative Endpoints:**
   - IP-allowlisted via VPN; 300 requests/minute.

## Implementation Details
Token bucket algorithm backed by Redis with atomic Lua scripts. HTTP 429 response includes `Retry-After` and `X-RateLimit-Remaining` headers.
