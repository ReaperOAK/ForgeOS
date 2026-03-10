"""Agent Session Lifecycle Management — public API re-exports.

Provides:
    AgentSession       — per-connection session dataclass
    SessionConfig      — frozen configuration for timeouts and cleanup
    SessionExpiredError — raised when operating on an expired session
    SessionManager     — thread-safe session lifecycle manager
    SessionNotFoundError — raised when a session ID does not exist
    SessionResumeError  — raised when session resume identity validation fails
    SessionState       — enum of session states (ACTIVE, DISCONNECTED, EXPIRED)

.. meta::
   :ticket: FORGEOS-BE022
"""

from .manager import (
    AgentSession,
    SessionConfig,
    SessionExpiredError,
    SessionManager,
    SessionNotFoundError,
    SessionResumeError,
    SessionState,
)

__all__ = [
    "AgentSession",
    "SessionConfig",
    "SessionExpiredError",
    "SessionManager",
    "SessionNotFoundError",
    "SessionResumeError",
    "SessionState",
]
