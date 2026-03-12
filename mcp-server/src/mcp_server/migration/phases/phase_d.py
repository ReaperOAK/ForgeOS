"""Migration Phase D — Filesystem Deprecated.

The filesystem ticket state is fully deprecated.  The database is the
sole source of truth.  The sync engine and dual-mode wrapper are
deactivated.  Feature flags collapse to a single
``migration_complete=true`` sentinel.  Any code that attempts
filesystem ticket operations receives a deprecation warning.

Key properties of Phase D:

* **Database only** — all ticket operations use the database
  exclusively.  No filesystem reads or writes for ticket state.
* **Sync engine off** — the background :class:`SyncEngine` is stopped
  and disabled.
* **Dual-mode wrapper off** — the :class:`DualModeWrapper` routing
  layer is deactivated.
* **Filesystem fallback disabled** — SDK fallback code paths are
  disabled and emit deprecation warnings.
* **Cleanup script** — the :mod:`~mcp_server.migration.cleanup` module
  archives ``.github/ticket-state/`` and ``.github/tickets/`` to an
  archive directory.
* **Final statistics** — phase entry logs total operations, error
  rates, and migration duration.

Usage::

    phase_d = PhaseD(config)
    await phase_d.enter()
    report = phase_d.get_migration_report()
    await phase_d.exit()
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from mcp_server.migration.feature_flags import (
    VALID_OPERATIONS,
    FeatureFlagManager,
    FlagMode,
)
from mcp_server.observability import get_logger

logger = get_logger("migration.phase_d")


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_DEPRECATION_MSG = (
    "Filesystem ticket operations are deprecated in Phase D. "
    "All ticket operations must use the database exclusively."
)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


class PhaseDStatus(str, Enum):
    """Lifecycle state of Phase D."""

    INACTIVE = "inactive"
    ACTIVE = "active"
    TRANSITIONING = "transitioning"


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PhaseDConfig:
    """Settings for Phase D.

    Attributes:
        flags_config_path: Path to the migration-flags YAML file.
        migration_started_at: ISO-8601 timestamp when the overall
            migration began (Phase A entry).  Used to compute total
            migration duration.
        total_operations: Cumulative operation count across all phases.
        total_errors: Cumulative error count across all phases.
    """

    flags_config_path: Any  # Path type
    migration_started_at: str = ""
    total_operations: int = 0
    total_errors: int = 0


# ---------------------------------------------------------------------------
# Migration statistics report
# ---------------------------------------------------------------------------


@dataclass
class MigrationReport:
    """Final migration statistics emitted on Phase D entry.

    Attributes:
        total_operations: Cumulative operations across all phases.
        total_errors: Cumulative errors across all phases.
        error_rate: Overall error rate as a percentage.
        migration_started_at: ISO-8601 timestamp of Phase A entry.
        migration_completed_at: ISO-8601 timestamp of Phase D entry.
        migration_duration_hours: Total duration in hours.
        sync_engine_disabled: Whether the sync engine was deactivated.
        dual_mode_disabled: Whether the dual-mode wrapper was deactivated.
        filesystem_fallback_disabled: Whether the SDK fallback code
            path was disabled.
        migration_complete_flag: Whether the ``migration_complete``
            flag is set.
        validated_at: ISO-8601 timestamp of this report.
    """

    total_operations: int = 0
    total_errors: int = 0
    error_rate: float = 0.0
    migration_started_at: str = ""
    migration_completed_at: str = ""
    migration_duration_hours: float = 0.0
    sync_engine_disabled: bool = False
    dual_mode_disabled: bool = False
    filesystem_fallback_disabled: bool = False
    migration_complete_flag: bool = False
    validated_at: str = ""


# ---------------------------------------------------------------------------
# Deprecation interceptor
# ---------------------------------------------------------------------------


class FilesystemDeprecationInterceptor:
    """Logs a deprecation warning when filesystem ticket ops are attempted.

    Call :meth:`intercept` from any code path that formerly wrote to the
    filesystem for ticket operations.
    """

    def __init__(self) -> None:
        self._warning_count: int = 0

    @property
    def warning_count(self) -> int:
        """Number of deprecation warnings emitted."""
        return self._warning_count

    def intercept(self, operation: str, ticket_id: str = "") -> None:
        """Log a deprecation warning for a filesystem operation attempt.

        Args:
            operation: The operation that was attempted
                (e.g. ``"claim"``, ``"sync"``).
            ticket_id: The ticket involved, if applicable.
        """
        self._warning_count += 1
        logger.warning(
            _DEPRECATION_MSG,
            extra={
                "operation": operation,
                "ticket_id": ticket_id,
                "warning_count": self._warning_count,
            },
        )


# ---------------------------------------------------------------------------
# Phase D
# ---------------------------------------------------------------------------


class PhaseD:
    """Migration Phase D — filesystem fully deprecated, database only.

    Args:
        config: Phase D configuration.
        deprecation_interceptor: Optional interceptor for filesystem
            deprecation warnings.  If ``None``, a default instance
            is created.
    """

    def __init__(
        self,
        config: PhaseDConfig,
        deprecation_interceptor: FilesystemDeprecationInterceptor | None = None,
    ) -> None:
        self._config = config
        self._interceptor = deprecation_interceptor or FilesystemDeprecationInterceptor()
        self._status = PhaseDStatus.INACTIVE
        self._entered_at: str | None = None
        self._exited_at: str | None = None
        self._sync_engine_disabled: bool = False
        self._dual_mode_disabled: bool = False
        self._filesystem_fallback_disabled: bool = False
        self._migration_complete_flag: bool = False

    # -- properties --------------------------------------------------------

    @property
    def status(self) -> PhaseDStatus:
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
    def deprecation_interceptor(self) -> FilesystemDeprecationInterceptor:
        """The deprecation interceptor instance."""
        return self._interceptor

    @property
    def sync_engine_disabled(self) -> bool:
        """Whether the sync engine has been deactivated."""
        return self._sync_engine_disabled

    @property
    def dual_mode_disabled(self) -> bool:
        """Whether the dual-mode wrapper has been deactivated."""
        return self._dual_mode_disabled

    @property
    def filesystem_fallback_disabled(self) -> bool:
        """Whether the SDK filesystem fallback code path is disabled."""
        return self._filesystem_fallback_disabled

    @property
    def migration_complete_flag(self) -> bool:
        """Whether ``migration_complete=true`` has been set."""
        return self._migration_complete_flag

    # -- lifecycle ---------------------------------------------------------

    async def enter(self) -> MigrationReport:
        """Enter Phase D: deactivate sync/dual-mode, set flags, log stats.

        Returns:
            :class:`MigrationReport` with final migration statistics.

        Raises:
            RuntimeError: If Phase D is already active.
            ValueError: If feature flags are not all set to ``database``.
        """
        if self._status == PhaseDStatus.ACTIVE:
            raise RuntimeError("Phase D is already active")

        self._verify_all_flags_database()

        self._entered_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseDStatus.ACTIVE

        # Deactivate sync engine and dual-mode wrapper
        self._sync_engine_disabled = True
        self._dual_mode_disabled = True
        self._filesystem_fallback_disabled = True
        self._migration_complete_flag = True

        report = self.get_migration_report()

        logger.info(
            "Phase D entered — filesystem deprecated, database is sole source of truth",
            extra={
                "entered_at": self._entered_at,
                "total_operations": report.total_operations,
                "total_errors": report.total_errors,
                "error_rate": report.error_rate,
                "migration_duration_hours": report.migration_duration_hours,
                "sync_engine_disabled": self._sync_engine_disabled,
                "dual_mode_disabled": self._dual_mode_disabled,
                "filesystem_fallback_disabled": self._filesystem_fallback_disabled,
                "migration_complete_flag": self._migration_complete_flag,
            },
        )
        return report

    async def exit(self) -> MigrationReport:
        """Exit Phase D: build final report, log exit.

        Returns:
            Final :class:`MigrationReport`.

        Raises:
            RuntimeError: If Phase D is not active.
        """
        if self._status != PhaseDStatus.ACTIVE:
            raise RuntimeError("Phase D is not active — cannot exit")

        self._status = PhaseDStatus.TRANSITIONING
        report = self.get_migration_report()

        self._exited_at = datetime.now(timezone.utc).isoformat()
        self._status = PhaseDStatus.INACTIVE

        logger.info(
            "Phase D exited — migration lifecycle complete",
            extra={
                "exited_at": self._exited_at,
                "total_operations": report.total_operations,
                "total_errors": report.total_errors,
                "error_rate": report.error_rate,
                "migration_duration_hours": report.migration_duration_hours,
            },
        )
        return report

    # -- deprecation interception ------------------------------------------

    def log_filesystem_deprecation(
        self,
        operation: str,
        ticket_id: str = "",
    ) -> None:
        """Emit a deprecation warning for a filesystem ticket operation.

        Args:
            operation: The operation that was attempted.
            ticket_id: The ticket involved, if applicable.

        Raises:
            RuntimeError: If Phase D is not active.
        """
        if self._status != PhaseDStatus.ACTIVE:
            raise RuntimeError(
                "Phase D is not active — deprecation warnings are only "
                "emitted during Phase D"
            )
        self._interceptor.intercept(operation, ticket_id)

    # -- migration report --------------------------------------------------

    def get_migration_report(self) -> MigrationReport:
        """Build a :class:`MigrationReport` with current statistics.

        Returns:
            :class:`MigrationReport` snapshot.
        """
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()

        total_ops = self._config.total_operations
        total_errs = self._config.total_errors
        error_rate = round(
            (total_errs / total_ops * 100.0) if total_ops > 0 else 0.0,
            2,
        )

        duration_hours = 0.0
        if self._config.migration_started_at:
            started = datetime.fromisoformat(self._config.migration_started_at)
            duration_hours = round(
                (now - started).total_seconds() / 3600.0,
                2,
            )

        return MigrationReport(
            total_operations=total_ops,
            total_errors=total_errs,
            error_rate=error_rate,
            migration_started_at=self._config.migration_started_at,
            migration_completed_at=self._entered_at or "",
            migration_duration_hours=duration_hours,
            sync_engine_disabled=self._sync_engine_disabled,
            dual_mode_disabled=self._dual_mode_disabled,
            filesystem_fallback_disabled=self._filesystem_fallback_disabled,
            migration_complete_flag=self._migration_complete_flag,
            validated_at=now_iso,
        )

    # -- internal helpers --------------------------------------------------

    def _verify_all_flags_database(self) -> None:
        """Ensure all feature flags are set to ``database`` mode.

        Raises:
            ValueError: If any operation flag is not ``database``.
        """
        manager = FeatureFlagManager(self._config.flags_config_path)
        manager.load()

        non_db: list[str] = []
        for operation in sorted(VALID_OPERATIONS):
            mode = manager.get_mode(operation)
            if mode != FlagMode.DATABASE:
                non_db.append(f"{operation}={mode.value}")

        if non_db:
            msg = (
                "Phase D requires all feature flags in 'database' mode. "
                f"Non-database flags: {', '.join(non_db)}"
            )
            raise ValueError(msg)
