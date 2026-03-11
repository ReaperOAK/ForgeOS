"""MCP tool implementations for ticket lifecycle operations.

Registers ``tickets.next``, ``tickets.claim``, ``tickets.release``,
``tickets.status``, ``tickets.sync``, ``tickets.validate``,
``tickets.advance``, and ``tickets.rework`` tools with the dynamic
:class:`ToolRegistry`.

Public API
----------
* :data:`TICKETS_NEXT_SCHEMA` — JSON Schema for ``tickets.next``.
* :data:`TICKETS_CLAIM_SCHEMA` — JSON Schema for ``tickets.claim``.
* :data:`TICKETS_RELEASE_SCHEMA` — JSON Schema for ``tickets.release``.
* :data:`TICKETS_STATUS_SCHEMA` — JSON Schema for ``tickets.status``.
* :data:`TICKETS_SYNC_SCHEMA` — JSON Schema for ``tickets.sync``.
* :data:`TICKETS_VALIDATE_SCHEMA` — JSON Schema for ``tickets.validate``.
* :data:`TICKETS_ADVANCE_SCHEMA` — JSON Schema for ``tickets.advance``.
* :data:`TICKETS_REWORK_SCHEMA` — JSON Schema for ``tickets.rework``.
* :func:`handle_tickets_next` — async handler for ``tickets.next``.
* :func:`handle_tickets_claim` — async handler for ``tickets.claim``.
* :func:`handle_tickets_release` — async handler for ``tickets.release``.
* :func:`handle_tickets_status` — async handler for ``tickets.status``.
* :func:`handle_tickets_sync` — async handler for ``tickets.sync``.
* :func:`handle_tickets_validate` — async handler for ``tickets.validate``.
* :func:`handle_tickets_advance` — async handler for ``tickets.advance``.
* :func:`handle_tickets_rework` — async handler for ``tickets.rework``.
* :func:`register_ticket_tools` — registers all ticket tools on a registry.

.. meta::
   :ticket: FORGEOS-BE028, FORGEOS-BE029, FORGEOS-BE030, FORGEOS-BE031, FORGEOS-BE032, FORGEOS-BE033
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from mcp_server.locking.claim_queue import ClaimError, NoEligibleTicketError
from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS, TicketNotFoundError
from mcp_server.services.stage_engine import InvalidTransitionError
from mcp_server.services.ticket_service import ClaimOwnershipError, ClaimValidationError
from mcp_server.tools.validation import validate_tool_input

if TYPE_CHECKING:
    from mcp_server.services.ticket_service import TicketService
    from mcp_server.tools.registry import ToolRegistry

logger = get_logger("tools.ticket_tools")

TOOL_NAME = "tickets.next"
CLAIM_TOOL_NAME = "tickets.claim"
SYNC_TOOL_NAME = "tickets.sync"
VALIDATE_TOOL_NAME = "tickets.validate"
RELEASE_TOOL_NAME = "tickets.release"
STATUS_TOOL_NAME = "tickets.status"
ADVANCE_TOOL_NAME = "tickets.advance"
REWORK_TOOL_NAME = "tickets.rework"

TICKETS_NEXT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "agent_role": {
            "type": "string",
            "description": "Agent role name (e.g. 'backend', 'qa', 'frontend').",
            "minLength": 1,
        },
        "machine_id": {
            "type": "string",
            "description": "Hostname of the machine running the agent.",
            "minLength": 1,
        },
        "operator": {
            "type": "string",
            "description": "Human operator initiating the claim.",
            "minLength": 1,
        },
    },
    "required": ["agent_role", "machine_id", "operator"],
    "additionalProperties": False,
}


async def handle_tickets_next(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.next`` tool invocation.

    Validates input against :data:`TICKETS_NEXT_SCHEMA`, then delegates
    to :meth:`TicketService.claim_next` for atomic claiming.

    Parameters
    ----------
    params : dict[str, Any]
        Raw input parameters from the MCP tool call.
    ticket_service : TicketService
        The shared ticket service instance.

    Returns
    -------
    dict[str, Any]
        Claimed ticket data on success, or a structured error response.
    """
    validate_tool_input(TOOL_NAME, TICKETS_NEXT_SCHEMA, params)

    agent_role: str = params["agent_role"]
    machine_id: str = params["machine_id"]
    operator: str = params["operator"]

    logger.info(
        "tickets.next invoked",
        extra={
            "agent_role": agent_role,
            "machine_id": machine_id,
            "operator": operator,
        },
    )

    try:
        result = await ticket_service.claim_next(
            agent_role=agent_role,
            machine_id=machine_id,
            operator=operator,
        )
    except NoEligibleTicketError:
        logger.info(
            "No eligible ticket for role",
            extra={"agent_role": agent_role},
        )
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": f"No eligible ticket for role '{agent_role}'",
        }
    except ValueError as exc:
        logger.warning(
            "Invalid agent role",
            extra={"agent_role": agent_role, "error": str(exc)},
        )
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": str(exc),
        }

    return result.to_dict()


