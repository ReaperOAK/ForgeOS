"""ForgeOS Authentication — agent API keys and operator token auth.

Provides API key authentication for agents and JWT-based token
authentication for human operators.

Public API
----------
Agent auth (FORGEOS-BE051):
- :class:`AgentIdentity` — authenticated agent descriptor.
- :class:`AuthenticationError` — raised on invalid/expired/revoked keys.
- :func:`validate_api_key` — validate a key and return agent identity.
- :func:`generate_api_key` — create a new API key for an agent.
- :func:`hash_api_key` — SHA-256 hash a raw API key.

Operator auth (FORGEOS-BE053):
- :class:`OperatorIdentity` — authenticated operator descriptor.
- :class:`OperatorAuthenticationError` — base operator auth error.
- :class:`TokenExpiredError` — JWT token has expired.
- :class:`TokenInvalidError` — JWT token is invalid or malformed.
- :class:`TokenPayload` — decoded JWT payload.
- :func:`hash_password` — bcrypt password hashing.
- :func:`verify_password` — bcrypt password verification.
- :func:`generate_token` — generate JWT for operator.
- :func:`validate_token` — validate and decode JWT.
- :func:`extract_operator_identity` — extract identity from token.
- :func:`refresh_token` — refresh a valid JWT.
- :func:`extract_bearer_token` — parse Authorization header.

.. meta::
   :ticket: FORGEOS-BE051, FORGEOS-BE053
   :last_reviewed: 2026-03-10T00:00:00Z
"""

from mcp_server.auth.agent_auth import (
    AgentIdentity,
    AuthenticationError,
    generate_api_key,
    hash_api_key,
    validate_api_key,
)
from mcp_server.auth.operator_auth import (
    OperatorAuthenticationError,
    OperatorIdentity,
    TokenExpiredError,
    TokenInvalidError,
    TokenPayload,
    extract_bearer_token,
    extract_operator_identity,
    generate_token,
    hash_password,
    refresh_token,
    validate_token,
    verify_password,
)

__all__ = [
    # Agent auth
    "AgentIdentity",
    "AuthenticationError",
    "generate_api_key",
    "hash_api_key",
    "validate_api_key",
    # Operator auth
    "OperatorAuthenticationError",
    "OperatorIdentity",
    "TokenExpiredError",
    "TokenInvalidError",
    "TokenPayload",
    "extract_bearer_token",
    "extract_operator_identity",
    "generate_token",
    "hash_password",
    "refresh_token",
    "validate_token",
    "verify_password",
]
