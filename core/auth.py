"""Authentication, API Key Validation, and User Session Context for Agentic RAG.

Provides minimal, production-grade identity control for internal team deployment:
1. API Key / Bearer token validation with constant-time comparison to prevent timing attacks.
2. Role-based permission checking (READ_ONLY vs. MUTATION_ALLOWED vs. ADMIN).
3. AuthenticatedUser context carrying user_id, email, roles, and session quotas.
"""

import os
import hmac
from typing import Dict, Any, List, Optional
from pydantic import BaseModel, Field


class AuthError(Exception):
    """Base exception for authentication and authorization failures."""
    pass


class InvalidCredentialsError(AuthError):
    """Raised when provided API key or token is missing, invalid, or expired."""
    pass


class PermissionDeniedError(AuthError):
    """Raised when user role is insufficient for the requested action."""
    pass


class AuthenticatedUser(BaseModel):
    """Represents an authenticated team member or client session."""
    user_id: str
    email: str
    roles: List[str] = Field(default_factory=lambda: ["reader"])
    rate_limit_rpm: Optional[int] = None
    rate_limit_tpm: Optional[int] = None

    def has_role(self, role: str) -> bool:
        return "admin" in self.roles or role in self.roles


class AuthManager:
    """Validates API keys and bearer tokens against configured team secrets.
    
    Keys can be configured via environment variables or loaded from a secure dictionary:
    - Default team API keys format: TEAM_API_KEYS="user1:key1:reader,user2:key2:admin"
    """

    def __init__(self, key_registry: Optional[Dict[str, Dict[str, Any]]] = None):
        self._registry: Dict[str, Dict[str, Any]] = {}
        if key_registry:
            self._registry.update(key_registry)
        else:
            self._load_from_env()

    def _load_from_env(self):
        """Loads configured keys from environment variables."""
        raw_keys = os.getenv("TEAM_API_KEYS", "")
        if raw_keys.strip():
            # Format: "alice:demo-team-alice-key:admin,bob:demo-team-bob-key:reader"
            for entry in raw_keys.split(","):
                parts = entry.strip().split(":")
                if len(parts) >= 3:
                    uid, key, role = parts[0], parts[1], parts[2]
                    self._registry[key] = {
                        "user_id": uid,
                        "email": f"{uid}@phoenix-corp.internal",
                        "roles": [r.strip() for r in role.split("|")]
                    }
        else:
            # Default internal team seed keys for testing & development
            self._registry = {
                "demo-team-admin-key-not-for-production": {
                    "user_id": "alice_admin",
                    "email": "alice@phoenix-corp.internal",
                    "roles": ["admin", "reader", "operator"]
                },
                "demo-team-engineer-key-not-for-production": {
                    "user_id": "bob_engineer",
                    "email": "bob@phoenix-corp.internal",
                    "roles": ["reader", "operator"]
                },
                "demo-team-readonly-key-not-for-production": {
                    "user_id": "charlie_intern",
                    "email": "charlie@phoenix-corp.internal",
                    "roles": ["reader"]
                }
            }

    def register_key(self, api_key: str, user_id: str, email: str, roles: List[str]):
        """Programmatically registers a new API key for a user."""
        self._registry[api_key] = {
            "user_id": user_id,
            "email": email,
            "roles": roles
        }

    def authenticate_token(self, auth_header_or_key: Optional[str]) -> AuthenticatedUser:
        """Validates bearer token or API key using constant-time comparison to prevent timing attacks."""
        if not auth_header_or_key:
            raise InvalidCredentialsError("Missing authentication token or API key.")

        token = auth_header_or_key.strip()
        if token.lower().startswith("bearer "):
            token = token[7:].strip()

        # Constant-time comparison across all registered keys
        matched_user_data = None
        for registered_key, user_data in self._registry.items():
            if hmac.compare_digest(token, registered_key):
                matched_user_data = user_data
                break

        if not matched_user_data:
            raise InvalidCredentialsError("Invalid or unauthorized API key / bearer token.")

        return AuthenticatedUser(
            user_id=matched_user_data["user_id"],
            email=matched_user_data["email"],
            roles=matched_user_data["roles"]
        )

    def enforce_permission(self, user: AuthenticatedUser, required_role: str):
        """Asserts that user possesses the required role or raises PermissionDeniedError."""
        if not user.has_role(required_role):
            raise PermissionDeniedError(
                f"User '{user.user_id}' lacks required role '{required_role}' (active roles: {user.roles})."
            )
