# RFC-005: SOC2 Compliance & Immutable Audit Logging

**Author:** Frank Castle (Security)  
**Status:** Approved  
**Date:** February 24, 2026  

## Compliance Requirements
Under SOC2 Type II Trust Criteria CC6.8 and GDPR Article 30, all tenant data modifications and privileged operations must generate tamper-proof audit trails.

## Architecture & Storage
- **Log Format:** Structured JSON conforming to CloudEvents 1.0 specifications.
- **Mandatory Fields:** `event_id`, `timestamp`, `actor_id`, `actor_role`, `action`, `resource_id`, `ip_address`, `client_agent`.
- **Storage Target:** Encrypted AWS S3 bucket with Object Lock enabled in Compliance Mode (retention period: 7 years).
- **Redaction Requirement:** Passwords, API tokens, credit card numbers, and PII must be masked before emission into the event stream.
