"""Tests for mcp_server.lifecycle.shutdown — Graceful Shutdown with Request Draining.

TDD test suite covering:
- ShutdownConfig validation
- ShutdownState enum
- ShutdownError domain exception
- GracefulShutdownManager initialisation
- Request tracking & concurrency safety
- Signal handler registration
- Shutdown sequence (drain → cleanup → close)
- Cleanup callback LIFO execution
- Database pool cleanup
- Status reporting
"""

from __future__ import annotations

import asyncio
import signal
import threading
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.lifecycle.shutdown import (
    GracefulShutdownManager,
    ShutdownConfig,
    ShutdownError,
    ShutdownState,
)


# ───────────────────────────────────────────────────────────────────────────
# ShutdownConfig
# ───────────────────────────────────────────────────────────────────────────


class TestShutdownConfig:
    """Validate ShutdownConfig defaults and constraints."""

    def test_default_values(self) -> None:
        cfg = ShutdownConfig()
        assert cfg.shutdown_timeout_seconds == 30.0
        assert cfg.drain_poll_interval_seconds == 0.5

    def test_custom_values(self) -> None:
        cfg = ShutdownConfig(shutdown_timeout_seconds=10.0, drain_poll_interval_seconds=0.1)
        assert cfg.shutdown_timeout_seconds == 10.0
        assert cfg.drain_poll_interval_seconds == 0.1

    def test_zero_timeout_raises(self) -> None:
        with pytest.raises(ValueError, match="shutdown_timeout_seconds must be > 0"):
            ShutdownConfig(shutdown_timeout_seconds=0)

    def test_negative_timeout_raises(self) -> None:
        with pytest.raises(ValueError, match="shutdown_timeout_seconds must be > 0"):
            ShutdownConfig(shutdown_timeout_seconds=-1)

    def test_zero_poll_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="drain_poll_interval_seconds must be > 0"):
            ShutdownConfig(drain_poll_interval_seconds=0)

    def test_negative_poll_interval_raises(self) -> None:
        with pytest.raises(ValueError, match="drain_poll_interval_seconds must be > 0"):
            ShutdownConfig(drain_poll_interval_seconds=-5)

    def test_frozen(self) -> None:
        cfg = ShutdownConfig()
        with pytest.raises(AttributeError):
            cfg.shutdown_timeout_seconds = 99  # type: ignore[misc]


# ───────────────────────────────────────────────────────────────────────────
# ShutdownState
# ───────────────────────────────────────────────────────────────────────────


class TestShutdownState:
    """Verify the three lifecycle states."""

    def test_running_value(self) -> None:
        assert ShutdownState.RUNNING.value == "running"

    def test_draining_value(self) -> None:
        assert ShutdownState.DRAINING.value == "draining"

    def test_shutdown_value(self) -> None:
        assert ShutdownState.SHUTDOWN.value == "shutdown"


# ───────────────────────────────────────────────────────────────────────────
# ShutdownError
# ───────────────────────────────────────────────────────────────────────────


class TestShutdownError:
    """Domain exception for rejected requests during shutdown."""

    def test_is_exception(self) -> None:
        assert issubclass(ShutdownError, Exception)

    def test_message(self) -> None:
        err = ShutdownError("going down")
        assert str(err) == "going down"


# ───────────────────────────────────────────────────────────────────────────
# GracefulShutdownManager — Init
# ───────────────────────────────────────────────────────────────────────────


class TestGracefulShutdownManagerInit:
    """Construction and initial state."""

    def test_default_config(self) -> None:
        mgr = GracefulShutdownManager()
        assert mgr.config == ShutdownConfig()

    def test_custom_config(self) -> None:
        cfg = ShutdownConfig(shutdown_timeout_seconds=5)
        mgr = GracefulShutdownManager(config=cfg)
        assert mgr.config.shutdown_timeout_seconds == 5

    def test_initial_state_running(self) -> None:
        mgr = GracefulShutdownManager()
        assert mgr.state == ShutdownState.RUNNING

    def test_initial_in_flight_zero(self) -> None:
        mgr = GracefulShutdownManager()
        assert mgr.in_flight_requests == 0

    def test_shutdown_complete_initially_unset(self) -> None:
        mgr = GracefulShutdownManager()
        assert not mgr.shutdown_complete.is_set()

    def test_has_lock(self) -> None:
        mgr = GracefulShutdownManager()
        assert isinstance(mgr._lock, type(threading.Lock()))


