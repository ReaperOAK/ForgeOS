"""Per-agent rate limiting middleware for MCP and REST requests.

Implements a sliding window algorithm that tracks requests per agent
identity and per machine. Write operations (claim, advance, reject,
release) have stricter limits than read operations (status, list).

Headers
-------
* ``X-RateLimit-Limit`` — maximum allowed requests for the current window.
* ``X-RateLimit-Remaining`` — requests remaining in the current window.
* ``X-RateLimit-Reset`` — seconds until the oldest tracked request expires.
* ``Retry-After`` — seconds to wait (only on 429 responses).

Configuration
-------------
All limits are configurable via constructor parameters, which can be
sourced from environment variables at the application layer.

.. meta::
   :ticket: FORGEOS-BE042
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

import time
from collections import deque
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from mcp_server.middleware.auth_middleware import get_auth_context
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.responses import Response
    from starlette.types import ASGIApp

logger = get_logger("rate_limiter")

# ---------------------------------------------------------------------------
# Defaults
# ---------------------------------------------------------------------------

DEFAULT_READ_LIMIT = 120
"""Maximum read requests per window."""

DEFAULT_READ_WINDOW = 60.0
"""Read window duration in seconds."""

DEFAULT_WRITE_LIMIT = 30
"""Maximum write requests per window."""

DEFAULT_WRITE_WINDOW = 60.0
"""Write window duration in seconds."""

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class RateLimitConfig:
    """Rate limit configuration for the middleware.

    Parameters
    ----------
    read_limit : int
        Maximum read requests per window.
    read_window : float
        Read window duration in seconds.
    write_limit : int
        Maximum write (claim/advance) requests per window.
    write_window : float
        Write window duration in seconds.
    """

    read_limit: int = DEFAULT_READ_LIMIT
    read_window: float = DEFAULT_READ_WINDOW
    write_limit: int = DEFAULT_WRITE_LIMIT
    write_window: float = DEFAULT_WRITE_WINDOW


# ---------------------------------------------------------------------------
# Paths excluded from rate limiting
# ---------------------------------------------------------------------------

_EXCLUDED_PATHS: frozenset[str] = frozenset({
    "/health",
    "/healthz",
    "/ready",
    "/readiness",
    "/livez",
    "/readyz",
})

# HTTP methods that indicate write operations
_WRITE_METHODS: frozenset[str] = frozenset({"POST", "PUT", "DELETE", "PATCH"})

# Path substrings that indicate write MCP tool calls
_WRITE_PATH_PATTERNS: tuple[str, ...] = (
    "/claim",
    "/advance",
    "/reject",
    "/release",
    "/rework",
)


# ---------------------------------------------------------------------------
# Sliding window tracker
# ---------------------------------------------------------------------------


@dataclass
class _WindowBucket:
    """Sliding window bucket for a single key.

    Maintains a deque of monotonic timestamps to compute the
    request count within the current window.
    """

    timestamps: deque[float] = field(default_factory=deque)


class SlidingWindowLimiter:
    """In-memory sliding window rate limiter.

    Tracks request timestamps per key and enforces a maximum
    count within a configurable time window.
    """

    def __init__(self) -> None:
        self._buckets: dict[str, _WindowBucket] = {}

    def check(
        self,
        key: str,
        limit: int,
        window: float,
    ) -> tuple[bool, int, float]:
        """Check if a request is allowed and consume one slot.

        Parameters
        ----------
        key : str
            Unique identifier (e.g. ``"agent_id:machine_id"``).
        limit : int
            Maximum requests allowed within the window.
        window : float
            Window duration in seconds.

        Returns
        -------
        tuple[bool, int, float]
            ``(allowed, remaining, reset_after)`` where *remaining* is
            the number of requests left and *reset_after* is seconds
            until the oldest tracked request expires from the window.
        """
        now = time.monotonic()
        bucket = self._buckets.get(key)

        if bucket is None:
            bucket = _WindowBucket()
            self._buckets[key] = bucket

        # Evict timestamps outside the window
        cutoff = now - window
        while bucket.timestamps and bucket.timestamps[0] <= cutoff:
            bucket.timestamps.popleft()

        count = len(bucket.timestamps)

        if count >= limit:
            # Rate limited — compute retry-after from oldest entry
            oldest = bucket.timestamps[0]
            reset_after = oldest + window - now
            return False, 0, max(reset_after, 0.1)

        # Allow the request
        bucket.timestamps.append(now)
        remaining = limit - count - 1

        if bucket.timestamps:
            oldest = bucket.timestamps[0]
            reset_after = oldest + window - now
        else:
            reset_after = window

        return True, remaining, max(reset_after, 0.0)

    def reset(self) -> None:
        """Clear all tracked state (for testing)."""
        self._buckets.clear()


# ---------------------------------------------------------------------------
# Path classification
# ---------------------------------------------------------------------------


def _is_write_operation(request: Request) -> bool:
    """Determine if a request is a write (mutating) operation.

    Write operations include POST/PUT/DELETE/PATCH methods, and
    requests to known mutating MCP tool paths.
    """
    if request.method in _WRITE_METHODS:
        return True

    path = request.url.path.lower()
    return any(pattern in path for pattern in _WRITE_PATH_PATTERNS)


def _build_rate_limit_key(request: Request) -> str:
    """Build a rate-limit key from the authenticated context or client IP.

    Uses ``agent_id:machine_id`` when an auth context is available,
    otherwise falls back to the client IP address.
    """
    auth_ctx = get_auth_context()
    if auth_ctx is not None:
        machine = auth_ctx.machine_id or "unknown"
        return f"{auth_ctx.identity_id}:{machine}"

    # Fallback to client IP
    if request.client:
        return f"anon:{request.client.host}"
    return "anon:unknown"


# ---------------------------------------------------------------------------
# Error responses
# ---------------------------------------------------------------------------


def _rate_limit_response(
    request: Request,
    limit: int,
    retry_after: float,
) -> JSONResponse:
    """Build a 429 Too Many Requests response.

    Returns JSON-RPC error format for MCP paths, standard JSON otherwise.
    """
    retry_seconds = int(retry_after) + 1  # Round up

    headers = {
        "Retry-After": str(retry_seconds),
        "X-RateLimit-Limit": str(limit),
        "X-RateLimit-Remaining": "0",
    }

    path = request.url.path
    if path.startswith("/mcp"):
        return JSONResponse(
            status_code=429,
            content={
                "jsonrpc": "2.0",
                "error": {
                    "code": -32602,
                    "message": f"Rate limit exceeded. Retry after {retry_seconds}s.",
                },
                "id": None,
            },
            headers=headers,
        )

    return JSONResponse(
        status_code=429,
        content={
            "error": "Rate limit exceeded",
            "retry_after": retry_seconds,
        },
        headers=headers,
    )


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Starlette middleware enforcing per-agent, per-machine rate limits.

    Must be added AFTER :class:`AuthMiddleware` in the middleware stack
    so that :func:`get_auth_context` returns a populated context.

    Parameters
    ----------
    app : ASGIApp
        The ASGI application to wrap.
    config : RateLimitConfig | None
        Rate limit configuration. Uses defaults if ``None``.
    limiter : SlidingWindowLimiter | None
        Shared limiter instance. A new one is created if ``None``.
    """

    def __init__(
        self,
        app: ASGIApp,
        config: RateLimitConfig | None = None,
        limiter: SlidingWindowLimiter | None = None,
    ) -> None:
        super().__init__(app)
        self._config = config or RateLimitConfig()
        self._limiter = limiter or SlidingWindowLimiter()

    @property
    def config(self) -> RateLimitConfig:
        """Return the rate limit configuration."""
        return self._config

    @property
    def limiter(self) -> SlidingWindowLimiter:
        """Return the sliding window limiter."""
        return self._limiter

    async def dispatch(
        self, request: Request, call_next: Any
    ) -> Response:
        """Enforce rate limits on each request."""
        path = request.url.path.rstrip("/")
        if not path:
            path = "/"

        # Skip rate limiting for health endpoints
        if path in _EXCLUDED_PATHS:
            return await call_next(request)

        # Determine operation type and limits
        is_write = _is_write_operation(request)
        if is_write:
            limit = self._config.write_limit
            window = self._config.write_window
        else:
            limit = self._config.read_limit
            window = self._config.read_window

        # Build key and check rate limit
        key = _build_rate_limit_key(request)
        allowed, remaining, reset_after = self._limiter.check(key, limit, window)

        if not allowed:
            logger.warning(
                "rate_limit_exceeded",
                extra={
                    "key": key,
                    "limit": limit,
                    "is_write": is_write,
                    "retry_after": reset_after,
                },
            )
            return _rate_limit_response(request, limit, reset_after)

        # Process the request
        response: Response = await call_next(request)

        # Inject rate limit headers into the response
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(reset_after) + 1)

        return response
