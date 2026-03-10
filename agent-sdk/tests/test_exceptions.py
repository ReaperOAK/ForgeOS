"""Tests for forgeos_sdk.exceptions module."""

import pytest

from forgeos_sdk.exceptions import (
    AuthenticationError,
    ClaimConflictError,
    ConfigurationError,
    ConnectionError,
    ForgeOSError,
    InvalidTransitionError,
    LeaseExpiredError,
    NetworkError,
    ToolCallError,
)


class TestExceptionHierarchy:
    """All exceptions must derive from ForgeOSError."""

    def test_forgeos_error_is_exception(self) -> None:
        assert issubclass(ForgeOSError, Exception)

    def test_connection_error_inherits(self) -> None:
        assert issubclass(ConnectionError, ForgeOSError)

    def test_configuration_error_inherits(self) -> None:
        assert issubclass(ConfigurationError, ForgeOSError)

    def test_authentication_error_inherits(self) -> None:
        assert issubclass(AuthenticationError, ForgeOSError)

    def test_tool_call_error_inherits(self) -> None:
        assert issubclass(ToolCallError, ForgeOSError)

    def test_claim_conflict_error_inherits(self) -> None:
        assert issubclass(ClaimConflictError, ForgeOSError)

    def test_lease_expired_error_inherits(self) -> None:
        assert issubclass(LeaseExpiredError, ForgeOSError)

    def test_invalid_transition_error_inherits(self) -> None:
        assert issubclass(InvalidTransitionError, ForgeOSError)

    def test_network_error_inherits(self) -> None:
        assert issubclass(NetworkError, ForgeOSError)


class TestForgeOSError:
    def test_instantiation(self) -> None:
        err = ForgeOSError("test message")
        assert str(err) == "test message"

    def test_default_error_code(self) -> None:
        err = ForgeOSError("msg")
        assert err.error_code == "FORGEOS_ERROR"

    def test_custom_error_code(self) -> None:
        err = ForgeOSError("msg", error_code="CUSTOM")
        assert err.error_code == "CUSTOM"

    def test_default_details_empty_dict(self) -> None:
        err = ForgeOSError("msg")
        assert err.details == {}

    def test_custom_details(self) -> None:
        details = {"key": "value"}
        err = ForgeOSError("msg", details=details)
        assert err.details == {"key": "value"}

    def test_catch_as_exception(self) -> None:
        with pytest.raises(Exception):
            raise ForgeOSError("boom")


class TestClaimConflictError:
    def test_stores_ticket_id(self) -> None:
        err = ClaimConflictError(ticket_id="FORGEOS-001", held_by="QA")
        assert err.ticket_id == "FORGEOS-001"

    def test_stores_held_by(self) -> None:
        err = ClaimConflictError(ticket_id="FORGEOS-001", held_by="QA")
        assert err.held_by == "QA"

    def test_message_format(self) -> None:
        err = ClaimConflictError(ticket_id="FORGEOS-001", held_by="QA")
        assert "FORGEOS-001" in str(err)
        assert "QA" in str(err)

    def test_error_code(self) -> None:
        err = ClaimConflictError(ticket_id="T1", held_by="A")
        assert err.error_code == "CLAIM_CONFLICT"

    def test_details_contain_ticket_and_holder(self) -> None:
        err = ClaimConflictError(ticket_id="T1", held_by="Backend")
        assert err.details["ticket_id"] == "T1"
        assert err.details["held_by"] == "Backend"

    def test_caught_as_forgeos_error(self) -> None:
        with pytest.raises(ForgeOSError):
            raise ClaimConflictError(ticket_id="T", held_by="A")


class TestLeaseExpiredError:
    def test_stores_ticket_id(self) -> None:
        err = LeaseExpiredError(ticket_id="FORGEOS-002", expired_at="2026-01-01T00:00:00Z")
        assert err.ticket_id == "FORGEOS-002"

    def test_stores_expired_at(self) -> None:
        err = LeaseExpiredError(ticket_id="FORGEOS-002", expired_at="2026-01-01T00:00:00Z")
        assert err.expired_at == "2026-01-01T00:00:00Z"

    def test_message_format(self) -> None:
        err = LeaseExpiredError(ticket_id="FORGEOS-002", expired_at="2026-01-01T00:00:00Z")
        assert "FORGEOS-002" in str(err)
        assert "2026-01-01T00:00:00Z" in str(err)

    def test_error_code(self) -> None:
        err = LeaseExpiredError(ticket_id="T", expired_at="ts")
        assert err.error_code == "LEASE_EXPIRED"

    def test_details_contain_ticket_and_expiry(self) -> None:
        err = LeaseExpiredError(ticket_id="T1", expired_at="2026-03-10T12:00:00Z")
        assert err.details["ticket_id"] == "T1"
        assert err.details["expired_at"] == "2026-03-10T12:00:00Z"

    def test_caught_as_forgeos_error(self) -> None:
        with pytest.raises(ForgeOSError):
            raise LeaseExpiredError(ticket_id="T", expired_at="ts")


