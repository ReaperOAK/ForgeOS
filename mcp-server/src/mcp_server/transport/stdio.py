"""ForgeOS MCP Server - stdio transport layer.

Provides newline-delimited JSON-RPC communication over stdin/stdout for
local agent processes that communicate with the MCP server via pipes.
"""

from __future__ import annotations

import asyncio
import signal
import sys
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

import anyio

from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from mcp.server.fastmcp import FastMCP

logger = get_logger("transport.stdio")


class StdioMessageReader:
    """Async iterator yielding complete newline-delimited lines.

    Handles partial reads by buffering incomplete data until a newline
    is received. Empty lines are silently skipped. Remaining buffer data
    on EOF is yielded as a final message.
    """

    def __init__(self, stream: anyio.AsyncFile[str]) -> None:
        self._stream_iter = stream.__aiter__()
        self._buffer: str = ""
        self._exhausted: bool = False

    def __aiter__(self) -> StdioMessageReader:
        return self

    async def __anext__(self) -> str:
        while True:
            if "\n" in self._buffer:
                line, self._buffer = self._buffer.split("\n", 1)
                stripped = line.strip()
                if stripped:
                    return stripped
                continue
            if self._exhausted:
                if self._buffer.strip():
                    remaining = self._buffer.strip()
                    self._buffer = ""
                    return remaining
                raise StopAsyncIteration
            try:
                chunk = await self._stream_iter.__anext__()
            except StopAsyncIteration:
                self._exhausted = True
                continue
            self._buffer += chunk


class StdioMessageWriter:
    """Writes messages to an async text stream with newline delimiters.

    Each write appends a newline and flushes the stream.
    """

    def __init__(self, stream: anyio.AsyncFile[str]) -> None:
        self._stream = stream

    async def write(self, message: str) -> None:
        await self._stream.write(message + "\n")
        await self._stream.flush()


def _install_sigterm_handler(shutdown_event: asyncio.Event) -> None:
    """Install a SIGTERM handler that sets *shutdown_event*."""
    loop = asyncio.get_running_loop()
    try:
        loop.add_signal_handler(signal.SIGTERM, shutdown_event.set)
        logger.debug("Installed SIGTERM handler via event loop")
    except NotImplementedError:
        signal.signal(signal.SIGTERM, lambda _signum, _frame: shutdown_event.set())
        logger.debug("Installed SIGTERM handler via signal module (fallback)")


@asynccontextmanager
async def stdio_streams(
    *,
    stdin: Any | None = None,
    stdout: Any | None = None,
) -> AsyncIterator[tuple[Any, Any]]:
    """Context manager providing async stdin/stdout streams."""
    async_stdin = stdin if stdin is not None else anyio.wrap_file(sys.stdin)
    async_stdout = stdout if stdout is not None else anyio.wrap_file(sys.stdout)
    yield async_stdin, async_stdout


async def run_stdio(server: FastMCP) -> None:
    """Run the MCP server using stdio transport.

    Delegates to FastMCP.run_stdio_async() and installs a SIGTERM handler.
    ClosedResourceError is caught as a clean shutdown.
    """
    shutdown_event = asyncio.Event()
    _install_sigterm_handler(shutdown_event)
    logger.info("Starting stdio transport")
    try:
        await server.run_stdio_async()
    except anyio.ClosedResourceError:
        logger.info("Stdio pipe closed - shutting down")
    except Exception:
        logger.exception("Unexpected error in stdio transport")
        raise
    finally:
        logger.info("Stdio transport stopped")
