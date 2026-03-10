"""Concurrent Session Handling for the MCP Server.

Provides async-safe concurrent session management with:

- **Async-safe state access** via ``asyncio.Lock`` (AC-2)
- **Configurable max sessions** with default of 50 (AC-4)
- **Clear rejection** with retry guidance when limit exceeded (AC-5)
- **O(1) lookup** via dict-based session storage (AC-6)
- **Isolated termination** — closing one session never affects others (AC-3)
- **Background cleanup loop** for expired sessions

Wraps the ``AgentSession`` and ``SessionState`` types from
:mod:`mcp_server.sessions.manager`.

.. meta::
   :ticket: FORGEOS-BE023
"""

from __future__ import annotations

import asyncio
import contextlib
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import TYPE_CHECKING, Any

from mcp_server.observability import get_logger, session_closed, session_opened
from mcp_server.sessions.manager import (
    AgentSession,
    SessionNotFoundError,
    SessionState,
)

if TYPE_CHECKING:
    from collections.abc import Awaitable, Callable

logger = get_logger(__name__)


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ConcurrentSessionConfig:
    """Configuration for the concurrent session manager.

    Attributes:
        max_concurrent_sessions: Upper bound on simultaneous sessions.
        session_timeout_seconds: Idle time before a session expires.
        cleanup_interval_seconds: Interval between cleanup sweeps.
        resumption_window_seconds: Window for resuming disconnected sessions.
    """

    max_concurrent_sessions: int = 50
    session_timeout_seconds: float = 300.0
    cleanup_interval_seconds: float = 30.0
    resumption_window_seconds: float = 120.0


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class MaxSessionsExceededError(Exception):
    """Raised when a new session cannot be created because the limit is reached.

    Attributes:
        max_sessions: The configured maximum.
        current_sessions: Current number of active sessions.
        retry_after_seconds: Suggested delay before retrying.
    """

    def __init__(
        self,
        max_sessions: int,
        current_sessions: int,
        retry_after_seconds: float = 5.0,
    ) -> None:
        self.max_sessions = max_sessions
        self.current_sessions = current_sessions
        self.retry_after_seconds = retry_after_seconds
        super().__init__(
            f"Maximum concurrent sessions reached ({current_sessions}/{max_sessions}). "
            f"Please retry after {retry_after_seconds}s. "
            f"A session slot may free up when an idle session expires or disconnects."
        )


# ---------------------------------------------------------------------------
# Concurrent Session Manager
# ---------------------------------------------------------------------------


