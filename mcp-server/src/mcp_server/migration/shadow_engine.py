"""Shadow Mode Validation Engine.

Intercepts ticket operations, executes them via both filesystem and
database paths, compares results field-by-field, and logs divergences
with severity classification.

Divergence levels
-----------------
* ``CRITICAL`` — stage or claim mismatch (data integrity risk).
* ``WARNING``  — timing difference >5 s between paths.
* ``INFO``     — cosmetic / format-only differences.

Shadow mode is configurable per operation type and runs transparently
alongside Phases A and B to build confidence before full cutover.

Usage::

    engine = ShadowEngine(config)
    report = await engine.intercept("claim", fs_result, db_result)
    stats  = engine.get_stats()
"""

from __future__ import annotations

import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol, runtime_checkable

from mcp_server.observability import get_logger

logger = get_logger("migration.shadow_engine")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

COMPARED_FIELDS: tuple[str, ...] = (
    "ticket_id",
    "stage",
    "claimed_by",
    "lease_expiry",
    "dependencies",
)

CRITICAL_FIELDS: frozenset[str] = frozenset({"stage", "claimed_by"})

TIMING_WARNING_THRESHOLD_SECONDS: float = 5.0

VALID_SHADOW_OPERATIONS: frozenset[str] = frozenset(
    {"sync", "claim", "advance", "rework", "release", "status", "validate"}
)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class DivergenceLevel(str, Enum):
    """Severity classification for a divergence."""

    CRITICAL = "critical"
    WARNING = "warning"
    INFO = "info"


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Divergence:
    """A single field-level divergence between filesystem and database results.

    Attributes:
        field: The compared field name.
        fs_value: Value from the filesystem path.
        db_value: Value from the database path.
        level: Severity classification.
    """

    field: str
    fs_value: Any
    db_value: Any
    level: DivergenceLevel


@dataclass(frozen=True)
class DivergenceReport:
    """Structured report for a single intercepted operation.

    Attributes:
        operation: The ticket operation name (e.g. ``"claim"``).
        ticket_id: The ticket the operation targeted.
        divergences: List of field-level divergences found.
        fs_duration_seconds: Time the filesystem path took.
        db_duration_seconds: Time the database path took.
        timestamp: ISO-8601 timestamp of the comparison.
    """

    operation: str
    ticket_id: str
    divergences: list[Divergence]
    fs_duration_seconds: float
    db_duration_seconds: float
    timestamp: str


@dataclass
class DivergenceStats:
    """Aggregated divergence statistics for the dashboard endpoint.

    Attributes:
        total_operations: Total intercepted operations.
        total_divergences: Total divergences found across all operations.
        critical_count: Number of CRITICAL-level divergences.
        warning_count: Number of WARNING-level divergences.
        info_count: Number of INFO-level divergences.
        by_operation: Per-operation divergence counts.
        by_field: Per-field divergence counts.
        recent_critical: Most recent CRITICAL divergence reports (max 50).
    """

    total_operations: int = 0
    total_divergences: int = 0
    critical_count: int = 0
    warning_count: int = 0
    info_count: int = 0
    by_operation: dict[str, int] = field(default_factory=dict)
    by_field: dict[str, int] = field(default_factory=dict)
    recent_critical: list[dict[str, Any]] = field(default_factory=list)


@dataclass(frozen=True)
class ShadowConfig:
    """Per-operation enable/disable configuration for shadow mode.

    Attributes:
        enabled_operations: Set of operation names to shadow.
            Defaults to all valid operations.
        max_report_history: Maximum reports to retain in memory.
    """

    enabled_operations: frozenset[str] = VALID_SHADOW_OPERATIONS
    max_report_history: int = 10_000


# ---------------------------------------------------------------------------
# Filesystem / Database adapters (protocols)
# ---------------------------------------------------------------------------


@runtime_checkable
class TicketOperationAdapter(Protocol):
    """Async interface for executing a ticket operation."""

    async def execute(
        self, operation: str, ticket_id: str, **kwargs: Any
    ) -> dict[str, Any]:
        """Execute *operation* on *ticket_id* and return the result dict."""
        ...


# ---------------------------------------------------------------------------
# Divergence classifier
# ---------------------------------------------------------------------------


