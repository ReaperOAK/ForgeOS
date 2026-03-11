"""Idempotency key middleware for MCP and REST requests.

Prevents duplicate processing of mutating operations by caching responses
keyed by a client-supplied ``X-Idempotency-Key`` header. Subsequent
requests with the same key return the cached response without
re-executing the handler.

Headers
-------
* ``X-Idempotency-Key`` — client-supplied unique key for the operation.
* ``X-Idempotent-Replayed`` — set to ``"true"`` on cached replay responses.

Key Lifecycle
-------------
1. Client sends a POST/PUT/PATCH/DELETE with ``X-Idempotency-Key: <key>``.
2. Middleware checks the store:

   - **No entry** → mark key *in-progress*, call handler, cache response.
   - **In-progress** → return ``409 Conflict`` (operation still running).
   - **Completed** → return cached response with ``X-Idempotent-Replayed``.

3. Entries expire after a configurable TTL (default 24 hours).

Configuration
-------------
* ``ttl_seconds`` — how long cached responses are kept (default: 86400).
* ``missing_key_policy`` — ``"warn"`` (log + allow) or ``"reject"`` (400).

Storage
-------
* :class:`IdempotencyStore` — abstract interface for pluggable backends.
* :class:`InMemoryIdempotencyStore` — default in-process implementation.

.. meta::
   :ticket: FORGEOS-BE041
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

import abc
import enum
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.types import ASGIApp

logger = get_logger("idempotency")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

HEADER_NAME: str = "x-idempotency-key"
"""Canonical (lowercased) header name for idempotency keys."""

DEFAULT_TTL_SECONDS: int = 86400
"""Default TTL for cached responses: 24 hours."""

# HTTP methods considered mutating
_MUTATING_METHODS: frozenset[str] = frozenset({"POST", "PUT", "DELETE", "PATCH"})

# Paths excluded from idempotency enforcement
_EXCLUDED_PATHS: frozenset[str] = frozenset({
    "/health",
    "/healthz",
    "/ready",
    "/readiness",
    "/livez",
    "/readyz",
})


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class MissingKeyPolicy(str, enum.Enum):
    """Behavior when a mutating request lacks an idempotency key."""

    WARN = "warn"
    """Log a warning and allow the request to proceed."""

    REJECT = "reject"
    """Return 400 Bad Request."""


@dataclass(frozen=True, slots=True)
class IdempotencyConfig:
    """Configuration for the idempotency middleware.

    Parameters
    ----------
    ttl_seconds : int
        How long cached responses are retained (default 24h).
    missing_key_policy : MissingKeyPolicy
        What to do when a mutating request has no idempotency key.
    """

    ttl_seconds: int = DEFAULT_TTL_SECONDS
    missing_key_policy: MissingKeyPolicy = MissingKeyPolicy.WARN


# ---------------------------------------------------------------------------
# Entry dataclass
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class IdempotencyEntry:
    """A cached idempotency response or in-progress marker.

    Parameters
    ----------
    key : str
        The idempotency key.
    status_code : int
        HTTP status code of the cached response (0 if in-progress).
    headers : dict[str, str]
        Response headers to replay.
    body : bytes
        Response body to replay.
    in_progress : bool
        Whether the operation is still being executed.
    created_at : float
        Monotonic timestamp when the entry was created.
    """

    key: str
    status_code: int = 0
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes = b""
    in_progress: bool = False
    created_at: float = field(default_factory=time.monotonic)


# ---------------------------------------------------------------------------
# Store abstraction
# ---------------------------------------------------------------------------


class IdempotencyStore(abc.ABC):
    """Abstract interface for idempotency key storage.

    Implementers must provide async get/set/remove/mark_in_progress
    operations. The default :class:`InMemoryIdempotencyStore` keeps
    entries in a dict; external backends (Redis, PostgreSQL) can be
    plugged in by subclassing.
    """

    @abc.abstractmethod
    async def get(self, key: str) -> IdempotencyEntry | None:
        """Return the entry for *key*, or ``None`` if missing/expired."""

    @abc.abstractmethod
    async def set(
        self, key: str, entry: IdempotencyEntry, *, ttl_seconds: int
    ) -> None:
        """Store a completed entry with the given TTL."""

    @abc.abstractmethod
    async def remove(self, key: str) -> None:
        """Remove the entry for *key* (no-op if missing)."""

    @abc.abstractmethod
    async def mark_in_progress(self, key: str, *, ttl_seconds: int) -> None:
        """Mark *key* as in-progress (guards against concurrent dupes)."""

    @abc.abstractmethod
    async def cleanup_expired(self) -> None:
        """Remove all entries whose TTL has elapsed."""


# ---------------------------------------------------------------------------
# In-memory store
# ---------------------------------------------------------------------------


@dataclass
class _StoredEntry:
    """Internal wrapper adding an expiry timestamp."""

    entry: IdempotencyEntry
    expires_at: float


class InMemoryIdempotencyStore(IdempotencyStore):
    """Default in-process idempotency store backed by a ``dict``.

    Suitable for single-instance deployments. For horizontally scaled
    setups, use an external store (Redis, PostgreSQL).
    """

    def __init__(self) -> None:
        self._entries: dict[str, _StoredEntry] = {}

    async def get(self, key: str) -> IdempotencyEntry | None:
        stored = self._entries.get(key)
        if stored is None:
            return None
        if time.monotonic() >= stored.expires_at:
            del self._entries[key]
            return None
        return stored.entry

    async def set(
        self, key: str, entry: IdempotencyEntry, *, ttl_seconds: int
    ) -> None:
        expires_at = time.monotonic() + ttl_seconds
        self._entries[key] = _StoredEntry(entry=entry, expires_at=expires_at)

    async def remove(self, key: str) -> None:
        self._entries.pop(key, None)

    async def mark_in_progress(self, key: str, *, ttl_seconds: int) -> None:
        entry = IdempotencyEntry(key=key, in_progress=True)
        await self.set(key, entry, ttl_seconds=ttl_seconds)

    async def cleanup_expired(self) -> None:
        now = time.monotonic()
        expired = [k for k, v in self._entries.items() if now >= v.expires_at]
        for k in expired:
            del self._entries[k]


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _extract_idempotency_key(request: Request) -> str | None:
    """Extract and validate the idempotency key from request headers.

    Returns ``None`` if the header is missing, empty, or whitespace-only.
    """
    raw = request.headers.get(HEADER_NAME)
    if raw is None:
        return None
    stripped = raw.strip()
    return stripped if stripped else None


def _is_mutating_request(request: Request) -> bool:
    """Return ``True`` if the request uses a mutating HTTP method."""
    return request.method in _MUTATING_METHODS


# ---------------------------------------------------------------------------
# Error responses
# ---------------------------------------------------------------------------


def _missing_key_response(request: Request) -> JSONResponse:
    """Build a 400 response for missing idempotency key."""
    path = request.url.path
    if path.startswith("/mcp"):
        return JSONResponse(
            status_code=400,
            content={
                "jsonrpc": "2.0",
                "error": {
                    "code": -32602,
                    "message": "Missing required X-Idempotency-Key header",
                },
                "id": None,
            },
        )
    return JSONResponse(
        status_code=400,
        content={"error": "Missing required X-Idempotency-Key header for idempotency"},
    )


def _conflict_response(request: Request, key: str) -> JSONResponse:
    """Build a 409 response for an in-progress key collision."""
    path = request.url.path
    if path.startswith("/mcp"):
        return JSONResponse(
            status_code=409,
            content={
                "jsonrpc": "2.0",
                "error": {
                    "code": -32602,
                    "message": (
                        f"Operation with idempotency key '{key}' is still in-progress"
                    ),
                },
                "id": None,
            },
        )
    return JSONResponse(
        status_code=409,
        content={
            "error": f"Operation with idempotency key '{key}' is still in-progress",
        },
    )


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Starlette middleware enforcing idempotency for mutating requests.

    Extracts the ``X-Idempotency-Key`` header, checks the store for
    existing results, and either replays a cached response or executes
    the handler and caches the result.

    Parameters
    ----------
    app : ASGIApp
        The ASGI application to wrap.
    config : IdempotencyConfig | None
        Idempotency configuration. Uses defaults if ``None``.
    store : IdempotencyStore | None
        Storage backend. Uses :class:`InMemoryIdempotencyStore` if ``None``.
    """

    def __init__(
        self,
        app: ASGIApp,
        config: IdempotencyConfig | None = None,
        store: IdempotencyStore | None = None,
    ) -> None:
        super().__init__(app)
        self._config = config or IdempotencyConfig()
        self._store = store or InMemoryIdempotencyStore()

    @property
    def config(self) -> IdempotencyConfig:
        """Return the idempotency configuration."""
        return self._config

    @property
    def store(self) -> IdempotencyStore:
        """Return the idempotency store."""
        return self._store

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        """Process idempotency logic for each request."""
        path = request.url.path.rstrip("/")
        if not path:
            path = "/"

        # Skip idempotency for health endpoints
        if path in _EXCLUDED_PATHS:
            return await call_next(request)

        # Only enforce idempotency on mutating requests
        if not _is_mutating_request(request):
            return await call_next(request)

        # Extract the idempotency key
        key = _extract_idempotency_key(request)

        if key is None:
            # No key provided — handle per policy
            if self._config.missing_key_policy == MissingKeyPolicy.REJECT:
                logger.warning(
                    "idempotency_key_missing_rejected",
                    extra={"path": path, "method": request.method},
                )
                return _missing_key_response(request)

            # WARN policy: log and proceed without idempotency
            logger.warning(
                "idempotency_key_missing",
                extra={"path": path, "method": request.method},
            )
            return await call_next(request)

        # Check the store for an existing entry
        existing = await self._store.get(key)

        if existing is not None:
            if existing.in_progress:
                logger.info(
                    "idempotency_conflict",
                    extra={"key": key, "path": path},
                )
                return _conflict_response(request, key)

            # Replay the cached response
            logger.info(
                "idempotency_replay",
                extra={"key": key, "path": path},
            )
            response = Response(
                content=existing.body,
                status_code=existing.status_code,
                headers=existing.headers,
            )
            response.headers["X-Idempotent-Replayed"] = "true"
            return response

        # Mark the key as in-progress before executing
        await self._store.mark_in_progress(
            key, ttl_seconds=self._config.ttl_seconds
        )

        try:
            # Execute the actual handler
            response: Response = await call_next(request)

            # Read and cache the response
            resp_body = b""
            async for chunk in response.body_iterator:  # type: ignore[attr-defined]
                if isinstance(chunk, str):
                    resp_body += chunk.encode("utf-8")
                else:
                    resp_body += chunk

            # Extract response headers we want to cache
            cached_headers: dict[str, str] = {}
            for header_name in ("content-type", "content-length"):
                val = response.headers.get(header_name)
                if val is not None:
                    cached_headers[header_name] = val

            entry = IdempotencyEntry(
                key=key,
                status_code=response.status_code,
                headers=cached_headers,
                body=resp_body,
                in_progress=False,
            )
            await self._store.set(
                key, entry, ttl_seconds=self._config.ttl_seconds
            )

            # Return a new response since the original body_iterator is consumed
            return Response(
                content=resp_body,
                status_code=response.status_code,
                headers=dict(response.headers),
            )

        except Exception:
            # On failure, remove the in-progress marker so the key can be retried
            await self._store.remove(key)
            raise
