"""Ticket REST endpoints.

Provides Starlette route handlers for:
- ``GET /api/tickets`` — list with filtering and pagination
- ``GET /api/tickets/{ticket_id}`` — full ticket detail with resolved deps
- ``GET /api/tickets/{ticket_id}/history`` — event/audit history with pagination
- ``POST /api/tickets/{ticket_id}/claim`` — claim a ticket
- ``DELETE /api/tickets/{ticket_id}/claim`` — release a claim

Query parameters (list):
- ``stage``: Filter by SDLC stage
- ``type``: Filter by ticket type
- ``priority``: Filter by priority
- ``claimed_by``: Filter by claimed agent name
- ``machine_id``: Filter by machine identifier
- ``limit``: Max rows (default 50, max 200)
- ``offset``: Pagination offset (default 0)

Query parameters (history):
- ``limit``: Max rows (default 50, max 200)
- ``offset``: Pagination offset (default 0)

.. meta::
   :ticket: FORGEOS-BE034, FORGEOS-BE035, FORGEOS-BE036
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from pydantic import ValidationError
from starlette.responses import JSONResponse

from mcp_server.api.schemas import (
    ClaimRequest,
    ClaimResponse,
    DependencyInfo,
    HistoryEntry,
    HistoryListResponse,
    PaginationMeta,
    ReleaseResponse,
    TicketDetailResponse,
    TicketListResponse,
    TicketPriorityEnum,
    TicketStageEnum,
    TicketSummary,
    TicketTypeEnum,
)
from mcp_server.locking.claim_queue import ClaimError, NoEligibleTicketError
from mcp_server.observability import get_logger
from mcp_server.server import TicketNotFoundError
from mcp_server.services.ticket_service import ClaimOwnershipError

if TYPE_CHECKING:
    from starlette.requests import Request

    from mcp_server.events.event_store import EventStore
    from mcp_server.repositories.ticket_repo import TicketRepository
    from mcp_server.services.ticket_service import TicketService

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


def create_ticket_detail_endpoint(ticket_repo_getter: Any) -> Any:
    """Create the ticket detail endpoint handler.

    Parameters
    ----------
    ticket_repo_getter : callable
        A callable that returns the current ``TicketRepository`` instance,
        or ``None`` if the database is unavailable.

    Returns
    -------
    coroutine
        An async Starlette request handler for ``GET /api/tickets/{ticket_id}``.
    """

    async def ticket_detail_endpoint(request: Request) -> JSONResponse:
        """Handle GET /api/tickets/{ticket_id} requests."""
        ticket_repo: TicketRepository | None = ticket_repo_getter()
        if ticket_repo is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Database unavailable"},
            )

        ticket_id: str = request.path_params["ticket_id"]

        try:
            ticket = await ticket_repo.get_by_id(ticket_id)
        except Exception:
            logger.exception("ticket_detail_query_failed", extra={"ticket_id": ticket_id})
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        if ticket is None:
            return JSONResponse(
                status_code=404,
                content={"error": f"Ticket '{ticket_id}' not found"},
            )

        # Resolve dependency statuses
        resolved_deps: list[DependencyInfo] = []
        for dep_id in ticket.depends_on:
            try:
                dep_ticket = await ticket_repo.get_by_id(dep_id)
            except Exception:
                logger.warning(
                    "dependency_lookup_failed",
                    extra={"ticket_id": ticket_id, "dep_id": dep_id},
                )
                dep_ticket = None

            if dep_ticket is not None:
                resolved_deps.append(
                    DependencyInfo(
                        ticket_id=dep_id,
                        title=dep_ticket.title,
                        stage=dep_ticket.stage,
                        is_done=dep_ticket.stage == "DONE",
                    )
                )
            else:
                resolved_deps.append(
                    DependencyInfo(ticket_id=dep_id)
                )

        response = TicketDetailResponse(
            ticket_id=ticket.ticket_id,
            title=ticket.title,
            description=ticket.description,
            type=ticket.type,
            priority=ticket.priority,
            stage=ticket.stage,
            status=ticket.status,
            sdlc_flow=ticket.sdlc_flow,
            claimed_by_name=ticket.claimed_by_name,
            machine_id=ticket.machine_id,
            operator=ticket.operator,
            lease_expiry=ticket.lease_expiry,
            depends_on=ticket.depends_on,
            resolved_dependencies=resolved_deps,
            file_paths=ticket.file_paths,
            acceptance_criteria=ticket.acceptance_criteria,
            tags=ticket.tags,
            rework_count=ticket.rework_count,
            source_task_file=ticket.source_task_file,
            created_at=ticket.created_at,
            updated_at=ticket.updated_at,
            completed_at=ticket.completed_at,
        )

        return JSONResponse(
            status_code=200,
            content=response.model_dump(mode="json"),
        )

    return ticket_detail_endpoint


def create_ticket_history_endpoint(
    ticket_repo_getter: Any, event_store_getter: Any
) -> Any:
    """Create the ticket history endpoint handler.

    Parameters
    ----------
    ticket_repo_getter : callable
        A callable that returns the current ``TicketRepository`` instance.
    event_store_getter : callable
        A callable that returns the current ``EventStore`` instance.

    Returns
    -------
    coroutine
        An async Starlette request handler for
        ``GET /api/tickets/{ticket_id}/history``.
    """

    async def ticket_history_endpoint(request: Request) -> JSONResponse:
        """Handle GET /api/tickets/{ticket_id}/history requests."""
        ticket_repo: TicketRepository | None = ticket_repo_getter()
        if ticket_repo is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Database unavailable"},
            )

        event_store: EventStore | None = event_store_getter()
        if event_store is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Event store unavailable"},
            )

        ticket_id: str = request.path_params["ticket_id"]
        params = request.query_params
        limit = _parse_int(params.get("limit"), _DEFAULT_LIMIT, _MAX_LIMIT)
        offset = _parse_int(params.get("offset"), 0)

        # Verify ticket exists
        try:
            ticket = await ticket_repo.get_by_id(ticket_id)
        except Exception:
            logger.exception(
                "ticket_history_lookup_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        if ticket is None:
            return JSONResponse(
                status_code=404,
                content={"error": f"Ticket '{ticket_id}' not found"},
            )

        # Retrieve events from the event store
        try:
            all_events = event_store.replay_ticket_events(ticket_id)
        except Exception:
            logger.exception(
                "ticket_history_events_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        total = len(all_events)
        paginated = all_events[offset : offset + limit]

        entries = [
            HistoryEntry(
                event_type=ev.event_type.value
                if hasattr(ev.event_type, "value")
                else str(ev.event_type),
                agent_id=ev.agent_id,
                machine_id=ev.machine_id,
                timestamp=ev.timestamp,
                previous_stage=ev.previous_stage,
                new_stage=ev.new_stage,
                payload=ev.payload,
                sequence_number=ev.sequence_number,
                aggregate_version=ev.aggregate_version,
            )
            for ev in paginated
        ]

        response = HistoryListResponse(
            ticket_id=ticket_id,
            events=entries,
            pagination=PaginationMeta(total=total, limit=limit, offset=offset),
        )

        return JSONResponse(
            status_code=200,
            content=response.model_dump(mode="json"),
        )

    return ticket_history_endpoint


def create_claim_endpoint(
    ticket_service_getter: Any,
    ticket_repo_getter: Any,
) -> Any:
    """Create the claim/release endpoint handler.

    Supports ``POST`` to claim a ticket and ``DELETE`` to release a claim.

    Parameters
    ----------
    ticket_service_getter : callable
        Returns the current :class:`TicketService` instance, or ``None``.
    ticket_repo_getter : callable
        Returns the current :class:`TicketRepository` instance, or ``None``.

    Returns
    -------
    coroutine
        An async Starlette request handler for
        ``POST/DELETE /api/tickets/{ticket_id}/claim``.

    .. meta::
       :ticket: FORGEOS-BE036
    """

    async def claim_endpoint(request: Request) -> JSONResponse:
        """Handle POST/DELETE /api/tickets/{ticket_id}/claim."""
        if request.method == "POST":
            return await _handle_claim(request)
        return await _handle_release(request)

    async def _handle_claim(request: Request) -> JSONResponse:
        """POST — claim a ticket."""
        ticket_service: TicketService | None = ticket_service_getter()
        ticket_repo: TicketRepository | None = ticket_repo_getter()
        if ticket_service is None or ticket_repo is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Service unavailable"},
            )

        ticket_id: str = request.path_params["ticket_id"]

        # Parse and validate request body
        try:
            body = await request.json()
        except Exception:
            return JSONResponse(
                status_code=400,
                content={"error": "Invalid or missing JSON body"},
            )

        try:
            claim_req = ClaimRequest(**body)
        except ValidationError as exc:
            return JSONResponse(
                status_code=400,
                content={"error": str(exc)},
            )

        # Check ticket exists → 404
        try:
            ticket = await ticket_repo.get_by_id(ticket_id)
        except Exception:
            logger.exception(
                "ticket_claim_lookup_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        if ticket is None:
            return JSONResponse(
                status_code=404,
                content={"error": f"Ticket '{ticket_id}' not found"},
            )

        # Attempt claim via service
        try:
            result = await ticket_service.claim_by_id(
                ticket_id=ticket_id,
                agent_role=claim_req.agent_id,
                machine_id=claim_req.machine_id,
                operator=claim_req.operator,
                lease_minutes=claim_req.lease_duration_minutes,
            )
        except NoEligibleTicketError as exc:
            return JSONResponse(
                status_code=409,
                content={"error": str(exc)},
            )
        except ClaimError as exc:
            return JSONResponse(
                status_code=409,
                content={"error": str(exc)},
            )
        except ValueError as exc:
            return JSONResponse(
                status_code=400,
                content={"error": str(exc)},
            )
        except Exception:
            logger.exception(
                "ticket_claim_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        response = ClaimResponse(
            ticket_id=result.ticket_id,
            title=result.title,
            type=result.ticket_type,
            stage=result.stage,
            file_paths=result.file_paths,
            acceptance_criteria=result.acceptance_criteria,
        )

        return JSONResponse(
            status_code=200,
            content=response.model_dump(mode="json"),
        )

    async def _handle_release(request: Request) -> JSONResponse:
        """DELETE — release a claim."""
        ticket_service: TicketService | None = ticket_service_getter()
        if ticket_service is None:
            return JSONResponse(
                status_code=503,
                content={"error": "Service unavailable"},
            )

        ticket_id: str = request.path_params["ticket_id"]
        params = request.query_params
        agent_id: str | None = params.get("agent_id")
        reason: str = params.get("reason", "")

        if not agent_id:
            return JSONResponse(
                status_code=400,
                content={"error": "Query parameter 'agent_id' is required"},
            )

        try:
            result = await ticket_service.release_ticket(
                ticket_id=ticket_id,
                agent_id=agent_id,
                reason=reason,
            )
        except TicketNotFoundError:
            return JSONResponse(
                status_code=404,
                content={"error": f"Ticket '{ticket_id}' not found"},
            )
        except ClaimOwnershipError as exc:
            return JSONResponse(
                status_code=409,
                content={"error": str(exc)},
            )
        except Exception:
            logger.exception(
                "ticket_release_failed",
                extra={"ticket_id": ticket_id},
            )
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error"},
            )

        response = ReleaseResponse(
            ticket_id=result.ticket_id,
            previous_stage=result.previous_stage,
            released_by=result.released_by,
            reason=result.reason,
        )

        return JSONResponse(
            status_code=200,
            content=response.model_dump(mode="json"),
        )

    return claim_endpoint
