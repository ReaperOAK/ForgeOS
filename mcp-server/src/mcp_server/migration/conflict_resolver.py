"""Database-wins conflict resolver for bidirectional sync.

When filesystem and database state diverge (e.g. a ticket's stage differs
between the JSON on disk and the row in PostgreSQL), this module resolves
the conflict by treating the **database** as the authoritative source.

Every resolution is recorded in a structured audit log accessible via
:attr:`ConflictResolver.conflicts`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from mcp_server.observability import get_logger

logger = get_logger("migration.conflict_resolver")


# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------


class ConflictType(str, Enum):
    """Categories of divergence between filesystem and database."""

    STAGE_MISMATCH = "stage_mismatch"
    CLAIM_MISMATCH = "claim_mismatch"
    METADATA_MISMATCH = "metadata_mismatch"
    NEW_IN_FS = "new_in_fs"
    NEW_IN_DB = "new_in_db"


@dataclass(frozen=True)
class ConflictRecord:
    """Immutable audit entry for a single conflict resolution."""

    ticket_id: str
    conflict_type: ConflictType
    fs_value: Any
    db_value: Any
    resolution: str
    resolved_at: str  # ISO-8601


# ---------------------------------------------------------------------------
# Resolver
# ---------------------------------------------------------------------------


class ConflictResolver:
    """Database-wins conflict resolver with structured audit logging.

    All :meth:`resolve_*` methods return the **database** value and
    append a :class:`ConflictRecord` to the internal log.
    """

    def __init__(self) -> None:
        self._conflicts: list[ConflictRecord] = []

    # -- public API --------------------------------------------------------

    @property
    def conflicts(self) -> list[ConflictRecord]:
        """Return a *copy* of the conflict audit log."""
        return list(self._conflicts)

    def clear(self) -> None:
        """Reset the audit log (useful between sync cycles)."""
        self._conflicts.clear()

    def resolve_stage(
        self,
        ticket_id: str,
        fs_stage: str,
        db_stage: str,
    ) -> str:
        """Resolve a stage mismatch — database wins.

        Returns the *db_stage* value and logs the resolution.
        """
        record = ConflictRecord(
            ticket_id=ticket_id,
            conflict_type=ConflictType.STAGE_MISMATCH,
            fs_value=fs_stage,
            db_value=db_stage,
            resolution=f"database-wins: stage set to {db_stage}",
            resolved_at=datetime.now(timezone.utc).isoformat(),
        )
        self._conflicts.append(record)

        logger.info(
            "Stage conflict resolved (database-wins)",
            extra={
                "ticket_id": ticket_id,
                "fs_stage": fs_stage,
                "db_stage": db_stage,
            },
        )
        return db_stage

    def resolve_claim(
        self,
        ticket_id: str,
        fs_claim: dict[str, Any],
        db_claim: dict[str, Any],
    ) -> dict[str, Any]:
        """Resolve a claim/lease mismatch — database wins.

        Returns the *db_claim* dict and logs the resolution.
        """
        record = ConflictRecord(
            ticket_id=ticket_id,
            conflict_type=ConflictType.CLAIM_MISMATCH,
            fs_value=fs_claim,
            db_value=db_claim,
            resolution="database-wins: claim metadata overwritten",
            resolved_at=datetime.now(timezone.utc).isoformat(),
        )
        self._conflicts.append(record)

        logger.info(
            "Claim conflict resolved (database-wins)",
            extra={
                "ticket_id": ticket_id,
                "fs_claimed_by": fs_claim.get("claimed_by"),
                "db_claimed_by": db_claim.get("claimed_by"),
            },
        )
        return db_claim

    def resolve_metadata(
        self,
        ticket_id: str,
        field_name: str,
        fs_value: Any,
        db_value: Any,
    ) -> Any:
        """Resolve a generic metadata mismatch — database wins.

        Returns the *db_value* and logs the resolution.
        """
        record = ConflictRecord(
            ticket_id=ticket_id,
            conflict_type=ConflictType.METADATA_MISMATCH,
            fs_value=fs_value,
            db_value=db_value,
            resolution=f"database-wins: {field_name} set to DB value",
            resolved_at=datetime.now(timezone.utc).isoformat(),
        )
        self._conflicts.append(record)

        logger.info(
            "Metadata conflict resolved (database-wins)",
            extra={
                "ticket_id": ticket_id,
                "field": field_name,
            },
        )
        return db_value

    def record_new_in_fs(self, ticket_id: str) -> None:
        """Record that a ticket exists only on the filesystem (will be imported)."""
        record = ConflictRecord(
            ticket_id=ticket_id,
            conflict_type=ConflictType.NEW_IN_FS,
            fs_value=ticket_id,
            db_value=None,
            resolution="import: ticket will be imported to database",
            resolved_at=datetime.now(timezone.utc).isoformat(),
        )
        self._conflicts.append(record)

        logger.info(
            "New ticket detected on filesystem",
            extra={"ticket_id": ticket_id},
        )

    def record_new_in_db(self, ticket_id: str) -> None:
        """Record that a ticket exists only in the database (will be exported)."""
        record = ConflictRecord(
            ticket_id=ticket_id,
            conflict_type=ConflictType.NEW_IN_DB,
            fs_value=None,
            db_value=ticket_id,
            resolution="export: ticket will be written to filesystem",
            resolved_at=datetime.now(timezone.utc).isoformat(),
        )
        self._conflicts.append(record)

        logger.info(
            "New ticket detected in database",
            extra={"ticket_id": ticket_id},
        )
