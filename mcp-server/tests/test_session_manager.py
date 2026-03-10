"""Tests for the Agent Session Lifecycle Management module.

Covers all acceptance criteria for FORGEOS-BE022:

1. Session creation with agent identity metadata.
2. Session stores agent_name, role, machine_id, connected_at, last_heartbeat.
3. Heartbeat updates last_heartbeat and extends timeout.
4. Timed-out sessions trigger cleanup callbacks.
5. Session resumption by ID with identity validation.
6. Session manager tracks/lists all active sessions.

TDD — tests written first, then implementation verified.

.. meta::
   :ticket: FORGEOS-BE022
"""

from __future__ import annotations

import asyncio
import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from mcp_server.sessions.manager import (
    AgentSession,
    SessionConfig,
    SessionExpiredError,
    SessionManager,
    SessionNotFoundError,
    SessionResumeError,
    SessionState,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def config() -> SessionConfig:
    """Short timeouts for testing."""
    return SessionConfig(
        session_timeout_seconds=2.0,
        cleanup_interval_seconds=0.2,
        resumption_window_seconds=1.0,
    )


@pytest.fixture
def manager(config: SessionConfig) -> SessionManager:
    """Fresh SessionManager with test config."""
    return SessionManager(config=config)


# ---------------------------------------------------------------------------
# AC-1: Session is created on MCP initialize with agent identity metadata
# ---------------------------------------------------------------------------


class TestSessionCreation:
    """AC-1: Session creation with agent identity metadata."""

    def test_create_session_returns_session(self, manager: SessionManager) -> None:
        session = manager.create_session("Backend", "backend", "pop-os")
        assert isinstance(session, AgentSession)

    def test_create_session_sets_identity(self, manager: SessionManager) -> None:
        session = manager.create_session("Backend", "backend", "pop-os")
        assert session.agent_name == "Backend"
        assert session.role == "backend"
        assert session.machine_id == "pop-os"

    def test_create_session_generates_unique_id(self, manager: SessionManager) -> None:
        s1 = manager.create_session("Backend", "backend", "pop-os")
        s2 = manager.create_session("QA", "qa", "pop-os")
        assert s1.session_id != s2.session_id

    def test_create_session_with_explicit_id(self, manager: SessionManager) -> None:
        session = manager.create_session(
            "Backend", "backend", "pop-os", session_id="test-id-123"
        )
        assert session.session_id == "test-id-123"

    def test_create_session_with_metadata(self, manager: SessionManager) -> None:
        meta = {"version": "1.0", "capabilities": ["tools"]}
        session = manager.create_session(
            "Backend", "backend", "pop-os", metadata=meta
        )
        assert session.metadata == meta

    def test_create_session_initial_state_is_active(
        self, manager: SessionManager
    ) -> None:
        session = manager.create_session("Backend", "backend", "pop-os")
        assert session.state == SessionState.ACTIVE


# ---------------------------------------------------------------------------
# AC-2: Session stores timestamps and identity
# ---------------------------------------------------------------------------


class TestSessionTimestamps:
    """AC-2: Session stores agent_name, role, machine_id, connected_at, last_heartbeat."""

    def test_connected_at_is_set(self, manager: SessionManager) -> None:
        before = datetime.now(timezone.utc)
        session = manager.create_session("Backend", "backend", "pop-os")
        after = datetime.now(timezone.utc)
        assert before <= session.connected_at <= after

    def test_last_heartbeat_equals_connected_at_initially(
        self, manager: SessionManager
    ) -> None:
        session = manager.create_session("Backend", "backend", "pop-os")
        assert session.last_heartbeat == session.connected_at

    def test_disconnected_at_is_none_initially(
        self, manager: SessionManager
    ) -> None:
        session = manager.create_session("Backend", "backend", "pop-os")
        assert session.disconnected_at is None

    def test_to_dict_serialization(self, manager: SessionManager) -> None:
        session = manager.create_session(
            "Backend", "backend", "pop-os", metadata={"key": "val"}
        )
        d = session.to_dict()
        assert d["session_id"] == session.session_id
        assert d["agent_name"] == "Backend"
        assert d["role"] == "backend"
        assert d["machine_id"] == "pop-os"
        assert d["state"] == "active"
        assert d["disconnected_at"] is None
        assert d["claimed_ticket_ids"] == []
        assert d["metadata"] == {"key": "val"}
        # Timestamps are ISO format strings
        assert isinstance(d["connected_at"], str)
        assert isinstance(d["last_heartbeat"], str)


# ---------------------------------------------------------------------------
# AC-3: Heartbeat updates last_heartbeat and extends timeout
# ---------------------------------------------------------------------------


class TestHeartbeat:
    """AC-3: Heartbeat updates last_heartbeat and extends session timeout."""

    def test_heartbeat_updates_timestamp(self, manager: SessionManager) -> None:
        session = manager.create_session("Backend", "backend", "pop-os")
        original_hb = session.last_heartbeat
        # Small delay to ensure timestamp difference
        time.sleep(0.01)
        updated = manager.heartbeat(session.session_id)
        assert updated.last_heartbeat > original_hb

    def test_heartbeat_returns_same_session(self, manager: SessionManager) -> None:
        session = manager.create_session(
            "Backend", "backend", "pop-os", session_id="hb-test"
        )
        updated = manager.heartbeat("hb-test")
        assert updated.session_id == "hb-test"
        assert updated.agent_name == "Backend"

    def test_heartbeat_nonexistent_session_raises(
        self, manager: SessionManager
    ) -> None:
        with pytest.raises(SessionNotFoundError) as exc_info:
            manager.heartbeat("does-not-exist")
        assert "does-not-exist" in str(exc_info.value)

    def test_heartbeat_expired_session_raises(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="exp-hb"
        )
        manager.close_session("exp-hb")
        with pytest.raises(SessionNotFoundError):
            manager.heartbeat("exp-hb")

    def test_heartbeat_disconnected_session_still_works(
        self, manager: SessionManager
    ) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="disc-hb"
        )
        manager.disconnect_session("disc-hb")
        # Heartbeat should still work on disconnected session (before expiry)
        updated = manager.heartbeat("disc-hb")
        assert updated.session_id == "disc-hb"


