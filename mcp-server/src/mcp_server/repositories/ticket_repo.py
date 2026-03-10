"""Ticket repository — CRUD, filtering, and stage queries for the tickets table."""

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
class TicketRow:
    """Immutable representation of a row in the ``tickets`` table."""

    id: UUID
    ticket_id: str
    project_id: UUID | None
    title: str
    description: str
    type: str
    priority: str
    status: str
    stage: str
    sdlc_flow: list[str]
    claimed_by: UUID | None
    claimed_by_name: str | None
    machine_id: str | None
    operator: str | None
    lease_expiry: datetime | None
    lease_duration_minutes: int | None
    depends_on: list[str]
    file_paths: list[str]
    acceptance_criteria: list[str]
    tags: list[str]
    rework_count: int
    max_reworks: int
    metadata: dict[str, Any]
    parent_id: UUID | None
    source_task_file: str | None
    created_at: datetime
    updated_at: datetime
    completed_at: datetime | None


def _row_to_ticket(row: asyncpg.Record) -> TicketRow:
    """Convert an asyncpg Record to a TicketRow."""
    return TicketRow(
        id=row["id"],
        ticket_id=row["ticket_id"],
        project_id=row["project_id"],
        title=row["title"],
        description=row["description"],
        type=row["type"],
        priority=row["priority"],
        status=row["status"],
        stage=row["stage"],
        sdlc_flow=list(row["sdlc_flow"]) if row["sdlc_flow"] else [],
        claimed_by=row["claimed_by"],
        claimed_by_name=row["claimed_by_name"],
        machine_id=row["machine_id"],
        operator=row["operator"],
        lease_expiry=row["lease_expiry"],
        lease_duration_minutes=row["lease_duration_minutes"],
        depends_on=list(row["depends_on"]) if row["depends_on"] else [],
        file_paths=list(row["file_paths"]) if row["file_paths"] else [],
        acceptance_criteria=list(row["acceptance_criteria"]) if row["acceptance_criteria"] else [],
        tags=list(row["tags"]) if row["tags"] else [],
        rework_count=row["rework_count"],
        max_reworks=row["max_reworks"],
        metadata=row["metadata"] if row["metadata"] else {},
        parent_id=row["parent_id"],
        source_task_file=row["source_task_file"],
        created_at=row["created_at"],
        updated_at=row["updated_at"],
        completed_at=row["completed_at"],
    )