# ───────────────────────────────────────────────────────────────────────────
# Request Tracking
# ───────────────────────────────────────────────────────────────────────────


class TestRequestTracking:
    """track_request / complete_request / request_scope."""

    def test_track_increments(self) -> None:
        mgr = GracefulShutdownManager()
        mgr.track_request()
        assert mgr.in_flight_requests == 1

    def test_complete_decrements(self) -> None:
        mgr = GracefulShutdownManager()
        mgr.track_request()
        mgr.complete_request()
        assert mgr.in_flight_requests == 0

    def test_complete_does_not_go_negative(self) -> None:
        mgr = GracefulShutdownManager()
        mgr.complete_request()
        assert mgr.in_flight_requests == 0

    def test_track_rejected_when_draining(self) -> None:
        mgr = GracefulShutdownManager()
        mgr._state = ShutdownState.DRAINING
        with pytest.raises(ShutdownError, match="shutting down"):
            mgr.track_request()

    def test_track_rejected_when_shutdown(self) -> None:
        mgr = GracefulShutdownManager()
        mgr._state = ShutdownState.SHUTDOWN
        with pytest.raises(ShutdownError):
            mgr.track_request()

    def test_request_scope_tracks_and_completes(self) -> None:
        mgr = GracefulShutdownManager()
        with mgr.request_scope():
            assert mgr.in_flight_requests == 1
        assert mgr.in_flight_requests == 0

    def test_request_scope_completes_on_exception(self) -> None:
        mgr = GracefulShutdownManager()
        with pytest.raises(RuntimeError):
            with mgr.request_scope():
                raise RuntimeError("boom")
        assert mgr.in_flight_requests == 0

    def test_concurrent_tracking(self) -> None:
        mgr = GracefulShutdownManager()
        errors: list[Exception] = []

        def worker() -> None:
            try:
                for _ in range(1000):
                    mgr.track_request()
                for _ in range(1000):
                    mgr.complete_request()
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=worker) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        assert not errors
        assert mgr.in_flight_requests == 0


# ───────────────────────────────────────────────────────────────────────────
# Signal Registration
# ───────────────────────────────────────────────────────────────────────────


class TestSignalRegistration:
    """Verify signals are wired to the event loop."""

    def test_registers_sigterm_and_sigint(self) -> None:
        loop = MagicMock(spec=asyncio.AbstractEventLoop)
        mgr = GracefulShutdownManager()
        mgr.register_signals(loop)
        sigs = {call.args[0] for call in loop.add_signal_handler.call_args_list}
        assert signal.SIGTERM in sigs
        assert signal.SIGINT in sigs


# ───────────────────────────────────────────────────────────────────────────
# Shutdown Sequence
# ───────────────────────────────────────────────────────────────────────────


