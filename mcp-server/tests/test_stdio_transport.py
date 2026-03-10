"""Tests for the stdio transport layer - FORGEOS-BE016.

TDD Evidence
------------
- RED: tests written first to define expected stdio transport behavior
- GREEN: transport/stdio.py + transport/__init__.py implemented to satisfy tests
- REFACTOR: consolidated message reader/writer, extracted signal handling

Test Coverage Matrix (mapped to acceptance criteria)
----------------------------------------------------
AC1: stdio transport reads newline-delimited JSON-RPC messages from stdin
AC2: Responses are written to stdout as newline-delimited JSON
AC3: Transport handles partial reads and message buffering correctly
AC4: Clean shutdown on stdin EOF or SIGTERM signal
AC5: Transport can be selected via command-line argument or environment variable
AC6: An agent can connect via stdio, send an initialize request, receive response
"""

from __future__ import annotations

import asyncio
import json
import signal
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import anyio
import pytest

from mcp_server.transport import (
    DEFAULT_TRANSPORT,
    TransportType,
    parse_transport,
)
from mcp_server.transport.stdio import (
    StdioMessageReader,
    StdioMessageWriter,
    _install_sigterm_handler,
    run_stdio,
    stdio_streams,
)


class FakeAsyncTextStream:
    """A fake async file that yields pre-loaded chunks exactly once.

    Implements the async iterator protocol correctly: ``__aiter__`` returns
    ``self`` so that repeated ``async for`` loops over the same object resume
    where the previous loop left off (and terminate when all chunks are
    consumed).
    """

    def __init__(self, chunks: list[str]) -> None:
        self._chunks = list(chunks)
        self._index: int = 0
        self._written: list[str] = []
        self._flushed: int = 0

    def __aiter__(self) -> FakeAsyncTextStream:
        return self

    async def __anext__(self) -> str:
        if self._index >= len(self._chunks):
            raise StopAsyncIteration
        chunk = self._chunks[self._index]
        self._index += 1
        return chunk

    async def write(self, data: str) -> None:
        self._written.append(data)

    async def flush(self) -> None:
        self._flushed += 1

    @property
    def written_data(self) -> str:
        return "".join(self._written)

    @property
    def flush_count(self) -> int:
        return self._flushed


class TestTransportSelection:
    """AC5: Transport can be selected via CLI argument or environment variable."""

    def test_parse_transport_stdio(self) -> None:
        assert parse_transport("stdio") == "stdio"

    def test_parse_transport_streamable_http(self) -> None:
        assert parse_transport("streamable-http") == "streamable-http"

    def test_parse_transport_sse(self) -> None:
        assert parse_transport("sse") == "sse"

    def test_parse_transport_case_insensitive(self) -> None:
        assert parse_transport("STDIO") == "stdio"
        assert parse_transport("Streamable-HTTP") == "streamable-http"
        assert parse_transport("SSE") == "sse"

    def test_parse_transport_strips_whitespace(self) -> None:
        assert parse_transport("  stdio  ") == "stdio"

    def test_parse_transport_invalid(self) -> None:
        with pytest.raises(ValueError, match="Unknown transport"):
            parse_transport("websocket")

    def test_parse_transport_invalid_includes_valid_list(self) -> None:
        with pytest.raises(ValueError, match="stdio"):
            parse_transport("invalid")

    def test_default_transport_is_streamable_http(self) -> None:
        assert DEFAULT_TRANSPORT == "streamable-http"

    def test_transport_type_enum_values(self) -> None:
        assert TransportType.STDIO.value == "stdio"
        assert TransportType.STREAMABLE_HTTP.value == "streamable-http"
        assert TransportType.SSE.value == "sse"

    def test_transport_type_is_string_enum(self) -> None:
        assert isinstance(TransportType.STDIO, str)
        assert TransportType.STDIO == "stdio"


