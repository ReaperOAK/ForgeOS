"""Bidirectional sync engine — keeps filesystem and database in sync.

Runs periodic sync cycles at a configurable interval (default 60 s).
Each cycle performs:

1. **FS → DB**: Scans ``.github/tickets/`` for new or modified tickets
   and imports them using the existing :class:`TicketImporter`.
2. **DB → FS**: Reads current ticket state from the database and writes
   back stage moves (``ticket-state/`` directory placement) and claim /
   lease metadata updates to the ticket JSON files.

Conflict resolution uses a **database-wins** strategy via
:class:`ConflictResolver`.

The engine can be started and stopped independently of the MCP server.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import shutil
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from pathlib import Path

from mcp_server.migration.conflict_resolver import ConflictRecord, ConflictResolver
from mcp_server.migration.importer import (
    DatabaseWriter,
    ImportConfig,
    ImportResult,
    TicketImporter,
)
from mcp_server.migration.transformers import DB_TO_STAGE_DIR
from mcp_server.observability import get_logger

logger = get_logger("migration.sync_engine")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SyncConfig:
    """Settings for the bidirectional sync engine."""

    tickets_dir: Path
    ticket_state_dir: Path
    interval_seconds: float = 60.0


# ---------------------------------------------------------------------------
# Database reader protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class DatabaseReader(Protocol):
    """Async interface for reading ticket state from the database."""

    async def list_tickets(self) -> list[dict[str, Any]]:
        """Return all tickets as dicts with at least:

        ``ticket_id``, ``stage``, ``claimed_by``, ``machine_id``,
        ``operator``, ``lease_expiry``, ``lease_duration_minutes``,
        ``rework_count``.

        Stage values must use **DB-enum** names (e.g. ``"BACKEND"``).
        """
        ...


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class SyncStats:
    """Counters for a single sync cycle."""

    fs_to_db_imported: int = 0
    fs_to_db_updated: int = 0
    fs_to_db_errors: int = 0
    db_to_fs_stage_moves: int = 0
    db_to_fs_claim_updates: int = 0
    db_to_fs_errors: int = 0


@dataclass(frozen=True)
class SyncResult:
    """Outcome of a single sync cycle."""

    stats: SyncStats
    conflicts: list[ConflictRecord]
    errors: list[str]
    started_at: str
    finished_at: str


# ---------------------------------------------------------------------------
# Sync engine
# ---------------------------------------------------------------------------


class SyncEngine:
    """Bidirectional sync between filesystem tickets and PostgreSQL.

    Parameters
    ----------
    config:
        Paths and interval configuration.
    db_reader:
        Reads current ticket state from the database.
    db_writer:
        Writes imported tickets to the database (same protocol as
        :class:`TicketImporter`).
    conflict_resolver:
        Optional resolver (defaults to a fresh :class:`ConflictResolver`).
    """

    def __init__(
        self,
        config: SyncConfig,
        db_reader: DatabaseReader,
        db_writer: DatabaseWriter,
        conflict_resolver: ConflictResolver | None = None,
    ) -> None:
        self._config = config
        self._db_reader = db_reader
        self._db_writer = db_writer
        self._resolver = conflict_resolver or ConflictResolver()
        self._task: asyncio.Task[None] | None = None
        self._stop_event = asyncio.Event()

    # -- lifecycle ---------------------------------------------------------

    @property
    def is_running(self) -> bool:
        """``True`` when the periodic sync loop is active."""
        return self._task is not None and not self._task.done()

    async def start(self) -> None:
        """Start the periodic sync loop in a background task."""
        if self.is_running:
            logger.warning("Sync engine already running")
            return

        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop())
        logger.info(
            "Sync engine started",
            extra={"interval_seconds": self._config.interval_seconds},
        )

    async def stop(self) -> None:
        """Signal the sync loop to stop and wait for a clean shutdown."""
        if not self.is_running:
            return

        self._stop_event.set()
        assert self._task is not None
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        logger.info("Sync engine stopped")

    # -- single cycle ------------------------------------------------------

    async def sync_once(self) -> SyncResult:
        """Execute one full bidirectional sync cycle."""
        started = datetime.now(timezone.utc).isoformat()
        self._resolver.clear()
        stats = SyncStats()
        errors: list[str] = []

        # 1. FS → DB
        try:
            import_result = await self._sync_fs_to_db()
            stats.fs_to_db_imported = import_result.stats.imported
            stats.fs_to_db_updated = import_result.stats.updated
            stats.fs_to_db_errors = import_result.stats.errors
            errors.extend(import_result.errors)
        except Exception as exc:
            stats.fs_to_db_errors += 1
            msg = f"FS→DB sync failed: {exc}"
            errors.append(msg)
            logger.error("FS→DB sync failed", extra={"error": str(exc)})

        # 2. DB → FS
        try:
            stage_moves, claim_updates, db_fs_errors = await self._sync_db_to_fs()
            stats.db_to_fs_stage_moves = stage_moves
            stats.db_to_fs_claim_updates = claim_updates
            stats.db_to_fs_errors = db_fs_errors
        except Exception as exc:
            stats.db_to_fs_errors += 1
            msg = f"DB→FS sync failed: {exc}"
            errors.append(msg)
            logger.error("DB→FS sync failed", extra={"error": str(exc)})

        finished = datetime.now(timezone.utc).isoformat()

        result = SyncResult(
            stats=stats,
            conflicts=self._resolver.conflicts,
            errors=errors,
            started_at=started,
            finished_at=finished,
        )

        logger.info(
            "Sync cycle complete",
            extra={
                "fs_to_db_imported": stats.fs_to_db_imported,
                "fs_to_db_updated": stats.fs_to_db_updated,
                "db_to_fs_stage_moves": stats.db_to_fs_stage_moves,
                "db_to_fs_claim_updates": stats.db_to_fs_claim_updates,
                "errors": len(errors),
                "conflicts": len(result.conflicts),
            },
        )
        return result

    # -- periodic loop -----------------------------------------------------

    async def _run_loop(self) -> None:
        """Internal loop: sync every *interval_seconds* until stopped."""
        while not self._stop_event.is_set():
            try:
                await self.sync_once()
            except Exception as exc:
                logger.error(
                    "Unhandled error in sync loop",
                    extra={"error": str(exc)},
                )

            # Wait for interval or stop signal
            try:
                await asyncio.wait_for(
                    self._stop_event.wait(),
                    timeout=self._config.interval_seconds,
                )
                break  # stop_event was set
            except asyncio.TimeoutError:
                continue  # interval elapsed, run next cycle

    # -- FS → DB -----------------------------------------------------------

    async def _sync_fs_to_db(self) -> ImportResult:
        """Import new/modified tickets from filesystem into the database."""
        import_config = ImportConfig(
            tickets_dir=self._config.tickets_dir,
            ticket_state_dir=self._config.ticket_state_dir,
            dry_run=False,
        )
        importer = TicketImporter(
            config=import_config,
            writer=self._db_writer,
        )
        return await importer.run()

    # -- DB → FS -----------------------------------------------------------

    async def _sync_db_to_fs(self) -> tuple[int, int, int]:
        """Sync database state back to the filesystem.

        Returns (stage_moves, claim_updates, error_count).
        """
        db_tickets = await self._db_reader.list_tickets()
        fs_tickets = self._read_fs_tickets()

        stage_moves = 0
        claim_updates = 0
        error_count = 0

        for db_ticket in db_tickets:
            ticket_id: str = db_ticket["ticket_id"]
            db_stage_raw: str = db_ticket.get("stage", "READY")

            # Map DB stage enum to filesystem directory name
            fs_dir_name = DB_TO_STAGE_DIR.get(db_stage_raw, db_stage_raw)

            try:
                if ticket_id in fs_tickets:
                    fs_data = fs_tickets[ticket_id]
                    # Check stage mismatch
                    current_fs_stage = self._find_current_fs_stage(ticket_id)
                    if current_fs_stage and current_fs_stage != fs_dir_name:
                        self._resolver.resolve_stage(
                            ticket_id, current_fs_stage, fs_dir_name,
                        )
                        self._move_ticket_to_stage(ticket_id, current_fs_stage, fs_dir_name)
                        stage_moves += 1

                    # Check claim/lease mismatch
                    if self._has_claim_mismatch(fs_data, db_ticket):
                        fs_claim = self._extract_claim(fs_data)
                        db_claim = self._extract_claim(db_ticket)
                        self._resolver.resolve_claim(ticket_id, fs_claim, db_claim)
                        self._update_ticket_claim(ticket_id, db_claim)
                        claim_updates += 1
                else:
                    # Ticket exists in DB but not on FS — skip (don't create
                    # FS files for DB-only tickets unless explicitly required)
                    self._resolver.record_new_in_db(ticket_id)

            except Exception as exc:
                error_count += 1
                logger.error(
                    "DB→FS sync error",
                    extra={"ticket_id": ticket_id, "error": str(exc)},
                )

        return stage_moves, claim_updates, error_count

    # -- filesystem helpers ------------------------------------------------

    def _read_fs_tickets(self) -> dict[str, dict[str, Any]]:
        """Read all ticket JSON files from the tickets directory."""
        tickets: dict[str, dict[str, Any]] = {}
        tickets_dir = self._config.tickets_dir
        if not tickets_dir.is_dir():
            return tickets

        for path in tickets_dir.glob("*.json"):
            try:
                raw = json.loads(path.read_text(encoding="utf-8"))
                if isinstance(raw, dict):
                    tid = raw.get("ticket_id", path.stem)
                    tickets[tid] = raw
            except (json.JSONDecodeError, OSError) as exc:
                logger.warning(
                    "Failed to read ticket file",
                    extra={"path": str(path), "error": str(exc)},
                )
        return tickets

    def _find_current_fs_stage(self, ticket_id: str) -> str | None:
        """Find which ``ticket-state/`` subdirectory contains this ticket."""
        state_dir = self._config.ticket_state_dir
        if not state_dir.is_dir():
            return None

        for subdir in state_dir.iterdir():
            if not subdir.is_dir():
                continue
            ticket_file = subdir / f"{ticket_id}.json"
            if ticket_file.exists():
                return subdir.name
        return None

    def _move_ticket_to_stage(
        self,
        ticket_id: str,
        from_stage: str,
        to_stage: str,
    ) -> None:
        """Move a ticket's JSON from one stage directory to another."""
        state_dir = self._config.ticket_state_dir
        src = state_dir / from_stage / f"{ticket_id}.json"
        dest_dir = state_dir / to_stage
        dest_dir.mkdir(parents=True, exist_ok=True)
        dest = dest_dir / f"{ticket_id}.json"

        if src.exists():
            shutil.move(str(src), str(dest))
            logger.info(
                "Moved ticket to new stage directory",
                extra={
                    "ticket_id": ticket_id,
                    "from_stage": from_stage,
                    "to_stage": to_stage,
                },
            )
        else:
            logger.warning(
                "Source ticket file not found for stage move",
                extra={
                    "ticket_id": ticket_id,
                    "expected_path": str(src),
                },
            )

    @staticmethod
    def _extract_claim(data: dict[str, Any]) -> dict[str, Any]:
        """Extract claim-related fields from a ticket dict."""
        return {
            "claimed_by": data.get("claimed_by"),
            "machine_id": data.get("machine_id"),
            "operator": data.get("operator"),
            "lease_expiry": data.get("lease_expiry"),
            "lease_duration_minutes": data.get("lease_duration_minutes", 30),
        }

    @staticmethod
    def _has_claim_mismatch(
        fs_data: dict[str, Any],
        db_data: dict[str, Any],
    ) -> bool:
        """Return ``True`` if claim/lease fields differ between FS and DB."""
        fields = ("claimed_by", "machine_id", "operator", "lease_expiry")
        for f in fields:
            fs_val = fs_data.get(f)
            db_val = db_data.get(f)
            # Normalise None vs missing
            if fs_val != db_val:
                return True
        return False

    def _update_ticket_claim(
        self,
        ticket_id: str,
        db_claim: dict[str, Any],
    ) -> None:
        """Overwrite claim/lease fields in the ticket JSON on disk."""
        ticket_path = self._config.tickets_dir / f"{ticket_id}.json"
        if not ticket_path.exists():
            logger.warning(
                "Ticket file not found for claim update",
                extra={"ticket_id": ticket_id},
            )
            return

        try:
            raw = json.loads(ticket_path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError) as exc:
            logger.error(
                "Failed to read ticket for claim update",
                extra={"ticket_id": ticket_id, "error": str(exc)},
            )
            return

        raw.update(db_claim)
        ticket_path.write_text(
            json.dumps(raw, indent=2, default=str) + "\n",
            encoding="utf-8",
        )

        logger.info(
            "Updated ticket claim metadata on filesystem",
            extra={
                "ticket_id": ticket_id,
                "claimed_by": db_claim.get("claimed_by"),
            },
        )