class TestShutdownSequence:
    """initiate_shutdown → drain → cleanup → close."""

    @pytest.mark.asyncio
    async def test_initiate_shutdown_changes_state_to_draining(self) -> None:
        """With a stuck request the manager stays in DRAINING long enough to observe."""
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=0.3, drain_poll_interval_seconds=0.05)
        )
        # Keep a request in-flight so drain loop cannot finish instantly
        mgr.track_request()

        shutdown_task = asyncio.create_task(mgr.initiate_shutdown())
        await asyncio.sleep(0.05)
        assert mgr.state == ShutdownState.DRAINING
        # Let it timeout and finish
        await shutdown_task

    @pytest.mark.asyncio
    async def test_full_shutdown_reaches_shutdown_state(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        await mgr.initiate_shutdown()
        assert mgr.state == ShutdownState.SHUTDOWN

    @pytest.mark.asyncio
    async def test_shutdown_complete_event_set(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        await mgr.initiate_shutdown()
        assert mgr.shutdown_complete.is_set()

    @pytest.mark.asyncio
    async def test_idempotent_shutdown(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        await mgr.initiate_shutdown()
        await mgr.initiate_shutdown()  # second call is a no-op
        assert mgr.state == ShutdownState.SHUTDOWN

    @pytest.mark.asyncio
    async def test_drain_waits_for_requests(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=2, drain_poll_interval_seconds=0.05)
        )
        mgr.track_request()

        async def finish_later() -> None:
            await asyncio.sleep(0.15)
            mgr.complete_request()

        asyncio.create_task(finish_later())
        await mgr.initiate_shutdown()
        assert mgr.in_flight_requests == 0
        assert mgr.state == ShutdownState.SHUTDOWN

    @pytest.mark.asyncio
    async def test_drain_timeout_forces_shutdown(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=0.2, drain_poll_interval_seconds=0.05)
        )
        mgr.track_request()  # never completed — should timeout
        await mgr.initiate_shutdown()
        assert mgr.state == ShutdownState.SHUTDOWN
        assert mgr.in_flight_requests == 1  # still stuck


# ───────────────────────────────────────────────────────────────────────────
# Cleanup Callbacks
# ───────────────────────────────────────────────────────────────────────────


class TestCleanupCallbacks:
    """Cleanup callbacks execute during shutdown in LIFO order."""

    @pytest.mark.asyncio
    async def test_async_callback_called(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        cb = AsyncMock()
        mgr.add_cleanup_callback("test-cb", cb)
        await mgr.initiate_shutdown()
        cb.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_sync_callback_called(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        cb = MagicMock()
        mgr.add_cleanup_callback("sync-cb", cb)
        await mgr.initiate_shutdown()
        cb.assert_called_once()

    @pytest.mark.asyncio
    async def test_lifo_order(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        order: list[str] = []
        mgr.add_cleanup_callback("first", lambda: order.append("first"))
        mgr.add_cleanup_callback("second", lambda: order.append("second"))
        await mgr.initiate_shutdown()
        assert order == ["second", "first"]


# ───────────────────────────────────────────────────────────────────────────
# Database Pool Cleanup
# ───────────────────────────────────────────────────────────────────────────


class TestDatabasePoolCleanup:
    """DB pool close is called during shutdown when a pool has been set."""

    @pytest.mark.asyncio
    async def test_pool_closed(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        pool = AsyncMock()
        mgr.set_db_pool(pool)
        await mgr.initiate_shutdown()
        pool.close.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_no_pool_no_error(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        await mgr.initiate_shutdown()  # should not raise

    @pytest.mark.asyncio
    async def test_pool_close_error_logged(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        pool = AsyncMock()
        pool.close.side_effect = RuntimeError("pool boom")
        mgr.set_db_pool(pool)
        with patch("mcp_server.lifecycle.shutdown.logger") as mock_logger:
            await mgr.initiate_shutdown()
            mock_logger.exception.assert_called()


# ───────────────────────────────────────────────────────────────────────────
# Status Reporting
# ───────────────────────────────────────────────────────────────────────────


class TestStatusReporting:
    """status() returns a consistent snapshot."""

    def test_running_status(self) -> None:
        mgr = GracefulShutdownManager()
        s = mgr.status()
        assert s["state"] == "running"
        assert s["in_flight_requests"] == 0
        assert s["shutdown_complete"] is False

    @pytest.mark.asyncio
    async def test_shutdown_status(self) -> None:
        mgr = GracefulShutdownManager(
            config=ShutdownConfig(shutdown_timeout_seconds=1, drain_poll_interval_seconds=0.05)
        )
        await mgr.initiate_shutdown()
        s = mgr.status()
        assert s["state"] == "shutdown"
        assert s["shutdown_complete"] is True

    def test_status_includes_timeout(self) -> None:
        mgr = GracefulShutdownManager(config=ShutdownConfig(shutdown_timeout_seconds=42))
        assert mgr.status()["shutdown_timeout_seconds"] == 42
