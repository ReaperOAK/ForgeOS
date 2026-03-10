"""Agent API key authentication for the ForgeOS MCP Server.

Implements API key validation, generation, hashing, per-agent rate
limiting, and audit logging.  Keys are stored as SHA-256 hashes in the
``api_keys`` table and looked up via a prefix index for efficient
matching.

Architecture
------------
* **SHA-256 hashing** — keys are hashed with :mod:`hashlib` before
  storage.  Raw keys are never persisted.
* **Prefix-based lookup** — the first 8 characters of the hex-encoded
  key are stored as ``key_prefix`` for indexed lookups, avoiding a
  full table scan on every auth request.
* **Rate limiting** — a lightweight in-memory token bucket per agent
  prevents brute-force attacks.  The bucket refills at a configurable
  rate and is keyed by the raw key prefix.
* **Audit logging** — every authentication attempt (success or failure)
  is logged via the structured logger with correlation ID context.
* **Typed identity** — on success, returns an :class:`AgentIdentity`
  dataclass containing ``agent_id``, ``agent_name``, and ``role``.

Security
--------
* Raw API keys are 32-byte random values, hex-encoded to 64 characters,
  prefixed with ``fgos_`` for easy identification (total 69 chars).
* Keys are validated in constant-time via :func:`hmac.compare_digest`.
* Failed attempts are logged with the key prefix only — never the full key.

.. meta::
   :ticket: FORGEOS-BE051
   :last_reviewed: 2026-03-10T00:00:00Z
"""

from __future__ import annotations

import hashlib
import hmac
import os
import time
from dataclasses import dataclass, field
from typing import Any

from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS, ForgeOSError

logger = get_logger("auth")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

API_KEY_PREFIX = "fgos_"
"""All ForgeOS API keys start with this prefix for identification."""

API_KEY_BYTE_LENGTH = 32
"""Number of random bytes used to generate a key (64 hex characters)."""

DEFAULT_RATE_LIMIT = 60
"""Maximum authentication attempts per minute per key prefix."""

DEFAULT_RATE_WINDOW_SECONDS = 60.0
"""Window size in seconds for the rate limiter."""


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AgentIdentity:
    """Authenticated agent descriptor returned on successful validation.

    Attributes
    ----------
    agent_id : str
        UUID of the agent record.
    agent_name : str
        Human-readable agent name (e.g. ``"Backend"``).
    role : str
        Agent role (e.g. ``"backend"``, ``"qa"``).
    permissions : list[str]
        List of permission strings from the agent record.
    """

    agent_id: str
    agent_name: str
    role: str
    permissions: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class AuthenticationError(ForgeOSError):
    """Raised when API key validation fails.

    Maps to JSON-RPC error code ``-32602`` (invalid params) in MCP
    responses, with HTTP-equivalent status ``401``.
    """

    error_code: int = INVALID_PARAMS
    status_code: int = 401


# ---------------------------------------------------------------------------
# Hashing
# ---------------------------------------------------------------------------


def hash_api_key(raw_key: str) -> str:
    """Compute the SHA-256 hex digest of *raw_key*.

    Parameters
    ----------
    raw_key : str
        The full plaintext API key (including the ``fgos_`` prefix).

    Returns
    -------
    str
        Lowercase hex-encoded SHA-256 hash.
    """
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _extract_prefix(raw_key: str) -> str:
    """Extract the lookup prefix from a raw API key.

    The prefix is the first 8 hex characters after stripping the
    ``fgos_`` header.
    """
    body = raw_key.removeprefix(API_KEY_PREFIX)
    return body[:8]


# ---------------------------------------------------------------------------
# Key generation
# ---------------------------------------------------------------------------


def generate_api_key() -> tuple[str, str, str]:
    """Generate a new random API key, its hash, and prefix.

    Returns
    -------
    tuple[str, str, str]
        ``(raw_key, key_hash, key_prefix)`` — the raw key must be
        shown to the operator exactly once; only the hash and prefix
        are persisted.
    """
    random_bytes = os.urandom(API_KEY_BYTE_LENGTH)
    hex_part = random_bytes.hex()
    raw_key = f"{API_KEY_PREFIX}{hex_part}"
    key_hash = hash_api_key(raw_key)
    key_prefix = hex_part[:8]
    return raw_key, key_hash, key_prefix


# ---------------------------------------------------------------------------
# Rate limiter — in-memory token bucket per key prefix
# ---------------------------------------------------------------------------


@dataclass
class _RateBucket:
    """Token bucket for a single key prefix."""

    tokens: float
    last_refill: float
    max_tokens: int
    refill_rate: float  # tokens per second


