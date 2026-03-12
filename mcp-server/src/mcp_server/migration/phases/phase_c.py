"""Migration Phase C — Full MCP.

Agents use the ForgeOS SDK exclusively for all ticket operations.
Feature flags are set to ``database`` mode for every operation.
The filesystem becomes read-only — a periodic database-to-filesystem
export maintains backup copies, but no agent writes to the filesystem
for ticket state.  WORK commits (code changes via git) remain unchanged.

Key properties of Phase C:

* **Database is source of truth** — all feature flags are set to
  ``database`` mode.
* **No filesystem fallback** — SDK errors propagate directly to
  agents; there is no silent retry via ``tickets.py``.
* **Periodic export** — the :class:`TicketExporter` runs on a timer,
  writing database state back to filesystem JSON files as backup.
* **Read-only filesystem** — agent ticket writes go through MCP only.
* **WORK commits unchanged** — code-level git commits are unaffected.
* **Transition gate** — Phase C exits only when **zero filesystem
  writes** are detected for **72+ hours** (configurable).

Usage::

    phase_c = PhaseC(config, sdk_adapter, exporter, write_detector)
    await phase_c.enter()
    result = await phase_c.execute_operation("claim", ticket_id)
    await phase_c.run_export()
    report = await phase_c.validate()
    if report.can_transition:
        await phase_c.exit()
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol, runtime_checkable

from mcp_server.migration.feature_flags import FeatureFlagManager, FlagMode
from mcp_server.observability import get_logger

logger = get_logger("migration.phase_c")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEFAULT_GATE_HOURS = 72.0
_DEFAULT_EXPORT_INTERVAL = 300.0
_MAX_OP_LOG_SIZE = 10_000


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


class PhaseCStatus(str, Enum):
    """Lifecycle state of Phase C."""

    INACTIVE = "inactive"
    ACTIVE = "active"
    TRANSITIONING = "transitioning"


# ---------------------------------------------------------------------------
# Operation result tracking
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class OperationRecord:
    """Record of a single ticket operation in Phase C.

    Attributes:
        operation: The operation name (e.g. ``"claim"``, ``"advance"``).
        ticket_id: The ticket the operation targeted.
        success: Whether the operation succeeded.
        timestamp: ISO-8601 timestamp of the operation.
        error: Error message if the operation failed.
    """

    operation: str
    ticket_id: str
    success: bool
    timestamp: str
    error: str = ""


@dataclass(frozen=True)
class ExportRecord:
    """Record of a single DB-to-FS export cycle.

    Attributes:
        success: Whether the export succeeded.
        timestamp: ISO-8601 timestamp of the export.
        details: Export result details.
        error: Error message if the export failed.
    """

    success: bool
    timestamp: str
    details: dict[str, Any]
    error: str = ""


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PhaseCConfig:
    """Settings for Phase C.

    Attributes:
        flags_config_path: Path to the migration-flags YAML file.
        transition_gate_hours: Hours of zero filesystem writes required
            to exit Phase C (default 72.0).
        export_interval_seconds: Interval between periodic exports
            (default 300.0).
        max_operation_log_size: Maximum number of operation records to
            retain in memory (default 10 000).
    """

    flags_config_path: Any  # Path type
    transition_gate_hours: float = _DEFAULT_GATE_HOURS
    export_interval_seconds: float = _DEFAULT_EXPORT_INTERVAL
    max_operation_log_size: int = _MAX_OP_LOG_SIZE


# ---------------------------------------------------------------------------
# Transition report
# ---------------------------------------------------------------------------


@dataclass
class TransitionReport:
    """Result of evaluating the Phase C transition gate.

    Attributes:
        total_operations: Total number of operations executed.
        successes: Operations that succeeded.
        failures: Operations that failed.
        error_rate: Percentage of failed operations.
        filesystem_writes: Number of filesystem writes detected.
        can_transition: Whether the gate criteria are met.
        zero_writes_since: ISO-8601 timestamp when zero-writes window
            started, or ``None``.
        zero_writes_hours: Hours elapsed since filesystem writes last
            dropped to zero.
        total_exports: Number of export cycles executed.
        validated_at: ISO-8601 timestamp of this report.
    """

    total_operations: int = 0
    successes: int = 0
    failures: int = 0
    error_rate: float = 0.0
    filesystem_writes: int = 0
    can_transition: bool = False
    zero_writes_since: str | None = None
    zero_writes_hours: float = 0.0
    total_exports: int = 0
    validated_at: str = ""


# ---------------------------------------------------------------------------
# SDK adapter protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class SDKOperationAdapter(Protocol):
    """Adapter for all MCP SDK ticket operations.

    In Phase C, all operations go through the SDK — no fallback.
    """

    async def execute(
        self,
        operation: str,
        ticket_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute *operation* on *ticket_id* via the MCP SDK.

        Returns:
            Dict with at least ``"ticket_id"`` on success.

        Raises:
            Exception: On any MCP communication or tool-call failure.
        """
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Export adapter protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ExportAdapter(Protocol):
    """Adapter for running the DB-to-FS export."""

    async def export(self) -> dict[str, Any]:
        """Run a full export cycle.

        Returns:
            Dict with export statistics (``exported``, ``errors``).
        """
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Filesystem write detector protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class FilesystemWriteDetector(Protocol):
    """Detects filesystem writes to ticket state files."""

    async def detect_writes_since(self, since_iso: str) -> list[dict[str, Any]]:
        """Return a list of write events since the given timestamp.

        Each write event is a dict with at least ``"path"`` and
        ``"timestamp"`` keys.  An empty list means no writes detected.
        """
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Phase C
# ---------------------------------------------------------------------------


