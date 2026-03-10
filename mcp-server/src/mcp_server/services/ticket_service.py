"""Ticket service — shared business logic for ticket operations.

Provides :class:`TicketService`, a high-level orchestration layer that
coordinates the claim queue, role mapping, and repository access for
ticket lifecycle operations.  Both MCP tool handlers and REST endpoints
consume this service — keeping business logic in one place.

Public API
----------
* :class:`TicketService` — claim, query, and manage tickets.
* :class:`NextTicketResult` — typed result of :meth:`TicketService.claim_next`.

.. meta::
   :ticket: FORGEOS-BE028
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any

from mcp_server.locking.claim_queue import (
    AgentRoleMap,
    ClaimQueue,
    ClaimResult,
    NoEligibleTicketError,
)
from mcp_server.observability import get_logger

logger = get_logger("services.ticket_service")


@dataclass(frozen=True, slots=True)
class NextTicketResult:
    """Typed result returned by :meth:`TicketService.claim_next`.

    Attributes
    ----------
    ticket_id : str
        Human-readable ticket identifier (e.g. ``"FORGEOS-BE006"``).
    title : str
        Ticket title.
    ticket_type : str
        Ticket type (e.g. ``"backend"``).
    stage : str
        Current SDLC stage after claiming.
    file_paths : list[str]
        Files within the ticket scope.
    acceptance_criteria : list[str]
        Ticket acceptance criteria.
    """

    ticket_id: str
    title: str
    ticket_type: str
    stage: str
    file_paths: list[str] = field(default_factory=lambda: list[str]())
    acceptance_criteria: list[str] = field(default_factory=lambda: list[str]())

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict suitable for MCP tool output."""
        return {
            "ticket_id": self.ticket_id,
            "title": self.title,
            "type": self.ticket_type,
            "stage": self.stage,
            "file_paths": self.file_paths,
            "acceptance_criteria": self.acceptance_criteria,
        }


class TicketService:
    """High-level service wrapping ticket lifecycle operations.

    This service is the shared module consumed by both the MCP tool layer
    and the REST API layer.  It coordinates the :class:`ClaimQueue`,
    :class:`AgentRoleMap`, and repositories to implement ticket operations.

    Parameters
    ----------
    claim_queue : ClaimQueue
        The SKIP LOCKED claim queue for atomic ticket claiming.
    """

    def __init__(self, claim_queue: ClaimQueue) -> None:
        self._claim_queue = claim_queue

    async def claim_next(
        self,
        *,
        agent_role: str,
        machine_id: str,
        operator: str,
        lease_minutes: int = 30,
    ) -> NextTicketResult:
        """Claim the next available ticket matching *agent_role*.

        Resolves the agent role to its compatible SDLC stage via
        :class:`AgentRoleMap`, then delegates to the :class:`ClaimQueue`
        for atomic claiming with ``SELECT FOR UPDATE SKIP LOCKED``.

        Parameters
        ----------
        agent_role : str
            Agent role name (e.g. ``"backend"``).
        machine_id : str
            Hostname of the machine running the agent.
        operator : str
            Human operator initiating the claim.
        lease_minutes : int
            Lease duration in minutes (default 30).

        Returns
        -------
        NextTicketResult
            Claimed ticket data.

        Raises
        ------
        NoEligibleTicketError
            If no ticket is available for the given role.
        ValueError
            If *agent_role* is not a recognised role.
        """
        stage = AgentRoleMap.stage_for_role(agent_role)
        if stage is None:
            logger.warning(
                "Unknown agent role",
                extra={"agent_role": agent_role},
            )
            raise ValueError(f"Unknown agent role: {agent_role}")

        agent_id = str(uuid.uuid4())

        logger.info(
            "Claiming next ticket",
            extra={
                "agent_role": agent_role,
                "stage": stage,
                "machine_id": machine_id,
                "operator": operator,
            },
        )

        result: ClaimResult | None = await self._claim_queue.claim_next(
            stage=stage,
            agent_id=agent_id,
            agent_name=agent_role,
            machine_id=machine_id,
            operator=operator,
            lease_minutes=lease_minutes,
        )

        if result is None:
            logger.info(
                "No eligible ticket found",
                extra={"agent_role": agent_role, "stage": stage},
            )
            raise NoEligibleTicketError(
                f"No eligible ticket for role '{agent_role}' at stage '{stage}'"
            )

        logger.info(
            "Ticket claimed via service",
            extra={
                "ticket_id": result.ticket_id,
                "agent_role": agent_role,
                "stage": result.stage,
            },
        )

        return NextTicketResult(
            ticket_id=result.ticket_id,
            title=result.title,
            ticket_type=result.ticket_type,
            stage=result.stage,
            file_paths=result.file_paths,
            acceptance_criteria=result.acceptance_criteria,
        )
