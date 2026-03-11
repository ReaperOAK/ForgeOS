"""Tests for mcp_server.migration.importer."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import pytest

from mcp_server.migration.importer import (
    DatabaseWriter,
    ImportConfig,
    ImportResult,
    ImportStats,
    TicketImporter,
)

if TYPE_CHECKING:
    from pathlib import Path

    from mcp_server.migration.transformers import (
        TransformedEvent,
        TransformedTicket,
    )

# ---------------------------------------------------------------------------
# Fake database writers
# ---------------------------------------------------------------------------


class FakeWriter:
    """In-memory DatabaseWriter for testing."""

    def __init__(self) -> None:
        self.tickets: dict[str, TransformedTicket] = {}
        self.events: list[TransformedEvent] = []

    async def upsert_ticket(
        self, ticket: TransformedTicket,
    ) -> bool:
        is_new = ticket.ticket_id not in self.tickets
        self.tickets[ticket.ticket_id] = ticket
        return is_new

    async def insert_events(
        self, events: list[TransformedEvent],
    ) -> int:
        self.events.extend(events)
        return len(events)


class FailingWriter:
    """Writer that raises on every write."""

    async def upsert_ticket(
        self, ticket: TransformedTicket,
    ) -> bool:
        raise RuntimeError("DB connection failed")

    async def insert_events(
        self, events: list[TransformedEvent],
    ) -> int:
        raise RuntimeError("DB connection failed")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _write_ticket(
    tickets_dir: Path,
    ticket_id: str,
    **overrides: Any,
) -> Path:
    """Write a minimal ticket JSON and return the file path."""
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
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _place_in_state_dir(
    state_dir: Path,
    stage: str,
    ticket_id: str,
) -> Path:
    """Create a ticket JSON stub in a state subdirectory."""
    sub = state_dir / stage
    sub.mkdir(parents=True, exist_ok=True)
    path = sub / f"{ticket_id}.json"
    path.write_text("{}", encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# ImportConfig
# ---------------------------------------------------------------------------


class TestImportConfig:
    def test_defaults(self, tmp_path: Path) -> None:
        cfg = ImportConfig(
            tickets_dir=tmp_path / "tickets",
            ticket_state_dir=tmp_path / "state",
        )
        assert cfg.dry_run is False

    def test_frozen(self, tmp_path: Path) -> None:
        cfg = ImportConfig(
            tickets_dir=tmp_path,
            ticket_state_dir=tmp_path,
        )
        with pytest.raises(AttributeError):
            cfg.dry_run = True  # type: ignore[misc]


# ---------------------------------------------------------------------------
# ImportStats / ImportResult
# ---------------------------------------------------------------------------


class TestImportResult:
    def test_summary_format(self) -> None:
        stats = ImportStats(
            total_found=10, imported=8, updated=1, errors=1,
        )
        result = ImportResult(
            stats=stats, dry_run=False, errors=["err1"],
        )
        summary = result.summary()
        assert "IMPORT Summary" in summary
        assert "10" in summary
        assert "err1" in summary

    def test_dry_run_summary(self) -> None:
        stats = ImportStats(total_found=5, imported=5)
        result = ImportResult(stats=stats, dry_run=True)
        assert "DRY RUN" in result.summary()

    def test_warnings_in_summary(self) -> None:
        stats = ImportStats(total_found=1, imported=1)
        result = ImportResult(
            stats=stats,
            dry_run=False,
            warnings=["unknown type"],
        )
        assert "unknown type" in result.summary()


# ---------------------------------------------------------------------------
# Scan ticket files
# ---------------------------------------------------------------------------


class TestScanTicketFiles:
    def test_reads_json_files(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001")
        _write_ticket(tickets_dir, "T-002")

        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg)
        result = importer._scan_ticket_files()
        assert len(result) == 2
        assert "T-001" in result
        assert "T-002" in result

    def test_skips_invalid_json(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        bad = tickets_dir / "bad.json"
        bad.write_text("not json", encoding="utf-8")
        _write_ticket(tickets_dir, "T-001")

        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg)
        result = importer._scan_ticket_files()
        assert len(result) == 1

    def test_skips_non_dict_json(self, tmp_path: Path) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        arr = tickets_dir / "arr.json"
        arr.write_text("[1, 2, 3]", encoding="utf-8")
        _write_ticket(tickets_dir, "T-001")

        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg)
        result = importer._scan_ticket_files()
        assert len(result) == 1

    def test_missing_directory(self, tmp_path: Path) -> None:
        cfg = ImportConfig(
            tickets_dir=tmp_path / "nonexistent",
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg)
        assert importer._scan_ticket_files() == {}


# ---------------------------------------------------------------------------
# Scan state directories
# ---------------------------------------------------------------------------


class TestScanStateDirectories:
    def test_maps_tickets_to_stages(
        self, tmp_path: Path,
    ) -> None:
        state_dir = tmp_path / "state"
        _place_in_state_dir(state_dir, "BACKEND", "T-001")
        _place_in_state_dir(state_dir, "QA", "T-002")

        cfg = ImportConfig(
            tickets_dir=tmp_path,
            ticket_state_dir=state_dir,
        )
        importer = TicketImporter(cfg)
        result = importer._scan_state_directories()
        assert result["T-001"] == ["BACKEND"]
        assert result["T-002"] == ["QA"]

    def test_duplicate_in_multiple_dirs(
        self, tmp_path: Path,
    ) -> None:
        state_dir = tmp_path / "state"
        _place_in_state_dir(state_dir, "READY", "T-001")
        _place_in_state_dir(state_dir, "BACKEND", "T-001")

        cfg = ImportConfig(
            tickets_dir=tmp_path,
            ticket_state_dir=state_dir,
        )
        importer = TicketImporter(cfg)
        result = importer._scan_state_directories()
        assert sorted(result["T-001"]) == ["BACKEND", "READY"]

    def test_missing_state_dir(self, tmp_path: Path) -> None:
        cfg = ImportConfig(
            tickets_dir=tmp_path,
            ticket_state_dir=tmp_path / "gone",
        )
        importer = TicketImporter(cfg)
        assert importer._scan_state_directories() == {}


# ---------------------------------------------------------------------------
# Full import run
# ---------------------------------------------------------------------------


class TestImportRun:
    @pytest.mark.asyncio
    async def test_import_new_tickets(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001")
        _write_ticket(tickets_dir, "T-002")
        _place_in_state_dir(state_dir, "BACKEND", "T-001")

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        importer = TicketImporter(cfg, writer)
        result = await importer.run()

        assert result.stats.total_found == 2
        assert result.stats.imported == 2
        assert result.stats.errors == 0
        assert "T-001" in writer.tickets
        assert "T-002" in writer.tickets
        assert writer.tickets["T-001"].stage == "BACKEND"

    @pytest.mark.asyncio
    async def test_upsert_existing_ticket(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001", title="Original")

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        # First import
        importer = TicketImporter(cfg, writer)
        await importer.run()
        assert writer.tickets["T-001"].title == "Original"

        # Second import after "update"
        _write_ticket(tickets_dir, "T-001", title="Updated")
        importer2 = TicketImporter(cfg, writer)
        result = await importer2.run()

        assert result.stats.updated == 1
        assert result.stats.imported == 0
        assert writer.tickets["T-001"].title == "Updated"

    @pytest.mark.asyncio
    async def test_dry_run_no_writes(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001")
        _write_ticket(tickets_dir, "T-002")

        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
            dry_run=True,
        )
        importer = TicketImporter(cfg)
        result = await importer.run()

        assert result.dry_run is True
        assert result.stats.total_found == 2
        assert result.stats.imported == 2

    @pytest.mark.asyncio
    async def test_dry_run_writer_not_called(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001")

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
            dry_run=True,
        )
        importer = TicketImporter(cfg, writer)
        await importer.run()

        assert len(writer.tickets) == 0

    @pytest.mark.asyncio
    async def test_requires_writer_when_not_dry_run(
        self, tmp_path: Path,
    ) -> None:
        cfg = ImportConfig(
            tickets_dir=tmp_path,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg)
        with pytest.raises(ValueError, match="DatabaseWriter"):
            await importer.run()

    @pytest.mark.asyncio
    async def test_handles_transform_errors(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        bad = tickets_dir / "BAD-001.json"
        bad.write_text(
            json.dumps({"ticket_id": "BAD-001"}),
            encoding="utf-8",
        )
        _write_ticket(tickets_dir, "T-001")

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg, writer)
        result = await importer.run()

        assert result.stats.errors == 1
        assert result.stats.imported == 1
        assert len(result.errors) == 1
        assert "BAD-001" in result.errors[0]

    @pytest.mark.asyncio
    async def test_handles_writer_errors(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001")

        writer = FailingWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg, writer)
        result = await importer.run()

        assert result.stats.errors == 1
        assert any(
            "DB" in e or "connection" in e
            for e in result.errors
        )

    @pytest.mark.asyncio
    async def test_progress_callback(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001")
        _write_ticket(tickets_dir, "T-002")

        calls: list[tuple[int, int, str]] = []

        def on_progress(
            current: int, total: int, ticket_id: str,
        ) -> None:
            calls.append((current, total, ticket_id))

        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
            dry_run=True,
        )
        importer = TicketImporter(
            cfg, on_progress=on_progress,
        )
        await importer.run()

        assert len(calls) == 2
        assert calls[0][1] == 2  # total
        assert calls[1][0] == 2  # current

    @pytest.mark.asyncio
    async def test_events_imported(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()

        history = [
            {
                "timestamp": "2026-01-01T00:00:00Z",
                "event": "CREATED",
                "agent": "TODO",
                "machine_id": "system",
            },
            {
                "timestamp": "2026-01-02T00:00:00Z",
                "event": "CLAIMED",
                "agent": "Backend",
                "machine_id": "pop-os",
            },
        ]
        _write_ticket(tickets_dir, "T-001", history=history)

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg, writer)
        result = await importer.run()

        assert result.stats.events_imported == 2
        assert len(writer.events) == 2
        assert writer.events[0].event_type == "CREATED"
        assert writer.events[1].event_type == "CLAIMED"

    @pytest.mark.asyncio
    async def test_empty_directory(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()

        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )
        importer = TicketImporter(cfg, FakeWriter())
        result = await importer.run()

        assert result.stats.total_found == 0

    @pytest.mark.asyncio
    async def test_stage_resolved_from_state_dir(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001", stage="READY")
        _place_in_state_dir(state_dir, "QA", "T-001")

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        importer = TicketImporter(cfg, writer)
        await importer.run()

        assert writer.tickets["T-001"].stage == "QA"

    @pytest.mark.asyncio
    async def test_duplicate_stage_resolution(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        state_dir = tmp_path / "state"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001", stage="READY")
        _place_in_state_dir(state_dir, "READY", "T-001")
        _place_in_state_dir(state_dir, "BACKEND", "T-001")

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=state_dir,
        )
        importer = TicketImporter(cfg, writer)
        await importer.run()

        assert writer.tickets["T-001"].stage == "BACKEND"

    @pytest.mark.asyncio
    async def test_summary_includes_warnings(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(
            tickets_dir, "T-001", type="unknown_type",
        )

        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
            dry_run=True,
        )
        importer = TicketImporter(cfg)
        result = await importer.run()

        assert len(result.warnings) > 0
        assert "unknown_type" in result.summary()

    @pytest.mark.asyncio
    async def test_idempotent_import(
        self, tmp_path: Path,
    ) -> None:
        tickets_dir = tmp_path / "tickets"
        tickets_dir.mkdir()
        _write_ticket(tickets_dir, "T-001")

        writer = FakeWriter()
        cfg = ImportConfig(
            tickets_dir=tickets_dir,
            ticket_state_dir=tmp_path,
        )

        # Run twice
        importer1 = TicketImporter(cfg, writer)
        result1 = await importer1.run()
        importer2 = TicketImporter(cfg, writer)
        result2 = await importer2.run()

        assert result1.stats.imported == 1
        assert result2.stats.imported == 0
        assert result2.stats.updated == 1
        assert len(writer.tickets) == 1


# ---------------------------------------------------------------------------
# DatabaseWriter protocol
# ---------------------------------------------------------------------------


class TestDatabaseWriterProtocol:
    def test_fake_writer_satisfies_protocol(self) -> None:
        assert isinstance(FakeWriter(), DatabaseWriter)

    def test_failing_writer_satisfies_protocol(self) -> None:
        assert isinstance(FailingWriter(), DatabaseWriter)
