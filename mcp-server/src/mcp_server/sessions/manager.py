"""Agent Session Lifecycle Management.

Implements per-agent session tracking for the MCP server:

- **Session creation** with agent identity metadata (AC-1, AC-2)
- **Heartbeat** updates ``last_heartbeat`` and extends timeout (AC-3)
- **Timeout cleanup** expires stale sessions and invokes callbacks (AC-4)
- **Session resumption** with identity validation (AC-5)
- **Session listing** for admin/monitoring (AC-6)

Thread-safe via ``threading.Lock``.  Async cleanup loop via ``asyncio.Task``.

.. meta::
   :ticket: FORGEOS-BE022
"""

from __future__ import annotations

import asyncio
import enum
import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from mcp_server.observability import get_logger, session_closed, session_opened

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Session State
# ---------------------------------------------------------------------------


class SessionState(enum.Enum):
    """Lifecycle state of an agent session."""

    ACTIVE = "active"
    DISCONNECTED = "disconnected"
    EXPIRED = "expired"


# ---------------------------------------------------------------------------
# Agent Session
# ---------------------------------------------------------------------------


@dataclass
class AgentSession:
    """Represents a single agent connection to the MCP server.

    Attributes:
        session_id: Unique session identifier (UUID4 by default).
        agent_name: Name of the connected agent (e.g. ``Backend``).
        role: Agent role (e.g. ``backend``, ``qa``, ``security``).
        machine_id: Hostname or machine identifier.
        state: Current lifecycle state.
        connected_at: UTC timestamp of session creation.
        last_heartbeat: UTC timestamp of last heartbeat.
        disconnected_at: UTC timestamp of disconnect (``None`` while connected).
        claimed_ticket_ids: List of ticket IDs claimed through this session.
        metadata: Arbitrary key-value metadata supplied at creation.
    """

    session_id: str
    agent_name: str
    role: str
    machine_id: str
    state: SessionState = SessionState.ACTIVE
    connected_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    last_heartbeat: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    disconnected_at: datetime | None = None
    claimed_ticket_ids: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        """Ensure ``last_heartbeat`` matches ``connected_at`` on creation."""
        if self.last_heartbeat != self.connected_at:
            object.__setattr__(self, "last_heartbeat", self.connected_at)

    def to_dict(self) -> dict[str, Any]:
        """Serialize to a JSON-safe dictionary."""
        return {
            "session_id": self.session_id,
            "agent_name": self.agent_name,
            "role": self.role,
            "machine_id": self.machine_id,
            "state": self.state.value,
            "connected_at": self.connected_at.isoformat(),
            "last_heartbeat": self.last_heartbeat.isoformat(),
            "disconnected_at": (
                self.disconnected_at.isoformat() if self.disconnected_at else None
            ),
            "claimed_ticket_ids": list(self.claimed_ticket_ids),
            "metadata": dict(self.metadata),
        }


