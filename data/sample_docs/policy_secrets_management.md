# Policy: Secrets Management & Key Rotation

**Owner:** Frank Castle (Security)  
**Effective Date:** February 1, 2026  

## Guiding Rule
Hardcoded credentials, API keys, private keys, or passwords in Git repositories are strictly prohibited. Pre-commit hooks via `git-secrets` enforce this rule.

## Secrets Storage
All production secrets must reside in AWS Secrets Manager or HashiCorp Vault.
- Dynamic credentials must be used for database access (short-lived 1-hour credentials).
- KMS Customer Managed Keys (CMK) must be rotated automatically every 365 days.

## Incident Remediation for Leaked Secrets
If an API key is inadvertently committed:
1. Revoke the key immediately in the provider console.
2. Invalidate active sessions tied to that key.
3. Purge Git history using BFG Repo-Cleaner or git-filter-repo.
4. Notify the Security Incident Commander (Frank Castle).
