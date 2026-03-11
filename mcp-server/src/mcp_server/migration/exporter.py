"""Database-to-filesystem ticket exporter.

Reads ticket records from PostgreSQL and generates:

- ``.github/tickets/<ticket_id>.json`` master files
- ``.github/ticket-state/<STAGE>/<ticket_id>.json`` state directory copies

Features: backup of existing files, dry-run mode, active claim handling,
export summary report.
"""

from __future__ import annotations

import json
import shutil
from collections import Counter
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from mcp_server.migration.transformers import DB_TO_STAGE_DIR
from mcp_server.observability import get_logger

logger = get_logger("migration.exporter")

# ---------------------------------------------------------------------------
# Public type alias
# ---------------------------------------------------------------------------

ProgressCallback = Callable[[int, int, str], None]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ExportConfig:
    """Settings for a ticket export run."""

    tickets_dir: Path
    ticket_state_dir: Path
    backup_dir: Path | None = None
    dry_run: bool = False


# ---------------------------------------------------------------------------
# Database reader protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ExportDatabaseReader(Protocol):
    """Async interface for reading complete ticket data from the database.

    Implementations must return dicts whose keys match the database
    column names.  The exporter maps them back to the filesystem
    JSON schema consumed by ``tickets.py``.
    """

    async def read_all_tickets(self) -> list[dict[str, Any]]:
        """Return all tickets as dicts.

        Each dict must include at minimum:
        ``ticket_id``, ``title``, ``ticket_type``, ``priority``,
        ``stage`` (DB-enum name), ``sdlc_flow``, ``depends_on``,
        ``file_paths``, ``acceptance_criteria``, ``tags``,
        ``rework_count``, ``claimed_by`` / ``claimed_by_name``,
        ``machine_id``, ``operator``, ``lease_expiry``,
        ``lease_duration_minutes``, ``created_at``, ``history``.
        """
        ...


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class ExportStats:
    """Counters for a single export run."""

    total_read: int = 0
    exported: int = 0
    backed_up: int = 0
    errors: int = 0
    active_claims: int = 0
    stage_distribution: dict[str, int] = field(default_factory=dict)


@dataclass
class ExportResult:
    """Outcome of an export run."""

    stats: ExportStats
    dry_run: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def summary(self) -> str:
        """Human-readable summary string."""
        mode = "DRY RUN" if self.dry_run else "EXPORT"
        lines = [
            f"=== {mode} Summary ===",
            f"Total tickets read:     {self.stats.total_read}",
            f"Exported:               {self.stats.exported}",
            f"Backed up:              {self.stats.backed_up}",
            f"Active claims:          {self.stats.active_claims}",
            f"Errors:                 {self.stats.errors}",
        ]
        if self.stats.stage_distribution:
            lines.append("--- Stage Distribution ---")
            for stage, count in sorted(
                self.stats.stage_distribution.items(),
            ):
                lines.append(f"  {stage}: {count}")
        if self.errors:
            lines.append("--- Errors ---")
            lines.extend(f"  - {e}" for e in self.errors)
        if self.warnings:
            lines.append("--- Warnings ---")
            lines.extend(f"  - {w}" for w in self.warnings)
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# Exporter
# ---------------------------------------------------------------------------


