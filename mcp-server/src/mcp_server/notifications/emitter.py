"""State change notification emitter for ticket lifecycle events.

Publishes fire-and-forget notification events to the
:class:`~mcp_server.notifications.queue.NotificationQueue` when ticket
state transitions occur (claim, advance, release, rework).

The emitter is designed to be injected into :class:`TicketService` so
that all state-change notification logic resides in one module.

.. meta::
   :ticket: FORGEOS-BE065
   :last_reviewed: 2026-03-11
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from mcp_server.notifications.queue import NotificationQueue

logger = get_logger("notifications.emitter")


class EventType(str, Enum):
    """Registered notification event types for ticket state changes."""

    TICKET_CLAIMED = "ticket.claimed"
    TICKET_ADVANCED = "ticket.advanced"
    TICKET_RELEASED = "ticket.released"
    TICKET_REWORKED = "ticket.reworked"


class StateChangeEmitter:
    """Fire-and-forget emitter that enqueues notification events.

    All ``emit_*`` methods catch exceptions internally so that a
    notification failure never blocks the ticket state transition.

    Parameters
    ----------
    queue : NotificationQueue
        The notification queue to publish events to.
    """

    def __init__(self, *, queue: NotificationQueue) -> None:
        self._queue = queue

    async def _emit(self, event_type: str, payload: dict[str, Any]) -> None:
        """Enqueue a notification event, swallowing any errors."""
        try:
            await self._queue.enqueue(event_type=event_type, payload=payload)
        except Exception:
            logger.exception(
                "Failed to emit notification event (fire-and-forget)",
                extra={
                    "event_type": event_type,
                    "ticket_id": payload.get("ticket_id"),
                },
            )

    async def emit_claimed(
        self,
        *,
        ticket_id: str,
        stage: str,
        agent_id: str,
        machine_id: str = "",
        operator: str = "",
    ) -> None:
        """Emit a ``ticket.claimed`` notification.

        Parameters
        ----------
        ticket_id : str
            The claimed ticket identifier.
        stage : str
            The SDLC stage the ticket was claimed into.
        agent_id : str
            The agent that claimed the ticket.
        machine_id : str
            Machine hostname (optional).
        operator : str
            Human operator name (optional).
        """
        payload: dict[str, Any] = {
            "ticket_id": ticket_id,
            "old_stage": "READY",
            "new_stage": stage,
            "agent_id": agent_id,
            "machine_id": machine_id,
            "operator": operator,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._emit(EventType.TICKET_CLAIMED, payload)

    async def emit_advanced(
        self,
        *,
        ticket_id: str,
        old_stage: str,
        new_stage: str,
        agent_id: str,
        evidence: dict[str, Any] | None = None,
    ) -> None:
        """Emit a ``ticket.advanced`` notification.

        Parameters
        ----------
        ticket_id : str
            The advanced ticket identifier.
        old_stage : str
            The stage before advancement.
        new_stage : str
            The stage after advancement.
        agent_id : str
            The agent that advanced the ticket.
        evidence : dict[str, Any] | None
            Optional completion evidence.
        """
        payload: dict[str, Any] = {
            "ticket_id": ticket_id,
            "old_stage": old_stage,
            "new_stage": new_stage,
            "agent_id": agent_id,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        if evidence is not None:
            payload["evidence"] = evidence
        await self._emit(EventType.TICKET_ADVANCED, payload)

    async def emit_released(
        self,
        *,
        ticket_id: str,
        stage: str,
        agent_id: str,
        reason: str = "",
    ) -> None:
        """Emit a ``ticket.released`` notification.

        Parameters
        ----------
        ticket_id : str
            The released ticket identifier.
        stage : str
            The stage the ticket was released from.
        agent_id : str
            The agent that released the ticket.
        reason : str
            Optional release reason.
        """
        payload: dict[str, Any] = {
            "ticket_id": ticket_id,
            "old_stage": stage,
            "new_stage": "READY",
            "agent_id": agent_id,
            "reason": reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._emit(EventType.TICKET_RELEASED, payload)

    async def emit_reworked(
        self,
        *,
        ticket_id: str,
        old_stage: str,
        new_stage: str,
        agent_id: str,
        reason: str,
    ) -> None:
        """Emit a ``ticket.reworked`` notification.

        Parameters
        ----------
        ticket_id : str
            The reworked ticket identifier.
        old_stage : str
            The stage the rejection came from.
        new_stage : str
            The stage the ticket is sent back to.
        agent_id : str
            The agent that rejected the ticket.
        reason : str
            Rejection reason.
        """
        payload: dict[str, Any] = {
            "ticket_id": ticket_id,
            "old_stage": old_stage,
            "new_stage": new_stage,
            "agent_id": agent_id,
            "reason": reason,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
        await self._emit(EventType.TICKET_REWORKED, payload)
