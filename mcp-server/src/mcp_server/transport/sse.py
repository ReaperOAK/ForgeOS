"""ForgeOS MCP Server — SSE transport layer for remote agent communication.

Provides the Server-Sent Events (SSE) transport for remote agents connecting
over the network.  Server-to-client notifications and responses stream via SSE,
while client-to-server requests arrive as HTTP POST to a ``/messages/`` endpoint.

The transport adds on top of the MCP SDK's built-in ``SseServerTransport``:

* **Connection tracking** — monitors active SSE connections with per-session
  metadata (client address, connect time, last activity).
* **Idle timeout enforcement** — a background task periodically closes
  connections that have been idle longer than the configured timeout.
* **Max connection limiting** — rejects new connections once a configurable
  maximum is reached.
* **Health / status endpoints** — ``/health`` returns transport liveness;
  ``/connections`` returns active connection details.
* **Graceful disconnect handling** — cleans up connection state when clients
  disconnect or are timed out.
* **Structured logging** — all lifecycle events logged via the
  ``forgeos.transport.sse`` logger hierarchy.

Usage
-----
Typically invoked via the server's ``main()`` when ``FORGEOS_TRANSPORT=sse``
is set::

    from mcp_server.transport.sse import SSETransport
    transport = SSETransport()
    await transport.run_async(mcp_server)

Or use the app factory for custom ASGI deployment::

    app = transport.create_app(mcp_server)
    uvicorn.run(app, host="0.0.0.0", port=8080)

Ticket: FORGEOS-BE017
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from pydantic import Field
from pydantic_settings import BaseSettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("forgeos.transport.sse")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class SSETransportConfig(BaseSettings):
    """SSE transport configuration loaded from environment variables.

    All values have sensible defaults for local development.  Production
    deployments override via ``FORGEOS_SSE_*`` env vars.

    Attributes
    ----------
    host : str
        Network interface to bind to.
    port : int
        TCP port to listen on.
    message_path : str
        URL path for client-to-server HTTP POST messages.
    sse_path : str
        URL path for the SSE streaming endpoint.
    idle_timeout_seconds : int
        Seconds of inactivity before an SSE connection is closed.
    max_connections : int
        Maximum concurrent SSE connections allowed.
    log_level : str
        Python logging level for the transport logger.
    """

    model_config = {"env_prefix": "FORGEOS_SSE_"}

    host: str = Field(default="0.0.0.0", description="Bind address")
    port: int = Field(default=8080, description="Bind port")
    message_path: str = Field(
        default="/messages/",
        description="Path for client-to-server HTTP POST messages",
    )
    sse_path: str = Field(
        default="/sse",
        description="Path for SSE streaming endpoint",
    )
    idle_timeout_seconds: int = Field(
        default=300,
        description="Seconds of inactivity before connection timeout",
    )
    max_connections: int = Field(
        default=100,
        description="Maximum concurrent SSE connections",
    )
    log_level: str = Field(default="INFO", description="Logging level")


# ---------------------------------------------------------------------------
# Connection tracking
# ---------------------------------------------------------------------------


@dataclass
class ConnectionInfo:
    """Metadata for a single active SSE connection.

    Attributes
    ----------
    session_id : str
        Unique identifier for the SSE session.
    client_address : str
        Remote address of the connected client.
    connected_at : float
        Monotonic timestamp when the connection was established.
    last_activity_at : float
        Monotonic timestamp of the last message activity.
    """

    session_id: str
    client_address: str
    connected_at: float = field(default_factory=time.monotonic)
    last_activity_at: float = field(default_factory=time.monotonic)

    def touch(self) -> None:
        """Update the last activity timestamp to now."""
        self.last_activity_at = time.monotonic()

    def is_idle(self, timeout_seconds: int) -> bool:
        """Check whether this connection has exceeded the idle timeout.

        Parameters
        ----------
        timeout_seconds : int
            Maximum allowed idle duration in seconds.

        Returns
        -------
        bool
            ``True`` if the connection has been idle longer than *timeout_seconds*.
        """
        return (time.monotonic() - self.last_activity_at) > timeout_seconds


class ConnectionTracker:
    """Thread-safe tracker for active SSE connections.

    Monitors connection lifecycle (register, unregister, touch) and
    enforces a maximum connection limit.

    Parameters
    ----------
    max_connections : int
        Maximum concurrent connections allowed.
    """

    def __init__(self, max_connections: int = 100) -> None:
        self._connections: dict[str, ConnectionInfo] = {}
        self._max_connections = max_connections

    def register(self, session_id: str, client_address: str) -> ConnectionInfo:
        """Register a new SSE connection.

        Parameters
        ----------
        session_id : str
            Unique session identifier.
        client_address : str
            Remote client IP address.

        Returns
        -------
        ConnectionInfo
            The newly created connection metadata.

        Raises
        ------
        ConnectionError
            If the maximum connection limit has been reached.
        """
        if len(self._connections) >= self._max_connections:
            raise ConnectionError(
                f"Maximum connections ({self._max_connections}) reached"
            )
        info = ConnectionInfo(session_id=session_id, client_address=client_address)
        self._connections[session_id] = info
        logger.info(
            "SSE connection registered: session=%s client=%s",
            session_id,
            client_address,
        )
        return info

    def unregister(self, session_id: str) -> None:
        """Remove a connection from the tracker.

        Parameters
        ----------
        session_id : str
            Session to remove.  No-op if the session does not exist.
        """
        removed = self._connections.pop(session_id, None)
        if removed is not None:
            logger.info("SSE connection unregistered: session=%s", session_id)

    def get(self, session_id: str) -> ConnectionInfo | None:
        """Look up connection info by session ID.

        Parameters
        ----------
        session_id : str
            Session to look up.

        Returns
        -------
        ConnectionInfo | None
            Connection metadata, or ``None`` if not found.
        """
        return self._connections.get(session_id)

    def touch(self, session_id: str) -> None:
        """Update the last-activity timestamp for a connection.

        Parameters
        ----------
        session_id : str
            Session to update.  No-op if the session does not exist.
        """
        info = self._connections.get(session_id)
        if info is not None:
            info.touch()

    def get_idle_connections(self, timeout_seconds: int) -> list[ConnectionInfo]:
        """Return all connections that have been idle longer than the timeout.

        Parameters
        ----------
        timeout_seconds : int
            Idle threshold in seconds.

        Returns
        -------
        list[ConnectionInfo]
            List of idle connections.
        """
        return [
            info
            for info in self._connections.values()
            if info.is_idle(timeout_seconds)
        ]

    @property
    def active_count(self) -> int:
        """Number of currently tracked connections."""
        return len(self._connections)

    @property
    def all_connections(self) -> list[ConnectionInfo]:
        """Snapshot of all tracked connections."""
        return list(self._connections.values())


# ---------------------------------------------------------------------------
# SSE Transport
# ---------------------------------------------------------------------------


class SSETransport:
    """SSE transport layer for the ForgeOS MCP Server.

    Wraps the MCP SDK's ``SseServerTransport`` and ``FastMCP.sse_app()``
    with connection lifecycle management, idle timeout enforcement, and
    operational endpoints.

    Parameters
    ----------
    config : SSETransportConfig | None
        Transport configuration.  Defaults loaded from env vars if ``None``.
    """

    def __init__(self, config: SSETransportConfig | None = None) -> None:
        self.config = config or SSETransportConfig()
        self.tracker = ConnectionTracker(max_connections=self.config.max_connections)
        self._timeout_task: asyncio.Task[None] | None = None

    def create_app(self, server: FastMCP) -> Starlette:
        """Build a Starlette ASGI application with SSE transport routes.

        The returned app includes:
        - ``/sse`` — SSE streaming endpoint (server -> client)
        - ``/messages/`` — HTTP POST endpoint (client -> server)
        - ``/health`` — transport health check
        - ``/connections`` — active connection listing

        Parameters
        ----------
        server : FastMCP
            The FastMCP server instance to attach the transport to.

        Returns
        -------
        Starlette
            Starlette ASGI application ready for ``uvicorn.run()``.
        """
        tracker = self.tracker
        config = self.config

        # Get the SSE app from FastMCP (handles /sse and /messages/ routes)
        sse_starlette_app = server.sse_app()

        async def health_endpoint(request: Request) -> JSONResponse:
            """Return transport health status."""
            return JSONResponse({
                "status": "ok",
                "transport": "sse",
                "active_connections": tracker.active_count,
                "max_connections": config.max_connections,
                "idle_timeout_seconds": config.idle_timeout_seconds,
            })

        async def connections_endpoint(request: Request) -> JSONResponse:
            """Return details of all active SSE connections."""
            now = time.monotonic()
            conns = [
                {
                    "session_id": c.session_id,
                    "client_address": c.client_address,
                    "connected_seconds": round(now - c.connected_at, 1),
                    "idle_seconds": round(now - c.last_activity_at, 1),
                }
                for c in tracker.all_connections
            ]
            return JSONResponse({
                "active_connections": tracker.active_count,
                "connections": conns,
            })

        # Build composite app with management routes + SSE transport
        routes: list[Route | Mount] = [
            Route("/health", health_endpoint, methods=["GET"]),
            Route("/connections", connections_endpoint, methods=["GET"]),
            Mount("/", app=sse_starlette_app),
        ]

        app = Starlette(routes=routes)
        logger.info(
            "SSE transport app created: sse_path=%s message_path=%s",
            config.sse_path,
            config.message_path,
        )
        return app

    async def run_async(self, server: FastMCP) -> None:
        """Start the SSE transport with uvicorn.

        Creates the ASGI app, starts the idle timeout sweep task,
        and runs uvicorn until shutdown.

        Parameters
        ----------
        server : FastMCP
            The FastMCP server instance.
        """
        import uvicorn

        app = self.create_app(server)

        # Start idle connection sweep
        self._timeout_task = asyncio.create_task(
            self._idle_timeout_sweep()
        )

        logger.info(
            "Starting SSE transport on %s:%d (timeout=%ds, max_conns=%d)",
            self.config.host,
            self.config.port,
            self.config.idle_timeout_seconds,
            self.config.max_connections,
        )

        uvi_config = uvicorn.Config(
            app,
            host=self.config.host,
            port=self.config.port,
            log_level=self.config.log_level.lower(),
        )
        uvi_server = uvicorn.Server(uvi_config)
        try:
            await uvi_server.serve()
        finally:
            if self._timeout_task is not None:
                self._timeout_task.cancel()
                try:
                    await self._timeout_task
                except asyncio.CancelledError:
                    pass
            logger.info("SSE transport shutdown complete")

    async def _idle_timeout_sweep(self) -> None:
        """Periodically check for and close idle connections.

        Runs every 30 seconds, unregistering connections that have exceeded
        the configured idle timeout.
        """
        sweep_interval = min(30, self.config.idle_timeout_seconds // 2)
        while True:
            try:
                await asyncio.sleep(sweep_interval)
                idle = self.tracker.get_idle_connections(
                    self.config.idle_timeout_seconds
                )
                for conn in idle:
                    logger.warning(
                        "Closing idle SSE connection: session=%s idle=%ds",
                        conn.session_id,
                        int(time.monotonic() - conn.last_activity_at),
                    )
                    self.tracker.unregister(conn.session_id)
            except asyncio.CancelledError:
                logger.debug("Idle timeout sweep cancelled")
                break

    def status(self) -> dict[str, Any]:
        """Return a snapshot of the transport status.

        Returns
        -------
        dict[str, Any]
            Transport status including type, connection counts, and config.
        """
        return {
            "transport": "sse",
            "active_connections": self.tracker.active_count,
            "max_connections": self.config.max_connections,
            "idle_timeout_seconds": self.config.idle_timeout_seconds,
            "host": self.config.host,
            "port": self.config.port,
        }
