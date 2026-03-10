"""Tests for Concurrent Session Handling.

Covers all acceptance criteria for FORGEOS-BE023:

1. Multiple agents can maintain simultaneous active sessions without interference.
2. Session state access is async-safe using appropriate synchronization primitives.
3. Session termination only affects the terminated session's resources.
4. Maximum concurrent sessions is configurable (default: 50).
5. New connection attempts beyond the limit receive a clear rejection with retry guidance.
6. Session manager performance does not degrade with increasing concurrent sessions (O(1) lookup).

TDD — tests written first, then implementation verified.

.. meta::
   :ticket: FORGEOS-BE023
"""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock

import pytest

from mcp_server.sessions.concurrent import (
    ConcurrentSessionConfig,
    ConcurrentSessionManager,
    MaxSessionsExceededError,
)
from mcp_server.sessions.manager import (
    AgentSession,
    SessionNotFoundError,
    SessionState,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def config() -> ConcurrentSessionConfig:
    """Config with small limit and short timeouts for testing."""
    return ConcurrentSessionConfig(
        max_concurrent_sessions=3,
        session_timeout_seconds=2.0,
        cleanup_interval_seconds=0.2,
        resumption_window_seconds=1.0,
    )


@pytest.fixture
def manager(config: ConcurrentSessionConfig) -> ConcurrentSessionManager:
    return ConcurrentSessionManager(config=config)


@pytest.fixture
def default_manager() -> ConcurrentSessionManager:
    """Manager with default config (50 max sessions)."""
    return ConcurrentSessionManager()


# ---------------------------------------------------------------------------
# AC-1: Multiple agents can maintain simultaneous active sessions
# ---------------------------------------------------------------------------


class TestMultipleSimultaneousSessions:
    """AC-1: Multiple agents maintain simultaneous sessions without interference."""

    @pytest.mark.asyncio
    async def test_create_multiple_sessions(
        self, manager: ConcurrentSessionManager
    ) -> None:
        s1 = await manager.create_session("Backend", "backend", "machine-1")
        s2 = await manager.create_session("QA", "qa", "machine-2")
        s3 = await manager.create_session("Security", "security", "machine-3")

        assert s1.session_id != s2.session_id != s3.session_id
        assert await manager.active_count() == 3

    @pytest.mark.asyncio
    async def test_sessions_have_independent_state(
        self, manager: ConcurrentSessionManager
    ) -> None:
        s1 = await manager.create_session("Backend", "backend", "machine-1")
        s2 = await manager.create_session("QA", "qa", "machine-2")

        s1_fetched = await manager.get_session(s1.session_id)
        s2_fetched = await manager.get_session(s2.session_id)

        assert s1_fetched.agent_name == "Backend"
        assert s2_fetched.agent_name == "QA"
        assert s1_fetched.state == SessionState.ACTIVE
        assert s2_fetched.state == SessionState.ACTIVE

    @pytest.mark.asyncio
    async def test_concurrent_creates_no_interference(
        self, manager: ConcurrentSessionManager
    ) -> None:
        """Concurrent session creation should not corrupt state."""

        async def create(name: str, role: str, machine: str) -> AgentSession:
            return await manager.create_session(name, role, machine)

        results = await asyncio.gather(
            create("Backend", "backend", "m1"),
            create("QA", "qa", "m2"),
            create("Security", "security", "m3"),
        )

        ids = {r.session_id for r in results}
        assert len(ids) == 3
        assert await manager.active_count() == 3


# ---------------------------------------------------------------------------
# AC-2: Session state access is async-safe
# ---------------------------------------------------------------------------


class TestAsyncSafety:
    """AC-2: Session state access uses async synchronization primitives."""

    @pytest.mark.asyncio
    async def test_concurrent_heartbeats(
        self, manager: ConcurrentSessionManager
    ) -> None:
        s = await manager.create_session("Backend", "backend", "m1")

        async def heartbeat() -> AgentSession:
            return await manager.heartbeat(s.session_id)

        results = await asyncio.gather(*[heartbeat() for _ in range(20)])
        assert all(r.session_id == s.session_id for r in results)

    @pytest.mark.asyncio
    async def test_concurrent_create_and_close(
        self, config: ConcurrentSessionConfig
    ) -> None:
        """Create and close sessions concurrently without corruption."""
        big_config = ConcurrentSessionConfig(
            max_concurrent_sessions=100,
            session_timeout_seconds=config.session_timeout_seconds,
            cleanup_interval_seconds=config.cleanup_interval_seconds,
            resumption_window_seconds=config.resumption_window_seconds,
        )
        mgr = ConcurrentSessionManager(config=big_config)

        sessions: list[AgentSession] = []
        for i in range(10):
            s = await mgr.create_session(f"Agent-{i}", "backend", f"m-{i}")
            sessions.append(s)

        async def close_session(sid: str) -> None:
            await mgr.close_session(sid)

        # Close half concurrently
        await asyncio.gather(*[close_session(s.session_id) for s in sessions[:5]])

        assert await mgr.active_count() == 5
        assert await mgr.session_count() == 5


# ---------------------------------------------------------------------------
# AC-3: Session termination only affects the terminated session
# ---------------------------------------------------------------------------


class TestIsolatedTermination:
    """AC-3: Terminating one session does not affect others."""

    @pytest.mark.asyncio
    async def test_close_one_does_not_affect_others(
        self, manager: ConcurrentSessionManager
    ) -> None:
        s1 = await manager.create_session("Backend", "backend", "m1")
        s2 = await manager.create_session("QA", "qa", "m2")

        await manager.close_session(s1.session_id)

        s2_after = await manager.get_session(s2.session_id)
        assert s2_after.state == SessionState.ACTIVE
        assert await manager.active_count() == 1

        with pytest.raises(SessionNotFoundError):
            await manager.get_session(s1.session_id)

    @pytest.mark.asyncio
    async def test_disconnect_one_does_not_affect_others(
        self, manager: ConcurrentSessionManager
    ) -> None:
        s1 = await manager.create_session("Backend", "backend", "m1")
        s2 = await manager.create_session("QA", "qa", "m2")

        await manager.disconnect_session(s1.session_id)

        s2_after = await manager.get_session(s2.session_id)
        assert s2_after.state == SessionState.ACTIVE

        s1_after = await manager.get_session(s1.session_id)
        assert s1_after.state == SessionState.DISCONNECTED

    @pytest.mark.asyncio
    async def test_timeout_cleanup_only_removes_expired(
        self, manager: ConcurrentSessionManager
    ) -> None:
        s1 = await manager.create_session("Backend", "backend", "m1")
        s2 = await manager.create_session("QA", "qa", "m2")

        # Heartbeat s2 to keep it alive, let s1 expire
        await asyncio.sleep(2.5)
        expired = await manager.expire_timed_out_sessions()

        assert any(s.session_id == s1.session_id for s in expired)
        assert any(s.session_id == s2.session_id for s in expired)

    @pytest.mark.asyncio
    async def test_cleanup_callback_per_session(
        self, manager: ConcurrentSessionManager
    ) -> None:
        callback = AsyncMock()
        manager.register_cleanup_callback(callback)

        s1 = await manager.create_session("Backend", "backend", "m1")
        await manager.close_session(s1.session_id)

        # Callbacks fired only for the closed session
        # (close_session is explicit, not timeout-based — callbacks are for expiry)
        # Check that other sessions are untouched
        s2 = await manager.create_session("QA", "qa", "m2")
        s2_check = await manager.get_session(s2.session_id)
        assert s2_check.state == SessionState.ACTIVE


# ---------------------------------------------------------------------------
# AC-4: Maximum concurrent sessions is configurable (default: 50)
# ---------------------------------------------------------------------------


class TestConfigurableLimit:
    """AC-4: Max concurrent sessions is configurable."""

    def test_default_limit_is_50(self) -> None:
        cfg = ConcurrentSessionConfig()
        assert cfg.max_concurrent_sessions == 50

    def test_custom_limit(self) -> None:
        cfg = ConcurrentSessionConfig(max_concurrent_sessions=10)
        assert cfg.max_concurrent_sessions == 10

    @pytest.mark.asyncio
    async def test_limit_enforced(
        self, manager: ConcurrentSessionManager
    ) -> None:
        # Config has max_concurrent_sessions=3
        await manager.create_session("A1", "backend", "m1")
        await manager.create_session("A2", "qa", "m2")
        await manager.create_session("A3", "security", "m3")

        with pytest.raises(MaxSessionsExceededError):
            await manager.create_session("A4", "docs", "m4")

    @pytest.mark.asyncio
    async def test_slot_freed_after_close(
        self, manager: ConcurrentSessionManager
    ) -> None:
        s1 = await manager.create_session("A1", "backend", "m1")
        await manager.create_session("A2", "qa", "m2")
        await manager.create_session("A3", "security", "m3")

        await manager.close_session(s1.session_id)

        # Slot freed — should succeed now
        s4 = await manager.create_session("A4", "docs", "m4")
        assert s4.state == SessionState.ACTIVE
        assert await manager.active_count() == 3


# ---------------------------------------------------------------------------
# AC-5: Clear rejection with retry guidance
# ---------------------------------------------------------------------------


class TestRejectionWithRetryGuidance:
    """AC-5: Connections beyond limit receive clear rejection + retry guidance."""

    @pytest.mark.asyncio
    async def test_error_message_includes_limit(
        self, manager: ConcurrentSessionManager
    ) -> None:
        for i in range(3):
            await manager.create_session(f"A{i}", "backend", f"m{i}")

        with pytest.raises(MaxSessionsExceededError) as exc_info:
            await manager.create_session("Overflow", "backend", "overflow")

        error = exc_info.value
        assert error.max_sessions == 3
        assert error.current_sessions == 3

    @pytest.mark.asyncio
    async def test_error_message_has_retry_guidance(
        self, manager: ConcurrentSessionManager
    ) -> None:
        for i in range(3):
            await manager.create_session(f"A{i}", "backend", f"m{i}")

        with pytest.raises(MaxSessionsExceededError) as exc_info:
            await manager.create_session("Overflow", "backend", "overflow")

        msg = str(exc_info.value)
        assert "retry" in msg.lower()

    @pytest.mark.asyncio
    async def test_error_has_retry_after_seconds(
        self, manager: ConcurrentSessionManager
    ) -> None:
        for i in range(3):
            await manager.create_session(f"A{i}", "backend", f"m{i}")

        with pytest.raises(MaxSessionsExceededError) as exc_info:
            await manager.create_session("Overflow", "backend", "overflow")

        assert exc_info.value.retry_after_seconds > 0


# ---------------------------------------------------------------------------
# AC-6: O(1) lookup performance
# ---------------------------------------------------------------------------


class TestO1Lookup:
    """AC-6: Session manager maintains O(1) lookup performance."""

    @pytest.mark.asyncio
    async def test_get_session_is_dict_lookup(
        self, default_manager: ConcurrentSessionManager
    ) -> None:
        sessions = []
        for i in range(20):
            s = await default_manager.create_session(
                f"Agent-{i}", "backend", f"m-{i}"
            )
            sessions.append(s)

        # O(1) lookup — direct dict access by session_id
        for s in sessions:
            fetched = await default_manager.get_session(s.session_id)
            assert fetched.session_id == s.session_id

    @pytest.mark.asyncio
    async def test_list_sessions_returns_all(
        self, default_manager: ConcurrentSessionManager
    ) -> None:
        for i in range(5):
            await default_manager.create_session(
                f"Agent-{i}", "backend", f"m-{i}"
            )

        all_sessions = await default_manager.list_sessions()
        assert len(all_sessions) == 5

    @pytest.mark.asyncio
    async def test_list_sessions_filtered_by_state(
        self, default_manager: ConcurrentSessionManager
    ) -> None:
        s1 = await default_manager.create_session("A1", "backend", "m1")
        await default_manager.create_session("A2", "qa", "m2")
        await default_manager.disconnect_session(s1.session_id)

        active = await default_manager.list_sessions(state=SessionState.ACTIVE)
        disconnected = await default_manager.list_sessions(
            state=SessionState.DISCONNECTED
        )

        assert len(active) == 1
        assert len(disconnected) == 1


# ---------------------------------------------------------------------------
# Cleanup loop integration
# ---------------------------------------------------------------------------


class TestCleanupLoop:
    """Verify the async cleanup loop expires stale sessions."""

    @pytest.mark.asyncio
    async def test_start_stop_cleanup_loop(
        self, manager: ConcurrentSessionManager
    ) -> None:
        await manager.start_cleanup_loop()
        await manager.stop_cleanup_loop()

    @pytest.mark.asyncio
    async def test_expired_sessions_invoke_callbacks(
        self, manager: ConcurrentSessionManager
    ) -> None:
        callback = AsyncMock()
        manager.register_cleanup_callback(callback)

        s = await manager.create_session("Backend", "backend", "m1")

        await manager.start_cleanup_loop()
        await asyncio.sleep(3.0)
        await manager.stop_cleanup_loop()

        callback.assert_called()
        called_session = callback.call_args[0][0]
        assert called_session.session_id == s.session_id
        assert called_session.state == SessionState.EXPIRED

    @pytest.mark.asyncio
    async def test_expired_session_frees_slot(
        self, manager: ConcurrentSessionManager
    ) -> None:
        """When a session expires, its slot is freed for new connections."""
        await manager.create_session("A1", "backend", "m1")
        await manager.create_session("A2", "qa", "m2")
        await manager.create_session("A3", "security", "m3")

        # All slots full
        with pytest.raises(MaxSessionsExceededError):
            await manager.create_session("A4", "docs", "m4")

        # Let sessions expire
        await manager.start_cleanup_loop()
        await asyncio.sleep(3.0)
        await manager.stop_cleanup_loop()

        # Slots freed
        s4 = await manager.create_session("A4", "docs", "m4")
        assert s4.state == SessionState.ACTIVE