# ---------------------------------------------------------------------------
# AC-4: Timed-out sessions trigger cleanup
# ---------------------------------------------------------------------------


class TestTimeoutCleanup:
    """AC-4: Timed-out sessions trigger cleanup: release claims, close connection."""

    @pytest.fixture
    def short_config(self) -> SessionConfig:
        return SessionConfig(
            session_timeout_seconds=0.1,
            cleanup_interval_seconds=0.05,
            resumption_window_seconds=0.05,
        )

    @pytest.fixture
    def short_manager(self, short_config: SessionConfig) -> SessionManager:
        return SessionManager(config=short_config)

    @pytest.mark.asyncio
    async def test_cleanup_loop_expires_timed_out_sessions(
        self, short_manager: SessionManager
    ) -> None:
        session = short_manager.create_session("Backend", "backend", "pop-os")
        sid = session.session_id

        await short_manager.start_cleanup_loop()
        try:
            # Wait for the session to timeout and cleanup to run
            await asyncio.sleep(0.4)
        finally:
            await short_manager.stop_cleanup_loop()

        # Session should be gone
        assert short_manager.session_count == 0
        with pytest.raises(SessionNotFoundError):
            short_manager.get_session(sid)

    @pytest.mark.asyncio
    async def test_cleanup_invokes_callbacks(
        self, short_manager: SessionManager
    ) -> None:
        callback = AsyncMock()
        short_manager.register_cleanup_callback(callback)

        short_manager.create_session(
            "Backend", "backend", "pop-os", session_id="cb-test"
        )
        short_manager.add_claim("cb-test", "TICKET-001")

        await short_manager.start_cleanup_loop()
        try:
            await asyncio.sleep(0.4)
        finally:
            await short_manager.stop_cleanup_loop()

        callback.assert_called_once()
        expired_session = callback.call_args[0][0]
        assert expired_session.session_id == "cb-test"
        assert expired_session.state == SessionState.EXPIRED
        assert "TICKET-001" in expired_session.claimed_ticket_ids

    @pytest.mark.asyncio
    async def test_cleanup_callback_error_does_not_crash_loop(
        self, short_manager: SessionManager
    ) -> None:
        failing_callback = AsyncMock(side_effect=RuntimeError("cleanup failed"))
        ok_callback = AsyncMock()
        short_manager.register_cleanup_callback(failing_callback)
        short_manager.register_cleanup_callback(ok_callback)

        short_manager.create_session("Backend", "backend", "pop-os")

        await short_manager.start_cleanup_loop()
        try:
            await asyncio.sleep(0.4)
        finally:
            await short_manager.stop_cleanup_loop()

        # Both callbacks should have been called despite the first failing
        failing_callback.assert_called_once()
        ok_callback.assert_called_once()

    @pytest.mark.asyncio
    async def test_cleanup_expires_disconnected_past_window(
        self,
    ) -> None:
        config = SessionConfig(
            session_timeout_seconds=10.0,  # long active timeout
            cleanup_interval_seconds=0.05,
            resumption_window_seconds=0.1,  # short resumption window
        )
        mgr = SessionManager(config=config)
        mgr.create_session(
            "Backend", "backend", "pop-os", session_id="disc-exp"
        )
        mgr.disconnect_session("disc-exp")

        await mgr.start_cleanup_loop()
        try:
            await asyncio.sleep(0.4)
        finally:
            await mgr.stop_cleanup_loop()

        with pytest.raises(SessionNotFoundError):
            mgr.get_session("disc-exp")

    @pytest.mark.asyncio
    async def test_stop_cleanup_loop_idempotent(
        self, manager: SessionManager
    ) -> None:
        await manager.stop_cleanup_loop()  # Should not raise
        await manager.start_cleanup_loop()
        await manager.stop_cleanup_loop()
        await manager.stop_cleanup_loop()  # Double stop should also be safe

    @pytest.mark.asyncio
    async def test_active_session_with_heartbeat_not_expired(
        self, short_manager: SessionManager
    ) -> None:
        """A session that heartbeats within the timeout should not expire."""
        short_manager.create_session(
            "Backend", "backend", "pop-os", session_id="alive"
        )

        await short_manager.start_cleanup_loop()
        try:
            # Keep heartbeating
            for _ in range(5):
                await asyncio.sleep(0.05)
                short_manager.heartbeat("alive")
        finally:
            await short_manager.stop_cleanup_loop()

        # Session should still be alive
        s = short_manager.get_session("alive")
        assert s.state == SessionState.ACTIVE