class RateLimiter:
    """Per-prefix sliding-window rate limiter.

    Parameters
    ----------
    max_requests : int
        Maximum requests allowed per window.
    window_seconds : float
        Duration of the sliding window in seconds.
    """

    def __init__(
        self,
        max_requests: int = DEFAULT_RATE_LIMIT,
        window_seconds: float = DEFAULT_RATE_WINDOW_SECONDS,
    ) -> None:
        self._max_requests = max_requests
        self._window_seconds = window_seconds
        self._refill_rate = max_requests / window_seconds
        self._buckets: dict[str, _RateBucket] = {}

    def check(self, key_prefix: str) -> bool:
        """Return ``True`` if the request is allowed, ``False`` if rate-limited.

        Parameters
        ----------
        key_prefix : str
            The 8-character prefix identifying the key.
        """
        now = time.monotonic()
        bucket = self._buckets.get(key_prefix)

        if bucket is None:
            self._buckets[key_prefix] = _RateBucket(
                tokens=self._max_requests - 1,
                last_refill=now,
                max_tokens=self._max_requests,
                refill_rate=self._refill_rate,
            )
            return True

        # Refill tokens based on elapsed time
        elapsed = now - bucket.last_refill
        bucket.tokens = min(
            bucket.max_tokens,
            bucket.tokens + elapsed * bucket.refill_rate,
        )
        bucket.last_refill = now

        if bucket.tokens >= 1.0:
            bucket.tokens -= 1.0
            return True
        return False

    def reset(self) -> None:
        """Clear all rate limit state (for testing)."""
        self._buckets.clear()


# Module-level rate limiter instance
_rate_limiter = RateLimiter()


def get_rate_limiter() -> RateLimiter:
    """Return the module-level rate limiter instance."""
    return _rate_limiter


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


async def validate_api_key(
    db_pool: Any,
    raw_key: str,
) -> AgentIdentity:
    """Validate an API key and return the authenticated agent identity.

    Performs prefix-based lookup in the ``api_keys`` table, then
    constant-time hash comparison, rate limiting, and audit logging.

    Parameters
    ----------
    db_pool : asyncpg.Pool
        Active database connection pool.
    raw_key : str
        The full plaintext API key (including ``fgos_`` prefix).

    Returns
    -------
    AgentIdentity
        Authenticated agent descriptor.

    Raises
    ------
    AuthenticationError
        If the key is missing, malformed, invalid, revoked, expired,
        or rate-limited.
    """
    if not raw_key or not raw_key.startswith(API_KEY_PREFIX):
        logger.warning("auth_failure", extra={"reason": "malformed_key"})
        raise AuthenticationError(
            "Invalid API key format",
            details={"reason": "malformed_key"},
        )

    key_prefix = _extract_prefix(raw_key)

    # Rate limit check
    if not _rate_limiter.check(key_prefix):
        logger.warning(
            "auth_rate_limited",
            extra={"key_prefix": key_prefix},
        )
        raise AuthenticationError(
            "Rate limit exceeded — try again later",
            details={"reason": "rate_limited", "key_prefix": key_prefix},
        )

    # Compute hash for comparison
    provided_hash = hash_api_key(raw_key)

    # Look up candidate rows by prefix
    try:
        rows = await _lookup_by_prefix(db_pool, key_prefix)
    except Exception as exc:
        logger.error(
            "auth_db_error",
            extra={"key_prefix": key_prefix, "error": str(exc)},
        )
        raise AuthenticationError(
            "Authentication service unavailable",
            details={"reason": "database_error"},
        ) from exc

    if not rows:
        logger.warning(
            "auth_failure",
            extra={"reason": "key_not_found", "key_prefix": key_prefix},
        )
        raise AuthenticationError(
            "Invalid API key",
            details={"reason": "invalid_key"},
        )

    # Constant-time comparison against all candidate hashes
    matched_row: dict[str, Any] | None = None
    for row in rows:
        if hmac.compare_digest(provided_hash, row["key_hash"]):
            matched_row = dict(row)
            break

    if matched_row is None:
        logger.warning(
            "auth_failure",
            extra={"reason": "hash_mismatch", "key_prefix": key_prefix},
        )
        raise AuthenticationError(
            "Invalid API key",
            details={"reason": "invalid_key"},
        )

    # Check key status
    if not matched_row.get("is_active", True):
        logger.warning(
            "auth_failure",
            extra={"reason": "key_revoked", "key_prefix": key_prefix},
        )
        raise AuthenticationError(
            "API key has been revoked",
            details={"reason": "key_revoked"},
        )

    if matched_row.get("revoked_at") is not None:
        logger.warning(
            "auth_failure",
            extra={"reason": "key_revoked", "key_prefix": key_prefix},
        )
        raise AuthenticationError(
            "API key has been revoked",
            details={"reason": "key_revoked"},
        )

    # Check expiration
    expires_at = matched_row.get("expires_at")
    if expires_at is not None:
        import datetime

        now = datetime.datetime.now(datetime.timezone.utc)
        if hasattr(expires_at, "timestamp"):
            # It's already a datetime object from asyncpg
            if expires_at < now:
                logger.warning(
                    "auth_failure",
                    extra={"reason": "key_expired", "key_prefix": key_prefix},
                )
                raise AuthenticationError(
                    "API key has expired",
                    details={"reason": "key_expired"},
                )

    # Check agent is active
    if not matched_row.get("agent_is_active", True):
        logger.warning(
            "auth_failure",
            extra={"reason": "agent_inactive", "key_prefix": key_prefix},
        )
        raise AuthenticationError(
            "Agent account is inactive",
            details={"reason": "agent_inactive"},
        )

    # Update last_used_at (fire-and-forget)
    try:
        await _update_last_used(db_pool, matched_row["key_id"])
    except Exception:
        pass  # Non-critical — don't fail auth on usage tracking

    identity = AgentIdentity(
        agent_id=str(matched_row["agent_id"]),
        agent_name=matched_row["agent_name"],
        role=matched_row["agent_role"],
        permissions=matched_row.get("permissions", []),
    )

    logger.info(
        "auth_success",
        extra={
            "agent_id": identity.agent_id,
            "agent_name": identity.agent_name,
            "key_prefix": key_prefix,
        },
    )

    return identity


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------


