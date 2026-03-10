"""Tests for mcp_server.locking.file_mutex — file-level advisory lock mutex.

TDD Evidence:
- RED:  Tests written first targeting all 6 acceptance criteria.
- GREEN: file_mutex.py implemented to satisfy each test.
- REFACTOR: Extracted ConnectionLike protocol, clean dataclasses.

Acceptance Criteria Coverage:
  AC1: Advisory lock function accepts a file path and acquires a transaction-scoped lock on its hash
  AC2: Hash function produces consistent int64 keys from file paths using a deterministic algorithm
  AC3: Try-lock variant (pg_try_advisory_xact_lock) returns immediately if lock is held
  AC4: Lock is automatically released when the transaction ends (commit or rollback)
  AC5: File_locks table updated to track active locks for observability
  AC6: Concurrent lock attempts on the same file path correctly serialize or fail-fast
"""

from __future__ import annotations

import struct
import zlib
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from mcp_server.locking.file_mutex import (
    FileConflictError,
    FileLockRecord,
    FileMutex,
    LockAcquireResult,
    file_path_to_lock_key,
)

# ---------------------------------------------------------------------------
# Helpers — mock connection builder
# ---------------------------------------------------------------------------

def _make_mock_conn(
    *,
    fetchval_return: Any = True,
    fetchval_side_effect: Exception | None = None,
    fetch_return: list[dict[str, Any]] | None = None,
    execute_return: str = "SELECT 1",
) -> AsyncMock:
    """Build an AsyncMock that satisfies the ConnectionLike protocol."""
    conn = AsyncMock()
    if fetchval_side_effect:
        conn.fetchval = AsyncMock(side_effect=fetchval_side_effect)
    else:
        conn.fetchval = AsyncMock(return_value=fetchval_return)

    conn.execute = AsyncMock(return_value=execute_return)
    conn.fetch = AsyncMock(return_value=fetch_return or [])
    conn.fetchrow = AsyncMock(return_value=None)
    return conn


# ===========================================================================
# AC2: Hash function produces consistent int64 keys
# ===========================================================================


class TestFilePathToLockKey:
    """AC2: Hash function produces consistent int64 keys from file paths."""

    def test_deterministic_same_path(self) -> None:
        """Same path always produces the same key."""
        key1 = file_path_to_lock_key("src/db/pool.py")
        key2 = file_path_to_lock_key("src/db/pool.py")
        assert key1 == key2

    def test_different_paths_different_keys(self) -> None:
        """Different paths produce different keys."""
        key1 = file_path_to_lock_key("src/db/pool.py")
        key2 = file_path_to_lock_key("src/db/connection.py")
        assert key1 != key2

    def test_returns_signed_int64(self) -> None:
        """Result fits in a signed 64-bit integer (PostgreSQL bigint)."""
        key = file_path_to_lock_key("src/db/pool.py")
        assert -(2**63) <= key < 2**63

    def test_empty_path_raises(self) -> None:
        """Empty file path raises ValueError."""
        with pytest.raises(ValueError, match="must not be empty"):
            file_path_to_lock_key("")

    def test_whitespace_only_raises(self) -> None:
        """Whitespace-only file path raises ValueError after normalization."""
        with pytest.raises(ValueError, match="must not be empty"):
            file_path_to_lock_key("   ")

    def test_leading_slash_normalized(self) -> None:
        """Leading slashes are stripped so '/a/b.py' == 'a/b.py'."""
        key1 = file_path_to_lock_key("/src/db/pool.py")
        key2 = file_path_to_lock_key("src/db/pool.py")
        assert key1 == key2

    def test_trailing_slash_normalized(self) -> None:
        """Trailing slashes are stripped."""
        key1 = file_path_to_lock_key("src/db/pool.py/")
        key2 = file_path_to_lock_key("src/db/pool.py")
        assert key1 == key2

    def test_namespace_embedded(self) -> None:
        """The FORG namespace (0x464F5247) is in the upper 32 bits."""
        key = file_path_to_lock_key("test.py")
        # Convert signed int64 back to unsigned for inspection.
        unsigned = struct.unpack(">Q", struct.pack(">q", key))[0]
        upper = (unsigned >> 32) & 0xFFFFFFFF
        assert upper == 0x464F5247

    def test_known_hash_value(self) -> None:
        """Verify against a precomputed value for regression."""
        # Compute expected:
        normalized = "src/db/pool.py"
        path_hash = zlib.crc32(normalized.encode("utf-8")) & 0xFFFFFFFF
        namespace = 0x464F5247
        combined = (namespace << 32) | path_hash
        expected = struct.unpack(">q", struct.pack(">Q", combined))[0]
        assert file_path_to_lock_key("src/db/pool.py") == expected

    def test_case_sensitivity(self) -> None:
        """File paths are case-sensitive (unix convention)."""
        key_lower = file_path_to_lock_key("src/Db/Pool.py")
        key_upper = file_path_to_lock_key("src/db/pool.py")
        assert key_lower != key_upper