# ---------------------------------------------------------------------------
# AC-5: Session resumption by ID
# ---------------------------------------------------------------------------


class TestSessionResumption:
    """AC-5: Reconnecting agents reclaim previous session by ID."""

    def test_resume_disconnected_session(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="resume-1"
        )
        manager.disconnect_session("resume-1")

        resumed = manager.resume_session("resume-1", "Backend", "backend", "pop-os")
        assert resumed.state == SessionState.ACTIVE
        assert resumed.disconnected_at is None
        assert resumed.session_id == "resume-1"

    def test_resume_active_session(self, manager: SessionManager) -> None:
        """Resuming an active session should also succeed (re-affirm)."""
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="resume-active"
        )
        resumed = manager.resume_session(
            "resume-active", "Backend", "backend", "pop-os"
        )
        assert resumed.state == SessionState.ACTIVE

    def test_resume_nonexistent_session_raises(
        self, manager: SessionManager
    ) -> None:
        with pytest.raises(SessionNotFoundError):
            manager.resume_session("nope", "Backend", "backend", "pop-os")

    def test_resume_mismatched_agent_name_raises(
        self, manager: SessionManager
    ) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="mismatch-name"
        )
        manager.disconnect_session("mismatch-name")
        with pytest.raises(SessionResumeError) as exc_info:
            manager.resume_session("mismatch-name", "QA", "backend", "pop-os")
        assert "agent_name mismatch" in str(exc_info.value)

    def test_resume_mismatched_role_raises(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="mismatch-role"
        )
        manager.disconnect_session("mismatch-role")
        with pytest.raises(SessionResumeError) as exc_info:
            manager.resume_session("mismatch-role", "Backend", "qa", "pop-os")
        assert "role mismatch" in str(exc_info.value)

    def test_resume_mismatched_machine_id_raises(
        self, manager: SessionManager
    ) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="mismatch-machine"
        )
        manager.disconnect_session("mismatch-machine")
        with pytest.raises(SessionResumeError) as exc_info:
            manager.resume_session(
                "mismatch-machine", "Backend", "backend", "other-host"
            )
        assert "machine_id mismatch" in str(exc_info.value)

    def test_resume_expired_session_raises(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="resume-exp"
        )
        manager.close_session("resume-exp")
        with pytest.raises(SessionNotFoundError):
            manager.resume_session("resume-exp", "Backend", "backend", "pop-os")

    def test_resume_after_resumption_window_raises(self) -> None:
        """Session disconnected longer than resumption_window should expire."""
        config = SessionConfig(resumption_window_seconds=0.0)
        mgr = SessionManager(config=config)

        mgr.create_session(
            "Backend", "backend", "pop-os", session_id="past-window"
        )
        mgr.disconnect_session("past-window")

        # With window=0.0, any time elapsed means expired
        time.sleep(0.01)
        with pytest.raises(SessionExpiredError):
            mgr.resume_session("past-window", "Backend", "backend", "pop-os")

    def test_resume_preserves_claims(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="claim-resume"
        )
        manager.add_claim("claim-resume", "TICKET-001")
        manager.disconnect_session("claim-resume")
        resumed = manager.resume_session(
            "claim-resume", "Backend", "backend", "pop-os"
        )
        assert "TICKET-001" in resumed.claimed_ticket_ids


