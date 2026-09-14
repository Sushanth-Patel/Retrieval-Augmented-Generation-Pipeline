# Policy: Enterprise Data Retention & Customer Privacy

**Owner:** Frank Castle (Security & Compliance)  
**Classification:** Internal Confidential  
**Effective Date:** January 1, 2026  

## Data Classification Tiers
1. **Tier 1 (Public):** Marketing pages, public documentation.
2. **Tier 2 (Internal):** Architecture diagrams, sprint notes, RFCs.
3. **Tier 3 (Confidential / PII):** Customer contact details, IP logs, user email addresses.
4. **Tier 4 (Restricted):** Passwords (salted hashes only), cryptographic private keys, payment tokens.

## Retention Periods
- User access logs: 90 days in warm storage, 365 days in cold archive.
- Audit logs: 7 years immutable storage.
- Deleted account data: Hard deleted within 30 calendar days following GDPR "Right to be Forgotten".

## PII Masking Mandate
Any automated AI agent or search tool serving general internal queries must redact Personally Identifiable Information (PII) including email addresses, phone numbers, and Social Security Numbers from user-facing responses.