class TestInvalidTransitionError:
    def test_stores_ticket_id(self) -> None:
        err = InvalidTransitionError(
            ticket_id="FORGEOS-003", from_stage="READY", to_stage="DONE"
        )
        assert err.ticket_id == "FORGEOS-003"

    def test_stores_from_stage(self) -> None:
        err = InvalidTransitionError(
            ticket_id="T", from_stage="READY", to_stage="DONE"
        )
        assert err.from_stage == "READY"

    def test_stores_to_stage(self) -> None:
        err = InvalidTransitionError(
            ticket_id="T", from_stage="READY", to_stage="DONE"
        )
        assert err.to_stage == "DONE"

    def test_message_format(self) -> None:
        err = InvalidTransitionError(
            ticket_id="FORGEOS-003", from_stage="READY", to_stage="DONE"
        )
        assert "FORGEOS-003" in str(err)
        assert "READY" in str(err)
        assert "DONE" in str(err)

    def test_error_code(self) -> None:
        err = InvalidTransitionError(ticket_id="T", from_stage="A", to_stage="B")
        assert err.error_code == "INVALID_TRANSITION"

    def test_details_contain_all_fields(self) -> None:
        err = InvalidTransitionError(
            ticket_id="T1", from_stage="QA", to_stage="READY"
        )
        assert err.details["ticket_id"] == "T1"
        assert err.details["from_stage"] == "QA"
        assert err.details["to_stage"] == "READY"

    def test_caught_as_forgeos_error(self) -> None:
        with pytest.raises(ForgeOSError):
            raise InvalidTransitionError(ticket_id="T", from_stage="A", to_stage="B")


class TestNetworkError:
    def test_message(self) -> None:
        err = NetworkError("Connection refused")
        assert str(err) == "Connection refused"

    def test_default_retry_after_none(self) -> None:
        err = NetworkError("Connection refused")
        assert err.retry_after is None

    def test_custom_retry_after(self) -> None:
        err = NetworkError("timeout", retry_after=5.0)
        assert err.retry_after == 5.0

    def test_error_code(self) -> None:
        err = NetworkError("fail")
        assert err.error_code == "NETWORK_ERROR"

    def test_details_include_retry_after_when_set(self) -> None:
        err = NetworkError("timeout", retry_after=10.0)
        assert err.details["retry_after"] == 10.0

    def test_details_empty_when_no_retry(self) -> None:
        err = NetworkError("fail")
        assert "retry_after" not in err.details

    def test_caught_as_forgeos_error(self) -> None:
        with pytest.raises(ForgeOSError):
            raise NetworkError("fail")


class TestAuthenticationError:
    def test_default_error_code(self) -> None:
        err = AuthenticationError("invalid credentials")
        assert err.error_code == "AUTHENTICATION_ERROR"

    def test_message(self) -> None:
        err = AuthenticationError("token expired")
        assert str(err) == "token expired"

    def test_caught_as_forgeos_error(self) -> None:
        with pytest.raises(ForgeOSError):
            raise AuthenticationError("bad key")


class TestToolCallError:
    def test_tool_name_stored(self) -> None:
        err = ToolCallError("tickets.claim", "timeout")
        assert err.tool_name == "tickets.claim"

    def test_message_format(self) -> None:
        err = ToolCallError("tickets.claim", "timeout")
        assert str(err) == "Tool 'tickets.claim' failed: timeout"

    def test_caught_as_forgeos_error(self) -> None:
        with pytest.raises(ForgeOSError):
            raise ToolCallError("t", "m")

    def test_error_code(self) -> None:
        err = ToolCallError("t", "m")
        assert err.error_code == "TOOL_CALL_ERROR"
