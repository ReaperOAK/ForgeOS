"""Admin audit log REST endpoint.

Provides a Starlette route handler for querying audit logs at
``GET /api/admin/audit``. Requires admin-level authentication.

Query parameters:
- ``identity``: Filter by identity_id
- ``identity_type``: Filter by identity type (agent, operator, admin)
- ``operation``: Filter by operation name
- ``since``: ISO 8601 timestamp lower bound
- ``until``: ISO 8601 timestamp upper bound
- ``limit``: Max rows (default 100, max 1000)
- ``offset``: Pagination offset

.. meta::
   :ticket: FORGEOS-BE058
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse

from mcp_server.middleware.auth_middleware import IdentityType, get_auth_context
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request

    from mcp_server.repositories.audit_repo import AuditRepository

logger = get_logger("api.admin.audit")


def _parse_datetime(value: str | None) -> datetime | None:
    """Parse an ISO 8601 datetime string, or return None."""
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def _parse_int(value: str | None, default: int, max_val: int | None = None) -> int:
    """Parse an integer query param with a default and optional max."""
    if not value:
        return default
    try:
        result = int(value)
        if max_val is not None:
            result = min(result, max_val)
        return max(result, 0)
    except ValueError:
        return default


def create_audit_endpoint(audit_repo_getter: Any) -> Any:
    """Create the admin audit log endpoint handler.

    Parameters
    ----------
    audit_repo_getter : callable
        A callable that returns the current ``AuditRepository`` instance,
        or ``None`` if the database is unavailable.

    Returns
    -------
    coroutine
        An async Starlette request handler.
    """

    async def audit_endpoint(request: Request) -> JSONResponse:
        """Handle GET /api/admin/audit requests."""
        auth_ctx = get_auth_context()
        if auth_ctx is None:
            return JSONResponse(
                status_code=401,
                content={"error": "Authentication required"},
            )

        if auth_ctx.identity_type != IdentityType.ADMIN:
            logger.warning(
                "audit_access_denied",
                extra={
                    "identity_type": auth_ctx.identity_type.value,
                    "identity_id": auth_ctx.identity_id,
                },
            )
            return JSONResponse(
                status_code=403,
                content={"error": "Admin access required"},
            )

        audit_repo: AuditRepository | None = audit_repo_getter()
        if audit_repo is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Database unavailable"},
            )

        params = request.query_params
        identity_id = params.get("identity") or None
        identity_type = params.get("identity_type") or None
        operation = params.get("operation") or None
        since = _parse_datetime(params.get("since"))
        until = _parse_datetime(params.get("until"))
        limit = _parse_int(params.get("limit"), default=100, max_val=1000)
        offset = _parse_int(params.get("offset"), default=0)

        try:
            rows = await audit_repo.query(
                identity_id=identity_id,
                identity_type=identity_type,
                operation=operation,
                since=since,
                until=until,
                limit=limit,
                offset=offset,
            )

            total = await audit_repo.count(
                identity_id=identity_id,
                identity_type=identity_type,
                operation=operation,
                since=since,
                until=until,
            )
        except Exception:
            logger.exception("audit_query_failed")
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        entries = [
            {
                "audit_id": str(r.audit_id),
                "identity_type": r.identity_type,
                "identity_id": r.identity_id,
                "operation": r.operation,
                "target": r.target,
                "result": r.result,
                "timestamp": r.timestamp.isoformat(),
                "metadata": r.metadata,
                "source_machine": r.source_machine,
            }
            for r in rows
        ]

        return JSONResponse({
            "entries": entries,
            "total": total,
            "limit": limit,
            "offset": offset,
        })

    return audit_endpoint
