"""Tests for forgeos_sdk.transport module."""

from __future__ import annotations

from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import Any
from unittest.mock import MagicMock, patch

import pytest

from forgeos_sdk.config import TransportType
from forgeos_sdk.exceptions import ConfigurationError
from forgeos_sdk.exceptions import ConnectionError as SDKConnectionError
from forgeos_sdk.transport import (
    MCPTransport,
    SSETransport,
    StdioTransport,
    StreamableHttpTransport,
    create_transport,
)

# ── Helpers ───────────────────────────────────────────────────────────


@asynccontextmanager
async def _fake_transport_cm(
    *values: Any,
) -> AsyncGenerator[tuple[Any, ...], None]:
    """Fake async context manager yielding a tuple of values."""
    yield tuple(values)


def _make_fake_stdio_client(
    read: Any, write: Any
) -> Any:
    """Return a callable that mimics stdio_client."""

    @asynccontextmanager
    async def _fake(_params: Any) -> AsyncGenerator[tuple[Any, Any], None]:
        yield read, write

    return _fake


def _make_fake_sse_client(read: Any, write: Any) -> Any:
    """Return a callable that mimics sse_client."""

    @asynccontextmanager
    async def _fake(_url: str, **_kwargs: Any) -> AsyncGenerator[tuple[Any, Any], None]:
        yield read, write

    return _fake


def _make_fake_http_client(
    read: Any, write: Any, get_session_id: Any = None
) -> Any:
    """Return a callable that mimics streamablehttp_client."""

    @asynccontextmanager
    async def _fake(_url: str, **_kwargs: Any) -> AsyncGenerator[tuple[Any, ...], None]:
        if get_session_id is not None:
            yield read, write, get_session_id
        else:
            yield read, write

    return _fake


def _make_failing_client(exc: Exception) -> Any:
    """Return a callable that raises on enter."""

    @asynccontextmanager
    async def _fake(*_a: Any, **_kw: Any) -> AsyncGenerator[tuple[Any, Any], None]:
        raise exc
        yield  # pragma: no cover

    return _fake


# ── StdioTransport construction ──────────────────────────────────────


class TestStdioTransportConstruction:
    def test_valid_command(self) -> None:
        t = StdioTransport(command="python")
        assert t.command == "python"
        assert not t.is_connected

    def test_command_with_args(self) -> None:
        t = StdioTransport(command="python", args=["-m", "server"])
        assert t.command == "python"

    def test_command_stripped(self) -> None:
        t = StdioTransport(command="  python  ")
        assert t.command == "python"

    def test_empty_command_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="stdio command must not be empty"):
            StdioTransport(command="")

    def test_whitespace_command_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="stdio command must not be empty"):
            StdioTransport(command="   ")

    def test_is_connected_false_initially(self) -> None:
        t = StdioTransport(command="python")
        assert t.is_connected is False


# ── StdioTransport lifecycle ─────────────────────────────────────────


class TestStdioTransportLifecycle:
    @pytest.mark.asyncio
    async def test_start_connects(self) -> None:
        mock_read = MagicMock(name="read_stream")
        mock_write = MagicMock(name="write_stream")

        with patch(
            "forgeos_sdk.transport.stdio_client",
            _make_fake_stdio_client(mock_read, mock_write),
        ):
            t = StdioTransport(command="python", args=["-m", "mcp"])
            result = await t.start()

        assert result == (mock_read, mock_write)
        assert t.is_connected is True

    @pytest.mark.asyncio
    async def test_close_disconnects(self) -> None:
        mock_read = MagicMock(name="read_stream")
        mock_write = MagicMock(name="write_stream")

        with patch(
            "forgeos_sdk.transport.stdio_client",
            _make_fake_stdio_client(mock_read, mock_write),
        ):
            t = StdioTransport(command="python")
            await t.start()
            assert t.is_connected is True

            await t.close()
            assert t.is_connected is False

    @pytest.mark.asyncio
    async def test_start_failure_raises_connection_error(self) -> None:
        with patch(
            "forgeos_sdk.transport.stdio_client",
            _make_failing_client(OSError("no such file")),
        ):
            t = StdioTransport(command="nonexistent")
            with pytest.raises(SDKConnectionError, match="Failed to start stdio"):
                await t.start()
            assert t.is_connected is False

    @pytest.mark.asyncio
    async def test_close_idempotent(self) -> None:
        t = StdioTransport(command="python")
        await t.close()  # Should not raise
        assert t.is_connected is False


# ── SSETransport construction ────────────────────────────────────────


class TestSSETransportConstruction:
    def test_valid_url(self) -> None:
        t = SSETransport(url="http://localhost:8080/mcp")
        assert t.url == "http://localhost:8080/mcp"
        assert not t.is_connected

    def test_url_stripped(self) -> None:
        t = SSETransport(url="  http://host:8080/mcp  ")
        assert t.url == "http://host:8080/mcp"

    def test_empty_url_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="SSE URL must not be empty"):
            SSETransport(url="")

    def test_whitespace_url_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="SSE URL must not be empty"):
            SSETransport(url="   ")

    def test_headers_stored(self) -> None:
        t = SSETransport(url="http://host/mcp", headers={"X-Key": "val"})
        assert t.url == "http://host/mcp"


# ── SSETransport lifecycle ───────────────────────────────────────────


