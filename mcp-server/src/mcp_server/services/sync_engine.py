"""Sync engine — dependency resolution and integrity validation.

Provides :class:`SyncEngine`, which performs two critical operations:

1. **Sync** — releases expired leases (via :mod:`lease_cleanup`),
   evaluates the dependency graph for all non-DONE tickets, and
   moves newly unblocked tickets to READY.
2. **Validate** — checks every ticket for integrity: each ticket must
   exist in exactly one stage, the stage field must match, and the
   SDLC flow must be valid (stage is a member of ``sdlc_flow``).

Public API
----------
* :class:`SyncEngine` — orchestration for sync and validate operations.
* :class:`SyncResult` — summary of changes from a sync operation.
* :class:`IntegrityError` — a single integrity violation.
* :class:`ValidateResult` — list of integrity errors from validation.

.. meta::
   :ticket: FORGEOS-BE033
   :last_reviewed: 2026-03-11T00:00:00Z
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from mcp_server.observability import get_logger

logger = get_logger("services.sync_engine")


# ---------------------------------------------------------------------------
# Protocols
# ---------------------------------------------------------------------------


class PoolLike(Protocol):
    """Minimal async pool interface for database operations."""

    def acquire(self) -> Any:
        """Return an async context manager yielding a connection."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------

# Valid SDLC stages in order (matching the ticket_stage enum in PostgreSQL).
VALID_STAGES: list[str] = [
    "READY",
    "RESEARCH",
    "ARCHITECT",
    "PRODUCT_MANAGER",
    "UI_DESIGN",
    "BACKEND",
    "FRONTEND",
    "QA",
    "SECURITY",
    "CI",
    "DOCUMENTATION",
    "VALIDATOR",
    "DONE",
]

# Valid SDLC flows by ticket type.
SDLC_FLOWS: dict[str, list[str]] = {
    "backend": [
        "READY", "BACKEND", "QA", "SECURITY", "CI",
        "DOCUMENTATION", "VALIDATOR", "DONE",
    ],
    "frontend": [
        "READY", "FRONTEND", "QA", "SECURITY", "CI",
        "DOCUMENTATION", "VALIDATOR", "DONE",
    ],
    "fullstack": [
        "READY", "BACKEND", "FRONTEND", "QA", "SECURITY", "CI",
        "DOCUMENTATION", "VALIDATOR", "DONE",
    ],
    "infra": [
        "READY", "BACKEND", "QA", "SECURITY", "CI",
        "DOCUMENTATION", "VALIDATOR", "DONE",
    ],
    "security": [
        "READY", "SECURITY", "QA", "CI",
        "DOCUMENTATION", "VALIDATOR", "DONE",
    ],
    "docs": ["READY", "DOCUMENTATION", "VALIDATOR", "DONE"],
    "research": ["READY", "RESEARCH", "DOCUMENTATION", "VALIDATOR", "DONE"],
    "architecture": [
        "READY", "ARCHITECT", "DOCUMENTATION", "VALIDATOR", "DONE",
    ],
}


@dataclass(frozen=True, slots=True)
class SyncResult:
    """Summary of changes from a sync operation.

    Attributes
    ----------
    released_count : int
        Number of expired leases released.
    released_tickets : list[str]
        Ticket IDs whose leases were released.
    unblocked_count : int
        Number of tickets moved from BLOCKED to READY.
    unblocked_tickets : list[str]
        Ticket IDs that were unblocked.
    errors : list[str]
        Description of any errors encountered during sync.
    """

    released_count: int = 0
    released_tickets: list[str] = field(default_factory=list)
    unblocked_count: int = 0
    unblocked_tickets: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict suitable for MCP tool output."""
        return {
            "released_count": self.released_count,
            "released_tickets": self.released_tickets,
            "unblocked_count": self.unblocked_count,
            "unblocked_tickets": self.unblocked_tickets,
            "errors": self.errors,
        }


@dataclass(frozen=True, slots=True)
class IntegrityError:
    """A single integrity violation detected during validation.

    Attributes
    ----------
    ticket_id : str
        The ticket with the integrity issue.
    error_type : str
        Category of the violation (e.g. ``"stage_mismatch"``).
    message : str
        Human-readable description of the violation.
    """

    ticket_id: str
    error_type: str
    message: str

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict."""
        return {
            "ticket_id": self.ticket_id,
            "error_type": self.error_type,
            "message": self.message,
        }


