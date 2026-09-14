# Database Schema Documentation: PostgreSQL v4.2

**Database:** `phoenix_production`  
**Engine:** PostgreSQL 16.2  
**Owner:** Bob Martinez  
**Last Updated:** February 21, 2026  

## Core Tables

### 1. `tenants`
- `id` (UUID, Primary Key)
- `slug` (VARCHAR(64), Unique)
- `plan_tier` (VARCHAR(32), Default 'standard')
- `created_at` (TIMESTAMPTZ)
- `status` (VARCHAR(20), Default 'active')

### 2. `users`
- `id` (UUID, Primary Key)
- `tenant_id` (UUID, Foreign Key -> tenants.id)
- `email` (VARCHAR(255), Unique)
- `password_hash` (TEXT)
- `role` (VARCHAR(32), Default 'member')
- `last_login_at` (TIMESTAMPTZ)

### 3. `sessions`
- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key -> users.id)
- `token_hash` (VARCHAR(64), Indexed)
- `expires_at` (TIMESTAMPTZ)
- `ip_address` (INET)
- `revoked` (BOOLEAN, Default false)

### 4. `audit_logs`
- `id` (BIGSERIAL, Primary Key)
- `tenant_id` (UUID)
- `actor_id` (UUID)
- `action` (VARCHAR(128))
- `payload` (JSONB)
- `created_at` (TIMESTAMPTZ, Partitioned by month)