class TestSSETransportLifecycle:
    @pytest.mark.asyncio
    async def test_start_connects(self) -> None:
        mock_read = MagicMock(name="read_stream")
        mock_write = MagicMock(name="write_stream")

        with patch(
            "forgeos_sdk.transport.sse_client",
            _make_fake_sse_client(mock_read, mock_write),
        ):
            t = SSETransport(url="http://localhost:8080/mcp")
            result = await t.start()

        assert result == (mock_read, mock_write)
        assert t.is_connected is True

    @pytest.mark.asyncio
    async def test_close_disconnects(self) -> None:
        mock_read = MagicMock(name="read_stream")
        mock_write = MagicMock(name="write_stream")

        with patch(
            "forgeos_sdk.transport.sse_client",
            _make_fake_sse_client(mock_read, mock_write),
        ):
            t = SSETransport(url="http://localhost:8080/mcp")
            await t.start()
            await t.close()
            assert t.is_connected is False

    @pytest.mark.asyncio
    async def test_start_failure_raises_connection_error(self) -> None:
        with patch(
            "forgeos_sdk.transport.sse_client",
            _make_failing_client(OSError("connection refused")),
        ):
            t = SSETransport(url="http://localhost:8080/mcp")
            with pytest.raises(SDKConnectionError, match="Failed to start SSE"):
                await t.start()
            assert t.is_connected is False


# ── StreamableHttpTransport construction ─────────────────────────────


class TestStreamableHttpTransportConstruction:
    def test_valid_url(self) -> None:
        t = StreamableHttpTransport(url="http://localhost:8080/mcp")
        assert t.url == "http://localhost:8080/mcp"
        assert not t.is_connected

    def test_empty_url_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="HTTP URL must not be empty"):
            StreamableHttpTransport(url="")

    def test_session_id_none_initially(self) -> None:
        t = StreamableHttpTransport(url="http://localhost:8080/mcp")
        assert t.session_id is None


# ── StreamableHttpTransport lifecycle ────────────────────────────────


class TestStreamableHttpTransportLifecycle:
    @pytest.mark.asyncio
    async def test_start_connects_with_session_id(self) -> None:
        mock_read = MagicMock(name="read_stream")
        mock_write = MagicMock(name="write_stream")
        get_sid = MagicMock(return_value="session-123")

        with patch(
            "forgeos_sdk.transport.streamablehttp_client",
            _make_fake_http_client(mock_read, mock_write, get_sid),
        ):
            t = StreamableHttpTransport(url="http://localhost:8080/mcp")
            result = await t.start()

        assert result == (mock_read, mock_write)
        assert t.is_connected is True
        assert t.session_id == "session-123"

    @pytest.mark.asyncio
    async def test_start_connects_without_session_id(self) -> None:
        mock_read = MagicMock(name="read_stream")
        mock_write = MagicMock(name="write_stream")

        with patch(
            "forgeos_sdk.transport.streamablehttp_client",
            _make_fake_http_client(mock_read, mock_write),
        ):
            t = StreamableHttpTransport(url="http://localhost:8080/mcp")
            result = await t.start()

        assert result == (mock_read, mock_write)
        assert t.is_connected is True
        assert t.session_id is None

    @pytest.mark.asyncio
    async def test_close_clears_session_id(self) -> None:
        mock_read = MagicMock(name="read_stream")
        mock_write = MagicMock(name="write_stream")
        get_sid = MagicMock(return_value="session-456")

        with patch(
            "forgeos_sdk.transport.streamablehttp_client",
            _make_fake_http_client(mock_read, mock_write, get_sid),
        ):
            t = StreamableHttpTransport(url="http://localhost:8080/mcp")
            await t.start()
            assert t.session_id == "session-456"

            await t.close()
            assert t.is_connected is False
            assert t.session_id is None

    @pytest.mark.asyncio
    async def test_start_failure_raises_connection_error(self) -> None:
        with patch(
            "forgeos_sdk.transport.streamablehttp_client",
            _make_failing_client(OSError("connection refused")),
        ):
            t = StreamableHttpTransport(url="http://localhost:8080/mcp")
            with pytest.raises(SDKConnectionError, match="Failed to start HTTP"):
                await t.start()
            assert t.is_connected is False

    @pytest.mark.asyncio
    async def test_unavailable_raises_configuration_error(self) -> None:
        with patch("forgeos_sdk.transport.streamablehttp_client", None):
            t = StreamableHttpTransport(url="http://localhost:8080/mcp")
            with pytest.raises(ConfigurationError, match="not available"):
                await t.start()


# ── create_transport factory ─────────────────────────────────────────


class TestCreateTransport:
    def test_creates_stdio_transport(self) -> None:
        t = create_transport(TransportType.STDIO, command="python")
        assert isinstance(t, StdioTransport)

    def test_creates_sse_transport(self) -> None:
        t = create_transport(TransportType.SSE, server_url="http://host/mcp")
        assert isinstance(t, SSETransport)

    def test_creates_http_transport(self) -> None:
        t = create_transport(
            TransportType.STREAMABLE_HTTP, server_url="http://host/mcp"
        )
        assert isinstance(t, StreamableHttpTransport)

    def test_passes_headers_to_sse(self) -> None:
        t = create_transport(
            TransportType.SSE,
            server_url="http://host/mcp",
            headers={"Authorization": "Bearer tok"},
        )
        assert isinstance(t, SSETransport)
        assert t.url == "http://host/mcp"

    def test_passes_args_to_stdio(self) -> None:
        t = create_transport(
            TransportType.STDIO,
            command="python",
            args=["-m", "server"],
        )
        assert isinstance(t, StdioTransport)
        assert t.command == "python"


# ── MCPTransport is abstract ─────────────────────────────────────────


class TestMCPTransportAbstract:
    def test_cannot_instantiate(self) -> None:
        with pytest.raises(TypeError):
            MCPTransport()  # type: ignore[abstract]
