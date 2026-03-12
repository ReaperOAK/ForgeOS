"""Tests for mcp_server.migration.phases.phase_c."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

import pytest
import yaml

if TYPE_CHECKING:
    from pathlib import Path

from mcp_server.migration.phases.phase_c import (
    ExportRecord,
    FilesystemWriteDetector,
    PhaseC,
    PhaseCConfig,
    PhaseCStatus,
    SDKOperationAdapter,
    TransitionReport,
)

# ---------------------------------------------------------------------------
# Fake adapters
# ---------------------------------------------------------------------------


class FakeSDKOperationAdapter(SDKOperationAdapter):
    """SDK adapter that can successively succeed or fail."""

    def __init__(self, *, fail: bool = False, error_msg: str = "MCP down") -> None:
        self.fail = fail
        self.error_msg = error_msg
        self.calls: list[dict[str, Any]] = []

    async def execute(
        self,
        operation: str,
        ticket_id: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        self.calls.append(
            {"operation": operation, "ticket_id": ticket_id, **kwargs}
        )
        if self.fail:
            raise ConnectionError(self.error_msg)
        return {"ticket_id": ticket_id, "operation": operation, "status": "ok"}


class FakeExporter:
    """Fake database-to-filesystem exporter."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.export_count: int = 0

    async def export(self) -> dict[str, Any]:
        self.export_count += 1
        if self.fail:
            raise RuntimeError("Export failed")
        return {"exported": 10, "errors": 0}


class FakeFilesystemWriteDetector(FilesystemWriteDetector):
    """Write detector that can be configured to report writes."""

    def __init__(self, *, has_writes: bool = False) -> None:
        self._has_writes = has_writes
        self.check_count: int = 0

    async def detect_writes_since(self, since_iso: str) -> list[dict[str, Any]]:
        self.check_count += 1
        if self._has_writes:
            return [{"path": ".github/tickets/T-001.json", "timestamp": since_iso}]
        return []


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_flags_yaml(path: Path, *, mode: str = "database") -> None:
    """Write a migration-flags YAML with all flags set to given mode."""
    data = {
        "global": {"mode": mode},
        "operations": {
            op: {"mode": mode}
            for op in ("sync", "claim", "advance", "release", "rework", "status", "validate")
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data), encoding="utf-8")


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def flags_path(tmp_path: Path) -> Path:
    fp = tmp_path / "config" / "migration-flags.yaml"
    _write_flags_yaml(fp, mode="database")
    return fp


@pytest.fixture()
def phase_c_config(flags_path: Path) -> PhaseCConfig:
    return PhaseCConfig(
        flags_config_path=flags_path,
        transition_gate_hours=0.0,  # immediate for tests
        export_interval_seconds=60.0,
    )


@pytest.fixture()
def sdk_adapter() -> FakeSDKOperationAdapter:
    return FakeSDKOperationAdapter()


@pytest.fixture()
def exporter() -> FakeExporter:
    return FakeExporter()


@pytest.fixture()
def write_detector() -> FakeFilesystemWriteDetector:
    return FakeFilesystemWriteDetector()


@pytest.fixture()
def phase_c(
    phase_c_config: PhaseCConfig,
    sdk_adapter: FakeSDKOperationAdapter,
    exporter: FakeExporter,
    write_detector: FakeFilesystemWriteDetector,
) -> PhaseC:
    return PhaseC(phase_c_config, sdk_adapter, exporter, write_detector)


# ---------------------------------------------------------------------------
# Tests — Status & Lifecycle
# ---------------------------------------------------------------------------


