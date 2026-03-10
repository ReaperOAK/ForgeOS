"""Tests for the lease heartbeat mechanism (FORGEOS-BE008).

Covers:
- HeartbeatConfig: validation, defaults, frozen immutability
- HeartbeatRecord: value object integrity
- StaleClaim: value object integrity
- extend_lease: happy path, lease not active, max duration exceeded, DB error
- find_stale_claims: happy path, empty results, DB error
- LeaseHeartbeat: async context manager lifecycle, start/stop, double-start,
  heartbeat counting, error handling, graceful shutdown

.. meta::
   :ticket: FORGEOS-BE008
"""

from __future__ import annotations

import asyncio
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.locking.lease_heartbeat import (
    HeartbeatConfig,
    HeartbeatError,
    HeartbeatRecord,
    LeaseHeartbeat,
    LeaseNotActiveError,
    MaxLeaseDurationExceededError,
    StaleClaim,
    extend_lease,
    find_stale_claims,
)
from mcp_server.server import DatabaseError


# ---------------------------------------------------------------------------
# Fixtures & helpers
# ---------------------------------------------------------------------------

_AGENT_ID = str(uuid.uuid4())
_TICKET_ID = "FORGEOS-TEST-001"
_NOW = datetime(2026, 3, 10, 12, 0, 0, tzinfo=timezone.utc)


class FakeConnection:
    """Mock asyncpg connection with configurable responses."""

    def __init__(
        self,
        fetchrow_result: Any = None,
        fetch_result: list[Any] | None = None,
        fetchrow_side_effect: Exception | None = None,
        fetch_side_effect: Exception | None = None,
    ) -> None:
        self._fetchrow_result = fetchrow_result
        self._fetch_result = fetch_result if fetch_result is not None else []
        self._fetchrow_side_effect = fetchrow_side_effect
        self._fetch_side_effect = fetch_side_effect
        self.execute_calls: list[tuple[str, ...]] = []

    async def fetchrow(self, query: str, *args: Any) -> Any:
        if self._fetchrow_side_effect:
            raise self._fetchrow_side_effect
        return self._fetchrow_result

    async def fetch(self, query: str, *args: Any) -> list[Any]:
        if self._fetch_side_effect:
            raise self._fetch_side_effect
        return self._fetch_result

    async def execute(self, query: str, *args: Any) -> str:
        self.execute_calls.append((query, *args))
        return "UPDATE 1"


class FakePool:
    """Mock connection pool that yields a FakeConnection."""

    def __init__(self, connection: FakeConnection) -> None:
        self._conn = connection

    @asynccontextmanager
    async def acquire(self):  # type: ignore[override]
        yield self._conn


def _make_lease_row(
    *,
    lease_expiry: datetime | None = None,
    claimed_by: uuid.UUID | None = None,
    claimed_at: datetime | None = None,
) -> dict[str, Any]:
    """Create a mock row for the tickets table lease query."""
    return {
        "lease_expiry": lease_expiry or (_NOW + timedelta(minutes=10)),
        "claimed_by": claimed_by or uuid.UUID(_AGENT_ID),
        "claimed_at": claimed_at or (_NOW - timedelta(minutes=5)),
    }


def _make_stale_row(
    *,
    ticket_id: str = "STALE-001",
    claimed_by: uuid.UUID | None = None,
    claimed_by_name: str = "Backend",
    machine_id: str = "test-host",
    lease_expiry: datetime | None = None,
    last_heartbeat: datetime | None = None,
) -> dict[str, Any]:
    """Create a mock row for the stale claims query."""
    return {
        "ticket_id": ticket_id,
        "claimed_by": claimed_by or uuid.uuid4(),
        "claimed_by_name": claimed_by_name,
        "machine_id": machine_id,
        "lease_expiry": lease_expiry or (_NOW - timedelta(minutes=5)),
        "last_heartbeat": last_heartbeat,
    }


# ---------------------------------------------------------------------------
# HeartbeatConfig tests
# ---------------------------------------------------------------------------