class PhaseC:
    """Migration Phase C — full MCP, no filesystem fallback.

    Parameters
    ----------
    config:
        Phase C configuration.
    sdk_adapter:
        Adapter for all MCP SDK ticket operations.
    exporter:
        Adapter for running the DB-to-FS export.
    write_detector:
        Adapter for detecting filesystem writes.
    """

    def __init__(
        self,
        config: PhaseCConfig,
        sdk_adapter: SDKOperationAdapter,
        exporter: ExportAdapter,
        write_detector: FilesystemWriteDetector,
    ) -> None:
        self._config = config
        self._sdk_adapter = sdk_adapter
        self._exporter = exporter
        self._write_detector = write_detector
        self._status = PhaseCStatus.INACTIVE
        self._entered_at: str | None = None
        self._exited_at: str | None = None
        self._zero_writes_since: str | None = None
        self._operations: deque[OperationRecord] = deque(
            maxlen=config.max_operation_log_size,
        )
        self._exports: list[ExportRecord] = []

    # -- properties --------------------------------------------------------

    @property
    def status(self) -> PhaseCStatus:
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
    def export_history(self) -> list[ExportRecord]:
        """Snapshot of the export history."""
        return list(self._exports)

    @property
    def intercepts_work_commits(self) -> bool:
        """Phase C does not intercept git WORK commits."""
        return False

    # -- lifecycle ---------------------------------------------------------

    async def enter(self) -> None:
        """Enter Phase C: verify all flags are ``database``, log entry.

        Raises:
            RuntimeError: If Phase C is already active.
            ValueError: If any flag is not set to ``database``.
        """
        if self._status == PhaseCStatus.ACTIVE:
            raise RuntimeError("Phase C is already active")

        self._verify_all_flags_database()

        self._entered_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseCStatus.ACTIVE
        self._operations.clear()
        self._exports.clear()
        self._zero_writes_since = None

        stats = self._operation_stats()
        logger.info(
            "Phase C entered — full MCP mode, no filesystem fallback",
            extra={
                "entered_at": self._entered_at,
                "error_rate": stats["error_rate"],
                "total_operations": stats["total"],
                "gate_hours": self._config.transition_gate_hours,
                "export_interval": self._config.export_interval_seconds,
            },
        )

    async def exit(self) -> TransitionReport:
        """Exit Phase C: build report, log exit.

        Returns:
            Final :class:`TransitionReport`.

        Raises:
            RuntimeError: If Phase C is not active.
        """
        if self._status != PhaseCStatus.ACTIVE:
            raise RuntimeError("Phase C is not active — cannot exit")

        self._status = PhaseCStatus.TRANSITIONING
        report = await self.validate()

        self._exited_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseCStatus.INACTIVE

        stats = self._operation_stats()
        logger.info(
            "Phase C exited",
            extra={
                "exited_at": self._exited_at,
                "error_rate": stats["error_rate"],
                "total_operations": stats["total"],
                "total_exports": len(self._exports),
                "can_transition": report.can_transition,
            },
        )
        return report

    # -- SDK operations (no fallback) --------------------------------------

    async def execute_operation(
        self,
        operation: str,
        ticket_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Execute a ticket operation via the MCP SDK.

        No filesystem fallback — errors propagate directly.

        Parameters
        ----------
        operation:
            Operation name (e.g. ``"claim"``, ``"advance"``).
        ticket_id:
            Ticket to operate on.
        **kwargs:
            Additional arguments for the SDK adapter.

        Returns
        -------
        dict
            The operation result dict.

        Raises
        ------
        RuntimeError
            If Phase C is not active.
        Exception
            Any error from the SDK adapter (propagated directly).
        """
        if self._status != PhaseCStatus.ACTIVE:
            raise RuntimeError("Phase C is not active — call enter() first")

        now_iso = datetime.now(timezone.utc).isoformat()

        try:
            result = await self._sdk_adapter.execute(operation, ticket_id, **kwargs)
            self._record_operation(
                operation=operation,
                ticket_id=ticket_id,
                success=True,
                timestamp=now_iso,
            )
            logger.info(
                "Operation succeeded via MCP",
                extra={
                    "operation": operation,
                    "ticket_id": ticket_id,
                },
            )
            return result
        except Exception as exc:
            self._record_operation(
                operation=operation,
                ticket_id=ticket_id,
                success=False,
                timestamp=now_iso,
                error=str(exc),
            )
            logger.error(
                "Operation failed via MCP — no fallback",
                extra={
                    "operation": operation,
                    "ticket_id": ticket_id,
                    "error": str(exc),
                },
            )
            raise

    # -- periodic export ---------------------------------------------------

    async def run_export(self) -> ExportRecord:
        """Run a single DB-to-FS export cycle.

        Returns:
            :class:`ExportRecord` with outcome details.
        """
        now_iso = datetime.now(timezone.utc).isoformat()
        try:
            details = await self._exporter.export()
            record = ExportRecord(
                success=True,
                timestamp=now_iso,
                details=details,
            )
            logger.info(
                "DB-to-FS export completed",
                extra={"timestamp": now_iso, "details": details},
            )
        except Exception as exc:
            record = ExportRecord(
                success=False,
                timestamp=now_iso,
                details={},
                error=str(exc),
            )
            logger.error(
                "DB-to-FS export failed",
                extra={"timestamp": now_iso, "error": str(exc)},
            )
        self._exports.append(record)
        return record

    # -- validation / transition gate --------------------------------------

    async def validate(self) -> TransitionReport:
        """Evaluate whether the Phase C transition gate is met.

        The gate requires zero filesystem writes for
        ``transition_gate_hours`` consecutive hours.

        Returns:
            :class:`TransitionReport` with current metrics.
        """
        stats = self._operation_stats()
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        # Detect filesystem writes since phase entry
        since = self._entered_at or now_iso
        writes = await self._write_detector.detect_writes_since(since)
        write_count = len(writes)

        # Track zero-writes window
        if write_count == 0:
            if self._zero_writes_since is None:
                self._zero_writes_since = now_iso
            since_dt = datetime.fromisoformat(self._zero_writes_since)
            hours = (now - since_dt).total_seconds() / 3600.0
        else:
            self._zero_writes_since = None
            hours = 0.0

        can_transition = (
            write_count == 0
            and hours >= self._config.transition_gate_hours
        )

        report = TransitionReport(
            total_operations=stats["total"],
            successes=stats["successes"],
            failures=stats["failures"],
            error_rate=stats["error_rate"],
            filesystem_writes=write_count,
            can_transition=can_transition,
            zero_writes_since=self._zero_writes_since,
            zero_writes_hours=round(hours, 2),
            total_exports=len(self._exports),
            validated_at=now_iso,
        )

        logger.info(
            "Phase C validation complete",
            extra={
                "total_ops": stats["total"],
                "error_rate": stats["error_rate"],
                "fs_writes": write_count,
                "can_transition": can_transition,
                "zero_writes_hours": round(hours, 2),
            },
        )
        return report

    # -- metrics helpers ---------------------------------------------------

    def get_operation_stats(self) -> dict[str, Any]:
        """Return a summary dict of operation statistics."""
        return self._operation_stats()

    def _operation_stats(self) -> dict[str, Any]:
        """Compute operation success/failure statistics."""
        total = len(self._operations)
        successes = sum(1 for r in self._operations if r.success)
        failures = total - successes
        error_rate = round((failures / total * 100.0) if total else 0.0, 2)
        return {
            "total": total,
            "successes": successes,
            "failures": failures,
            "error_rate": error_rate,
        }

    # -- internal helpers --------------------------------------------------

    def _record_operation(
        self,
        *,
        operation: str,
        ticket_id: str,
        success: bool,
        timestamp: str,
        error: str = "",
    ) -> None:
        """Append an operation record to the rolling log."""
        record = OperationRecord(
            operation=operation,
            ticket_id=ticket_id,
            success=success,
            timestamp=timestamp,
            error=error,
        )
        self._operations.append(record)

    def _verify_all_flags_database(self) -> None:
        """Ensure all feature flags are set to ``database`` mode.

        Raises:
            ValueError: If any operation flag is not ``database``.
        """
        from mcp_server.migration.feature_flags import VALID_OPERATIONS

        manager = FeatureFlagManager(self._config.flags_config_path)
        manager.load()

        non_db: list[str] = []
        for operation in sorted(VALID_OPERATIONS):
            mode = manager.get_mode(operation)
            if mode != FlagMode.DATABASE:
                non_db.append(f"{operation}={mode.value}")

        if non_db:
            msg = (
                "Phase C requires all feature flags in 'database' mode. "
                f"Non-database flags: {', '.join(non_db)}"
            )
            raise ValueError(msg)
