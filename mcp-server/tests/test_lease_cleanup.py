"""Tests for expired lease detection and release (FORGEOS-BE009).

Covers:
- LeaseCleanupConfig: validation, defaults, frozen immutability
- ExpiredLease: value object integrity
- LeaseRelease: value object integrity
- find_expired_leases: happy path, empty results, DB error
- release_expired_lease: happy path, already released, DB error
- scan_and_release_expired: happy path, partial failures, empty
- LeaseCleanupTask: async context manager lifecycle, start/stop,
  double-start, scan counting, error handling, graceful shutdown

.. meta::
   :ticket: FORGEOS-BE009
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any

import pytest

from mcp_server.locking.lease_cleanup import (
    ExpiredLease,
    LeaseCleanupConfig,
    LeaseCleanupError,
    LeaseCleanupTask,
    LeaseRelease,
    find_expired_leases,
    release_expired_lease,
    scan_and_release_expired,
)
from mcp_server.server import DatabaseError

# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

_AGENT_ID = str(uuid.uuid4())
_AGENT_UUID = uuid.UUID(_AGENT_ID)
_TICKET_ID = "FORGEOS-TEST-009"
_NOW = datetime(2026, 3, 11, 12, 0, 0, tzinfo=timezone.utc)


class FakeConnection:
    """Mock asyncpg connection with configurable responses."""

    def __init__(
        self,
        fetch_result: list[Any] | None = None,
        fetch_side_effect: Exception | None = None,
        execute_result: str = "UPDATE 1",
        execute_side_effect: Exception | None = None,
    ) -> None:
        self._fetch_result = fetch_result if fetch_result is not None else []
        self._fetch_side_effect = fetch_side_effect
        self._execute_result = execute_result
        self._execute_side_effect = execute_side_effect
        self.execute_calls: list[tuple[str, ...]] = []
        self._in_transaction = False

    async def fetch(self, query: str, *args: Any) -> list[Any]:
        if self._fetch_side_effect:
            raise self._fetch_side_effect
        return self._fetch_result

    async def execute(self, query: str, *args: Any) -> str:
        if self._execute_side_effect:
            raise self._execute_side_effect
        self.execute_calls.append((query, *args))
        return self._execute_result

    def transaction(self) -> _FakeTransaction:
        return _FakeTransaction()


class _FakeTransaction:
    """Fake async context manager for a transaction."""

    async def __aenter__(self) -> _FakeTransaction:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        pass


class FakePool:
    """Mock connection pool that yields a FakeConnection."""

    def __init__(self, connection: FakeConnection) -> None:
        self._conn = connection

    @asynccontextmanager
    async def acquire(self):  # type: ignore[override]
        yield self._conn


def _make_expired_row(
    *,
    ticket_id: str = "EXPIRED-001",
    claimed_by: uuid.UUID | None = None,
    claimed_by_name: str = "Backend",
    machine_id: str = "test-host",
    lease_expiry: datetime | None = None,
    last_heartbeat: datetime | None = None,
    stage: str = "BACKEND",
) -> dict[str, Any]:
    """Create a mock row for the expired leases query."""
    return {
        "ticket_id": ticket_id,
        "claimed_by": claimed_by or _AGENT_UUID,
        "claimed_by_name": claimed_by_name,
        "machine_id": machine_id,
        "lease_expiry": lease_expiry or (_NOW - timedelta(minutes=5)),
        "last_heartbeat": last_heartbeat,
        "stage": stage,
    }


def _make_expired_lease(
    *,
    ticket_id: str = "EXPIRED-001",
    agent_id: str | None = None,
    agent_name: str = "Backend",
    machine_id: str = "test-host",
    lease_expiry: datetime | None = None,
    last_heartbeat: datetime | None = None,
    previous_stage: str = "BACKEND",
) -> ExpiredLease:
    """Create an ExpiredLease value object for testing."""
    return ExpiredLease(
        ticket_id=ticket_id,
        agent_id=agent_id or _AGENT_ID,
        agent_name=agent_name,
        machine_id=machine_id,
        lease_expiry=lease_expiry or (_NOW - timedelta(minutes=5)),
        last_heartbeat=last_heartbeat,
        previous_stage=previous_stage,
    )


# ---------------------------------------------------------------------------
# LeaseCleanupConfig tests
# ---------------------------------------------------------------------------


class TestLeaseCleanupConfig:
    """Tests for LeaseCleanupConfig validation and defaults."""

    def test_defaults(self) -> None:
        cfg = LeaseCleanupConfig()
        assert cfg.scan_interval_seconds == 30.0
        assert cfg.batch_size == 100

    def test_custom_values(self) -> None:
        cfg = LeaseCleanupConfig(scan_interval_seconds=15.0, batch_size=50)
        assert cfg.scan_interval_seconds == 15.0
        assert cfg.batch_size == 50

    def test_frozen(self) -> None:
        cfg = LeaseCleanupConfig()
        with pytest.raises(AttributeError):
            cfg.scan_interval_seconds = 10.0  # type: ignore[misc]

    def test_negative_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="scan_interval_seconds must be positive"):
            LeaseCleanupConfig(scan_interval_seconds=-1)

    def test_zero_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="scan_interval_seconds must be positive"):
            LeaseCleanupConfig(scan_interval_seconds=0)

    def test_negative_batch_size_raises(self) -> None:
        with pytest.raises(ValueError, match="batch_size must be positive"):
            LeaseCleanupConfig(batch_size=-1)

    def test_zero_batch_size_raises(self) -> None:
        with pytest.raises(ValueError, match="batch_size must be positive"):
            LeaseCleanupConfig(batch_size=0)


# ---------------------------------------------------------------------------
# ExpiredLease tests
# ---------------------------------------------------------------------------


class TestExpiredLease:
    """Tests for the ExpiredLease frozen dataclass."""

    def test_immutable(self) -> None:
        expired = _make_expired_lease()
        with pytest.raises(AttributeError):
            expired.ticket_id = "changed"  # type: ignore[misc]

    def test_fields(self) -> None:
        lease_exp = _NOW - timedelta(minutes=5)
        hb = _NOW - timedelta(minutes=10)
        expired = ExpiredLease(
            ticket_id="T-1",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            lease_expiry=lease_exp,
            last_heartbeat=hb,
            previous_stage="BACKEND",
        )
        assert expired.ticket_id == "T-1"
        assert expired.agent_id == _AGENT_ID
        assert expired.agent_name == "Backend"
        assert expired.machine_id == "host"
        assert expired.lease_expiry == lease_exp
        assert expired.last_heartbeat == hb
        assert expired.previous_stage == "BACKEND"

    def test_last_heartbeat_none(self) -> None:
        expired = _make_expired_lease(last_heartbeat=None)
        assert expired.last_heartbeat is None


# ---------------------------------------------------------------------------
# LeaseRelease tests
# ---------------------------------------------------------------------------


class TestLeaseRelease:
    """Tests for the LeaseRelease frozen dataclass."""

    def test_immutable(self) -> None:
        release = LeaseRelease(
            ticket_id="T-1",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            released_at=_NOW,
            time_since_expiry_seconds=300.0,
            time_since_last_heartbeat_seconds=600.0,
        )
        with pytest.raises(AttributeError):
            release.ticket_id = "changed"  # type: ignore[misc]

    def test_fields(self) -> None:
        release = LeaseRelease(
            ticket_id="T-1",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            released_at=_NOW,
            time_since_expiry_seconds=300.0,
            time_since_last_heartbeat_seconds=600.0,
        )
        assert release.ticket_id == "T-1"
        assert release.agent_id == _AGENT_ID
        assert release.released_at == _NOW
        assert release.time_since_expiry_seconds == 300.0
        assert release.time_since_last_heartbeat_seconds == 600.0

    def test_no_heartbeat(self) -> None:
        release = LeaseRelease(
            ticket_id="T-1",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            released_at=_NOW,
            time_since_expiry_seconds=300.0,
            time_since_last_heartbeat_seconds=None,
        )
        assert release.time_since_last_heartbeat_seconds is None


# ---------------------------------------------------------------------------
# find_expired_leases tests
# ---------------------------------------------------------------------------


class TestFindExpiredLeases:
    """Tests for the find_expired_leases function."""

    async def test_returns_expired_leases(self) -> None:
        rows = [
            _make_expired_row(ticket_id="EXP-001"),
            _make_expired_row(ticket_id="EXP-002", last_heartbeat=_NOW - timedelta(minutes=20)),
        ]
        conn = FakeConnection(fetch_result=rows)
        pool = FakePool(conn)

        result = await find_expired_leases(pool, _now=_NOW)

        assert len(result) == 2
        assert result[0].ticket_id == "EXP-001"
        assert result[0].last_heartbeat is None
        assert result[1].ticket_id == "EXP-002"
        assert result[1].last_heartbeat == _NOW - timedelta(minutes=20)

    async def test_returns_empty_when_none_expired(self) -> None:
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)

        result = await find_expired_leases(pool, _now=_NOW)

        assert result == []

    async def test_maps_fields_correctly(self) -> None:
        agent_uuid = uuid.uuid4()
        row = _make_expired_row(
            ticket_id="MAP-001",
            claimed_by=agent_uuid,
            claimed_by_name="QA",
            machine_id="build-server",
            stage="QA",
        )
        conn = FakeConnection(fetch_result=[row])
        pool = FakePool(conn)

        result = await find_expired_leases(pool, _now=_NOW)

        assert len(result) == 1
        assert result[0].agent_id == str(agent_uuid)
        assert result[0].agent_name == "QA"
        assert result[0].machine_id == "build-server"
        assert result[0].previous_stage == "QA"

    async def test_handles_null_name_and_machine(self) -> None:
        row = _make_expired_row(claimed_by_name=None, machine_id=None)  # type: ignore[arg-type]
        conn = FakeConnection(fetch_result=[row])
        pool = FakePool(conn)

        result = await find_expired_leases(pool, _now=_NOW)

        assert result[0].agent_name == ""
        assert result[0].machine_id == ""

    async def test_respects_batch_size(self) -> None:
        rows = [_make_expired_row(ticket_id=f"EXP-{i}") for i in range(5)]
        conn = FakeConnection(fetch_result=rows)
        pool = FakePool(conn)

        result = await find_expired_leases(pool, batch_size=5, _now=_NOW)

        assert len(result) == 5

    async def test_database_error_raises(self) -> None:
        conn = FakeConnection(fetch_side_effect=RuntimeError("connection lost"))
        pool = FakePool(conn)

        with pytest.raises(DatabaseError, match="Failed to scan expired leases"):
            await find_expired_leases(pool, _now=_NOW)


# ---------------------------------------------------------------------------
# release_expired_lease tests
# ---------------------------------------------------------------------------


class TestReleaseExpiredLease:
    """Tests for the release_expired_lease function."""

    async def test_successful_release(self) -> None:
        expired = _make_expired_lease(
            ticket_id="REL-001",
            lease_expiry=_NOW - timedelta(minutes=5),
            last_heartbeat=_NOW - timedelta(minutes=10),
        )
        conn = FakeConnection(execute_result="UPDATE 1")
        pool = FakePool(conn)

        release = await release_expired_lease(pool, expired=expired, _now=_NOW)

        assert release.ticket_id == "REL-001"
        assert release.agent_id == expired.agent_id
        assert release.agent_name == expired.agent_name
        assert release.machine_id == expired.machine_id
        assert release.released_at == _NOW
        assert release.time_since_expiry_seconds == pytest.approx(300.0)
        assert release.time_since_last_heartbeat_seconds == pytest.approx(600.0)

    async def test_release_without_heartbeat(self) -> None:
        expired = _make_expired_lease(
            ticket_id="REL-002",
            last_heartbeat=None,
        )
        conn = FakeConnection(execute_result="UPDATE 1")
        pool = FakePool(conn)

        release = await release_expired_lease(pool, expired=expired, _now=_NOW)

        assert release.ticket_id == "REL-002"
        assert release.time_since_last_heartbeat_seconds is None

    async def test_already_released_raises(self) -> None:
        expired = _make_expired_lease(ticket_id="REL-003")
        conn = FakeConnection(execute_result="UPDATE 0")
        pool = FakePool(conn)

        with pytest.raises(LeaseCleanupError, match="already released"):
            await release_expired_lease(pool, expired=expired, _now=_NOW)

    async def test_database_error_raises(self) -> None:
        expired = _make_expired_lease(ticket_id="REL-004")
        conn = FakeConnection(execute_side_effect=RuntimeError("disk full"))
        pool = FakePool(conn)

        with pytest.raises(DatabaseError, match="Failed to release expired lease"):
            await release_expired_lease(pool, expired=expired, _now=_NOW)

    async def test_execute_calls_contain_update_and_insert(self) -> None:
        expired = _make_expired_lease(ticket_id="REL-005")
        conn = FakeConnection(execute_result="UPDATE 1")
        pool = FakePool(conn)

        await release_expired_lease(pool, expired=expired, _now=_NOW)

        # Should have 2 execute calls: UPDATE tickets + INSERT event_history
        assert len(conn.execute_calls) == 2
        update_query = conn.execute_calls[0][0]
        insert_query = conn.execute_calls[1][0]
        assert "UPDATE tickets" in update_query
        assert "claimed_by = NULL" in update_query
        assert "INSERT INTO event_history" in insert_query

    async def test_event_history_uses_released_type(self) -> None:
        expired = _make_expired_lease(ticket_id="REL-006")
        conn = FakeConnection(execute_result="UPDATE 1")
        pool = FakePool(conn)

        await release_expired_lease(pool, expired=expired, _now=_NOW)

        insert_query = conn.execute_calls[1][0]
        assert "'RELEASED'::event_type" in insert_query


# ---------------------------------------------------------------------------
# scan_and_release_expired tests
# ---------------------------------------------------------------------------


class TestScanAndReleaseExpired:
    """Tests for the scan_and_release_expired function."""

    async def test_releases_all_expired(self) -> None:
        rows = [
            _make_expired_row(ticket_id="SCAN-001"),
            _make_expired_row(ticket_id="SCAN-002"),
        ]
        conn = FakeConnection(fetch_result=rows, execute_result="UPDATE 1")
        pool = FakePool(conn)

        releases = await scan_and_release_expired(pool, _now=_NOW)

        assert len(releases) == 2
        assert releases[0].ticket_id == "SCAN-001"
        assert releases[1].ticket_id == "SCAN-002"

    async def test_empty_when_no_expired(self) -> None:
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)

        releases = await scan_and_release_expired(pool, _now=_NOW)

        assert releases == []

    async def test_skips_already_released(self) -> None:
        """When a release fails with LeaseCleanupError, it's skipped."""
        rows = [
            _make_expired_row(ticket_id="SCAN-003"),
            _make_expired_row(ticket_id="SCAN-004"),
        ]

        call_count = 0

        class AlternatingConn(FakeConnection):
            async def execute(self, query: str, *args: Any) -> str:
                nonlocal call_count
                call_count += 1
                # First UPDATE is for SCAN-003 (fail), second is for SCAN-004 (succeed)
                if "UPDATE tickets" in query:
                    if call_count == 1:
                        return "UPDATE 0"  # SCAN-003 already released
                    return "UPDATE 1"
                self.execute_calls.append((query, *args))
                return "INSERT 0 1"

        conn = AlternatingConn(fetch_result=rows)
        pool = FakePool(conn)

        releases = await scan_and_release_expired(pool, _now=_NOW)

        # Only SCAN-004 should succeed
        assert len(releases) == 1
        assert releases[0].ticket_id == "SCAN-004"

    async def test_continues_on_database_error(self) -> None:
        """When a release fails with DatabaseError, the scan continues."""
        rows = [
            _make_expired_row(ticket_id="SCAN-005"),
            _make_expired_row(ticket_id="SCAN-006"),
        ]

        call_count = 0

        class ErrorThenSuccessConn(FakeConnection):
            async def execute(self, query: str, *args: Any) -> str:
                nonlocal call_count
                call_count += 1
                if "UPDATE tickets" in query:
                    if call_count == 1:
                        raise RuntimeError("transient error")
                    return "UPDATE 1"
                self.execute_calls.append((query, *args))
                return "INSERT 0 1"

        conn = ErrorThenSuccessConn(fetch_result=rows)
        pool = FakePool(conn)

        releases = await scan_and_release_expired(pool, _now=_NOW)

        assert len(releases) == 1
        assert releases[0].ticket_id == "SCAN-006"


