"""ForgeOS Agent SDK client.

The :class:`ForgeOSClient` is the primary entry point for agents to interact
with the ForgeOS MCP server. Supports stdio, SSE, and Streamable HTTP
transports with automatic reconnection and session resumption.
"""

from __future__ import annotations

import asyncio
import logging
import random
from contextlib import AsyncExitStack
from enum import Enum
from pathlib import Path
from typing import Any

from mcp.client.session import ClientSession

from forgeos_sdk.config import OperationMode, SDKConfig, TransportType
from forgeos_sdk.exceptions import ConfigurationError
from forgeos_sdk.exceptions import ConnectionError as SDKConnectionError
from forgeos_sdk.transport import (
    MCPTransport,
    StreamableHttpTransport,
    create_transport,
)

logger = logging.getLogger("forgeos_sdk")


class ConnectionState(str, Enum):
    """Client connection lifecycle state."""

    DISCONNECTED = "disconnected"
    CONNECTING = "connecting"
    CONNECTED = "connected"
    RECONNECTING = "reconnecting"


class ForgeOSClient:
    """Client for interacting with the ForgeOS MCP server.

    Parameters:
        server_url: The MCP server URL.
        agent_id: Unique identifier for this agent.
        transport_type: MCP transport to use (default: ``streamable-http``).

    Raises:
        ConfigurationError: If ``server_url`` or ``agent_id`` is empty.

    Example::

        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="backend-agent",
        )
        await client.connect()
        # ... use client ...
        await client.disconnect()
    """

    BACKOFF_INITIAL: float = 1.0
    BACKOFF_MAX: float = 30.0
    BACKOFF_JITTER_FACTOR: float = 0.1

    def __init__(
        self,
        server_url: str,
        agent_id: str,
        transport_type: str = "streamable-http",
        mode: str = "auto",
        repo_root: Path | None = None,
    ) -> None:
        if not server_url or not server_url.strip():
            raise ConfigurationError("server_url must not be empty")
        if not agent_id or not agent_id.strip():
            raise ConfigurationError("agent_id must not be empty")

        self._server_url = server_url.strip()
        self._agent_id = agent_id.strip()

        try:
            self._transport_type = TransportType(transport_type)
        except ValueError:
            valid = ", ".join(t.value for t in TransportType)
            raise ConfigurationError(
                f"Invalid transport_type '{transport_type}'. Valid options: {valid}"
            )

        try:
            self._mode = OperationMode(mode)
        except ValueError:
            valid = ", ".join(m.value for m in OperationMode)
            raise ConfigurationError(
                f"Invalid mode '{mode}'. Valid options: {valid}"
            )

        self._repo_root = repo_root

        # Connection state
        self._state = ConnectionState.DISCONNECTED
        self._transport: MCPTransport | None = None
        self._session: ClientSession | None = None
        self._session_id: str | None = None
        self._server_capabilities: Any = None
        self._exit_stack: AsyncExitStack | None = None
        self._reconnect_task: asyncio.Task[None] | None = None
        self._auto_reconnect: bool = True

        # Fallback state
        self._fallback_active: bool = False
        self._fallback: Any = None  # FilesystemFallback, lazily imported

        # Transport-specific config (set during connect)
        self._stdio_command: str = ""
        self._stdio_args: list[str] = []
        self._stdio_env: dict[str, str] | None = None
        self._headers: dict[str, str] = {}

        logger.info(
            "ForgeOSClient initialised",
            extra={
                "server_url": self._server_url,
                "agent_id": self._agent_id,
                "transport": self._transport_type.value,
                "mode": self._mode.value,
            },
        )

    @classmethod
    def from_env(cls, overrides: dict[str, str] | None = None) -> ForgeOSClient:
        """Create a client from environment variables.

        Reads ``FORGEOS_SERVER_URL``, ``FORGEOS_AGENT_ID``,
        ``FORGEOS_TRANSPORT``, and ``FORGEOS_MODE`` from the environment
        with sensible defaults.

        Parameters:
            overrides: Optional dict to override specific config values.

        Returns:
            A configured :class:`ForgeOSClient` instance.
        """
        config = SDKConfig(_env_file=None)  # type: ignore[call-arg]

        server_url = config.server_url
        agent_id = config.agent_id
        transport = config.transport.value
        mode = config.mode.value

        if overrides:
            server_url = overrides.get("server_url", server_url)
            agent_id = overrides.get("agent_id", agent_id)
            transport = overrides.get("transport", transport)
            mode = overrides.get("mode", mode)

        return cls(
            server_url=server_url,
            agent_id=agent_id,
            transport_type=transport,
            mode=mode,
        )

    # ── Connection lifecycle ──────────────────────────────────────────

    async def connect(
        self,
        *,
        command: str = "",
        args: list[str] | None = None,
        env: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        auto_reconnect: bool = True,
    ) -> None:
        """Connect to the MCP server and initialize the session.

        In ``filesystem`` mode, the MCP connection is skipped and the client
        activates the filesystem fallback immediately.  In ``auto`` mode, a
        connection failure triggers a transparent switch to fallback with a
        warning log.

        For stdio transport, ``command`` is required. For HTTP/SSE transports,
        the ``server_url`` from the constructor is used.

        Args:
            command: Command to run for stdio transport.
            args: Arguments for the stdio command.
            env: Environment variables for stdio subprocess.
            headers: HTTP headers for HTTP/SSE transports.
            auto_reconnect: Whether to enable automatic reconnection.

        Raises:
            ConnectionError: If already connected or connection fails
                (MCP mode only).
        """
        if self._state == ConnectionState.CONNECTED:
            raise SDKConnectionError("Already connected")

        self._auto_reconnect = auto_reconnect
        self._stdio_command = command
        self._stdio_args = args or []
        self._stdio_env = env
        self._headers = dict(headers) if headers else {}

        # Filesystem mode — skip MCP entirely
        if self._mode == OperationMode.FILESYSTEM:
            self._activate_fallback()
            logger.info(
                "Mode=filesystem — MCP connection skipped, using fallback",
                extra={"agent_id": self._agent_id},
            )
            return

        # MCP or AUTO — attempt MCP connection
        self._state = ConnectionState.CONNECTING
        try:
            await self._establish_connection()
        except Exception as exc:
            self._state = ConnectionState.DISCONNECTED

            if self._mode == OperationMode.AUTO:
                logger.warning(
                    "MCP server unreachable — switching to filesystem fallback",
                    extra={
                        "agent_id": self._agent_id,
                        "error": str(exc),
                    },
                )
                self._activate_fallback()
                return

            raise

    async def disconnect(self) -> None:
        """Disconnect from the MCP server.

        Cancels any pending reconnection, closes the session and transport.
        Safe to call when already disconnected.
        """
        if self._reconnect_task and not self._reconnect_task.done():
            self._reconnect_task.cancel()
            try:
                await self._reconnect_task
            except asyncio.CancelledError:
                pass
            self._reconnect_task = None

        if self._exit_stack:
            try:
                await self._exit_stack.aclose()
            except Exception:
                logger.debug("Error closing session exit stack", exc_info=True)
            finally:
                self._exit_stack = None

        self._session = None

        if self._transport:
            try:
                await self._transport.close()
            except Exception:
                logger.debug("Error closing transport", exc_info=True)
            finally:
                self._transport = None

        self._state = ConnectionState.DISCONNECTED
        logger.info(
            "Disconnected from MCP server",
            extra={"agent_id": self._agent_id},
        )

    async def reconnect(self, *, max_attempts: int = 10) -> None:
        """Reconnect with exponential backoff.

        Attempts session resumption using the previous session ID when
        available (HTTP-based transports only).

        Args:
            max_attempts: Maximum number of reconnection attempts.

        Raises:
            ConnectionError: If reconnection fails or already in progress.
        """
        if self._state == ConnectionState.RECONNECTING:
            raise SDKConnectionError("Reconnection already in progress")

        self._state = ConnectionState.RECONNECTING

        # Clean up existing connection
        if self._exit_stack:
            try:
                await self._exit_stack.aclose()
            except Exception:
                logger.debug("Error closing session during reconnect", exc_info=True)
            self._exit_stack = None
        self._session = None

        if self._transport:
            try:
                await self._transport.close()
            except Exception:
                logger.debug("Error closing transport during reconnect", exc_info=True)
            self._transport = None

        attempt = 0
        last_error: Exception | None = None

        while attempt < max_attempts:
            delay = self._calculate_backoff(
                attempt,
                initial=self.BACKOFF_INITIAL,
                maximum=self.BACKOFF_MAX,
                jitter_factor=self.BACKOFF_JITTER_FACTOR,
            )
            logger.info(
                "Attempting reconnection",
                extra={
                    "attempt": attempt + 1,
                    "delay_seconds": round(delay, 2),
                    "agent_id": self._agent_id,
                    "session_id": self._session_id,
                },
            )
            await asyncio.sleep(delay)

            try:
                await self._establish_connection()
                logger.info(
                    "Reconnected successfully",
                    extra={
                        "attempt": attempt + 1,
                        "agent_id": self._agent_id,
                    },
                )
                return
            except Exception as exc:
                last_error = exc
                attempt += 1
                logger.warning(
                    "Reconnection attempt failed",
                    extra={
                        "attempt": attempt,
                        "error": str(exc),
                        "agent_id": self._agent_id,
                    },
                )

        self._state = ConnectionState.DISCONNECTED
        raise SDKConnectionError(
            f"Reconnection failed after {max_attempts} attempts: {last_error}"
        )

    # ── Internal helpers ──────────────────────────────────────────────

    def _activate_fallback(self) -> None:
        """Activate the filesystem fallback backend."""
        from forgeos_sdk.fallback import FilesystemFallback

        self._fallback = FilesystemFallback(
            repo_root=self._repo_root or None,
            agent_id=self._agent_id,
        )
        self._fallback_active = True
        self._mode = OperationMode.FILESYSTEM

    async def _establish_connection(self) -> None:
        """Create transport, open session, run MCP initialize handshake."""
        exit_stack = AsyncExitStack()
        transport: MCPTransport | None = None

        try:
            # Include session ID header for resumption on reconnect
            transport_headers = dict(self._headers)
            if self._session_id and self._transport_type != TransportType.STDIO:
                transport_headers["Mcp-Session-Id"] = self._session_id

            transport = create_transport(
                self._transport_type,
                server_url=self._server_url,
                command=self._stdio_command,
                args=self._stdio_args,
                env=self._stdio_env,
                headers=transport_headers or None,
            )

            read_stream, write_stream = await transport.start()

            session = await exit_stack.enter_async_context(
                ClientSession(read_stream, write_stream)
            )

            result = await session.initialize()

            # Commit state only after full success
            self._exit_stack = exit_stack
            self._transport = transport
            self._session = session
            self._server_capabilities = result

            # Track session ID for future resumption
            if isinstance(transport, StreamableHttpTransport):
                sid = transport.session_id
                if sid:
                    self._session_id = sid

            self._state = ConnectionState.CONNECTED
            logger.info(
                "MCP session initialized",
                extra={
                    "agent_id": self._agent_id,
                    "server_info": getattr(result, "serverInfo", None),
                },
            )
        except Exception:
            # Clean up partially-created resources
            try:
                await exit_stack.aclose()
            except Exception:
                pass
            if transport:
                try:
                    await transport.close()
                except Exception:
                    pass
            raise

    @staticmethod
    def _calculate_backoff(
        attempt: int,
        initial: float = 1.0,
        maximum: float = 30.0,
        jitter_factor: float = 0.1,
    ) -> float:
        """Calculate exponential backoff delay with jitter.

        Args:
            attempt: Zero-based attempt number.
            initial: Initial delay in seconds.
            maximum: Maximum delay cap in seconds.
            jitter_factor: Fraction of delay to add as random jitter.

        Returns:
            Delay in seconds.
        """
        delay = min(initial * (2**attempt), maximum)
        jitter = random.uniform(0, delay * jitter_factor)
        return delay + jitter

    # ── Properties ────────────────────────────────────────────────────

    @property
    def server_url(self) -> str:
        """The MCP server URL."""
        return self._server_url

    @property
    def agent_id(self) -> str:
        """The agent identifier."""
        return self._agent_id

    @property
    def transport_type(self) -> TransportType:
        """The configured MCP transport type."""
        return self._transport_type

    @property
    def connection_state(self) -> ConnectionState:
        """Current connection lifecycle state."""
        return self._state

    @property
    def is_connected(self) -> bool:
        """Whether the client has an active MCP session."""
        return self._state == ConnectionState.CONNECTED

    @property
    def session(self) -> ClientSession | None:
        """The active MCP client session, or None if disconnected."""
        return self._session

    @property
    def server_capabilities(self) -> Any:
        """Server capabilities from the MCP initialize response."""
        return self._server_capabilities

    @property
    def session_id(self) -> str | None:
        """Current session ID for session resumption."""
        return self._session_id

    @property
    def mode(self) -> OperationMode:
        """Current operation mode (mcp, filesystem, or auto)."""
        return self._mode

    @property
    def is_fallback_active(self) -> bool:
        """Whether the filesystem fallback is currently active."""
        return self._fallback_active

    @property
    def fallback(self) -> Any:
        """The :class:`FilesystemFallback` instance, or ``None``."""
        return self._fallback

    # ── Context manager ───────────────────────────────────────────────

    async def __aenter__(self) -> ForgeOSClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        await self.disconnect()
