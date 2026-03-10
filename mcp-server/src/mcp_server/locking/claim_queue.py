"""Ticket claim queue using PostgreSQL SELECT FOR UPDATE SKIP LOCKED.

Provides :class:`ClaimQueue`, which wraps the ``claim_ticket`` and
``claim_ticket_by_id`` stored functions in the ForgeOS database.  The
queue uses ``SELECT FOR UPDATE SKIP LOCKED`` to ensure that concurrent
claim attempts never block each other — if a ticket is already being
claimed by another transaction, it is transparently skipped and the
next eligible ticket is returned instead.

Design decisions
----------------
* **Stored-function delegation** — all locking logic lives in PL/pgSQL
  (``claim_ticket``, ``claim_ticket_by_id``).  This module is a thin
  async Python wrapper that validates inputs, invokes the function, and
  maps the result to typed Python dataclasses.
* **Agent-role filtering** — :class:`AgentRoleMap` encodes the mapping
  from agent roles (e.g. ``"backend"``) to compatible ticket stages
  (e.g. ``"BACKEND"``).  The stored function filters by stage, so the
  Python layer translates role → stage before calling.
* **No retry loops** — if no ticket is available, the function returns
  ``None`` immediately.  Callers decide retry/backoff policy.
* **Structured logging** — all operations are logged with correlation
  context (agent_id, machine_id, ticket_id).

.. meta::
   :ticket: FORGEOS-BE006
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from mcp_server.observability import get_logger
from mcp_server.server import DatabaseError, ForgeOSError, INVALID_PARAMS

logger = get_logger("locking.claim_queue")


# ---------------------------------------------------------------------------
# Agent-role-to-stage mapping
# ---------------------------------------------------------------------------

# Maps agent role names to the SDLC stage they process.
# Only tickets at the matching stage can be claimed by that role.
_ROLE_TO_STAGE: dict[str, str] = {
    "architect": "ARCHITECT",
    "research": "RESEARCH",
    "product_manager": "PRODUCT_MANAGER",
    "ui_designer": "UI_DESIGN",
    "backend": "BACKEND",
    "devops": "BACKEND",
    "frontend": "FRONTEND",
    "qa": "QA",
    "security": "SECURITY",
    "ci": "CI",
    "documentation": "DOCUMENTATION",
    "validator": "VALIDATOR",
}

# Maps agent roles to compatible ticket types.
# An agent with role "backend" can claim "backend", "fullstack", and "infra" tickets.
_ROLE_TO_TICKET_TYPES: dict[str, list[str]] = {
    "architect": ["architecture"],
    "research": ["research"],
    "product_manager": ["product"],
    "ui_designer": ["design"],
    "backend": ["backend", "fullstack", "infra"],
    "devops": ["infra", "backend"],
    "frontend": ["frontend", "fullstack"],
    "qa": ["backend", "frontend", "fullstack", "infra", "security"],
    "security": ["backend", "frontend", "fullstack", "infra", "security"],
    "ci": ["backend", "frontend", "fullstack", "infra", "security"],
    "documentation": [
        "backend", "frontend", "fullstack", "infra", "security",
        "docs", "research", "architecture", "product", "design",
    ],
    "validator": [
        "backend", "frontend", "fullstack", "infra", "security",
        "docs", "research", "architecture", "product", "design",
    ],
}


class AgentRoleMap:
    """Maps agent roles to their compatible stages and ticket types.

    This is a stateless utility class providing lookup methods for
    role-based filtering in the claim queue.
    """

    @staticmethod
    def stage_for_role(role: str) -> str | None:
        """Return the SDLC stage that *role* processes, or ``None``.

        Parameters
        ----------
        role : str
            Agent role name (e.g. ``"backend"``).

        Returns
        -------
        str | None
            The stage name (e.g. ``"BACKEND"``), or ``None`` if unknown.
        """
        return _ROLE_TO_STAGE.get(role.lower())

    @staticmethod
    def ticket_types_for_role(role: str) -> list[str]:
        """Return ticket types that *role* is allowed to claim.

        Parameters
        ----------
        role : str
            Agent role name (e.g. ``"backend"``).

        Returns
        -------
        list[str]
            Compatible ticket type names, or empty list if unknown.
        """
        return _ROLE_TO_TICKET_TYPES.get(role.lower(), [])

    @staticmethod
    def is_compatible(role: str, ticket_type: str) -> bool:
        """Check whether *role* can process tickets of *ticket_type*.

        Parameters
        ----------
        role : str
            Agent role name.
        ticket_type : str
            Ticket type (e.g. ``"backend"``).

        Returns
        -------
        bool
        """
        return ticket_type.lower() in _ROLE_TO_TICKET_TYPES.get(role.lower(), [])


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class ClaimError(ForgeOSError):
    """Base error for claim queue failures."""

    error_code: int = INVALID_PARAMS
    status_code: int = 409


class NoEligibleTicketError(ClaimError):
    """No ticket is available for the given criteria."""

    status_code: int = 404


class LeaseExpiredError(ClaimError):
    """The lease on a claimed ticket has expired."""

    status_code: int = 410


# ---------------------------------------------------------------------------
# ClaimResult value object
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ClaimResult:
    """Immutable result of a successful ticket claim.

    Attributes
    ----------
    id : str
        Internal UUID of the ticket row.
    ticket_id : str
        Human-readable ticket identifier (e.g. ``"FORGEOS-BE006"``).
    title : str
        Ticket title.
    ticket_type : str
        Ticket type (e.g. ``"backend"``).
    priority : str
        Priority level (e.g. ``"critical"``).
    stage : str
        Current SDLC stage.
    status : str
        Current ticket status (will be ``"CLAIMED"``).
    agent_id : str
        UUID of the claiming agent.
    agent_name : str
        Human-readable name of the claiming agent.
    machine_id : str
        Hostname of the claiming machine.
    lease_expiry : datetime
        When the claim lease expires.
    file_paths : list[str]
        Files within the ticket scope.
    acceptance_criteria : list[str]
        Ticket acceptance criteria.
    depends_on : list[str]
        Ticket IDs this ticket depends on.
    metadata : dict[str, Any]
        Additional ticket metadata.
    """

    id: str
    ticket_id: str
    title: str
    ticket_type: str
    priority: str
    stage: str
    status: str
    agent_id: str
    agent_name: str
    machine_id: str
    lease_expiry: datetime
    file_paths: list[str] = field(default_factory=list)
    acceptance_criteria: list[str] = field(default_factory=list)
    depends_on: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


def _row_to_claim_result(row: Any) -> ClaimResult:
    """Convert an asyncpg Record (from claim_ticket()) to a ClaimResult."""
    return ClaimResult(
        id=str(row["id"]),
        ticket_id=row["ticket_id"],
        title=row["title"],
        ticket_type=row["type"],
        priority=row["priority"],
        stage=row["stage"],
        status=row["status"],
        agent_id=str(row["claimed_by"]),
        agent_name=row["claimed_by_name"] or "",
        machine_id=row["machine_id"] or "",
        lease_expiry=row["lease_expiry"],
        file_paths=list(row["file_paths"]) if row["file_paths"] else [],
        acceptance_criteria=(
            list(row["acceptance_criteria"]) if row["acceptance_criteria"] else []
        ),
        depends_on=list(row["depends_on"]) if row["depends_on"] else [],
        metadata=dict(row["metadata"]) if row["metadata"] else {},
    )


# ---------------------------------------------------------------------------
# Connection pool protocol (for dependency injection)
# ---------------------------------------------------------------------------


class PoolLike(Protocol):
    """Protocol for objects that can acquire database connections."""

    def acquire(self) -> Any:
        """Return an async context manager yielding a connection."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# ClaimQueue — the main public interface
