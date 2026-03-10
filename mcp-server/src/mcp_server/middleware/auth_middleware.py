"""Unified authentication middleware for MCP and REST requests.

Provides a single Starlette middleware that authenticates both MCP
tool calls and REST API requests using the same credential pipeline.
Sets per-request AuthContext via contextvars for downstream handlers.

.. meta::
   :ticket: FORGEOS-BE054
   :last_reviewed: 2025-07-22T00:00:00Z
"""

from __future__ import annotations

import enum
from contextvars import ContextVar
from dataclasses import dataclass, field
from typing import Any

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.types import ASGIApp

from mcp_server.auth.agent_auth import (
    AgentIdentity,
    AuthenticationError,
    RateLimiter,
    validate_api_key,
)
from mcp_server.observability import get_logger

logger = get_logger("auth_middleware")


# ---------------------------------------------------------------------------
# Identity types
# ---------------------------------------------------------------------------


class IdentityType(str, enum.Enum):
    """Classification of authenticated identity."""

    AGENT = "agent"
    OPERATOR = "operator"
    ADMIN = "admin"


# ---------------------------------------------------------------------------
# Auth context
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class AuthContext:
    """Per-request authentication context.

    Stored in a :class:`~contextvars.ContextVar` for async-safe access.
    """

    identity_type: IdentityType
    identity_id: str
    role: str
    machine_id: str = ""
    agent_name: str = ""
    permissions: list[str] = field(default_factory=list)


_auth_context_var: ContextVar[AuthContext | None] = ContextVar(
    "auth_context", default=None
)


def set_auth_context(ctx: AuthContext) -> None:
    """Set the authentication context for the current request."""
    _auth_context_var.set(ctx)


def get_auth_context() -> AuthContext | None:
    """Return the authentication context for the current request."""
    return _auth_context_var.get()


def clear_auth_context() -> None:
    """Clear the authentication context after request completes."""
    _auth_context_var.set(None)


# ---------------------------------------------------------------------------
# Path helpers
# ---------------------------------------------------------------------------

_EXCLUDED_PATHS: frozenset[str] = frozenset({
    "/health",
    "/healthz",
    "/ready",
    "/readiness",
    "/livez",
    "/readyz",
})


def _is_mcp_path(path: str) -> bool:
    """Return True if the path is an MCP endpoint."""
    return path.startswith("/mcp")


# ---------------------------------------------------------------------------
# Credential extraction
# ---------------------------------------------------------------------------


def _extract_api_key_from_headers(request: Request) -> str | None:
    """Extract API key from request headers.

    Checks ``X-API-Key`` first, then ``Authorization: Bearer``.
    """
    api_key = request.headers.get("x-api-key")
    if api_key:
        return api_key.strip()

    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        token = auth_header[7:].strip()
        if token:
            return token

    return None


def _extract_machine_id(request: Request) -> str:
    """Extract machine identifier from request."""
    machine_id = request.headers.get("x-machine-id", "")
    if machine_id:
        return machine_id

    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()

    if request.client:
        return request.client.host

    return "unknown"


def _classify_identity(role: str) -> IdentityType:
    """Map an agent role string to an IdentityType."""
    if role == "admin":
        return IdentityType.ADMIN
    return IdentityType.AGENT


# ---------------------------------------------------------------------------
# Error responses
# ---------------------------------------------------------------------------


def _unauthorized_response(
    request: Request,
    message: str = "Authentication required",
) -> JSONResponse:
    """Build a 401 response appropriate for the endpoint type."""
    if _is_mcp_path(request.url.path):
        return JSONResponse(
            status_code=401,
            content={
                "jsonrpc": "2.0",
                "error": {
                    "code": -32602,
                    "message": message,
                },
                "id": None,
            },
        )
    return JSONResponse(
        status_code=401,
        content={"error": message},
    )


# ---------------------------------------------------------------------------
# Middleware
# ---------------------------------------------------------------------------


class AuthMiddleware(BaseHTTPMiddleware):
    """Starlette middleware for unified MCP + REST authentication.

    Parameters
    ----------
    app : ASGIApp
        The ASGI application to wrap.
    db_pool : asyncpg.Pool | None
        Database connection pool for credential validation.
    excluded_paths : frozenset[str] | None
        Additional paths to exclude from authentication.
    """

    def __init__(
        self,
        app: ASGIApp,
        db_pool: Any = None,
        excluded_paths: frozenset[str] | None = None,
    ) -> None:
        super().__init__(app)
        self._db_pool = db_pool
        self._excluded_paths = _EXCLUDED_PATHS | (excluded_paths or frozenset())

    @property
    def db_pool(self) -> Any:
        """Return the database connection pool."""
        return self._db_pool

    @db_pool.setter
    def db_pool(self, pool: Any) -> None:
        """Set the database connection pool."""
        self._db_pool = pool

    async def dispatch(self, request: Request, call_next):  # noqa: ANN001
        """Process authentication for each request."""
        path = request.url.path.rstrip("/")
        if not path:
            path = "/"

        # Skip auth for health/readiness endpoints
        if path in self._excluded_paths:
            return await call_next(request)

        # Require database pool
        if self._db_pool is None:
            logger.error("auth_no_db_pool")
            return JSONResponse(
                status_code=503,
                content={"error": "Service unavailable"},
            )

        # Extract credentials
        api_key = _extract_api_key_from_headers(request)
        if not api_key:
            logger.warning(
                "auth_missing_credentials",
                extra={"path": request.url.path},
            )
            return _unauthorized_response(request)

        # Validate credentials
        try:
            identity: AgentIdentity = await validate_api_key(
                self._db_pool, api_key
            )
        except AuthenticationError as exc:
            logger.warning(
                "auth_validation_failed",
                extra={
                    "path": request.url.path,
                    "reason": str(exc),
                },
            )
            return _unauthorized_response(request, str(exc))

        # Build and set auth context
        machine_id = _extract_machine_id(request)
        auth_ctx = AuthContext(
            identity_type=_classify_identity(identity.role),
            identity_id=identity.agent_id,
            role=identity.role,
            machine_id=machine_id,
            agent_name=identity.agent_name,
            permissions=list(identity.permissions),
        )
        set_auth_context(auth_ctx)

        logger.info(
            "auth_success",
            extra={
                "identity_type": auth_ctx.identity_type.value,
                "agent_name": auth_ctx.agent_name,
                "path": request.url.path,
            },
        )

        try:
            response = await call_next(request)
        finally:
            clear_auth_context()

        return response