# ---------------------------------------------------------------------------
# AC-6: Session manager tracks all active sessions (listing/monitoring)
# ---------------------------------------------------------------------------


class TestSessionListing:
    """AC-6: Session manager tracks all active sessions."""

    def test_list_sessions_empty(self, manager: SessionManager) -> None:
        assert manager.list_sessions() == []

    def test_list_sessions_all(self, manager: SessionManager) -> None:
        manager.create_session("Backend", "backend", "pop-os")
        manager.create_session("QA", "qa", "pop-os")
        sessions = manager.list_sessions()
        assert len(sessions) == 2

    def test_list_sessions_filter_by_state(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="active-1"
        )
        manager.create_session("QA", "qa", "pop-os", session_id="disc-1")
        manager.disconnect_session("disc-1")

        active = manager.list_sessions(state=SessionState.ACTIVE)
        assert len(active) == 1
        assert active[0].agent_name == "Backend"

        disconnected = manager.list_sessions(state=SessionState.DISCONNECTED)
        assert len(disconnected) == 1
        assert disconnected[0].agent_name == "QA"

    def test_active_count(self, manager: SessionManager) -> None:
        manager.create_session("Backend", "backend", "pop-os")
        manager.create_session("QA", "qa", "pop-os", session_id="q1")
        assert manager.active_count == 2

        manager.disconnect_session("q1")
        assert manager.active_count == 1

    def test_session_count(self, manager: SessionManager) -> None:
        manager.create_session("Backend", "backend", "pop-os")
        manager.create_session("QA", "qa", "pop-os", session_id="q2")
        assert manager.session_count == 2

        manager.disconnect_session("q2")
        # Still tracked
        assert manager.session_count == 2

        manager.close_session("q2")
        assert manager.session_count == 1

    def test_get_session(self, manager: SessionManager) -> None:
        created = manager.create_session(
            "Backend", "backend", "pop-os", session_id="get-test"
        )
        fetched = manager.get_session("get-test")
        assert fetched.session_id == created.session_id
        assert fetched.agent_name == "Backend"

    def test_get_nonexistent_session_raises(self, manager: SessionManager) -> None:
        with pytest.raises(SessionNotFoundError):
            manager.get_session("nope")


# ---------------------------------------------------------------------------
# Claim tracking
# ---------------------------------------------------------------------------


class TestClaimTracking:
    """Ticket claim association with sessions."""

    def test_add_claim(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="claim-test"
        )
        manager.add_claim("claim-test", "TICKET-001")
        session = manager.get_session("claim-test")
        assert "TICKET-001" in session.claimed_ticket_ids

    def test_add_duplicate_claim_is_idempotent(
        self, manager: SessionManager
    ) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="dup-claim"
        )
        manager.add_claim("dup-claim", "TICKET-001")
        manager.add_claim("dup-claim", "TICKET-001")
        session = manager.get_session("dup-claim")
        assert session.claimed_ticket_ids.count("TICKET-001") == 1

    def test_remove_claim(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="rm-claim"
        )
        manager.add_claim("rm-claim", "TICKET-001")
        manager.remove_claim("rm-claim", "TICKET-001")
        session = manager.get_session("rm-claim")
        assert "TICKET-001" not in session.claimed_ticket_ids

    def test_remove_nonexistent_claim_is_noop(
        self, manager: SessionManager
    ) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="no-claim"
        )
        manager.remove_claim("no-claim", "TICKET-999")  # Should not raise

    def test_add_claim_nonexistent_session_raises(
        self, manager: SessionManager
    ) -> None:
        with pytest.raises(SessionNotFoundError):
            manager.add_claim("nope", "TICKET-001")

    def test_remove_claim_nonexistent_session_raises(
        self, manager: SessionManager
    ) -> None:
        with pytest.raises(SessionNotFoundError):
            manager.remove_claim("nope", "TICKET-001")


