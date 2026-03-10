"""Tests for mcp_server.observability.health — server health check & readiness probes.

TDD Evidence (FORGEOS-BE025):
- RED:  Tests written first, targeting all 6 acceptance criteria.
- GREEN: observability/health.py implemented to satisfy each test.
- REFACTOR: Integrated into server.py lifespan and health_check tool.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_server.observability.health import (
    HealthChecker,
    HealthStatus,
    ReadinessState,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class _FakePoolStats:
    size: int = 10
    free_size: int = 8
    used_size: int = 2
    min_size: int = 2
    max_size: int = 10


def _make_mock_pool(
    *,
    initialized: bool = True,
    ping_side_effect: Exception | None = None,
    stats: _FakePoolStats | None = None,
) -> MagicMock:
    """Return a MagicMock that quacks like :class:`ConnectionPool`."""
    pool = MagicMock()
    pool.is_initialized = initialized
    pool.ping = AsyncMock(side_effect=ping_side_effect)
    pool.stats.return_value = stats or _FakePoolStats()
    return pool


def _make_uninitialized_pool() -> MagicMock:
    return _make_mock_pool(initialized=False)


# ===================================================================
# AC1 — Health check returns JSON with server status, DB status,
#        pool stats, and uptime
# ===================================================================


class TestHealthCheck:
    """AC1: Health check endpoint returns JSON with server status,
    database status, pool stats, and uptime."""

    @pytest.mark.asyncio
    async def test_healthy_with_pool(self) -> None:
        pool = _make_mock_pool()
        checker = HealthChecker(pool=pool)
        result = await checker.health_check()

        assert result["status"] == HealthStatus.HEALTHY.value
        assert "version" in result
        assert "uptime_seconds" in result
        assert result["database"]["status"] == "ok"
        assert "pool" in result["database"]

    @pytest.mark.asyncio
    async def test_degraded_without_pool(self) -> None:
        checker = HealthChecker(pool=None)
        result = await checker.health_check()

        assert result["status"] == HealthStatus.DEGRADED.value
        assert result["database"]["status"] == "not_configured"

    @pytest.mark.asyncio
    async def test_unhealthy_on_db_error(self) -> None:
        pool = _make_mock_pool(ping_side_effect=RuntimeError("conn refused"))
        checker = HealthChecker(pool=pool)
        result = await checker.health_check()

        assert result["status"] == HealthStatus.UNHEALTHY.value
        assert result["database"]["status"] == "error"
        assert "conn refused" in result["database"]["error"]

    @pytest.mark.asyncio
    async def test_uptime_is_positive(self) -> None:
        checker = HealthChecker(pool=None)
        await asyncio.sleep(0.01)
        result = await checker.health_check()
        assert result["uptime_seconds"] > 0

    @pytest.mark.asyncio
    async def test_version_present(self) -> None:
        checker = HealthChecker(pool=None)
        result = await checker.health_check()
        assert isinstance(result["version"], str)
        assert len(result["version"]) > 0


# ===================================================================
# AC2 — Readiness probe returns 200 when server is fully initialized
# ===================================================================


class TestReadinessReady:
    """AC2: Readiness probe returns ready when fully initialized."""

    @pytest.mark.asyncio
    async def test_ready_with_healthy_pool(self) -> None:
        pool = _make_mock_pool()
        checker = HealthChecker(pool=pool)
        checker.mark_ready()

        is_ready, status = await checker.readiness_check()
        assert is_ready is True
        assert status["ready"] is True
        assert status["state"] == ReadinessState.READY.value

    @pytest.mark.asyncio
    async def test_ready_without_pool(self) -> None:
        checker = HealthChecker(pool=None)
        checker.mark_ready()

        is_ready, status = await checker.readiness_check()
        assert is_ready is True
        assert status["ready"] is True


# ===================================================================
# AC3 — Readiness probe returns 503 during startup or shutdown
# ===================================================================


class TestReadinessNotReady:
    """AC3: Readiness probe returns 503 during startup/shutdown."""

    @pytest.mark.asyncio
    async def test_not_ready_during_startup(self) -> None:
        checker = HealthChecker(pool=_make_mock_pool())
        # Default state is STARTING — do NOT call mark_ready

        is_ready, status = await checker.readiness_check()
        assert is_ready is False
        assert status["ready"] is False
        assert "starting" in status.get("reason", "").lower()

    @pytest.mark.asyncio
    async def test_not_ready_during_draining(self) -> None:
        checker = HealthChecker(pool=_make_mock_pool())
        checker.mark_ready()
        checker.mark_draining()

        is_ready, status = await checker.readiness_check()
        assert is_ready is False
        assert status["ready"] is False
        assert "draining" in status.get("reason", "").lower()

    @pytest.mark.asyncio
    async def test_not_ready_pool_uninitialized(self) -> None:
        pool = _make_uninitialized_pool()
        checker = HealthChecker(pool=pool)
        checker.mark_ready()

        is_ready, status = await checker.readiness_check()
        assert is_ready is False
        assert "not initialized" in status.get("reason", "").lower()


# ===================================================================
# AC4 — DB connectivity verified via SELECT 1
# ===================================================================


class TestDbConnectivity:
    """AC4: Database connectivity is verified via a lightweight query."""

    @pytest.mark.asyncio
    async def test_ping_called(self) -> None:
        pool = _make_mock_pool()
        checker = HealthChecker(pool=pool)
        await checker.health_check()

        pool.ping.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_ping_failure_reported(self) -> None:
        pool = _make_mock_pool(ping_side_effect=RuntimeError("timeout"))
        checker = HealthChecker(pool=pool)
        result = await checker.health_check()

        assert result["database"]["status"] == "error"
        assert "timeout" in result["database"]["error"]


# ===================================================================
# AC5 — Pool saturation metrics
# ===================================================================


class TestPoolSaturation:
    """AC5: Health check includes connection pool saturation metrics."""

    @pytest.mark.asyncio
    async def test_saturation_present(self) -> None:
        pool = _make_mock_pool(stats=_FakePoolStats(used_size=5, max_size=10))
        checker = HealthChecker(pool=pool)
        result = await checker.health_check()

        pool_info = result["database"]["pool"]
        assert "saturation_pct" in pool_info
        assert pool_info["saturation_pct"] == pytest.approx(50.0)

    @pytest.mark.asyncio
    async def test_saturation_zero(self) -> None:
        pool = _make_mock_pool(stats=_FakePoolStats(used_size=0, max_size=10))
        checker = HealthChecker(pool=pool)
        result = await checker.health_check()

        assert result["database"]["pool"]["saturation_pct"] == pytest.approx(0.0)

    @pytest.mark.asyncio
    async def test_saturation_full(self) -> None:
        pool = _make_mock_pool(stats=_FakePoolStats(used_size=10, max_size=10))
        checker = HealthChecker(pool=pool)
        result = await checker.health_check()

        assert result["database"]["pool"]["saturation_pct"] == pytest.approx(100.0)


# ===================================================================
# AC6 — Response time < 500ms
# ===================================================================


class TestResponseLatency:
    """AC6: Both endpoints respond within 500ms even under load."""

    @pytest.mark.asyncio
    async def test_health_check_under_500ms(self) -> None:
        pool = _make_mock_pool()
        checker = HealthChecker(pool=pool)

        start = time.monotonic()
        await checker.health_check()
        elapsed = time.monotonic() - start

        assert elapsed < 0.5

    @pytest.mark.asyncio
    async def test_readiness_check_under_500ms(self) -> None:
        pool = _make_mock_pool()
        checker = HealthChecker(pool=pool)
        checker.mark_ready()

        start = time.monotonic()
        await checker.readiness_check()
        elapsed = time.monotonic() - start

        assert elapsed < 0.5

    @pytest.mark.asyncio
    async def test_health_check_without_pool_under_500ms(self) -> None:
        checker = HealthChecker(pool=None)

        start = time.monotonic()
        await checker.health_check()
        elapsed = time.monotonic() - start

        assert elapsed < 0.5


# ===================================================================
# Additional — state transition coverage
# ===================================================================


class TestHealthCheckerConstruction:
    """Construction and default values."""

    def test_default_state_is_starting(self) -> None:
        checker = HealthChecker()
        assert checker._state == ReadinessState.STARTING.value

    def test_pool_stored(self) -> None:
        pool = _make_mock_pool()
        checker = HealthChecker(pool=pool)
        assert checker._pool is pool

    def test_pool_defaults_none(self) -> None:
        checker = HealthChecker()
        assert checker._pool is None

    def test_start_time_set(self) -> None:
        before = time.monotonic()
        checker = HealthChecker()
        after = time.monotonic()
        assert before <= checker._start_time <= after


class TestStateTransitions:
    """State machine transitions."""

    def test_mark_ready(self) -> None:
        checker = HealthChecker()
        checker.mark_ready()
        assert checker._state == ReadinessState.READY.value

    def test_mark_draining(self) -> None:
        checker = HealthChecker()
        checker.mark_ready()
        checker.mark_draining()
        assert checker._state == ReadinessState.DRAINING.value

    def test_full_lifecycle(self) -> None:
        checker = HealthChecker()
        assert checker._state == ReadinessState.STARTING.value
        checker.mark_ready()
        assert checker._state == ReadinessState.READY.value
        checker.mark_draining()
        assert checker._state == ReadinessState.DRAINING.value
