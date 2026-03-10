"""Agent Session Lifecycle Management — public API re-exports.

Provides:
    AgentSession              — per-connection session dataclass
    ConcurrentSessionConfig   — frozen config for concurrent session manager
    ConcurrentSessionManager  — async-safe concurrent session manager
    MaxSessionsExceededError  — raised when concurrent session limit is hit
    SessionConfig             — frozen configuration for timeouts and cleanup
    SessionExpiredError       — raised when operating on an expired session
    SessionManager            — thread-safe session lifecycle manager
    SessionNotFoundError      — raised when a session ID does not exist
    SessionResumeError        — raised when session resume identity validation fails
    SessionState              — enum of session states (ACTIVE, DISCONNECTED, EXPIRED)

.. meta::
   :ticket: FORGEOS-BE022, FORGEOS-BE023
"""

from .concurrent import (
    ConcurrentSessionConfig,
    ConcurrentSessionManager,
    MaxSessionsExceededError,
)
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
    "ConcurrentSessionConfig",
    "ConcurrentSessionManager",
    "MaxSessionsExceededError",
    "SessionConfig",
    "SessionExpiredError",
    "SessionManager",
    "SessionNotFoundError",
    "SessionResumeError",
    "SessionState",
]
