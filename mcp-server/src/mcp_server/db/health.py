"""Connection pool health monitoring for the ForgeOS MCP server.

Provides :class:`PoolHealthMonitor`, a lightweight background monitor that
tracks pool statistics, detects dead connections via periodic ping, and
recycles stale connections when they exceed ``max_lifetime``.

The health report is exposed as a frozen :class:`HealthReport` dataclass
with a :meth:`~HealthReport.to_dict` method suitable for JSON serialization
in the ``/health`` endpoint.

Usage::

    from mcp_server.db.pool import ConnectionPool
    from mcp_server.db.health import PoolHealthMonitor

    pool = ConnectionPool()
    await pool.initialize()

    monitor = PoolHealthMonitor(pool, check_interval=30.0, max_lifetime=3600.0)
    monitor.start()

    report = monitor.health_report()
    health_dict = monitor.to_dict()

    await monitor.stop()
"""

from __future__ import annotations

import asyncio
import contextlib
import time
from dataclasses import dataclass
from typing import TYPE_CHECKING

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from mcp_server.db.pool import ConnectionPool

logger = get_logger("db.health")


@dataclass(frozen=True)
class HealthReport:
    """Snapshot of pool health metrics.

    Attributes
    ----------
    total_connections : int
        Total number of connections currently in the pool.
    active_connections : int
        Number of connections currently in use.
    idle_connections : int
        Number of connections available for use.
    waiting_requests : int
        Number of acquire requests currently waiting for a connection.
    saturation_pct : float
        Percentage of max pool capacity currently in active use.
    avg_wait_time_ms : float
        Average time (ms) callers waited to acquire a connection.
    max_lifetime_seconds : float
        Configured maximum connection lifetime before recycling.
    is_healthy : bool
        ``True`` if the last health check ping succeeded.
    last_check_epoch : float
        Monotonic timestamp of the last health check.
    """

    total_connections: int
    active_connections: int
    idle_connections: int
    waiting_requests: int
    saturation_pct: float
    avg_wait_time_ms: float
    max_lifetime_seconds: float
    is_healthy: bool
    last_check_epoch: float

    def to_dict(self) -> dict[str, int | float | bool]:
        """Return a JSON-serializable dict of all health metrics."""
        return {
            "total_connections": self.total_connections,
            "active_connections": self.active_connections,
            "idle_connections": self.idle_connections,
            "waiting_requests": self.waiting_requests,
            "saturation_pct": self.saturation_pct,
            "avg_wait_time_ms": self.avg_wait_time_ms,
            "max_lifetime_seconds": self.max_lifetime_seconds,
            "is_healthy": self.is_healthy,
            "last_check_epoch": self.last_check_epoch,
        }


