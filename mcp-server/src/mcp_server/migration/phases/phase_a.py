"""Migration Phase A — Background Sync.

Agents continue using the filesystem via ``tickets.py`` and
``agent-runner.py`` as-is. The bidirectional sync engine runs in the
background, mirroring every filesystem ticket change to the database.

Key properties of Phase A:

* **Filesystem is source of truth** — all feature flags are set to
  ``filesystem`` mode.
* **Zero agent changes** — no SDK required, no new env vars.
* **Background sync** — the :class:`SyncEngine` runs on a timer,
  importing FS changes into PostgreSQL.
* **Validation gate** — a validation script compares database state
  to filesystem state and reports discrepancies.  Phase A exits only
  when the database matches the filesystem with **zero discrepancies
  for 24+ hours** (configurable).

Usage::

    phase_a = PhaseA(config)
    await phase_a.enter()
    # ... sync runs in background ...
    report = await phase_a.validate()
    if report.can_transition:
        await phase_a.exit()
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import TYPE_CHECKING, Any

from mcp_server.migration.feature_flags import FeatureFlagManager, FlagMode
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from pathlib import Path

    from mcp_server.migration.conflict_resolver import ConflictResolver
    from mcp_server.migration.importer import DatabaseWriter
    from mcp_server.migration.sync_engine import (
        DatabaseReader,
        SyncEngine,
        SyncResult,
    )

logger = get_logger("migration.phase_a")


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


class PhaseAStatus(str, Enum):
    """Lifecycle state of Phase A."""

    INACTIVE = "inactive"
    ACTIVE = "active"
    TRANSITIONING = "transitioning"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PhaseAConfig:
    """Settings for Phase A.

    Attributes:
        tickets_dir: Path to ``.github/tickets/``.
        ticket_state_dir: Path to ``.github/ticket-state/``.
        flags_config_path: Path to the migration-flags YAML file.
        sync_interval_seconds: Delay between sync cycles (default 60).
        transition_gate_hours: Hours of zero discrepancies required
            before the phase can transition (default 24).
    """

    tickets_dir: Path
    ticket_state_dir: Path
    flags_config_path: Path
    sync_interval_seconds: float = 60.0
    transition_gate_hours: float = 24.0


# ---------------------------------------------------------------------------
# Validation report
# ---------------------------------------------------------------------------


@dataclass
class Discrepancy:
    """A single mismatch between filesystem and database state."""

    ticket_id: str
    field: str
    fs_value: Any
    db_value: Any


@dataclass
class ValidationReport:
    """Result of comparing database state against filesystem truth."""

    discrepancies: list[Discrepancy] = field(default_factory=list)
    fs_ticket_count: int = 0
    db_ticket_count: int = 0
    validated_at: str = ""
    can_transition: bool = False
    zero_discrepancy_since: str | None = None
    zero_discrepancy_hours: float = 0.0


# ---------------------------------------------------------------------------
# Phase A
# ---------------------------------------------------------------------------


class PhaseA:
    """Migration Phase A — background sync with filesystem as source of truth.

    Parameters
    ----------
    config:
        Phase A configuration (paths, intervals, gate thresholds).
    db_reader:
        Reads ticket state from the database.
    db_writer:
        Writes imported tickets to the database.
    conflict_resolver:
        Optional resolver for the sync engine.
    """

    def __init__(
        self,
        config: PhaseAConfig,
        db_reader: DatabaseReader,
        db_writer: DatabaseWriter,
        conflict_resolver: ConflictResolver | None = None,
    ) -> None:
        self._config = config
        self._db_reader = db_reader
        self._db_writer = db_writer
        self._conflict_resolver = conflict_resolver
        self._status = PhaseAStatus.INACTIVE
        self._engine: SyncEngine | None = None
        self._entered_at: str | None = None
        self._exited_at: str | None = None
        self._zero_discrepancy_since: str | None = None
        self._sync_results: list[SyncResult] = []

    # -- properties --------------------------------------------------------

    @property
    def status(self) -> PhaseAStatus:
        """Current lifecycle status."""
        return self._status

    @property
    def entered_at(self) -> str | None:
        """ISO-8601 timestamp of phase entry, or ``None``."""
        return self._entered_at

    @property
    def exited_at(self) -> str | None:
        """ISO-8601 timestamp of phase exit, or ``None``."""
        return self._exited_at

    @property
    def sync_results(self) -> list[SyncResult]:
        """Accumulated sync cycle results since phase entry."""
        return list(self._sync_results)

    # -- lifecycle ---------------------------------------------------------

    async def enter(self) -> None:
        """Enter Phase A: verify flags, start the background sync engine.

        Raises:
            RuntimeError: If Phase A is already active.
            ValueError: If feature flags are not all set to ``filesystem``.
        """
        if self._status == PhaseAStatus.ACTIVE:
            raise RuntimeError("Phase A is already active")

        self._verify_flags_filesystem_mode()

        from mcp_server.migration.sync_engine import SyncConfig, SyncEngine

        sync_config = SyncConfig(
            tickets_dir=self._config.tickets_dir,
            ticket_state_dir=self._config.ticket_state_dir,
            interval_seconds=self._config.sync_interval_seconds,
        )

        self._engine = SyncEngine(
            config=sync_config,
            db_reader=self._db_reader,
            db_writer=self._db_writer,
            conflict_resolver=self._conflict_resolver,
        )

        await self._engine.start()
        self._entered_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseAStatus.ACTIVE
        self._sync_results.clear()

        logger.info(
            "Phase A entered — background sync started",
            extra={
                "entered_at": self._entered_at,
                "sync_interval": self._config.sync_interval_seconds,
            },
        )

    async def exit(self) -> ValidationReport:
        """Exit Phase A: validate, stop sync engine, log results.

        Returns:
            Final :class:`ValidationReport`.

        Raises:
            RuntimeError: If Phase A is not active.
        """
        if self._status != PhaseAStatus.ACTIVE:
            raise RuntimeError("Phase A is not active — cannot exit")

        self._status = PhaseAStatus.TRANSITIONING
        report = await self.validate()

        if self._engine is not None:
            await self._engine.stop()
            self._engine = None

        self._exited_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseAStatus.INACTIVE

        logger.info(
            "Phase A exited",
            extra={
                "exited_at": self._exited_at,
                "discrepancies": len(report.discrepancies),
                "can_transition": report.can_transition,
            },
        )
        return report

    # -- sync --------------------------------------------------------------

    async def run_sync_cycle(self) -> SyncResult:
        """Manually trigger a single sync cycle.

        Raises:
            RuntimeError: If Phase A is not active.
        """
        if self._engine is None:
            raise RuntimeError("Sync engine not initialised — call enter() first")

        result = await self._engine.sync_once()
        self._sync_results.append(result)
        return result

    # -- validation --------------------------------------------------------

    async def validate(self) -> ValidationReport:
        """Compare database state to filesystem state.

        Scans every ticket JSON in ``tickets_dir`` and compares its
        ``stage`` and claim metadata against the database.  Returns a
        :class:`ValidationReport` with any discrepancies found.
        """
        fs_tickets = self._read_fs_tickets()
        db_tickets_list = await self._db_reader.list_tickets()
        db_tickets = {t["ticket_id"]: t for t in db_tickets_list}

        discrepancies: list[Discrepancy] = []

        # Check all FS tickets exist in DB with matching state
        for ticket_id, fs_data in fs_tickets.items():
            if ticket_id not in db_tickets:
                discrepancies.append(
                    Discrepancy(
                        ticket_id=ticket_id,
                        field="existence",
                        fs_value="present",
                        db_value="missing",
                    )
                )
                continue

            db_data = db_tickets[ticket_id]

            # Compare stage
            fs_stage = fs_data.get("stage", "")
            db_stage = db_data.get("stage", "")
            if fs_stage and db_stage and fs_stage != db_stage:
                discrepancies.append(
                    Discrepancy(
                        ticket_id=ticket_id,
                        field="stage",
                        fs_value=fs_stage,
                        db_value=db_stage,
                    )
                )

            # Compare claim metadata
            for claim_field in ("claimed_by", "machine_id", "operator"):
                fs_val = fs_data.get(claim_field)
                db_val = db_data.get(claim_field)
                if fs_val != db_val:
                    discrepancies.append(
                        Discrepancy(
                            ticket_id=ticket_id,
                            field=claim_field,
                            fs_value=fs_val,
                            db_value=db_val,
                        )
                    )

        # Check for DB tickets missing from FS
        for ticket_id in db_tickets:
            if ticket_id not in fs_tickets:
                discrepancies.append(
                    Discrepancy(
                        ticket_id=ticket_id,
                        field="existence",
                        fs_value="missing",
                        db_value="present",
                    )
                )

        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        # Track zero-discrepancy window
        if len(discrepancies) == 0:
            if self._zero_discrepancy_since is None:
                self._zero_discrepancy_since = now_iso
            zero_since = datetime.fromisoformat(self._zero_discrepancy_since)
            hours = (now - zero_since).total_seconds() / 3600.0
        else:
            self._zero_discrepancy_since = None
            hours = 0.0

        can_transition = (
            len(discrepancies) == 0
            and hours >= self._config.transition_gate_hours
        )

        report = ValidationReport(
            discrepancies=discrepancies,
            fs_ticket_count=len(fs_tickets),
            db_ticket_count=len(db_tickets),
            validated_at=now_iso,
            can_transition=can_transition,
            zero_discrepancy_since=self._zero_discrepancy_since,
            zero_discrepancy_hours=hours,
        )

        logger.info(
            "Phase A validation complete",
            extra={
                "discrepancies": len(discrepancies),
                "fs_tickets": report.fs_ticket_count,
                "db_tickets": report.db_ticket_count,
                "can_transition": can_transition,
                "zero_discrepancy_hours": round(hours, 2),
            },
        )
        return report

    # -- internal helpers --------------------------------------------------

    def _verify_flags_filesystem_mode(self) -> None:
        """Ensure all feature flags are set to ``filesystem`` mode.

        Raises:
            ValueError: If any operation flag is not ``filesystem``.
        """
        from mcp_server.migration.feature_flags import VALID_OPERATIONS

        manager = FeatureFlagManager(self._config.flags_config_path)
        manager.load()

        non_fs: list[str] = []
        for operation in sorted(VALID_OPERATIONS):
            mode = manager.get_mode(operation)
            if mode != FlagMode.FILESYSTEM:
                non_fs.append(f"{operation}={mode.value}")

        if non_fs:
            msg = (
                "Phase A requires all feature flags in 'filesystem' mode. "
                f"Non-filesystem flags: {', '.join(non_fs)}"
            )
            raise ValueError(msg)

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
