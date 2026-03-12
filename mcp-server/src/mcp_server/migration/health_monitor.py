"""Health monitor for MCP server availability during migration.

Tracks MCP server health via configurable probes and a rolling
operation-success window. Determines when automated rollback is needed.
"""

from __future__ import annotations

import enum
import time
from collections import deque
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from mcp_server.observability import get_logger

logger = get_logger("migration.health_monitor")


class HealthStatus(enum.Enum):
    """Current health of the MCP server."""

    HEALTHY = "healthy"
    DEGRADED = "degraded"
    UNREACHABLE = "unreachable"


class OperationOutcome(enum.Enum):
    """Outcome of a single MCP operation."""

    SUCCESS = "success"
    FAILURE = "failure"


class RollbackReason(enum.Enum):
    """Reason for triggering automated rollback."""

    MCP_UNREACHABLE = "mcp_unreachable"
    ERROR_RATE_EXCEEDED = "error_rate_exceeded"


@runtime_checkable
class HealthProbe(Protocol):
    """Protocol for MCP health check probes."""

    async def check(self) -> bool: ...


@dataclass(frozen=True)
class HealthMonitorConfig:
    """Configuration for health monitoring."""

    probe_interval_seconds: float = 30.0
    unreachable_threshold_seconds: float = 300.0  # 5 minutes
    error_rate_threshold: float = 10.0  # percent
    rolling_window_seconds: float = 900.0  # 15 minutes


@dataclass
class _OperationEntry:
    """A single operation with timestamp."""

    outcome: OperationOutcome
    timestamp: float


class HealthMonitor:
    """Monitors MCP server health and determines rollback need.

    AC1: Configurable probe interval (default 30s).
    AC2: Rolling 15-min window for error rate calculation.
    AC3: MCP unreachable > 5 min triggers rollback.
    AC4: Error rate > 10% triggers rollback.
    """

    def __init__(
        self,
        config: HealthMonitorConfig,
        probe: HealthProbe | None = None,
    ) -> None:
        self._config = config
        self._probe = probe
        self._status: HealthStatus = HealthStatus.HEALTHY
        self._first_failure_time: float | None = None
        self._operations: deque[_OperationEntry] = deque()

    @property
    def status(self) -> HealthStatus:
        return self._status

    @property
    def probe_interval(self) -> float:
        return self._config.probe_interval_seconds

    async def check_health(self) -> HealthStatus:
        """Execute a health probe and update status."""
        if self._probe is None:
            return self._status

        healthy = await self._probe.check()
        now = time.monotonic()

        if healthy:
            self._status = HealthStatus.HEALTHY
            self._first_failure_time = None
            logger.info("health_probe_success")
        else:
            if self._first_failure_time is None:
                self._first_failure_time = now

            elapsed = now - self._first_failure_time
            if elapsed >= self._config.unreachable_threshold_seconds:
                self._status = HealthStatus.UNREACHABLE
                logger.warning(
                    "health_probe_unreachable",
                    extra={"elapsed_seconds": elapsed},
                )
            else:
                self._status = HealthStatus.DEGRADED
                logger.warning(
                    "health_probe_degraded",
                    extra={"elapsed_seconds": elapsed},
                )

        return self._status

    def record_operation(self, outcome: OperationOutcome) -> None:
        """Record an operation outcome into the rolling window."""
        self._operations.append(
            _OperationEntry(outcome=outcome, timestamp=time.monotonic())
        )
        self._prune_window()

    def _prune_window(self) -> None:
        """Remove entries older than the rolling window."""
        cutoff = time.monotonic() - self._config.rolling_window_seconds
        while self._operations and self._operations[0].timestamp < cutoff:
            self._operations.popleft()

    def get_rolling_stats(self) -> dict[str, float | int]:
        """Get rolling window statistics."""
        self._prune_window()
        total = len(self._operations)
        if total == 0:
            return {
                "total": 0,
                "successes": 0,
                "failures": 0,
                "error_rate": 0.0,
            }

        failures = sum(
            1 for e in self._operations if e.outcome == OperationOutcome.FAILURE
        )
        successes = total - failures
        error_rate = (failures / total) * 100.0

        return {
            "total": total,
            "successes": successes,
            "failures": failures,
            "error_rate": error_rate,
        }

    def exceeds_error_threshold(self) -> bool:
        """Check if current error rate exceeds the threshold."""
        stats = self.get_rolling_stats()
        if stats["total"] == 0:
            return False
        return stats["error_rate"] >= self._config.error_rate_threshold

    def needs_rollback(self) -> bool:
        """Determine if an automated rollback should be triggered."""
        if self._status == HealthStatus.UNREACHABLE:
            return True
        return bool(self.exceeds_error_threshold())

    def get_rollback_reason(self) -> RollbackReason | None:
        """Get the reason for triggering rollback, or None if healthy."""
        if self._status == HealthStatus.UNREACHABLE:
            return RollbackReason.MCP_UNREACHABLE
        if self.exceeds_error_threshold():
            return RollbackReason.ERROR_RATE_EXCEEDED
        return None