# ===========================================================================
# AC1: Advisory lock function acquires transaction-scoped lock on hash
# ===========================================================================


class TestFileMutexAcquire:
    """AC1: Advisory lock acquires a transaction-scoped lock on the file path hash."""

    @pytest.mark.asyncio
    async def test_acquire_calls_advisory_xact_lock(self) -> None:
        """acquire() invokes pg_advisory_xact_lock with the correct key."""
        conn = _make_mock_conn()
        mutex = FileMutex(conn)

        result = await mutex.acquire("src/db/pool.py", "TICKET-001")

        expected_key = file_path_to_lock_key("src/db/pool.py")
        conn.execute.assert_any_call(
            "SELECT pg_advisory_xact_lock($1)", expected_key
        )
        assert result.acquired is True
        assert result.file_path == "src/db/pool.py"
        assert result.lock_key == expected_key
        assert result.ticket_id == "TICKET-001"

    @pytest.mark.asyncio
    async def test_acquire_returns_lock_acquire_result(self) -> None:
        """acquire() returns a LockAcquireResult dataclass."""
        conn = _make_mock_conn()
        mutex = FileMutex(conn)

        result = await mutex.acquire("src/test.py", "TICKET-002")

        assert isinstance(result, LockAcquireResult)
        assert result.acquired is True

    @pytest.mark.asyncio
    async def test_acquire_records_in_file_locks_table(self) -> None:
        """acquire() inserts an observability record into file_locks."""
        conn = _make_mock_conn()
        mutex = FileMutex(conn)

        await mutex.acquire(
            "src/db/pool.py", "TICKET-001",
            agent_id="agent-uuid", machine_id="pop-os",
        )

        # The second execute call should be the INSERT into file_locks.
        assert conn.execute.call_count >= 2
        insert_call = conn.execute.call_args_list[1]
        assert "INSERT INTO file_locks" in insert_call.args[0]
        assert insert_call.args[1] == "src/db/pool.py"
        assert insert_call.args[2] == "TICKET-001"
        assert insert_call.args[3] == "agent-uuid"
        assert insert_call.args[4] == "pop-os"

    @pytest.mark.asyncio
    async def test_acquire_with_none_optional_args(self) -> None:
        """acquire() works with agent_id=None and machine_id=None."""
        conn = _make_mock_conn()
        mutex = FileMutex(conn)

        result = await mutex.acquire("src/test.py", "TICKET-003")

        assert result.acquired is True
        # INSERT call should have None for agent_id and machine_id.
        insert_call = conn.execute.call_args_list[1]
        assert insert_call.args[3] is None
        assert insert_call.args[4] is None


# ===========================================================================
# AC3: Try-lock variant returns immediately if lock is held
# ===========================================================================