class TestPhaseCLifecycle:
    """Lifecycle enter / exit tests."""

    @pytest.mark.asyncio
    async def test_initial_status_is_inactive(self, phase_c: PhaseC) -> None:
        assert phase_c.status == PhaseCStatus.INACTIVE

    @pytest.mark.asyncio
    async def test_enter_sets_active(self, phase_c: PhaseC) -> None:
        await phase_c.enter()
        assert phase_c.status == PhaseCStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_enter_records_timestamp(self, phase_c: PhaseC) -> None:
        await phase_c.enter()
        assert phase_c.entered_at is not None
        datetime.fromisoformat(phase_c.entered_at)

    @pytest.mark.asyncio
    async def test_enter_twice_raises(self, phase_c: PhaseC) -> None:
        await phase_c.enter()
        with pytest.raises(RuntimeError, match="already active"):
            await phase_c.enter()

    @pytest.mark.asyncio
    async def test_exit_returns_report(self, phase_c: PhaseC) -> None:
        await phase_c.enter()
        report = await phase_c.exit()
        assert isinstance(report, TransitionReport)
        assert phase_c.status == PhaseCStatus.INACTIVE

    @pytest.mark.asyncio
    async def test_exit_records_timestamp(self, phase_c: PhaseC) -> None:
        await phase_c.enter()
        await phase_c.exit()
        assert phase_c.exited_at is not None
        datetime.fromisoformat(phase_c.exited_at)

    @pytest.mark.asyncio
    async def test_exit_when_inactive_raises(self, phase_c: PhaseC) -> None:
        with pytest.raises(RuntimeError, match="not active"):
            await phase_c.exit()

    @pytest.mark.asyncio
    async def test_entry_logged_with_timestamp(self, phase_c: PhaseC) -> None:
        """AC7: Phase C entry logged with timestamp."""
        await phase_c.enter()
        assert phase_c.entered_at is not None

    @pytest.mark.asyncio
    async def test_exit_logged_with_error_rates(self, phase_c: PhaseC) -> None:
        """AC7: Phase C exit logged with timestamp and error rates."""
        await phase_c.enter()
        report = await phase_c.exit()
        assert report.validated_at != ""
        assert phase_c.exited_at is not None


# ---------------------------------------------------------------------------
# Tests — Flag verification (AC1)
# ---------------------------------------------------------------------------


class TestFlagVerification:
    """Ensure Phase C requires all flags = database."""

    @pytest.mark.asyncio
    async def test_enter_with_filesystem_flag_raises(
        self,
        tmp_path: Path,
        sdk_adapter: FakeSDKOperationAdapter,
        exporter: FakeExporter,
        write_detector: FakeFilesystemWriteDetector,
    ) -> None:
        fp = tmp_path / "config" / "flags.yaml"
        _write_flags_yaml(fp, mode="filesystem")
        config = PhaseCConfig(flags_config_path=fp)
        pc = PhaseC(config, sdk_adapter, exporter, write_detector)
        with pytest.raises(ValueError, match="database"):
            await pc.enter()

    @pytest.mark.asyncio
    async def test_enter_with_dual_flag_raises(
        self,
        tmp_path: Path,
        sdk_adapter: FakeSDKOperationAdapter,
        exporter: FakeExporter,
        write_detector: FakeFilesystemWriteDetector,
    ) -> None:
        fp = tmp_path / "config" / "flags.yaml"
        _write_flags_yaml(fp, mode="dual")
        config = PhaseCConfig(flags_config_path=fp)
        pc = PhaseC(config, sdk_adapter, exporter, write_detector)
        with pytest.raises(ValueError, match="database"):
            await pc.enter()


# ---------------------------------------------------------------------------
# Tests — SDK operations without fallback (AC2)
# ---------------------------------------------------------------------------


