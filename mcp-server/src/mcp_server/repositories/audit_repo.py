"""Audit log repository — append-only data access for audit records.

Provides :class:`AuditRepository` for inserting and querying audit log
entries. This repository enforces append-only semantics: only INSERT
and SELECT operations are exposed. No UPDATE or DELETE methods exist.

.. meta::
   :ticket: FORGEOS-BE058
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from datetime import datetime
    from uuid import UUID

    import asyncpg

logger = get_logger(__name__)


@dataclass(frozen=True, slots=True)
class AuditLogRow:
    """Immutable representation of a row in the ``audit_log`` table."""

    audit_id: UUID
    identity_type: str
    identity_id: str
    operation: str
    target: str
    result: str
    timestamp: datetime
    metadata: dict[str, Any]
    source_machine: str


def _row_to_audit(row: asyncpg.Record) -> AuditLogRow:
    """Convert an asyncpg Record to an AuditLogRow."""
    meta = row["metadata"]
    if isinstance(meta, str):
        meta = json.loads(meta)
    return AuditLogRow(
        audit_id=row["audit_id"],
        identity_type=row["identity_type"],
        identity_id=row["identity_id"],
        operation=row["operation"],
        target=row["target"],
        result=row["result"],
        timestamp=row["timestamp"],
        metadata=meta if meta else {},
        source_machine=row["source_machine"],
    )


class AuditRepository:
    """Data-access object for the ``audit_log`` table (append-only).

    This repository intentionally exposes NO update or delete methods.
    Audit records are immutable once written.

    All SQL uses parameterized queries to prevent injection.
    """

    def __init__(self, pool: asyncpg.Pool[Any]) -> None:
        self._pool = pool

    async def append(
        self,
        *,
        identity_type: str,
        identity_id: str,
        operation: str,
        target: str = "",
        result: str = "success",
        metadata: dict[str, Any] | None = None,
        source_machine: str = "",
    ) -> AuditLogRow:
        """Insert a new audit log entry.

        Parameters
        ----------
        identity_type : str
            Type of identity (agent, operator, admin).
        identity_id : str
            Identifier of the authenticated entity.
        operation : str
            The action performed.
        target : str
            Target resource identifier.
        result : str
            Outcome of the operation (success, failure, error).
        metadata : dict | None
            Additional context as JSON.
        source_machine : str
            Machine/IP originating the request.

        Returns
        -------
        AuditLogRow
            The newly created audit log entry.
        """
        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                INSERT INTO audit_log (
                    identity_type, identity_id, operation,
                    target, result, metadata, source_machine
                ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
                RETURNING *
                """,
                identity_type,
                identity_id,
                operation,
                target,
                result,
                json.dumps(metadata) if metadata else "{}",
                source_machine,
            )
            logger.info(
                "audit_entry_created",
                extra={
                    "audit_id": str(row["audit_id"]),
                    "operation": operation,
                    "identity_type": identity_type,
                },
            )
            return _row_to_audit(row)

    async def query(
        self,
        *,
        identity_id: str | None = None,
        identity_type: str | None = None,
        operation: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[AuditLogRow]:
        """Query audit log entries with optional filters.

        Parameters
        ----------
        identity_id : str | None
            Filter by identity identifier.
        identity_type : str | None
            Filter by identity type.
        operation : str | None
            Filter by operation name.
        since : datetime | None
            Only entries at or after this timestamp.
        until : datetime | None
            Only entries before this timestamp.
        limit : int
            Maximum number of rows to return (capped at 1000).
        offset : int
            Number of rows to skip for pagination.

        Returns
        -------
        list[AuditLogRow]
            Matching audit log entries ordered by timestamp DESC.
        """
        limit = min(limit, 1000)

        conditions: list[str] = []
        params: list[Any] = []
        idx = 1

        if identity_id is not None:
            conditions.append(f"identity_id = ${idx}")
            params.append(identity_id)
            idx += 1

        if identity_type is not None:
            conditions.append(f"identity_type = ${idx}")
            params.append(identity_type)
            idx += 1

        if operation is not None:
            conditions.append(f"operation = ${idx}")
            params.append(operation)
            idx += 1

        if since is not None:
            conditions.append(f"timestamp >= ${idx}")
            params.append(since)
            idx += 1

        if until is not None:
            conditions.append(f"timestamp < ${idx}")
            params.append(until)
            idx += 1

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        params.append(limit)
        params.append(offset)

        sql = f"""
            SELECT * FROM audit_log
            {where_clause}
            ORDER BY timestamp DESC
            LIMIT ${idx} OFFSET ${idx + 1}
        """

        async with self._pool.acquire() as conn:
            rows = await conn.fetch(sql, *params)
            return [_row_to_audit(r) for r in rows]

    async def count(
        self,
        *,
        identity_id: str | None = None,
        identity_type: str | None = None,
        operation: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> int:
        """Count audit log entries matching filters.

        Uses the same filter logic as :meth:`query`.

        Returns
        -------
        int
            Number of matching entries.
        """
        conditions: list[str] = []
        params: list[Any] = []
        idx = 1

        if identity_id is not None:
            conditions.append(f"identity_id = ${idx}")
            params.append(identity_id)
            idx += 1

        if identity_type is not None:
            conditions.append(f"identity_type = ${idx}")
            params.append(identity_type)
            idx += 1

        if operation is not None:
            conditions.append(f"operation = ${idx}")
            params.append(operation)
            idx += 1

        if since is not None:
            conditions.append(f"timestamp >= ${idx}")
            params.append(since)
            idx += 1

        if until is not None:
            conditions.append(f"timestamp < ${idx}")
            params.append(until)
            idx += 1

        where_clause = ""
        if conditions:
            where_clause = "WHERE " + " AND ".join(conditions)

        sql = f"SELECT COUNT(*) FROM audit_log {where_clause}"

        async with self._pool.acquire() as conn:
            return await conn.fetchval(sql, *params)