class TestHeartbeatConfig:
    """Tests for HeartbeatConfig validation and defaults."""

    def test_defaults(self) -> None:
        cfg = HeartbeatConfig()
        assert cfg.interval_seconds == 60.0
        assert cfg.extension_seconds == 120.0
        assert cfg.max_lease_seconds == 7200.0

    def test_custom_values(self) -> None:
        cfg = HeartbeatConfig(
            interval_seconds=30.0,
            extension_seconds=90.0,
            max_lease_seconds=3600.0,
        )
        assert cfg.interval_seconds == 30.0
        assert cfg.extension_seconds == 90.0
        assert cfg.max_lease_seconds == 3600.0

    def test_frozen(self) -> None:
        cfg = HeartbeatConfig()
        with pytest.raises(AttributeError):
            cfg.interval_seconds = 10.0  # type: ignore[misc]

    def test_negative_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="interval_seconds must be positive"):
            HeartbeatConfig(interval_seconds=-1)

    def test_zero_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="interval_seconds must be positive"):
            HeartbeatConfig(interval_seconds=0)

    def test_negative_extension_raises(self) -> None:
        with pytest.raises(ValueError, match="extension_seconds must be positive"):
            HeartbeatConfig(extension_seconds=-1)

    def test_negative_max_raises(self) -> None:
        with pytest.raises(ValueError, match="max_lease_seconds must be positive"):
            HeartbeatConfig(max_lease_seconds=-1)

    def test_interval_must_be_less_than_extension(self) -> None:
        with pytest.raises(ValueError, match="interval_seconds must be less"):
            HeartbeatConfig(interval_seconds=120, extension_seconds=60)

    def test_interval_equal_to_extension_raises(self) -> None:
        with pytest.raises(ValueError, match="interval_seconds must be less"):
            HeartbeatConfig(interval_seconds=60, extension_seconds=60)


# ---------------------------------------------------------------------------
# HeartbeatRecord tests
# ---------------------------------------------------------------------------


class TestHeartbeatRecord:
    """Tests for the HeartbeatRecord frozen dataclass."""

    def test_immutable(self) -> None:
        record = HeartbeatRecord(
            ticket_id=_TICKET_ID,
            agent_id=_AGENT_ID,
            previous_expiry=_NOW,
            new_expiry=_NOW + timedelta(minutes=2),
            heartbeat_at=_NOW,
        )
        with pytest.raises(AttributeError):
            record.ticket_id = "changed"  # type: ignore[misc]

    def test_fields(self) -> None:
        prev = _NOW
        new = _NOW + timedelta(minutes=2)
        record = HeartbeatRecord(
            ticket_id=_TICKET_ID,
            agent_id=_AGENT_ID,
            previous_expiry=prev,
            new_expiry=new,
            heartbeat_at=_NOW,
        )
        assert record.ticket_id == _TICKET_ID
        assert record.agent_id == _AGENT_ID
        assert record.previous_expiry == prev
        assert record.new_expiry == new
        assert record.heartbeat_at == _NOW


# ---------------------------------------------------------------------------
# StaleClaim tests
# ---------------------------------------------------------------------------


class TestStaleClaim:
    """Tests for the StaleClaim frozen dataclass."""

    def test_immutable(self) -> None:
        claim = StaleClaim(
            ticket_id="STALE-001",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            lease_expiry=_NOW,
            last_heartbeat=None,
        )
        with pytest.raises(AttributeError):
            claim.ticket_id = "changed"  # type: ignore[misc]

    def test_last_heartbeat_none(self) -> None:
        claim = StaleClaim(
            ticket_id="STALE-001",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            lease_expiry=_NOW,
            last_heartbeat=None,
        )
        assert claim.last_heartbeat is None

    def test_last_heartbeat_present(self) -> None:
        hb = _NOW - timedelta(minutes=3)
        claim = StaleClaim(
            ticket_id="STALE-001",
            agent_id=_AGENT_ID,
            agent_name="Backend",
            machine_id="host",
            lease_expiry=_NOW,
            last_heartbeat=hb,
        )
        assert claim.last_heartbeat == hb


# ---------------------------------------------------------------------------
# extend_lease tests
# ---------------------------------------------------------------------------