class TestNoFallback:
    """AC2: SDK operations do not attempt filesystem fallback."""

    @pytest.mark.asyncio
    async def test_execute_operation_success(
        self, phase_c: PhaseC, sdk_adapter: FakeSDKOperationAdapter
    ) -> None:
        await phase_c.enter()
        result = await phase_c.execute_operation("claim", "T-001", agent_name="Backend")
        assert result["ticket_id"] == "T-001"
        assert len(sdk_adapter.calls) == 1

    @pytest.mark.asyncio
    async def test_execute_operation_failure_propagates(
        self, phase_c: PhaseC, sdk_adapter: FakeSDKOperationAdapter
    ) -> None:
        sdk_adapter.fail = True
        await phase_c.enter()
        with pytest.raises(ConnectionError, match="MCP down"):
            await phase_c.execute_operation("claim", "T-002")

    @pytest.mark.asyncio
    async def test_no_fallback_on_failure(
        self, phase_c: PhaseC, sdk_adapter: FakeSDKOperationAdapter
    ) -> None:
        """Errors propagate directly — no fallback path."""
        sdk_adapter.fail = True
        await phase_c.enter()
        with pytest.raises(ConnectionError):
            await phase_c.execute_operation("advance", "T-003")
        # Only one call; no fallback adapter involved
        assert len(sdk_adapter.calls) == 1

    @pytest.mark.asyncio
    async def test_execute_without_enter_raises(self, phase_c: PhaseC) -> None:
        with pytest.raises(RuntimeError, match="not active"):
            await phase_c.execute_operation("claim", "T-004")


# ---------------------------------------------------------------------------
# Tests — Periodic export (AC3)
# ---------------------------------------------------------------------------


class TestPeriodicExport:
    """AC3: Periodic DB-to-FS export runs for backup."""

    @pytest.mark.asyncio
    async def test_run_export(
        self, phase_c: PhaseC, exporter: FakeExporter
    ) -> None:
        await phase_c.enter()
        record = await phase_c.run_export()
        assert isinstance(record, ExportRecord)
        assert record.success is True
        assert exporter.export_count == 1

    @pytest.mark.asyncio
    async def test_export_failure_recorded(
        self, phase_c: PhaseC, exporter: FakeExporter
    ) -> None:
        exporter.fail = True
        await phase_c.enter()
        record = await phase_c.run_export()
        assert record.success is False
        assert record.error != ""

    @pytest.mark.asyncio
    async def test_export_history_tracked(
        self, phase_c: PhaseC, exporter: FakeExporter
    ) -> None:
        await phase_c.enter()
        await phase_c.run_export()
        await phase_c.run_export()
        assert len(phase_c.export_history) == 2


# ---------------------------------------------------------------------------
# Tests — Filesystem read-only (AC4)
# ---------------------------------------------------------------------------


class TestFilesystemReadOnly:
    """AC4: Filesystem treated as read-only; FS writes detected for gate."""

    @pytest.mark.asyncio
    async def test_no_writes_means_clean(
        self, phase_c: PhaseC, write_detector: FakeFilesystemWriteDetector
    ) -> None:
        await phase_c.enter()
        report = await phase_c.validate()
        assert report.filesystem_writes == 0
        assert write_detector.check_count == 1

    @pytest.mark.asyncio
    async def test_writes_detected_blocks_transition(
        self,
        phase_c_config: PhaseCConfig,
        sdk_adapter: FakeSDKOperationAdapter,
        exporter: FakeExporter,
    ) -> None:
        detector = FakeFilesystemWriteDetector(has_writes=True)
        pc = PhaseC(phase_c_config, sdk_adapter, exporter, detector)
        await pc.enter()
        report = await pc.validate()
        assert report.filesystem_writes == 1
        assert report.can_transition is False


# ---------------------------------------------------------------------------
# Tests — WORK commits unchanged (AC5)
# ---------------------------------------------------------------------------


class TestWorkCommits:
    """AC5: WORK commits (code changes) remain unchanged."""

    def test_work_commit_flag_is_false(self, phase_c: PhaseC) -> None:
        """Phase C does not intercept git WORK commits."""
        assert phase_c.intercepts_work_commits is False


# ---------------------------------------------------------------------------
# Tests — Transition gate (AC6)
# ---------------------------------------------------------------------------