def _make_handler(
    ticket_service: TicketService,
) -> Any:
    """Create a bound handler closure for the tickets.next tool.

    The :class:`ToolRegistry` expects handlers with signature
    ``(params: dict) -> Any``.  This factory binds *ticket_service*
    into the closure so the handler matches that protocol.
    """

    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_next(params, ticket_service=ticket_service)

    return _handler


# ---------------------------------------------------------------------------
# tickets.claim — claim a specific ticket by ID
# ---------------------------------------------------------------------------

TICKETS_CLAIM_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ticket_id": {
            "type": "string",
            "description": "Human-readable ticket ID (e.g. 'FORGEOS-BE006').",
            "minLength": 1,
        },
        "agent_id": {
            "type": "string",
            "description": "Agent role name (e.g. 'backend', 'qa', 'frontend').",
            "minLength": 1,
        },
        "machine_id": {
            "type": "string",
            "description": "Hostname of the machine running the agent.",
            "minLength": 1,
        },
        "operator": {
            "type": "string",
            "description": "Human operator initiating the claim.",
            "minLength": 1,
        },
        "lease_duration_minutes": {
            "type": "integer",
            "description": "Lease duration in minutes (default 30).",
            "minimum": 1,
            "maximum": 1440,
        },
    },
    "required": ["ticket_id", "agent_id", "machine_id", "operator"],
    "additionalProperties": False,
}


async def handle_tickets_claim(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.claim`` tool invocation.

    Validates input against :data:`TICKETS_CLAIM_SCHEMA`, then delegates
    to :meth:`TicketService.claim_by_id` for atomic claiming of a
    specific ticket.

    Parameters
    ----------
    params : dict[str, Any]
        Raw input parameters from the MCP tool call.
    ticket_service : TicketService
        The shared ticket service instance.

    Returns
    -------
    dict[str, Any]
        Claimed ticket data on success, or a structured error response.
    """
    validate_tool_input(CLAIM_TOOL_NAME, TICKETS_CLAIM_SCHEMA, params)

    ticket_id: str = params["ticket_id"]
    agent_id: str = params["agent_id"]
    machine_id: str = params["machine_id"]
    operator: str = params["operator"]
    lease_minutes: int = params.get("lease_duration_minutes", 30)

    logger.info(
        "tickets.claim invoked",
        extra={
            "ticket_id": ticket_id,
            "agent_id": agent_id,
            "machine_id": machine_id,
            "operator": operator,
            "lease_duration_minutes": lease_minutes,
        },
    )

    try:
        result = await ticket_service.claim_by_id(
            ticket_id=ticket_id,
            agent_role=agent_id,
            machine_id=machine_id,
            operator=operator,
            lease_minutes=lease_minutes,
        )
    except NoEligibleTicketError:
        logger.info(
            "Ticket not claimable",
            extra={"ticket_id": ticket_id, "agent_id": agent_id},
        )
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": (
                f"Ticket '{ticket_id}' is not claimable "
                f"(not in READY stage or already claimed)"
            ),
        }
    except ClaimError as exc:
        logger.warning(
            "Claim conflict",
            extra={
                "ticket_id": ticket_id,
                "agent_id": agent_id,
                "error": str(exc),
            },
        )
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": str(exc),
        }
    except ValueError as exc:
        logger.warning(
            "Invalid agent role",
            extra={"agent_id": agent_id, "error": str(exc)},
        )
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": str(exc),
        }

    return result.to_dict()


def _make_claim_handler(
    ticket_service: TicketService,
) -> Any:
    """Create a bound handler closure for the tickets.claim tool."""

    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_claim(params, ticket_service=ticket_service)

    return _handler


# ---------------------------------------------------------------------------
# tickets.release — release a claimed ticket (FORGEOS-BE032)
# ---------------------------------------------------------------------------

TICKETS_RELEASE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ticket_id": {
            "type": "string",
            "description": "Human-readable ticket ID to release.",
            "minLength": 1,
        },
        "agent_id": {
            "type": "string",
            "description": "Agent role name that currently holds the claim.",
            "minLength": 1,
        },
        "reason": {
            "type": "string",
            "description": "Optional reason for releasing the ticket.",
        },
    },
    "required": ["ticket_id", "agent_id"],
    "additionalProperties": False,
}


async def handle_tickets_release(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.release`` tool invocation."""
    validate_tool_input(RELEASE_TOOL_NAME, TICKETS_RELEASE_SCHEMA, params)

    ticket_id: str = params["ticket_id"]
    agent_id: str = params["agent_id"]
    reason: str = params.get("reason", "")

    logger.info(
        "tickets.release invoked",
        extra={"ticket_id": ticket_id, "agent_id": agent_id},
    )

    try:
        result = await ticket_service.release_ticket(
            ticket_id=ticket_id,
            agent_id=agent_id,
            reason=reason,
        )
    except TicketNotFoundError:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": f"Ticket '{ticket_id}' not found",
        }
    except ClaimOwnershipError as exc:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": str(exc),
        }

    return result.to_dict()


