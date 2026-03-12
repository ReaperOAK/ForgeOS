"""Tests for mcp_server.migration.health_monitor and rollback."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytest

from mcp_server.migration.health_monitor import (
    HealthMonitor,
    HealthMonitorConfig,
    HealthStatus,
    OperationOutcome,
)
from mcp_server.migration.rollback import (
    RollbackEvent,
    RollbackManager,
    RollbackManagerConfig,
    RollbackReason,
    RollbackState,
)

# ---------------------------------------------------------------------------
# Fake adapters for health monitor
# ---------------------------------------------------------------------------


class FakeHealthProbe:
    """Probe that can be set to succeed or fail."""

    def __init__(self, *, healthy: bool = True) -> None:
        self.healthy = healthy
        self.probe_count: int = 0

    async def check(self) -> bool:
        self.probe_count += 1
        return self.healthy


class FakeFeatureFlagSetter:
    """Sets feature flags to a given phase config."""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def set_phase(self, phase: str) -> None:
        self.calls.append({"phase": phase, "timestamp": datetime.now(timezone.utc).isoformat()})


class FakeExporter:
    """Fake exporter for rollback."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.export_count: int = 0

    async def export(self) -> dict[str, Any]:
        self.export_count += 1
        if self.fail:
            raise RuntimeError("Export failed")
        return {"exported": 5, "errors": 0}


class FakeAlertEmitter:
    """Fake alert emitter."""

    def __init__(self) -> None:
        self.alerts: list[dict[str, Any]] = []

    async def emit(self, event: dict[str, Any]) -> None:
        self.alerts.append(event)


# ---------------------------------------------------------------------------
# Tests — HealthMonitor
# ---------------------------------------------------------------------------