class TestFileMutexTryAcquire:
    """AC3: pg_try_advisory_xact_lock returns immediately on conflict."""

    @pytest.mark.asyncio
    async def test_try_acquire_success(self) -> None:
        """try_acquire() returns acquired=True when lock is available."""
        conn = _make_mock_conn(fetchval_return=True)
        mutex = FileMutex(conn)

        result = await mutex.try_acquire("src/db/pool.py", "TICKET-001")

        expected_key = file_path_to_lock_key("src/db/pool.py")
        conn.fetchval.assert_called_once_with(
            "SELECT pg_try_advisory_xact_lock($1)", expected_key
        )
        assert result.acquired is True
        assert result.lock_key == expected_key

    @pytest.mark.asyncio
    async def test_try_acquire_failure(self) -> None:
        """try_acquire() returns acquired=False when lock is held."""
        conn = _make_mock_conn(fetchval_return=False)
        mutex = FileMutex(conn)

        result = await mutex.try_acquire("src/db/pool.py", "TICKET-002")

        assert result.acquired is False
        assert result.file_path == "src/db/pool.py"

    @pytest.mark.asyncio
    async def test_try_acquire_no_record_on_failure(self) -> None:
        """try_acquire() does NOT insert into file_locks when lock fails."""
        conn = _make_mock_conn(fetchval_return=False)
        mutex = FileMutex(conn)

        await mutex.try_acquire("src/db/pool.py", "TICKET-002")

        # execute should NOT have been called for INSERT.
        conn.execute.assert_not_called()

    @pytest.mark.asyncio
    async def test_try_acquire_records_on_success(self) -> None:
        """try_acquire() inserts file_locks record when lock succeeds."""
        conn = _make_mock_conn(fetchval_return=True)
        mutex = FileMutex(conn)

        await mutex.try_acquire(
            "src/db/pool.py", "TICKET-001",
            agent_id="agent-1", machine_id="host-1",
        )

        # INSERT into file_locks should have been called.
        conn.execute.assert_called_once()
        insert_call = conn.execute.call_args
        assert "INSERT INTO file_locks" in insert_call.args[0]


# ===========================================================================
# AC4: Lock released when transaction ends
# ===========================================================================


class TestAdvisoryLockTransactionScope:
    """AC4: Advisory locks are transaction-scoped (auto-released on commit/rollback).

    This is a PostgreSQL guarantee, but we verify our code uses the
    transaction-scoped variants (*_xact_*) not session-scoped ones.
    """

    @pytest.mark.asyncio
    async def test_acquire_uses_xact_variant(self) -> None:
        """acquire() uses pg_advisory_xact_lock (not pg_advisory_lock)."""
        conn = _make_mock_conn()
        mutex = FileMutex(conn)

        await mutex.acquire("src/test.py", "TICKET-001")

        execute_calls = [c.args[0] for c in conn.execute.call_args_list]
        advisory_calls = [c for c in execute_calls if "advisory" in c]
        assert len(advisory_calls) == 1
        assert "pg_advisory_xact_lock" in advisory_calls[0]
        # Must NOT use session-scoped variant.
        assert "pg_advisory_lock(" not in advisory_calls[0].replace("_xact_", "_BLOCKED_")

    @pytest.mark.asyncio
    async def test_try_acquire_uses_xact_variant(self) -> None:
        """try_acquire() uses pg_try_advisory_xact_lock."""
        conn = _make_mock_conn(fetchval_return=True)
        mutex = FileMutex(conn)

        await mutex.try_acquire("src/test.py", "TICKET-001")

        fetchval_calls = [c.args[0] for c in conn.fetchval.call_args_list]
        advisory_calls = [c for c in fetchval_calls if "advisory" in c]
        assert len(advisory_calls) == 1
        assert "pg_try_advisory_xact_lock" in advisory_calls[0]


# ===========================================================================
# AC5: file_locks table updated for observability
# ===========================================================================