class DivergenceClassifier:
    """Classifies field-level differences into CRITICAL / WARNING / INFO."""

    @staticmethod
    def classify_field(field_name: str, fs_value: Any, db_value: Any) -> DivergenceLevel:
        """Return the severity level for a divergence on *field_name*."""
        if field_name in CRITICAL_FIELDS:
            return DivergenceLevel.CRITICAL
        return DivergenceLevel.INFO

    @staticmethod
    def classify_timing(
        fs_seconds: float, db_seconds: float
    ) -> DivergenceLevel | None:
        """Return WARNING if the timing difference exceeds the threshold."""
        diff = abs(fs_seconds - db_seconds)
        if diff > TIMING_WARNING_THRESHOLD_SECONDS:
            return DivergenceLevel.WARNING
        return None

    def compare(
        self,
        fs_result: dict[str, Any],
        db_result: dict[str, Any],
        fs_duration: float,
        db_duration: float,
    ) -> list[Divergence]:
        """Compare two result dicts field-by-field and return divergences."""
        divergences: list[Divergence] = []

        for fld in COMPARED_FIELDS:
            fs_val = fs_result.get(fld)
            db_val = db_result.get(fld)
            if not _values_equal(fs_val, db_val):
                level = self.classify_field(fld, fs_val, db_val)
                divergences.append(
                    Divergence(field=fld, fs_value=fs_val, db_value=db_val, level=level)
                )

        timing_level = self.classify_timing(fs_duration, db_duration)
        if timing_level is not None:
            divergences.append(
                Divergence(
                    field="_timing",
                    fs_value=fs_duration,
                    db_value=db_duration,
                    level=timing_level,
                )
            )

        return divergences


# ---------------------------------------------------------------------------
# Shadow engine
# ---------------------------------------------------------------------------