class ConcurrentSessionManager:
    """Async-safe manager for concurrent agent sessions.

    Uses ``asyncio.Lock`` for all mutable state access and a ``dict``
    for O(1) session lookup by ID.  Enforces a configurable maximum
    number of concurrent sessions and returns clear rejection messages
    with retry guidance when the limit is exceeded.

    Usage::

        config = ConcurrentSessionConfig(max_concurrent_sessions=50)
        mgr = ConcurrentSessionManager(config=config)

        session = await mgr.create_session("Backend", "backend", "pop-os")
        await mgr.heartbeat(session.session_id)
        await mgr.close_session(session.session_id)
    """

    def __init__(self, config: ConcurrentSessionConfig | None = None) -> None:
        self._config = config or ConcurrentSessionConfig()
        self._sessions: dict[str, AgentSession] = {}
        self._lock = asyncio.Lock()
        self._cleanup_task: asyncio.Task[None] | None = None
        self._cleanup_callbacks: list[Callable[[AgentSession], Awaitable[None]]] = []
        self._stop_event: asyncio.Event | None = None

    # -- Properties (async) --------------------------------------------------

    @property
    def config(self) -> ConcurrentSessionConfig:
        """Return the session configuration."""
        return self._config

    async def active_count(self) -> int:
        """Return the number of ACTIVE sessions."""
        async with self._lock:
            return sum(
                1 for s in self._sessions.values() if s.state == SessionState.ACTIVE
            )

    async def session_count(self) -> int:
        """Return the total number of tracked sessions."""
        async with self._lock:
            return len(self._sessions)

    # -- Session Lifecycle ---------------------------------------------------

    async def create_session(
        self,
        agent_name: str,
        role: str,
        machine_id: str,
        *,
        session_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> AgentSession:
        """Create a new concurrent session.

        Args:
            agent_name: Name of the connecting agent.
            role: Agent role.
            machine_id: Hostname / machine identifier.
            session_id: Explicit session ID (auto-generated if ``None``).
            metadata: Optional key-value metadata.

        Returns:
            The newly created ``AgentSession``.

        Raises:
            MaxSessionsExceededError: If the concurrent session limit is reached.
        """
        sid = session_id or str(uuid.uuid4())
        now = datetime.now(timezone.utc)

        async with self._lock:
            current_active = sum(
                1 for s in self._sessions.values() if s.state == SessionState.ACTIVE
            )
            if current_active >= self._config.max_concurrent_sessions:
                raise MaxSessionsExceededError(
                    max_sessions=self._config.max_concurrent_sessions,
                    current_sessions=current_active,
                    retry_after_seconds=self._config.cleanup_interval_seconds,
                )

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
            self._sessions[sid] = session

        session_opened()
        logger.info(
            "concurrent_session_created",
            extra={
                "session_id": sid,
                "agent_name": agent_name,
                "role": role,
                "machine_id": machine_id,
                "active_count": current_active + 1,
                "max_sessions": self._config.max_concurrent_sessions,
            },
        )
        return session

    async def get_session(self, session_id: str) -> AgentSession:
        """Get a session by ID (O(1) dict lookup).

        Args:
            session_id: The session to retrieve.

        Returns:
            The ``AgentSession``.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        async with self._lock:
            return self._get_or_raise(session_id)

    async def heartbeat(self, session_id: str) -> AgentSession:
        """Update a session's heartbeat timestamp.

        Args:
            session_id: The session to heartbeat.

        Returns:
            The updated ``AgentSession``.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        async with self._lock:
            session = self._get_or_raise(session_id)
            session.last_heartbeat = datetime.now(timezone.utc)
        return session

    async def disconnect_session(self, session_id: str) -> AgentSession:
        """Mark a session as disconnected.

        The session remains tracked (for potential resumption) but does not
        count against the active session limit.

        Args:
            session_id: The session to disconnect.

        Returns:
            The updated ``AgentSession``.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        async with self._lock:
            session = self._get_or_raise(session_id)
            session.state = SessionState.DISCONNECTED
            session.disconnected_at = datetime.now(timezone.utc)

        logger.info(
            "concurrent_session_disconnected",
            extra={"session_id": session_id, "agent_name": session.agent_name},
        )
        return session

    async def close_session(self, session_id: str) -> AgentSession:
        """Close and remove a session, freeing its slot.

        Args:
            session_id: The session to close.

        Returns:
            The closed ``AgentSession`` (state set to EXPIRED).

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        async with self._lock:
            session = self._get_or_raise(session_id)
            session.state = SessionState.EXPIRED
            del self._sessions[session_id]

        session_closed()
        logger.info(
            "concurrent_session_closed",
            extra={"session_id": session_id, "agent_name": session.agent_name},
        )
        return session

    async def list_sessions(
        self, *, state: SessionState | None = None
    ) -> list[AgentSession]:
        """List all tracked sessions, optionally filtered by state.

        Args:
            state: Optional filter by session state.

        Returns:
            List of matching ``AgentSession`` objects.
        """
        async with self._lock:
            if state is None:
                return list(self._sessions.values())
            return [s for s in self._sessions.values() if s.state == state]

    # -- Claim Tracking ------------------------------------------------------

    async def add_claim(self, session_id: str, ticket_id: str) -> None:
        """Associate a ticket claim with a session.

        Args:
            session_id: The owning session.
            ticket_id: The ticket being claimed.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        async with self._lock:
            session = self._get_or_raise(session_id)
            if ticket_id not in session.claimed_ticket_ids:
                session.claimed_ticket_ids.append(ticket_id)

    async def remove_claim(self, session_id: str, ticket_id: str) -> None:
        """Remove a ticket claim from a session.

        Args:
            session_id: The owning session.
            ticket_id: The ticket to release.

        Raises:
            SessionNotFoundError: If the session does not exist.
        """
        async with self._lock:
            session = self._get_or_raise(session_id)
            if ticket_id in session.claimed_ticket_ids:
                session.claimed_ticket_ids.remove(ticket_id)

    # -- Cleanup Loop --------------------------------------------------------

    def register_cleanup_callback(
        self, callback: Callable[[AgentSession], Awaitable[None]]
    ) -> None:
        """Register an async callback invoked when a session expires.

        Args:
            callback: Async callable ``(AgentSession) -> None``.
        """
        self._cleanup_callbacks.append(callback)

    async def start_cleanup_loop(self) -> None:
        """Start the background cleanup task."""
        if self._cleanup_task is not None:
            return

        self._stop_event = asyncio.Event()

        async def _loop() -> None:
            assert self._stop_event is not None
            while not self._stop_event.is_set():
                with contextlib.suppress(asyncio.TimeoutError):
                    await asyncio.wait_for(
                        self._stop_event.wait(),
                        timeout=self._config.cleanup_interval_seconds,
                    )

                if self._stop_event.is_set():
                    break

                await self.expire_timed_out_sessions()

        self._cleanup_task = asyncio.create_task(_loop())
        logger.info("concurrent_cleanup_loop_started")

    async def stop_cleanup_loop(self) -> None:
        """Stop the background cleanup task."""
        if self._cleanup_task is None:
            return

        if self._stop_event is not None:
            self._stop_event.set()

        with contextlib.suppress(asyncio.CancelledError):
            await self._cleanup_task

        self._cleanup_task = None
        self._stop_event = None
        logger.info("concurrent_cleanup_loop_stopped")

    async def expire_timed_out_sessions(self) -> list[AgentSession]:
        """Expire sessions that have exceeded their timeout.

        Returns:
            List of sessions that were expired during this sweep.
        """
        now = datetime.now(timezone.utc)
        expired_sessions: list[AgentSession] = []

        async with self._lock:
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
                "concurrent_session_expired",
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
                        "concurrent_cleanup_callback_error",
                        extra={"session_id": session.session_id},
                    )

        return expired_sessions

    # -- Internal Helpers ----------------------------------------------------

    def _get_or_raise(self, session_id: str) -> AgentSession:
        """Return a session or raise ``SessionNotFoundError``.

        Must be called while holding ``self._lock``.
        """
        session = self._sessions.get(session_id)
        if session is None:
            raise SessionNotFoundError(session_id)
        return session
