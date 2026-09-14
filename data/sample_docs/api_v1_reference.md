# API v1 REST Endpoint Reference

**Base URL:** `https://api.phoenix-corp.io/v1`  
**Authentication:** Bearer JWT Token  

## Endpoints

### 1. `POST /auth/login`
- **Request Body:** `{"email": "user@example.com", "password": "..."}`
- **Response:** `{"token": "...", "expires_in": 3600}`

### 2. `POST /auth/revoke-session`
- **Headers:** `Authorization: Bearer <token>`
- **Response:** `{"revoked": true, "timestamp": "2026-03-01T12:00:00Z"}`

### 3. `GET /tenants/current`
- **Response:** `{"id": "uuid", "slug": "acme-corp", "tier": "enterprise"}`

### 4. `POST /admin/tenants/{id}/archive` (MUTATING / SENSITIVE)
- **Requires:** `role: superadmin`
- **Confirmation:** Requires secondary confirmation code header `X-Confirm-Destructive: YES`