async def _lookup_by_prefix(
    db_pool: Any,
    key_prefix: str,
) -> list[Any]:
    """Look up API key rows matching the given prefix.

    Returns rows with joined agent data for identity resolution.
    """
    query = """
        SELECT
            k.id            AS key_id,
            k.key_hash      AS key_hash,
            k.is_active     AS is_active,
            k.revoked_at    AS revoked_at,
            k.expires_at    AS expires_at,
            a.id            AS agent_id,
            a.name          AS agent_name,
            a.role          AS agent_role,
            a.permissions   AS permissions,
            a.is_active     AS agent_is_active
        FROM api_keys k
        JOIN agents a ON a.id = k.agent_id
        WHERE k.key_prefix = $1
    """
    async with db_pool.acquire() as conn:
        return await conn.fetch(query, key_prefix)


async def _update_last_used(db_pool: Any, key_id: str) -> None:
    """Update the ``last_used_at`` timestamp for a key."""
    query = "UPDATE api_keys SET last_used_at = NOW() WHERE id = $1"
    async with db_pool.acquire() as conn:
        await conn.execute(query, key_id)


# ---------------------------------------------------------------------------
# Key provisioning (admin utility)
# ---------------------------------------------------------------------------


async def create_api_key_for_agent(
    db_pool: Any,
    agent_id: str,
    *,
    label: str = "default",
    expires_at: Any | None = None,
) -> str:
    """Generate and store a new API key for the given agent.

    Parameters
    ----------
    db_pool : asyncpg.Pool
        Active database connection pool.
    agent_id : str
        UUID of the agent to create the key for.
    label : str
        Human-readable label for the key (e.g. ``"production"``).
    expires_at : datetime | None
        Optional expiration timestamp.  ``None`` means non-expiring.

    Returns
    -------
    str
        The raw API key — display to the operator exactly once.

    Raises
    ------
    AuthenticationError
        If the agent does not exist.
    """
    # Verify agent exists
    async with db_pool.acquire() as conn:
        agent = await conn.fetchrow(
            "SELECT id, name FROM agents WHERE id = $1", agent_id
        )
        if agent is None:
            raise AuthenticationError(
                f"Agent not found: {agent_id}",
                details={"reason": "agent_not_found"},
            )

    raw_key, key_hash, key_prefix = generate_api_key()

    insert_query = """
        INSERT INTO api_keys (agent_id, key_hash, key_prefix, label, expires_at)
        VALUES ($1, $2, $3, $4, $5)
    """
    async with db_pool.acquire() as conn:
        await conn.execute(
            insert_query, agent_id, key_hash, key_prefix, label, expires_at
        )

    logger.info(
        "api_key_created",
        extra={
            "agent_id": agent_id,
            "key_prefix": key_prefix,
            "label": label,
        },
    )

    return raw_key


async def revoke_api_key(
    db_pool: Any,
    key_prefix: str,
) -> bool:
    """Revoke an API key by its prefix.

    Parameters
    ----------
    db_pool : asyncpg.Pool
        Active database connection pool.
    key_prefix : str
        The 8-character prefix of the key to revoke.

    Returns
    -------
    bool
        ``True`` if a key was revoked, ``False`` if not found.
    """
    query = """
        UPDATE api_keys
        SET is_active = FALSE, revoked_at = NOW()
        WHERE key_prefix = $1 AND is_active = TRUE
        RETURNING id
    """
    async with db_pool.acquire() as conn:
        result = await conn.fetchrow(query, key_prefix)

    if result is not None:
        logger.info(
            "api_key_revoked",
            extra={"key_prefix": key_prefix},
        )
        return True

    return False