class TestTransitionGate:
    """AC6: zero FS writes for 72+ hours."""

    @pytest.mark.asyncio
    async def test_can_transition_zero_writes_gate_met(
        self, phase_c: PhaseC
    ) -> None:
        """With gate_hours=0, no writes should immediately pass."""
        await phase_c.enter()
        report = await phase_c.validate()
        assert report.can_transition is True

    @pytest.mark.asyncio
    async def test_cannot_transition_when_writes_detected(
        self,
        phase_c_config: PhaseCConfig,
        sdk_adapter: FakeSDKOperationAdapter,
        exporter: FakeExporter,
    ) -> None:
        detector = FakeFilesystemWriteDetector(has_writes=True)
        pc = PhaseC(phase_c_config, sdk_adapter, exporter, detector)
        await pc.enter()
        report = await pc.validate()
        assert report.can_transition is False

    @pytest.mark.asyncio
    async def test_gate_hours_blocks_transition(
        self,
        flags_path: Path,
        sdk_adapter: FakeSDKOperationAdapter,
        exporter: FakeExporter,
        write_detector: FakeFilesystemWriteDetector,
    ) -> None:
        """Non-zero gate_hours prevents immediate transition."""
        config = PhaseCConfig(
            flags_config_path=flags_path,
            transition_gate_hours=72.0,
        )
        pc = PhaseC(config, sdk_adapter, exporter, write_detector)
        await pc.enter()
        report = await pc.validate()
        assert report.can_transition is False
        assert report.zero_writes_hours < 72.0

    @pytest.mark.asyncio
    async def test_validated_at_is_set(self, phase_c: PhaseC) -> None:
        await phase_c.enter()
        report = await phase_c.validate()
        assert report.validated_at != ""
        datetime.fromisoformat(report.validated_at)

    @pytest.mark.asyncio
    async def test_gate_resets_when_writes_detected(
        self,
        phase_c_config: PhaseCConfig,
        sdk_adapter: FakeSDKOperationAdapter,
        exporter: FakeExporter,
    ) -> None:
        # Initially no writes
        detector = FakeFilesystemWriteDetector(has_writes=False)
        pc = PhaseC(phase_c_config, sdk_adapter, exporter, detector)
        await pc.enter()
        report1 = await pc.validate()
        assert report1.zero_writes_since is not None

        # Simulate writes appearing
        detector._has_writes = True
        report2 = await pc.validate()
        assert report2.zero_writes_since is None
        assert report2.zero_writes_hours == 0.0


# ---------------------------------------------------------------------------
# Tests — Operation tracking
# ---------------------------------------------------------------------------


class TestOperationTracking:
    """Tests for operation logging and error rate tracking."""

    @pytest.mark.asyncio
    async def test_successful_operations_tracked(
        self, phase_c: PhaseC, sdk_adapter: FakeSDKOperationAdapter
    ) -> None:
        await phase_c.enter()
        await phase_c.execute_operation("claim", "T-001")
        await phase_c.execute_operation("advance", "T-002")
        stats = phase_c.get_operation_stats()
        assert stats["total"] == 2
        assert stats["successes"] == 2
        assert stats["failures"] == 0

    @pytest.mark.asyncio
    async def test_failed_operations_tracked(
        self, phase_c: PhaseC, sdk_adapter: FakeSDKOperationAdapter
    ) -> None:
        await phase_c.enter()
        await phase_c.execute_operation("claim", "T-001")
        sdk_adapter.fail = True
        with pytest.raises(ConnectionError):
            await phase_c.execute_operation("claim", "T-002")
        stats = phase_c.get_operation_stats()
        assert stats["total"] == 2
        assert stats["successes"] == 1
        assert stats["failures"] == 1

    @pytest.mark.asyncio
    async def test_error_rate_in_report(
        self, phase_c: PhaseC, sdk_adapter: FakeSDKOperationAdapter
    ) -> None:
        await phase_c.enter()
        await phase_c.execute_operation("claim", "T-001")
        sdk_adapter.fail = True
        with pytest.raises(ConnectionError):
            await phase_c.execute_operation("claim", "T-002")
        report = await phase_c.validate()
        assert report.error_rate == 50.0