class TestFileLockObservability:
    """AC5: file_locks table updated for observability tracking."""

    @pytest.mark.asyncio
    async def test_release_ticket_locks(self) -> None:
        """release_ticket_locks() sets released_at on active locks."""
        conn = _make_mock_conn(
            fetch_return=[
                {"file_path": "src/a.py"},
                {"file_path": "src/b.py"},
            ]
        )
        mutex = FileMutex(conn)

        released = await mutex.release_ticket_locks("TICKET-001")

        assert released == ["src/a.py", "src/b.py"]
        conn.fetch.assert_called_once()
        query = conn.fetch.call_args.args[0]
        assert "UPDATE file_locks" in query
        assert "released_at = NOW()" in query
        assert "ticket_id = $1" in query

    @pytest.mark.asyncio
    async def test_release_no_active_locks(self) -> None:
        """release_ticket_locks() returns empty list when no locks exist."""
        conn = _make_mock_conn(fetch_return=[])
        mutex = FileMutex(conn)

        released = await mutex.release_ticket_locks("TICKET-999")

        assert released == []

    @pytest.mark.asyncio
    async def test_get_active_locks(self) -> None:
        """get_active_locks() returns FileLockRecord for each active lock."""
        now = datetime.now(timezone.utc)
        conn = _make_mock_conn(
            fetch_return=[
                {
                    "file_path": "src/db/pool.py",
                    "ticket_id": "TICKET-001",
                    "locked_by": "agent-uuid",
                    "machine_id": "pop-os",
                    "locked_at": now,
                },
            ]
        )
        mutex = FileMutex(conn)

        locks = await mutex.get_active_locks("TICKET-001")

        assert len(locks) == 1
        assert isinstance(locks[0], FileLockRecord)
        assert locks[0].file_path == "src/db/pool.py"
        assert locks[0].ticket_id == "TICKET-001"
        assert locks[0].locked_by == "agent-uuid"
        assert locks[0].machine_id == "pop-os"
        assert locks[0].locked_at == now

    @pytest.mark.asyncio
    async def test_check_conflicts_found(self) -> None:
        """check_conflicts() returns records for files locked by other tickets."""
        now = datetime.now(timezone.utc)
        conn = _make_mock_conn(
            fetch_return=[
                {
                    "file_path": "src/db/pool.py",
                    "ticket_id": "TICKET-OTHER",
                    "locked_by": "other-agent",
                    "machine_id": "other-host",
                    "locked_at": now,
                },
            ]
        )
        mutex = FileMutex(conn)

        conflicts = await mutex.check_conflicts(
            ["src/db/pool.py"], "TICKET-001"
        )

        assert len(conflicts) == 1
        assert conflicts[0].ticket_id == "TICKET-OTHER"
        query = conn.fetch.call_args.args[0]
        assert "ticket_id <> $2" in query

    @pytest.mark.asyncio
    async def test_check_conflicts_empty_paths(self) -> None:
        """check_conflicts() returns empty list for empty file paths."""
        conn = _make_mock_conn()
        mutex = FileMutex(conn)

        conflicts = await mutex.check_conflicts([], "TICKET-001")

        assert conflicts == []
        conn.fetch.assert_not_called()

    @pytest.mark.asyncio
    async def test_check_conflicts_no_conflicts(self) -> None:
        """check_conflicts() returns empty list when no conflicts exist."""
        conn = _make_mock_conn(fetch_return=[])
        mutex = FileMutex(conn)

        conflicts = await mutex.check_conflicts(
            ["src/db/pool.py"], "TICKET-001"
        )

        assert conflicts == []


# ===========================================================================
# AC6: Concurrent lock attempts serialize or fail-fast
# ===========================================================================


class TestConcurrentLockBehavior:
    """AC6: Concurrent lock attempts correctly serialize or fail-fast."""

    @pytest.mark.asyncio
    async def test_same_key_produces_same_advisory_lock(self) -> None:
        """Two acquire() calls on the same path use the same lock key."""
        conn1 = _make_mock_conn()
        conn2 = _make_mock_conn()
        mutex1 = FileMutex(conn1)
        mutex2 = FileMutex(conn2)

        result1 = await mutex1.acquire("src/db/pool.py", "TICKET-A")
        result2 = await mutex2.acquire("src/db/pool.py", "TICKET-B")

        assert result1.lock_key == result2.lock_key

    @pytest.mark.asyncio
    async def test_try_acquire_serializes_on_conflict(self) -> None:
        """Second try_acquire() returns acquired=False when lock is held."""
        # First connection acquires successfully.
        conn1 = _make_mock_conn(fetchval_return=True)
        mutex1 = FileMutex(conn1)
        result1 = await mutex1.try_acquire("src/locked.py", "TICKET-A")
        assert result1.acquired is True

        # Second connection finds lock held.
        conn2 = _make_mock_conn(fetchval_return=False)
        mutex2 = FileMutex(conn2)
        result2 = await mutex2.try_acquire("src/locked.py", "TICKET-B")
        assert result2.acquired is False

    @pytest.mark.asyncio
    async def test_different_files_no_conflict(self) -> None:
        """Advisory locks on different files don't conflict."""
        conn = _make_mock_conn(fetchval_return=True)
        mutex = FileMutex(conn)

        r1 = await mutex.try_acquire("src/a.py", "TICKET-A")
        r2 = await mutex.try_acquire("src/b.py", "TICKET-B")

        assert r1.acquired is True
        assert r2.acquired is True
        assert r1.lock_key != r2.lock_key