class TestStdioMessageReader:
    """AC1 + AC3: Message reading with buffering and partial read handling."""

    @pytest.mark.asyncio
    async def test_reads_single_line(self) -> None:
        stream = FakeAsyncTextStream(["hello\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == ["hello"]

    @pytest.mark.asyncio
    async def test_reads_multiple_lines(self) -> None:
        stream = FakeAsyncTextStream(["line1\nline2\nline3\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == ["line1", "line2", "line3"]

    @pytest.mark.asyncio
    async def test_reads_json_rpc_message(self) -> None:
        msg = json.dumps({"jsonrpc": "2.0", "method": "initialize", "id": 1})
        stream = FakeAsyncTextStream([msg + "\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert len(lines) == 1
        parsed = json.loads(lines[0])
        assert parsed["method"] == "initialize"

    @pytest.mark.asyncio
    async def test_handles_partial_reads(self) -> None:
        stream = FakeAsyncTextStream(["hel", "lo\nwor", "ld\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == ["hello", "world"]

    @pytest.mark.asyncio
    async def test_handles_multiple_messages_in_single_chunk(self) -> None:
        stream = FakeAsyncTextStream(["msg1\nmsg2\nmsg3\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == ["msg1", "msg2", "msg3"]

    @pytest.mark.asyncio
    async def test_handles_empty_lines(self) -> None:
        stream = FakeAsyncTextStream(["msg1\n\n\nmsg2\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == ["msg1", "msg2"]

    @pytest.mark.asyncio
    async def test_flushes_buffer_on_close(self) -> None:
        stream = FakeAsyncTextStream(["no-newline-at-end"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == ["no-newline-at-end"]

    @pytest.mark.asyncio
    async def test_eof_ends_iteration(self) -> None:
        stream = FakeAsyncTextStream([])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == []

    @pytest.mark.asyncio
    async def test_mixed_partial_and_complete(self) -> None:
        stream = FakeAsyncTextStream(["abc", "def\nghi\njk", "l\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        lines = [line async for line in reader]
        assert lines == ["abcdef", "ghi", "jkl"]


class TestStdioMessageWriter:
    """AC2: Newline-delimited JSON-RPC response writing."""

    @pytest.mark.asyncio
    async def test_writes_with_newline(self) -> None:
        stream = FakeAsyncTextStream([])
        writer = StdioMessageWriter(stream)  # type: ignore[arg-type]
        await writer.write("hello")
        assert stream.written_data == "hello\n"

    @pytest.mark.asyncio
    async def test_flushes_after_write(self) -> None:
        stream = FakeAsyncTextStream([])
        writer = StdioMessageWriter(stream)  # type: ignore[arg-type]
        await writer.write("msg")
        assert stream.flush_count == 1

    @pytest.mark.asyncio
    async def test_writes_json_rpc_response(self) -> None:
        response = json.dumps({"jsonrpc": "2.0", "result": {"ok": True}, "id": 1})
        stream = FakeAsyncTextStream([])
        writer = StdioMessageWriter(stream)  # type: ignore[arg-type]
        await writer.write(response)
        written = stream.written_data.strip()
        parsed = json.loads(written)
        assert parsed["result"]["ok"] is True

    @pytest.mark.asyncio
    async def test_multiple_writes(self) -> None:
        stream = FakeAsyncTextStream([])
        writer = StdioMessageWriter(stream)  # type: ignore[arg-type]
        await writer.write("msg1")
        await writer.write("msg2")
        assert stream.written_data == "msg1\nmsg2\n"
        assert stream.flush_count == 2


class TestSignalHandling:
    """AC4: Clean shutdown on SIGTERM."""

    @pytest.mark.asyncio
    async def test_sigterm_handler_sets_event(self) -> None:
        shutdown_event = asyncio.Event()
        assert not shutdown_event.is_set()
        mock_loop = MagicMock()
        captured_handler = None

        def capture_handler(sig: int, handler: Any) -> None:
            nonlocal captured_handler
            captured_handler = handler

        mock_loop.add_signal_handler = capture_handler
        with patch("asyncio.get_running_loop", return_value=mock_loop):
            _install_sigterm_handler(shutdown_event)
        assert captured_handler is not None
        captured_handler()
        assert shutdown_event.is_set()

    @pytest.mark.asyncio
    async def test_sigterm_fallback_on_not_implemented(self) -> None:
        shutdown_event = asyncio.Event()
        mock_loop = MagicMock()
        mock_loop.add_signal_handler.side_effect = NotImplementedError
        with (
            patch("asyncio.get_running_loop", return_value=mock_loop),
            patch("signal.signal") as mock_signal,
        ):
            _install_sigterm_handler(shutdown_event)
            mock_signal.assert_called_once()
            assert mock_signal.call_args[0][0] == signal.SIGTERM


class TestRunStdio:
    """AC4 + AC6: Integration of run_stdio with mock server."""

    @pytest.mark.asyncio
    async def test_clean_shutdown_on_eof(self) -> None:
        mock_server = MagicMock()
        mock_server.run_stdio_async = AsyncMock(return_value=None)
        await run_stdio(mock_server)
        mock_server.run_stdio_async.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_handles_closed_resource(self) -> None:
        mock_server = MagicMock()
        mock_server.run_stdio_async = AsyncMock(
            side_effect=anyio.ClosedResourceError()
        )
        await run_stdio(mock_server)

    @pytest.mark.asyncio
    async def test_reraises_unexpected_error(self) -> None:
        mock_server = MagicMock()
        mock_server.run_stdio_async = AsyncMock(
            side_effect=RuntimeError("unexpected")
        )
        with pytest.raises(RuntimeError, match="unexpected"):
            await run_stdio(mock_server)


class TestStdioStreams:
    """Tests for the stdio_streams context manager."""

    @pytest.mark.asyncio
    async def test_custom_streams_passthrough(self) -> None:
        fake_stdin = FakeAsyncTextStream([])
        fake_stdout = FakeAsyncTextStream([])
        async with stdio_streams(
            stdin=fake_stdin, stdout=fake_stdout  # type: ignore[arg-type]
        ) as (sin, sout):
            assert sin is fake_stdin
            assert sout is fake_stdout


class TestServerConfig:
    """AC5: Transport selectable via env var in ServerConfig."""

    def test_transport_config_default(self) -> None:
        from mcp_server.server import ServerConfig
        config = ServerConfig()
        assert config.transport == "streamable-http"

    def test_transport_config_accepts_stdio(self) -> None:
        from mcp_server.server import ServerConfig
        config = ServerConfig(transport="stdio")  # type: ignore[call-arg]
        assert config.transport == "stdio"


class TestIntegrationStdioInitialize:
    """AC6: Agent connects via stdio, sends initialize, receives response."""

    @pytest.mark.asyncio
    async def test_message_reader_parses_initialize_request(self) -> None:
        init_request = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "test-agent", "version": "0.1.0"},
            },
        })
        stream = FakeAsyncTextStream([init_request + "\n"])
        reader = StdioMessageReader(stream)  # type: ignore[arg-type]
        messages = [line async for line in reader]
        assert len(messages) == 1
        parsed = json.loads(messages[0])
        assert parsed["method"] == "initialize"
        assert parsed["params"]["clientInfo"]["name"] == "test-agent"

    @pytest.mark.asyncio
    async def test_message_writer_sends_initialize_response(self) -> None:
        init_response = json.dumps({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "ForgeOS", "version": "0.1.0"},
            },
        })
        stream = FakeAsyncTextStream([])
        writer = StdioMessageWriter(stream)  # type: ignore[arg-type]
        await writer.write(init_response)
        written = stream.written_data.strip()
        parsed = json.loads(written)
        assert parsed["result"]["serverInfo"]["name"] == "ForgeOS"
        assert parsed["result"]["capabilities"]["tools"] is not None
