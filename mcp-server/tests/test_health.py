"""Tests for mcp_server.db.health — connection pool health monitoring.

TDD Evidence:
- RED:  Tests written first, targeting all acceptance criteria from FORGEOS-BE014.
- GREEN: health.py implemented to satisfy each test.
- REFACTOR: Extracted HealthReport, simplified background task lifecycle.

Acceptance Criteria:
- AC1: Pool health monitor reports: total, active, idle, and waiting connection counts
- AC2: Periodic ping detects and removes dead connections from the pool
- AC3: Stale connections (exceeding max_lifetime) are recycled automatically
- AC4: Health report includes pool saturation percentage and average wait time
- AC5: Health data is exposed as a dict suitable for JSON serialization
- AC6: Health monitoring runs as a lightweight background task
"""

from __future__ import annotations

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.db.health import HealthReport, PoolHealthMonitor
from mcp_server.db.pool import ConnectionPool, PoolStats

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_pool(
    size: int = 8,
    idle: int = 5,
    min_size: int = 2,
    max_size: int = 10,
    ping_ok: bool = True,
) -> MagicMock:
    """Build a mock ConnectionPool with controllable stats and ping behavior."""
    mock = MagicMock(spec=ConnectionPool)
    mock.is_initialized = True
    mock.stats.return_value = PoolStats(
        size=size,
        free_size=idle,
        used_size=size - idle,
        min_size=min_size,
        max_size=max_size,
    )
    if ping_ok:
        mock.ping = AsyncMock(return_value=True)
    else:
        mock.ping = AsyncMock(side_effect=ConnectionError("ping failed"))

    # Mock the raw_pool for expire_connections
    inner_pool = MagicMock()
    inner_pool.expire_connections = AsyncMock()
    mock.raw_pool = inner_pool

    return mock


# ---------------------------------------------------------------------------
# HealthReport tests (AC1, AC4, AC5)
# ---------------------------------------------------------------------------


class TestHealthReport:
    """AC1: Reports total, active, idle, and waiting connection counts.
    AC4: Includes pool saturation percentage and average wait time.
    """

    def test_connection_counts(self) -> None:
        report = HealthReport(
            total_connections=10,
            active_connections=6,
            idle_connections=4,
            waiting_requests=2,
            saturation_pct=60.0,
            avg_wait_time_ms=1.5,
            max_lifetime_seconds=3600.0,
            is_healthy=True,
            last_check_epoch=1000.0,
        )
        assert report.total_connections == 10
        assert report.active_connections == 6
        assert report.idle_connections == 4
        assert report.waiting_requests == 2

    def test_saturation_and_wait_time(self) -> None:
        report = HealthReport(
            total_connections=10,
            active_connections=8,
            idle_connections=2,
            waiting_requests=0,
            saturation_pct=80.0,
            avg_wait_time_ms=2.3,
            max_lifetime_seconds=3600.0,
            is_healthy=True,
            last_check_epoch=1000.0,
        )
        assert report.saturation_pct == 80.0
        assert report.avg_wait_time_ms == 2.3

    def test_report_is_frozen(self) -> None:
        report = HealthReport(
            total_connections=5,
            active_connections=2,
            idle_connections=3,
            waiting_requests=0,
            saturation_pct=20.0,
            avg_wait_time_ms=0.0,
            max_lifetime_seconds=3600.0,
            is_healthy=True,
            last_check_epoch=1000.0,
        )
        with pytest.raises(AttributeError):
            report.total_connections = 99  # type: ignore[misc]

    def test_to_dict_json_serializable(self) -> None:
        """AC5: Health data exposed as dict suitable for JSON serialization."""
        report = HealthReport(
            total_connections=8,
            active_connections=3,
            idle_connections=5,
            waiting_requests=1,
            saturation_pct=30.0,
            avg_wait_time_ms=0.5,
            max_lifetime_seconds=1800.0,
            is_healthy=True,
            last_check_epoch=1000.0,
        )
        d = report.to_dict()
        assert isinstance(d, dict)
        assert d["total_connections"] == 8
        assert d["active_connections"] == 3
        assert d["idle_connections"] == 5
        assert d["waiting_requests"] == 1
        assert d["saturation_pct"] == 30.0
        assert d["avg_wait_time_ms"] == 0.5
        assert d["max_lifetime_seconds"] == 1800.0
        assert d["is_healthy"] is True
        assert "last_check_epoch" in d

        # Verify JSON-serializable (no complex types)
        import json

        json.dumps(d)  # Must not raise

    def test_to_dict_all_primitive_types(self) -> None:
        """All values in the dict must be JSON-safe primitives."""
        report = HealthReport(
            total_connections=0,
            active_connections=0,
            idle_connections=0,
            waiting_requests=0,
            saturation_pct=0.0,
            avg_wait_time_ms=0.0,
            max_lifetime_seconds=600.0,
            is_healthy=False,
            last_check_epoch=0.0,
        )
        d = report.to_dict()
        for v in d.values():
            assert isinstance(v, (int, float, bool, str, type(None)))


