"""MCP transport abstraction layer.

Provides transport implementations for stdio (local) and HTTP/SSE (remote)
communication with MCP servers, wrapping the official MCP Python SDK transports.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from contextlib import AsyncExitStack
from typing import Any

from mcp.client.sse import sse_client
from mcp.client.stdio import StdioServerParameters, stdio_client

from forgeos_sdk.config import TransportType
from forgeos_sdk.exceptions import ConfigurationError
from forgeos_sdk.exceptions import ConnectionError as SDKConnectionError

logger = logging.getLogger("forgeos_sdk")

try:
    from mcp.client.streamable_http import streamablehttp_client
except ImportError:
    streamablehttp_client = None  # type: ignore[assignment,misc]


class MCPTransport(ABC):
    """Abstract base class for MCP transport implementations."""

    @abstractmethod
    async def start(self) -> tuple[Any, Any]:
        """Start transport and return (read_stream, write_stream)."""

    @abstractmethod
    async def close(self) -> None:
        """Close the transport and release resources."""

    @property
    @abstractmethod
    def is_connected(self) -> bool:
        """Whether the transport is currently active."""


class StdioTransport(MCPTransport):
    """Stdio subprocess transport for local agent communication."""

    def __init__(
        self,
        command: str,
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
    ) -> None:
        if not command or not command.strip():
            raise ConfigurationError("stdio command must not be empty")
        self._command = command.strip()
        self._args = args or []
        self._env = env
        self._connected = False
        self._exit_stack: AsyncExitStack | None = None

    async def start(self) -> tuple[Any, Any]:
        self._exit_stack = AsyncExitStack()
        try:
            params = StdioServerParameters(
                command=self._command,
                args=self._args,
                env=self._env,
            )
            read_stream, write_stream = await self._exit_stack.enter_async_context(
                stdio_client(params)
            )
            self._connected = True
            logger.info("Stdio transport started", extra={"command": self._command})
            return read_stream, write_stream
        except Exception as exc:
            await self._safe_close_stack()
            raise SDKConnectionError(
                f"Failed to start stdio transport: {exc}"
            ) from exc

    async def close(self) -> None:
        await self._safe_close_stack()
        self._connected = False
        logger.info("Stdio transport closed")

    async def _safe_close_stack(self) -> None:
        if self._exit_stack is not None:
            try:
                await self._exit_stack.aclose()
            except Exception:
                logger.debug("Error closing stdio exit stack", exc_info=True)
            finally:
                self._exit_stack = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def command(self) -> str:
        return self._command


class SSETransport(MCPTransport):
    """Server-Sent Events transport for remote agent communication."""

    def __init__(
        self,
        url: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        if not url or not url.strip():
            raise ConfigurationError("SSE URL must not be empty")
        self._url = url.strip()
        self._headers = dict(headers) if headers else {}
        self._connected = False
        self._exit_stack: AsyncExitStack | None = None

    async def start(self) -> tuple[Any, Any]:
        self._exit_stack = AsyncExitStack()
        try:
            read_stream, write_stream = await self._exit_stack.enter_async_context(
                sse_client(self._url, headers=self._headers)
            )
            self._connected = True
            logger.info("SSE transport started", extra={"url": self._url})
            return read_stream, write_stream
        except Exception as exc:
            await self._safe_close_stack()
            raise SDKConnectionError(
                f"Failed to start SSE transport: {exc}"
            ) from exc

    async def close(self) -> None:
        await self._safe_close_stack()
        self._connected = False
        logger.info("SSE transport closed")

    async def _safe_close_stack(self) -> None:
        if self._exit_stack is not None:
            try:
                await self._exit_stack.aclose()
            except Exception:
                logger.debug("Error closing SSE exit stack", exc_info=True)
            finally:
                self._exit_stack = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def url(self) -> str:
        return self._url


class StreamableHttpTransport(MCPTransport):
    """Streamable HTTP transport for remote agent communication."""

    def __init__(
        self,
        url: str,
        headers: dict[str, str] | None = None,
    ) -> None:
        if not url or not url.strip():
            raise ConfigurationError("HTTP URL must not be empty")
        self._url = url.strip()
        self._headers = dict(headers) if headers else {}
        self._connected = False
        self._exit_stack: AsyncExitStack | None = None
        self._get_session_id_fn: Any = None

    async def start(self) -> tuple[Any, Any]:
        if streamablehttp_client is None:
            raise ConfigurationError(
                "Streamable HTTP transport not available — upgrade mcp package"
            )
        self._exit_stack = AsyncExitStack()
        try:
            result = await self._exit_stack.enter_async_context(
                streamablehttp_client(self._url, headers=self._headers)
            )
            read_stream, write_stream = result[0], result[1]
            if len(result) > 2:
                self._get_session_id_fn = result[2]
            self._connected = True
            logger.info("HTTP transport started", extra={"url": self._url})
            return read_stream, write_stream
        except ConfigurationError:
            raise
        except Exception as exc:
            await self._safe_close_stack()
            raise SDKConnectionError(
                f"Failed to start HTTP transport: {exc}"
            ) from exc

    async def close(self) -> None:
        await self._safe_close_stack()
        self._connected = False
        self._get_session_id_fn = None
        logger.info("HTTP transport closed")

    async def _safe_close_stack(self) -> None:
        if self._exit_stack is not None:
            try:
                await self._exit_stack.aclose()
            except Exception:
                logger.debug("Error closing HTTP exit stack", exc_info=True)
            finally:
                self._exit_stack = None

    @property
    def is_connected(self) -> bool:
        return self._connected

    @property
    def url(self) -> str:
        return self._url

    @property
    def session_id(self) -> str | None:
        if callable(self._get_session_id_fn):
            return self._get_session_id_fn()
        return None


def create_transport(
    transport_type: TransportType,
    *,
    server_url: str = "",
    command: str = "",
    args: list[str] | None = None,
    env: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> MCPTransport:
    """Create the appropriate transport implementation for the given type."""
    if transport_type == TransportType.STDIO:
        return StdioTransport(command=command, args=args, env=env)
    if transport_type == TransportType.SSE:
        return SSETransport(url=server_url, headers=headers)
    if transport_type == TransportType.STREAMABLE_HTTP:
        return StreamableHttpTransport(url=server_url, headers=headers)
    raise ConfigurationError(f"Unsupported transport type: {transport_type}")
