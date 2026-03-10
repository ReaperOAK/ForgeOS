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
from contextlib import asynccontextmanager
from typing import Any
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

    # Mock the internal pool for expire_connections
    inner_pool = MagicMock()
    inner_pool.expire_connections = MagicMock()
    mock._pool = inner_pool

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

        pool._pool.expire_connections.assert_called_once()


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

        pool._pool.expire_connections.assert_called_once()

    @pytest.mark.asyncio
    async def test_no_recycle_before_lifetime(self) -> None:
        pool = _make_mock_pool()
        monitor = PoolHealthMonitor(pool, max_lifetime=3600.0)
        # Recent recycle — should not trigger
        monitor._last_recycle_epoch = time.monotonic()

        await monitor._run_health_check()

        pool._pool.expire_connections.assert_not_called()


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
# Package exports
# ---------------------------------------------------------------------------


class TestHealthExports:
    def test_importable_from_db_package(self) -> None:
        from mcp_server.db import HealthReport as HR
        from mcp_server.db import PoolHealthMonitor as PHM

        assert HR is HealthReport
        assert PHM is PoolHealthMonitor