# ---------------------------------------------------------------------------


class ClaimQueue:
    """Distributed ticket claim queue backed by PostgreSQL SKIP LOCKED.

    Wraps the ``claim_ticket`` and ``claim_ticket_by_id`` stored
    functions, providing a typed async Python API.  All locking
    semantics are enforced at the database level.

    Parameters
    ----------
    pool : PoolLike
        An asyncpg connection pool (or compatible object with an
        ``acquire()`` async context manager).
    """

    def __init__(self, pool: PoolLike) -> None:
        self._pool = pool

    async def claim_next(
        self,
        *,
        stage: str,
        agent_id: str,
        agent_name: str,
        machine_id: str,
        operator: str | None = None,
        lease_minutes: int = 30,
    ) -> ClaimResult | None:
        """Atomically claim the next available ticket for *stage*.

        Uses the ``claim_ticket`` stored function which internally
        executes ``SELECT FOR UPDATE SKIP LOCKED`` to guarantee that:

        1. Exactly one agent wins each ticket.
        2. Other concurrent claimants transparently skip to the next
           eligible ticket (no blocking, no deadlocks).
        3. Only tickets with status ``READY`` and no active claim
           (or an expired lease) are considered.

        Parameters
        ----------
        stage : str
            SDLC stage to claim from (e.g. ``"BACKEND"``).
        agent_id : str
            UUID of the claiming agent.
        agent_name : str
            Human-readable agent name.
        machine_id : str
            Hostname of the machine running the agent.
        operator : str | None
            Human operator name (optional).
        lease_minutes : int
            Claim duration in minutes (default 30).

        Returns
        -------
        ClaimResult | None
            The claimed ticket data, or ``None`` if no eligible ticket.

        Raises
        ------
        DatabaseError
            If a database communication error occurs.
        """
        logger.info(
            "Attempting to claim next ticket",
            extra={
                "stage": stage,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "machine_id": machine_id,
            },
        )

        try:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT * FROM claim_ticket($1, $2::uuid, $3, $4, $5, $6)",
                    stage,
                    uuid.UUID(agent_id),
                    agent_name,
                    machine_id,
                    operator,
                    lease_minutes,
                )
        except Exception as exc:
            logger.error(
                "Database error during claim_next",
                extra={
                    "stage": stage,
                    "agent_id": agent_id,
                    "error": str(exc),
                },
            )
            raise DatabaseError(
                f"Failed to claim ticket: {exc}",
                details={"stage": stage, "agent_id": agent_id},
            ) from exc

        if row is None:
            logger.info(
                "No eligible ticket found for stage",
                extra={"stage": stage, "agent_id": agent_id},
            )
            return None

        result = _row_to_claim_result(row)
        logger.info(
            "Ticket claimed successfully",
            extra={
                "ticket_id": result.ticket_id,
                "stage": stage,
                "agent_id": agent_id,
                "lease_expiry": result.lease_expiry.isoformat(),
            },
        )
        return result

    async def claim_by_id(
        self,
        *,
        ticket_id: str,
        agent_id: str,
        agent_name: str,
        machine_id: str,
        operator: str | None = None,
        lease_minutes: int = 30,
    ) -> ClaimResult | None:
        """Claim a specific ticket by its human-readable ID.

        Uses the ``claim_ticket_by_id`` stored function which also
        checks for file lock conflicts before claiming.

        Parameters
        ----------
        ticket_id : str
            Human-readable ticket ID (e.g. ``"FORGEOS-BE006"``).
        agent_id : str
            UUID of the claiming agent.
        agent_name : str
            Human-readable agent name.
        machine_id : str
            Hostname of the machine running the agent.
        operator : str | None
            Human operator name (optional).
        lease_minutes : int
            Claim duration in minutes (default 30).

        Returns
        -------
        ClaimResult | None
            The claimed ticket data, or ``None`` if the ticket is not
            claimable (already claimed, wrong status, or locked files).

        Raises
        ------
        ClaimError
            If a file conflict exists on the ticket's file_paths.
        DatabaseError
            If a database communication error occurs.
        """
        logger.info(
            "Attempting to claim ticket by ID",
            extra={
                "ticket_id": ticket_id,
                "agent_id": agent_id,
                "agent_name": agent_name,
                "machine_id": machine_id,
            },
        )

        try:
            async with self._pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT * FROM claim_ticket_by_id($1, $2::uuid, $3, $4, $5, $6)",
                    ticket_id,
                    uuid.UUID(agent_id),
                    agent_name,
                    machine_id,
                    operator,
                    lease_minutes,
                )
        except Exception as exc:
            error_msg = str(exc)
            if "FILE_CONFLICT" in error_msg:
                logger.warning(
                    "File conflict during claim",
                    extra={"ticket_id": ticket_id, "agent_id": agent_id},
                )
                raise ClaimError(
                    f"File conflict: {error_msg}",
                    details={"ticket_id": ticket_id, "agent_id": agent_id},
                ) from exc
            logger.error(
                "Database error during claim_by_id",
                extra={
                    "ticket_id": ticket_id,
                    "agent_id": agent_id,
                    "error": error_msg,
                },
            )
            raise DatabaseError(
                f"Failed to claim ticket: {exc}",
                details={"ticket_id": ticket_id, "agent_id": agent_id},
            ) from exc

        if row is None:
            logger.info(
                "Ticket not claimable",
                extra={"ticket_id": ticket_id, "agent_id": agent_id},
            )
            return None

        result = _row_to_claim_result(row)
        logger.info(
            "Ticket claimed successfully by ID",
            extra={
                "ticket_id": result.ticket_id,
                "agent_id": agent_id,
                "lease_expiry": result.lease_expiry.isoformat(),
            },
        )
        return result

    async def claim_for_role(
        self,
        *,
        role: str,
        agent_id: str,
        agent_name: str,
        machine_id: str,
        operator: str | None = None,
        lease_minutes: int = 30,
    ) -> ClaimResult | None:
        """Claim the next eligible ticket for an agent role.

        Resolves the role to its compatible SDLC stage via
        :class:`AgentRoleMap`, then delegates to :meth:`claim_next`.
        This is the primary entry point for agents that want to
        discover and claim work based on their role.

        Parameters
        ----------
        role : str
            Agent role name (e.g. ``"backend"``).
        agent_id : str
            UUID of the claiming agent.
        agent_name : str
            Human-readable agent name.
        machine_id : str
            Hostname of the machine running the agent.
        operator : str | None
            Human operator name (optional).
        lease_minutes : int
            Claim duration in minutes (default 30).

        Returns
        -------
        ClaimResult | None
            The claimed ticket data, or ``None`` if no eligible ticket.

        Raises
        ------
        ClaimError
            If the role is unknown.
        DatabaseError
            If a database communication error occurs.
        """
        stage = AgentRoleMap.stage_for_role(role)
        if stage is None:
            raise ClaimError(
                f"Unknown agent role: {role!r}",
                details={"role": role},
            )

        return await self.claim_next(
            stage=stage,
            agent_id=agent_id,
            agent_name=agent_name,
            machine_id=machine_id,
            operator=operator,
            lease_minutes=lease_minutes,
        )