class TestHealthMonitor:
    """Tests for HealthMonitor probe and operation tracking."""

    def test_initial_status_is_healthy(self) -> None:
        config = HealthMonitorConfig()
        monitor = HealthMonitor(config)
        assert monitor.status == HealthStatus.HEALTHY

    @pytest.mark.asyncio
    async def test_probe_success_keeps_healthy(self) -> None:
        probe = FakeHealthProbe(healthy=True)
        config = HealthMonitorConfig(probe_interval_seconds=30.0)
        monitor = HealthMonitor(config, probe=probe)
        await monitor.check_health()
        assert monitor.status == HealthStatus.HEALTHY
        assert probe.probe_count == 1

    @pytest.mark.asyncio
    async def test_probe_failure_sets_degraded(self) -> None:
        probe = FakeHealthProbe(healthy=False)
        config = HealthMonitorConfig(probe_interval_seconds=30.0)
        monitor = HealthMonitor(config, probe=probe)
        await monitor.check_health()
        assert monitor.status == HealthStatus.DEGRADED

    @pytest.mark.asyncio
    async def test_unreachable_after_threshold(self) -> None:
        """AC3: MCP unreachable for >5 min triggers UNREACHABLE."""
        probe = FakeHealthProbe(healthy=False)
        config = HealthMonitorConfig(
            probe_interval_seconds=30.0,
            unreachable_threshold_seconds=0.0,  # immediate for tests
        )
        monitor = HealthMonitor(config, probe=probe)
        await monitor.check_health()
        assert monitor.status == HealthStatus.UNREACHABLE

    def test_record_operation_success(self) -> None:
        config = HealthMonitorConfig()
        monitor = HealthMonitor(config)
        monitor.record_operation(OperationOutcome.SUCCESS)
        stats = monitor.get_rolling_stats()
        assert stats["total"] == 1
        assert stats["successes"] == 1
        assert stats["error_rate"] == 0.0

    def test_record_operation_failure(self) -> None:
        config = HealthMonitorConfig()
        monitor = HealthMonitor(config)
        monitor.record_operation(OperationOutcome.FAILURE)
        stats = monitor.get_rolling_stats()
        assert stats["total"] == 1
        assert stats["failures"] == 1
        assert stats["error_rate"] == 100.0

    def test_error_rate_calculation(self) -> None:
        """AC2: Rolling 15-min window error rate."""
        config = HealthMonitorConfig()
        monitor = HealthMonitor(config)
        for _ in range(9):
            monitor.record_operation(OperationOutcome.SUCCESS)
        monitor.record_operation(OperationOutcome.FAILURE)
        stats = monitor.get_rolling_stats()
        assert stats["error_rate"] == 10.0

    def test_exceeds_error_threshold(self) -> None:
        """AC4: Error rate exceeds 10%."""
        config = HealthMonitorConfig(error_rate_threshold=10.0)
        monitor = HealthMonitor(config)
        monitor.record_operation(OperationOutcome.FAILURE)
        monitor.record_operation(OperationOutcome.FAILURE)
        for _ in range(8):
            monitor.record_operation(OperationOutcome.SUCCESS)
        assert monitor.exceeds_error_threshold() is True

    def test_below_error_threshold(self) -> None:
        config = HealthMonitorConfig(error_rate_threshold=10.0)
        monitor = HealthMonitor(config)
        for _ in range(20):
            monitor.record_operation(OperationOutcome.SUCCESS)
        assert monitor.exceeds_error_threshold() is False

    @pytest.mark.asyncio
    async def test_needs_rollback_unreachable(self) -> None:
        """AC3: Rollback trigger when unreachable."""
        probe = FakeHealthProbe(healthy=False)
        config = HealthMonitorConfig(
            unreachable_threshold_seconds=0.0,
            error_rate_threshold=10.0,
        )
        monitor = HealthMonitor(config, probe=probe)
        await monitor.check_health()
        assert monitor.needs_rollback() is True

    @pytest.mark.asyncio
    async def test_needs_rollback_error_rate(self) -> None:
        """AC4: Rollback trigger when error rate > 10%."""
        probe = FakeHealthProbe(healthy=True)
        config = HealthMonitorConfig(error_rate_threshold=10.0)
        monitor = HealthMonitor(config, probe=probe)
        # 20% error rate
        for _ in range(8):
            monitor.record_operation(OperationOutcome.SUCCESS)
        for _ in range(2):
            monitor.record_operation(OperationOutcome.FAILURE)
        assert monitor.needs_rollback() is True

    @pytest.mark.asyncio
    async def test_no_rollback_when_healthy(self) -> None:
        config = HealthMonitorConfig()
        monitor = HealthMonitor(config)
        for _ in range(10):
            monitor.record_operation(OperationOutcome.SUCCESS)
        assert monitor.needs_rollback() is False

    def test_get_rollback_reason_unreachable(self) -> None:
        config = HealthMonitorConfig(unreachable_threshold_seconds=0.0)
        monitor = HealthMonitor(config)
        monitor._status = HealthStatus.UNREACHABLE
        reason = monitor.get_rollback_reason()
        assert reason == RollbackReason.MCP_UNREACHABLE

    def test_get_rollback_reason_error_rate(self) -> None:
        config = HealthMonitorConfig(error_rate_threshold=10.0)
        monitor = HealthMonitor(config)
        for _ in range(5):
            monitor.record_operation(OperationOutcome.FAILURE)
        for _ in range(5):
            monitor.record_operation(OperationOutcome.SUCCESS)
        reason = monitor.get_rollback_reason()
        assert reason == RollbackReason.ERROR_RATE_EXCEEDED

    def test_get_rollback_reason_none(self) -> None:
        config = HealthMonitorConfig()
        monitor = HealthMonitor(config)
        reason = monitor.get_rollback_reason()
        assert reason is None

    def test_configurable_probe_interval(self) -> None:
        """AC1: Configurable probe interval."""
        config = HealthMonitorConfig(probe_interval_seconds=15.0)
        monitor = HealthMonitor(config)
        assert monitor.probe_interval == 15.0


# ---------------------------------------------------------------------------
# Tests — RollbackManager
# ---------------------------------------------------------------------------


