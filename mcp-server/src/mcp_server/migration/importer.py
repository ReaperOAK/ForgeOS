"""Filesystem-to-database ticket importer.

Reads ticket JSON from ``.github/tickets/`` and stage metadata from
``.github/ticket-state/`` directories, transforms records to database
format, and writes them with upsert semantics.

Features: dry-run mode, progress reporting, import summary.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from mcp_server.migration.transformers import (
    TicketTransformer,
    TransformedEvent,
    TransformedTicket,
    TransformError,
)
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from pathlib import Path

logger = get_logger("migration.importer")

# ---------------------------------------------------------------------------
# Public type alias
# ---------------------------------------------------------------------------

ProgressCallback = Callable[[int, int, str], None]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ImportConfig:
    """Settings for a ticket import run."""

    tickets_dir: Path
    ticket_state_dir: Path
    dry_run: bool = False


# ---------------------------------------------------------------------------
# Database writer protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class DatabaseWriter(Protocol):
    """Async interface for persisting imported data."""

    async def upsert_ticket(
        self, ticket: TransformedTicket,
    ) -> bool:
        """Insert or update a ticket.

        Returns ``True`` if newly inserted, ``False`` if updated.
        """
        ...

    async def insert_events(
        self, events: list[TransformedEvent],
    ) -> int:
        """Insert events, skipping duplicates.

        Returns count of successfully inserted events.
        """
        ...


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class ImportStats:
    """Counters for a single import run."""

    total_found: int = 0
    imported: int = 0
    updated: int = 0
    skipped: int = 0
    errors: int = 0
    events_imported: int = 0


@dataclass
class ImportResult:
    """Outcome of an import run."""

    stats: ImportStats
    dry_run: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> str:
        """Human-readable summary string."""
        mode = "DRY RUN" if self.dry_run else "IMPORT"
        lines = [
            f"=== {mode} Summary ===",
            f"Total tickets found: {self.stats.total_found}",
            f"Imported (new):      {self.stats.imported}",
            f"Updated (existing):  {self.stats.updated}",
            f"Skipped:             {self.stats.skipped}",
            f"Errors:              {self.stats.errors}",
            f"Events imported:     {self.stats.events_imported}",
        ]
        if self.errors:
            lines.append("--- Errors ---")
            lines.extend(f"  - {e}" for e in self.errors)
        if self.warnings:
            lines.append("--- Warnings ---")
            lines.extend(f"  - {w}" for w in self.warnings)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Importer
# ---------------------------------------------------------------------------


class TicketImporter:
    """Orchestrates filesystem → database ticket import."""

    def __init__(
        self,
        config: ImportConfig,
        writer: DatabaseWriter | None = None,
        *,
        transformer: TicketTransformer | None = None,
        on_progress: ProgressCallback | None = None,
    ) -> None:
        self._config = config
        self._writer = writer
        self._transformer = transformer or TicketTransformer()
        self._on_progress = on_progress

    async def run(self) -> ImportResult:
        """Execute the import and return results."""
        if not self._config.dry_run and self._writer is None:
            raise ValueError(
                "A DatabaseWriter is required when dry_run is False"
            )

        stats = ImportStats()
        errors: list[str] = []
        warnings: list[str] = []

        # 1. Scan filesystem
        raw_tickets = self._scan_ticket_files()
        stats.total_found = len(raw_tickets)

        if not raw_tickets:
            logger.info(
                "No ticket files found",
                extra={"dir": str(self._config.tickets_dir)},
            )
            return ImportResult(
                stats=stats, dry_run=self._config.dry_run,
            )

        stage_map = self._scan_state_directories()

        # 2. Transform and persist each ticket
        for idx, (ticket_id, raw_data) in enumerate(
            sorted(raw_tickets.items()), start=1,
        ):
            self._report_progress(
                idx, stats.total_found, ticket_id,
            )

            # Resolve the most advanced directory stage
            dir_stages = stage_map.get(ticket_id, [])
            resolved_stage: str | None = None
            if dir_stages:
                resolved_stage = self._transformer.resolve_stage(
                    dir_stages,
                )

            try:
                result = self._transformer.transform(
                    raw_data, resolved_stage=resolved_stage,
                )
            except TransformError as exc:
                stats.errors += 1
                errors.append(str(exc))
                logger.warning(
                    "Transform failed",
                    extra={
                        "ticket_id": ticket_id,
                        "reason": exc.reason,
                    },
                )
                continue

            warnings.extend(result.warnings)

            if self._config.dry_run:
                stats.imported += 1
                stats.events_imported += len(result.events)
            else:
                assert self._writer is not None  # guarded above
                try:
                    is_new = await self._writer.upsert_ticket(
                        result.ticket,
                    )
                    if is_new:
                        stats.imported += 1
                    else:
                        stats.updated += 1
                    evt_count = await self._writer.insert_events(
                        result.events,
                    )
                    stats.events_imported += evt_count
                except Exception as exc:
                    stats.errors += 1
                    msg = f"DB write failed for {ticket_id}: {exc}"
                    errors.append(msg)
                    logger.error(
                        "Database write failed",
                        extra={
                            "ticket_id": ticket_id,
                            "error": str(exc),
                        },
                    )

        import_result = ImportResult(
            stats=stats,
            dry_run=self._config.dry_run,
            errors=errors,
            warnings=warnings,
        )
        logger.info(
            "Import complete",
            extra={
                "dry_run": self._config.dry_run,
                "total": stats.total_found,
                "imported": stats.imported,
                "updated": stats.updated,
                "errors": stats.errors,
            },
        )
        return import_result

    # --- filesystem scanning ----------------------------------------------

    def _scan_ticket_files(self) -> dict[str, dict[str, Any]]:
        """Read all ``*.json`` files from the tickets directory."""
        tickets: dict[str, dict[str, Any]] = {}
        tickets_dir = self._config.tickets_dir
        if not tickets_dir.is_dir():
            logger.warning(
                "Tickets directory does not exist",
                extra={"path": str(tickets_dir)},
            )
            return tickets

        for path in sorted(tickets_dir.glob("*.json")):
            try:
                raw = json.loads(
                    path.read_text(encoding="utf-8"),
                )
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning(
                    "Failed to read ticket file",
                    extra={
                        "path": str(path),
                        "error": str(exc),
                    },
                )
                continue

            if not isinstance(raw, dict):
                logger.warning(
                    "Ticket file is not a JSON object",
                    extra={"path": str(path)},
                )
                continue

            tid: str = raw.get("ticket_id", path.stem)
            tickets[tid] = raw

        return tickets

    def _scan_state_directories(
        self,
    ) -> dict[str, list[str]]:
        """Scan ``ticket-state/`` subdirs → ticket→stages mapping.

        Returns a dict mapping ticket IDs to the list of directory
        names where copies of that ticket were found.
        """
        stage_map: dict[str, list[str]] = {}
        state_dir = self._config.ticket_state_dir
        if not state_dir.is_dir():
            return stage_map

        for subdir in sorted(state_dir.iterdir()):
            if not subdir.is_dir():
                continue
            stage_name = subdir.name
            for json_file in subdir.glob("*.json"):
                tid = json_file.stem
                stage_map.setdefault(tid, []).append(stage_name)

        return stage_map

    # --- progress ---------------------------------------------------------

    def _report_progress(
        self, current: int, total: int, ticket_id: str,
    ) -> None:
        if self._on_progress is not None:
            self._on_progress(current, total, ticket_id)
        logger.debug(
            "Processing ticket %d/%d",
            current,
            total,
            extra={"ticket_id": ticket_id},
        )
