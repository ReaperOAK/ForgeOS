"""Ticket service — shared business logic for ticket operations.

Provides :class:`TicketService`, a high-level orchestration layer that
coordinates the claim queue, role mapping, and repository access for
ticket lifecycle operations.  Both MCP tool handlers and REST endpoints
consume this service — keeping business logic in one place.

Public API
----------
* :class:`TicketService` — claim, query, release, and manage tickets.
* :class:`NextTicketResult` — typed result of :meth:`TicketService.claim_next`.
* :class:`ClaimOwnershipError` — raised when release caller is not the claim owner.
* :class:`ReleaseResult` — typed result of :meth:`TicketService.release_ticket`.
* :class:`TicketDetail` — full ticket detail with history and claim.
* :class:`TicketListResult` — paginated ticket list result.

.. meta::
   :ticket: FORGEOS-BE028, FORGEOS-BE032
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from mcp_server.auth.authorization import check_role_stage_authorization
from mcp_server.locking.claim_queue import (
    AgentRoleMap,
    ClaimQueue,
    ClaimResult,
    NoEligibleTicketError,
)
from mcp_server.locking.transaction_config import OperationType, PoolLike, transactional
from mcp_server.observability import get_logger
from mcp_server.server import TicketNotFoundError
from mcp_server.services.stage_engine import validate_advance

if TYPE_CHECKING:
    from mcp_server.repositories.claim_repo import ClaimRepository
    from mcp_server.repositories.event_repo import EventRepository
    from mcp_server.repositories.ticket_repo import TicketRepository
    from mcp_server.services.sync_engine import SyncResult, ValidateResult

logger = get_logger("services.ticket_service")


class ClaimOwnershipError(Exception):
    """Raised when the releasing agent does not own the active claim."""


@dataclass(frozen=True, slots=True)
class ReleaseResult:
    """Typed result of :meth:`TicketService.release_ticket`."""

    ticket_id: str
    previous_stage: str
    released_by: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "previous_stage": self.previous_stage,
            "released_by": self.released_by,
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class TicketDetail:
    """Full ticket detail including optional history and claim."""

    ticket_id: str
    title: str
    description: str
    ticket_type: str
    priority: str
    stage: str
    status: str
    file_paths: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    current_claim: dict[str, Any] | None = None
    history: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "title": self.title,
            "description": self.description,
            "type": self.ticket_type,
            "priority": self.priority,
            "stage": self.stage,
            "status": self.status,
            "file_paths": self.file_paths,
            "acceptance_criteria": self.acceptance_criteria,
            "depends_on": self.depends_on,
            "current_claim": self.current_claim,
            "history": self.history,
        }


@dataclass(frozen=True, slots=True)
class TicketListResult:
    """Paginated list of tickets."""

    tickets: list[dict[str, Any]]
    total: int
    page: int
    page_size: int

    def to_dict(self) -> dict[str, Any]:
        return {
            "tickets": self.tickets,
            "total": self.total,
            "page": self.page,
            "page_size": self.page_size,
        }


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


@dataclass(frozen=True, slots=True)
class AdvanceTicketResult:
    """Typed result returned by :meth:`TicketService.advance_ticket`."""

    ticket_id: str
    title: str
    ticket_type: str
    previous_stage: str
    new_stage: str
    status: str

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict suitable for MCP tool output."""
        return {
            "ticket_id": self.ticket_id,
            "title": self.title,
            "type": self.ticket_type,
            "previous_stage": self.previous_stage,
            "new_stage": self.new_stage,
            "status": self.status,
        }


