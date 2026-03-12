"""
Tests for database/seed.py — ForgeOS Database Seed Script.

Covers validation, transformation, file loading, dry-run, and
duplicate detection (upsert semantics).

Ticket: FORGEOS-BE005
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

# Import the module under test
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from database.seed import (
    STAGE_JSON_TO_DB,
    SeedResult,
    build_parser,
    load_tickets_from_directory,
    load_tickets_from_file,
    resolve_source,
    seed_tickets,
    transform_ticket,
    validate_ticket,
)


# ── Fixtures ─────────────────────────────────────────────────────────


def make_ticket(**overrides: Any) -> dict[str, Any]:
    """Create a valid ticket dict with optional overrides."""
    base = {
        "ticket_id": "TEST-001",
        "title": "Test Ticket",
        "description": "A test ticket for validation",
        "type": "backend",
        "priority": "high",
        "stage": "READY",
        "sdlc_flow": ["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"],
        "created_at": "2026-03-01T10:00:00+00:00",
        "created_by": "test",
        "dependencies": [],
        "blocked_by": [],
        "file_paths": ["src/test.ts"],
        "acceptance_criteria": ["Test passes"],
        "rework_count": 0,
        "tags": ["test"],
        "history": [],
    }
    base.update(overrides)
    return base


# ── Validation Tests ─────────────────────────────────────────────────


class TestValidateTicket:
    """Tests for validate_ticket()."""

    def test_valid_ticket_returns_empty_errors(self) -> None:
        ticket = make_ticket()
        errors = validate_ticket(ticket)
        assert errors == []

    def test_missing_ticket_id_returns_error(self) -> None:
        ticket = make_ticket()
        del ticket["ticket_id"]
        errors = validate_ticket(ticket)
        assert any("ticket_id" in e for e in errors)

    def test_missing_title_returns_error(self) -> None:
        ticket = make_ticket()
        del ticket["title"]
        errors = validate_ticket(ticket)
        assert any("title" in e for e in errors)

    def test_missing_type_returns_error(self) -> None:
        ticket = make_ticket()
        del ticket["type"]
        errors = validate_ticket(ticket)
        assert any("type" in e for e in errors)

    def test_invalid_type_returns_error(self) -> None:
        ticket = make_ticket(type="invalid_type")
        errors = validate_ticket(ticket)
        assert any("Invalid type" in e for e in errors)

    def test_invalid_priority_returns_error(self) -> None:
        ticket = make_ticket(priority="urgent")
        errors = validate_ticket(ticket)
        assert any("Invalid priority" in e for e in errors)

    def test_invalid_stage_returns_error(self) -> None:
        ticket = make_ticket(stage="NONEXISTENT_STAGE")
        errors = validate_ticket(ticket)
        assert any("Invalid stage" in e for e in errors)

    def test_blocked_stage_is_valid(self) -> None:
        ticket = make_ticket(stage="BLOCKED")
        errors = validate_ticket(ticket)
        assert errors == []

    def test_uidesigner_in_sdlc_flow_is_valid(self) -> None:
        ticket = make_ticket(
            sdlc_flow=["READY", "UIDESIGNER", "FRONTEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]
        )
        errors = validate_ticket(ticket)
        assert errors == []

    def test_too_short_sdlc_flow_returns_error(self) -> None:
        ticket = make_ticket(sdlc_flow=["READY", "DONE"])
        errors = validate_ticket(ticket)
        assert any("at least 3" in e for e in errors)

    def test_invalid_stage_in_sdlc_flow_returns_error(self) -> None:
        ticket = make_ticket(
            sdlc_flow=["READY", "INVALID", "DONE"]
        )
        errors = validate_ticket(ticket)
        assert any("Invalid stage in sdlc_flow" in e for e in errors)

    def test_all_valid_types(self) -> None:
        for t in ["backend", "frontend", "fullstack", "infra", "security", "docs", "research", "architecture", "product", "design"]:
            ticket = make_ticket(type=t)
            assert validate_ticket(ticket) == [], f"Type {t} should be valid"

    def test_all_valid_priorities(self) -> None:
        for p in ["critical", "high", "medium", "low"]:
            ticket = make_ticket(priority=p)
            assert validate_ticket(ticket) == [], f"Priority {p} should be valid"


# ── Transform Tests ──────────────────────────────────────────────────


class TestTransformTicket:
    """Tests for transform_ticket()."""

    def test_basic_transform(self) -> None:
        ticket = make_ticket()
        result = transform_ticket(ticket)
        assert result["ticket_id"] == "TEST-001"
        assert result["title"] == "Test Ticket"
        assert result["type"] == "backend"
        assert result["priority"] == "high"
        assert result["stage"] == "READY"
        assert result["status"] == "READY"

    def test_stage_mapping_docs_to_documentation(self) -> None:
        ticket = make_ticket(stage="DOCS")
        result = transform_ticket(ticket)
        assert result["stage"] == "DOCUMENTATION"

    def test_stage_mapping_validation_to_validator(self) -> None:
        ticket = make_ticket(stage="VALIDATION")
        result = transform_ticket(ticket)
        assert result["stage"] == "VALIDATOR"

    def test_stage_mapping_blocked_to_ready(self) -> None:
        ticket = make_ticket(stage="BLOCKED")
        result = transform_ticket(ticket)
        assert result["stage"] == "READY"
        assert result["status"] == "BLOCKED"

    def test_sdlc_flow_mapped(self) -> None:
        ticket = make_ticket(
            sdlc_flow=["READY", "BACKEND", "QA", "DOCS", "VALIDATION", "DONE"]
        )
        result = transform_ticket(ticket)
        assert result["sdlc_flow"] == [
            "READY", "BACKEND", "QA", "DOCUMENTATION", "VALIDATOR", "DONE"
        ]

    def test_uidesigner_mapped_to_ui_design(self) -> None:
        ticket = make_ticket(
            sdlc_flow=["READY", "UIDESIGNER", "FRONTEND", "DONE"]
        )
        result = transform_ticket(ticket)
        assert "UI_DESIGN" in result["sdlc_flow"]

    def test_dependencies_mapped_to_depends_on(self) -> None:
        ticket = make_ticket(dependencies=["DEP-001", "DEP-002"])
        result = transform_ticket(ticket)
        assert result["depends_on"] == ["DEP-001", "DEP-002"]

    def test_claimed_ticket_gets_claimed_status(self) -> None:
        ticket = make_ticket(claimed_by="Backend")
        result = transform_ticket(ticket)
        assert result["status"] == "CLAIMED"

    def test_done_ticket_gets_done_status(self) -> None:
        ticket = make_ticket(stage="DONE")
        result = transform_ticket(ticket)
        assert result["status"] == "DONE"

    def test_in_progress_ticket_gets_blocked_status(self) -> None:
        ticket = make_ticket(stage="BACKEND")
        result = transform_ticket(ticket)
        assert result["status"] == "BLOCKED"

    def test_metadata_contains_history(self) -> None:
        history = [{"timestamp": "2026-03-01T10:00:00+00:00", "event": "CREATED"}]
        ticket = make_ticket(history=history)
        result = transform_ticket(ticket)
        metadata = json.loads(result["metadata"])
        assert metadata["history"] == history

    def test_empty_defaults(self) -> None:
        ticket = make_ticket()
        del ticket["description"]
        del ticket["file_paths"]
        del ticket["tags"]
        result = transform_ticket(ticket)
        assert result["description"] == ""
        assert result["file_paths"] == []
        assert result["tags"] == []


# ── File Loading Tests ───────────────────────────────────────────────


class TestLoadTicketsFromDirectory:
    """Tests for load_tickets_from_directory()."""

    def test_loads_json_files(self, tmp_path: Path) -> None:
        t1 = make_ticket(ticket_id="DIR-001")
        t2 = make_ticket(ticket_id="DIR-002")
        (tmp_path / "DIR-001.json").write_text(json.dumps(t1))
        (tmp_path / "DIR-002.json").write_text(json.dumps(t2))

        result = load_tickets_from_directory(str(tmp_path))
        assert len(result) == 2
        ids = {t["ticket_id"] for t in result}
        assert ids == {"DIR-001", "DIR-002"}

    def test_skips_schema_file(self, tmp_path: Path) -> None:
        t1 = make_ticket(ticket_id="DIR-001")
        (tmp_path / "DIR-001.json").write_text(json.dumps(t1))
        (tmp_path / "ticket-schema.json").write_text(json.dumps({"$schema": "..."}))

        result = load_tickets_from_directory(str(tmp_path))
        assert len(result) == 1
        assert result[0]["ticket_id"] == "DIR-001"

    def test_skips_invalid_json(self, tmp_path: Path) -> None:
        (tmp_path / "bad.json").write_text("not valid json{{{")
        (tmp_path / "good.json").write_text(json.dumps(make_ticket()))

        result = load_tickets_from_directory(str(tmp_path))
        assert len(result) == 1

    def test_empty_directory_returns_empty(self, tmp_path: Path) -> None:
        result = load_tickets_from_directory(str(tmp_path))
        assert result == []


class TestLoadTicketsFromFile:
    """Tests for load_tickets_from_file()."""

    def test_loads_array_of_tickets(self, tmp_path: Path) -> None:
        tickets = [make_ticket(ticket_id="F-001"), make_ticket(ticket_id="F-002")]
        filepath = tmp_path / "tickets.json"
        filepath.write_text(json.dumps(tickets))

        result = load_tickets_from_file(str(filepath))
        assert len(result) == 2

    def test_loads_single_ticket(self, tmp_path: Path) -> None:
        ticket = make_ticket(ticket_id="F-001")
        filepath = tmp_path / "single.json"
        filepath.write_text(json.dumps(ticket))

        result = load_tickets_from_file(str(filepath))
        assert len(result) == 1
        assert result[0]["ticket_id"] == "F-001"


# ── SeedResult Tests ─────────────────────────────────────────────────


class TestSeedResult:
    """Tests for SeedResult tracking."""

    def test_total_calculation(self) -> None:
        r = SeedResult(imported=5, skipped=2, failed=1)
        assert r.total == 8

    def test_default_values(self) -> None:
        r = SeedResult()
        assert r.imported == 0
        assert r.skipped == 0
        assert r.failed == 0
        assert r.errors == []
        assert r.total == 0


# ── Dry-Run Seed Tests ───────────────────────────────────────────────


class TestSeedTicketsDryRun:
    """Tests for seed_tickets() in dry-run mode."""

    def test_dry_run_counts_valid_as_imported(self) -> None:
        tickets = [make_ticket(ticket_id="DRY-001"), make_ticket(ticket_id="DRY-002")]
        result = seed_tickets("unused://db", tickets, dry_run=True)
        assert result.imported == 2
        assert result.failed == 0
        assert result.skipped == 0

    def test_dry_run_counts_invalid_as_failed(self) -> None:
        tickets = [
            make_ticket(ticket_id="DRY-OK"),
            make_ticket(ticket_id="DRY-BAD", type="nonexistent"),
        ]
        result = seed_tickets("unused://db", tickets, dry_run=True)
        assert result.imported == 1
        assert result.failed == 1

    def test_dry_run_does_not_connect_to_db(self) -> None:
        # If this connected to a DB, it would raise an error
        tickets = [make_ticket()]
        result = seed_tickets("postgresql://nobody:none@nowhere/nodb", tickets, dry_run=True)
        assert result.imported == 1


# ── CLI Parser Tests ──────────────────────────────────────────────────


class TestBuildParser:
    """Tests for argument parsing."""

    def test_default_args(self) -> None:
        parser = build_parser()
        args = parser.parse_args([])
        assert args.source is None
        assert args.database_url is None
        assert args.dry_run is False
        assert args.verbose is False

    def test_dry_run_flag(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["--dry-run"])
        assert args.dry_run is True

    def test_source_flag(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["--source", "/path/to/tickets"])
        assert args.source == "/path/to/tickets"

    def test_database_url_flag(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["--database-url", "postgresql://test"])
        assert args.database_url == "postgresql://test"

    def test_verbose_flag(self) -> None:
        parser = build_parser()
        args = parser.parse_args(["-v"])
        assert args.verbose is True


# ── Integration Test with Sample Data ────────────────────────────────


class TestSampleData:
    """Test the sample_tickets.json file itself is valid."""

    def test_sample_tickets_are_valid(self) -> None:
        sample_path = Path(__file__).resolve().parent.parent / "seed_data" / "sample_tickets.json"
        if not sample_path.exists():
            pytest.skip("sample_tickets.json not found")

        with open(sample_path) as f:
            tickets = json.load(f)

        assert isinstance(tickets, list)
        assert len(tickets) >= 5, "Sample data must have at least 5 tickets"

        for ticket in tickets:
            errors = validate_ticket(ticket)
            assert errors == [], f"Ticket {ticket.get('ticket_id')}: {errors}"

    def test_sample_tickets_transform_successfully(self) -> None:
        sample_path = Path(__file__).resolve().parent.parent / "seed_data" / "sample_tickets.json"
        if not sample_path.exists():
            pytest.skip("sample_tickets.json not found")

        with open(sample_path) as f:
            tickets = json.load(f)

        for ticket in tickets:
            result = transform_ticket(ticket)
            assert result["ticket_id"]
            assert result["stage"] in {"READY", "DONE", "BACKEND", "FRONTEND", "QA", "SECURITY", "CI", "DOCUMENTATION", "VALIDATOR", "RESEARCH", "ARCHITECT", "PRODUCT_MANAGER", "UI_DESIGN"}

    def test_sample_data_covers_multiple_types(self) -> None:
        sample_path = Path(__file__).resolve().parent.parent / "seed_data" / "sample_tickets.json"
        if not sample_path.exists():
            pytest.skip("sample_tickets.json not found")

        with open(sample_path) as f:
            tickets = json.load(f)

        types = {t["type"] for t in tickets}
        assert len(types) >= 3, f"Sample should cover at least 3 types, got: {types}"


# ── Stage Mapping Tests ──────────────────────────────────────────────


class TestStageMapping:
    """Tests for the STAGE_JSON_TO_DB mapping completeness."""

    def test_all_json_stages_have_mapping(self) -> None:
        json_stages = [
            "READY", "ARCHITECT", "RESEARCH", "PRODUCT_MANAGER",
            "UI_DESIGN", "BACKEND", "FRONTEND", "QA", "SECURITY",
            "CI", "DOCS", "VALIDATION", "DONE",
        ]
        for stage in json_stages:
            assert stage in STAGE_JSON_TO_DB, f"Missing mapping for {stage}"

    def test_alias_mappings(self) -> None:
        assert STAGE_JSON_TO_DB["BLOCKED"] == "READY"
        assert STAGE_JSON_TO_DB["UIDESIGNER"] == "UI_DESIGN"
        assert STAGE_JSON_TO_DB["DOCUMENTATION"] == "DOCUMENTATION"
        assert STAGE_JSON_TO_DB["VALIDATOR"] == "VALIDATOR"


# ── Database Seed Tests (mocked psycopg2) ────────────────────────────


class TestSeedTicketsDB:
    """Tests for seed_tickets() with mocked database connection."""

    def _mock_conn(self) -> MagicMock:
        """Create a mock psycopg2 connection with cursor context manager."""
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)
        mock_conn = MagicMock()
        mock_conn.cursor.return_value = mock_cursor
        return mock_conn

    @patch("database.seed.psycopg2")
    def test_successful_import(self, mock_pg: MagicMock) -> None:
        mock_conn = self._mock_conn()
        mock_pg.connect.return_value = mock_conn
        cur = mock_conn.cursor.return_value.__enter__.return_value
        cur.rowcount = 1  # new row inserted

        tickets = [make_ticket(ticket_id="DB-001"), make_ticket(ticket_id="DB-002")]
        result = seed_tickets("postgresql://test", tickets, dry_run=False)

        assert result.imported == 2
        assert result.skipped == 0
        assert result.failed == 0
        assert cur.execute.call_count == 2
        mock_conn.commit.assert_called_once()
        mock_conn.close.assert_called_once()

    @patch("database.seed.psycopg2")
    def test_duplicate_skipped(self, mock_pg: MagicMock) -> None:
        mock_conn = self._mock_conn()
        mock_pg.connect.return_value = mock_conn
        cur = mock_conn.cursor.return_value.__enter__.return_value
        cur.rowcount = 0  # ON CONFLICT DO NOTHING

        tickets = [make_ticket(ticket_id="DB-DUP")]
        result = seed_tickets("postgresql://test", tickets, dry_run=False)

        assert result.imported == 0
        assert result.skipped == 1
        assert result.failed == 0

    @patch("database.seed.psycopg2")
    def test_db_error_on_insert(self, mock_pg: MagicMock) -> None:
        mock_conn = self._mock_conn()
        mock_pg.connect.return_value = mock_conn
        mock_pg.Error = Exception  # make isinstance checks work
        cur = mock_conn.cursor.return_value.__enter__.return_value

        db_err = Exception("unique_violation")
        db_err.pgerror = "ERROR: unique violation"
        cur.execute.side_effect = db_err

        tickets = [make_ticket(ticket_id="DB-ERR")]
        result = seed_tickets("postgresql://test", tickets, dry_run=False)

        assert result.failed == 1
        assert len(result.errors) == 1
        assert "DB-ERR" in result.errors[0]
        mock_conn.rollback.assert_called()

    @patch("database.seed.psycopg2")
    def test_mixed_import_and_duplicate(self, mock_pg: MagicMock) -> None:
        mock_conn = self._mock_conn()
        mock_pg.connect.return_value = mock_conn
        cur = mock_conn.cursor.return_value.__enter__.return_value

        # Track call count to alternate rowcount values
        call_count = 0
        original_execute = cur.execute

        def execute_side_effect(*args: Any, **kwargs: Any) -> None:
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                cur.rowcount = 1  # new row
            else:
                cur.rowcount = 0  # duplicate

        cur.execute = MagicMock(side_effect=execute_side_effect)

        tickets = [make_ticket(ticket_id="DB-NEW"), make_ticket(ticket_id="DB-DUP")]
        result = seed_tickets("postgresql://test", tickets, dry_run=False)

        assert result.imported == 1
        assert result.skipped == 1

    @patch("database.seed.psycopg2")
    def test_invalid_ticket_not_sent_to_db(self, mock_pg: MagicMock) -> None:
        mock_conn = self._mock_conn()
        mock_pg.connect.return_value = mock_conn
        cur = mock_conn.cursor.return_value.__enter__.return_value
        cur.rowcount = 1

        tickets = [
            make_ticket(ticket_id="DB-VALID"),
            make_ticket(ticket_id="DB-BAD", type="nonexistent"),
        ]
        result = seed_tickets("postgresql://test", tickets, dry_run=False)

        assert result.imported == 1
        assert result.failed == 1
        # Only the valid ticket should hit the DB
        assert cur.execute.call_count == 1


# ── resolve_source Tests ─────────────────────────────────────────────


class TestResolveSource:
    """Tests for resolve_source()."""

    def test_explicit_source_returned_as_is(self) -> None:
        assert resolve_source("/some/custom/path") == "/some/custom/path"

    def test_default_finds_github_tickets(self) -> None:
        # When run from the repo root, .github/tickets/ should be found
        original_cwd = os.getcwd()
        try:
            os.chdir("/home/Ticketer/Documents/ForgeOS")
            result = resolve_source(None)
            assert result.endswith(".github/tickets")
        finally:
            os.chdir(original_cwd)

    def test_missing_directory_exits(self, tmp_path: Path) -> None:
        # Temporarily change cwd to a dir without .github/tickets/
        original_cwd = os.getcwd()
        try:
            os.chdir(str(tmp_path))
            with pytest.raises(SystemExit):
                # Monkey-patch __file__ resolution to avoid finding the real dir
                with patch("database.seed.Path") as mock_path:
                    mock_path.return_value.resolve.return_value.parent = tmp_path
                    mock_path.return_value.is_dir.return_value = False
                    mock_path.cwd.return_value = tmp_path
                    # Create a mock that returns a path that doesn't exist
                    mock_candidate = MagicMock()
                    mock_candidate.is_dir.return_value = False
                    mock_path.__truediv__ = MagicMock(return_value=mock_candidate)
                    resolve_source(None)
        finally:
            os.chdir(original_cwd)


# ── CLI main() Tests ─────────────────────────────────────────────────


class TestMain:
    """Tests for main() CLI entry point."""

    @patch("database.seed.seed_tickets")
    @patch("database.seed.load_tickets_from_file")
    def test_main_dry_run_with_file(
        self, mock_load: MagicMock, mock_seed: MagicMock, tmp_path: Path
    ) -> None:
        from database.seed import main

        # Create a temp file
        sample = tmp_path / "tickets.json"
        sample.write_text(json.dumps([make_ticket()]))

        mock_load.return_value = [make_ticket()]
        mock_seed.return_value = SeedResult(imported=1)

        with patch("sys.argv", ["seed", "--source", str(sample), "--dry-run"]):
            exit_code = main()

        assert exit_code == 0
        mock_seed.assert_called_once()
        _, kwargs = mock_seed.call_args
        assert kwargs.get("dry_run") is True or mock_seed.call_args[0][2] is True

    @patch("database.seed.seed_tickets")
    @patch("database.seed.load_tickets_from_directory")
    def test_main_with_directory(
        self, mock_load: MagicMock, mock_seed: MagicMock, tmp_path: Path
    ) -> None:
        from database.seed import main

        (tmp_path / "test.json").write_text(json.dumps(make_ticket()))
        mock_load.return_value = [make_ticket()]
        mock_seed.return_value = SeedResult(imported=1)

        with patch("sys.argv", ["seed", "--source", str(tmp_path)]):
            exit_code = main()

        assert exit_code == 0
        mock_load.assert_called_once()

    @patch("database.seed.seed_tickets")
    def test_main_source_not_found(self, mock_seed: MagicMock) -> None:
        from database.seed import main

        with patch("sys.argv", ["seed", "--source", "/nonexistent/path/12345"]):
            exit_code = main()

        assert exit_code == 1
        mock_seed.assert_not_called()

    @patch("database.seed.seed_tickets")
    @patch("database.seed.load_tickets_from_directory")
    def test_main_no_tickets_returns_zero(
        self, mock_load: MagicMock, mock_seed: MagicMock, tmp_path: Path
    ) -> None:
        from database.seed import main

        mock_load.return_value = []

        with patch("sys.argv", ["seed", "--source", str(tmp_path)]):
            exit_code = main()

        assert exit_code == 0
        mock_seed.assert_not_called()

    @patch("database.seed.seed_tickets")
    @patch("database.seed.load_tickets_from_file")
    def test_main_returns_one_on_failures(
        self, mock_load: MagicMock, mock_seed: MagicMock, tmp_path: Path
    ) -> None:
        from database.seed import main

        sample = tmp_path / "tickets.json"
        sample.write_text(json.dumps([make_ticket()]))

        mock_load.return_value = [make_ticket()]
        mock_seed.return_value = SeedResult(failed=2, errors=["err1", "err2"])

        with patch("sys.argv", ["seed", "--source", str(sample)]):
            exit_code = main()

        assert exit_code == 1

    @patch("database.seed.seed_tickets")
    @patch("database.seed.load_tickets_from_file")
    def test_main_verbose_sets_debug(
        self, mock_load: MagicMock, mock_seed: MagicMock, tmp_path: Path
    ) -> None:
        from database.seed import main

        sample = tmp_path / "tickets.json"
        sample.write_text(json.dumps([make_ticket()]))

        mock_load.return_value = [make_ticket()]
        mock_seed.return_value = SeedResult(imported=1)

        with patch("sys.argv", ["seed", "--source", str(sample), "-v", "--dry-run"]):
            exit_code = main()

        assert exit_code == 0

    @patch("database.seed.seed_tickets")
    @patch("database.seed.load_tickets_from_file")
    def test_main_db_url_from_env(
        self, mock_load: MagicMock, mock_seed: MagicMock, tmp_path: Path
    ) -> None:
        from database.seed import main

        sample = tmp_path / "tickets.json"
        sample.write_text(json.dumps([make_ticket()]))

        mock_load.return_value = [make_ticket()]
        mock_seed.return_value = SeedResult(imported=1)

        with patch("sys.argv", ["seed", "--source", str(sample), "--dry-run"]):
            with patch.dict(os.environ, {"DATABASE_URL": "postgresql://envtest"}):
                exit_code = main()

        assert exit_code == 0


# ── Edge Case Validation Tests ───────────────────────────────────────


class TestValidationEdgeCases:
    """Additional edge case tests for validation."""

    def test_empty_ticket_id(self) -> None:
        ticket = make_ticket(ticket_id="")
        errors = validate_ticket(ticket)
        assert any("non-empty" in e for e in errors)

    def test_sdlc_flow_not_list(self) -> None:
        ticket = make_ticket(sdlc_flow="not-a-list")
        errors = validate_ticket(ticket)
        assert any("at least 3" in e for e in errors)

    def test_missing_priority(self) -> None:
        ticket = make_ticket()
        del ticket["priority"]
        errors = validate_ticket(ticket)
        assert any("priority" in e for e in errors)

    def test_missing_stage(self) -> None:
        ticket = make_ticket()
        del ticket["stage"]
        errors = validate_ticket(ticket)
        assert any("stage" in e for e in errors)

    def test_missing_sdlc_flow(self) -> None:
        ticket = make_ticket()
        del ticket["sdlc_flow"]
        errors = validate_ticket(ticket)
        assert any("sdlc_flow" in e for e in errors)


# ── File Loading Edge Cases ──────────────────────────────────────────


class TestFileLoadingEdgeCases:
    """Edge cases for file loading functions."""

    def test_directory_skips_non_object_json(self, tmp_path: Path) -> None:
        (tmp_path / "array.json").write_text(json.dumps([1, 2, 3]))
        (tmp_path / "good.json").write_text(json.dumps(make_ticket()))
        result = load_tickets_from_directory(str(tmp_path))
        # The array [1,2,3] is not a dict so it should be skipped
        assert len(result) == 1

    def test_file_with_unexpected_json_type(self, tmp_path: Path) -> None:
        filepath = tmp_path / "string.json"
        filepath.write_text(json.dumps("just a string"))
        result = load_tickets_from_file(str(filepath))
        assert result == []
