"""Tests for mcp_server.migration.exporter."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from mcp_server.migration.exporter import (
    ExportConfig,
    ExportDatabaseReader,
    ExportResult,
    ExportStats,
    TicketExporter,
)

if TYPE_CHECKING:
    from pathlib import Path


# ---------------------------------------------------------------------------
# Fake database readers
# ---------------------------------------------------------------------------


class FakeReader:
    """In-memory ExportDatabaseReader for testing."""

    def __init__(self, tickets: list[dict[str, Any]] | None = None) -> None:
        self.tickets: list[dict[str, Any]] = tickets or []

    async def read_all_tickets(self) -> list[dict[str, Any]]:
        return list(self.tickets)


class FailingReader:
    """Reader that raises on every call."""

    async def read_all_tickets(self) -> list[dict[str, Any]]:
        raise RuntimeError("DB connection failed")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_db_ticket(
    ticket_id: str = "T-001",
    **overrides: Any,
) -> dict[str, Any]:
    """Create a minimal DB-format ticket dict."""
    data: dict[str, Any] = {
        "ticket_id": ticket_id,
        "title": f"Ticket {ticket_id}",
        "description": f"Description for {ticket_id}",
        "ticket_type": "backend",
        "priority": "medium",
        "stage": "READY",
        "sdlc_flow": ["READY", "BACKEND", "QA", "DONE"],
        "depends_on": [],
        "file_paths": ["src/example.py"],
        "acceptance_criteria": ["Criterion 1"],
        "tags": ["backend"],
        "rework_count": 0,
        "claimed_by": None,
        "machine_id": None,
        "operator": None,
        "lease_expiry": None,
        "lease_duration_minutes": 30,
        "created_at": "2026-01-01T00:00:00+00:00",
        "history": [],
        "source_task_file": None,
        "metadata": {},
    }
    data.update(overrides)
    return data


def _write_existing_ticket(
    tickets_dir: Path,
    ticket_id: str,
) -> Path:
    """Write a pre-existing ticket JSON on the filesystem."""
    data = {"ticket_id": ticket_id, "title": "Old", "type": "backend"}
    path = tickets_dir / f"{ticket_id}.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _place_existing_state(
    state_dir: Path,
    stage: str,
    ticket_id: str,
) -> Path:
    """Create a pre-existing state-directory entry."""
    sub = state_dir / stage
    sub.mkdir(parents=True, exist_ok=True)
    path = sub / f"{ticket_id}.json"
    path.write_text("{}", encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# ExportConfig
# ---------------------------------------------------------------------------


class TestExportConfig:
    def test_defaults(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        assert cfg.dry_run is False
        assert cfg.backup_dir is None

    def test_frozen(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path,
            ticket_state_dir=tmp_path,
        )
        with pytest.raises(AttributeError):
            cfg.dry_run = True  # type: ignore[misc]


# ---------------------------------------------------------------------------
# ExportStats / ExportResult
# ---------------------------------------------------------------------------


class TestExportResult:
    def test_summary_format(self) -> None:
        stats = ExportStats(
            total_read=10,
            exported=8,
            backed_up=5,
            errors=2,
            active_claims=3,
            stage_distribution={"READY": 4, "BACKEND": 4},
        )
        result = ExportResult(
            stats=stats,
            dry_run=False,
            errors=["err1", "err2"],
        )
        summary = result.summary()
        assert "EXPORT Summary" in summary
        assert "10" in summary
        assert "8" in summary
        assert "err1" in summary
        assert "READY: 4" in summary
        assert "BACKEND: 4" in summary

    def test_dry_run_summary(self) -> None:
        stats = ExportStats(total_read=5, exported=5)
        result = ExportResult(stats=stats, dry_run=True)
        assert "DRY RUN" in result.summary()

    def test_warnings_in_summary(self) -> None:
        stats = ExportStats(total_read=1, exported=1)
        result = ExportResult(
            stats=stats,
            dry_run=False,
            warnings=["some warning"],
        )
        assert "some warning" in result.summary()


# ---------------------------------------------------------------------------
# _to_filesystem_json
# ---------------------------------------------------------------------------


class TestToFilesystemJson:
    def test_basic_conversion(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket(stage="BACKEND")
        result = exporter._to_filesystem_json(db_ticket)
        assert result["ticket_id"] == "T-001"
        assert result["stage"] == "BACKEND"
        assert result["type"] == "backend"
        assert result["dependencies"] == []
        assert result["tags"] == ["backend"]

    def test_stage_mapping_docs(self, tmp_path: Path) -> None:
        """DB DOCUMENTATION stage maps to FS DOCS directory."""
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket(stage="DOCUMENTATION")
        result = exporter._to_filesystem_json(db_ticket)
        assert result["stage"] == "DOCS"

    def test_stage_mapping_validator(self, tmp_path: Path) -> None:
        """DB VALIDATOR stage maps to FS VALIDATION directory."""
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket(stage="VALIDATOR")
        result = exporter._to_filesystem_json(db_ticket)
        assert result["stage"] == "VALIDATION"

    def test_sdlc_flow_mapped(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket(
            sdlc_flow=["READY", "BACKEND", "DOCUMENTATION", "VALIDATOR", "DONE"],
        )
        result = exporter._to_filesystem_json(db_ticket)
        assert result["sdlc_flow"] == [
            "READY", "BACKEND", "DOCS", "VALIDATION", "DONE",
        ]

    def test_claimed_by_name_fallback(self, tmp_path: Path) -> None:
        """Uses claimed_by_name when claimed_by is absent."""
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket()
        del db_ticket["claimed_by"]
        db_ticket["claimed_by_name"] = "Backend"
        result = exporter._to_filesystem_json(db_ticket)
        assert result["claimed_by"] == "Backend"

    def test_metadata_created_by(self, tmp_path: Path) -> None:
        """created_by from metadata is preserved."""
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket(
            metadata={"created_by": "TODO", "blocked_by": ["X-001"]},
        )
        result = exporter._to_filesystem_json(db_ticket)
        assert result["created_by"] == "TODO"
        assert result["blocked_by"] == ["X-001"]

    def test_depends_on_mapped_to_dependencies(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket(depends_on=["DEP-001", "DEP-002"])
        result = exporter._to_filesystem_json(db_ticket)
        assert result["dependencies"] == ["DEP-001", "DEP-002"]

    def test_claim_fields_preserved(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        db_ticket = _make_db_ticket(
            claimed_by="Backend",
            machine_id="pop-os",
            operator="dev",
            lease_expiry="2026-03-11T10:00:00+00:00",
        )
        result = exporter._to_filesystem_json(db_ticket)
        assert result["claimed_by"] == "Backend"
        assert result["machine_id"] == "pop-os"
        assert result["operator"] == "dev"
        assert result["lease_expiry"] == "2026-03-11T10:00:00+00:00"


# ---------------------------------------------------------------------------
# _resolve_fs_stage
# ---------------------------------------------------------------------------


class TestResolveFsStage:
    def test_known_stage(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        assert exporter._resolve_fs_stage({"stage": "BACKEND"}) == "BACKEND"
        assert exporter._resolve_fs_stage({"stage": "DOCUMENTATION"}) == "DOCS"
        assert exporter._resolve_fs_stage({"stage": "VALIDATOR"}) == "VALIDATION"

    def test_unknown_stage_passthrough(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        assert exporter._resolve_fs_stage({"stage": "UNKNOWN"}) == "UNKNOWN"

    def test_missing_stage_defaults_ready(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        assert exporter._resolve_fs_stage({}) == "READY"


# ---------------------------------------------------------------------------
# Backup
# ---------------------------------------------------------------------------


class TestBackup:
    def test_backup_master_tickets(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_existing_ticket(tickets_dir, "T-001")
        _write_existing_ticket(tickets_dir, "T-002")

        backup_dir = tmp_path / "backup"
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path / "state",
            backup_dir=backup_dir,
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        count = exporter._backup_existing()
        assert count == 2
        assert (backup_dir / "tickets" / "T-001.json").exists()
        assert (backup_dir / "tickets" / "T-002.json").exists()

    def test_backup_state_copies(self, tmp_path: Path) -> None:
        state_dir = tmp_path / "state"
        _place_existing_state(state_dir, "READY", "T-001")
        _place_existing_state(state_dir, "BACKEND", "T-002")

        backup_dir = tmp_path / "backup"
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=state_dir,
            backup_dir=backup_dir,
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        count = exporter._backup_existing()
        assert count == 2
        assert (
            backup_dir / "ticket-state" / "READY" / "T-001.json"
        ).exists()
        assert (
            backup_dir / "ticket-state" / "BACKEND" / "T-002.json"
        ).exists()

    def test_backup_no_existing_files(self, tmp_path: Path) -> None:
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
            backup_dir=tmp_path / "backup",
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        count = exporter._backup_existing()
        assert count == 0

    def test_auto_backup_dir_when_none(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_existing_ticket(tickets_dir, "T-001")

        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path / "state",
            backup_dir=None,
        )
        reader = FakeReader()
        exporter = TicketExporter(cfg, reader)
        count = exporter._backup_existing()
        assert count == 1
        # auto-generated backup dir should exist alongside tickets_dir
        backup_dirs = [
            d for d in tmp_path.iterdir()
            if d.is_dir() and d.name.startswith("tickets-backup-")
        ]
        assert len(backup_dirs) == 1


# ---------------------------------------------------------------------------
# Full export run
# ---------------------------------------------------------------------------


class TestExporterRun:
    @pytest.mark.asyncio
    async def test_export_single_ticket(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        reader = FakeReader([_make_db_ticket("T-001", stage="BACKEND")])
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.total_read == 1
        assert result.stats.exported == 1
        assert result.stats.errors == 0
        assert result.stats.stage_distribution == {"BACKEND": 1}

        # Verify master file
        master = tickets_dir / "T-001.json"
        assert master.exists()
        data = json.loads(master.read_text(encoding="utf-8"))
        assert data["ticket_id"] == "T-001"
        assert data["stage"] == "BACKEND"
        assert data["type"] == "backend"

        # Verify state copy
        state_copy = state_dir / "BACKEND" / "T-001.json"
        assert state_copy.exists()

    @pytest.mark.asyncio
    async def test_export_multiple_tickets(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        reader = FakeReader([
            _make_db_ticket("T-001", stage="READY"),
            _make_db_ticket("T-002", stage="BACKEND"),
            _make_db_ticket("T-003", stage="DONE"),
        ])
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.total_read == 3
        assert result.stats.exported == 3
        assert result.stats.stage_distribution == {
            "READY": 1, "BACKEND": 1, "DONE": 1,
        }

    @pytest.mark.asyncio
    async def test_export_with_active_claims(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        reader = FakeReader([
            _make_db_ticket(
                "T-001",
                stage="BACKEND",
                claimed_by="Backend",
                machine_id="pop-os",
                operator="dev",
                lease_expiry="2026-03-11T10:00:00+00:00",
            ),
            _make_db_ticket("T-002", stage="READY"),
        ])
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.active_claims == 1
        data = json.loads(
            (tickets_dir / "T-001.json").read_text(encoding="utf-8"),
        )
        assert data["claimed_by"] == "Backend"
        assert data["machine_id"] == "pop-os"
        assert data["operator"] == "dev"

    @pytest.mark.asyncio
    async def test_dry_run_no_files(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        reader = FakeReader([_make_db_ticket("T-001")])
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
            dry_run=True,
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.dry_run is True
        assert result.stats.exported == 1
        assert result.stats.backed_up == 0
        assert not tickets_dir.exists()
        assert not state_dir.exists()

    @pytest.mark.asyncio
    async def test_non_destructive_backup(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        backup_dir = tmp_path / "backup"

        # Pre-populate existing files
        tickets_dir.mkdir()
        _write_existing_ticket(tickets_dir, "T-001")
        _place_existing_state(state_dir, "READY", "T-001")

        reader = FakeReader([
            _make_db_ticket("T-001", stage="BACKEND"),
        ])
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
            backup_dir=backup_dir,
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.backed_up == 2  # 1 master + 1 state
        assert (backup_dir / "tickets" / "T-001.json").exists()
        assert (
            backup_dir / "ticket-state" / "READY" / "T-001.json"
        ).exists()

        # New export overwrote the master
        new_data = json.loads(
            (tickets_dir / "T-001.json").read_text(encoding="utf-8"),
        )
        assert new_data["stage"] == "BACKEND"

    @pytest.mark.asyncio
    async def test_empty_database(self, tmp_path: Path) -> None:
        reader = FakeReader([])
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.total_read == 0
        assert result.stats.exported == 0

    @pytest.mark.asyncio
    async def test_database_read_failure(self, tmp_path: Path) -> None:
        reader = FailingReader()
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.total_read == 0
        assert len(result.errors) == 1
        assert "Database read failed" in result.errors[0]

    @pytest.mark.asyncio
    async def test_progress_callback(self, tmp_path: Path) -> None:
        calls: list[tuple[int, int, str]] = []

        def on_progress(current: int, total: int, tid: str) -> None:
            calls.append((current, total, tid))

        reader = FakeReader([
            _make_db_ticket("T-001"),
            _make_db_ticket("T-002"),
        ])
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        exporter = TicketExporter(cfg, reader, on_progress=on_progress)
        await exporter.run()

        assert len(calls) == 2
        assert calls[0] == (1, 2, "T-001")
        assert calls[1] == (2, 2, "T-002")

    @pytest.mark.asyncio
    async def test_exported_json_consumable_by_tickets_py(
        self, tmp_path: Path,
    ) -> None:
        """Exported files match the original JSON schema."""
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        reader = FakeReader([
            _make_db_ticket(
                "T-001",
                stage="BACKEND",
                title="Test Ticket",
                ticket_type="backend",
                priority="high",
                sdlc_flow=["READY", "BACKEND", "QA", "DONE"],
                depends_on=["DEP-001"],
                file_paths=["src/main.py"],
                acceptance_criteria=["AC1", "AC2"],
                tags=["backend", "phase4"],
                rework_count=1,
                created_at="2026-01-01T00:00:00+00:00",
                source_task_file="TODO/tasks/test.md",
                metadata={"created_by": "TODO", "blocked_by": []},
                history=[
                    {
                        "timestamp": "2026-01-01T00:00:00+00:00",
                        "event": "CREATED",
                        "agent": "TODO",
                        "machine_id": "system",
                        "details": "Created",
                    },
                ],
            ),
        ])
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        exporter = TicketExporter(cfg, reader)
        await exporter.run()

        data = json.loads(
            (tickets_dir / "T-001.json").read_text(encoding="utf-8"),
        )

        # Verify all required schema fields present
        required_fields = [
            "ticket_id", "title", "description", "type", "priority",
            "stage", "sdlc_flow", "created_at", "created_by",
            "dependencies", "blocked_by", "file_paths",
            "acceptance_criteria", "rework_count", "claimed_by",
            "machine_id", "operator", "lease_expiry",
            "lease_duration_minutes", "history", "source_task_file",
            "tags",
        ]
        for f in required_fields:
            assert f in data, f"Missing field: {f}"

        assert data["ticket_id"] == "T-001"
        assert data["title"] == "Test Ticket"
        assert data["type"] == "backend"
        assert data["priority"] == "high"
        assert data["stage"] == "BACKEND"
        assert data["sdlc_flow"] == ["READY", "BACKEND", "QA", "DONE"]
        assert data["dependencies"] == ["DEP-001"]
        assert data["created_by"] == "TODO"
        assert data["source_task_file"] == "TODO/tasks/test.md"
        assert len(data["history"]) == 1

    @pytest.mark.asyncio
    async def test_export_with_documentation_stage(
        self, tmp_path: Path,
    ) -> None:
        """DB DOCUMENTATION → FS DOCS directory."""
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        reader = FakeReader([
            _make_db_ticket("T-001", stage="DOCUMENTATION"),
        ])
        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.stage_distribution == {"DOCS": 1}
        assert (state_dir / "DOCS" / "T-001.json").exists()

    @pytest.mark.asyncio
    async def test_summary_report(self, tmp_path: Path) -> None:
        reader = FakeReader([
            _make_db_ticket("T-001", stage="READY"),
            _make_db_ticket(
                "T-002", stage="BACKEND", claimed_by="Agent",
            ),
        ])
        cfg = ExportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        summary = result.summary()
        assert "EXPORT Summary" in summary
        assert "Total tickets read:     2" in summary
        assert "Exported:               2" in summary
        assert "Active claims:          1" in summary
        assert "READY: 1" in summary
        assert "BACKEND: 1" in summary

    @pytest.mark.asyncio
    async def test_export_claimed_by_name_field(
        self, tmp_path: Path,
    ) -> None:
        """DB uses claimed_by_name; export maps to claimed_by."""
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        reader = FakeReader([
            _make_db_ticket("T-001", stage="BACKEND"),
        ])
        # Simulate DB returning claimed_by_name instead of claimed_by
        reader.tickets[0].pop("claimed_by")
        reader.tickets[0]["claimed_by_name"] = "Frontend"

        cfg = ExportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        exporter = TicketExporter(cfg, reader)
        result = await exporter.run()

        assert result.stats.active_claims == 1
        data = json.loads(
            (tickets_dir / "T-001.json").read_text(encoding="utf-8"),
        )
        assert data["claimed_by"] == "Frontend"