class TicketExporter:
    """Orchestrates database → filesystem ticket export."""

    def __init__(
        self,
        config: ExportConfig,
        reader: ExportDatabaseReader,
        *,
        on_progress: ProgressCallback | None = None,
    ) -> None:
        self._config = config
        self._reader = reader
        self._on_progress = on_progress

    async def run(self) -> ExportResult:
        """Execute the export and return results."""
        stats = ExportStats()
        errors: list[str] = []
        warnings: list[str] = []
        stage_counter: Counter[str] = Counter()

        # 1. Read from database
        try:
            db_tickets = await self._reader.read_all_tickets()
        except Exception as exc:
            return ExportResult(
                stats=stats,
                dry_run=self._config.dry_run,
                errors=[f"Database read failed: {exc}"],
            )

        stats.total_read = len(db_tickets)

        if not db_tickets:
            logger.info("No tickets found in database")
            return ExportResult(
                stats=stats, dry_run=self._config.dry_run,
            )

        # 2. Backup existing files if not dry run
        if not self._config.dry_run:
            stats.backed_up = self._backup_existing()

        # 3. Export each ticket
        for idx, db_ticket in enumerate(
            sorted(
                db_tickets,
                key=lambda t: t.get("ticket_id", ""),
            ),
            start=1,
        ):
            ticket_id = db_ticket.get("ticket_id", "<unknown>")
            self._report_progress(idx, stats.total_read, ticket_id)

            try:
                fs_json = self._to_filesystem_json(db_ticket)
                fs_stage = self._resolve_fs_stage(db_ticket)
                stage_counter[fs_stage] += 1

                if db_ticket.get("claimed_by") or db_ticket.get(
                    "claimed_by_name",
                ):
                    stats.active_claims += 1

                if not self._config.dry_run:
                    self._write_master_ticket(ticket_id, fs_json)
                    self._write_state_copy(
                        ticket_id, fs_stage, fs_json,
                    )

                stats.exported += 1
            except Exception as exc:
                stats.errors += 1
                msg = f"Export failed for {ticket_id}: {exc}"
                errors.append(msg)
                logger.error(
                    "Ticket export failed",
                    extra={
                        "ticket_id": ticket_id,
                        "error": str(exc),
                    },
                )

        stats.stage_distribution = dict(stage_counter)

        result = ExportResult(
            stats=stats,
            dry_run=self._config.dry_run,
            errors=errors,
            warnings=warnings,
        )

        logger.info(
            "Export complete",
            extra={
                "dry_run": self._config.dry_run,
                "total": stats.total_read,
                "exported": stats.exported,
                "errors": stats.errors,
                "active_claims": stats.active_claims,
            },
        )
        return result

    # --- conversion -------------------------------------------------------

    def _to_filesystem_json(
        self, db_ticket: dict[str, Any],
    ) -> dict[str, Any]:
        """Convert a database ticket record to filesystem JSON format.

        Produces the same schema consumed by ``tickets.py``.
        """
        db_stage = db_ticket.get("stage", "READY")
        fs_stage = DB_TO_STAGE_DIR.get(db_stage, db_stage)

        raw_flow: list[str] = db_ticket.get("sdlc_flow", [])
        fs_flow = [DB_TO_STAGE_DIR.get(s, s) for s in raw_flow]

        metadata: dict[str, Any] = db_ticket.get("metadata", {})

        claimed_by = db_ticket.get(
            "claimed_by",
            db_ticket.get("claimed_by_name"),
        )

        result: dict[str, Any] = {
            "ticket_id": db_ticket["ticket_id"],
            "title": db_ticket.get("title", ""),
            "description": db_ticket.get("description"),
            "type": db_ticket.get(
                "ticket_type", db_ticket.get("type", "backend"),
            ),
            "priority": db_ticket.get("priority", "medium"),
            "stage": fs_stage,
            "sdlc_flow": fs_flow,
            "created_at": db_ticket.get("created_at", ""),
            "created_by": metadata.get(
                "created_by",
                db_ticket.get("created_by", ""),
            ),
            "dependencies": db_ticket.get(
                "depends_on",
                db_ticket.get("dependencies", []),
            ),
            "blocked_by": metadata.get(
                "blocked_by",
                db_ticket.get("blocked_by", []),
            ),
            "file_paths": db_ticket.get("file_paths", []),
            "acceptance_criteria": db_ticket.get(
                "acceptance_criteria", [],
            ),
            "rework_count": db_ticket.get("rework_count", 0),
            "claimed_by": claimed_by,
            "machine_id": db_ticket.get("machine_id"),
            "operator": db_ticket.get("operator"),
            "lease_expiry": db_ticket.get("lease_expiry"),
            "lease_duration_minutes": db_ticket.get(
                "lease_duration_minutes", 30,
            ),
            "history": db_ticket.get("history", []),
            "source_task_file": db_ticket.get("source_task_file"),
            "tags": db_ticket.get("tags", []),
        }

        return result

    def _resolve_fs_stage(
        self, db_ticket: dict[str, Any],
    ) -> str:
        """Get the filesystem stage directory name for a DB ticket."""
        db_stage = db_ticket.get("stage", "READY")
        return DB_TO_STAGE_DIR.get(db_stage, db_stage)

    # --- backup -----------------------------------------------------------

    def _backup_existing(self) -> int:
        """Back up existing ticket files and state directories.

        Returns count of files backed up.
        """
        backup_dir = self._config.backup_dir
        if backup_dir is None:
            timestamp = datetime.now(timezone.utc).strftime(
                "%Y%m%dT%H%M%SZ",
            )
            backup_dir = (
                self._config.tickets_dir.parent
                / f"tickets-backup-{timestamp}"
            )

        count = 0

        # Backup master tickets directory
        tickets_dir = self._config.tickets_dir
        if tickets_dir.is_dir():
            dest = backup_dir / "tickets"
            dest.mkdir(parents=True, exist_ok=True)
            for f in sorted(tickets_dir.glob("*.json")):
                shutil.copy2(str(f), str(dest / f.name))
                count += 1

        # Backup ticket-state directories
        state_dir = self._config.ticket_state_dir
        if state_dir.is_dir():
            for subdir in sorted(state_dir.iterdir()):
                if not subdir.is_dir():
                    continue
                for f in sorted(subdir.glob("*.json")):
                    dest_sub = (
                        backup_dir / "ticket-state" / subdir.name
                    )
                    dest_sub.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(str(f), str(dest_sub / f.name))
                    count += 1

        if count > 0:
            logger.info(
                "Backed up existing files",
                extra={
                    "backup_dir": str(backup_dir),
                    "file_count": count,
                },
            )

        return count

    # --- filesystem writing -----------------------------------------------

    def _write_master_ticket(
        self, ticket_id: str, data: dict[str, Any],
    ) -> None:
        """Write the master ticket JSON to .github/tickets/<id>.json."""
        tickets_dir = self._config.tickets_dir
        tickets_dir.mkdir(parents=True, exist_ok=True)
        path = tickets_dir / f"{ticket_id}.json"
        path.write_text(
            json.dumps(data, indent=2, default=str) + "\n",
            encoding="utf-8",
        )

    def _write_state_copy(
        self,
        ticket_id: str,
        stage: str,
        data: dict[str, Any],
    ) -> None:
        """Write a stage copy to .github/ticket-state/<STAGE>/<id>.json."""
        stage_dir = self._config.ticket_state_dir / stage
        stage_dir.mkdir(parents=True, exist_ok=True)
        path = stage_dir / f"{ticket_id}.json"
        path.write_text(
            json.dumps(data, indent=2, default=str) + "\n",
            encoding="utf-8",
        )

    # --- progress ---------------------------------------------------------

    def _report_progress(
        self, current: int, total: int, ticket_id: str,
    ) -> None:
        if self._on_progress is not None:
            self._on_progress(current, total, ticket_id)
        logger.debug(
            "Exporting ticket %d/%d",
            current,
            total,
            extra={"ticket_id": ticket_id},
        )