# ---------------------------------------------------------------------------
# LeaseCleanupTask tests
# ---------------------------------------------------------------------------


class TestLeaseCleanupTask:
    """Tests for the LeaseCleanupTask async background task."""

    async def test_default_config(self) -> None:
        conn = FakeConnection()
        pool = FakePool(conn)
        task = LeaseCleanupTask(pool)

        assert task.config.scan_interval_seconds == 30.0
        assert task.config.batch_size == 100
        assert task.scan_count == 0
        assert task.total_released == 0
        assert task.last_error is None
        assert not task.is_running

    async def test_custom_config(self) -> None:
        conn = FakeConnection()
        pool = FakePool(conn)
        cfg = LeaseCleanupConfig(scan_interval_seconds=10.0, batch_size=50)
        task = LeaseCleanupTask(pool, config=cfg)

        assert task.config.scan_interval_seconds == 10.0
        assert task.config.batch_size == 50

    async def test_start_and_stop(self) -> None:
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)
        cfg = LeaseCleanupConfig(scan_interval_seconds=0.01)
        task = LeaseCleanupTask(pool, config=cfg)

        await task.start()
        assert task.is_running

        # Wait for at least one scan cycle
        await asyncio.sleep(0.05)

        await task.stop()
        assert not task.is_running
        assert task.scan_count >= 1

    async def test_context_manager(self) -> None:
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)
        cfg = LeaseCleanupConfig(scan_interval_seconds=0.01)

        async with LeaseCleanupTask(pool, config=cfg) as task:
            assert task.is_running
            await asyncio.sleep(0.05)

        assert not task.is_running
        assert task.scan_count >= 1

    async def test_double_start_raises(self) -> None:
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)
        cfg = LeaseCleanupConfig(scan_interval_seconds=0.01)
        task = LeaseCleanupTask(pool, config=cfg)

        await task.start()
        try:
            with pytest.raises(RuntimeError, match="already running"):
                await task.start()
        finally:
            await task.stop()

    async def test_counts_releases(self) -> None:
        rows = [_make_expired_row(ticket_id="COUNT-001")]
        conn = FakeConnection(fetch_result=rows, execute_result="UPDATE 1")
        pool = FakePool(conn)
        cfg = LeaseCleanupConfig(scan_interval_seconds=0.01)

        async with LeaseCleanupTask(pool, config=cfg) as task:
            await asyncio.sleep(0.05)

        assert task.total_released >= 1

    async def test_handles_errors_gracefully(self) -> None:
        conn = FakeConnection(fetch_side_effect=RuntimeError("db down"))
        pool = FakePool(conn)
        cfg = LeaseCleanupConfig(scan_interval_seconds=0.01)

        async with LeaseCleanupTask(pool, config=cfg) as task:
            await asyncio.sleep(0.05)

        assert task.scan_count >= 1
        assert task.last_error is not None

    async def test_stop_idempotent(self) -> None:
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)
        cfg = LeaseCleanupConfig(scan_interval_seconds=0.01)
        task = LeaseCleanupTask(pool, config=cfg)

        await task.start()
        await task.stop()
        # Second stop should not raise
        await task.stop()
        assert not task.is_running

    async def test_stop_before_start(self) -> None:
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)
        task = LeaseCleanupTask(pool)

        # Should not raise
        await task.stop()
        assert not task.is_running