# ===========================================================================
# FileConflictError tests
# ===========================================================================


class TestFileConflictError:
    """FileConflictError is a structured domain error."""

    def test_basic_message(self) -> None:
        err = FileConflictError("src/db/pool.py", "TICKET-A")
        assert "src/db/pool.py" in str(err)
        assert "TICKET-A" in str(err)
        assert err.file_path == "src/db/pool.py"
        assert err.ticket_id == "TICKET-A"
        assert err.held_by_ticket is None

    def test_message_with_holder(self) -> None:
        err = FileConflictError("src/db/pool.py", "TICKET-A", held_by_ticket="TICKET-B")
        assert "held by TICKET-B" in str(err)
        assert err.held_by_ticket == "TICKET-B"

    def test_is_exception(self) -> None:
        assert issubclass(FileConflictError, Exception)


# ===========================================================================
# LockAcquireResult / FileLockRecord dataclass tests
# ===========================================================================


class TestDataclasses:
    """Frozen dataclasses for type safety."""

    def test_lock_acquire_result_frozen(self) -> None:
        r = LockAcquireResult(acquired=True, file_path="a.py", lock_key=42, ticket_id="T1")
        with pytest.raises(AttributeError):
            r.acquired = False  # type: ignore[misc]

    def test_file_lock_record_frozen(self) -> None:
        now = datetime.now(timezone.utc)
        r = FileLockRecord(
            file_path="a.py", ticket_id="T1",
            locked_by=None, machine_id=None, locked_at=now,
        )
        with pytest.raises(AttributeError):
            r.file_path = "b.py"  # type: ignore[misc]

    def test_lock_acquire_result_fields(self) -> None:
        r = LockAcquireResult(acquired=False, file_path="x.py", lock_key=99, ticket_id="T2")
        assert r.acquired is False
        assert r.file_path == "x.py"
        assert r.lock_key == 99
        assert r.ticket_id == "T2"


# ===========================================================================
# Import / re-export tests
# ===========================================================================


class TestImports:
    """Verify public API is accessible from the package."""

    def test_import_from_package(self) -> None:
        from mcp_server.locking import (
            FileConflictError,
            FileLockRecord,
            FileMutex,
            LockAcquireResult,
            file_path_to_lock_key,
        )
        assert FileMutex is not None
        assert file_path_to_lock_key is not None
        assert LockAcquireResult is not None
        assert FileLockRecord is not None
        assert FileConflictError is not None


# ===========================================================================
# QA-added: Additional mutation-killing & edge-case tests
# ===========================================================================


