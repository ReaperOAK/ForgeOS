"""Ticket list REST endpoint.

Provides a Starlette route handler for querying tickets at
``GET /api/tickets`` with filtering and pagination.

Query parameters:
- ``stage``: Filter by SDLC stage
- ``type``: Filter by ticket type
- ``priority``: Filter by priority
- ``claimed_by``: Filter by claimed agent name
- ``machine_id``: Filter by machine identifier
- ``limit``: Max rows (default 50, max 200)
- ``offset``: Pagination offset (default 0)

.. meta::
   :ticket: FORGEOS-BE034
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from starlette.responses import JSONResponse

from mcp_server.api.schemas import (
    PaginationMeta,
    TicketListResponse,
    TicketPriorityEnum,
    TicketStageEnum,
    TicketSummary,
    TicketTypeEnum,
)
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from starlette.requests import Request

    from mcp_server.repositories.ticket_repo import TicketRepository

logger = get_logger("api.routes.tickets")

_MAX_LIMIT = 200
_DEFAULT_LIMIT = 50


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


def _validate_enum(value: str | None, enum_cls: type, param_name: str) -> str | None:
    """Validate a query param against an enum, returning None or the valid value.

    Returns the validated value string, or raises ValueError with a
    descriptive message if the value is not a member of the enum.
    """
    if value is None:
        return None
    valid_values = {e.value for e in enum_cls}
    if value not in valid_values:
        raise ValueError(
            f"Invalid value for '{param_name}': '{value}'. "
            f"Must be one of: {sorted(valid_values)}"
        )
    return value


def create_tickets_endpoint(ticket_repo_getter: Any) -> Any:
    """Create the ticket list endpoint handler.

    Parameters
    ----------
    ticket_repo_getter : callable
        A callable that returns the current ``TicketRepository`` instance,
        or ``None`` if the database is unavailable.

    Returns
    -------
    coroutine
        An async Starlette request handler.
    """

    async def tickets_endpoint(request: Request) -> JSONResponse:
        """Handle GET /api/tickets requests."""
        ticket_repo: TicketRepository | None = ticket_repo_getter()
        if ticket_repo is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Database unavailable"},
            )

        params = request.query_params

        # Parse and validate filters
        try:
            stage = _validate_enum(
                params.get("stage"), TicketStageEnum, "stage"
            )
            ticket_type = _validate_enum(
                params.get("type"), TicketTypeEnum, "type"
            )
            priority = _validate_enum(
                params.get("priority"), TicketPriorityEnum, "priority"
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=400,
                content={"error": str(exc)},
            )

        claimed_by = params.get("claimed_by") or None
        machine_id = params.get("machine_id") or None
        limit = _parse_int(params.get("limit"), _DEFAULT_LIMIT, _MAX_LIMIT)
        offset = _parse_int(params.get("offset"), 0)

        try:
            rows, total = await ticket_repo.list_tickets(
                stage=stage,
                ticket_type=ticket_type,
                priority=priority,
                claimed_by=claimed_by,
                machine_id=machine_id,
                limit=limit,
                offset=offset,
            )
        except Exception:
            logger.exception("ticket_list_query_failed")
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        summaries = [
            TicketSummary(
                ticket_id=row.ticket_id,
                title=row.title,
                type=row.type,
                priority=row.priority,
                stage=row.stage,
                status=row.status,
                claimed_by_name=row.claimed_by_name,
                machine_id=row.machine_id,
                operator=row.operator,
                rework_count=row.rework_count,
                tags=row.tags,
                created_at=row.created_at,
                updated_at=row.updated_at,
            )
            for row in rows
        ]

        response = TicketListResponse(
            tickets=summaries,
            pagination=PaginationMeta(total=total, limit=limit, offset=offset),
        )

        return JSONResponse(
            status_code=200,
            content=response.model_dump(mode="json"),
        )

    return tickets_endpoint
