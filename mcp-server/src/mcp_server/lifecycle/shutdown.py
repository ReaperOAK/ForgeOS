"""Graceful shutdown with request draining for the ForgeOS MCP Server.

Provides :class:`GracefulShutdownManager` which:
- Registers SIGTERM / SIGINT handlers on the running event loop.
- Tracks in-flight requests with a thread-safe counter.
- Drains pending requests before closing database connections.
- Executes registered cleanup callbacks in LIFO order.
- Times out if draining exceeds the configured threshold.

Usage::

    manager = GracefulShutdownManager()
    manager.register_signals(asyncio.get_running_loop())
    manager.set_db_pool(pool)

    # In request middleware:
    manager.track_request()
    try:
        ...
    finally:
        manager.complete_request()

    # Or, as a context manager:
    with manager.request_scope():
        ...
"""

from __future__ import annotations

import asyncio
import enum
import logging
import signal
import threading
from contextlib import contextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Generator

    import asyncpg

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Domain types
# ---------------------------------------------------------------------------


class ShutdownState(enum.Enum):
    """Lifecycle state of the server."""

    RUNNING = "running"
    DRAINING = "draining"
    SHUTDOWN = "shutdown"


class ShutdownError(Exception):
    """Raised when an operation is rejected because the server is shutting down."""


@dataclass(frozen=True)
class ShutdownConfig:
    """Validated configuration for graceful shutdown behaviour.

    Parameters
    ----------
    shutdown_timeout_seconds:
        Maximum wall-clock seconds to wait for in-flight requests to complete
        before forcibly closing.  Must be > 0.
    drain_poll_interval_seconds:
        Sleep interval between drain-loop polls.  Must be > 0.
    """

    shutdown_timeout_seconds: float = 30.0
    drain_poll_interval_seconds: float = 0.5

    def __post_init__(self) -> None:
        if self.shutdown_timeout_seconds <= 0:
            raise ValueError(
                f"shutdown_timeout_seconds must be > 0, got {self.shutdown_timeout_seconds}"
            )
        if self.drain_poll_interval_seconds <= 0:
            raise ValueError(
                f"drain_poll_interval_seconds must be > 0, got {self.drain_poll_interval_seconds}"
            )


# ---------------------------------------------------------------------------
# Manager
# ---------------------------------------------------------------------------


