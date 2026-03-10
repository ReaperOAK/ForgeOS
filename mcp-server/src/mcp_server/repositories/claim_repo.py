"""Claim repository — atomic claim/release operations for distributed ticket locking."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

from mcp_server.observability import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class ClaimInfo:
    """Immutable snapshot of a ticket's claim state."""

    ticket_id: str
    claimed_by: UUID
    claimed_by_name: str
    machine_id: str
    operator: str
    lease_expiry: datetime
    lease_duration_minutes: int


def _row_to_claim(row: asyncpg.Record) -> ClaimInfo:
    """Convert an asyncpg Record to a ClaimInfo."""
    return ClaimInfo(
        ticket_id=row["ticket_id"],
        claimed_by=row["claimed_by"],
        claimed_by_name=row["claimed_by_name"],
        machine_id=row["machine_id"],
        operator=row["operator"],
        lease_expiry=row["lease_expiry"],
        lease_duration_minutes=row["lease_duration_minutes"],
    )


class ClaimRepository:
    """Data-access object for ticket claim operations.

    Claims use an atomic UPDATE … WHERE to prevent races.
    Accepts an asyncpg connection pool via constructor injection.
    """

    def __init__(self, pool: asyncpg.Pool[Any]) -> None:
        """Initialise with an asyncpg connection pool.

        Args:
            pool: An asyncpg connection pool used to acquire connections.
        """
        self._pool = pool

    async def create_claim(
        self,
        ticket_id: str,
        agent_id: UUID,
        agent_name: str,
        machine_id: str,
        operator: str,
        lease_duration_minutes: int = 30,
    ) -> ClaimInfo | None:
        """Atomically claim a ticket if it is unclaimed and READY.

        The UPDATE uses ``WHERE claimed_by IS NULL AND status = 'READY'`` so
        only one caller can succeed — the row-level lock in PostgreSQL
        guarantees mutual exclusion.

        Args:
            ticket_id: Ticket to claim.
            agent_id: UUID of the claiming agent.
            agent_name: Human-readable agent name.
            machine_id: Hostname of the claiming machine.
            operator: Human operator initiating the claim.
            lease_duration_minutes: How long the lease lasts.

        Returns:
            A ``ClaimInfo`` if the claim succeeded, otherwise ``None``.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE tickets
                SET claimed_by = $2,
                    claimed_by_name = $3,
                    machine_id = $4,
                    operator = $5,
                    lease_expiry = NOW() + ($6 || ' minutes')::interval,
                    lease_duration_minutes = $6,
                    status = 'CLAIMED'::ticket_status,
                    updated_at = NOW()
                WHERE ticket_id = $1
                  AND claimed_by IS NULL
                  AND status = 'READY'::ticket_status
                RETURNING ticket_id, claimed_by, claimed_by_name,
                          machine_id, operator, lease_expiry,
                          lease_duration_minutes
                """,
                ticket_id,
                agent_id,
                agent_name,
                machine_id,
                operator,
                lease_duration_minutes,
            )
            if row is None:
                logger.warning("claim_failed ticket_id=%s agent=%s", ticket_id, agent_name)
                return None
            return _row_to_claim(row)

    async def release_claim(self, ticket_id: str) -> bool:
        """Release a claim, setting the ticket back to READY.

        Args:
            ticket_id: Ticket whose claim should be released.

        Returns:
            ``True`` if a claim was released, ``False`` if the ticket had no claim.
        """
        async with self._pool.acquire() as conn:
            result = await conn.execute(
                """
                UPDATE tickets
                SET claimed_by = NULL,
                    claimed_by_name = NULL,
                    machine_id = NULL,
                    operator = NULL,
                    lease_expiry = NULL,
                    lease_duration_minutes = NULL,
                    status = 'READY'::ticket_status,
                    updated_at = NOW()
                WHERE ticket_id = $1
                  AND claimed_by IS NOT NULL
                """,
                ticket_id,
            )
            return result == "UPDATE 1"

    async def get_active_claim(self, ticket_id: str) -> ClaimInfo | None:
        """Fetch the active (non-expired) claim for a ticket.

        Args:
            ticket_id: Ticket to query.

        Returns:
            A ``ClaimInfo`` if the ticket has a valid claim, otherwise ``None``.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT ticket_id, claimed_by, claimed_by_name,
                       machine_id, operator, lease_expiry,
                       lease_duration_minutes
                FROM tickets
                WHERE ticket_id = $1
                  AND claimed_by IS NOT NULL
                  AND lease_expiry > NOW()
                """,
                ticket_id,
            )
            if row is None:
                return None
            return _row_to_claim(row)

    async def list_expired_claims(self) -> list[ClaimInfo]:
        """List all tickets whose lease has expired but are still claimed.

        Returns:
            A list of ``ClaimInfo`` objects for expired claims.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT ticket_id, claimed_by, claimed_by_name,
                       machine_id, operator, lease_expiry,
                       lease_duration_minutes
                FROM tickets
                WHERE claimed_by IS NOT NULL
                  AND lease_expiry < NOW()
                """
            )
            return [_row_to_claim(r) for r in rows]
