"""Cleanup utilities for the filesystem-to-database migration.

Provides :class:`MigrationCleanup` — an archival tool that moves the
legacy ``.github/ticket-state/`` and ``.github/tickets/`` directories
to a timestamped archive location, completing the Phase D deprecation.

The cleanup is **non-destructive**: files are *moved* (not deleted) to
``{archive_dir}/{timestamp}/`` so they can be restored if needed.

Usage::

    cleanup = MigrationCleanup(
        ticket_state_dir=Path(".github/ticket-state"),
        tickets_dir=Path(".github/tickets"),
        archive_dir=Path(".github/archive/migration"),
    )
    result = await cleanup.archive()
    print(result.archived_files)
"""

from __future__ import annotations

import shutil
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from mcp_server.observability import get_logger

logger = get_logger("migration.cleanup")


# ---------------------------------------------------------------------------
# Result types
# ---------------------------------------------------------------------------


@dataclass
class ArchiveResult:
    """Result of an archival operation.

    Attributes:
        success: Whether the archive operation completed successfully.
        archive_path: The destination directory where files were moved.
        archived_files: Number of files archived.
        archived_dirs: Number of directories archived.
        errors: Errors encountered during archival.
        timestamp: ISO-8601 timestamp of the archive operation.
    """

    success: bool = False
    archive_path: str = ""
    archived_files: int = 0
    archived_dirs: int = 0
    errors: list[str] = field(default_factory=list)
    timestamp: str = ""

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dictionary."""
        return {
            "success": self.success,
            "archive_path": self.archive_path,
            "archived_files": self.archived_files,
            "archived_dirs": self.archived_dirs,
            "errors": self.errors,
            "timestamp": self.timestamp,
        }


# ---------------------------------------------------------------------------
# Cleanup configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CleanupConfig:
    """Settings for migration cleanup.

    Attributes:
        ticket_state_dir: Path to ``.github/ticket-state/``.
        tickets_dir: Path to ``.github/tickets/``.
        archive_dir: Base directory for archived data
            (default ``.github/archive/migration``).
    """

    ticket_state_dir: Path
    tickets_dir: Path
    archive_dir: Path = Path(".github/archive/migration")


# ---------------------------------------------------------------------------
# Cleanup implementation
# ---------------------------------------------------------------------------


class MigrationCleanup:
    """Archives filesystem ticket state for Phase D deprecation.

    Moves ``.github/ticket-state/`` and ``.github/tickets/`` into a
    timestamped subdirectory of ``archive_dir``.

    Args:
        config: Cleanup configuration with source and destination paths.
    """

    def __init__(self, config: CleanupConfig) -> None:
        self._config = config

    async def archive(self) -> ArchiveResult:
        """Archive the filesystem ticket state directories.

        Creates a timestamped subdirectory in the archive dir and moves
        both ``ticket-state/`` and ``tickets/`` into it.

        Returns:
            :class:`ArchiveResult` with operation outcome.
        """
        now = datetime.now(timezone.utc)
        now_iso = now.isoformat()
        timestamp_slug = now.strftime("%Y%m%dT%H%M%SZ")

        dest = self._config.archive_dir / timestamp_slug
        dest.mkdir(parents=True, exist_ok=True)

        errors: list[str] = []
        total_files = 0
        total_dirs = 0

        # Archive ticket-state directory
        files, dirs, errs = self._move_directory(
            self._config.ticket_state_dir,
            dest / "ticket-state",
        )
        total_files += files
        total_dirs += dirs
        errors.extend(errs)

        # Archive tickets directory
        files, dirs, errs = self._move_directory(
            self._config.tickets_dir,
            dest / "tickets",
        )
        total_files += files
        total_dirs += dirs
        errors.extend(errs)

        success = len(errors) == 0

        result = ArchiveResult(
            success=success,
            archive_path=str(dest),
            archived_files=total_files,
            archived_dirs=total_dirs,
            errors=errors,
            timestamp=now_iso,
        )

        if success:
            logger.info(
                "Migration cleanup completed — filesystem ticket state archived",
                extra={
                    "archive_path": str(dest),
                    "archived_files": total_files,
                    "archived_dirs": total_dirs,
                    "timestamp": now_iso,
                },
            )
        else:
            logger.error(
                "Migration cleanup completed with errors",
                extra={
                    "archive_path": str(dest),
                    "archived_files": total_files,
                    "archived_dirs": total_dirs,
                    "errors": errors,
                    "timestamp": now_iso,
                },
            )

        return result

    def _move_directory(
        self,
        source: Path,
        destination: Path,
    ) -> tuple[int, int, list[str]]:
        """Move *source* directory to *destination*.

        Returns:
            Tuple of (files_moved, dirs_moved, errors).
        """
        errors: list[str] = []

        if not source.exists():
            logger.info(
                "Source directory does not exist — nothing to archive",
                extra={"source": str(source)},
            )
            return 0, 0, errors

        if not source.is_dir():
            errors.append(f"Source is not a directory: {source}")
            return 0, 0, errors

        # Count files and directories before moving
        file_count = sum(1 for _ in source.rglob("*") if _.is_file())
        dir_count = sum(1 for _ in source.rglob("*") if _.is_dir())

        try:
            shutil.copytree(str(source), str(destination))
            shutil.rmtree(str(source))
        except OSError as exc:
            errors.append(f"Failed to archive {source}: {exc}")
            return 0, 0, errors

        logger.info(
            "Directory archived",
            extra={
                "source": str(source),
                "destination": str(destination),
                "files": file_count,
                "dirs": dir_count,
            },
        )
        return file_count, dir_count, errors

    async def verify_archive(self, archive_path: str) -> dict[str, Any]:
        """Verify an archive exists and contains expected content.

        Args:
            archive_path: Path to the archive directory to verify.

        Returns:
            Dict with verification results including ``valid``,
            ``archive_path``, ``ticket_state_archived``,
            ``tickets_archived``, and ``total_files``.
        """
        path = Path(archive_path)
        if not path.exists():
            return {"valid": False, "error": "Archive path does not exist"}

        ticket_state_archived = (path / "ticket-state").exists()
        tickets_archived = (path / "tickets").exists()

        file_count = sum(1 for _ in path.rglob("*") if _.is_file())

        return {
            "valid": ticket_state_archived or tickets_archived,
            "archive_path": str(path),
            "ticket_state_archived": ticket_state_archived,
            "tickets_archived": tickets_archived,
            "total_files": file_count,
        }
