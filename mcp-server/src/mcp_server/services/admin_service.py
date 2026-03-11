"""Admin service — elevated admin operations for ticket management.

Provides force-release, force-advance, and force-rework operations
that bypass normal ownership and claim validation checks.

All operations require admin authentication and create audit trail
entries with ``elevated_operation=true`` in the payload.

Public API
----------
* :class:`AdminService` — orchestrates admin force operations.
* :class:`ForceReleaseResult` — typed result for force-release.
* :class:`ForceAdvanceResult` — typed result for force-advance.
* :class:`ForceReworkResult` — typed result for force-rework.

.. meta::
   :ticket: FORGEOS-BE057
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from mcp_server.locking.transaction_config import OperationType, PoolLike, transactional
from mcp_server.observability import get_logger
from mcp_server.server import TicketNotFoundError
from mcp_server.services.stage_engine import validate_advance

if TYPE_CHECKING:
    from mcp_server.notifications.emitter import StateChangeEmitter

logger = get_logger("services.admin_service")


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ForceReleaseResult:
    """Typed result for an admin force-release operation."""

    ticket_id: str
    previous_stage: str
    previous_claim: dict[str, Any] | None
    released_by_admin: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "previous_stage": self.previous_stage,
            "previous_claim": self.previous_claim,
            "released_by_admin": self.released_by_admin,
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class ForceAdvanceResult:
    """Typed result for an admin force-advance operation."""

    ticket_id: str
    title: str
    ticket_type: str
    previous_stage: str
    new_stage: str
    advanced_by_admin: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "title": self.title,
            "type": self.ticket_type,
            "previous_stage": self.previous_stage,
            "new_stage": self.new_stage,
            "advanced_by_admin": self.advanced_by_admin,
            "reason": self.reason,
        }


@dataclass(frozen=True, slots=True)
class ForceReworkResult:
    """Typed result for an admin force-rework operation."""

    ticket_id: str
    title: str
    ticket_type: str
    previous_stage: str
    new_stage: str
    rework_count: int
    escalated: bool
    reworked_by_admin: str
    reason: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "ticket_id": self.ticket_id,
            "title": self.title,
            "type": self.ticket_type,
            "previous_stage": self.previous_stage,
            "new_stage": self.new_stage,
            "rework_count": self.rework_count,
            "escalated": self.escalated,
            "reworked_by_admin": self.reworked_by_admin,
            "reason": self.reason,
        }


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class AdminService:
    """Service for admin-only elevated ticket operations.

    All methods use SERIALIZABLE transactions to prevent concurrent
    state corruption.  Each operation logs an audit event with
    ``elevated_operation=true`` in the payload.

    Parameters
    ----------
    pool : PoolLike
        asyncpg connection pool (or compatible interface).
    emitter : StateChangeEmitter | None
        Optional emitter for real-time notifications.
    """

    def __init__(
        self,
        *,
        pool: PoolLike,
        emitter: StateChangeEmitter | None = None,
    ) -> None:
        self._pool = pool
        self._emitter = emitter

    # ------------------------------------------------------------------
    # Force release
    # ------------------------------------------------------------------

    async def force_release(
        self,
        *,
        ticket_id: str,
        admin_id: str,
        reason: str,
    ) -> ForceReleaseResult:
        """Forcefully release any claim regardless of ownership.

        Parameters
        ----------
        ticket_id : str
            The ticket whose claim to release.
        admin_id : str
            The admin performing the operation.
        reason : str
            Audit reason for the force release.

        Returns
        -------
        ForceReleaseResult
            Before/after state of the operation.

        Raises
        ------
        TicketNotFoundError
            If the ticket does not exist.
        """
        async with transactional(self._pool, OperationType.RELEASE) as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE",
                ticket_id,
            )
            if row is None:
                raise TicketNotFoundError(f"Ticket '{ticket_id}' not found")

            current_stage: str = row["stage"]
            claimed_by_name: str | None = row["claimed_by_name"]
            machine_id: str | None = row["machine_id"]
            operator: str | None = row["operator"]

            previous_claim: dict[str, Any] | None = None
            if claimed_by_name:
                previous_claim = {
                    "claimed_by": claimed_by_name,
                    "machine_id": machine_id,
                    "operator": operator,
                }

            await conn.execute(
                """
                UPDATE tickets
                SET claimed_by = NULL,
                    claimed_by_name = NULL,
                    machine_id = NULL,
                    operator = NULL,
                    lease_expiry = NULL,
                    lease_duration_minutes = NULL,
                    updated_at = NOW()
                WHERE ticket_id = $1
                """,
                ticket_id,
            )

            payload = {
                "reason": reason,
                "elevated_operation": True,
                "admin_id": admin_id,
                "previous_claim": previous_claim,
            }

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
                "FORCE_RELEASED",
                admin_id,
                current_stage,
                current_stage,
                row["status"],
                row["status"],
                json.dumps(payload),
            )

        logger.info(
            "Admin force release",
            extra={
                "ticket_id": ticket_id,
                "admin_id": admin_id,
                "previous_claim": previous_claim,
            },
        )

        return ForceReleaseResult(
            ticket_id=ticket_id,
            previous_stage=current_stage,
            previous_claim=previous_claim,
            released_by_admin=admin_id,
            reason=reason,
        )

    # ------------------------------------------------------------------
    # Force advance
    # ------------------------------------------------------------------

    async def force_advance(
        self,
        *,
        ticket_id: str,
        admin_id: str,
        reason: str,
    ) -> ForceAdvanceResult:
        """Force-advance a ticket to the next stage bypassing claim checks.

        Parameters
        ----------
        ticket_id : str
            The ticket to advance.
        admin_id : str
            The admin performing the operation.
        reason : str
            Audit reason for the force advance.

        Returns
        -------
        ForceAdvanceResult
            Before/after state of the operation.

        Raises
        ------
        TicketNotFoundError
            If the ticket does not exist.
        InvalidTransitionError
            If the ticket is already at its final stage.
        """
        async with transactional(self._pool, OperationType.ADVANCE) as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE",
                ticket_id,
            )
            if row is None:
                raise TicketNotFoundError(f"Ticket '{ticket_id}' not found")

            current_stage: str = row["stage"]
            sdlc_flow: list[str] = row["sdlc_flow"]
            title: str = row["title"]
            ticket_type: str = row["type"]

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

            payload = {
                "reason": reason,
                "elevated_operation": True,
                "admin_id": admin_id,
            }

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
                admin_id,
                current_stage,
                next_stage,
                row["status"],
                new_status,
                json.dumps(payload),
            )

        logger.info(
            "Admin force advance",
            extra={
                "ticket_id": ticket_id,
                "admin_id": admin_id,
                "previous_stage": current_stage,
                "new_stage": next_stage,
            },
        )

        return ForceAdvanceResult(
            ticket_id=ticket_id,
            title=title,
            ticket_type=ticket_type,
            previous_stage=current_stage,
            new_stage=next_stage,
            advanced_by_admin=admin_id,
            reason=reason,
        )

    # ------------------------------------------------------------------
    # Force rework
    # ------------------------------------------------------------------

    async def force_rework(
        self,
        *,
        ticket_id: str,
        admin_id: str,
        reason: str,
    ) -> ForceReworkResult:
        """Force-rework a ticket back to its implementation stage.

        Increments ``rework_count`` and escalates if limit is reached.

        Parameters
        ----------
        ticket_id : str
            The ticket to rework.
        admin_id : str
            The admin performing the operation.
        reason : str
            Audit reason for the force rework.

        Returns
        -------
        ForceReworkResult
            Before/after state of the operation.

        Raises
        ------
        TicketNotFoundError
            If the ticket does not exist.
        """
        async with transactional(self._pool, OperationType.REWORK) as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE",
                ticket_id,
            )
            if row is None:
                raise TicketNotFoundError(f"Ticket '{ticket_id}' not found")

            current_stage: str = row["stage"]
            sdlc_flow: list[str] = row["sdlc_flow"]
            rework_count: int = row["rework_count"]
            max_reworks: int = row["max_reworks"]
            title: str = row["title"]
            ticket_type: str = row["type"]

            new_rework_count = rework_count + 1
            escalated = new_rework_count >= max_reworks

            if escalated:
                new_stage = current_stage
                new_status = "ESCALATED"
                event_type = "ESCALATED"
            else:
                new_stage = sdlc_flow[1] if len(sdlc_flow) > 1 else current_stage
                new_status = "READY"
                event_type = "STAGE_REJECTED"

            await conn.execute(
                """
                UPDATE tickets
                SET stage = $2::ticket_stage,
                    status = $3::ticket_status,
                    rework_count = $4,
                    claimed_by = NULL,
                    claimed_by_name = NULL,
                    machine_id = NULL,
                    operator = NULL,
                    lease_expiry = NULL,
                    lease_duration_minutes = NULL,
                    updated_at = NOW()
                WHERE ticket_id = $1
                """,
                ticket_id,
                new_stage,
                new_status,
                new_rework_count,
            )

            payload = {
                "reason": reason,
                "elevated_operation": True,
                "admin_id": admin_id,
            }

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
                event_type,
                admin_id,
                current_stage,
                new_stage,
                row["status"],
                new_status,
                json.dumps(payload),
            )

        logger.info(
            "Admin force rework",
            extra={
                "ticket_id": ticket_id,
                "admin_id": admin_id,
                "previous_stage": current_stage,
                "new_stage": new_stage,
                "rework_count": new_rework_count,
                "escalated": escalated,
            },
        )

        return ForceReworkResult(
            ticket_id=ticket_id,
            title=title,
            ticket_type=ticket_type,
            previous_stage=current_stage,
            new_stage=new_stage,
            rework_count=new_rework_count,
            escalated=escalated,
            reworked_by_admin=admin_id,
            reason=reason,
        )
