"""ForgeOS SDK exception hierarchy.

All SDK exceptions derive from ForgeOSError for consistent error handling.
Each exception carries an ``error_code`` and optional ``details`` dict for
structured error reporting.
"""

from __future__ import annotations

from typing import Any


class ForgeOSError(Exception):
    """Base exception for all ForgeOS SDK errors.

    Attributes:
        error_code: Machine-readable error identifier.
        details: Structured context for the error.
    """

    def __init__(
        self,
        message: str,
        *,
        error_code: str = "FORGEOS_ERROR",
        details: dict[str, Any] | None = None,
    ) -> None:
        self.error_code = error_code
        self.details: dict[str, Any] = details if details is not None else {}
        super().__init__(message)


class ConnectionError(ForgeOSError):
    """Raised when the SDK cannot connect to the MCP server."""

    def __init__(self, message: str = "Connection failed") -> None:
        super().__init__(message, error_code="CONNECTION_ERROR")


class ConfigurationError(ForgeOSError):
    """Raised when SDK configuration is invalid or missing."""

    def __init__(self, message: str = "Configuration error") -> None:
        super().__init__(message, error_code="CONFIGURATION_ERROR")


class AuthenticationError(ForgeOSError):
    """Raised when agent authentication fails (invalid or expired credentials)."""

    def __init__(self, message: str = "Authentication failed") -> None:
        super().__init__(message, error_code="AUTHENTICATION_ERROR")


class ToolCallError(ForgeOSError):
    """Raised when an MCP tool call fails.

    Attributes:
        tool_name: The name of the tool that failed.
    """

    def __init__(self, tool_name: str, message: str) -> None:
        self.tool_name = tool_name
        super().__init__(
            f"Tool '{tool_name}' failed: {message}",
            error_code="TOOL_CALL_ERROR",
            details={"tool_name": tool_name},
        )


class ClaimConflictError(ForgeOSError):
    """Raised when a claim fails because another agent holds the ticket.

    Attributes:
        ticket_id: The ticket that could not be claimed.
        held_by: The agent currently holding the claim.
    """

    def __init__(self, *, ticket_id: str, held_by: str) -> None:
        self.ticket_id = ticket_id
        self.held_by = held_by
        super().__init__(
            f"Claim conflict on ticket '{ticket_id}': already held by '{held_by}'",
            error_code="CLAIM_CONFLICT",
            details={"ticket_id": ticket_id, "held_by": held_by},
        )


class LeaseExpiredError(ForgeOSError):
    """Raised when an operation fails because the claim lease has expired.

    Attributes:
        ticket_id: The ticket whose lease expired.
        expired_at: ISO-8601 timestamp of expiration.
    """

    def __init__(self, *, ticket_id: str, expired_at: str) -> None:
        self.ticket_id = ticket_id
        self.expired_at = expired_at
        super().__init__(
            f"Lease expired for ticket '{ticket_id}' at {expired_at}",
            error_code="LEASE_EXPIRED",
            details={"ticket_id": ticket_id, "expired_at": expired_at},
        )


class InvalidTransitionError(ForgeOSError):
    """Raised for invalid SDLC stage transitions.

    Attributes:
        ticket_id: The ticket with the invalid transition.
        from_stage: Current stage.
        to_stage: Attempted target stage.
    """

    def __init__(self, *, ticket_id: str, from_stage: str, to_stage: str) -> None:
        self.ticket_id = ticket_id
        self.from_stage = from_stage
        self.to_stage = to_stage
        super().__init__(
            f"Invalid transition for ticket '{ticket_id}': {from_stage} -> {to_stage}",
            error_code="INVALID_TRANSITION",
            details={
                "ticket_id": ticket_id,
                "from_stage": from_stage,
                "to_stage": to_stage,
            },
        )


class NetworkError(ForgeOSError):
    """Raised for connection failures with an optional retry hint.

    Attributes:
        retry_after: Suggested seconds to wait before retrying, or ``None``.
    """

    def __init__(self, message: str, *, retry_after: float | None = None) -> None:
        self.retry_after = retry_after
        details: dict[str, Any] = {}
        if retry_after is not None:
            details["retry_after"] = retry_after
        super().__init__(message, error_code="NETWORK_ERROR", details=details)
