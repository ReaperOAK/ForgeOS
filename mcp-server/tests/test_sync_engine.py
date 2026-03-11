"""Tests for mcp_server.migration.sync_engine."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest

from mcp_server.migration.conflict_resolver import ConflictResolver, ConflictType
from mcp_server.migration.sync_engine import (
    DatabaseReader,
    SyncConfig,
    SyncEngine,
    SyncResult,
    SyncStats,
)
from mcp_server.migration.transformers import TransformedEvent, TransformedTicket


# ---------------------------------------------------------------------------
# Fakes
# ---------------------------------------------------------------------------


class FakeDbWriter:
    """In-memory DatabaseWriter."""

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
    """In-memory DatabaseReader."""

    def __init__(self, tickets: list[dict[str, Any]] | None = None) -> None:
        self._tickets = tickets or []

    async def list_tickets(self) -> list[dict[str, Any]]:
        return list(self._tickets)

    def set_tickets(self, tickets: list[dict[str, Any]]) -> None:
        self._tickets = tickets


class FailingDbReader:
    """DatabaseReader that always raises."""

    async def list_tickets(self) -> list[dict[str, Any]]:
        raise RuntimeError("DB unavailable")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_ticket(
    tickets_dir: Path,
    ticket_id: str,
    **overrides: Any,
) -> Path:
    data: dict[str, Any] = {
        "ticket_id": ticket_id,
        "title": f"Ticket {ticket_id}",
        "type": "backend",
        "priority": "medium",
        "stage": "READY",
        "dependencies": [],
        "file_paths": [],
        "acceptance_criteria": [],
        "tags": [],
        "rework_count": 0,
        "history": [],
    }
    data.update(overrides)
    path = tickets_dir / f"{ticket_id}.json"
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    return path


def _place_in_state_dir(state_dir: Path, stage: str, ticket_id: str) -> Path:
    stage_dir = state_dir / stage
    stage_dir.mkdir(parents=True, exist_ok=True)
    path = stage_dir / f"{ticket_id}.json"
    path.write_text(json.dumps({"ticket_id": ticket_id}), encoding="utf-8")
    return path


def _make_config(tmp_path: Path) -> SyncConfig:
    tickets_dir = tmp_path / "tickets"
    tickets_dir.mkdir()
    state_dir = tmp_path / "ticket-state"
    state_dir.mkdir()
    return SyncConfig(
        tickets_dir=tickets_dir,
        ticket_state_dir=state_dir,
        interval_seconds=0.1,
    )


def _make_db_ticket(
    ticket_id: str,
    stage: str = "READY",
    claimed_by: str | None = None,
    machine_id: str | None = None,
    operator: str | None = None,
    lease_expiry: str | None = None,
) -> dict[str, Any]:
    return {
        "ticket_id": ticket_id,
        "stage": stage,
        "claimed_by": claimed_by,
        "machine_id": machine_id,
        "operator": operator,
        "lease_expiry": lease_expiry,
        "lease_duration_minutes": 30,
        "rework_count": 0,
    }


# ---------------------------------------------------------------------------
# SyncConfig
# ---------------------------------------------------------------------------


class TestSyncConfig:
    def test_defaults(self, tmp_path: Path) -> None:
        cfg = SyncConfig(
            tickets_dir=tmp_path / "t",
            ticket_state_dir=tmp_path / "s",
        )
        assert cfg.interval_seconds == 60.0

    def test_custom_interval(self, tmp_path: Path) -> None:
        cfg = SyncConfig(
            tickets_dir=tmp_path / "t",
            ticket_state_dir=tmp_path / "s",
            interval_seconds=10.0,
        )
        assert cfg.interval_seconds == 10.0


# ---------------------------------------------------------------------------
# FS → DB sync
# ---------------------------------------------------------------------------


class TestSyncFsToDb:
    @pytest.mark.asyncio
    async def test_imports_new_ticket(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")
        _place_in_state_dir(config.ticket_state_dir, "READY", "T-001")

        writer = FakeDbWriter()
        reader = FakeDbReader()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.fs_to_db_imported == 1
        assert "T-001" in writer.tickets

    @pytest.mark.asyncio
    async def test_updates_existing_ticket(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001", priority="high")

        writer = FakeDbWriter()
        reader = FakeDbReader()
        engine = SyncEngine(config, reader, writer)

        # First import = new
        await engine.sync_once()
        assert "T-001" in writer.tickets

        # Modify and re-import = update
        _write_ticket(config.tickets_dir, "T-001", priority="critical")
        result = await engine.sync_once()
        assert result.stats.fs_to_db_updated == 1

    @pytest.mark.asyncio
    async def test_no_tickets_returns_zero_stats(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        writer = FakeDbWriter()
        reader = FakeDbReader()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.fs_to_db_imported == 0
        assert result.stats.fs_to_db_updated == 0


# ---------------------------------------------------------------------------
# DB → FS sync: stage moves
# ---------------------------------------------------------------------------


class TestSyncDbToFsStage:
    @pytest.mark.asyncio
    async def test_moves_ticket_on_stage_mismatch(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")
        _place_in_state_dir(config.ticket_state_dir, "BACKEND", "T-001")

        # DB says ticket is in QA
        reader = FakeDbReader([_make_db_ticket("T-001", stage="QA")])
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.db_to_fs_stage_moves == 1

        # File should be in QA dir, not BACKEND
        assert not (config.ticket_state_dir / "BACKEND" / "T-001.json").exists()
        assert (config.ticket_state_dir / "QA" / "T-001.json").exists()

    @pytest.mark.asyncio
    async def test_no_move_when_stages_match(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")
        _place_in_state_dir(config.ticket_state_dir, "BACKEND", "T-001")

        reader = FakeDbReader([_make_db_ticket("T-001", stage="BACKEND")])
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.db_to_fs_stage_moves == 0

    @pytest.mark.asyncio
    async def test_maps_db_enum_to_fs_dir(self, tmp_path: Path) -> None:
        """DB uses 'DOCUMENTATION', FS uses 'DOCS'."""
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")
        _place_in_state_dir(config.ticket_state_dir, "BACKEND", "T-001")

        reader = FakeDbReader([_make_db_ticket("T-001", stage="DOCUMENTATION")])
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.db_to_fs_stage_moves == 1
        assert (config.ticket_state_dir / "DOCS" / "T-001.json").exists()


# ---------------------------------------------------------------------------
# DB → FS sync: claim updates
# ---------------------------------------------------------------------------


class TestSyncDbToFsClaim:
    @pytest.mark.asyncio
    async def test_updates_claim_on_mismatch(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(
            config.tickets_dir,
            "T-001",
            claimed_by="OldAgent",
            machine_id="old-machine",
        )
        _place_in_state_dir(config.ticket_state_dir, "BACKEND", "T-001")

        reader = FakeDbReader([
            _make_db_ticket(
                "T-001",
                stage="BACKEND",
                claimed_by="NewAgent",
                machine_id="new-machine",
            ),
        ])
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.db_to_fs_claim_updates == 1

        # Verify file was updated
        updated = json.loads(
            (config.tickets_dir / "T-001.json").read_text(encoding="utf-8")
        )
        assert updated["claimed_by"] == "NewAgent"
        assert updated["machine_id"] == "new-machine"

    @pytest.mark.asyncio
    async def test_no_update_when_claims_match(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(
            config.tickets_dir,
            "T-001",
            claimed_by="Agent",
            machine_id="m1",
            operator="op1",
            lease_expiry=None,
        )
        _place_in_state_dir(config.ticket_state_dir, "BACKEND", "T-001")

        reader = FakeDbReader([
            _make_db_ticket(
                "T-001",
                stage="BACKEND",
                claimed_by="Agent",
                machine_id="m1",
                operator="op1",
                lease_expiry=None,
            ),
        ])
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.db_to_fs_claim_updates == 0


# ---------------------------------------------------------------------------
# Conflict resolution
# ---------------------------------------------------------------------------


class TestSyncConflicts:
    @pytest.mark.asyncio
    async def test_stage_conflict_recorded(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")
        _place_in_state_dir(config.ticket_state_dir, "BACKEND", "T-001")

        reader = FakeDbReader([_make_db_ticket("T-001", stage="QA")])
        writer = FakeDbWriter()
        resolver = ConflictResolver()
        engine = SyncEngine(config, reader, writer, conflict_resolver=resolver)

        result = await engine.sync_once()
        stage_conflicts = [
            c for c in result.conflicts
            if c.conflict_type == ConflictType.STAGE_MISMATCH
        ]
        assert len(stage_conflicts) == 1
        assert stage_conflicts[0].fs_value == "BACKEND"
        assert stage_conflicts[0].db_value == "QA"

    @pytest.mark.asyncio
    async def test_new_in_db_recorded(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        # No FS ticket, but DB has one
        reader = FakeDbReader([_make_db_ticket("T-DBONLY")])
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        new_db = [
            c for c in result.conflicts
            if c.conflict_type == ConflictType.NEW_IN_DB
        ]
        assert len(new_db) == 1
        assert new_db[0].db_value == "T-DBONLY"


# ---------------------------------------------------------------------------
# Error handling
# ---------------------------------------------------------------------------


class TestSyncErrorHandling:
    @pytest.mark.asyncio
    async def test_db_reader_failure_recorded(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")

        reader = FailingDbReader()
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.stats.db_to_fs_errors >= 1
        assert any("DB unavailable" in e for e in result.errors)

    @pytest.mark.asyncio
    async def test_sync_result_has_timestamps(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        reader = FakeDbReader()
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert result.started_at is not None
        assert result.finished_at is not None
        assert result.started_at <= result.finished_at


# ---------------------------------------------------------------------------
# Start / stop lifecycle
# ---------------------------------------------------------------------------


class TestSyncLifecycle:
    @pytest.mark.asyncio
    async def test_start_stop(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        reader = FakeDbReader()
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        assert not engine.is_running
        await engine.start()
        assert engine.is_running

        await engine.stop()
        assert not engine.is_running

    @pytest.mark.asyncio
    async def test_double_start_is_safe(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        reader = FakeDbReader()
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        await engine.start()
        await engine.start()  # should not raise
        assert engine.is_running

        await engine.stop()

    @pytest.mark.asyncio
    async def test_stop_when_not_running_is_safe(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        reader = FakeDbReader()
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        await engine.stop()  # should not raise
        assert not engine.is_running

    @pytest.mark.asyncio
    async def test_periodic_sync_executes(self, tmp_path: Path) -> None:
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")
        _place_in_state_dir(config.ticket_state_dir, "READY", "T-001")

        writer = FakeDbWriter()
        reader = FakeDbReader()
        engine = SyncEngine(config, reader, writer)

        await engine.start()
        # Give it time to run at least one cycle (interval is 0.1s)
        await asyncio.sleep(0.3)
        await engine.stop()

        # Should have imported the ticket at least once
        assert "T-001" in writer.tickets


# ---------------------------------------------------------------------------
# Configurable interval
# ---------------------------------------------------------------------------


class TestSyncInterval:
    def test_default_interval(self, tmp_path: Path) -> None:
        cfg = SyncConfig(
            tickets_dir=tmp_path / "t",
            ticket_state_dir=tmp_path / "s",
        )
        assert cfg.interval_seconds == 60.0

    def test_custom_interval(self, tmp_path: Path) -> None:
        cfg = SyncConfig(
            tickets_dir=tmp_path / "t",
            ticket_state_dir=tmp_path / "s",
            interval_seconds=5.0,
        )
        assert cfg.interval_seconds == 5.0


# ---------------------------------------------------------------------------
# Independent of MCP server
# ---------------------------------------------------------------------------


class TestSyncIndependence:
    @pytest.mark.asyncio
    async def test_sync_once_without_server(self, tmp_path: Path) -> None:
        """sync_once works without any MCP server running."""
        config = _make_config(tmp_path)
        _write_ticket(config.tickets_dir, "T-001")
        _place_in_state_dir(config.ticket_state_dir, "READY", "T-001")

        reader = FakeDbReader()
        writer = FakeDbWriter()
        engine = SyncEngine(config, reader, writer)

        result = await engine.sync_once()
        assert isinstance(result, SyncResult)
        assert result.stats.fs_to_db_imported == 1