class TicketRepository:
    """Data-access object for the ``tickets`` table.

    All SQL uses parameterized queries to prevent injection.
    Accepts an asyncpg connection pool via constructor injection.
    """

    def __init__(self, pool: asyncpg.Pool[Any]) -> None:
        """Initialise with an asyncpg connection pool.

        Args:
            pool: An asyncpg connection pool used to acquire connections.
        """
        self._pool = pool

    async def get_by_id(self, ticket_id: str) -> TicketRow | None:
        """Fetch a single ticket by its human-readable ticket_id.

        Args:
            ticket_id: The unique ticket identifier (e.g. ``FORGEOS-BE013``).

        Returns:
            A ``TicketRow`` if found, otherwise ``None``.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM tickets WHERE ticket_id = $1",
                ticket_id,
            )
            if row is None:
                return None
            return _row_to_ticket(row)

    async def list_by_stage(
        self,
        stage: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TicketRow]:
        """List tickets in a given SDLC stage, ordered by priority then creation date.

        Args:
            stage: The SDLC stage name (e.g. ``BACKEND``, ``QA``).
            limit: Maximum number of rows to return.
            offset: Number of rows to skip for pagination.

        Returns:
            A list of ``TicketRow`` objects.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT *
                FROM tickets
                WHERE stage = $1::ticket_stage
                ORDER BY
                    CASE priority
                        WHEN 'critical' THEN 0
                        WHEN 'high'     THEN 1
                        WHEN 'medium'   THEN 2
                        WHEN 'low'      THEN 3
                    END,
                    created_at ASC
                LIMIT $2 OFFSET $3
                """,
                stage,
                limit,
                offset,
            )
            return [_row_to_ticket(r) for r in rows]

    async def list_by_type(
        self,
        ticket_type: str,
        *,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TicketRow]:
        """List tickets filtered by type.

        Args:
            ticket_type: The ticket type (e.g. ``backend``, ``frontend``).
            limit: Maximum number of rows to return.
            offset: Number of rows to skip.

        Returns:
            A list of ``TicketRow`` objects.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT *
                FROM tickets
                WHERE type = $1::ticket_type
                ORDER BY created_at ASC
                LIMIT $2 OFFSET $3
                """,
                ticket_type,
                limit,
                offset,
            )
            return [_row_to_ticket(r) for r in rows]

    async def create(
        self,
        *,
        ticket_id: str,
        title: str,
        description: str,
        ticket_type: str,
        priority: str,
        stage: str,
        sdlc_flow: list[str],
        depends_on: list[str] | None = None,
        file_paths: list[str] | None = None,
        acceptance_criteria: list[str] | None = None,
        tags: list[str] | None = None,
        source_task_file: str | None = None,
        metadata: dict[str, Any] | None = None,
        parent_id: UUID | None = None,
    ) -> TicketRow:
        """Insert a new ticket and return the created row.

        Args:
            ticket_id: Human-readable identifier.
            title: Short summary.
            description: Full description.
            ticket_type: One of the ``ticket_type`` enum values.
            priority: One of the ``ticket_priority`` enum values.
            stage: Initial SDLC stage.
            sdlc_flow: Ordered list of stages this ticket traverses.
            depends_on: Ticket IDs this ticket depends on.
            file_paths: Files in scope for this ticket.
            acceptance_criteria: List of acceptance criteria.
            tags: Classifying tags.
            source_task_file: Originating task file path.
            metadata: Arbitrary key-value metadata.
            parent_id: UUID of parent ticket if any.

        Returns:
            The newly created ``TicketRow``.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO tickets (
                    ticket_id, title, description,
                    type, priority, stage,
                    sdlc_flow, depends_on, file_paths,
                    acceptance_criteria, tags,
                    source_task_file, metadata, parent_id
                ) VALUES (
                    $1, $2, $3,
                    $4::ticket_type, $5::ticket_priority, $6::ticket_stage,
                    $7::ticket_stage[], $8, $9,
                    $10, $11,
                    $12, $13::jsonb, $14
                )
                RETURNING *
                """,
                ticket_id,
                title,
                description,
                ticket_type,
                priority,
                stage,
                sdlc_flow,
                depends_on or [],
                file_paths or [],
                acceptance_criteria or [],
                tags or [],
                source_task_file,
                json.dumps(metadata) if metadata else "{}",
                parent_id,
            )
            return _row_to_ticket(row)

    async def update_stage(
        self,
        ticket_id: str,
        new_stage: str,
        new_status: str,
    ) -> TicketRow | None:
        """Update the stage and status of a ticket.

        Args:
            ticket_id: The ticket to update.
            new_stage: Target SDLC stage.
            new_status: Target ticket status.

        Returns:
            The updated ``TicketRow``, or ``None`` if the ticket was not found.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                UPDATE tickets
                SET stage = $2::ticket_stage,
                    status = $3::ticket_status,
                    updated_at = NOW()
                WHERE ticket_id = $1
                RETURNING *
                """,
                ticket_id,
                new_stage,
                new_status,
            )
            if row is None:
                return None
            return _row_to_ticket(row)

    async def count_by_stage(self) -> dict[str, int]:
        """Return a mapping of stage name to ticket count.

        Returns:
            A dict like ``{"READY": 5, "BACKEND": 3, ...}``.
        """
        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                """
                SELECT stage::text AS stage_name, COUNT(*)::int AS cnt
                FROM tickets
                GROUP BY stage
                """
            )
            return {r["stage_name"]: r["cnt"] for r in rows}

    async def list_filtered(
        self,
        *,
        stage: str | None = None,
        ticket_type: str | None = None,
        priority: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[TicketRow]:
        """List tickets with optional combined filters.

        Builds a dynamic WHERE clause using parameterized queries.

        Args:
            stage: Optional SDLC stage filter.
            ticket_type: Optional ticket type filter.
            priority: Optional priority filter.
            limit: Maximum rows to return.
            offset: Rows to skip for pagination.

        Returns:
            A list of ``TicketRow`` objects.
        """
        conditions: list[str] = []
        params: list[Any] = []
        idx = 1

        if stage is not None:
            conditions.append(f"stage = ${idx}::ticket_stage")
            params.append(stage)
            idx += 1
        if ticket_type is not None:
            conditions.append(f"type = ${idx}::ticket_type")
            params.append(ticket_type)
            idx += 1
        if priority is not None:
            conditions.append(f"priority = ${idx}::ticket_priority")
            params.append(priority)
            idx += 1

        where = ""
        if conditions:
            where = "WHERE " + " AND ".join(conditions)

        query = f"""
            SELECT *
            FROM tickets
            {where}
            ORDER BY
                CASE priority
                    WHEN 'critical' THEN 0
                    WHEN 'high'     THEN 1
                    WHEN 'medium'   THEN 2
                    WHEN 'low'      THEN 3
                END,
                created_at ASC
            LIMIT ${idx} OFFSET ${idx + 1}
        """
        params.extend([limit, offset])

        async with self._pool.acquire() as conn:
            rows = await conn.fetch(query, *params)
            return [_row_to_ticket(r) for r in rows]
