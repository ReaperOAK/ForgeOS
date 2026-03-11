"""Tests for mcp_server.migration.phases.phase_a."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
import yaml

from mcp_server.migration.conflict_resolver import ConflictResolver
from mcp_server.migration.phases.phase_a import (
    Discrepancy,
    PhaseA,
    PhaseAConfig,
    PhaseAStatus,
    ValidationReport,
)
from mcp_server.migration.sync_engine import SyncResult, SyncStats
from mcp_server.migration.transformers import TransformedEvent, TransformedTicket


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeDbWriter:
    """In-memory DatabaseWriter for tests."""

    def __init__(self) -> None:
        self.tickets: dict[str, TransformedTicket] = {}
        self.events: list[TransformedEvent] = []

    async def upsert_ticket(self, ticket: TransformedTicket) -> bool:
        is_new = ticket.ticket_id not in self.tickets
        self.tickets[ticket.ticket_id] = ticket
        return is_new

    async def insert_events(self, events: list[TransformedEvent]) -> int:
        self.events.extend(events)
        return len(events)


class FakeDbReader:
    """In-memory DatabaseReader for tests."""

    def __init__(self, tickets: list[dict[str, Any]] | None = None) -> None:
        self._tickets = tickets or []

    async def list_tickets(self) -> list[dict[str, Any]]:
        return list(self._tickets)

    def set_tickets(self, tickets: list[dict[str, Any]]) -> None:
        self._tickets = tickets


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _write_flags_yaml(path: Path, *, mode: str = "filesystem") -> None:
    """Write a migration-flags YAML with the given global mode."""
    data = {
        "global": {"mode": mode},
        "operations": {"sync": {"mode": mode}},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(yaml.dump(data), encoding="utf-8")


def _write_ticket(
    tickets_dir: Path,
    ticket_id: str,
    **overrides: Any,
) -> Path:
    """Write a ticket JSON file and return its path."""
    data: dict[str, Any] = {
        "ticket_id": ticket_id,
        "title": f"Ticket {ticket_id}",
        "type": "backend",
        "priority": "medium",
        "stage": "READY",
        "created_at": "2026-01-01T00:00:00+00:00",
        "created_by": "test",
        "dependencies": [],
        "blocked_by": [],
        "file_paths": [],
        "acceptance_criteria": [],
        "rework_count": 0,
        "history": [],
        **overrides,
    }
    tickets_dir.mkdir(parents=True, exist_ok=True)
    fp = tickets_dir / f"{ticket_id}.json"
    fp.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return fp


def _make_state_dir(ticket_state_dir: Path, stage: str, ticket_id: str) -> None:
    """Create a stage subdirectory with a ticket JSON symlink-like file."""
    stage_dir = ticket_state_dir / stage
    stage_dir.mkdir(parents=True, exist_ok=True)
    fp = stage_dir / f"{ticket_id}.json"
    fp.write_text(json.dumps({"ticket_id": ticket_id, "stage": stage}), encoding="utf-8")


@pytest.fixture()
def workspace(tmp_path: Path) -> dict[str, Path]:
    """Create a minimal workspace layout."""
    tickets_dir = tmp_path / ".github" / "tickets"
    ticket_state_dir = tmp_path / ".github" / "ticket-state"
    flags_path = tmp_path / "config" / "migration-flags.yaml"

    tickets_dir.mkdir(parents=True)
    ticket_state_dir.mkdir(parents=True)

    # Create all stage directories
    for stage in ("READY", "BACKEND", "QA", "DONE"):
        (ticket_state_dir / stage).mkdir()

    _write_flags_yaml(flags_path, mode="filesystem")

    return {
        "root": tmp_path,
        "tickets_dir": tickets_dir,
        "ticket_state_dir": ticket_state_dir,
        "flags_path": flags_path,
    }


@pytest.fixture()
def phase_a_config(workspace: dict[str, Path]) -> PhaseAConfig:
    return PhaseAConfig(
        tickets_dir=workspace["tickets_dir"],
        ticket_state_dir=workspace["ticket_state_dir"],
        flags_config_path=workspace["flags_path"],
        sync_interval_seconds=0.1,
        transition_gate_hours=0.0,  # immediate for tests
    )


# ---------------------------------------------------------------------------
# Tests — Status & Lifecycle
# ---------------------------------------------------------------------------


class TestPhaseALifecycle:
    """Phase A enter / exit lifecycle."""

    @pytest.mark.asyncio()
    async def test_initial_status_is_inactive(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        assert phase.status == PhaseAStatus.INACTIVE

    @pytest.mark.asyncio()
    async def test_enter_activates_phase(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        assert phase.status == PhaseAStatus.ACTIVE
        assert phase.entered_at is not None
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_enter_twice_raises(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        with pytest.raises(RuntimeError, match="already active"):
            await phase.enter()
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_exit_returns_report_and_deactivates(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        report = await phase.exit()
        assert isinstance(report, ValidationReport)
        assert phase.status == PhaseAStatus.INACTIVE
        assert phase.exited_at is not None

    @pytest.mark.asyncio()
    async def test_exit_when_inactive_raises(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        with pytest.raises(RuntimeError, match="not active"):
            await phase.exit()

    @pytest.mark.asyncio()
    async def test_entry_and_exit_logged(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        entered = phase.entered_at
        report = await phase.exit()
        exited = phase.exited_at
        assert entered is not None
        assert exited is not None
        assert report.validated_at != ""


# ---------------------------------------------------------------------------
# Tests — Feature Flag Verification
# ---------------------------------------------------------------------------


class TestPhaseAFlagVerification:
    """Phase A requires all flags in filesystem mode."""

    @pytest.mark.asyncio()
    async def test_non_filesystem_flag_blocks_entry(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_flags_yaml(workspace["flags_path"], mode="database")
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        with pytest.raises(ValueError, match="filesystem"):
            await phase.enter()

    @pytest.mark.asyncio()
    async def test_dual_mode_flag_blocks_entry(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_flags_yaml(workspace["flags_path"], mode="dual")
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        with pytest.raises(ValueError, match="filesystem"):
            await phase.enter()

    @pytest.mark.asyncio()
    async def test_filesystem_flags_allow_entry(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        assert phase.status == PhaseAStatus.ACTIVE
        await phase.exit()


# ---------------------------------------------------------------------------
# Tests — Validation
# ---------------------------------------------------------------------------


class TestPhaseAValidation:
    """Validation compares DB state against FS truth."""

    @pytest.mark.asyncio()
    async def test_empty_workspace_reports_zero_discrepancies(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert report.discrepancies == []
        assert report.fs_ticket_count == 0
        assert report.db_ticket_count == 0
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_matching_state_reports_no_discrepancies(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_ticket(workspace["tickets_dir"], "T-001", stage="READY")
        db_reader = FakeDbReader(
            [{"ticket_id": "T-001", "stage": "READY"}]
        )
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert report.discrepancies == []
        assert report.fs_ticket_count == 1
        assert report.db_ticket_count == 1
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_stage_mismatch_reported(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_ticket(workspace["tickets_dir"], "T-002", stage="READY")
        db_reader = FakeDbReader(
            [{"ticket_id": "T-002", "stage": "BACKEND"}]
        )
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert len(report.discrepancies) == 1
        assert report.discrepancies[0].field == "stage"
        assert report.discrepancies[0].fs_value == "READY"
        assert report.discrepancies[0].db_value == "BACKEND"
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_missing_in_db_reported(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_ticket(workspace["tickets_dir"], "T-003")
        db_reader = FakeDbReader([])
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert len(report.discrepancies) == 1
        assert report.discrepancies[0].field == "existence"
        assert report.discrepancies[0].db_value == "missing"
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_missing_in_fs_reported(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        db_reader = FakeDbReader(
            [{"ticket_id": "T-GHOST", "stage": "READY"}]
        )
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert len(report.discrepancies) == 1
        assert report.discrepancies[0].ticket_id == "T-GHOST"
        assert report.discrepancies[0].fs_value == "missing"
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_claim_metadata_mismatch_reported(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_ticket(
            workspace["tickets_dir"],
            "T-004",
            stage="BACKEND",
            claimed_by="AgentA",
            machine_id="m1",
            operator="op1",
        )
        db_reader = FakeDbReader(
            [
                {
                    "ticket_id": "T-004",
                    "stage": "BACKEND",
                    "claimed_by": "AgentB",
                    "machine_id": "m1",
                    "operator": "op1",
                }
            ]
        )
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        claim_discs = [d for d in report.discrepancies if d.field == "claimed_by"]
        assert len(claim_discs) == 1
        assert claim_discs[0].fs_value == "AgentA"
        assert claim_discs[0].db_value == "AgentB"
        await phase.exit()


# ---------------------------------------------------------------------------
# Tests — Transition Gate
# ---------------------------------------------------------------------------


class TestPhaseATransitionGate:
    """Transition gate: zero discrepancies for N hours."""

    @pytest.mark.asyncio()
    async def test_can_transition_when_gate_met(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        """With transition_gate_hours=0, first zero-discrepancy check passes."""
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert report.can_transition is True
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_cannot_transition_with_discrepancies(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_ticket(workspace["tickets_dir"], "T-005", stage="READY")
        db_reader = FakeDbReader(
            [{"ticket_id": "T-005", "stage": "QA"}]
        )
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert report.can_transition is False
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_cannot_transition_insufficient_hours(
        self, workspace: dict[str, Path]
    ) -> None:
        """24-hour gate prevents immediate transition."""
        config = PhaseAConfig(
            tickets_dir=workspace["tickets_dir"],
            ticket_state_dir=workspace["ticket_state_dir"],
            flags_config_path=workspace["flags_path"],
            sync_interval_seconds=0.1,
            transition_gate_hours=24.0,
        )
        phase = PhaseA(config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        # Zero discrepancies but not enough hours elapsed
        assert report.discrepancies == []
        assert report.can_transition is False
        assert report.zero_discrepancy_hours < 24.0
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_discrepancy_resets_zero_window(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        db_reader = FakeDbReader()
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()

        # First validation — zero discrepancies
        report1 = await phase.validate()
        assert report1.zero_discrepancy_since is not None

        # Introduce a discrepancy
        _write_ticket(workspace["tickets_dir"], "T-006", stage="READY")
        db_reader.set_tickets([{"ticket_id": "T-006", "stage": "QA"}])
        report2 = await phase.validate()
        assert report2.zero_discrepancy_since is None

        await phase.exit()


# ---------------------------------------------------------------------------
# Tests — Sync Cycle
# ---------------------------------------------------------------------------


class TestPhaseASyncCycle:
    """Manual sync cycle triggering."""

    @pytest.mark.asyncio()
    async def test_sync_cycle_returns_result(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_ticket(workspace["tickets_dir"], "T-010")
        _make_state_dir(workspace["ticket_state_dir"], "READY", "T-010")

        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        result = await phase.run_sync_cycle()
        assert isinstance(result, SyncResult)
        assert phase.sync_results
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_sync_cycle_without_enter_raises(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        with pytest.raises(RuntimeError, match="enter"):
            await phase.run_sync_cycle()

    @pytest.mark.asyncio()
    async def test_phase_a_runs_indefinitely_without_interference(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        """Multiple sync cycles complete without errors."""
        _write_ticket(workspace["tickets_dir"], "T-011")
        _make_state_dir(workspace["ticket_state_dir"], "READY", "T-011")

        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()

        for _ in range(3):
            result = await phase.run_sync_cycle()
            assert isinstance(result, SyncResult)

        assert len(phase.sync_results) == 3
        await phase.exit()


# ---------------------------------------------------------------------------
# Tests — Edge Cases
# ---------------------------------------------------------------------------


class TestPhaseAEdgeCases:
    """Edge cases and error handling."""

    @pytest.mark.asyncio()
    async def test_empty_tickets_dir(
        self, phase_a_config: PhaseAConfig
    ) -> None:
        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        assert report.fs_ticket_count == 0
        assert report.db_ticket_count == 0
        assert report.can_transition is True
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_malformed_ticket_json_skipped(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        bad_file = workspace["tickets_dir"] / "BAD.json"
        bad_file.write_text("{invalid json", encoding="utf-8")

        phase = PhaseA(phase_a_config, FakeDbReader(), FakeDbWriter())
        await phase.enter()
        report = await phase.validate()
        # Bad file is silently skipped
        assert report.fs_ticket_count == 0
        await phase.exit()

    @pytest.mark.asyncio()
    async def test_exit_report_includes_validation(
        self, workspace: dict[str, Path], phase_a_config: PhaseAConfig
    ) -> None:
        _write_ticket(workspace["tickets_dir"], "T-020", stage="READY")
        db_reader = FakeDbReader(
            [{"ticket_id": "T-020", "stage": "READY"}]
        )
        phase = PhaseA(phase_a_config, db_reader, FakeDbWriter())
        await phase.enter()
        report = await phase.exit()
        assert report.validated_at != ""
        assert report.fs_ticket_count == 1
