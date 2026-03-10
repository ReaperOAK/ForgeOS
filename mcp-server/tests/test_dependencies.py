"""Tests for mcp_server.dependencies — dependency injection container.

TDD Evidence
------------
- RED:   tests written first defining expected DI behaviour.
- GREEN: dependencies.py implemented to satisfy each test.
- REFACTOR: frozen dataclass, static factory, typed accessors.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.dependencies import Dependencies


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_pool_instance() -> MagicMock:
    """Build a MagicMock that behaves like an asyncpg.Pool (raw)."""
    mock_conn = AsyncMock()
    mock_conn.fetchval = AsyncMock(return_value=1)

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
# Dependencies.create — happy path
# ---------------------------------------------------------------------------


class TestDependenciesCreate:
    """AC: Server startup initializes the asyncpg connection pool and all
    repository instances.
    """

    @pytest.mark.asyncio
    async def test_create_initializes_pool_and_repos(self) -> None:
        """All three repositories and the pool wrapper are created."""
        mock_raw_pool = _make_mock_pool_instance()

        with patch(
            "mcp_server.dependencies.ConnectionPool"
        ) as MockPoolClass:
            pool_instance = MagicMock()
            pool_instance.initialize = AsyncMock()
            pool_instance.raw_pool = mock_raw_pool
            pool_instance.close = AsyncMock()
            MockPoolClass.return_value = pool_instance

            deps = await Dependencies.create(
                dsn="postgresql://test:test@localhost/test",
                min_size=1,
                max_size=5,
            )

            pool_instance.initialize.assert_awaited_once()
            assert deps.pool is pool_instance
            assert deps.ticket_repo is not None
            assert deps.claim_repo is not None
            assert deps.event_repo is not None

    @pytest.mark.asyncio
    async def test_create_passes_config_to_pool(self) -> None:
        """Factory forwards DSN and size overrides to ConnectionPool."""
        mock_raw_pool = _make_mock_pool_instance()

        with patch(
            "mcp_server.dependencies.ConnectionPool"
        ) as MockPoolClass:
            pool_instance = MagicMock()
            pool_instance.initialize = AsyncMock()
            pool_instance.raw_pool = mock_raw_pool
            pool_instance.close = AsyncMock()
            MockPoolClass.return_value = pool_instance

            await Dependencies.create(
                dsn="postgresql://u:p@h/db",
                min_size=3,
                max_size=15,
            )

            MockPoolClass.assert_called_once()
            call_kwargs = MockPoolClass.call_args
            assert call_kwargs.kwargs["dsn"] == "postgresql://u:p@h/db"
            assert call_kwargs.kwargs["min_size"] == 3
            assert call_kwargs.kwargs["max_size"] == 15

    @pytest.mark.asyncio
    async def test_create_uses_default_pool_config(self) -> None:
        """When no PoolConfig is given, one is built from env vars."""
        mock_raw_pool = _make_mock_pool_instance()

        with patch(
            "mcp_server.dependencies.ConnectionPool"
        ) as MockPoolClass:
            pool_instance = MagicMock()
            pool_instance.initialize = AsyncMock()
            pool_instance.raw_pool = mock_raw_pool
            pool_instance.close = AsyncMock()
            MockPoolClass.return_value = pool_instance

            deps = await Dependencies.create()

            assert deps.pool is pool_instance


# ---------------------------------------------------------------------------
# Dependencies.create — failure path
# ---------------------------------------------------------------------------


class TestDependenciesCreateFailure:
    """AC: Database connection failure during startup produces a clear error."""

    @pytest.mark.asyncio
    async def test_create_raises_on_connection_error(self) -> None:
        """ConnectionError propagates when DB is unreachable."""
        with patch(
            "mcp_server.dependencies.ConnectionPool"
        ) as MockPoolClass:
            pool_instance = MagicMock()
            pool_instance.initialize = AsyncMock(
                side_effect=ConnectionError("connection refused")
            )
            MockPoolClass.return_value = pool_instance

            with pytest.raises(ConnectionError, match="connection refused"):
                await Dependencies.create(dsn="postgresql://bad/db")


# ---------------------------------------------------------------------------
# Dependencies.close
# ---------------------------------------------------------------------------


class TestDependenciesClose:
    """AC: Server shutdown closes the connection pool after draining."""

    @pytest.mark.asyncio
    async def test_close_drains_pool(self) -> None:
        """Calling close() delegates to the ConnectionPool wrapper."""
        mock_raw_pool = _make_mock_pool_instance()

        with patch(
            "mcp_server.dependencies.ConnectionPool"
        ) as MockPoolClass:
            pool_instance = MagicMock()
            pool_instance.initialize = AsyncMock()
            pool_instance.raw_pool = mock_raw_pool
            pool_instance.close = AsyncMock()
            MockPoolClass.return_value = pool_instance

            deps = await Dependencies.create()
            await deps.close()

            pool_instance.close.assert_awaited_once()


# ---------------------------------------------------------------------------
# Repository wiring — access patterns
# ---------------------------------------------------------------------------


class TestRepositoryWiring:
    """AC: Repository instances are accessible via dependency injection.
    AC: No direct pool access in tool handlers.
    """

    @pytest.mark.asyncio
    async def test_repos_receive_raw_pool(self) -> None:
        """Repositories are constructed with the raw asyncpg pool."""
        mock_raw_pool = _make_mock_pool_instance()

        with (
            patch("mcp_server.dependencies.ConnectionPool") as MockPoolClass,
            patch("mcp_server.dependencies.TicketRepository") as MockTicketRepo,
            patch("mcp_server.dependencies.ClaimRepository") as MockClaimRepo,
            patch("mcp_server.dependencies.EventRepository") as MockEventRepo,
        ):
            pool_instance = MagicMock()
            pool_instance.initialize = AsyncMock()
            pool_instance.raw_pool = mock_raw_pool
            pool_instance.close = AsyncMock()
            MockPoolClass.return_value = pool_instance

            await Dependencies.create()

            MockTicketRepo.assert_called_once_with(mock_raw_pool)
            MockClaimRepo.assert_called_once_with(mock_raw_pool)
            MockEventRepo.assert_called_once_with(mock_raw_pool)

    @pytest.mark.asyncio
    async def test_dependencies_is_frozen(self) -> None:
        """Dependencies dataclass is immutable after construction."""
        mock_raw_pool = _make_mock_pool_instance()

        with patch(
            "mcp_server.dependencies.ConnectionPool"
        ) as MockPoolClass:
            pool_instance = MagicMock()
            pool_instance.initialize = AsyncMock()
            pool_instance.raw_pool = mock_raw_pool
            pool_instance.close = AsyncMock()
            MockPoolClass.return_value = pool_instance

            deps = await Dependencies.create()

            with pytest.raises(AttributeError):
                deps.pool = MagicMock()  # type: ignore[misc]
