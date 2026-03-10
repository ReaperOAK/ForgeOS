"""ForgeOS services — business logic orchestration layer.

Public API
----------
* :class:`TicketService` — ticket lifecycle orchestration (claim, query).
* :class:`NextTicketResult` — typed claim result.
* :class:`MachineService` — machine auth orchestration.
"""

from mcp_server.services.ticket_service import NextTicketResult, TicketService

__all__ = [
    "NextTicketResult",
    "TicketService",
]