def _make_release_handler(
    ticket_service: TicketService,
) -> Any:
    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_release(params, ticket_service=ticket_service)

    return _handler


# ---------------------------------------------------------------------------
# tickets.status — query ticket status (FORGEOS-BE032)
# ---------------------------------------------------------------------------

TICKETS_STATUS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ticket_id": {
            "type": "string",
            "description": "Specific ticket ID to get detail for.",
        },
        "stage": {
            "type": "string",
            "description": "Filter by SDLC stage.",
        },
        "type": {
            "type": "string",
            "description": "Filter by ticket type.",
        },
        "priority": {
            "type": "string",
            "description": "Filter by priority.",
        },
        "page": {
            "type": "integer",
            "description": "Page number (1-based).",
            "minimum": 1,
        },
        "page_size": {
            "type": "integer",
            "description": "Number of results per page.",
            "minimum": 1,
            "maximum": 100,
        },
    },
    "additionalProperties": False,
}


async def handle_tickets_status(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.status`` tool invocation."""
    validate_tool_input(STATUS_TOOL_NAME, TICKETS_STATUS_SCHEMA, params)

    ticket_id: str | None = params.get("ticket_id")

    if ticket_id:
        try:
            detail = await ticket_service.get_ticket_status(ticket_id=ticket_id)
        except TicketNotFoundError:
            return {
                "isError": True,
                "code": INVALID_PARAMS,
                "message": f"Ticket '{ticket_id}' not found",
            }
        return detail.to_dict()

    stage: str | None = params.get("stage")
    ticket_type: str | None = params.get("type")
    priority: str | None = params.get("priority")
    page: int = params.get("page", 1)
    page_size: int = params.get("page_size", 20)

    result = await ticket_service.list_tickets(
        stage=stage,
        ticket_type=ticket_type,
        priority=priority,
        page=page,
        page_size=page_size,
    )
    return result.to_dict()


def _make_status_handler(
    ticket_service: TicketService,
) -> Any:
    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_status(params, ticket_service=ticket_service)

    return _handler


# ---------------------------------------------------------------------------
# tickets.sync — release expired leases and resolve dependencies
# ---------------------------------------------------------------------------

TICKETS_SYNC_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {},
    "additionalProperties": False,
}


async def handle_tickets_sync(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.sync`` tool invocation.

    Releases expired leases, evaluates the dependency graph, and moves
    newly unblocked tickets to READY.
    """
    validate_tool_input(SYNC_TOOL_NAME, TICKETS_SYNC_SCHEMA, params)
    logger.info("tickets.sync invoked")

    try:
        result = await ticket_service.sync()
    except Exception as exc:
        logger.exception("tickets.sync failed")
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": f"Sync failed: {exc}",
        }

    return result.to_dict()


def _make_sync_handler(
    ticket_service: TicketService,
) -> Any:
    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_sync(params, ticket_service=ticket_service)

    return _handler


# ---------------------------------------------------------------------------
# tickets.validate — integrity check across all tickets
# ---------------------------------------------------------------------------

TICKETS_VALIDATE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {},
    "additionalProperties": False,
}