class GracefulShutdownManager:
    """Coordinates graceful shutdown with request draining.

    Thread-safe: the in-flight request counter is protected by a
    :class:`threading.Lock` so that ASGI / transport threads can call
    :meth:`track_request` / :meth:`complete_request` concurrently.
    """

    def __init__(self, config: ShutdownConfig | None = None) -> None:
        self._config = config or ShutdownConfig()
        self._state = ShutdownState.RUNNING
        self._in_flight: int = 0
        self._lock = threading.Lock()
        self._shutdown_complete = asyncio.Event()
        self._cleanup_callbacks: list[tuple[str, object]] = []
        self._db_pool: asyncpg.Pool | None = None  # type: ignore[type-arg]

    # -- properties ---------------------------------------------------------

    @property
    def state(self) -> ShutdownState:
        """Current lifecycle state."""
        return self._state

    @property
    def in_flight_requests(self) -> int:
        """Number of requests currently being processed."""
        with self._lock:
            return self._in_flight

    @property
    def config(self) -> ShutdownConfig:
        """Active shutdown configuration (read-only)."""
        return self._config

    @property
    def shutdown_complete(self) -> asyncio.Event:
        """Event that is set once shutdown has fully completed."""
        return self._shutdown_complete

    # -- request tracking ---------------------------------------------------

    def track_request(self) -> None:
        """Increment the in-flight counter.

        Raises
        ------
        ShutdownError
            If the server is no longer in ``RUNNING`` state.
        """
        with self._lock:
            if self._state != ShutdownState.RUNNING:
                raise ShutdownError("Server is shutting down — request rejected")
            self._in_flight += 1

    def complete_request(self) -> None:
        """Decrement the in-flight counter.

        Safe to call even when counter is already 0.
        """
        with self._lock:
            if self._in_flight > 0:
                self._in_flight -= 1

    @contextmanager
    def request_scope(self) -> Generator[None, None, None]:
        """Context manager that tracks a single request lifecycle."""
        self.track_request()
        try:
            yield
        finally:
            self.complete_request()

    # -- signal registration ------------------------------------------------

    def register_signals(self, loop: asyncio.AbstractEventLoop) -> None:
        """Register SIGTERM and SIGINT handlers on *loop*.

        When either signal fires, :meth:`initiate_shutdown` is scheduled as a
        task on the loop.
        """
        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(
                sig,
                lambda s=sig: asyncio.ensure_future(self._signal_handler(s)),
            )
        logger.info("Registered SIGTERM/SIGINT shutdown handlers")

    async def _signal_handler(self, sig: signal.Signals) -> None:
        """Handle a termination signal by initiating shutdown."""
        logger.info("Received signal %s — initiating graceful shutdown", sig.name)
        await self.initiate_shutdown()

    # -- cleanup callbacks --------------------------------------------------

    def add_cleanup_callback(self, name: str, callback: object) -> None:
        """Register an async callable to run during shutdown cleanup.

        Callbacks execute in **LIFO** order (last registered runs first).
        """
        self._cleanup_callbacks.append((name, callback))

    # -- database pool ------------------------------------------------------

    def set_db_pool(self, pool: asyncpg.Pool) -> None:  # type: ignore[type-arg]
        """Assign the database connection pool for cleanup during shutdown."""
        self._db_pool = pool

    # -- shutdown sequence --------------------------------------------------

    async def initiate_shutdown(self) -> None:
        """Begin the shutdown sequence: drain → cleanup → close.

        Idempotent: calling more than once is a no-op once shutdown has
        started.
        """
        with self._lock:
            if self._state != ShutdownState.RUNNING:
                logger.debug("Shutdown already in progress — skipping duplicate call")
                return
            self._state = ShutdownState.DRAINING
        logger.info(
            "Entering DRAINING state — waiting up to %.1fs for %d in-flight request(s)",
            self._config.shutdown_timeout_seconds,
            self._in_flight,
        )

        await self._drain_requests()
        await self._run_cleanup_callbacks()
        await self._close_db_pool()

        self._state = ShutdownState.SHUTDOWN
        self._shutdown_complete.set()
        logger.info("Shutdown complete")

    async def _drain_requests(self) -> None:
        """Poll until in-flight count reaches 0 or timeout expires."""
        elapsed = 0.0
        while True:
            with self._lock:
                count = self._in_flight
            if count == 0:
                logger.info("All requests drained")
                return
            if elapsed >= self._config.shutdown_timeout_seconds:
                logger.warning(
                    "Drain timeout reached (%.1fs) with %d request(s) still in flight — "
                    "proceeding with shutdown",
                    elapsed,
                    count,
                )
                return
            await asyncio.sleep(self._config.drain_poll_interval_seconds)
            elapsed += self._config.drain_poll_interval_seconds

    async def _run_cleanup_callbacks(self) -> None:
        """Execute registered cleanup callbacks in LIFO order."""
        for name, callback in reversed(self._cleanup_callbacks):
            try:
                if asyncio.iscoroutinefunction(callback):
                    await callback()  # type: ignore[operator]
                elif callable(callback):
                    callback()  # type: ignore[operator]
                logger.info("Cleanup callback '%s' completed", name)
            except Exception:
                logger.exception("Cleanup callback '%s' failed", name)

    async def _close_db_pool(self) -> None:
        """Close the database connection pool if one is assigned."""
        if self._db_pool is None:
            logger.debug("No DB pool to close")
            return
        try:
            await self._db_pool.close()
            logger.info("Database connection pool closed")
        except Exception:
            logger.exception("Error closing database connection pool")

    # -- introspection ------------------------------------------------------

    def status(self) -> dict[str, object]:
        """Return a snapshot of the manager's current status."""
        with self._lock:
            return {
                "state": self._state.value,
                "in_flight_requests": self._in_flight,
                "shutdown_timeout_seconds": self._config.shutdown_timeout_seconds,
                "shutdown_complete": self._shutdown_complete.is_set(),
            }
