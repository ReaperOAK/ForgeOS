"""Audit logging middleware — records all authenticated requests.

Provides :class:`AuditMiddleware`, a Starlette middleware that automatically
logs every authenticated request to the audit trail. Runs after
:class:`AuthMiddleware` so the :class:`AuthContext` is available.

.. meta::
   :ticket: FORGEOS-BE058
"""

from __future__ import annotations

import time
from typing import TYPE_CHECKING, Any

from starlette.middleware.base import BaseHTTPMiddleware

from mcp_server.middleware.auth_middleware import get_auth_context

if TYPE_CHECKING:
    from starlette.responses import Response
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request
    from starlette.types import ASGIApp

logger = get_logger("audit_middleware")

_SKIP_PATHS: frozenset[str] = frozenset({
    "/health",
    "/healthz",
    "/ready",
    "/readiness",
    "/livez",
    "/readyz",
})


def _extract_target(request: Request) -> str:
    """Extract the target resource from the request path."""
    return request.url.path


def _extract_source_machine(request: Request) -> str:
    """Extract source machine from request headers or client info."""
    machine_id = request.headers.get("x-machine-id", "")
    if machine_id:
        return machine_id

    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()

    if request.client:
        return request.client.host

    return "unknown"


class AuditMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that logs all authenticated requests to audit_log.

    This middleware must be added AFTER :class:`AuthMiddleware` in the
    middleware stack so that :func:`get_auth_context` returns a populated
    context.

    Parameters
    ----------
    app : ASGIApp
        The ASGI application to wrap.
    audit_repo : AuditRepository | None
        Audit log repository. When ``None``, audit logging is silently skipped.
    """

    def __init__(
        self,
        app: ASGIApp,
        audit_repo: Any = None,
    ) -> None:
        super().__init__(app)
        self._audit_repo = audit_repo

    @property
    def audit_repo(self) -> Any:
        """Return the audit repository."""
        return self._audit_repo

    @audit_repo.setter
    def audit_repo(self, repo: Any) -> None:
        """Set the audit repository."""
        self._audit_repo = repo

    async def dispatch(self, request: Request, call_next: Any) -> Response:
        """Log every authenticated request to the audit trail."""
        path = request.url.path.rstrip("/") or "/"

        if path in _SKIP_PATHS:
            return await call_next(request)

        start_time = time.monotonic()
        response: Response = await call_next(request)
        duration_ms = (time.monotonic() - start_time) * 1000

        auth_ctx = get_auth_context()
        if auth_ctx is None or self._audit_repo is None:
            return response

        operation = f"{request.method} {path}"
        target = _extract_target(request)
        source_machine = _extract_source_machine(request)
        result = "success" if response.status_code < 400 else "failure"

        metadata = {
            "http_method": request.method,
            "http_status": response.status_code,
            "duration_ms": round(duration_ms, 2),
            "path": path,
        }

        try:
            await self._audit_repo.append(
                identity_type=auth_ctx.identity_type.value,
                identity_id=auth_ctx.identity_id,
                operation=operation,
                target=target,
                result=result,
                metadata=metadata,
                source_machine=source_machine,
            )
        except Exception:
            logger.exception(
                "audit_write_failed",
                extra={"operation": operation, "path": path},
            )

        return response