class TestExtendLease:
    """Tests for the extend_lease function."""

    @pytest.mark.asyncio
    async def test_happy_path(self) -> None:
        """Extending an active lease returns a HeartbeatRecord."""
        now = datetime.now(timezone.utc)
        conn = FakeConnection(
            fetchrow_result=_make_lease_row(
                claimed_at=now - timedelta(minutes=5),
                lease_expiry=now + timedelta(seconds=60),
            ),
        )
        pool = FakePool(conn)

        record = await extend_lease(
            pool,
            ticket_id=_TICKET_ID,
            agent_id=_AGENT_ID,
            extension_seconds=120.0,
            max_lease_seconds=7200.0,
            _now=now,
        )

        assert record.ticket_id == _TICKET_ID
        assert record.agent_id == _AGENT_ID
        assert record.new_expiry > record.previous_expiry
        # Two execute calls: UPDATE tickets + INSERT lease_heartbeats
        assert len(conn.execute_calls) == 2
        assert "UPDATE tickets" in conn.execute_calls[0][0]
        assert "INSERT INTO lease_heartbeats" in conn.execute_calls[1][0]

    @pytest.mark.asyncio
    async def test_lease_not_active_raises(self) -> None:
        """If the claim is not active, raise LeaseNotActiveError."""
        conn = FakeConnection(fetchrow_result=None)
        pool = FakePool(conn)

        with pytest.raises(LeaseNotActiveError, match="No active lease"):
            await extend_lease(
                pool,
                ticket_id=_TICKET_ID,
                agent_id=_AGENT_ID,
            )

    @pytest.mark.asyncio
    async def test_max_duration_exceeded_raises(self) -> None:
        """If extending exceeds max duration, raise MaxLeaseDurationExceededError."""
        # claimed_at was 3 hours ago, max is 2 hours
        conn = FakeConnection(
            fetchrow_result=_make_lease_row(
                claimed_at=_NOW - timedelta(hours=3),
                lease_expiry=_NOW + timedelta(minutes=1),
            ),
        )
        pool = FakePool(conn)

        with pytest.raises(MaxLeaseDurationExceededError, match="max duration"):
            await extend_lease(
                pool,
                ticket_id=_TICKET_ID,
                agent_id=_AGENT_ID,
                extension_seconds=120.0,
                max_lease_seconds=7200.0,
            )

    @pytest.mark.asyncio
    async def test_database_error_raises(self) -> None:
        """If DB fails, raise DatabaseError."""
        conn = FakeConnection(
            fetchrow_side_effect=ConnectionError("DB down"),
        )
        pool = FakePool(conn)

        with pytest.raises(DatabaseError, match="Failed to extend lease"):
            await extend_lease(
                pool,
                ticket_id=_TICKET_ID,
                agent_id=_AGENT_ID,
            )

    @pytest.mark.asyncio
    async def test_lease_not_active_is_not_wrapped(self) -> None:
        """LeaseNotActiveError should not be wrapped in DatabaseError."""
        conn = FakeConnection(fetchrow_result=None)
        pool = FakePool(conn)

        with pytest.raises(LeaseNotActiveError):
            await extend_lease(
                pool,
                ticket_id=_TICKET_ID,
                agent_id=_AGENT_ID,
            )


# ---------------------------------------------------------------------------
# find_stale_claims tests
# ---------------------------------------------------------------------------


