"""Admin REST endpoints for elevated ticket operations.

Provides Starlette route handlers for admin-only force operations:

- ``POST /api/admin/tickets/{ticket_id}/force-release``
- ``POST /api/admin/tickets/{ticket_id}/force-advance``
- ``POST /api/admin/tickets/{ticket_id}/force-rework``

All operations require admin authentication (``identity_type == ADMIN``)
and a ``reason`` field in the request body for the audit trail.

.. meta::
   :ticket: FORGEOS-BE057
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse

from mcp_server.middleware.auth_middleware import IdentityType, get_auth_context
from mcp_server.observability import get_logger
from mcp_server.server import TicketNotFoundError
from mcp_server.services.stage_engine import InvalidTransitionError

if TYPE_CHECKING:
    from starlette.requests import Request

    from mcp_server.services.admin_service import AdminService

logger = get_logger("api.routes.admin")


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _require_admin() -> JSONResponse | None:
    """Return an error response if the current request lacks admin role.

    Returns ``None`` when the caller is an admin.
    """
    ctx = get_auth_context()
    if ctx is None:
        return JSONResponse(
            status_code=401,
            content={"error": "Authentication required"},
        )
    if ctx.identity_type != IdentityType.ADMIN:
        return JSONResponse(
            status_code=403,
            content={"error": "Admin role required"},
        )
    return None


def _parse_reason(body: dict[str, Any]) -> str | None:
    """Extract and validate the required ``reason`` field from a request body."""
    reason = body.get("reason")
    if not reason or not isinstance(reason, str) or not reason.strip():
        return None
    return reason.strip()


# ---------------------------------------------------------------------------
# Force release
# ---------------------------------------------------------------------------


def create_admin_force_release_endpoint(admin_service_getter: Any) -> Any:
    """Create the admin force-release endpoint handler.

    Parameters
    ----------
    admin_service_getter : callable
        Returns the current :class:`AdminService` instance, or ``None``.

    Returns
    -------
    coroutine
        An async Starlette request handler for
        ``POST /api/admin/tickets/{ticket_id}/force-release``.
    """

    async def force_release_endpoint(request: Request) -> JSONResponse:
        """Handle POST /api/admin/tickets/{ticket_id}/force-release."""
        auth_err = _require_admin()
        if auth_err is not None:
            return auth_err

        admin_service: AdminService | None = admin_service_getter()
        if admin_service is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Service unavailable"},
            )

        ticket_id: str = request.path_params["ticket_id"]

        try:
            body = await request.json()
        except Exception:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid or missing JSON body"},
            )

        reason = _parse_reason(body)
        if reason is None:
            return JSONResponse(
                status_code=400,
                content={"error": "Field 'reason' is required and must be a non-empty string"},
            )

        ctx = get_auth_context()
        assert ctx is not None  # guaranteed by _require_admin
        admin_id = ctx.identity_id

        try:
            result = await admin_service.force_release(
                ticket_id=ticket_id,
                admin_id=admin_id,
                reason=reason,
            )
        except TicketNotFoundError:
            return JSONResponse(
                status_code=404,
                content={"error": f"Ticket '{ticket_id}' not found"},
            )
        except Exception:
            logger.exception(
                "admin_force_release_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        return JSONResponse(status_code=200, content=result.to_dict())

    return force_release_endpoint


# ---------------------------------------------------------------------------
# Force advance
# ---------------------------------------------------------------------------


def create_admin_force_advance_endpoint(admin_service_getter: Any) -> Any:
    """Create the admin force-advance endpoint handler.

    Parameters
    ----------
    admin_service_getter : callable
        Returns the current :class:`AdminService` instance, or ``None``.

    Returns
    -------
    coroutine
        An async Starlette request handler for
        ``POST /api/admin/tickets/{ticket_id}/force-advance``.
    """

    async def force_advance_endpoint(request: Request) -> JSONResponse:
        """Handle POST /api/admin/tickets/{ticket_id}/force-advance."""
        auth_err = _require_admin()
        if auth_err is not None:
            return auth_err

        admin_service: AdminService | None = admin_service_getter()
        if admin_service is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Service unavailable"},
            )

        ticket_id: str = request.path_params["ticket_id"]

        try:
            body = await request.json()
        except Exception:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid or missing JSON body"},
            )

        reason = _parse_reason(body)
        if reason is None:
            return JSONResponse(
                status_code=400,
                content={"error": "Field 'reason' is required and must be a non-empty string"},
            )

        ctx = get_auth_context()
        assert ctx is not None
        admin_id = ctx.identity_id

        try:
            result = await admin_service.force_advance(
                ticket_id=ticket_id,
                admin_id=admin_id,
                reason=reason,
            )
        except TicketNotFoundError:
            return JSONResponse(
                status_code=404,
                content={"error": f"Ticket '{ticket_id}' not found"},
            )
        except InvalidTransitionError as exc:
            return JSONResponse(
                status_code=409,
                content={"error": str(exc)},
            )
        except Exception:
            logger.exception(
                "admin_force_advance_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        return JSONResponse(status_code=200, content=result.to_dict())

    return force_advance_endpoint


# ---------------------------------------------------------------------------
# Force rework
# ---------------------------------------------------------------------------


def create_admin_force_rework_endpoint(admin_service_getter: Any) -> Any:
    """Create the admin force-rework endpoint handler.

    Parameters
    ----------
    admin_service_getter : callable
        Returns the current :class:`AdminService` instance, or ``None``.

    Returns
    -------
    coroutine
        An async Starlette request handler for
        ``POST /api/admin/tickets/{ticket_id}/force-rework``.
    """

    async def force_rework_endpoint(request: Request) -> JSONResponse:
        """Handle POST /api/admin/tickets/{ticket_id}/force-rework."""
        auth_err = _require_admin()
        if auth_err is not None:
            return auth_err

        admin_service: AdminService | None = admin_service_getter()
        if admin_service is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Service unavailable"},
            )

        ticket_id: str = request.path_params["ticket_id"]

        try:
            body = await request.json()
        except Exception:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid or missing JSON body"},
            )

        reason = _parse_reason(body)
        if reason is None:
            return JSONResponse(
                status_code=400,
                content={"error": "Field 'reason' is required and must be a non-empty string"},
            )

        ctx = get_auth_context()
        assert ctx is not None
        admin_id = ctx.identity_id

        try:
            result = await admin_service.force_rework(
                ticket_id=ticket_id,
                admin_id=admin_id,
                reason=reason,
            )
        except TicketNotFoundError:
            return JSONResponse(
                status_code=404,
                content={"error": f"Ticket '{ticket_id}' not found"},
            )
        except Exception:
            logger.exception(
                "admin_force_rework_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        return JSONResponse(status_code=200, content=result.to_dict())

    return force_rework_endpoint
