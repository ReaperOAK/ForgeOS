"""MCP tool implementation for ``tickets.next``.

Registers the ``tickets.next`` tool with the dynamic :class:`ToolRegistry`,
allowing agents to claim the next available ticket matching their role.
Input is validated against a JSON Schema definition before the handler
is invoked.

Public API
----------
* :data:`TICKETS_NEXT_SCHEMA` — JSON Schema for the tool's input parameters.
* :func:`handle_tickets_next` — async handler for the ``tickets.next`` tool.
* :func:`register_ticket_tools` — registers all ticket tools on a registry.

.. meta::
   :ticket: FORGEOS-BE028
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from mcp_server.locking.claim_queue import NoEligibleTicketError
from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS
from mcp_server.tools.validation import validate_tool_input

if TYPE_CHECKING:
    from mcp_server.services.ticket_service import TicketService
    from mcp_server.tools.registry import ToolRegistry

logger = get_logger("tools.ticket_tools")

TOOL_NAME = "tickets.next"

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
    logger.info("Registered ticket tools: %s", TOOL_NAME)
