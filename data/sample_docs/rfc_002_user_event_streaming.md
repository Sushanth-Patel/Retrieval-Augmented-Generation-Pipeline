# RFC-002: User Event Streaming Architecture with Apache Kafka

**Author:** Alice Johnson  
**Status:** Approved  
**Date:** February 8, 2026  
**Target Delivery:** Sprint 25  

## Summary
Define an asynchronous event bus to decouple transaction processing from downstream notifications, audit logs, and search indexing.

## Architecture
- **Message Broker:** AWS MSK (Managed Streaming for Apache Kafka) running Kafka 3.6.
- **Partitioning Strategy:** Events partitioned by `tenant_id` to guarantee in-order delivery per tenant.
- **Key Topics:**
  - `user.events.auth`: Login, logout, session revocation events.
  - `tenant.events.billing`: Plan upgrades, invoice generations.
  - `system.events.audit`: Sensitive administrative operations.

## Guarantees
- At-least-once delivery with idempotent consumer handlers using deduplication keys in Redis (24-hour expiration window).
- End-to-end event propagation latency SLA: < 250ms p95.