class TestRollbackManager:
    """Tests for RollbackManager rollback execution."""

    @pytest.fixture()
    def flag_setter(self) -> FakeFeatureFlagSetter:
        return FakeFeatureFlagSetter()

    @pytest.fixture()
    def exporter(self) -> FakeExporter:
        return FakeExporter()

    @pytest.fixture()
    def alert_emitter(self) -> FakeAlertEmitter:
        return FakeAlertEmitter()

    @pytest.fixture()
    def rollback_mgr(
        self,
        flag_setter: FakeFeatureFlagSetter,
        exporter: FakeExporter,
        alert_emitter: FakeAlertEmitter,
    ) -> RollbackManager:
        config = RollbackManagerConfig(current_phase="C", previous_phase="B")
        return RollbackManager(config, flag_setter, exporter, alert_emitter)

    @pytest.mark.asyncio
    async def test_rollback_reverts_to_previous_phase(
        self,
        rollback_mgr: RollbackManager,
        flag_setter: FakeFeatureFlagSetter,
    ) -> None:
        """AC5: feature flags reverted to previous phase."""
        event = await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        assert len(flag_setter.calls) == 1
        assert flag_setter.calls[0]["phase"] == "B"
        assert event.new_phase == "B"

    @pytest.mark.asyncio
    async def test_rollback_runs_export(
        self,
        rollback_mgr: RollbackManager,
        exporter: FakeExporter,
    ) -> None:
        """AC5: export executed during rollback."""
        await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        assert exporter.export_count == 1

    @pytest.mark.asyncio
    async def test_rollback_emits_alert(
        self,
        rollback_mgr: RollbackManager,
        alert_emitter: FakeAlertEmitter,
    ) -> None:
        """AC5: alert emitted on rollback."""
        await rollback_mgr.execute_rollback(RollbackReason.ERROR_RATE_EXCEEDED)
        assert len(alert_emitter.alerts) == 1
        alert = alert_emitter.alerts[0]
        assert alert["reason"] == RollbackReason.ERROR_RATE_EXCEEDED.value

    @pytest.mark.asyncio
    async def test_rollback_is_idempotent(
        self,
        rollback_mgr: RollbackManager,
        flag_setter: FakeFeatureFlagSetter,
        exporter: FakeExporter,
    ) -> None:
        """AC6: Rollback is idempotent."""
        event1 = await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)  # noqa: F841
        event2 = await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        # Second call should not execute again
        assert len(flag_setter.calls) == 1
        assert exporter.export_count == 1
        assert event2.already_rolled_back is True

    @pytest.mark.asyncio
    async def test_rollback_event_contains_full_info(
        self,
        rollback_mgr: RollbackManager,
    ) -> None:
        """AC7: Rollback event logged with trigger reason, phases, timestamp."""
        event = await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        assert isinstance(event, RollbackEvent)
        assert event.reason == RollbackReason.MCP_UNREACHABLE
        assert event.previous_phase == "C"
        assert event.new_phase == "B"
        assert event.timestamp != ""
        datetime.fromisoformat(event.timestamp)

    @pytest.mark.asyncio
    async def test_rollback_state_transitions(
        self,
        rollback_mgr: RollbackManager,
    ) -> None:
        assert rollback_mgr.state == RollbackState.IDLE
        await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        assert rollback_mgr.state == RollbackState.ROLLED_BACK

    @pytest.mark.asyncio
    async def test_reset_allows_re_rollback(
        self,
        rollback_mgr: RollbackManager,
        flag_setter: FakeFeatureFlagSetter,
    ) -> None:
        await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        rollback_mgr.reset()
        assert rollback_mgr.state == RollbackState.IDLE
        event = await rollback_mgr.execute_rollback(RollbackReason.ERROR_RATE_EXCEEDED)
        assert event.already_rolled_back is False
        assert len(flag_setter.calls) == 2

    @pytest.mark.asyncio
    async def test_rollback_with_export_failure_still_completes(
        self,
        flag_setter: FakeFeatureFlagSetter,
        alert_emitter: FakeAlertEmitter,
    ) -> None:
        """Export failure during rollback should not prevent flag revert."""
        bad_exporter = FakeExporter(fail=True)
        config = RollbackManagerConfig(current_phase="C", previous_phase="B")
        mgr = RollbackManager(config, flag_setter, bad_exporter, alert_emitter)
        event = await mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        # Flags are still reverted
        assert len(flag_setter.calls) == 1
        # Alert still emitted
        assert len(alert_emitter.alerts) == 1
        assert event.export_success is False

    @pytest.mark.asyncio
    async def test_rollback_event_history(
        self,
        rollback_mgr: RollbackManager,
    ) -> None:
        await rollback_mgr.execute_rollback(RollbackReason.MCP_UNREACHABLE)
        assert len(rollback_mgr.event_history) == 1