# ---------------------------------------------------------------------------
# Disconnect / close
# ---------------------------------------------------------------------------


class TestDisconnectClose:
    """Session disconnect and explicit close."""

    def test_disconnect_sets_state_and_timestamp(
        self, manager: SessionManager
    ) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="disc-test"
        )
        session = manager.disconnect_session("disc-test")
        assert session.state == SessionState.DISCONNECTED
        assert session.disconnected_at is not None

    def test_disconnect_nonexistent_raises(self, manager: SessionManager) -> None:
        with pytest.raises(SessionNotFoundError):
            manager.disconnect_session("nope")

    def test_disconnect_expired_raises(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="disc-exp"
        )
        manager.close_session("disc-exp")
        with pytest.raises(SessionNotFoundError):
            manager.disconnect_session("disc-exp")

    def test_close_removes_session(self, manager: SessionManager) -> None:
        manager.create_session(
            "Backend", "backend", "pop-os", session_id="close-test"
        )
        closed = manager.close_session("close-test")
        assert closed.state == SessionState.EXPIRED
        assert manager.session_count == 0

    def test_close_nonexistent_raises(self, manager: SessionManager) -> None:
        with pytest.raises(SessionNotFoundError):
            manager.close_session("nope")


# ---------------------------------------------------------------------------
# SessionConfig
# ---------------------------------------------------------------------------


class TestSessionConfig:
    """SessionConfig validation and defaults."""

    def test_default_values(self) -> None:
        cfg = SessionConfig()
        assert cfg.session_timeout_seconds == 300.0
        assert cfg.cleanup_interval_seconds == 30.0
        assert cfg.resumption_window_seconds == 120.0

    def test_custom_values(self) -> None:
        cfg = SessionConfig(
            session_timeout_seconds=60.0,
            cleanup_interval_seconds=5.0,
            resumption_window_seconds=30.0,
        )
        assert cfg.session_timeout_seconds == 60.0
        assert cfg.cleanup_interval_seconds == 5.0
        assert cfg.resumption_window_seconds == 30.0

    def test_config_is_frozen(self) -> None:
        cfg = SessionConfig()
        with pytest.raises(AttributeError):
            cfg.session_timeout_seconds = 999.0  # type: ignore[misc]

    def test_manager_config_property(self, manager: SessionManager) -> None:
        assert manager.config.session_timeout_seconds == 2.0


# ---------------------------------------------------------------------------
# SessionState enum
# ---------------------------------------------------------------------------


class TestSessionState:
    """SessionState enumeration values."""

    def test_active_value(self) -> None:
        assert SessionState.ACTIVE.value == "active"

    def test_disconnected_value(self) -> None:
        assert SessionState.DISCONNECTED.value == "disconnected"

    def test_expired_value(self) -> None:
        assert SessionState.EXPIRED.value == "expired"


# ---------------------------------------------------------------------------
# Error classes
# ---------------------------------------------------------------------------


class TestExceptions:
    """Exception types carry session context."""

    def test_session_not_found_error(self) -> None:
        err = SessionNotFoundError("abc-123")
        assert err.session_id == "abc-123"
        assert "abc-123" in str(err)

    def test_session_expired_error(self) -> None:
        err = SessionExpiredError("abc-123")
        assert err.session_id == "abc-123"
        assert "abc-123" in str(err)

    def test_session_resume_error(self) -> None:
        err = SessionResumeError("abc-123", "agent_name mismatch")
        assert err.session_id == "abc-123"
        assert err.reason == "agent_name mismatch"
        assert "abc-123" in str(err)
        assert "agent_name mismatch" in str(err)
