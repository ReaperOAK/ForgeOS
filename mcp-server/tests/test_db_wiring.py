"""Tests for the server-to-database wiring (FORGEOS-BE018).

TDD Evidence
------------
- RED:   tests written first defining lifespan, AppContext, and health wiring.
- GREEN: server.py updated to satisfy each test.
- REFACTOR: AppContext uses Dependencies, HealthChecker receives ConnectionPool.

Coverage targets:
- _app_lifespan happy path (pool + repos created)
- _app_lifespan degraded mode (no DB)
- _app_lifespan db_required=True + failure => sys.exit(1)
- AppContext property accessors (backward compat + repo shortcuts)
- health_check tool verifies DB connectivity through the pool
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.server import AppContext, ServerConfig


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_deps() -> MagicMock:
    """Build a mock Dependencies with pool and repos."""
    deps = MagicMock()
    deps.pool = MagicMock()
    deps.pool.is_initialized = True
    deps.pool.close = AsyncMock()
    deps.ticket_repo = MagicMock()
    deps.claim_repo = MagicMock()
    deps.event_repo = MagicMock()
    deps.close = AsyncMock()
    return deps


def _make_mock_pool_instance() -> MagicMock:
    """Build a MagicMock that behaves like a raw asyncpg.Pool."""
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
# ServerConfig — db_required field
# ---------------------------------------------------------------------------


class TestServerConfigDbRequired:
    """AC: Support configuration via environment variables."""

    def test_db_required_defaults_false(self) -> None:
        config = ServerConfig()
        assert config.db_required is False

    def test_db_required_env_override(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setenv("FORGEOS_DB_REQUIRED", "true")
        config = ServerConfig()
        assert config.db_required is True


# ---------------------------------------------------------------------------
# AppContext — property accessors
# ---------------------------------------------------------------------------


class TestAppContextProperties:
    """AC: Repository instances accessible to tool handlers via DI."""

    def test_db_pool_returns_pool_wrapper(self) -> None:
        deps = _make_mock_deps()
        ctx = AppContext(dependencies=deps)
        assert ctx.db_pool is deps.pool

    def test_db_pool_none_without_deps(self) -> None:
        ctx = AppContext()
        assert ctx.db_pool is None

    def test_ticket_repo_shortcut(self) -> None:
        deps = _make_mock_deps()
        ctx = AppContext(dependencies=deps)
        assert ctx.ticket_repo is deps.ticket_repo

    def test_claim_repo_shortcut(self) -> None:
        deps = _make_mock_deps()
        ctx = AppContext(dependencies=deps)
        assert ctx.claim_repo is deps.claim_repo

    def test_event_repo_shortcut(self) -> None:
        deps = _make_mock_deps()
        ctx = AppContext(dependencies=deps)
        assert ctx.event_repo is deps.event_repo

    def test_repo_shortcuts_none_without_deps(self) -> None:
        ctx = AppContext()
        assert ctx.ticket_repo is None
        assert ctx.claim_repo is None
        assert ctx.event_repo is None


# ---------------------------------------------------------------------------
# _app_lifespan — happy path
# ---------------------------------------------------------------------------


class TestAppLifespanHappyPath:
    """AC: Server startup initializes pool and repos; shutdown drains."""

    @pytest.mark.asyncio
    async def test_lifespan_creates_dependencies(self) -> None:
        """Lifespan creates Dependencies and yields AppContext with them."""
        mock_deps = _make_mock_deps()
        mock_health = MagicMock()
        mock_health.mark_ready = MagicMock()
        mock_health.mark_draining = MagicMock()

        with (
            patch("mcp_server.server.ServerConfig") as MockConfig,
            patch("mcp_server.server._configure_logging"),
            patch(
                "mcp_server.dependencies.Dependencies.create",
                new_callable=AsyncMock,
                return_value=mock_deps,
            ) as mock_create,
            patch(
                "mcp_server.observability.health.HealthChecker",
                return_value=mock_health,
            ) as MockHealthChecker,
        ):
            config_instance = MagicMock()
            config_instance.host = "0.0.0.0"
            config_instance.port = 8080
            config_instance.log_level = "INFO"
            config_instance.database_url = "postgresql://test/db"
            config_instance.db_min_pool_size = 2
            config_instance.db_max_pool_size = 10
            config_instance.db_required = False
            MockConfig.return_value = config_instance

            from mcp_server.server import _app_lifespan

            fake_server = MagicMock()
            async with _app_lifespan(fake_server) as ctx:
                assert ctx.dependencies is mock_deps
                assert ctx.health_checker is mock_health
                mock_health.mark_ready.assert_called_once()

            mock_deps.close.assert_awaited_once()
            mock_health.mark_draining.assert_called_once()

    @pytest.mark.asyncio
    async def test_lifespan_passes_health_checker_pool_wrapper(self) -> None:
        """HealthChecker receives the ConnectionPool wrapper, not raw pool."""
        mock_deps = _make_mock_deps()

        with (
            patch("mcp_server.server.ServerConfig") as MockConfig,
            patch("mcp_server.server._configure_logging"),
            patch(
                "mcp_server.dependencies.Dependencies.create",
                new_callable=AsyncMock,
                return_value=mock_deps,
            ),
            patch(
                "mcp_server.observability.health.HealthChecker",
            ) as MockHealthChecker,
        ):
            config_instance = MagicMock()
            config_instance.host = "0.0.0.0"
            config_instance.port = 8080
            config_instance.log_level = "INFO"
            config_instance.database_url = "postgresql://test/db"
            config_instance.db_min_pool_size = 2
            config_instance.db_max_pool_size = 10
            config_instance.db_required = False
            MockConfig.return_value = config_instance

            mock_hc = MagicMock()
            mock_hc.mark_ready = MagicMock()
            mock_hc.mark_draining = MagicMock()
            MockHealthChecker.return_value = mock_hc

            from mcp_server.server import _app_lifespan

            fake_server = MagicMock()
            async with _app_lifespan(fake_server) as ctx:
                pass

            MockHealthChecker.assert_called_once_with(pool=mock_deps.pool)


# ---------------------------------------------------------------------------
# _app_lifespan — degraded mode (DB unavailable)
# ---------------------------------------------------------------------------


class TestAppLifespanDegraded:
    """AC: Server starts in degraded mode when DB is unavailable."""

    @pytest.mark.asyncio
    async def test_lifespan_degraded_when_db_unavailable(self) -> None:
        """When Dependencies.create raises, deps is None but server runs."""
        with (
            patch("mcp_server.server.ServerConfig") as MockConfig,
            patch("mcp_server.server._configure_logging"),
            patch(
                "mcp_server.dependencies.Dependencies.create",
                new_callable=AsyncMock,
                side_effect=ConnectionError("DB down"),
            ),
            patch(
                "mcp_server.observability.health.HealthChecker",
            ) as MockHealthChecker,
        ):
            config_instance = MagicMock()
            config_instance.host = "0.0.0.0"
            config_instance.port = 8080
            config_instance.log_level = "INFO"
            config_instance.database_url = "postgresql://test/db"
            config_instance.db_min_pool_size = 2
            config_instance.db_max_pool_size = 10
            config_instance.db_required = False
            MockConfig.return_value = config_instance

            mock_hc = MagicMock()
            mock_hc.mark_ready = MagicMock()
            mock_hc.mark_draining = MagicMock()
            MockHealthChecker.return_value = mock_hc

            from mcp_server.server import _app_lifespan

            fake_server = MagicMock()
            async with _app_lifespan(fake_server) as ctx:
                assert ctx.dependencies is None
                assert ctx.db_pool is None

            # HealthChecker called with None pool
            MockHealthChecker.assert_called_once_with(pool=None)


# ---------------------------------------------------------------------------
# _app_lifespan — db_required failure
# ---------------------------------------------------------------------------


class TestAppLifespanDbRequired:
    """AC: Database connection failure with db_required=True exits with
    non-zero code and clear error message.
    """

    @pytest.mark.asyncio
    async def test_lifespan_exits_when_db_required_and_fails(self) -> None:
        """sys.exit(1) is called when db_required=True and DB is unreachable."""
        with (
            patch("mcp_server.server.ServerConfig") as MockConfig,
            patch("mcp_server.server._configure_logging"),
            patch(
                "mcp_server.dependencies.Dependencies.create",
                new_callable=AsyncMock,
                side_effect=ConnectionError("refused"),
            ),
            patch("mcp_server.server.sys") as mock_sys,
        ):
            config_instance = MagicMock()
            config_instance.host = "0.0.0.0"
            config_instance.port = 8080
            config_instance.log_level = "INFO"
            config_instance.database_url = "postgresql://test/db"
            config_instance.db_min_pool_size = 2
            config_instance.db_max_pool_size = 10
            config_instance.db_required = True
            MockConfig.return_value = config_instance

            # sys.exit raises SystemExit
            mock_sys.exit = MagicMock(side_effect=SystemExit(1))

            from mcp_server.server import _app_lifespan

            fake_server = MagicMock()
            with pytest.raises(SystemExit):
                async with _app_lifespan(fake_server) as ctx:
                    pass  # pragma: no cover

            mock_sys.exit.assert_called_once_with(1)


# ---------------------------------------------------------------------------
# health_check tool — DB connectivity through pool
# ---------------------------------------------------------------------------


class TestHealthCheckWithDeps:
    """AC: Server health check verifies database connectivity through the pool."""

    @pytest.mark.asyncio
    async def test_health_check_delegates_to_health_checker(self) -> None:
        """When context is available, health_check uses HealthChecker."""
        from mcp_server.server import health_check

        mock_hc = MagicMock()
        mock_hc.health_check = AsyncMock(
            return_value={
                "status": "healthy",
                "version": "0.1.0",
                "uptime_seconds": 42.0,
                "database": {"status": "ok"},
            }
        )

        # Simulate the context object that FastMCP passes to tools
        mock_ctx = MagicMock()
        mock_ctx.request_context.lifespan_context.health_checker = mock_hc

        result = await health_check(mock_ctx)
        assert result["status"] == "healthy"
        assert result["database"]["status"] == "ok"
        mock_hc.health_check.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_health_check_fallback_without_context(self) -> None:
        """Without context, basic liveness response is returned."""
        from mcp_server import __version__
        from mcp_server.server import health_check

        result = await health_check()
        assert result["server"] == "ok"
        assert result["version"] == __version__
        assert result["database"]["status"] == "not_configured"


# ---------------------------------------------------------------------------
# ConnectionPool.raw_pool property
# ---------------------------------------------------------------------------


class TestConnectionPoolRawPool:
    """AC: ConnectionPool exposes raw asyncpg pool for repository injection."""

    def test_raw_pool_raises_when_not_initialized(self) -> None:
        from mcp_server.db.pool import ConnectionPool, PoolNotInitializedError

        pool = ConnectionPool()
        with pytest.raises(PoolNotInitializedError):
            _ = pool.raw_pool

    @pytest.mark.asyncio
    async def test_raw_pool_returns_underlying_pool(self) -> None:
        from mcp_server.db.pool import ConnectionPool

        mock_raw = _make_mock_pool_instance()

        with patch("mcp_server.db.pool.asyncpg") as mock_asyncpg:
            mock_asyncpg.create_pool = AsyncMock(return_value=mock_raw)
            mock_asyncpg.InvalidCatalogNameError = Exception
            mock_asyncpg.InvalidAuthorizationSpecificationError = Exception

            pool = ConnectionPool(dsn="postgresql://test/db")
            await pool.initialize()

            assert pool.raw_pool is mock_raw


# ---------------------------------------------------------------------------
# Graceful shutdown
# ---------------------------------------------------------------------------


class TestGracefulShutdown:
    """AC: Server shutdown closes pool after draining active connections."""

    @pytest.mark.asyncio
    async def test_lifespan_closes_deps_on_normal_exit(self) -> None:
        mock_deps = _make_mock_deps()

        with (
            patch("mcp_server.server.ServerConfig") as MockConfig,
            patch("mcp_server.server._configure_logging"),
            patch(
                "mcp_server.dependencies.Dependencies.create",
                new_callable=AsyncMock,
                return_value=mock_deps,
            ),
            patch(
                "mcp_server.observability.health.HealthChecker",
            ) as MockHealthChecker,
        ):
            config_instance = MagicMock()
            config_instance.host = "0.0.0.0"
            config_instance.port = 8080
            config_instance.log_level = "INFO"
            config_instance.database_url = "postgresql://test/db"
            config_instance.db_min_pool_size = 2
            config_instance.db_max_pool_size = 10
            config_instance.db_required = False
            MockConfig.return_value = config_instance

            mock_hc = MagicMock()
            mock_hc.mark_ready = MagicMock()
            mock_hc.mark_draining = MagicMock()
            MockHealthChecker.return_value = mock_hc

            from mcp_server.server import _app_lifespan

            fake_server = MagicMock()
            async with _app_lifespan(fake_server) as ctx:
                assert ctx.dependencies is not None

            mock_deps.close.assert_awaited_once()
            mock_hc.mark_draining.assert_called_once()

    @pytest.mark.asyncio
    async def test_lifespan_closes_deps_on_exception(self) -> None:
        """Deps are closed even if the tool handler raises."""
        mock_deps = _make_mock_deps()

        with (
            patch("mcp_server.server.ServerConfig") as MockConfig,
            patch("mcp_server.server._configure_logging"),
            patch(
                "mcp_server.dependencies.Dependencies.create",
                new_callable=AsyncMock,
                return_value=mock_deps,
            ),
            patch(
                "mcp_server.observability.health.HealthChecker",
            ) as MockHealthChecker,
        ):
            config_instance = MagicMock()
            config_instance.host = "0.0.0.0"
            config_instance.port = 8080
            config_instance.log_level = "INFO"
            config_instance.database_url = "postgresql://test/db"
            config_instance.db_min_pool_size = 2
            config_instance.db_max_pool_size = 10
            config_instance.db_required = False
            MockConfig.return_value = config_instance

            mock_hc = MagicMock()
            mock_hc.mark_ready = MagicMock()
            mock_hc.mark_draining = MagicMock()
            MockHealthChecker.return_value = mock_hc

            from mcp_server.server import _app_lifespan

            fake_server = MagicMock()
            with pytest.raises(RuntimeError, match="boom"):
                async with _app_lifespan(fake_server) as ctx:
                    raise RuntimeError("boom")

            mock_deps.close.assert_awaited_once()