class ShadowEngine:
    """Intercepts ticket operations - executes via both paths, compares results.

    Parameters
    ----------
    config:
        Enable/disable and history settings.
    fs_adapter:
        Adapter that executes operations via the filesystem path.
    db_adapter:
        Adapter that executes operations via the database path.
    classifier:
        Optional custom divergence classifier.
    """

    def __init__(
        self,
        config: ShadowConfig | None = None,
        fs_adapter: TicketOperationAdapter | None = None,
        db_adapter: TicketOperationAdapter | None = None,
        classifier: DivergenceClassifier | None = None,
    ) -> None:
        self._config = config or ShadowConfig()
        self._fs_adapter = fs_adapter
        self._db_adapter = db_adapter
        self._classifier = classifier or DivergenceClassifier()
        self._reports: list[DivergenceReport] = []
        self._stats = DivergenceStats()
        self._level_counts: dict[DivergenceLevel, int] = defaultdict(int)

    # -- public API --------------------------------------------------------

    def is_enabled(self, operation: str) -> bool:
        """Return ``True`` if shadow mode is active for *operation*."""
        return operation in self._config.enabled_operations

    async def intercept(
        self,
        operation: str,
        ticket_id: str,
        *,
        fs_result: dict[str, Any] | None = None,
        db_result: dict[str, Any] | None = None,
        fs_adapter: TicketOperationAdapter | None = None,
        db_adapter: TicketOperationAdapter | None = None,
        **kwargs: Any,
    ) -> DivergenceReport:
        """Execute *operation* via both paths and compare.

        Callers may pass pre-computed ``fs_result`` / ``db_result`` dicts
        or provide adapters to execute live.

        Returns:
            A :class:`DivergenceReport` with all detected divergences.
        """
        if not self.is_enabled(operation):
            return DivergenceReport(
                operation=operation,
                ticket_id=ticket_id,
                divergences=[],
                fs_duration_seconds=0.0,
                db_duration_seconds=0.0,
                timestamp=_now_iso(),
            )

        fs_adapter = fs_adapter or self._fs_adapter
        db_adapter = db_adapter or self._db_adapter

        # Execute filesystem path
        fs_duration = 0.0
        if fs_result is None and fs_adapter is not None:
            t0 = time.monotonic()
            fs_result = await fs_adapter.execute(operation, ticket_id, **kwargs)
            fs_duration = time.monotonic() - t0
        fs_result = fs_result or {}

        # Execute database path
        db_duration = 0.0
        if db_result is None and db_adapter is not None:
            t0 = time.monotonic()
            db_result = await db_adapter.execute(operation, ticket_id, **kwargs)
            db_duration = time.monotonic() - t0
        db_result = db_result or {}

        # Compare
        divergences = self._classifier.compare(fs_result, db_result, fs_duration, db_duration)

        report = DivergenceReport(
            operation=operation,
            ticket_id=ticket_id,
            divergences=divergences,
            fs_duration_seconds=fs_duration,
            db_duration_seconds=db_duration,
            timestamp=_now_iso(),
        )

        self._record(report)
        return report

    def get_stats(self) -> DivergenceStats:
        """Return aggregated divergence statistics."""
        return self._stats

    def get_reports(self) -> list[DivergenceReport]:
        """Return stored divergence reports."""
        return list(self._reports)

    def get_stats_dict(self) -> dict[str, Any]:
        """Return stats as a plain dict suitable for JSON serialisation."""
        return {
            "total_operations": self._stats.total_operations,
            "total_divergences": self._stats.total_divergences,
            "critical_count": self._stats.critical_count,
            "warning_count": self._stats.warning_count,
            "info_count": self._stats.info_count,
            "by_operation": dict(self._stats.by_operation),
            "by_field": dict(self._stats.by_field),
            "recent_critical": self._stats.recent_critical,
        }

    def reset(self) -> None:
        """Clear all stored reports and statistics."""
        self._reports.clear()
        self._stats = DivergenceStats()
        self._level_counts.clear()

    # -- internals ---------------------------------------------------------

    def _record(self, report: DivergenceReport) -> None:
        """Update internal statistics and log divergences."""
        # Trim history
        if len(self._reports) >= self._config.max_report_history:
            self._reports = self._reports[-(self._config.max_report_history // 2) :]

        self._reports.append(report)
        self._stats.total_operations += 1

        for div in report.divergences:
            self._stats.total_divergences += 1
            self._level_counts[div.level] += 1

            # Per-operation counts
            op_key = report.operation
            self._stats.by_operation[op_key] = self._stats.by_operation.get(op_key, 0) + 1

            # Per-field counts
            self._stats.by_field[div.field] = self._stats.by_field.get(div.field, 0) + 1

        # Update level tallies
        self._stats.critical_count = self._level_counts[DivergenceLevel.CRITICAL]
        self._stats.warning_count = self._level_counts[DivergenceLevel.WARNING]
        self._stats.info_count = self._level_counts[DivergenceLevel.INFO]

        # Log divergences
        self._log_divergences(report)

    def _log_divergences(self, report: DivergenceReport) -> None:
        """Emit structured log entries for divergences."""
        if not report.divergences:
            logger.debug(
                "Shadow intercept — no divergences",
                extra={
                    "operation": report.operation,
                    "ticket_id": report.ticket_id,
                },
            )
            return

        has_critical = False
        for div in report.divergences:
            log_extra: dict[str, Any] = {
                "operation": report.operation,
                "ticket_id": report.ticket_id,
                "field": div.field,
                "fs_value": _safe_str(div.fs_value),
                "db_value": _safe_str(div.db_value),
                "classification": div.level.value,
            }

            if div.level is DivergenceLevel.CRITICAL:
                has_critical = True
                logger.error("SHADOW DIVERGENCE — CRITICAL", extra=log_extra)
                # Track recent criticals for dashboard (max 50)
                if len(self._stats.recent_critical) >= 50:
                    self._stats.recent_critical.pop(0)
                self._stats.recent_critical.append(
                    {
                        "operation": report.operation,
                        "ticket_id": report.ticket_id,
                        "field": div.field,
                        "fs_value": _safe_str(div.fs_value),
                        "db_value": _safe_str(div.db_value),
                        "timestamp": report.timestamp,
                    }
                )
            elif div.level is DivergenceLevel.WARNING:
                logger.warning("SHADOW DIVERGENCE — WARNING", extra=log_extra)
            else:
                logger.info("SHADOW DIVERGENCE — INFO", extra=log_extra)

        if has_critical:
            logger.error(
                "SHADOW ALERT — critical divergence detected",
                extra={
                    "operation": report.operation,
                    "ticket_id": report.ticket_id,
                    "critical_count": sum(
                        1 for d in report.divergences if d.level is DivergenceLevel.CRITICAL
                    ),
                },
            )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _values_equal(a: Any, b: Any) -> bool:
    """Compare two values, normalising common type differences."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    # Normalise string vs list for dependencies
    if isinstance(a, list) and isinstance(b, list):
        return sorted(str(x) for x in a) == sorted(str(x) for x in b)
    return str(a) == str(b)


def _safe_str(value: Any) -> str:
    """Convert a value to a truncated string for logging."""
    s = str(value)
    if len(s) > 200:
        return s[:197] + "..."
    return s


def _now_iso() -> str:
    """Return the current UTC time as an ISO-8601 string."""
    return datetime.now(timezone.utc).isoformat()
