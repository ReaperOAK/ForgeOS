"""ForgeOS Agent Authentication — API key validation and identity resolution.

Provides API key authentication for the MCP server, including key
generation, SHA-256 hashed storage, validation against PostgreSQL,
per-agent rate limiting, and audit logging of authentication attempts.

Public API
----------
- :class:`AgentIdentity` — authenticated agent descriptor.
- :class:`AuthenticationError` — raised on invalid/expired/revoked keys.
- :func:`validate_api_key` — validate a key and return agent identity.
- :func:`generate_api_key` — create a new API key for an agent.
- :func:`hash_api_key` — SHA-256 hash a raw API key.

.. meta::
   :ticket: FORGEOS-BE051
   :last_reviewed: 2026-03-10T00:00:00Z
"""

from mcp_server.auth.agent_auth import (
    AgentIdentity,
    AuthenticationError,
    generate_api_key,
    hash_api_key,
    validate_api_key,
)

__all__ = [
    "AgentIdentity",
    "AuthenticationError",
    "generate_api_key",
    "hash_api_key",
    "validate_api_key",
]
