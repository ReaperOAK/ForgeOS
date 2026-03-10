"""Tests for forgeos_sdk.exceptions module."""

import pytest

from forgeos_sdk.exceptions import (
    AuthenticationError,
    ConfigurationError,
    ConnectionError,
    ForgeOSError,
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


class TestForgeOSError:
    def test_instantiation(self) -> None:
        err = ForgeOSError("test message")
        assert str(err) == "test message"

    def test_catch_as_exception(self) -> None:
        with pytest.raises(Exception):
            raise ForgeOSError("boom")


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