class PoolHealthMonitor:
    """Background health monitor for an asyncpg connection pool.

    Tracks pool statistics, periodically pings the database to detect dead
    connections, and recycles stale connections that exceed ``max_lifetime``.

    Parameters
    ----------
    pool : ConnectionPool
        The connection pool to monitor.
    check_interval : float
        Seconds between health checks (default: 30.0).
    max_lifetime : float
        Maximum connection lifetime in seconds before recycling (default: 3600.0).
    """

    def __init__(
        self,
        pool: ConnectionPool,
        check_interval: float = 30.0,
        max_lifetime: float = 3600.0,
    ) -> None:
        self._pool = pool
        self._check_interval = check_interval
        self._max_lifetime = max_lifetime

        # Background task state
        self._task: asyncio.Task[None] | None = None

        # Health state
        self._last_ping_ok: bool = True
        self._last_check_epoch: float = 0.0
        self._last_recycle_epoch: float = time.monotonic()

        # Wait tracking metrics
        self._waiting_count: int = 0
        self._total_wait_time_ms: float = 0.0
        self._total_acquires: int = 0

    @property
    def is_running(self) -> bool:
        """Return ``True`` if the background health check task is active."""
        return self._task is not None and not self._task.done()

    def start(self) -> None:
        """Start the background health check loop.

        Idempotent — calling ``start()`` on an already-running monitor is a no-op.
        """
        if self.is_running:
            logger.warning("Health monitor already running — skipping start")
            return

        logger.info(
            "Starting pool health monitor (interval=%.1fs, max_lifetime=%.0fs)",
            self._check_interval,
            self._max_lifetime,
        )
        self._task = asyncio.get_event_loop().create_task(self._check_loop())

    async def stop(self) -> None:
        """Stop the background health check loop."""
        if self._task is None or self._task.done():
            return

        logger.info("Stopping pool health monitor")
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        self._task = None
        logger.info("Pool health monitor stopped")

    def health_report(self) -> HealthReport:
        """Build a health report from current pool state and tracked metrics.

        Returns
        -------
        HealthReport
            Frozen snapshot of all pool health metrics.
        """
        stats = self._pool.stats()
        max_size = stats.max_size

        active = stats.used_size
        saturation = (active / max_size * 100.0) if max_size > 0 else 0.0
        avg_wait = (
            self._total_wait_time_ms / self._total_acquires
            if self._total_acquires > 0
            else 0.0
        )

        return HealthReport(
            total_connections=stats.size,
            active_connections=active,
            idle_connections=stats.free_size,
            waiting_requests=self._waiting_count,
            saturation_pct=saturation,
            avg_wait_time_ms=avg_wait,
            max_lifetime_seconds=self._max_lifetime,
            is_healthy=self._last_ping_ok,
            last_check_epoch=self._last_check_epoch,
        )

    def to_dict(self) -> dict[str, int | float | bool]:
        """Return the current health report as a JSON-serializable dict."""
        return self.health_report().to_dict()

    # ------------------------------------------------------------------
    # Wait tracking API
    # ------------------------------------------------------------------

    def record_acquire_wait(self, wait_ms: float) -> None:
        """Record the wait time for a single connection acquire.

        Parameters
        ----------
        wait_ms : float
            Time in milliseconds the caller waited to acquire a connection.
        """
        self._total_wait_time_ms += wait_ms
        self._total_acquires += 1

    def increment_waiting(self) -> None:
        """Increment the count of requests currently waiting for a connection."""
        self._waiting_count += 1

    def decrement_waiting(self) -> None:
        """Decrement the count of requests waiting (clamped at 0)."""
        self._waiting_count = max(0, self._waiting_count - 1)

    # ------------------------------------------------------------------
    # Internal: background loop
    # ------------------------------------------------------------------

    async def _check_loop(self) -> None:
        """Periodic health check loop — runs until cancelled."""
        while True:
            try:
                await self._run_health_check()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("Unexpected error in health check loop")
            await asyncio.sleep(self._check_interval)

    async def _run_health_check(self) -> None:
        """Execute a single health check cycle.

        Steps:
        1. Ping the database to detect connectivity issues.
        2. If ping fails, expire all connections to force recycling.
        3. If max_lifetime has elapsed, expire connections to force rotation.
        """
        self._last_check_epoch = time.monotonic()

        # Step 1: Ping
        try:
            await self._pool.ping()
            self._last_ping_ok = True
            logger.debug("Health check ping succeeded")
        except (ConnectionError, Exception):
            self._last_ping_ok = False
            logger.warning("Health check ping failed — expiring connections")
            await self._expire_connections()
            return

        # Step 2: Check max_lifetime for stale connection recycling
        elapsed = time.monotonic() - self._last_recycle_epoch
        if elapsed >= self._max_lifetime:
            logger.info(
                "Connection max_lifetime exceeded (%.0fs >= %.0fs) — recycling",
                elapsed,
                self._max_lifetime,
            )
            await self._expire_connections()
            self._last_recycle_epoch = time.monotonic()

    async def _expire_connections(self) -> None:
        """Expire all connections in the pool, forcing recreation on next acquire."""
        if self._pool.is_initialized:
            await self._pool.raw_pool.expire_connections()