async def handle_tickets_validate(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.validate`` tool invocation.

    Checks every ticket for stage integrity and SDLC flow validity.
    """
    validate_tool_input(VALIDATE_TOOL_NAME, TICKETS_VALIDATE_SCHEMA, params)
    logger.info("tickets.validate invoked")

    try:
        result = await ticket_service.validate()
    except Exception as exc:
        logger.exception("tickets.validate failed")
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": f"Validate failed: {exc}",
        }

    return result.to_dict()


def _make_validate_handler(
    ticket_service: TicketService,
) -> Any:
    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_validate(params, ticket_service=ticket_service)

    return _handler


# ---------------------------------------------------------------------------
# tickets.advance — advance ticket to next SDLC stage (FORGEOS-BE030)
# ---------------------------------------------------------------------------

TICKETS_ADVANCE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ticket_id": {
            "type": "string",
            "description": "Human-readable ticket ID to advance (e.g. 'FORGEOS-BE006').",
            "minLength": 1,
        },
        "agent_id": {
            "type": "string",
            "description": "Agent role name that holds the active claim.",
            "minLength": 1,
        },
        "evidence": {
            "type": "object",
            "description": "Optional completion evidence (artifacts, coverage, etc.).",
            "additionalProperties": True,
        },
    },
    "required": ["ticket_id", "agent_id"],
    "additionalProperties": False,
}


async def handle_tickets_advance(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.advance`` tool invocation.

    Validates input against :data:`TICKETS_ADVANCE_SCHEMA`, then delegates
    to :meth:`TicketService.advance_ticket` for an atomic stage transition
    with SERIALIZABLE isolation.

    Parameters
    ----------
    params : dict[str, Any]
        Raw input parameters from the MCP tool call.
    ticket_service : TicketService
        The shared ticket service instance.

    Returns
    -------
    dict[str, Any]
        Updated ticket data on success, or a structured error response.
    """
    validate_tool_input(ADVANCE_TOOL_NAME, TICKETS_ADVANCE_SCHEMA, params)

    ticket_id: str = params["ticket_id"]
    agent_id: str = params["agent_id"]
    evidence: dict[str, Any] | None = params.get("evidence")

    logger.info(
        "tickets.advance invoked",
        extra={"ticket_id": ticket_id, "agent_id": agent_id},
    )

    try:
        result = await ticket_service.advance_ticket(
            ticket_id=ticket_id,
            agent_id=agent_id,
            evidence=evidence,
        )
    except TicketNotFoundError:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": f"Ticket '{ticket_id}' not found",
        }
    except ClaimValidationError as exc:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": exc.reason,
        }
    except InvalidTransitionError as exc:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": exc.reason,
        }
    except ValueError as exc:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": str(exc),
        }

    return result.to_dict()


def _make_advance_handler(
    ticket_service: TicketService,
) -> Any:
    """Create a bound handler closure for the tickets.advance tool."""

    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_advance(params, ticket_service=ticket_service)

    return _handler


# ---------------------------------------------------------------------------
# tickets.rework — return ticket to implementation stage (FORGEOS-BE031)
# ---------------------------------------------------------------------------

TICKETS_REWORK_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "ticket_id": {
            "type": "string",
            "description": (
                "Human-readable ticket ID to rework (e.g. 'FORGEOS-BE006')."
            ),
            "minLength": 1,
        },
        "agent_id": {
            "type": "string",
            "description": "Agent role name that holds the active claim.",
            "minLength": 1,
        },
        "reason": {
            "type": "string",
            "description": "Rejection reason explaining why rework is needed.",
            "minLength": 1,
        },
        "rejection_evidence": {
            "type": "object",
            "description": (
                "Optional structured evidence (coverage %, failing tests, etc.)."
            ),
            "additionalProperties": True,
        },
    },
    "required": ["ticket_id", "agent_id", "reason"],
    "additionalProperties": False,
}


async def handle_tickets_rework(
    params: dict[str, Any],
    *,
    ticket_service: TicketService,
) -> dict[str, Any]:
    """Handle ``tickets.rework`` tool invocation.

    Validates input against :data:`TICKETS_REWORK_SCHEMA`, then delegates
    to :meth:`TicketService.rework_ticket` for an atomic rework operation
    with SERIALIZABLE isolation.

    Parameters
    ----------
    params : dict[str, Any]
        Raw input parameters from the MCP tool call.
    ticket_service : TicketService
        The shared ticket service instance.

    Returns
    -------
    dict[str, Any]
        Updated ticket data on success, or a structured error response.
    """
    validate_tool_input(REWORK_TOOL_NAME, TICKETS_REWORK_SCHEMA, params)

    ticket_id: str = params["ticket_id"]
    agent_id: str = params["agent_id"]
    reason: str = params["reason"]
    rejection_evidence: dict[str, Any] | None = params.get("rejection_evidence")

    logger.info(
        "tickets.rework invoked",
        extra={"ticket_id": ticket_id, "agent_id": agent_id},
    )

    try:
        result = await ticket_service.rework_ticket(
            ticket_id=ticket_id,
            agent_id=agent_id,
            reason=reason,
            rejection_evidence=rejection_evidence,
        )
    except TicketNotFoundError:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": f"Ticket '{ticket_id}' not found",
        }
    except ClaimValidationError as exc:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": exc.reason,
        }
    except ValueError as exc:
        return {
            "isError": True,
            "code": INVALID_PARAMS,
            "message": str(exc),
        }

    return result.to_dict()


