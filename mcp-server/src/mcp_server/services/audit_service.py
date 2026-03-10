"""Audit service — business logic for comprehensive audit logging.

Provides :class:`AuditService`, a high-level orchestration layer for
recording and querying audit log entries. The service extracts identity
information from the request's :class:`AuthContext` and delegates
persistence to :class:`AuditRepository`.

Public API
----------
* :class:`AuditService` — log operations, query audit trail.

.. meta::
   :ticket: FORGEOS-BE058
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from datetime import datetime

    from mcp_server.middleware.auth_middleware import AuthContext
    from mcp_server.repositories.audit_repo import AuditLogRow, AuditRepository

logger = get_logger("services.audit")


class AuditService:
    """High-level service for audit logging operations.

    Parameters
    ----------
    audit_repo : AuditRepository
        Repository for audit log persistence.
    """

    def __init__(self, audit_repo: AuditRepository) -> None:
        self._repo = audit_repo

    async def log_operation(
        self,
        *,
        auth_ctx: AuthContext,
        operation: str,
        target: str = "",
        result: str = "success",
        metadata: dict[str, Any] | None = None,
        source_machine: str = "",
    ) -> AuditLogRow:
        """Record an authenticated operation in the audit log.

        Parameters
        ----------
        auth_ctx : AuthContext
            The authentication context for the current request.
        operation : str
            The action performed (e.g. ``"mcp.claim_next"``, ``"GET /api/tickets"``).
        target : str
            Target resource (e.g. ticket ID, endpoint path).
        result : str
            Outcome of the operation (``"success"``, ``"failure"``, ``"error"``).
        metadata : dict | None
            Additional context.
        source_machine : str
            Machine/IP originating the request.

        Returns
        -------
        AuditLogRow
            The created audit log entry.
        """
        machine = source_machine or auth_ctx.machine_id
        return await self._repo.append(
            identity_type=auth_ctx.identity_type.value,
            identity_id=auth_ctx.identity_id,
            operation=operation,
            target=target,
            result=result,
            metadata=metadata,
            source_machine=machine,
        )

    async def query_logs(
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
            Maximum number of rows.
        offset : int
            Pagination offset.

        Returns
        -------
        list[AuditLogRow]
            Matching entries ordered by timestamp DESC.
        """
        return await self._repo.query(
            identity_id=identity_id,
            identity_type=identity_type,
            operation=operation,
            since=since,
            until=until,
            limit=limit,
            offset=offset,
        )

    async def count_logs(
        self,
        *,
        identity_id: str | None = None,
        identity_type: str | None = None,
        operation: str | None = None,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> int:
        """Count matching audit log entries.

        Uses the same filter parameters as :meth:`query_logs`.
        """
        return await self._repo.count(
            identity_id=identity_id,
            identity_type=identity_type,
            operation=operation,
            since=since,
            until=until,
        )
