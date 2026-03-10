"""asyncpg connection pool for the ForgeOS MCP server.

Provides :class:`ConnectionPool`, a thin wrapper around :func:`asyncpg.create_pool`
that adds:

* Configuration via environment variables (``DATABASE_URL``, ``POOL_MIN``,
  ``POOL_MAX``, ``POOL_IDLE_TIMEOUT``, ``POOL_COMMAND_TIMEOUT``).
* Async context manager for acquiring/releasing connections.
* Health-check / ping method.
* Graceful shutdown (drain all connections).
* Pool statistics / metrics exposure.

Usage::

    pool = ConnectionPool()
    await pool.initialize()

    async with pool.acquire() as conn:
        row = await conn.fetchrow("SELECT 1")

    stats = pool.stats()
    await pool.close()
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

import asyncpg  # type: ignore[import-untyped]
from pydantic import Field
from pydantic_settings import BaseSettings

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

logger = get_logger("db.pool")


class PoolConfig(BaseSettings):
    """Pool configuration loaded from environment variables.

    Attributes
    ----------
    database_url : str
        PostgreSQL connection URI (``DATABASE_URL``).
    pool_min : int
        Minimum number of idle connections (``POOL_MIN``).
    pool_max : int
        Maximum number of connections (``POOL_MAX``).
    pool_idle_timeout : float
        Seconds before an idle connection is recycled (``POOL_IDLE_TIMEOUT``).
    pool_command_timeout : float
        Default query timeout in seconds (``POOL_COMMAND_TIMEOUT``).
    """

    database_url: str = Field(
        default="postgresql://forgeos:forgeos@localhost:5432/forgeos",
        description="PostgreSQL connection URI",
    )
    pool_min: int = Field(
        default=2,
        ge=1,
        description="Minimum number of idle connections",
    )
    pool_max: int = Field(
        default=10,
        ge=1,
        description="Maximum number of connections",
    )
    pool_idle_timeout: float = Field(
        default=300.0,
        gt=0,
        description="Seconds before idle connections are recycled",
    )
    pool_command_timeout: float = Field(
        default=30.0,
        gt=0,
        description="Default query timeout in seconds",
    )

    model_config = {"env_prefix": ""}


@dataclass(frozen=True)
class PoolStats:
    """Snapshot of pool metrics.

    Attributes
    ----------
    size : int
        Total number of connections in the pool.
    free_size : int
        Number of idle (available) connections.
    used_size : int
        Number of connections currently in use.
    min_size : int
        Configured minimum pool size.
    max_size : int
        Configured maximum pool size.
    """

    size: int
    free_size: int
    used_size: int
    min_size: int
    max_size: int


class PoolNotInitializedError(Exception):
    """Raised when pool operations are attempted before initialization."""


class ConnectionPool:
    """asyncpg-backed connection pool with lifecycle management.

    Parameters
    ----------
    config : PoolConfig | None
        Pool configuration. Defaults to loading from environment variables.
    dsn : str | None
        Override database URL (takes precedence over ``config.database_url``).
    min_size : int | None
        Override minimum pool size.
    max_size : int | None
        Override maximum pool size.
    """

    def __init__(
        self,
        config: PoolConfig | None = None,
        *,
        dsn: str | None = None,
        min_size: int | None = None,
        max_size: int | None = None,
    ) -> None:
        self._config = config or PoolConfig()
        self._dsn = dsn or self._config.database_url
        self._min_size = min_size if min_size is not None else self._config.pool_min
        self._max_size = max_size if max_size is not None else self._config.pool_max
        self._pool: asyncpg.Pool[Any] | None = None

    @property
    def is_initialized(self) -> bool:
        """Return ``True`` if the pool has been initialized and not closed."""
        return self._pool is not None

    @property
    def raw_pool(self) -> asyncpg.Pool[Any]:
        """Return the underlying asyncpg pool for repository injection.

        Raises
        ------
        PoolNotInitializedError
            If the pool has not been initialized.
        """
        return self._ensure_pool()

    async def initialize(self) -> None:
        """Create the asyncpg pool and verify database connectivity.

        Raises
        ------
        ConnectionError
            If the database is unreachable or credentials are invalid.
        """
        if self._pool is not None:
            logger.warning("Pool already initialized — skipping")
            return

        logger.info(
            "Initializing connection pool (min=%d, max=%d, idle_timeout=%.0fs)",
            self._min_size,
            self._max_size,
            self._config.pool_idle_timeout,
        )

        try:
            self._pool = await asyncpg.create_pool(
                dsn=self._dsn,
                min_size=self._min_size,
                max_size=self._max_size,
                max_inactive_connection_lifetime=self._config.pool_idle_timeout,
                command_timeout=self._config.pool_command_timeout,
            )
        except (
            asyncpg.InvalidCatalogNameError,
            asyncpg.InvalidAuthorizationSpecificationError,
            OSError,
            asyncio.TimeoutError,
        ) as exc:
            raise ConnectionError(
                f"Failed to initialize connection pool: {exc}"
            ) from exc

        # Verify connectivity with a simple ping.
        try:
            await self.ping()
        except Exception:
            # Clean up the pool if ping fails.
            await self._close_pool()
            raise

        logger.info("Connection pool initialized successfully")

    async def close(self) -> None:
        """Gracefully close the pool, draining all connections."""
        if self._pool is None:
            logger.warning("Pool not initialized — nothing to close")
            return

        logger.info("Closing connection pool …")
        await self._close_pool()
        logger.info("Connection pool closed")

    async def ping(self) -> bool:
        """Verify database connectivity by executing ``SELECT 1``.

        Returns
        -------
        bool
            ``True`` if the database responded successfully.

        Raises
        ------
        PoolNotInitializedError
            If the pool has not been initialized.
        ConnectionError
            If the database is unreachable.
        """
        pool = self._ensure_pool()
        try:
            async with pool.acquire() as conn:
                await conn.fetchval("SELECT 1")
            return True
        except Exception as exc:
            raise ConnectionError(f"Database ping failed: {exc}") from exc

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[asyncpg.Connection[Any]]:
        """Acquire a connection from the pool.

        Yields
        ------
        asyncpg.Connection
            A database connection that is automatically returned to the pool
            when the context manager exits.

        Raises
        ------
        PoolNotInitializedError
            If the pool has not been initialized.
        """
        pool = self._ensure_pool()
        async with pool.acquire() as conn:
            yield conn

    def stats(self) -> PoolStats:
        """Return a snapshot of pool metrics.

        Returns
        -------
        PoolStats
            Current pool statistics.

        Raises
        ------
        PoolNotInitializedError
            If the pool has not been initialized.
        """
        pool = self._ensure_pool()
        return PoolStats(
            size=pool.get_size(),
            free_size=pool.get_idle_size(),
            used_size=pool.get_size() - pool.get_idle_size(),
            min_size=pool.get_min_size(),
            max_size=pool.get_max_size(),
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_pool(self) -> asyncpg.Pool[Any]:
        """Return the underlying pool, raising if not initialized."""
        if self._pool is None:
            raise PoolNotInitializedError(
                "Connection pool has not been initialized. Call initialize() first."
            )
        return self._pool

    async def _close_pool(self) -> None:
        """Close the underlying asyncpg pool and reset internal state."""
        if self._pool is not None:
            await self._pool.close()
            self._pool = None