def _make_rework_handler(
    ticket_service: TicketService,
) -> Any:
    """Create a bound handler closure for the tickets.rework tool."""

    async def _handler(params: dict[str, Any]) -> dict[str, Any]:
        return await handle_tickets_rework(params, ticket_service=ticket_service)

    return _handler


def register_ticket_tools(
    registry: ToolRegistry,
    ticket_service: TicketService,
) -> None:
    """Register all ticket-related MCP tools on *registry*.

    Parameters
    ----------
    registry : ToolRegistry
        The dynamic tool registry to register on.
    ticket_service : TicketService
        The shared ticket service consumed by tool handlers.
    """
    registry.register(
        name=TOOL_NAME,
        description=(
            "Claim the next available ticket matching the agent role. "
            "Uses SELECT FOR UPDATE SKIP LOCKED for atomic, non-blocking claiming."
        ),
        input_schema=TICKETS_NEXT_SCHEMA,
        handler=_make_handler(ticket_service),
    )
    registry.register(
        name=CLAIM_TOOL_NAME,
        description=(
            "Claim a specific ticket by its ID. Validates that the ticket "
            "exists, is in READY stage, and the agent role matches the "
            "expected SDLC stage. Returns claimed ticket data on success."
        ),
        input_schema=TICKETS_CLAIM_SCHEMA,
        handler=_make_claim_handler(ticket_service),
    )
    registry.register(
        name=RELEASE_TOOL_NAME,
        description=(
            "Release a claimed ticket back to READY. Validates that the "
            "requesting agent holds the active claim before releasing."
        ),
        input_schema=TICKETS_RELEASE_SCHEMA,
        handler=_make_release_handler(ticket_service),
    )
    registry.register(
        name=STATUS_TOOL_NAME,
        description=(
            "Query ticket status. Pass ticket_id for full detail including "
            "history and current claim, or use filter params for a paginated list."
        ),
        input_schema=TICKETS_STATUS_SCHEMA,
        handler=_make_status_handler(ticket_service),
    )
    registry.register(
        name=SYNC_TOOL_NAME,
        description=(
            "Synchronise ticket state: release expired leases, evaluate "
            "the dependency graph, and move newly unblocked tickets to READY. "
            "Returns a summary of changes made."
        ),
        input_schema=TICKETS_SYNC_SCHEMA,
        handler=_make_sync_handler(ticket_service),
    )
    registry.register(
        name=VALIDATE_TOOL_NAME,
        description=(
            "Run an integrity check across all tickets. Verifies that each "
            "ticket exists in exactly one stage, the stage field matches, and "
            "the SDLC flow is valid. Returns a list of errors (empty = clean)."
        ),
        input_schema=TICKETS_VALIDATE_SCHEMA,
        handler=_make_validate_handler(ticket_service),
    )
    logger.info(
        "Registered ticket tools: %s, %s, %s, %s, %s, %s",
        TOOL_NAME, CLAIM_TOOL_NAME, RELEASE_TOOL_NAME, STATUS_TOOL_NAME,
        SYNC_TOOL_NAME, VALIDATE_TOOL_NAME,
    )
    registry.register(
        name=ADVANCE_TOOL_NAME,
        description=(
            "Advance a ticket to its next SDLC stage. Validates the agent "
            "holds the active claim and enforces the SDLC flow order. "
            "Uses SERIALIZABLE transaction isolation for state integrity."
        ),
        input_schema=TICKETS_ADVANCE_SCHEMA,
        handler=_make_advance_handler(ticket_service),
    )
    logger.info("Registered advance tool: %s", ADVANCE_TOOL_NAME)
    registry.register(
        name=REWORK_TOOL_NAME,
        description=(
            "Return a ticket to its implementation stage with rejection "
            "evidence. Increments rework_count and escalates if the maximum "
            "rework limit (3) is reached. Releases the current claim."
        ),
        input_schema=TICKETS_REWORK_SCHEMA,
        handler=_make_rework_handler(ticket_service),
    )
    logger.info("Registered rework tool: %s", REWORK_TOOL_NAME)