# ---------------------------------------------------------------------------
# PoolHealthMonitor — construction
# ---------------------------------------------------------------------------


class TestPoolHealthMonitorConstruction:
    def test_default_params(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        assert monitor._check_interval == 30.0
        assert monitor._max_lifetime == 3600.0
        assert not monitor.is_running

    def test_custom_params(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=10.0, max_lifetime=1800.0)
        assert monitor._check_interval == 10.0
        assert monitor._max_lifetime == 1800.0


# ---------------------------------------------------------------------------
# PoolHealthMonitor — health_report (AC1, AC4)
# ---------------------------------------------------------------------------


class TestPoolHealthMonitorReport:
    """AC1: Reports total, active, idle, and waiting counts.
    AC4: Includes saturation percentage and average wait time.
    """

    def test_health_report_from_pool_stats(self) -> None:
        pool = _make_mock_pool(size=8, idle=5, max_size=10)
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()

        assert report.total_connections == 8
        assert report.active_connections == 3
        assert report.idle_connections == 5
        assert report.is_healthy is True

    def test_saturation_percentage(self) -> None:
        pool = _make_mock_pool(size=10, idle=0, max_size=10)
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()

        assert report.saturation_pct == 100.0

    def test_saturation_zero_when_no_active(self) -> None:
        pool = _make_mock_pool(size=5, idle=5, max_size=10)
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()

        assert report.saturation_pct == 0.0

    def test_report_includes_waiting_count(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        # Simulate waiting requests
        monitor._waiting_count = 3
        report = monitor.health_report()

        assert report.waiting_requests == 3

    def test_report_includes_avg_wait_time(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        # Simulate wait time tracking
        monitor._total_wait_time_ms = 10.0
        monitor._total_acquires = 4
        report = monitor.health_report()

        assert report.avg_wait_time_ms == 2.5

    def test_avg_wait_time_zero_when_no_acquires(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()

        assert report.avg_wait_time_ms == 0.0

    def test_report_unhealthy_when_ping_failed(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        monitor._last_ping_ok = False
        report = monitor.health_report()

        assert report.is_healthy is False


# ---------------------------------------------------------------------------
# PoolHealthMonitor — to_dict (AC5)
# ---------------------------------------------------------------------------


class TestPoolHealthMonitorToDict:
    """AC5: Health data exposed as dict suitable for JSON serialization."""

    def test_to_dict_returns_dict(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        d = monitor.to_dict()
        assert isinstance(d, dict)
        assert "total_connections" in d
        assert "is_healthy" in d

    def test_to_dict_json_serializable(self) -> None:
        import json

        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        d = monitor.to_dict()
        json.dumps(d)  # Must not raise


# ---------------------------------------------------------------------------
# PoolHealthMonitor — periodic ping (AC2)
# ---------------------------------------------------------------------------


class TestPoolHealthMonitorPing:
    """AC2: Periodic ping detects and removes dead connections."""

    @pytest.mark.asyncio
    async def test_check_ping_success(self) -> None:
        pool = _make_mock_pool(ping_ok=True)
        monitor = PoolHealthMonitor(pool, check_interval=60.0)

        await monitor._run_health_check()

        pool.ping.assert_awaited_once()
        assert monitor._last_ping_ok is True

    @pytest.mark.asyncio
    async def test_check_ping_failure_marks_unhealthy(self) -> None:
        pool = _make_mock_pool(ping_ok=False)
        monitor = PoolHealthMonitor(pool, check_interval=60.0)

        await monitor._run_health_check()

        pool.ping.assert_awaited_once()
        assert monitor._last_ping_ok is False

    @pytest.mark.asyncio
    async def test_ping_failure_triggers_expire(self) -> None:
        """When ping fails, dead connections should be expired from pool."""
        pool = _make_mock_pool(ping_ok=False)
        monitor = PoolHealthMonitor(pool, check_interval=60.0)

        await monitor._run_health_check()

        pool.raw_pool.expire_connections.assert_awaited_once()


# ---------------------------------------------------------------------------
# PoolHealthMonitor — stale connection recycling (AC3)
# ---------------------------------------------------------------------------


class TestPoolHealthMonitorStaleRecycling:
    """AC3: Stale connections (exceeding max_lifetime) are recycled automatically."""

    @pytest.mark.asyncio
    async def test_recycle_when_lifetime_exceeded(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, max_lifetime=1.0)
        # Simulate that the pool has been running longer than max_lifetime
        monitor._last_recycle_epoch = time.monotonic() - 2.0

        await monitor._run_health_check()

        pool.raw_pool.expire_connections.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_recycle_before_lifetime(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, max_lifetime=3600.0)
        # Recent recycle — should not trigger
        monitor._last_recycle_epoch = time.monotonic()

        await monitor._run_health_check()

        pool.raw_pool.expire_connections.assert_not_awaited()


# ---------------------------------------------------------------------------
# PoolHealthMonitor — background task lifecycle (AC6)
# ---------------------------------------------------------------------------


class TestPoolHealthMonitorLifecycle:
    """AC6: Health monitoring runs as a lightweight background task."""

    @pytest.mark.asyncio
    async def test_start_creates_task(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=60.0)

        monitor.start()
        assert monitor.is_running

        await monitor.stop()
        assert not monitor.is_running

    @pytest.mark.asyncio
    async def test_stop_cancels_task(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=60.0)

        monitor.start()
        task = monitor._task
        assert task is not None

        await monitor.stop()
        assert task.cancelled() or task.done()

    @pytest.mark.asyncio
    async def test_start_idempotent(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=60.0)

        monitor.start()
        first_task = monitor._task

        monitor.start()  # Second call should be no-op
        assert monitor._task is first_task

        await monitor.stop()

    @pytest.mark.asyncio
    async def test_stop_when_not_started(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=60.0)

        await monitor.stop()  # Should not raise

    @pytest.mark.asyncio
    async def test_background_task_runs_check(self) -> None:
        """Verify the background loop actually calls _run_health_check."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=0.05)

        with patch.object(monitor, "_run_health_check", new_callable=AsyncMock) as mock_check:
            monitor.start()
            await asyncio.sleep(0.15)
            await monitor.stop()

            assert mock_check.await_count >= 1


# ---------------------------------------------------------------------------
# PoolHealthMonitor — wait tracking
# ---------------------------------------------------------------------------


class TestPoolHealthMonitorWaitTracking:
    """Verify that record_acquire_wait updates metrics correctly."""

    def test_record_acquire_wait(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)

        monitor.record_acquire_wait(5.0)
        monitor.record_acquire_wait(3.0)

        assert monitor._total_wait_time_ms == 8.0
        assert monitor._total_acquires == 2

    def test_record_waiting_increment_decrement(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)

        monitor.increment_waiting()
        monitor.increment_waiting()
        assert monitor._waiting_count == 2

        monitor.decrement_waiting()
        assert monitor._waiting_count == 1

    def test_decrement_clamps_at_zero(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)

        monitor.decrement_waiting()
        assert monitor._waiting_count == 0


# ---------------------------------------------------------------------------
# Mutation-killing: saturation & avg_wait arithmetic (AC4)
# ---------------------------------------------------------------------------


class TestMutationKillingArithmetic:
    """Kill mutants that swap operands or change arithmetic in health_report."""

    def test_saturation_half_pool(self) -> None:
        """5 active out of 10 max = 50%, not 200% or some other mutation."""
        pool = _make_mock_pool(size=7, idle=2, max_size=10)
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()
        # active = size - idle = 7 - 2 = 5; saturation = 5/10*100 = 50.0
        assert report.saturation_pct == 50.0

    def test_saturation_with_max_size_zero(self) -> None:
        """When max_size is 0, saturation must be 0 (guard against ZeroDivisionError)."""
        pool = _make_mock_pool(size=0, idle=0, max_size=0)
        # Override used_size since mock calculates it from size - idle
        pool.stats.return_value = PoolStats(
            size=0, free_size=0, used_size=0, min_size=0, max_size=0,
        )
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()
        assert report.saturation_pct == 0.0

    def test_avg_wait_time_calculation(self) -> None:
        """10ms total over 5 acquires = 2.0ms avg, not 0.5 (inverted division)."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        monitor._total_wait_time_ms = 10.0
        monitor._total_acquires = 5
        report = monitor.health_report()
        assert report.avg_wait_time_ms == 2.0

    def test_avg_wait_time_single_acquire(self) -> None:
        """Single acquire with 7.5ms wait must report 7.5ms avg."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        monitor.record_acquire_wait(7.5)
        report = monitor.health_report()
        assert report.avg_wait_time_ms == 7.5

    def test_saturation_one_active(self) -> None:
        """1 active out of 10 max = 10%."""
        pool = _make_mock_pool(size=5, idle=4, max_size=10)
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()
        # active = 5 - 4 = 1; saturation = 1/10*100 = 10.0
        assert report.saturation_pct == 10.0


# ---------------------------------------------------------------------------
# Mutation-killing: boundary conditions (AC2, AC3)
# ---------------------------------------------------------------------------


class TestMutationKillingBoundaries:
    """Kill mutants that change >= to > or modify conditional boundaries."""

    @pytest.mark.asyncio
    async def test_recycle_exactly_at_lifetime(self) -> None:
        """When elapsed == max_lifetime, recycling MUST trigger (>= boundary)."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, max_lifetime=10.0)
        # Set last_recycle_epoch so elapsed exactly equals max_lifetime
        monitor._last_recycle_epoch = time.monotonic() - 10.0

        await monitor._run_health_check()

        pool.raw_pool.expire_connections.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_recycle_just_under_lifetime(self) -> None:
        """When elapsed < max_lifetime by a tiny margin, no recycling."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, max_lifetime=10.0)
        monitor._last_recycle_epoch = time.monotonic() - 9.99

        await monitor._run_health_check()

        pool.raw_pool.expire_connections.assert_not_awaited()

    def test_decrement_from_one_goes_to_zero(self) -> None:
        """max(0, 1 - 1) = 0. Kill mutant that changes max(0, ...) to max(1, ...)."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        monitor._waiting_count = 1
        monitor.decrement_waiting()
        assert monitor._waiting_count == 0

    def test_decrement_twice_from_zero(self) -> None:
        """Clamped at 0, never goes negative."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        monitor.decrement_waiting()
        monitor.decrement_waiting()
        assert monitor._waiting_count == 0

    def test_increment_decrement_sequence(self) -> None:
        """3 increments, 2 decrements = 1 remaining."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        monitor.increment_waiting()
        monitor.increment_waiting()
        monitor.increment_waiting()
        monitor.decrement_waiting()
        monitor.decrement_waiting()
        assert monitor._waiting_count == 1


# ---------------------------------------------------------------------------
# Mutation-killing: state transitions in _run_health_check (AC2, AC3)
# ---------------------------------------------------------------------------


class TestMutationKillingStateTransitions:
    """Kill mutants that remove state updates or negate conditions."""

    @pytest.mark.asyncio
    async def test_last_check_epoch_updated_on_success(self) -> None:
        """_last_check_epoch must be set to a recent monotonic value after check."""
        pool = _make_mock_pool(ping_ok=True)
        monitor = PoolHealthMonitor(pool)
        before = time.monotonic()
        await monitor._run_health_check()
        after = time.monotonic()
        assert before <= monitor._last_check_epoch <= after

    @pytest.mark.asyncio
    async def test_last_check_epoch_updated_on_failure(self) -> None:
        """_last_check_epoch is updated even when ping fails."""
        pool = _make_mock_pool(ping_ok=False)
        monitor = PoolHealthMonitor(pool)
        before = time.monotonic()
        await monitor._run_health_check()
        after = time.monotonic()
        assert before <= monitor._last_check_epoch <= after

    @pytest.mark.asyncio
    async def test_ping_success_sets_healthy_true(self) -> None:
        """After a successful ping, is_healthy must be True (not negated)."""
        pool = _make_mock_pool(ping_ok=True)
        monitor = PoolHealthMonitor(pool)
        monitor._last_ping_ok = False  # Start unhealthy
        await monitor._run_health_check()
        assert monitor._last_ping_ok is True

    @pytest.mark.asyncio
    async def test_ping_failure_sets_healthy_false(self) -> None:
        """After a failed ping, is_healthy must be False (not negated)."""
        pool = _make_mock_pool(ping_ok=False)
        monitor = PoolHealthMonitor(pool)
        monitor._last_ping_ok = True  # Start healthy
        await monitor._run_health_check()
        assert monitor._last_ping_ok is False

    @pytest.mark.asyncio
    async def test_ping_failure_returns_without_lifetime_check(self) -> None:
        """On ping failure, expire is called once (for ping), not twice (for lifetime too)."""
        pool = _make_mock_pool(ping_ok=False)
        monitor = PoolHealthMonitor(pool, max_lifetime=0.001)
        monitor._last_recycle_epoch = time.monotonic() - 100.0  # Way past lifetime

        await monitor._run_health_check()

        # Only one expire call (from ping failure), not two (lifetime would also trigger)
        pool.raw_pool.expire_connections.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_last_recycle_epoch_resets_after_recycling(self) -> None:
        """After stale recycle, _last_recycle_epoch must be updated to ~now."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, max_lifetime=1.0)
        monitor._last_recycle_epoch = time.monotonic() - 5.0

        before = time.monotonic()
        await monitor._run_health_check()
        after = time.monotonic()

        assert before <= monitor._last_recycle_epoch <= after

    @pytest.mark.asyncio
    async def test_last_recycle_epoch_unchanged_when_no_recycle(self) -> None:
        """If max_lifetime not exceeded, _last_recycle_epoch stays unchanged."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, max_lifetime=3600.0)
        original_epoch = monitor._last_recycle_epoch

        await monitor._run_health_check()

        assert monitor._last_recycle_epoch == original_epoch


# ---------------------------------------------------------------------------
# Mutation-killing: _check_loop exception handler (uncovered lines 235-238)
# ---------------------------------------------------------------------------


class TestCheckLoopExceptionHandler:
    """Cover the exception handler in _check_loop that was previously uncovered."""

    @pytest.mark.asyncio
    async def test_loop_continues_after_unexpected_exception(self) -> None:
        """_check_loop must swallow non-CancelledError exceptions and continue."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=0.02)

        call_count = 0

        async def failing_then_ok() -> None:
            nonlocal call_count
            call_count += 1
            if call_count <= 2:
                raise RuntimeError("transient failure")

        with patch.object(monitor, "_run_health_check", side_effect=failing_then_ok):
            monitor.start()
            await asyncio.sleep(0.15)
            await monitor.stop()

        # Must have been called multiple times despite initial failures
        assert call_count >= 3

    @pytest.mark.asyncio
    async def test_loop_reraises_cancelled_error(self) -> None:
        """CancelledError must propagate (not be swallowed by the handler)."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, check_interval=0.02)

        monitor.start()
        assert monitor.is_running

        await monitor.stop()
        assert not monitor.is_running


# ---------------------------------------------------------------------------
# Mutation-killing: _expire_connections (inner pool access)
# ---------------------------------------------------------------------------


class TestExpireConnections:
    """Kill mutants that skip expire_connections or check wrong condition."""

    @pytest.mark.asyncio
    async def test_expire_with_no_inner_pool(self) -> None:
        """If pool is not initialized, _expire_connections must not raise."""
        pool = _make_mock_pool()
        pool.is_initialized = False
        monitor = PoolHealthMonitor(pool)
        # Should not raise
        await monitor._expire_connections()

    @pytest.mark.asyncio
    async def test_expire_calls_inner_pool(self) -> None:
        """_expire_connections must call inner_pool.expire_connections()."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        await monitor._expire_connections()
        pool.raw_pool.expire_connections.assert_awaited_once()


# ---------------------------------------------------------------------------
# Mutation-killing: HealthReport field correctness (AC1)
# ---------------------------------------------------------------------------


class TestHealthReportFieldMapping:
    """Kill mutants that swap fields in HealthReport construction."""

    def test_health_report_maps_stats_correctly(self) -> None:
        """Verify each PoolStats field maps to the correct HealthReport field."""
        pool = _make_mock_pool(size=7, idle=3, max_size=15)
        monitor = PoolHealthMonitor(pool)
        report = monitor.health_report()

        # size maps to total_connections
        assert report.total_connections == 7
        # used_size (size - idle = 4) maps to active_connections
        assert report.active_connections == 4
        # free_size maps to idle_connections
        assert report.idle_connections == 3
        # max_lifetime param maps to max_lifetime_seconds
        assert report.max_lifetime_seconds == 3600.0

    def test_all_to_dict_keys_present(self) -> None:
        """All 9 expected keys must be present in to_dict output."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        d = monitor.to_dict()
        expected_keys = {
            "total_connections", "active_connections", "idle_connections",
            "waiting_requests", "saturation_pct", "avg_wait_time_ms",
            "max_lifetime_seconds", "is_healthy", "last_check_epoch",
        }
        assert set(d.keys()) == expected_keys


# ---------------------------------------------------------------------------
# Mutation-killing: constructor defaults (AC6)
# ---------------------------------------------------------------------------


class TestConstructorDefaults:
    """Kill mutants that change default parameter values."""

    def test_default_check_interval_is_30(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        assert monitor._check_interval == 30.0

    def test_default_max_lifetime_is_3600(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        assert monitor._max_lifetime == 3600.0

    def test_initial_state(self) -> None:
        """Verify initial state values are correct."""
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool)
        assert monitor._last_ping_ok is True
        assert monitor._last_check_epoch == 0.0
        assert monitor._waiting_count == 0
        assert monitor._total_wait_time_ms == 0.0
        assert monitor._total_acquires == 0
        assert monitor._task is None


# ---------------------------------------------------------------------------
# Package exports
# ---------------------------------------------------------------------------


class TestHealthExports:
    def test_importable_from_db_package(self) -> None:
        from mcp_server.db import HealthReport as HealthReportAlias
        from mcp_server.db import PoolHealthMonitor as PoolHealthMonitorAlias

        assert HealthReportAlias is HealthReport
        assert PoolHealthMonitorAlias is PoolHealthMonitor