class TestFilePathToLockKeyQA:
    """QA-added: strengthen mutation resistance for hash function."""

    def test_known_hash_hardcoded_literal(self) -> None:
        """Regression test with a hardcoded expected value (kills mask mutations)."""
        # Pre-computed: file_path_to_lock_key("test.py")
        # CRC32("test.py") = 0xb368c3ff, namespace = 0x464F5247
        # combined unsigned = 0x464F5247b368c3ff
        # signed int64 = 5071476839756268543
        expected = struct.unpack(
            ">q", struct.pack(">Q", 0x464F5247B368C3FF)
        )[0]
        assert file_path_to_lock_key("test.py") == expected

    def test_hash_odd_crc_bit0_preserved(self) -> None:
        """CRC32 with LSB=1 must preserve that bit (kills 0xFFFFFFFE mask mutation)."""
        # "test.py" has CRC32 = 0xb368c3ff (LSB=1)
        key = file_path_to_lock_key("test.py")
        unsigned = struct.unpack(">Q", struct.pack(">q", key))[0]
        lower32 = unsigned & 0xFFFFFFFF
        assert lower32 & 1 == 1, "LSB must be preserved from CRC32"

    def test_unicode_path(self) -> None:
        """Unicode file paths produce valid int64 keys."""
        key = file_path_to_lock_key("src/데이터/файл.py")
        assert -(2**63) <= key < 2**63

    def test_very_long_path(self) -> None:
        """Very long file paths produce valid int64 keys."""
        long_path = "a/" * 500 + "file.py"
        key = file_path_to_lock_key(long_path)
        assert -(2**63) <= key < 2**63

    def test_slash_only_raises(self) -> None:
        """A path of only slashes raises ValueError after normalization."""
        with pytest.raises(ValueError, match="must not be empty"):
            file_path_to_lock_key("///")

    def test_dot_paths_distinct(self) -> None:
        """Relative path components produce distinct keys."""
        k1 = file_path_to_lock_key("a/b/c.py")
        k2 = file_path_to_lock_key("a/b/../b/c.py")
        # These are different strings, so different keys (no path resolution)
        assert k1 != k2


class TestFileMutexAcquireQA:
    """QA-added: edge cases for acquire() and try_acquire()."""

    @pytest.mark.asyncio
    async def test_acquire_propagates_db_error(self) -> None:
        """Database errors during advisory lock propagate as exceptions."""
        conn = _make_mock_conn()
        conn.execute = AsyncMock(side_effect=RuntimeError("connection lost"))
        mutex = FileMutex(conn)

        with pytest.raises(RuntimeError, match="connection lost"):
            await mutex.acquire("src/test.py", "TICKET-ERR")

    @pytest.mark.asyncio
    async def test_try_acquire_propagates_db_error(self) -> None:
        """Database errors during try_acquire propagate as exceptions."""
        conn = _make_mock_conn(fetchval_side_effect=RuntimeError("timeout"))
        mutex = FileMutex(conn)

        with pytest.raises(RuntimeError, match="timeout"):
            await mutex.try_acquire("src/test.py", "TICKET-ERR")

    @pytest.mark.asyncio
    async def test_acquire_sql_insert_uses_on_conflict(self) -> None:
        """The INSERT into file_locks uses ON CONFLICT DO NOTHING."""
        conn = _make_mock_conn()
        mutex = FileMutex(conn)

        await mutex.acquire("src/test.py", "TICKET-001")

        insert_call = conn.execute.call_args_list[1]
        assert "ON CONFLICT" in insert_call.args[0]
        assert "DO NOTHING" in insert_call.args[0]

    @pytest.mark.asyncio
    async def test_release_ticket_locks_sql_filters_released(self) -> None:
        """release_ticket_locks only targets rows where released_at IS NULL."""
        conn = _make_mock_conn(fetch_return=[])
        mutex = FileMutex(conn)

        await mutex.release_ticket_locks("TICKET-001")

        query = conn.fetch.call_args.args[0]
        assert "released_at IS NULL" in query

    @pytest.mark.asyncio
    async def test_get_active_locks_empty(self) -> None:
        """get_active_locks returns empty list when no locks exist."""
        conn = _make_mock_conn(fetch_return=[])
        mutex = FileMutex(conn)

        locks = await mutex.get_active_locks("TICKET-999")

        assert locks == []

    @pytest.mark.asyncio
    async def test_get_active_locks_multiple(self) -> None:
        """get_active_locks returns multiple records correctly."""
        now = datetime.now(timezone.utc)
        conn = _make_mock_conn(fetch_return=[
            {"file_path": "a.py", "ticket_id": "T1", "locked_by": None, "machine_id": None, "locked_at": now},
            {"file_path": "b.py", "ticket_id": "T1", "locked_by": "ag", "machine_id": "h1", "locked_at": now},
        ])
        mutex = FileMutex(conn)

        locks = await mutex.get_active_locks("T1")

        assert len(locks) == 2
        assert locks[0].file_path == "a.py"
        assert locks[1].locked_by == "ag"
