"""Event repository — append-only event sourcing for the audit trail."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from uuid import UUID

import asyncpg

from mcp_server.observability import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class EventRow:
    """Immutable representation of a row in the ``events`` table."""

    id: UUID
    ticket_id: str
    event_type: str
    agent_id: UUID | None
    agent_name: str | None
    machine_id: str | None
    operator: str | None
    previous_stage: str | None
    new_stage: str | None
    previous_status: str | None
    new_status: str | None
    payload: dict[str, Any]
    created_at: datetime


def _row_to_event(row: asyncpg.Record) -> EventRow:
    """Convert an asyncpg Record to an EventRow."""
    return EventRow(
        id=row["id"],
        ticket_id=row["ticket_id"],
        event_type=row["event_type"],
        agent_id=row["agent_id"],
        agent_name=row["agent_name"],
        machine_id=row["machine_id"],
        operator=row["operator"],
        previous_stage=row["previous_stage"],
        new_stage=row["new_stage"],
        previous_status=row["previous_status"],
        new_status=row["new_status"],
        payload=row["payload"] if row["payload"] else {},
        created_at=row["created_at"],
    )


class EventRepository:
    """Data-access object for the ``events`` table (append-only audit trail).

    All SQL uses parameterized queries to prevent injection.
    Accepts an asyncpg connection pool via constructor injection.
    """

    def __init__(self, pool: asyncpg.Pool[Any]) -> None:
        """Initialise with an asyncpg connection pool.

        Args:
            pool: An asyncpg connection pool used to acquire connections.
        """
        self._pool = pool

    async def append_event(
        self,
        *,
        ticket_id: str,
        event_type: str,
        agent_id: UUID | None = None,
        agent_name: str | None = None,
        machine_id: str | None = None,
        operator: str | None = None,
        previous_stage: str | None = None,
        new_stage: str | None = None,
        previous_status: str | None = None,
        new_status: str | None = None,
        payload: dict[str, Any] | None = None,
    ) -> EventRow:
        """Append a new event to the audit trail.

        Args:
            ticket_id: The ticket this event relates to.
            event_type: One of the ``event_type`` enum values.
            agent_id: UUID of the acting agent.
            agent_name: Human-readable agent name.
            machine_id: Hostname of the acting machine.
            operator: Human operator name.
            previous_stage: Stage before the transition.
            new_stage: Stage after the transition.
            previous_status: Status before the transition.
            new_status: Status after the transition.
            payload: Arbitrary JSON payload.

        Returns:
            The newly created ``EventRow``.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO events (
                    ticket_id, event_type,
                    agent_id, agent_name, machine_id, operator,
                    previous_stage, new_stage,
                    previous_status, new_status,
                    payload
                ) VALUES (
                    $1, $2::event_type,
                    $3, $4, $5, $6,
                    $7::ticket_stage, $8::ticket_stage,
                    $9::ticket_status, $10::ticket_status,
                    $11::jsonb
                )
                RETURNING *
                """,
                ticket_id,
                event_type,
                agent_id,
                agent_name,
                machine_id,
                operator,
                previous_stage,
                new_stage,
                previous_status,
                new_status,
                json.dumps(payload) if payload else "{}",
            )
            return _row_to_event(row)

    async def get_events_by_ticket(
        self,
        ticket_id: str,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[EventRow]:
        """Fetch events for a specific ticket, newest first.

        Args:
            ticket_id: The ticket to query events for.
            limit: Maximum number of rows to return.
            offset: Number of rows to skip.

        Returns:
            A list of ``EventRow`` objects ordered by created_at DESC.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM events
                WHERE ticket_id = $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
                """,
                ticket_id,
                limit,
                offset,
            )
            return [_row_to_event(r) for r in rows]

    async def get_events_by_agent(
        self,
        agent_name: str,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[EventRow]:
        """Fetch events performed by a specific agent.

        Args:
            agent_name: The agent name to filter by.
            limit: Maximum number of rows to return.
            offset: Number of rows to skip.

        Returns:
            A list of ``EventRow`` objects ordered by created_at DESC.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM events
                WHERE agent_name = $1
                ORDER BY created_at DESC
                LIMIT $2 OFFSET $3
                """,
                agent_name,
                limit,
                offset,
            )
            return [_row_to_event(r) for r in rows]

    async def get_events_by_timerange(
        self,
        since: datetime,
        until: datetime,
        *,
        limit: int = 100,
        offset: int = 0,
    ) -> list[EventRow]:
        """Fetch events within a time range.

        Args:
            since: Start of the range (inclusive).
            until: End of the range (inclusive).
            limit: Maximum number of rows to return.
            offset: Number of rows to skip.

        Returns:
            A list of ``EventRow`` objects ordered by created_at DESC.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT * FROM events
                WHERE created_at >= $1
                  AND created_at <= $2
                ORDER BY created_at DESC
                LIMIT $3 OFFSET $4
                """,
                since,
                until,
                limit,
                offset,
            )
            return [_row_to_event(r) for r in rows]