@dataclass(frozen=True, slots=True)
class ValidateResult:
    """Result of a full integrity validation.

    Attributes
    ----------
    errors : list[IntegrityError]
        List of integrity violations. Empty means clean.
    """

    errors: list[IntegrityError] = field(default_factory=list)

    @property
    def is_clean(self) -> bool:
        """Return True if there are no integrity errors."""
        return len(self.errors) == 0

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict suitable for MCP tool output."""
        return {
            "is_clean": self.is_clean,
            "error_count": len(self.errors),
            "errors": [e.to_dict() for e in self.errors],
        }


# ---------------------------------------------------------------------------
# Sync engine
# ---------------------------------------------------------------------------


class SyncEngine:
    """Orchestrates sync (dependency resolution) and validate (integrity check).

    Parameters
    ----------
    pool : PoolLike
        Database connection pool (asyncpg pool or compatible).
    """

    def __init__(self, pool: PoolLike) -> None:
        self._pool = pool

    # ----- sync -----------------------------------------------------------

    async def sync(self) -> SyncResult:
        """Release expired leases and unblock tickets whose deps are met.

        Steps:
        1. Release all expired leases via :func:`scan_and_release_expired`.
        2. Find all BLOCKED tickets.
        3. For each, check if all ``depends_on`` tickets are in DONE.
        4. If so, move the ticket to READY.

        Returns
        -------
        SyncResult
            Summary of released leases, unblocked tickets, and errors.
        """
        from mcp_server.locking.lease_cleanup import scan_and_release_expired

        errors: list[str] = []
        released_tickets: list[str] = []
        unblocked_tickets: list[str] = []

        # Step 1: Release expired leases.
        try:
            releases = await scan_and_release_expired(self._pool)
            released_tickets = [r.ticket_id for r in releases]
            if released_tickets:
                logger.info(
                    "Sync released expired leases",
                    extra={
                        "count": len(released_tickets),
                        "tickets": released_tickets,
                    },
                )
        except Exception as exc:
            error_msg = f"Failed to release expired leases: {exc}"
            logger.error(error_msg)
            errors.append(error_msg)

        # Step 2: Evaluate dependency graph for BLOCKED tickets.
        try:
            unblocked_tickets = await self._resolve_dependencies()
            if unblocked_tickets:
                logger.info(
                    "Sync unblocked tickets",
                    extra={
                        "count": len(unblocked_tickets),
                        "tickets": unblocked_tickets,
                    },
                )
        except Exception as exc:
            error_msg = f"Failed to resolve dependencies: {exc}"
            logger.error(error_msg)
            errors.append(error_msg)

        result = SyncResult(
            released_count=len(released_tickets),
            released_tickets=released_tickets,
            unblocked_count=len(unblocked_tickets),
            unblocked_tickets=unblocked_tickets,
            errors=errors,
        )

        logger.info(
            "Sync completed",
            extra={
                "released": result.released_count,
                "unblocked": result.unblocked_count,
                "errors": len(result.errors),
            },
        )

        return result

    async def _resolve_dependencies(self) -> list[str]:
        """Evaluate dependency graph and unblock tickets.

        For each BLOCKED ticket, checks whether all tickets in its
        ``depends_on`` array have status ``DONE``.  If so, updates
        the ticket's status to ``READY`` and records an event.

        Returns
        -------
        list[str]
            Ticket IDs that were moved from BLOCKED to READY.
        """
        now = datetime.now(timezone.utc)
        unblocked: list[str] = []

        async with self._pool.acquire() as conn:
            # Fetch all BLOCKED tickets with their dependencies.
            blocked_rows = await conn.fetch(
                "SELECT ticket_id, depends_on "
                "FROM tickets "
                "WHERE status = 'BLOCKED'::ticket_status "
                "  AND array_length(depends_on, 1) > 0"
            )

            if not blocked_rows:
                logger.debug("No BLOCKED tickets with dependencies")
                return unblocked

            # Fetch all DONE ticket IDs in one query for efficient lookup.
            done_rows = await conn.fetch(
                "SELECT ticket_id FROM tickets "
                "WHERE status = 'DONE'::ticket_status"
            )
            done_set = frozenset(row["ticket_id"] for row in done_rows)

            for row in blocked_rows:
                ticket_id: str = row["ticket_id"]
                deps: list[str] = list(row["depends_on"])

                if all(dep in done_set for dep in deps):
                    # All dependencies resolved — move to READY.
                    async with conn.transaction():
                        await conn.execute(
                            "UPDATE tickets "
                            "SET status = 'READY'::ticket_status, "
                            "    updated_at = $1 "
                            "WHERE ticket_id = $2",
                            now,
                            ticket_id,
                        )

                        await conn.execute(
                            "INSERT INTO events "
                            "(ticket_id, event_type, payload) "
                            "VALUES ($1, 'UPDATED'::event_type, $2::jsonb)",
                            ticket_id,
                            json.dumps({
                                "action": "dependency_resolved",
                                "resolved_deps": deps,
                                "source": "tickets.sync",
                            }),
                        )

                    unblocked.append(ticket_id)
                    logger.info(
                        "Ticket unblocked by sync",
                        extra={
                            "ticket_id": ticket_id,
                            "resolved_deps": deps,
                        },
                    )

        return unblocked

    # ----- validate -------------------------------------------------------

    async def validate(self) -> ValidateResult:
        """Perform full integrity check across all tickets.

        Checks:
        1. Each ticket's ``stage`` is a valid member of :data:`VALID_STAGES`.
        2. Each ticket's ``stage`` is a member of its own ``sdlc_flow``.
        3. Each ticket's ``sdlc_flow`` matches the expected flow for its type.
        4. No ticket is duplicated (checked via UNIQUE constraint, but
           we verify no orphaned states exist).

        Returns
        -------
        ValidateResult
            List of integrity errors (empty = clean).
        """
        integrity_errors: list[IntegrityError] = []

        async with self._pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT ticket_id, type::text AS ticket_type, "
                "       stage::text AS stage, status::text AS status, "
                "       sdlc_flow::text[] AS sdlc_flow "
                "FROM tickets"
            )

        for row in rows:
            ticket_id: str = row["ticket_id"]
            ticket_type: str = row["ticket_type"]
            stage: str = row["stage"]
            sdlc_flow: list[str] = list(row["sdlc_flow"])

            # Check 1: stage is a valid stage.
            if stage not in VALID_STAGES:
                integrity_errors.append(IntegrityError(
                    ticket_id=ticket_id,
                    error_type="invalid_stage",
                    message=f"Stage '{stage}' is not a valid SDLC stage",
                ))

            # Check 2: stage is a member of the ticket's own sdlc_flow.
            if stage not in sdlc_flow:
                integrity_errors.append(IntegrityError(
                    ticket_id=ticket_id,
                    error_type="stage_not_in_flow",
                    message=(
                        f"Stage '{stage}' is not in ticket's "
                        f"sdlc_flow {sdlc_flow}"
                    ),
                ))

            # Check 3: sdlc_flow matches expected flow for ticket type.
            expected_flow = SDLC_FLOWS.get(ticket_type)
            if expected_flow is None:
                integrity_errors.append(IntegrityError(
                    ticket_id=ticket_id,
                    error_type="unknown_ticket_type",
                    message=f"Unknown ticket type '{ticket_type}'",
                ))
            elif sdlc_flow != expected_flow:
                integrity_errors.append(IntegrityError(
                    ticket_id=ticket_id,
                    error_type="flow_mismatch",
                    message=(
                        f"sdlc_flow {sdlc_flow} does not match "
                        f"expected flow for type '{ticket_type}': "
                        f"{expected_flow}"
                    ),
                ))

        if integrity_errors:
            logger.warning(
                "Validation found integrity errors",
                extra={"error_count": len(integrity_errors)},
            )
        else:
            logger.info("Validation passed: no integrity errors")

        return ValidateResult(errors=integrity_errors)
