"""Tests for mcp_server.migration.phases.phase_b."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pytest
import yaml

from mcp_server.migration.phases.phase_b import (
    FilesystemClaimAdapter,
    OperationBackend,
    OperationRecord,
    PhaseB,
    PhaseBConfig,
    PhaseBStatus,
    SDKClaimAdapter,
    TransitionReport,
)


# ---------------------------------------------------------------------------
# Fake adapters
# ---------------------------------------------------------------------------


class FakeSDKAdapter(SDKClaimAdapter):
    """SDK adapter that can be set to succeed or fail."""

    def __init__(self, *, fail: bool = False, error_msg: str = "MCP down") -> None:
        self.fail = fail
        self.error_msg = error_msg
        self.calls: list[dict[str, Any]] = []

    async def claim(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
        machine_id: str = "",
        operator: str = "",
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "ticket_id": ticket_id,
                "agent_name": agent_name,
                "machine_id": machine_id,
                "operator": operator,
            }
        )
        if self.fail:
            raise ConnectionError(self.error_msg)
        return {"ticket_id": ticket_id, "status": "claimed"}


class FakeFilesystemAdapter(FilesystemClaimAdapter):
    """Filesystem adapter that can be set to succeed or fail."""

    def __init__(self, *, fail: bool = False, error_msg: str = "FS error") -> None:
        self.fail = fail
        self.error_msg = error_msg
        self.calls: list[dict[str, Any]] = []

    async def claim(
        self,
        ticket_id: str,
        *,
        agent_name: str = "",
        machine_id: str = "",
        operator: str = "",
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "ticket_id": ticket_id,
                "agent_name": agent_name,
                "machine_id": machine_id,
                "operator": operator,
            }
        )
        if self.fail:
            raise OSError(self.error_msg)
        return {"ticket_id": ticket_id, "status": "claimed-fs"}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_flags_yaml(path: Path, *, claim_mode: str = "dual") -> None:
    """Write a migration-flags YAML with the given claim mode."""
    data = {
        "global": {"mode": "filesystem"},
        "operations": {
            "sync": {"mode": "filesystem"},
            "claim": {"mode": claim_mode},
            "advance": {"mode": "filesystem"},
            "release": {"mode": "filesystem"},
            "rework": {"mode": "filesystem"},
            "status": {"mode": "filesystem"},
            "validate": {"mode": "filesystem"},
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
    _write_flags_yaml(fp, claim_mode="dual")
    return fp


@pytest.fixture()
def phase_b_config(flags_path: Path) -> PhaseBConfig:
    return PhaseBConfig(
        flags_config_path=flags_path,
        transition_gate_mcp_percent=95.0,
        transition_gate_hours=0.0,  # immediate for tests
    )


@pytest.fixture()
def sdk_adapter() -> FakeSDKAdapter:
    return FakeSDKAdapter()


@pytest.fixture()
def fs_adapter() -> FakeFilesystemAdapter:
    return FakeFilesystemAdapter()


@pytest.fixture()
def phase_b(
    phase_b_config: PhaseBConfig,
    sdk_adapter: FakeSDKAdapter,
    fs_adapter: FakeFilesystemAdapter,
) -> PhaseB:
    return PhaseB(phase_b_config, sdk_adapter, fs_adapter)


# ---------------------------------------------------------------------------
# Tests — Status & Lifecycle
# ---------------------------------------------------------------------------


class TestPhaseBLifecycle:
    """Lifecycle enter / exit tests."""

    @pytest.mark.asyncio
    async def test_initial_status_is_inactive(self, phase_b: PhaseB) -> None:
        assert phase_b.status == PhaseBStatus.INACTIVE

    @pytest.mark.asyncio
    async def test_enter_sets_active(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        assert phase_b.status == PhaseBStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_enter_records_timestamp(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        assert phase_b.entered_at is not None
        # Should be a valid ISO string
        datetime.fromisoformat(phase_b.entered_at)

    @pytest.mark.asyncio
    async def test_enter_twice_raises(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        with pytest.raises(RuntimeError, match="already active"):
            await phase_b.enter()

    @pytest.mark.asyncio
    async def test_exit_returns_report(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        report = await phase_b.exit()
        assert isinstance(report, TransitionReport)
        assert phase_b.status == PhaseBStatus.INACTIVE

    @pytest.mark.asyncio
    async def test_exit_records_timestamp(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        await phase_b.exit()
        assert phase_b.exited_at is not None
        datetime.fromisoformat(phase_b.exited_at)

    @pytest.mark.asyncio
    async def test_exit_when_inactive_raises(self, phase_b: PhaseB) -> None:
        with pytest.raises(RuntimeError, match="not active"):
            await phase_b.exit()


# ---------------------------------------------------------------------------
# Tests — Flag verification
# ---------------------------------------------------------------------------


class TestFlagVerification:
    """Ensure Phase B requires claim flag = dual."""

    @pytest.mark.asyncio
    async def test_enter_with_filesystem_claim_flag_raises(
        self,
        tmp_path: Path,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        fp = tmp_path / "config" / "flags.yaml"
        _write_flags_yaml(fp, claim_mode="filesystem")
        config = PhaseBConfig(flags_config_path=fp)
        pb = PhaseB(config, sdk_adapter, fs_adapter)
        with pytest.raises(ValueError, match="dual"):
            await pb.enter()

    @pytest.mark.asyncio
    async def test_enter_with_database_claim_flag_raises(
        self,
        tmp_path: Path,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        fp = tmp_path / "config" / "flags.yaml"
        _write_flags_yaml(fp, claim_mode="database")
        config = PhaseBConfig(flags_config_path=fp)
        pb = PhaseB(config, sdk_adapter, fs_adapter)
        with pytest.raises(ValueError, match="dual"):
            await pb.enter()


# ---------------------------------------------------------------------------
# Tests — Dual-mode claim (MCP primary)
# ---------------------------------------------------------------------------


class TestDualModeClaim:
    """Tests for execute_claim with MCP primary path."""

    @pytest.mark.asyncio
    async def test_claim_via_mcp_success(
        self, phase_b: PhaseB, sdk_adapter: FakeSDKAdapter
    ) -> None:
        await phase_b.enter()
        result = await phase_b.execute_claim(
            "T-001", agent_name="Backend", machine_id="host1", operator="oak"
        )
        assert result["ticket_id"] == "T-001"
        assert len(sdk_adapter.calls) == 1
        assert sdk_adapter.calls[0]["ticket_id"] == "T-001"

    @pytest.mark.asyncio
    async def test_claim_records_mcp_in_log(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        await phase_b.execute_claim("T-002")
        log = phase_b.operation_log
        assert len(log) == 1
        assert log[0].backend == OperationBackend.MCP
        assert log[0].success is True

    @pytest.mark.asyncio
    async def test_claim_without_enter_raises(self, phase_b: PhaseB) -> None:
        with pytest.raises(RuntimeError, match="not active"):
            await phase_b.execute_claim("T-003")


# ---------------------------------------------------------------------------
# Tests — Dual-mode claim (fallback path)
# ---------------------------------------------------------------------------


class TestFallbackClaim:
    """Tests for execute_claim with fallback activation."""

    @pytest.mark.asyncio
    async def test_fallback_on_mcp_failure(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        sdk_adapter.fail = True
        await phase_b.enter()
        result = await phase_b.execute_claim("T-010")
        assert result["ticket_id"] == "T-010"
        assert result["status"] == "claimed-fs"
        assert len(fs_adapter.calls) == 1

    @pytest.mark.asyncio
    async def test_fallback_logged_as_fallback_backend(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
    ) -> None:
        sdk_adapter.fail = True
        await phase_b.enter()
        await phase_b.execute_claim("T-011")
        log = phase_b.operation_log
        assert log[0].backend == OperationBackend.FALLBACK
        assert log[0].success is True

    @pytest.mark.asyncio
    async def test_both_fail_raises_runtime_error(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        sdk_adapter.fail = True
        fs_adapter.fail = True
        await phase_b.enter()
        with pytest.raises(RuntimeError, match="Both MCP and fallback"):
            await phase_b.execute_claim("T-012")

    @pytest.mark.asyncio
    async def test_both_fail_records_failure_in_log(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        sdk_adapter.fail = True
        fs_adapter.fail = True
        await phase_b.enter()
        with pytest.raises(RuntimeError):
            await phase_b.execute_claim("T-013")
        log = phase_b.operation_log
        assert len(log) == 1
        assert log[0].success is False
        assert log[0].error != ""

    @pytest.mark.asyncio
    async def test_fallback_operations_listed(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
    ) -> None:
        sdk_adapter.fail = True
        await phase_b.enter()
        await phase_b.execute_claim("T-014")
        fb_ops = phase_b.get_fallback_operations()
        assert len(fb_ops) == 1
        assert fb_ops[0].ticket_id == "T-014"


# ---------------------------------------------------------------------------
# Tests — Transition gate / validation
# ---------------------------------------------------------------------------


class TestTransitionGate:
    """Tests for the Phase B transition gate validation."""

    @pytest.mark.asyncio
    async def test_empty_log_cannot_transition(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        report = phase_b.validate()
        assert report.can_transition is False
        assert report.total_operations == 0

    @pytest.mark.asyncio
    async def test_100_percent_mcp_can_transition(self, phase_b: PhaseB) -> None:
        """With gate_hours=0, 100% MCP should pass immediately."""
        await phase_b.enter()
        for i in range(10):
            await phase_b.execute_claim(f"T-{i:03d}")
        report = phase_b.validate()
        assert report.mcp_success_percent == 100.0
        assert report.can_transition is True

    @pytest.mark.asyncio
    async def test_below_threshold_cannot_transition(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
    ) -> None:
        await phase_b.enter()
        # 5 MCP successes
        for i in range(5):
            await phase_b.execute_claim(f"T-{i:03d}")
        # 5 fallback (= MCP failures)
        sdk_adapter.fail = True
        for i in range(5, 10):
            await phase_b.execute_claim(f"T-{i:03d}")
        report = phase_b.validate()
        assert report.mcp_success_percent == 50.0
        assert report.can_transition is False

    @pytest.mark.asyncio
    async def test_exactly_at_threshold(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
    ) -> None:
        """95% exactly should pass with gate_hours=0."""
        await phase_b.enter()
        # 19 MCP successes
        for i in range(19):
            await phase_b.execute_claim(f"T-{i:03d}")
        # 1 fallback
        sdk_adapter.fail = True
        await phase_b.execute_claim("T-019")
        report = phase_b.validate()
        assert report.mcp_success_percent == 95.0
        assert report.can_transition is True

    @pytest.mark.asyncio
    async def test_gate_hours_blocks_transition(
        self,
        flags_path: Path,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        """Non-zero gate_hours prevents immediate transition."""
        config = PhaseBConfig(
            flags_config_path=flags_path,
            transition_gate_mcp_percent=95.0,
            transition_gate_hours=48.0,
        )
        pb = PhaseB(config, sdk_adapter, fs_adapter)
        await pb.enter()
        for i in range(10):
            await pb.execute_claim(f"T-{i:03d}")
        report = pb.validate()
        assert report.mcp_success_percent == 100.0
        assert report.can_transition is False
        assert report.gate_met_hours < 48.0

    @pytest.mark.asyncio
    async def test_validated_at_is_set(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        report = phase_b.validate()
        assert report.validated_at != ""
        datetime.fromisoformat(report.validated_at)

    @pytest.mark.asyncio
    async def test_gate_resets_when_below_threshold(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
    ) -> None:
        await phase_b.enter()
        # Establish gate
        for i in range(10):
            await phase_b.execute_claim(f"T-{i:03d}")
        report1 = phase_b.validate()
        assert report1.gate_met_since is not None

        # Drop below threshold
        sdk_adapter.fail = True
        for i in range(10, 21):
            await phase_b.execute_claim(f"T-{i:03d}")
        report2 = phase_b.validate()
        assert report2.gate_met_since is None
        assert report2.gate_met_hours == 0.0


# ---------------------------------------------------------------------------
# Tests — Operation log & metrics
# ---------------------------------------------------------------------------


class TestOperationMetrics:
    """Tests for operation logging and success ratio metrics."""

    @pytest.mark.asyncio
    async def test_success_ratio_all_mcp(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        for i in range(5):
            await phase_b.execute_claim(f"T-{i:03d}")
        ratio = phase_b.get_success_ratio()
        assert ratio["total"] == 5
        assert ratio["mcp_successes"] == 5
        assert ratio["fallback_successes"] == 0
        assert ratio["failures"] == 0
        assert ratio["mcp_percent"] == 100.0

    @pytest.mark.asyncio
    async def test_success_ratio_mixed(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
    ) -> None:
        await phase_b.enter()
        await phase_b.execute_claim("T-001")
        sdk_adapter.fail = True
        await phase_b.execute_claim("T-002")
        ratio = phase_b.get_success_ratio()
        assert ratio["total"] == 2
        assert ratio["mcp_successes"] == 1
        assert ratio["fallback_successes"] == 1
        assert ratio["mcp_percent"] == 50.0

    @pytest.mark.asyncio
    async def test_success_ratio_empty(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        ratio = phase_b.get_success_ratio()
        assert ratio["total"] == 0
        assert ratio["mcp_percent"] == 0.0

    @pytest.mark.asyncio
    async def test_operation_log_order(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        await phase_b.execute_claim("T-A")
        await phase_b.execute_claim("T-B")
        log = phase_b.operation_log
        assert len(log) == 2
        assert log[0].ticket_id == "T-A"
        assert log[1].ticket_id == "T-B"

    @pytest.mark.asyncio
    async def test_operation_log_max_size(
        self,
        flags_path: Path,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        config = PhaseBConfig(
            flags_config_path=flags_path,
            max_operation_log_size=5,
        )
        pb = PhaseB(config, sdk_adapter, fs_adapter)
        await pb.enter()
        for i in range(10):
            await pb.execute_claim(f"T-{i:03d}")
        assert len(pb.operation_log) == 5


# ---------------------------------------------------------------------------
# Tests — Data classes
# ---------------------------------------------------------------------------


class TestDataClasses:
    """Tests for OperationRecord and TransitionReport data classes."""

    def test_operation_record_fields(self) -> None:
        rec = OperationRecord(
            operation="claim",
            ticket_id="T-001",
            backend=OperationBackend.MCP,
            success=True,
            timestamp="2026-03-11T00:00:00+00:00",
        )
        assert rec.operation == "claim"
        assert rec.ticket_id == "T-001"
        assert rec.backend == OperationBackend.MCP
        assert rec.success is True
        assert rec.error == ""

    def test_operation_record_with_error(self) -> None:
        rec = OperationRecord(
            operation="claim",
            ticket_id="T-002",
            backend=OperationBackend.FALLBACK,
            success=False,
            timestamp="2026-03-11T00:00:00+00:00",
            error="connection refused",
        )
        assert rec.error == "connection refused"

    def test_transition_report_defaults(self) -> None:
        report = TransitionReport()
        assert report.total_operations == 0
        assert report.can_transition is False
        assert report.gate_met_since is None

    def test_phase_b_status_values(self) -> None:
        assert PhaseBStatus.INACTIVE == "inactive"
        assert PhaseBStatus.ACTIVE == "active"
        assert PhaseBStatus.TRANSITIONING == "transitioning"

    def test_operation_backend_values(self) -> None:
        assert OperationBackend.MCP == "mcp"
        assert OperationBackend.FALLBACK == "fallback"


# ---------------------------------------------------------------------------
# Tests — PhaseBConfig defaults
# ---------------------------------------------------------------------------


class TestPhaseBConfig:
    """Tests for config defaults and frozen dataclass."""

    def test_defaults(self, flags_path: Path) -> None:
        config = PhaseBConfig(flags_config_path=flags_path)
        assert config.transition_gate_mcp_percent == 95.0
        assert config.transition_gate_hours == 48.0
        assert config.max_operation_log_size == 10_000

    def test_frozen(self, flags_path: Path) -> None:
        config = PhaseBConfig(flags_config_path=flags_path)
        with pytest.raises(AttributeError):
            config.transition_gate_hours = 0.0  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Tests — Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Edge case and boundary tests."""

    @pytest.mark.asyncio
    async def test_exit_clears_status_to_inactive(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        await phase_b.exit()
        assert phase_b.status == PhaseBStatus.INACTIVE

    @pytest.mark.asyncio
    async def test_reenter_after_exit(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        await phase_b.exit()
        await phase_b.enter()
        assert phase_b.status == PhaseBStatus.ACTIVE
        assert len(phase_b.operation_log) == 0  # cleared on re-entry

    @pytest.mark.asyncio
    async def test_fallback_returns_different_status(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
    ) -> None:
        sdk_adapter.fail = True
        await phase_b.enter()
        result = await phase_b.execute_claim("T-100")
        assert result["status"] == "claimed-fs"

    @pytest.mark.asyncio
    async def test_mcp_returns_claimed_status(self, phase_b: PhaseB) -> None:
        await phase_b.enter()
        result = await phase_b.execute_claim("T-101")
        assert result["status"] == "claimed"

    @pytest.mark.asyncio
    async def test_sdk_adapter_receives_kwargs(
        self, phase_b: PhaseB, sdk_adapter: FakeSDKAdapter
    ) -> None:
        await phase_b.enter()
        await phase_b.execute_claim(
            "T-200", agent_name="QA", machine_id="m1", operator="human"
        )
        call = sdk_adapter.calls[0]
        assert call["agent_name"] == "QA"
        assert call["machine_id"] == "m1"
        assert call["operator"] == "human"

    @pytest.mark.asyncio
    async def test_fs_adapter_receives_kwargs_on_fallback(
        self,
        phase_b: PhaseB,
        sdk_adapter: FakeSDKAdapter,
        fs_adapter: FakeFilesystemAdapter,
    ) -> None:
        sdk_adapter.fail = True
        await phase_b.enter()
        await phase_b.execute_claim(
            "T-201", agent_name="QA", machine_id="m2", operator="human2"
        )
        call = fs_adapter.calls[0]
        assert call["agent_name"] == "QA"
        assert call["machine_id"] == "m2"
        assert call["operator"] == "human2"
