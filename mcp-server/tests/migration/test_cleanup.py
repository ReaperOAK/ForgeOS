"""Tests for mcp_server.migration.cleanup."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from mcp_server.migration.cleanup import (
    ArchiveResult,
    CleanupConfig,
    MigrationCleanup,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _create_ticket_state(base: Path) -> None:
    """Create a mock .github/ticket-state/ directory tree."""
    for stage in ("READY", "BACKEND", "QA", "DONE"):
        stage_dir = base / stage
        stage_dir.mkdir(parents=True, exist_ok=True)
        ticket = {"ticket_id": f"T-{stage}", "stage": stage}
        (stage_dir / f"T-{stage}.json").write_text(
            json.dumps(ticket), encoding="utf-8"
        )


def _create_tickets(base: Path) -> None:
    """Create a mock .github/tickets/ directory with sample tickets."""
    base.mkdir(parents=True, exist_ok=True)
    for i in range(3):
        ticket = {"ticket_id": f"T-{i:03d}", "stage": "DONE"}
        (base / f"T-{i:03d}.json").write_text(
            json.dumps(ticket), encoding="utf-8"
        )


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def ticket_state_dir(tmp_path: Path) -> Path:
    d = tmp_path / ".github" / "ticket-state"
    _create_ticket_state(d)
    return d


@pytest.fixture()
def tickets_dir(tmp_path: Path) -> Path:
    d = tmp_path / ".github" / "tickets"
    _create_tickets(d)
    return d


@pytest.fixture()
def archive_dir(tmp_path: Path) -> Path:
    return tmp_path / ".github" / "archive" / "migration"


@pytest.fixture()
def cleanup_config(
    ticket_state_dir: Path,
    tickets_dir: Path,
    archive_dir: Path,
) -> CleanupConfig:
    return CleanupConfig(
        ticket_state_dir=ticket_state_dir,
        tickets_dir=tickets_dir,
        archive_dir=archive_dir,
    )


@pytest.fixture()
def cleanup(cleanup_config: CleanupConfig) -> MigrationCleanup:
    return MigrationCleanup(cleanup_config)


# ---------------------------------------------------------------------------
# Tests — Archive operation (AC2)
# ---------------------------------------------------------------------------


class TestArchiveOperation:
    """AC2: Cleanup script archives ticket-state and tickets."""

    @pytest.mark.asyncio
    async def test_archive_succeeds(self, cleanup: MigrationCleanup) -> None:
        result = await cleanup.archive()
        assert isinstance(result, ArchiveResult)
        assert result.success is True

    @pytest.mark.asyncio
    async def test_archive_creates_timestamped_dir(
        self, cleanup: MigrationCleanup, archive_dir: Path
    ) -> None:
        result = await cleanup.archive()
        assert result.archive_path != ""
        dest = Path(result.archive_path)
        assert dest.exists()
        assert dest.parent == archive_dir

    @pytest.mark.asyncio
    async def test_archive_moves_ticket_state(
        self,
        cleanup: MigrationCleanup,
        ticket_state_dir: Path,
    ) -> None:
        result = await cleanup.archive()
        # Source should be gone
        assert not ticket_state_dir.exists()
        # Destination should exist
        dest = Path(result.archive_path)
        assert (dest / "ticket-state").exists()

    @pytest.mark.asyncio
    async def test_archive_moves_tickets(
        self,
        cleanup: MigrationCleanup,
        tickets_dir: Path,
    ) -> None:
        result = await cleanup.archive()
        assert not tickets_dir.exists()
        dest = Path(result.archive_path)
        assert (dest / "tickets").exists()

    @pytest.mark.asyncio
    async def test_archive_counts_files(
        self, cleanup: MigrationCleanup
    ) -> None:
        result = await cleanup.archive()
        # 4 stage dirs x 1 ticket each = 4 files in ticket-state
        # 3 tickets in tickets/
        assert result.archived_files == 7

    @pytest.mark.asyncio
    async def test_archive_counts_dirs(
        self, cleanup: MigrationCleanup
    ) -> None:
        result = await cleanup.archive()
        # 4 stage subdirs
        assert result.archived_dirs == 4

    @pytest.mark.asyncio
    async def test_archive_records_timestamp(
        self, cleanup: MigrationCleanup
    ) -> None:
        result = await cleanup.archive()
        assert result.timestamp != ""
        from datetime import datetime

        datetime.fromisoformat(result.timestamp)


# ---------------------------------------------------------------------------
# Tests — Missing source directories
# ---------------------------------------------------------------------------


class TestMissingSourceDirs:
    """Handle missing source directories gracefully."""

    @pytest.mark.asyncio
    async def test_missing_ticket_state_dir(
        self, tmp_path: Path
    ) -> None:
        config = CleanupConfig(
            ticket_state_dir=tmp_path / "nonexistent-state",
            tickets_dir=tmp_path / "nonexistent-tickets",
            archive_dir=tmp_path / "archive",
        )
        cleanup = MigrationCleanup(config)
        result = await cleanup.archive()
        assert result.success is True
        assert result.archived_files == 0
        assert result.archived_dirs == 0

    @pytest.mark.asyncio
    async def test_only_tickets_dir_exists(
        self, tmp_path: Path
    ) -> None:
        tickets = tmp_path / "tickets"
        _create_tickets(tickets)
        config = CleanupConfig(
            ticket_state_dir=tmp_path / "nonexistent-state",
            tickets_dir=tickets,
            archive_dir=tmp_path / "archive",
        )
        cleanup = MigrationCleanup(config)
        result = await cleanup.archive()
        assert result.success is True
        assert result.archived_files == 3

    @pytest.mark.asyncio
    async def test_only_ticket_state_dir_exists(
        self, tmp_path: Path
    ) -> None:
        state = tmp_path / "ticket-state"
        _create_ticket_state(state)
        config = CleanupConfig(
            ticket_state_dir=state,
            tickets_dir=tmp_path / "nonexistent-tickets",
            archive_dir=tmp_path / "archive",
        )
        cleanup = MigrationCleanup(config)
        result = await cleanup.archive()
        assert result.success is True
        assert result.archived_files == 4


# ---------------------------------------------------------------------------
# Tests — Archive verification
# ---------------------------------------------------------------------------


class TestVerifyArchive:
    """Verify archive contents after archival."""

    @pytest.mark.asyncio
    async def test_verify_archive_after_archive(
        self, cleanup: MigrationCleanup
    ) -> None:
        result = await cleanup.archive()
        verification = await cleanup.verify_archive(result.archive_path)
        assert verification["valid"] is True
        assert verification["ticket_state_archived"] is True
        assert verification["tickets_archived"] is True
        assert verification["total_files"] == 7

    @pytest.mark.asyncio
    async def test_verify_nonexistent_archive(
        self, cleanup: MigrationCleanup
    ) -> None:
        verification = await cleanup.verify_archive("/nonexistent/path")
        assert verification["valid"] is False


# ---------------------------------------------------------------------------
# Tests — ArchiveResult serialization
# ---------------------------------------------------------------------------


class TestArchiveResultSerialization:
    """ArchiveResult.to_dict() produces valid dict."""

    def test_to_dict(self) -> None:
        result = ArchiveResult(
            success=True,
            archive_path="/tmp/archive/20260312T120000Z",
            archived_files=10,
            archived_dirs=3,
            errors=[],
            timestamp="2026-03-12T12:00:00Z",
        )
        d = result.to_dict()
        assert d["success"] is True
        assert d["archived_files"] == 10
        assert d["archive_path"] == "/tmp/archive/20260312T120000Z"

    def test_to_dict_with_errors(self) -> None:
        result = ArchiveResult(
            success=False,
            archive_path="/tmp/archive",
            errors=["Error 1"],
        )
        d = result.to_dict()
        assert d["success"] is False
        assert len(d["errors"]) == 1


# ---------------------------------------------------------------------------
# Tests — File as source (not directory)
# ---------------------------------------------------------------------------


class TestFileAsSource:
    """Handle file (not directory) passed as source."""

    @pytest.mark.asyncio
    async def test_file_as_source_produces_error(
        self, tmp_path: Path
    ) -> None:
        # Create a file instead of a directory
        fake = tmp_path / "not-a-dir"
        fake.write_text("not a directory")
        config = CleanupConfig(
            ticket_state_dir=fake,
            tickets_dir=tmp_path / "nonexistent",
            archive_dir=tmp_path / "archive",
        )
        cleanup = MigrationCleanup(config)
        result = await cleanup.archive()
        assert result.success is False
        assert any("not a directory" in e for e in result.errors)