class TestFindStaleClaims:
    """Tests for the find_stale_claims function."""

    @pytest.mark.asyncio
    async def test_returns_stale_claims(self) -> None:
        """Returns list of StaleClaim when stale tickets exist."""
        rows = [
            _make_stale_row(ticket_id="STALE-001", last_heartbeat=None),
            _make_stale_row(
                ticket_id="STALE-002",
                last_heartbeat=_NOW - timedelta(minutes=10),
            ),
        ]
        conn = FakeConnection(fetch_result=rows)
        pool = FakePool(conn)

        results = await find_stale_claims(pool, heartbeat_interval_seconds=60.0)

        assert len(results) == 2
        assert results[0].ticket_id == "STALE-001"
        assert results[0].last_heartbeat is None
        assert results[1].ticket_id == "STALE-002"
        assert results[1].last_heartbeat is not None

    @pytest.mark.asyncio
    async def test_empty_results(self) -> None:
        """Returns empty list when no stale claims."""
        conn = FakeConnection(fetch_result=[])
        pool = FakePool(conn)

        results = await find_stale_claims(pool)
        assert results == []

    @pytest.mark.asyncio
    async def test_database_error_raises(self) -> None:
        """If DB fails, raise DatabaseError."""
        conn = FakeConnection(fetch_side_effect=ConnectionError("DB unreachable"))
        pool = FakePool(conn)

        with pytest.raises(DatabaseError, match="Failed to find stale claims"):
            await find_stale_claims(pool)

    @pytest.mark.asyncio
    async def test_stale_claim_fields(self) -> None:
        """Verify all StaleClaim fields are correctly populated."""
        agent_uuid = uuid.uuid4()
        rows = [
            _make_stale_row(
                ticket_id="STALE-003",
                claimed_by=agent_uuid,
                claimed_by_name="QA",
                machine_id="qa-host",
                lease_expiry=_NOW - timedelta(minutes=2),
                last_heartbeat=_NOW - timedelta(minutes=5),
            ),
        ]
        conn = FakeConnection(fetch_result=rows)
        pool = FakePool(conn)

        results = await find_stale_claims(pool)

        assert len(results) == 1
        sc = results[0]
        assert sc.ticket_id == "STALE-003"
        assert sc.agent_id == str(agent_uuid)
        assert sc.agent_name == "QA"
        assert sc.machine_id == "qa-host"


# ---------------------------------------------------------------------------
# LeaseHeartbeat context manager tests
# ---------------------------------------------------------------------------