# ---------------------------------------------------------------------------
# Session Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class SessionConfig:
    """Immutable configuration for the session manager.

    Attributes:
        session_timeout_seconds: Max idle time before session expires.
        cleanup_interval_seconds: Interval between cleanup sweeps.
        resumption_window_seconds: Max time a disconnected session stays
            eligible for resumption.
    """

    session_timeout_seconds: float = 300.0
    cleanup_interval_seconds: float = 30.0
    resumption_window_seconds: float = 120.0


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SessionNotFoundError(Exception):
    """Raised when a session ID does not exist in the manager."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        super().__init__(f"Session not found: {session_id}")


class SessionExpiredError(Exception):
    """Raised when operating on an expired session."""

    def __init__(self, session_id: str) -> None:
        self.session_id = session_id
        super().__init__(f"Session expired: {session_id}")


class SessionResumeError(Exception):
    """Raised when session resumption fails identity validation."""

    def __init__(self, session_id: str, reason: str) -> None:
        self.session_id = session_id
        self.reason = reason
        super().__init__(f"Cannot resume session {session_id}: {reason}")


# ---------------------------------------------------------------------------
# Session Manager
# ---------------------------------------------------------------------------


class SessionManager:
    """Thread-safe manager for agent session lifecycles.

    Provides:
    - Session creation with identity metadata
    - Heartbeat tracking and timeout detection
    - Automatic cleanup of expired sessions
    - Session resumption with identity validation
    - Listing/monitoring of active sessions

    Usage::

        config = SessionConfig(session_timeout_seconds=300)
        mgr = SessionManager(config=config)

        session = mgr.create_session("Backend", "backend", "pop-os")
        mgr.heartbeat(session.session_id)
        mgr.disconnect_session(session.session_id)
        resumed = mgr.resume_session(session.session_id, "Backend", "backend", "pop-os")
    """

    def __init__(self, config: SessionConfig | None = None) -> None:
        self._config = config or SessionConfig()
        self._sessions: dict[str, AgentSession] = {}
        self._lock = threading.Lock()
        self._cleanup_task: asyncio.Task[None] | None = None
        self._cleanup_callbacks: list[Callable[[AgentSession], Awaitable[None]]] = []
        self._stop_event: asyncio.Event | None = None

    # -- Properties ----------------------------------------------------------

    @property
    def config(self) -> SessionConfig:
        """Return the session configuration."""
        return self._config

    @property
    def active_count(self) -> int:
        """Return the number of ACTIVE sessions."""
        with self._lock:
            return sum(
                1 for s in self._sessions.values() if s.state == SessionState.ACTIVE
            )

    @property
    def session_count(self) -> int:
        """Return the total number of tracked sessions."""
        with self._lock:
            return len(self._sessions)

    # -- Session Lifecycle ---------------------------------------------------

    def create_session(
        self,
        agent_name: str,
        role: str,
        machine_id: str,
        *,
        session_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentSession:
        """Create a new session for an agent connection.

        Args:
            agent_name: Name of the connecting agent.
            role: Agent role.
            machine_id: Hostname / machine identifier.
            session_id: Explicit session ID (auto-generated if ``None``).
            metadata: Optional key-value metadata.

        Returns:
            The newly created ``AgentSession``.
        """
        sid = session_id or str(uuid.uuid4())
        now = datetime.now(timezone.utc)
        session = AgentSession(
            session_id=sid,
            agent_name=agent_name,
            role=role,
            machine_id=machine_id,
            state=SessionState.ACTIVE,
            connected_at=now,
            last_heartbeat=now,
            metadata=metadata or {},
        )

        with self._lock:
            self._sessions[sid] = session

        session_opened()
        logger.info(
            "session_created",
            extra={
                "session_id": sid,
                "agent_name": agent_name,
                "role": role,
                "machine_id": machine_id,
            },
        )
        return session

    def disconnect_session(self, session_id: str) -> AgentSession:
        """Mark a session as disconnected.

        Args:
            session_id: The session to disconnect.

        Returns:
            The updated ``AgentSession``.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        with self._lock:
            session = self._get_or_raise(session_id)
            session.state = SessionState.DISCONNECTED
            session.disconnected_at = datetime.now(timezone.utc)

        logger.info(
            "session_disconnected",
            extra={"session_id": session_id, "agent_name": session.agent_name},
        )
        return session

    def close_session(self, session_id: str) -> AgentSession:
        """Close and remove a session (explicit cleanup).

        Args:
            session_id: The session to close.

        Returns:
            The closed ``AgentSession`` (state set to EXPIRED).

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        with self._lock:
            session = self._get_or_raise(session_id)
            session.state = SessionState.EXPIRED
            del self._sessions[session_id]

        session_closed()
        logger.info(
            "session_closed",
            extra={"session_id": session_id, "agent_name": session.agent_name},
        )
        return session

    def heartbeat(self, session_id: str) -> AgentSession:
        """Update a session's heartbeat timestamp.

        Args:
            session_id: The session to heartbeat.

        Returns:
            The updated ``AgentSession``.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        with self._lock:
            session = self._get_or_raise(session_id)
            session.last_heartbeat = datetime.now(timezone.utc)

        logger.debug(
            "session_heartbeat",
            extra={"session_id": session_id},
        )
        return session

    def resume_session(
        self,
        session_id: str,
        agent_name: str,
        role: str,
        machine_id: str,
    ) -> AgentSession:
        """Resume a previously disconnected session.

        Identity validation ensures the resuming agent matches the original.

        Args:
            session_id: The session to resume.
            agent_name: Must match the original agent name.
            role: Must match the original role.
            machine_id: Must match the original machine ID.

        Returns:
            The resumed ``AgentSession`` (state set to ACTIVE).

        Raises:
            SessionNotFoundError: If the session does not exist.
            SessionExpiredError: If the session has exceeded the resumption window.
            SessionResumeError: If identity validation fails.
        """
        with self._lock:
            session = self._get_or_raise(session_id)

            # Identity validation
            if session.agent_name != agent_name:
                raise SessionResumeError(session_id, "agent_name mismatch")
            if session.role != role:
                raise SessionResumeError(session_id, "role mismatch")
            if session.machine_id != machine_id:
                raise SessionResumeError(session_id, "machine_id mismatch")

            # Check resumption window for disconnected sessions
            if session.state == SessionState.DISCONNECTED:
                if session.disconnected_at is not None:
                    elapsed = (
                        datetime.now(timezone.utc) - session.disconnected_at
                    ).total_seconds()
                    if elapsed > self._config.resumption_window_seconds:
                        raise SessionExpiredError(session_id)

            session.state = SessionState.ACTIVE
            session.disconnected_at = None
            session.last_heartbeat = datetime.now(timezone.utc)

        logger.info(
            "session_resumed",
            extra={
                "session_id": session_id,
                "agent_name": agent_name,
            },
        )
        return session

    # -- Query ---------------------------------------------------------------

    def get_session(self, session_id: str) -> AgentSession:
        """Get a session by ID.

        Args:
            session_id: The session to retrieve.

        Returns:
            The ``AgentSession``.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        with self._lock:
            return self._get_or_raise(session_id)

    def list_sessions(
        self, *, state: SessionState | None = None
    ) -> list[AgentSession]:
        """List all tracked sessions, optionally filtered by state.

        Args:
            state: Optional filter by session state.

        Returns:
            List of matching ``AgentSession`` objects.
        """
        with self._lock:
            if state is None:
                return list(self._sessions.values())
            return [s for s in self._sessions.values() if s.state == state]

    # -- Claim Tracking ------------------------------------------------------

    def add_claim(self, session_id: str, ticket_id: str) -> None:
        """Associate a ticket claim with a session.

        Args:
            session_id: The owning session.
            ticket_id: The ticket being claimed.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        with self._lock:
            session = self._get_or_raise(session_id)
            if ticket_id not in session.claimed_ticket_ids:
                session.claimed_ticket_ids.append(ticket_id)

        logger.info(
            "claim_added",
            extra={"session_id": session_id, "ticket_id": ticket_id},
        )

    def remove_claim(self, session_id: str, ticket_id: str) -> None:
        """Remove a ticket claim from a session.

        Args:
            session_id: The owning session.
            ticket_id: The ticket to release.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        with self._lock:
            session = self._get_or_raise(session_id)
            if ticket_id in session.claimed_ticket_ids:
                session.claimed_ticket_ids.remove(ticket_id)

        logger.info(
            "claim_removed",
            extra={"session_id": session_id, "ticket_id": ticket_id},
        )

    # -- Cleanup Loop --------------------------------------------------------

    def register_cleanup_callback(
        self, callback: Callable[[AgentSession], Awaitable[None]]
    ) -> None:
        """Register an async callback invoked when a session expires.

        Callbacks receive the expired ``AgentSession`` (with state EXPIRED)
        and can perform cleanup such as releasing ticket claims.

        Args:
            callback: Async callable ``(AgentSession) -> None``.
        """
        self._cleanup_callbacks.append(callback)

    async def start_cleanup_loop(self) -> None:
        """Start the background cleanup task.

        The loop runs every ``cleanup_interval_seconds`` and expires sessions
        that have exceeded their timeout or resumption window.
        """
        if self._cleanup_task is not None:
            return

        self._stop_event = asyncio.Event()

        async def _loop() -> None:
            assert self._stop_event is not None
            while not self._stop_event.is_set():
                try:
                    await asyncio.wait_for(
                        self._stop_event.wait(),
                        timeout=self._config.cleanup_interval_seconds,
                    )
                except asyncio.TimeoutError:
                    pass

                if self._stop_event.is_set():
                    break

                await self._expire_timed_out_sessions()

        self._cleanup_task = asyncio.create_task(_loop())
        logger.info("cleanup_loop_started")

    async def stop_cleanup_loop(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task is None:
            return

        if self._stop_event is not None:
            self._stop_event.set()

        try:
            await self._cleanup_task
        except asyncio.CancelledError:
            pass

        self._cleanup_task = None
        self._stop_event = None
        logger.info("cleanup_loop_stopped")

    async def _expire_timed_out_sessions(self) -> None:
        """Expire sessions that have exceeded their timeout."""
        now = datetime.now(timezone.utc)
        expired_sessions: list[AgentSession] = []

        with self._lock:
            to_remove: list[str] = []
            for sid, session in self._sessions.items():
                should_expire = False

                if session.state == SessionState.ACTIVE:
                    elapsed = (now - session.last_heartbeat).total_seconds()
                    if elapsed > self._config.session_timeout_seconds:
                        should_expire = True

                elif session.state == SessionState.DISCONNECTED:
                    if session.disconnected_at is not None:
                        elapsed = (now - session.disconnected_at).total_seconds()
                        if elapsed > self._config.resumption_window_seconds:
                            should_expire = True

                if should_expire:
                    session.state = SessionState.EXPIRED
                    expired_sessions.append(session)
                    to_remove.append(sid)

            for sid in to_remove:
                del self._sessions[sid]

        # Invoke callbacks outside the lock
        for session in expired_sessions:
            session_closed()
            logger.info(
                "session_expired",
                extra={
                    "session_id": session.session_id,
                    "agent_name": session.agent_name,
                    "claimed_tickets": session.claimed_ticket_ids,
                },
            )
            for callback in self._cleanup_callbacks:
                try:
                    await callback(session)
                except Exception:
                    logger.exception(
                        "cleanup_callback_error",
                        extra={"session_id": session.session_id},
                    )

    # -- Internal Helpers ----------------------------------------------------

    def _get_or_raise(self, session_id: str) -> AgentSession:
        """Return a session or raise ``SessionNotFoundError``.

        Must be called while holding ``self._lock``.
        """
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        return session