class ClaimValidationError(Exception):
    """Raised when the advancing agent does not hold the active claim."""

    def __init__(self, ticket_id: str, agent_id: str, reason: str) -> None:
        self.ticket_id = ticket_id
        self.agent_id = agent_id
        self.reason = reason
        super().__init__(
            f"Claim validation failed for '{ticket_id}' by '{agent_id}': {reason}"
        )


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

    def __init__(
        self,
        claim_queue: ClaimQueue,
        *,
        pool: PoolLike | None = None,
        claim_repo: ClaimRepository | None = None,
        ticket_repo: TicketRepository | None = None,
        event_repo: EventRepository | None = None,
    ) -> None:
        self._claim_queue = claim_queue
        self._pool = pool
        self._claim_repo = claim_repo
        self._ticket_repo = ticket_repo
        self._event_repo = event_repo

    async def claim_next(
        self,
        *,
        agent_role: str,
        machine_id: str,
        operator: str,
        lease_minutes: int = 30,
        role_override: str | None = None,
        target_stage: str | None = None,
    ) -> NextTicketResult:
        """Claim the next available ticket matching *agent_role*.

        Resolves the agent role to its compatible SDLC stage via
        :class:`AgentRoleMap`, then delegates to the :class:`ClaimQueue`
        for atomic claiming with ``SELECT FOR UPDATE SKIP LOCKED``.

        Before claiming, validates that the agent's role is authorized
        for the ticket's SDLC stage via :func:`check_role_stage_authorization`.

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
        role_override : str | None
            When an operator claims on behalf of an agent, the actual
            agent role to authorize.
        target_stage : str | None
            Explicit target stage to validate against.

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
        RoleStageMismatchError
            If the agent role is not authorized for the target stage.
        """
        # Determine the effective role for stage resolution.
        effective_role = role_override if role_override else agent_role

        stage = AgentRoleMap.stage_for_role(effective_role)
        if stage is None:
            logger.warning(
                "Unknown agent role",
                extra={"agent_role": effective_role},
            )
            raise ValueError(f"Unknown agent role: {effective_role}")

        # Role-stage authorization check (FORGEOS-BE055).
        check_stage = target_stage if target_stage else stage
        check_role_stage_authorization(
            agent_role, check_stage, role_override=role_override,
        )

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

    async def claim_by_id(
        self,
        *,
        ticket_id: str,
        agent_role: str,
        machine_id: str,
        operator: str,
        lease_minutes: int = 30,
    ) -> NextTicketResult:
        """Claim a specific ticket by its human-readable ID.

        Resolves the agent role to its compatible SDLC stage via
        :class:`AgentRoleMap`, then delegates to :meth:`ClaimQueue.claim_by_id`
        for atomic claiming with ``SELECT FOR UPDATE SKIP LOCKED``.

        Parameters
        ----------
        ticket_id : str
            Human-readable ticket ID (e.g. ``"FORGEOS-BE006"``).
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
            If the ticket is not claimable (wrong stage, already claimed).
        ClaimError
            If a file conflict exists on the ticket's file_paths.
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
            "Claiming ticket by ID",
            extra={
                "ticket_id": ticket_id,
                "agent_role": agent_role,
                "stage": stage,
                "machine_id": machine_id,
                "operator": operator,
            },
        )

        result: ClaimResult | None = await self._claim_queue.claim_by_id(
            ticket_id=ticket_id,
            agent_id=agent_id,
            agent_name=agent_role,
            machine_id=machine_id,
            operator=operator,
            lease_minutes=lease_minutes,
        )

        if result is None:
            logger.info(
                "Ticket not claimable",
                extra={"ticket_id": ticket_id, "agent_role": agent_role},
            )
            raise NoEligibleTicketError(
                f"Ticket '{ticket_id}' is not claimable "
                f"(not in READY stage or already claimed)"
            )

        logger.info(
            "Ticket claimed by ID via service",
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

    # ------------------------------------------------------------------
    # Release & status operations (FORGEOS-BE032)
    # ------------------------------------------------------------------

    def _require_repos(self) -> None:
        if self._ticket_repo is None or self._claim_repo is None or self._event_repo is None:
            raise RuntimeError("Repositories not configured for this TicketService instance")

    async def release_ticket(
        self,
        *,
        ticket_id: str,
        agent_id: str,
        reason: str = "",
    ) -> ReleaseResult:
        """Release a claimed ticket, returning it to READY."""
        self._require_repos()
        assert self._ticket_repo is not None
        assert self._claim_repo is not None
        assert self._event_repo is not None

        ticket = await self._ticket_repo.get_by_id(ticket_id)
        if ticket is None:
            raise TicketNotFoundError(f"Ticket '{ticket_id}' not found")

        claim = await self._claim_repo.get_active_claim(ticket_id)
        if claim is None:
            raise ClaimOwnershipError(f"Ticket '{ticket_id}' has no active claim")
        if claim.claimed_by_name != agent_id:
            raise ClaimOwnershipError(
                f"Agent '{agent_id}' does not own the claim on '{ticket_id}' "
                f"(claimed by '{claim.claimed_by_name}')"
            )

        await self._claim_repo.release_claim(ticket_id)

        payload: dict[str, Any] = {"reason": reason} if reason else {}
        await self._event_repo.append_event(
            ticket_id=ticket_id,
            event_type="RELEASED",
            agent_name=agent_id,
            previous_stage=ticket.stage,
            new_stage="READY",
            previous_status=ticket.status,
            new_status="READY",
            payload=payload,
        )

        return ReleaseResult(
            ticket_id=ticket_id,
            previous_stage=ticket.stage,
            released_by=agent_id,
            reason=reason,
        )

    async def get_ticket_status(self, *, ticket_id: str) -> TicketDetail:
        """Return full detail for a single ticket."""
        self._require_repos()
        assert self._ticket_repo is not None
        assert self._claim_repo is not None
        assert self._event_repo is not None

        ticket = await self._ticket_repo.get_by_id(ticket_id)
        if ticket is None:
            raise TicketNotFoundError(f"Ticket '{ticket_id}' not found")

        events = await self._event_repo.get_events_by_ticket(ticket_id)
        claim = await self._claim_repo.get_active_claim(ticket_id)

        claim_dict: dict[str, Any] | None = None
        if claim is not None:
            claim_dict = {
                "claimed_by": str(claim.claimed_by),
                "claimed_by_name": claim.claimed_by_name,
                "machine_id": claim.machine_id,
                "operator": claim.operator,
                "lease_expiry": claim.lease_expiry.isoformat(),
            }

        history = [
            {
                "event_type": e.event_type,
                "agent_name": e.agent_name,
                "previous_stage": e.previous_stage,
                "new_stage": e.new_stage,
                "created_at": e.created_at.isoformat(),
            }
            for e in events
        ]

        return TicketDetail(
            ticket_id=ticket.ticket_id,
            title=ticket.title,
            description=ticket.description,
            ticket_type=ticket.type,
            priority=ticket.priority,
            stage=ticket.stage,
            status=ticket.status,
            file_paths=ticket.file_paths,
            acceptance_criteria=ticket.acceptance_criteria,
            depends_on=ticket.depends_on,
            current_claim=claim_dict,
            history=history,
        )

    async def list_tickets(
        self,
        *,
        stage: str | None = None,
        ticket_type: str | None = None,
        priority: str | None = None,
        page: int = 1,
        page_size: int = 20,
    ) -> TicketListResult:
        """Return a paginated, optionally filtered list of tickets."""
        self._require_repos()
        assert self._ticket_repo is not None

        offset = (page - 1) * page_size

        if stage and not ticket_type and not priority:
            rows = await self._ticket_repo.list_by_stage(stage, limit=page_size, offset=offset)
        elif ticket_type and not stage and not priority:
            rows = await self._ticket_repo.list_by_type(ticket_type, limit=page_size, offset=offset)
        else:
            rows = await self._ticket_repo.list_filtered(
                stage=stage,
                ticket_type=ticket_type,
                priority=priority,
                limit=page_size,
                offset=offset,
            )

        tickets = [
            {
                "ticket_id": r.ticket_id,
                "title": r.title,
                "type": r.type,
                "priority": r.priority,
                "stage": r.stage,
                "status": r.status,
            }
            for r in rows
        ]

        return TicketListResult(
            tickets=tickets,
            total=len(tickets),
            page=page,
            page_size=page_size,
        )

    # ------------------------------------------------------------------
    # Advance operation (FORGEOS-BE030)
    # ------------------------------------------------------------------

    async def advance_ticket(
        self,
        *,
        ticket_id: str,
        agent_id: str,
        evidence: dict[str, Any] | None = None,
    ) -> AdvanceTicketResult:
        """Advance a ticket to its next SDLC stage.

        Uses SERIALIZABLE transaction isolation via :func:`transactional`
        to ensure state transition integrity.  Validates that the calling
        agent holds the active claim and that the transition is legal
        per the ticket's SDLC flow.

        Parameters
        ----------
        ticket_id : str
            The ticket to advance.
        agent_id : str
            The agent requesting the advance (must hold the active claim).
        evidence : dict[str, Any] | None
            Optional completion evidence (artifacts, coverage, etc.).

        Returns
        -------
        AdvanceTicketResult
            Result with previous and new stage information.

        Raises
        ------
        ValueError
            If the pool is not configured on this service instance.
        TicketNotFoundError
            If the ticket does not exist.
        ClaimValidationError
            If the agent does not hold the active claim.
        InvalidTransitionError
            If the transition violates the SDLC flow order.
        """
        if self._pool is None:
            raise ValueError("Pool not configured for advance operations")

        async with transactional(self._pool, OperationType.ADVANCE) as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE",
                ticket_id,
            )
            if row is None:
                raise TicketNotFoundError(f"Ticket '{ticket_id}' not found")

            current_stage: str = row["stage"]
            sdlc_flow: list[str] = row["sdlc_flow"]
            claimed_by_name: str | None = row["claimed_by_name"]

            if claimed_by_name is None:
                raise ClaimValidationError(
                    ticket_id, agent_id, "Ticket is not currently claimed"
                )
            if claimed_by_name != agent_id:
                raise ClaimValidationError(
                    ticket_id,
                    agent_id,
                    f"Ticket is claimed by '{claimed_by_name}', not '{agent_id}'",
                )

            next_stage = validate_advance(ticket_id, sdlc_flow, current_stage)

            new_status = "DONE" if next_stage == "DONE" else "READY"

            await conn.execute(
                """
                UPDATE tickets
                SET stage = $2::ticket_stage,
                    status = $3::ticket_status,
                    claimed_by = NULL,
                    claimed_by_name = NULL,
                    machine_id = NULL,
                    operator = NULL,
                    lease_expiry = NULL,
                    lease_duration_minutes = NULL,
                    updated_at = NOW(),
                    completed_at = CASE WHEN $2 = 'DONE' THEN NOW() ELSE NULL END
                WHERE ticket_id = $1
                """,
                ticket_id,
                next_stage,
                new_status,
            )

            payload: dict[str, Any] = {}
            if evidence:
                payload["evidence"] = evidence

            await conn.execute(
                """
                INSERT INTO events (
                    ticket_id, event_type,
                    agent_name,
                    previous_stage, new_stage,
                    previous_status, new_status,
                    payload
                ) VALUES (
                    $1, $2::event_type,
                    $3,
                    $4::ticket_stage, $5::ticket_stage,
                    $6::ticket_status, $7::ticket_status,
                    $8::jsonb
                )
                """,
                ticket_id,
                "STAGE_ADVANCED",
                agent_id,
                current_stage,
                next_stage,
                current_stage,
                new_status,
                json.dumps(payload),
            )

            logger.info(
                "Ticket advanced",
                extra={
                    "ticket_id": ticket_id,
                    "previous_stage": current_stage,
                    "new_stage": next_stage,
                    "agent_id": agent_id,
                },
            )

            return AdvanceTicketResult(
                ticket_id=ticket_id,
                title=row["title"],
                ticket_type=row["type"],
                previous_stage=current_stage,
                new_stage=next_stage,
                status=new_status,
            )

    # ------------------------------------------------------------------
    # Sync & validate operations (FORGEOS-BE033)
    # ------------------------------------------------------------------

    async def sync(self) -> SyncResult:
        """Release expired leases, evaluate dependencies, move unblocked to READY.

        Delegates to :class:`SyncEngine`. Requires ``pool`` to be configured.

        Returns
        -------
        SyncResult
            Summary of released leases and unblocked tickets.
        """
        if self._pool is None:
            raise RuntimeError("Pool not configured for sync operation")
        from mcp_server.services.sync_engine import SyncEngine, SyncResult

        engine = SyncEngine(self._pool)
        result: SyncResult = await engine.sync()
        logger.info(
            "Sync completed",
            extra={
                "released_count": result.released_count,
                "unblocked_count": result.unblocked_count,
                "error_count": len(result.errors),
            },
        )
        return result

    async def validate(self) -> ValidateResult:
        """Check integrity of all tickets: stage, flow, consistency.

        Delegates to :class:`SyncEngine`. Requires ``pool`` to be configured.

        Returns
        -------
        ValidateResult
            List of integrity errors (empty means clean).
        """
        if self._pool is None:
            raise RuntimeError("Pool not configured for validate operation")
        from mcp_server.services.sync_engine import SyncEngine, ValidateResult

        engine = SyncEngine(self._pool)
        result: ValidateResult = await engine.validate()
        logger.info(
            "Validate completed",
            extra={
                "error_count": len(result.errors),
                "is_clean": result.is_clean,
            },
        )
        return result