class TestLeaseHeartbeat:
    """Tests for the LeaseHeartbeat async context manager."""

    def _make_heartbeat(
        self,
        pool: FakePool | None = None,
        config: HeartbeatConfig | None = None,
    ) -> LeaseHeartbeat:
        if pool is None:
            now = datetime.now(timezone.utc)
            conn = FakeConnection(
                fetchrow_result=_make_lease_row(
                    claimed_at=now - timedelta(minutes=1),
                    lease_expiry=now + timedelta(minutes=10),
                ),
            )
            pool = FakePool(conn)

        return LeaseHeartbeat(
            pool,
            ticket_id=_TICKET_ID,
            agent_id=_AGENT_ID,
            config=config or HeartbeatConfig(
                interval_seconds=0.05,
                extension_seconds=0.1,
                max_lease_seconds=7200.0,
            ),
        )

    def test_properties(self) -> None:
        hb = self._make_heartbeat()
        assert hb.ticket_id == _TICKET_ID
        assert hb.agent_id == _AGENT_ID
        assert hb.heartbeat_count == 0
        assert hb.last_error is None
        assert hb.is_running is False

    def test_default_config(self) -> None:
        conn = FakeConnection(fetchrow_result=_make_lease_row())
        pool = FakePool(conn)
        hb = LeaseHeartbeat(pool, ticket_id=_TICKET_ID, agent_id=_AGENT_ID)
        assert hb.config.interval_seconds == 60.0

    @pytest.mark.asyncio
    async def test_context_manager_starts_and_stops(self) -> None:
        """Context manager starts the heartbeat task on enter and stops on exit."""
        hb = self._make_heartbeat()

        async with hb:
            assert hb.is_running is True
            # Let at least one heartbeat fire
            await asyncio.sleep(0.15)

        assert hb.is_running is False
        assert hb.heartbeat_count >= 1

    @pytest.mark.asyncio
    async def test_start_stop_explicit(self) -> None:
        """Explicit start/stop without context manager."""
        hb = self._make_heartbeat()

        await hb.start()
        assert hb.is_running is True

        await asyncio.sleep(0.15)
        await hb.stop()

        assert hb.is_running is False
        assert hb.heartbeat_count >= 1

    @pytest.mark.asyncio
    async def test_double_start_raises(self) -> None:
        """Starting an already-running heartbeat raises RuntimeError."""
        hb = self._make_heartbeat()

        await hb.start()
        try:
            with pytest.raises(RuntimeError, match="already running"):
                await hb.start()
        finally:
            await hb.stop()

    @pytest.mark.asyncio
    async def test_stop_idempotent(self) -> None:
        """Stopping an already-stopped heartbeat is a no-op."""
        hb = self._make_heartbeat()

        await hb.start()
        await hb.stop()
        # Should not raise
        await hb.stop()

    @pytest.mark.asyncio
    async def test_lease_not_active_stops_loop(self) -> None:
        """Heartbeat loop stops gracefully when lease is no longer active."""
        conn = FakeConnection(fetchrow_result=None)
        pool = FakePool(conn)

        hb = LeaseHeartbeat(
            pool,
            ticket_id=_TICKET_ID,
            agent_id=_AGENT_ID,
            config=HeartbeatConfig(
                interval_seconds=0.05,
                extension_seconds=0.1,
                max_lease_seconds=7200.0,
            ),
        )

        async with hb:
            # Wait for loop to encounter the error and stop
            await asyncio.sleep(0.2)

        assert hb.heartbeat_count == 0
        assert isinstance(hb.last_error, LeaseNotActiveError)

    @pytest.mark.asyncio
    async def test_transient_db_error_continues(self) -> None:
        """Transient DB errors don't stop the heartbeat loop."""
        call_count = 0
        original_fetchrow = None

        class FlakeyConnection(FakeConnection):
            async def fetchrow(self, query: str, *args: Any) -> Any:
                nonlocal call_count
                call_count += 1
                if call_count == 1:
                    raise ConnectionError("transient failure")
                now = datetime.now(timezone.utc)
                return _make_lease_row(
                    claimed_at=now - timedelta(minutes=1),
                    lease_expiry=now + timedelta(minutes=10),
                )

        conn = FlakeyConnection()
        pool = FakePool(conn)

        hb = LeaseHeartbeat(
            pool,
            ticket_id=_TICKET_ID,
            agent_id=_AGENT_ID,
            config=HeartbeatConfig(
                interval_seconds=0.05,
                extension_seconds=0.1,
                max_lease_seconds=7200.0,
            ),
        )

        async with hb:
            await asyncio.sleep(0.3)

        # First call fails (transient), subsequent calls succeed
        assert hb.heartbeat_count >= 1

    @pytest.mark.asyncio
    async def test_context_manager_on_exception(self) -> None:
        """Heartbeat stops even if the body raises an exception."""
        hb = self._make_heartbeat()

        with pytest.raises(ValueError, match="test error"):
            async with hb:
                assert hb.is_running is True
                raise ValueError("test error")

        assert hb.is_running is False

    @pytest.mark.asyncio
    async def test_max_duration_stops_loop(self) -> None:
        """Heartbeat loop stops when max lease duration is exceeded."""
        now = datetime.now(timezone.utc)
        # claimed_at was 3 hours ago, max is 2 hours — first heartbeat will fail
        conn = FakeConnection(
            fetchrow_result=_make_lease_row(
                claimed_at=now - timedelta(hours=3),
                lease_expiry=now + timedelta(minutes=1),
            ),
        )
        pool = FakePool(conn)

        hb = LeaseHeartbeat(
            pool,
            ticket_id=_TICKET_ID,
            agent_id=_AGENT_ID,
            config=HeartbeatConfig(
                interval_seconds=0.05,
                extension_seconds=0.1,
                max_lease_seconds=7200.0,
            ),
        )

        async with hb:
            await asyncio.sleep(0.2)

        assert isinstance(hb.last_error, MaxLeaseDurationExceededError)
        assert hb.heartbeat_count == 0


# ---------------------------------------------------------------------------
# Error hierarchy tests
# ---------------------------------------------------------------------------


class TestErrorHierarchy:
    """Tests for the heartbeat error class hierarchy."""

    def test_heartbeat_error_is_forgeos_error(self) -> None:
        from mcp_server.server import ForgeOSError
        assert issubclass(HeartbeatError, ForgeOSError)

    def test_lease_not_active_is_heartbeat_error(self) -> None:
        assert issubclass(LeaseNotActiveError, HeartbeatError)

    def test_max_duration_is_heartbeat_error(self) -> None:
        assert issubclass(MaxLeaseDurationExceededError, HeartbeatError)

    def test_lease_not_active_status_code(self) -> None:
        assert LeaseNotActiveError.status_code == 410

    def test_max_duration_status_code(self) -> None:
        assert MaxLeaseDurationExceededError.status_code == 409
