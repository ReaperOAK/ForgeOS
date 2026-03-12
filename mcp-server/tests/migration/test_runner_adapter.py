"""Tests for mcp_server.migration.runner_adapter."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

import pytest
import yaml

if TYPE_CHECKING:
    from pathlib import Path

from mcp_server.migration.runner_adapter import (
    AdaptedResult,
    MigrationPhase,
    RunnerAdapter,
    RunnerAdapterConfig,
)

# ---------------------------------------------------------------------------
# Fake adapters
# ---------------------------------------------------------------------------


class FakeSDKClient:
    """Fake MCP SDK client for claim and advance."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.claims: list[dict[str, Any]] = []
        self.advances: list[dict[str, Any]] = []

    async def claim(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("SDK claim failed")
        record = {
            "ticket_id": ticket_id,
            "agent": agent,
            "machine": machine,
            "operator": operator,
        }
        self.claims.append(record)
        return {"status": "claimed", **record}

    async def advance(
        self,
        ticket_id: str,
        agent: str,
    ) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("SDK advance failed")
        record = {"ticket_id": ticket_id, "agent": agent}
        self.advances.append(record)
        return {"status": "advanced", **record}


class FakeGitClaimer:
    """Fake git-based claim for fallback."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.claims: list[dict[str, Any]] = []

    async def claim(
        self,
        ticket_id: str,
        agent: str,
        machine: str,
        operator: str,
    ) -> dict[str, Any]:
        if self.fail:
            raise RuntimeError("Git claim failed")
        record = {
            "ticket_id": ticket_id,
            "agent": agent,
            "machine": machine,
            "operator": operator,
        }
        self.claims.append(record)
        return {"status": "claimed_git", **record}


def _write_flags_yaml(path: Path, mode: str = "filesystem") -> Path:
    flags_file = path / "migration-flags.yaml"
    valid_modes = ("filesystem", "dual", "database")
    op_mode = mode if mode in valid_modes else "filesystem"
    phase_val = mode.upper() if mode in ("a", "b", "c") else mode
    data = {
        "migration": {
            "phase": {"current": phase_val},
            "operations": {
                "sync": {"mode": op_mode},
                "claim": {"mode": op_mode},
                "advance": {"mode": op_mode},
                "rework": {"mode": op_mode},
                "release": {"mode": op_mode},
                "status": {"mode": op_mode},
                "validate": {"mode": op_mode},
            },
        }
    }
    flags_file.write_text(yaml.dump(data))
    return flags_file


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestMigrationPhaseDetection:
    """Tests for detecting migration phase from config."""

    def test_phase_a_from_string(self) -> None:
        assert MigrationPhase.from_string("A") == MigrationPhase.PHASE_A

    def test_phase_b_from_string(self) -> None:
        assert MigrationPhase.from_string("B") == MigrationPhase.PHASE_B

    def test_phase_c_from_string(self) -> None:
        assert MigrationPhase.from_string("C") == MigrationPhase.PHASE_C

    def test_unknown_defaults_to_a(self) -> None:
        assert MigrationPhase.from_string("unknown") == MigrationPhase.PHASE_A

    def test_case_insensitive(self) -> None:
        assert MigrationPhase.from_string("b") == MigrationPhase.PHASE_B


class TestRunnerAdapterPhaseA:
    """Phase A: pure git — no SDK involvement."""

    @pytest.fixture()
    def adapter(self) -> RunnerAdapter:
        config = RunnerAdapterConfig(phase=MigrationPhase.PHASE_A)
        git_claimer = FakeGitClaimer()
        return RunnerAdapter(config, git_claimer=git_claimer)

    @pytest.mark.asyncio
    async def test_claim_uses_git_only(self, adapter: RunnerAdapter) -> None:
        result = await adapter.claim("T-001", "Backend", "pop-os", "ReaperOAK")
        assert result.backend == "git"
        assert result.success is True

    @pytest.mark.asyncio
    async def test_advance_is_noop(self, adapter: RunnerAdapter) -> None:
        """Phase A advance is git-based (no SDK advance)."""
        result = await adapter.advance("T-001", "Backend")
        assert result.backend == "git"
        assert result.success is True


class TestRunnerAdapterPhaseB:
    """Phase B: SDK claim + git work + fallback to git claim."""

    @pytest.fixture()
    def sdk_client(self) -> FakeSDKClient:
        return FakeSDKClient()

    @pytest.fixture()
    def git_claimer(self) -> FakeGitClaimer:
        return FakeGitClaimer()

    @pytest.fixture()
    def adapter(
        self,
        sdk_client: FakeSDKClient,
        git_claimer: FakeGitClaimer,
    ) -> RunnerAdapter:
        config = RunnerAdapterConfig(phase=MigrationPhase.PHASE_B)
        return RunnerAdapter(config, sdk_client=sdk_client, git_claimer=git_claimer)

    @pytest.mark.asyncio
    async def test_claim_uses_sdk(
        self,
        adapter: RunnerAdapter,
        sdk_client: FakeSDKClient,
    ) -> None:
        result = await adapter.claim("T-002", "Backend", "pop-os", "ReaperOAK")
        assert result.backend == "sdk"
        assert result.success is True
        assert len(sdk_client.claims) == 1

    @pytest.mark.asyncio
    async def test_claim_falls_back_to_git(self) -> None:
        """Phase B fallback on SDK failure."""
        bad_sdk = FakeSDKClient(fail=True)
        git_claimer = FakeGitClaimer()
        config = RunnerAdapterConfig(phase=MigrationPhase.PHASE_B)
        adapter = RunnerAdapter(config, sdk_client=bad_sdk, git_claimer=git_claimer)

        result = await adapter.claim("T-003", "Backend", "pop-os", "ReaperOAK")
        assert result.backend == "git_fallback"
        assert result.success is True
        assert len(git_claimer.claims) == 1

    @pytest.mark.asyncio
    async def test_advance_uses_git(
        self,
        adapter: RunnerAdapter,
        sdk_client: FakeSDKClient,
    ) -> None:
        """Phase B advance is still git-based."""
        result = await adapter.advance("T-002", "Backend")
        assert result.backend == "git"

    @pytest.mark.asyncio
    async def test_both_fail_raises(self) -> None:
        """If SDK and git fallback both fail, error propagates."""
        bad_sdk = FakeSDKClient(fail=True)
        bad_git = FakeGitClaimer(fail=True)
        config = RunnerAdapterConfig(phase=MigrationPhase.PHASE_B)
        adapter = RunnerAdapter(config, sdk_client=bad_sdk, git_claimer=bad_git)

        with pytest.raises(RuntimeError, match="Git claim failed"):
            await adapter.claim("T-004", "Backend", "pop-os", "ReaperOAK")


class TestRunnerAdapterPhaseC:
    """Phase C: SDK claim + SDK advance, no fallback."""

    @pytest.fixture()
    def sdk_client(self) -> FakeSDKClient:
        return FakeSDKClient()

    @pytest.fixture()
    def adapter(self, sdk_client: FakeSDKClient) -> RunnerAdapter:
        config = RunnerAdapterConfig(phase=MigrationPhase.PHASE_C)
        return RunnerAdapter(config, sdk_client=sdk_client)

    @pytest.mark.asyncio
    async def test_claim_uses_sdk_no_fallback(
        self,
        adapter: RunnerAdapter,
        sdk_client: FakeSDKClient,
    ) -> None:
        result = await adapter.claim("T-005", "Backend", "pop-os", "ReaperOAK")
        assert result.backend == "sdk"
        assert result.success is True
        assert len(sdk_client.claims) == 1

    @pytest.mark.asyncio
    async def test_advance_uses_sdk(
        self,
        adapter: RunnerAdapter,
        sdk_client: FakeSDKClient,
    ) -> None:
        result = await adapter.advance("T-005", "Backend")
        assert result.backend == "sdk"
        assert result.success is True
        assert len(sdk_client.advances) == 1

    @pytest.mark.asyncio
    async def test_claim_failure_propagates(self) -> None:
        """Phase C has no fallback — errors propagate directly."""
        bad_sdk = FakeSDKClient(fail=True)
        config = RunnerAdapterConfig(phase=MigrationPhase.PHASE_C)
        adapter = RunnerAdapter(config, sdk_client=bad_sdk)

        with pytest.raises(RuntimeError, match="SDK claim failed"):
            await adapter.claim("T-006", "Backend", "pop-os", "ReaperOAK")

    @pytest.mark.asyncio
    async def test_advance_failure_propagates(self) -> None:
        bad_sdk = FakeSDKClient(fail=True)
        config = RunnerAdapterConfig(phase=MigrationPhase.PHASE_C)
        adapter = RunnerAdapter(config, sdk_client=bad_sdk)

        with pytest.raises(RuntimeError, match="SDK advance failed"):
            await adapter.advance("T-006", "Backend")


class TestAdaptedResult:
    """Tests for the result object."""

    def test_success_result(self) -> None:
        result = AdaptedResult(success=True, backend="sdk", data={"ok": True})
        assert result.success is True
        assert result.backend == "sdk"
        assert result.data == {"ok": True}

    def test_failure_result(self) -> None:
        result = AdaptedResult(success=False, backend="git", error="failed")
        assert result.success is False
        assert result.error == "failed"
