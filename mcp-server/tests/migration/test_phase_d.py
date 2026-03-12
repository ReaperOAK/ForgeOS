"""Tests for mcp_server.migration.phases.phase_d."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import TYPE_CHECKING

import pytest
import yaml

if TYPE_CHECKING:
    from pathlib import Path

from mcp_server.migration.phases.phase_d import (
    FilesystemDeprecationInterceptor,
    MigrationReport,
    PhaseD,
    PhaseDConfig,
    PhaseDStatus,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_flags_yaml(path: Path, *, mode: str = "database") -> None:
    """Write a migration-flags YAML with all flags set to given mode."""
    data = {
        "global": {"mode": mode},
        "operations": {
            op: {"mode": mode}
            for op in (
                "sync",
                "claim",
                "advance",
                "release",
                "rework",
                "status",
                "validate",
            )
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
def phase_d_config(flags_path: Path) -> PhaseDConfig:
    started = (datetime.now(timezone.utc) - timedelta(hours=720)).isoformat()
    return PhaseDConfig(
        flags_config_path=flags_path,
        migration_started_at=started,
        total_operations=10_000,
        total_errors=50,
    )


@pytest.fixture()
def phase_d(phase_d_config: PhaseDConfig) -> PhaseD:
    return PhaseD(phase_d_config)


# ---------------------------------------------------------------------------
# Tests — Status & Lifecycle
# ---------------------------------------------------------------------------


class TestPhaseDLifecycle:
    """Lifecycle enter / exit tests."""

    @pytest.mark.asyncio
    async def test_initial_status_is_inactive(self, phase_d: PhaseD) -> None:
        assert phase_d.status == PhaseDStatus.INACTIVE

    @pytest.mark.asyncio
    async def test_enter_sets_active(self, phase_d: PhaseD) -> None:
        await phase_d.enter()
        assert phase_d.status == PhaseDStatus.ACTIVE

    @pytest.mark.asyncio
    async def test_enter_records_timestamp(self, phase_d: PhaseD) -> None:
        await phase_d.enter()
        assert phase_d.entered_at is not None
        datetime.fromisoformat(phase_d.entered_at)

    @pytest.mark.asyncio
    async def test_enter_returns_migration_report(
        self, phase_d: PhaseD
    ) -> None:
        report = await phase_d.enter()
        assert isinstance(report, MigrationReport)
        assert report.total_operations == 10_000
        assert report.total_errors == 50

    @pytest.mark.asyncio
    async def test_enter_twice_raises(self, phase_d: PhaseD) -> None:
        await phase_d.enter()
        with pytest.raises(RuntimeError, match="already active"):
            await phase_d.enter()

    @pytest.mark.asyncio
    async def test_exit_returns_report(self, phase_d: PhaseD) -> None:
        await phase_d.enter()
        report = await phase_d.exit()
        assert isinstance(report, MigrationReport)
        assert phase_d.status == PhaseDStatus.INACTIVE

    @pytest.mark.asyncio
    async def test_exit_records_timestamp(self, phase_d: PhaseD) -> None:
        await phase_d.enter()
        await phase_d.exit()
        assert phase_d.exited_at is not None
        datetime.fromisoformat(phase_d.exited_at)

    @pytest.mark.asyncio
    async def test_exit_when_inactive_raises(self, phase_d: PhaseD) -> None:
        with pytest.raises(RuntimeError, match="not active"):
            await phase_d.exit()


# ---------------------------------------------------------------------------
# Tests — AC1: Sync engine and dual-mode wrapper deactivated
# ---------------------------------------------------------------------------


class TestSyncDualModeDeactivation:
    """AC1: Phase D deactivates sync engine and dual-mode wrapper."""

    @pytest.mark.asyncio
    async def test_sync_engine_disabled_on_enter(
        self, phase_d: PhaseD
    ) -> None:
        await phase_d.enter()
        assert phase_d.sync_engine_disabled is True

    @pytest.mark.asyncio
    async def test_dual_mode_disabled_on_enter(
        self, phase_d: PhaseD
    ) -> None:
        await phase_d.enter()
        assert phase_d.dual_mode_disabled is True

    @pytest.mark.asyncio
    async def test_sync_engine_disabled_before_enter(
        self, phase_d: PhaseD
    ) -> None:
        assert phase_d.sync_engine_disabled is False

    @pytest.mark.asyncio
    async def test_dual_mode_disabled_before_enter(
        self, phase_d: PhaseD
    ) -> None:
        assert phase_d.dual_mode_disabled is False


# ---------------------------------------------------------------------------
# Tests — AC3: Feature flag collapse
# ---------------------------------------------------------------------------


class TestFeatureFlagCollapse:
    """AC3: Feature flag system reduced to migration_complete=true."""

    @pytest.mark.asyncio
    async def test_migration_complete_flag_set(
        self, phase_d: PhaseD
    ) -> None:
        await phase_d.enter()
        assert phase_d.migration_complete_flag is True

    @pytest.mark.asyncio
    async def test_migration_complete_flag_not_set_before_enter(
        self, phase_d: PhaseD
    ) -> None:
        assert phase_d.migration_complete_flag is False

    @pytest.mark.asyncio
    async def test_report_reflects_migration_complete_flag(
        self, phase_d: PhaseD
    ) -> None:
        report = await phase_d.enter()
        assert report.migration_complete_flag is True


# ---------------------------------------------------------------------------
# Tests — AC4: SDK filesystem fallback disabled
# ---------------------------------------------------------------------------


class TestFilesystemFallbackDisabled:
    """AC4: SDK filesystem fallback code path disabled."""

    @pytest.mark.asyncio
    async def test_filesystem_fallback_disabled_on_enter(
        self, phase_d: PhaseD
    ) -> None:
        await phase_d.enter()
        assert phase_d.filesystem_fallback_disabled is True

    @pytest.mark.asyncio
    async def test_filesystem_fallback_disabled_before_enter(
        self, phase_d: PhaseD
    ) -> None:
        assert phase_d.filesystem_fallback_disabled is False

    @pytest.mark.asyncio
    async def test_report_reflects_fallback_disabled(
        self, phase_d: PhaseD
    ) -> None:
        report = await phase_d.enter()
        assert report.filesystem_fallback_disabled is True


# ---------------------------------------------------------------------------
# Tests — AC5: Database exclusive operations (no filesystem references)
# ---------------------------------------------------------------------------


class TestDatabaseExclusive:
    """AC5: All operations use database exclusively."""

    @pytest.mark.asyncio
    async def test_report_shows_all_components_disabled(
        self, phase_d: PhaseD
    ) -> None:
        """After enter, sync engine, dual-mode, and fallback are all off."""
        report = await phase_d.enter()
        assert report.sync_engine_disabled is True
        assert report.dual_mode_disabled is True
        assert report.filesystem_fallback_disabled is True
        assert report.migration_complete_flag is True


# ---------------------------------------------------------------------------
# Tests — AC6: Deprecation warning logged
# ---------------------------------------------------------------------------


class TestDeprecationWarning:
    """AC6: Deprecation warning emitted for filesystem ticket ops."""

    @pytest.mark.asyncio
    async def test_deprecation_warning_logged(
        self, phase_d: PhaseD
    ) -> None:
        await phase_d.enter()
        phase_d.log_filesystem_deprecation("claim", "T-001")
        assert phase_d.deprecation_interceptor.warning_count == 1

    @pytest.mark.asyncio
    async def test_deprecation_warning_increments(
        self, phase_d: PhaseD
    ) -> None:
        await phase_d.enter()
        phase_d.log_filesystem_deprecation("claim", "T-001")
        phase_d.log_filesystem_deprecation("advance", "T-002")
        phase_d.log_filesystem_deprecation("sync")
        assert phase_d.deprecation_interceptor.warning_count == 3

    @pytest.mark.asyncio
    async def test_deprecation_warning_when_inactive_raises(
        self, phase_d: PhaseD
    ) -> None:
        with pytest.raises(RuntimeError, match="not active"):
            phase_d.log_filesystem_deprecation("claim", "T-001")

    def test_interceptor_standalone(self) -> None:
        interceptor = FilesystemDeprecationInterceptor()
        interceptor.intercept("claim", "T-001")
        assert interceptor.warning_count == 1


# ---------------------------------------------------------------------------
# Tests — AC7: Final migration statistics
# ---------------------------------------------------------------------------


class TestMigrationStatistics:
    """AC7: Phase D entry logs final migration statistics."""

    @pytest.mark.asyncio
    async def test_report_total_operations(self, phase_d: PhaseD) -> None:
        report = await phase_d.enter()
        assert report.total_operations == 10_000

    @pytest.mark.asyncio
    async def test_report_total_errors(self, phase_d: PhaseD) -> None:
        report = await phase_d.enter()
        assert report.total_errors == 50

    @pytest.mark.asyncio
    async def test_report_error_rate(self, phase_d: PhaseD) -> None:
        report = await phase_d.enter()
        assert report.error_rate == 0.5

    @pytest.mark.asyncio
    async def test_report_migration_duration(self, phase_d: PhaseD) -> None:
        report = await phase_d.enter()
        assert report.migration_duration_hours > 0

    @pytest.mark.asyncio
    async def test_report_migration_started_at(
        self, phase_d: PhaseD, phase_d_config: PhaseDConfig
    ) -> None:
        report = await phase_d.enter()
        assert report.migration_started_at == phase_d_config.migration_started_at

    @pytest.mark.asyncio
    async def test_report_migration_completed_at(
        self, phase_d: PhaseD
    ) -> None:
        report = await phase_d.enter()
        assert report.migration_completed_at != ""
        datetime.fromisoformat(report.migration_completed_at)

    @pytest.mark.asyncio
    async def test_report_validated_at(self, phase_d: PhaseD) -> None:
        report = await phase_d.enter()
        assert report.validated_at != ""
        datetime.fromisoformat(report.validated_at)

    @pytest.mark.asyncio
    async def test_zero_operations_yields_zero_error_rate(
        self, flags_path: Path
    ) -> None:
        config = PhaseDConfig(
            flags_config_path=flags_path,
            total_operations=0,
            total_errors=0,
        )
        pd = PhaseD(config)
        report = await pd.enter()
        assert report.error_rate == 0.0

    @pytest.mark.asyncio
    async def test_report_without_migration_start(
        self, flags_path: Path
    ) -> None:
        config = PhaseDConfig(
            flags_config_path=flags_path,
            total_operations=100,
            total_errors=5,
        )
        pd = PhaseD(config)
        report = await pd.enter()
        assert report.migration_duration_hours == 0.0

    @pytest.mark.asyncio
    async def test_get_migration_report_standalone(
        self, phase_d: PhaseD
    ) -> None:
        """get_migration_report works even before enter (pre-report)."""
        report = phase_d.get_migration_report()
        assert report.sync_engine_disabled is False


# ---------------------------------------------------------------------------
# Tests — Flag verification
# ---------------------------------------------------------------------------


class TestFlagVerification:
    """Ensure Phase D requires all flags = database."""

    @pytest.mark.asyncio
    async def test_enter_with_filesystem_flag_raises(
        self, tmp_path: Path
    ) -> None:
        fp = tmp_path / "config" / "flags.yaml"
        _write_flags_yaml(fp, mode="filesystem")
        config = PhaseDConfig(flags_config_path=fp)
        pd = PhaseD(config)
        with pytest.raises(ValueError, match="database"):
            await pd.enter()

    @pytest.mark.asyncio
    async def test_enter_with_dual_flag_raises(
        self, tmp_path: Path
    ) -> None:
        fp = tmp_path / "config" / "flags.yaml"
        _write_flags_yaml(fp, mode="dual")
        config = PhaseDConfig(flags_config_path=fp)
        pd = PhaseD(config)
        with pytest.raises(ValueError, match="database"):
            await pd.enter()


# ---------------------------------------------------------------------------
# Tests — Custom interceptor injection
# ---------------------------------------------------------------------------


class TestCustomInterceptor:
    """Custom deprecation interceptor injection."""

    @pytest.mark.asyncio
    async def test_custom_interceptor_used(
        self, phase_d_config: PhaseDConfig
    ) -> None:
        interceptor = FilesystemDeprecationInterceptor()
        pd = PhaseD(phase_d_config, deprecation_interceptor=interceptor)
        await pd.enter()
        pd.log_filesystem_deprecation("sync", "T-100")
        assert interceptor.warning_count == 1
        assert pd.deprecation_interceptor is interceptor
