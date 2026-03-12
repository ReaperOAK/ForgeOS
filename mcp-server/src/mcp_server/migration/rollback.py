"""Automated rollback manager for migration phase transitions.

Handles idempotent rollback: reverts feature flags, exports data,
and emits alerts when health thresholds are breached.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Protocol, runtime_checkable

from mcp_server.migration.health_monitor import RollbackReason  # noqa: TC001
from mcp_server.observability import get_logger

logger = get_logger("migration.rollback")


class RollbackState(enum.Enum):
    """State of the rollback manager."""

    IDLE = "idle"
    ROLLING_BACK = "rolling_back"
    ROLLED_BACK = "rolled_back"


@dataclass(frozen=True)
class RollbackManagerConfig:
    """Configuration for rollback manager."""

    current_phase: str
    previous_phase: str


@dataclass(frozen=True)
class RollbackEvent:
    """Record of a rollback execution."""

    reason: RollbackReason
    previous_phase: str
    new_phase: str
    timestamp: str
    already_rolled_back: bool = False
    export_success: bool = True


@runtime_checkable
class FeatureFlagSetter(Protocol):
    """Protocol for setting migration phase via feature flags."""

    async def set_phase(self, phase: str) -> None: ...


@runtime_checkable
class RollbackExporter(Protocol):
    """Protocol for export during rollback."""

    async def export(self) -> dict[str, Any]: ...


@runtime_checkable
class AlertEmitter(Protocol):
    """Protocol for emitting rollback alerts."""

    async def emit(self, event: dict[str, Any]) -> None: ...


class RollbackManager:
    """Manages automated rollback from one migration phase to the previous.

    AC5: Reverts feature flags, exports, emits alert.
    AC6: Idempotent — repeated calls are no-ops after first rollback.
    AC7: Every rollback event is logged with reason, phases, timestamp.
    """

    def __init__(
        self,
        config: RollbackManagerConfig,
        flag_setter: FeatureFlagSetter,
        exporter: RollbackExporter,
        alert_emitter: AlertEmitter,
    ) -> None:
        self._config = config
        self._flag_setter = flag_setter
        self._exporter = exporter
        self._alert_emitter = alert_emitter
        self._state: RollbackState = RollbackState.IDLE
        self._event_history: list[RollbackEvent] = []

    @property
    def state(self) -> RollbackState:
        return self._state

    @property
    def event_history(self) -> list[RollbackEvent]:
        return list(self._event_history)

    async def execute_rollback(self, reason: RollbackReason) -> RollbackEvent:
        """Execute a rollback to the previous phase.

        Idempotent: returns immediately if already rolled back.
        """
        now = datetime.now(timezone.utc).isoformat()

        if self._state == RollbackState.ROLLED_BACK:
            event = RollbackEvent(
                reason=reason,
                previous_phase=self._config.current_phase,
                new_phase=self._config.previous_phase,
                timestamp=now,
                already_rolled_back=True,
            )
            self._event_history.append(event)
            logger.info(
                "rollback_already_completed",
                extra={"reason": reason.value},
            )
            return event

        self._state = RollbackState.ROLLING_BACK
        logger.warning(
            "rollback_started",
            extra={
                "reason": reason.value,
                "from_phase": self._config.current_phase,
                "to_phase": self._config.previous_phase,
            },
        )

        # Step 1: Revert feature flags
        await self._flag_setter.set_phase(self._config.previous_phase)
        logger.info(
            "rollback_flags_reverted",
            extra={"new_phase": self._config.previous_phase},
        )

        # Step 2: Execute export (best-effort)
        export_success = True
        try:
            await self._exporter.export()
            logger.info("rollback_export_complete")
        except Exception as exc:
            export_success = False
            logger.error("rollback_export_failed", extra={"error": str(exc)})

        # Step 3: Emit alert
        alert_data = {
            "type": "migration_rollback",
            "reason": reason.value,
            "from_phase": self._config.current_phase,
            "to_phase": self._config.previous_phase,
            "timestamp": now,
            "export_success": export_success,
        }
        await self._alert_emitter.emit(alert_data)
        logger.info("rollback_alert_emitted")

        event = RollbackEvent(
            reason=reason,
            previous_phase=self._config.current_phase,
            new_phase=self._config.previous_phase,
            timestamp=now,
            export_success=export_success,
        )
        self._event_history.append(event)
        self._state = RollbackState.ROLLED_BACK

        logger.warning(
            "rollback_complete",
            extra={
                "reason": reason.value,
                "new_phase": self._config.previous_phase,
            },
        )
        return event

    def reset(self) -> None:
        """Reset rollback state to IDLE (e.g. after manual recovery)."""
        self._state = RollbackState.IDLE
        logger.info("rollback_state_reset")
