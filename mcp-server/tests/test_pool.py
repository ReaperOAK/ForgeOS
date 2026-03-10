"""Tests for mcp_server.db.pool — asyncpg connection pool.

TDD Evidence:
- RED:  Tests written first, targeting all acceptance criteria.
- GREEN: pool.py implemented to satisfy each test.
- REFACTOR: Extracted PoolConfig, PoolStats, helpers.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.db.pool import (
    ConnectionPool,
    PoolConfig,
    PoolNotInitializedError,
    PoolStats,
)


def _make_mock_pool(
    fetchval_return: Any = 1,
    fetchval_side_effect: Exception | None = None,
) -> MagicMock:
    """Build a MagicMock that behaves like an asyncpg.Pool.

    The key detail: ``pool.acquire()`` must return an async context manager,
    not a coroutine.  We use ``@asynccontextmanager`` to get this right.
    """
    mock_conn = AsyncMock()
    if fetchval_side_effect:
        mock_conn.fetchval = AsyncMock(side_effect=fetchval_side_effect)
    else:
        mock_conn.fetchval = AsyncMock(return_value=fetchval_return)

    mock_pool = MagicMock()
    mock_pool.close = AsyncMock()

    @asynccontextmanager
    async def _acquire():  # type: ignore[no-untyped-def]
        yield mock_conn

    mock_pool.acquire = _acquire
    mock_pool.get_size = MagicMock(return_value=8)
    mock_pool.get_idle_size = MagicMock(return_value=5)
    mock_pool.get_min_size = MagicMock(return_value=2)
    mock_pool.get_max_size = MagicMock(return_value=10)

    return mock_pool


# ---------------------------------------------------------------------------
# PoolConfig tests
# ---------------------------------------------------------------------------


class TestPoolConfig:
    """AC: Pool configuration loaded from environment variables."""

    def test_defaults(self) -> None:
        cfg = PoolConfig()
        assert cfg.database_url == "postgresql://forgeos:forgeos@localhost:5432/forgeos"
        assert cfg.pool_min == 2
        assert cfg.pool_max == 10
        assert cfg.pool_idle_timeout == 300.0
        assert cfg.pool_command_timeout == 30.0

    def test_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("DATABASE_URL", "postgresql://u:p@host/db")
        monkeypatch.setenv("POOL_MIN", "5")
        monkeypatch.setenv("POOL_MAX", "20")
        monkeypatch.setenv("POOL_IDLE_TIMEOUT", "600")
        monkeypatch.setenv("POOL_COMMAND_TIMEOUT", "60")
        cfg = PoolConfig()
        assert cfg.database_url == "postgresql://u:p@host/db"
        assert cfg.pool_min == 5
        assert cfg.pool_max == 20
        assert cfg.pool_idle_timeout == 600.0
        assert cfg.pool_command_timeout == 60.0

    def test_min_validation(self) -> None:
        with pytest.raises(Exception):
            PoolConfig(pool_min=0)

    def test_max_validation(self) -> None:
        with pytest.raises(Exception):
            PoolConfig(pool_max=0)


# ---------------------------------------------------------------------------
# PoolStats tests
# ---------------------------------------------------------------------------


class TestPoolStats:
    def test_frozen_dataclass(self) -> None:
        stats = PoolStats(size=5, free_size=3, used_size=2, min_size=2, max_size=10)
        assert stats.size == 5
        assert stats.free_size == 3
        assert stats.used_size == 2
        assert stats.min_size == 2
        assert stats.max_size == 10

    def test_immutable(self) -> None:
        stats = PoolStats(size=5, free_size=3, used_size=2, min_size=2, max_size=10)
        with pytest.raises(AttributeError):
            stats.size = 99  # type: ignore[misc]


# ---------------------------------------------------------------------------
# ConnectionPool — construction
# ---------------------------------------------------------------------------


class TestConnectionPoolConstruction:
    def test_default_config(self) -> None:
        pool = ConnectionPool()
        assert pool._dsn == "postgresql://forgeos:forgeos@localhost:5432/forgeos"
        assert pool._min_size == 2
        assert pool._max_size == 10
        assert not pool.is_initialized

    def test_override_dsn(self) -> None:
        pool = ConnectionPool(dsn="postgresql://custom:pw@db/test")
        assert pool._dsn == "postgresql://custom:pw@db/test"

    def test_override_sizes(self) -> None:
        pool = ConnectionPool(min_size=5, max_size=25)
        assert pool._min_size == 5
        assert pool._max_size == 25

    def test_custom_config(self) -> None:
        cfg = PoolConfig(
            database_url="postgresql://x:y@z/d",
            pool_min=3,
            pool_max=15,
        )
        pool = ConnectionPool(config=cfg)
        assert pool._dsn == "postgresql://x:y@z/d"
        assert pool._min_size == 3
        assert pool._max_size == 15


# ---------------------------------------------------------------------------
# ConnectionPool — initialize
# ---------------------------------------------------------------------------


class TestConnectionPoolInitialize:
    """AC: asyncpg pool initializes with configurable min_size and max_size.
    AC: Pool initialization verifies database connectivity and fails fast.
    """

    @pytest.mark.asyncio
    async def test_initialize_creates_pool(self) -> None:
        mock_pool = _make_mock_pool()

        with patch("mcp_server.db.pool.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool
            pool = ConnectionPool(dsn="postgresql://test:test@localhost/test")
            await pool.initialize()
            assert pool.is_initialized
            mock_create.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_initialize_passes_config(self) -> None:
        mock_pool = _make_mock_pool()
        cfg = PoolConfig(pool_min=3, pool_max=20, pool_idle_timeout=120.0, pool_command_timeout=15.0)

        with patch("mcp_server.db.pool.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool
            pool = ConnectionPool(config=cfg)
            await pool.initialize()
            mock_create.assert_awaited_once_with(
                dsn=cfg.database_url,
                min_size=3,
                max_size=20,
                max_inactive_connection_lifetime=120.0,
                command_timeout=15.0,
            )

    @pytest.mark.asyncio
    async def test_initialize_fails_fast_on_connection_error(self) -> None:
        with patch("mcp_server.db.pool.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.side_effect = OSError("Connection refused")
            pool = ConnectionPool(dsn="postgresql://bad:bad@nowhere/db")
            with pytest.raises(ConnectionError, match="Failed to initialize"):
                await pool.initialize()
            assert not pool.is_initialized

    @pytest.mark.asyncio
    async def test_initialize_idempotent(self) -> None:
        mock_pool = _make_mock_pool()

        with patch("mcp_server.db.pool.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool
            pool = ConnectionPool()
            await pool.initialize()
            await pool.initialize()  # second call should be no-op
            assert mock_create.await_count == 1

    @pytest.mark.asyncio
    async def test_initialize_cleans_up_on_ping_failure(self) -> None:
        mock_pool = _make_mock_pool(fetchval_side_effect=Exception("DB error"))

        with patch("mcp_server.db.pool.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool
            pool = ConnectionPool()
            with pytest.raises(ConnectionError):
                await pool.initialize()
            assert not pool.is_initialized
            mock_pool.close.assert_awaited_once()


# ---------------------------------------------------------------------------
# ConnectionPool — close (graceful shutdown)
# ---------------------------------------------------------------------------


class TestConnectionPoolClose:
    """AC: Pool exposes a close() method for clean shutdown."""

    @pytest.mark.asyncio
    async def test_close_drains_pool(self) -> None:
        mock_pool = _make_mock_pool()

        with patch("mcp_server.db.pool.asyncpg.create_pool", new_callable=AsyncMock) as mock_create:
            mock_create.return_value = mock_pool
            pool = ConnectionPool()
            await pool.initialize()
            await pool.close()
            mock_pool.close.assert_awaited_once()
            assert not pool.is_initialized

    @pytest.mark.asyncio
    async def test_close_when_not_initialized(self) -> None:
        pool = ConnectionPool()
        await pool.close()  # should not raise


# ---------------------------------------------------------------------------
# ConnectionPool — ping (health check)
# ---------------------------------------------------------------------------


class TestConnectionPoolPing:
    """AC: Health check method verifies connectivity."""

    @pytest.mark.asyncio
    async def test_ping_success(self) -> None:
        mock_pool = _make_mock_pool()
        pool = ConnectionPool()
        pool._pool = mock_pool
        result = await pool.ping()
        assert result is True

    @pytest.mark.asyncio
    async def test_ping_failure(self) -> None:
        mock_pool = _make_mock_pool(fetchval_side_effect=Exception("connection lost"))
        pool = ConnectionPool()
        pool._pool = mock_pool
        with pytest.raises(ConnectionError, match="ping failed"):
            await pool.ping()

    @pytest.mark.asyncio
    async def test_ping_not_initialized(self) -> None:
        pool = ConnectionPool()
        with pytest.raises(PoolNotInitializedError):
            await pool.ping()


# ---------------------------------------------------------------------------
# ConnectionPool — acquire (async context manager)
# ---------------------------------------------------------------------------


class TestConnectionPoolAcquire:
    """AC: Pool provides async context manager for acquiring/releasing connections."""

    @pytest.mark.asyncio
    async def test_acquire_yields_connection(self) -> None:
        mock_pool = _make_mock_pool()
        pool = ConnectionPool()
        pool._pool = mock_pool
        async with pool.acquire() as conn:
            assert conn is not None

    @pytest.mark.asyncio
    async def test_acquire_not_initialized(self) -> None:
        pool = ConnectionPool()
        with pytest.raises(PoolNotInitializedError):
            async with pool.acquire():
                pass


# ---------------------------------------------------------------------------
# ConnectionPool — stats
# ---------------------------------------------------------------------------


class TestConnectionPoolStats:
    """AC: Pool statistics/metrics exposure."""

    def test_stats_returns_pool_stats(self) -> None:
        mock_pool = MagicMock()
        mock_pool.get_size.return_value = 8
        mock_pool.get_idle_size.return_value = 5
        mock_pool.get_min_size.return_value = 2
        mock_pool.get_max_size.return_value = 10

        pool = ConnectionPool()
        pool._pool = mock_pool
        result = pool.stats()
        assert isinstance(result, PoolStats)
        assert result.size == 8
        assert result.free_size == 5
        assert result.used_size == 3
        assert result.min_size == 2
        assert result.max_size == 10

    def test_stats_not_initialized(self) -> None:
        pool = ConnectionPool()
        with pytest.raises(PoolNotInitializedError):
            pool.stats()


# ---------------------------------------------------------------------------
# __init__.py re-exports
# ---------------------------------------------------------------------------


class TestPackageExports:
    def test_pool_importable_from_db_package(self) -> None:
        from mcp_server.db import ConnectionPool as CP
        from mcp_server.db import PoolConfig as PC
        from mcp_server.db import PoolNotInitializedError as PNIE
        from mcp_server.db import PoolStats as PS

        assert CP is ConnectionPool
        assert PC is PoolConfig
        assert PNIE is PoolNotInitializedError
        assert PS is PoolStats
