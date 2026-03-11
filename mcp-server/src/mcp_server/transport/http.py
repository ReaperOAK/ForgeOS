"""ForgeOS MCP Server — Streamable HTTP transport layer for remote agents.

Provides the HTTP-based transport for bidirectional MCP sessions over
Streamable HTTP.  This is the default transport for remote agent
communication, supporting both stateful and stateless session modes.

The transport adds on top of the MCP SDK's built-in
``StreamableHTTPSessionManager``:

* **Configurable session mode** — stateless (default, for horizontal scaling)
  or stateful (session pinning for long-running operations).
* **Health endpoint** — ``/health`` returns transport liveness and config.
* **Mount-path support** — MCP endpoints can be mounted at an arbitrary
  URL prefix (e.g. ``/mcp``, ``/api/mcp``).
* **Structured logging** — lifecycle events via ``forgeos.transport.http``
  logger hierarchy.

Usage
-----
Typically invoked via the server's ``main()`` when
``FORGEOS_TRANSPORT=streamable-http`` (the default)::

    from mcp_server.transport.http import HTTPTransport
    transport = HTTPTransport()
    await transport.run_async(mcp_server)

Or use the app factory for custom ASGI deployment::

    app = transport.create_app(mcp_server)
    uvicorn.run(app, host="0.0.0.0", port=8080)

Ticket: FORGEOS-BE017
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from pydantic import Field
from pydantic_settings import BaseSettings
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route, WebSocketRoute

if TYPE_CHECKING:
    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("forgeos.transport.http")


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class HTTPTransportConfig(BaseSettings):
    """Streamable HTTP transport configuration loaded from environment variables.

    All values have sensible defaults for local development.  Production
    deployments override via ``FORGEOS_HTTP_*`` env vars.

    Attributes
    ----------
    host : str
        Network interface to bind to.
    port : int
        TCP port to listen on.
    stateless : bool
        If ``True``, run in stateless mode (no server-side session state).
        Recommended for horizontal scaling behind a load balancer.
    json_response : bool
        If ``True``, force JSON responses (vs. SSE streaming responses).
    mount_path : str
        URL prefix where MCP endpoints are mounted.
    idle_timeout_seconds : int
        Seconds of inactivity before a stateful session is cleaned up.
    log_level : str
        Python logging level for the transport logger.
    """

    model_config = {"env_prefix": "FORGEOS_HTTP_"}

    host: str = Field(default="0.0.0.0", description="Bind address")
    port: int = Field(default=8080, description="Bind port")
    stateless: bool = Field(
        default=True,
        description="Run in stateless mode (no server-side sessions)",
    )
    json_response: bool = Field(
        default=True,
        description="Force JSON responses instead of SSE streaming",
    )
    mount_path: str = Field(
        default="/mcp",
        description="URL prefix for MCP endpoints",
    )
    idle_timeout_seconds: int = Field(
        default=300,
        description="Seconds of inactivity before session cleanup",
    )
    log_level: str = Field(default="INFO", description="Logging level")


# ---------------------------------------------------------------------------
# HTTP Transport
# ---------------------------------------------------------------------------


class HTTPTransport:
    """Streamable HTTP transport layer for the ForgeOS MCP Server.

    Wraps the MCP SDK's ``FastMCP.streamable_http_app()`` with
    configuration management and operational endpoints.

    Parameters
    ----------
    config : HTTPTransportConfig | None
        Transport configuration.  Defaults loaded from env vars if ``None``.
    """

    def __init__(self, config: HTTPTransportConfig | None = None) -> None:
        self.config = config or HTTPTransportConfig()

    def create_app(self, server: FastMCP) -> Starlette:
        """Build a Starlette ASGI application with HTTP transport routes.

        The returned app includes:
        - ``{mount_path}/`` — Streamable HTTP MCP endpoint
        - ``/health`` — transport health check

        Parameters
        ----------
        server : FastMCP
            The FastMCP server instance to attach the transport to.

        Returns
        -------
        Starlette
            Starlette ASGI application ready for ``uvicorn.run()``.
        """
        config = self.config

        # Apply config to FastMCP settings
        server.settings.stateless_http = config.stateless
        server.settings.json_response = config.json_response

        # Get the streamable HTTP app from FastMCP
        http_starlette_app = server.streamable_http_app()

        async def health_endpoint(request: Request) -> JSONResponse:
            """Return transport health status."""
            return JSONResponse({
                "status": "ok",
                "transport": "streamable-http",
                "stateless": config.stateless,
                "mount_path": config.mount_path,
                "idle_timeout_seconds": config.idle_timeout_seconds,
            })

        # Build composite app with health route + MCP transport + admin API
        from mcp_server.api import create_audit_endpoint
        from mcp_server.api.routes import (
            create_health_endpoint,
            create_pipeline_endpoint,
            create_ticket_detail_endpoint,
            create_ticket_history_endpoint,
            create_tickets_endpoint,
        )
        from mcp_server.api.routes.websocket import create_websocket_endpoint
        from mcp_server.services.event_broadcaster import EventBroadcaster

        # Audit repo getter — deferred to account for late binding
        _audit_repo_ref: list[Any] = [None]

        def _get_audit_repo() -> Any:
            return _audit_repo_ref[0]

        audit_handler = create_audit_endpoint(_get_audit_repo)

        # Ticket repo getter — deferred to account for late binding
        _ticket_repo_ref: list[Any] = [None]

        def _get_ticket_repo() -> Any:
            return _ticket_repo_ref[0]

        # Event store getter — deferred to account for late binding
        _event_store_ref: list[Any] = [None]

        def _get_event_store() -> Any:
            return _event_store_ref[0]

        tickets_handler = create_tickets_endpoint(_get_ticket_repo)
        ticket_detail_handler = create_ticket_detail_endpoint(_get_ticket_repo)
        ticket_history_handler = create_ticket_history_endpoint(
            _get_ticket_repo, _get_event_store
        )

        # Pipeline endpoint — public, no auth
        pipeline_handler = create_pipeline_endpoint(_get_ticket_repo)

        # Health API endpoint — public, no auth
        _health_checker_ref: list[Any] = [None]

        def _get_health_checker() -> Any:
            return _health_checker_ref[0]

        health_api_handler = create_health_endpoint(_get_health_checker)

        # WebSocket event broadcaster — deferred to account for late binding
        _broadcaster_ref: list[EventBroadcaster | None] = [None]

        def _get_broadcaster() -> EventBroadcaster | None:
            return _broadcaster_ref[0]

        ws_handler = create_websocket_endpoint(_get_broadcaster)

        routes: list[Route | Mount] = [
            Route("/health", health_endpoint, methods=["GET"]),
            Route("/api/health", health_api_handler, methods=["GET"]),
            Route("/api/pipeline", pipeline_handler, methods=["GET"]),
            Route("/api/admin/audit", audit_handler, methods=["GET"]),
            Route("/api/tickets", tickets_handler, methods=["GET"]),
            Route("/api/tickets/{ticket_id}", ticket_detail_handler, methods=["GET"]),
            Route("/api/tickets/{ticket_id}/history", ticket_history_handler, methods=["GET"]),
            WebSocketRoute("/ws/tickets", ws_handler),
            Mount(config.mount_path, app=http_starlette_app),
        ]

        app = Starlette(routes=routes)

        # Store the audit repo ref on the app for late binding by lifespan
        app.state.audit_repo_ref = _audit_repo_ref  # type: ignore[attr-defined]
        app.state.ticket_repo_ref = _ticket_repo_ref  # type: ignore[attr-defined]
        app.state.event_store_ref = _event_store_ref  # type: ignore[attr-defined]
        app.state.health_checker_ref = _health_checker_ref  # type: ignore[attr-defined]
        app.state.broadcaster_ref = _broadcaster_ref  # type: ignore[attr-defined]
        logger.info(
            "HTTP transport app created: mount_path=%s stateless=%s",
            config.mount_path,
            config.stateless,
        )
        return app

    async def run_async(self, server: FastMCP) -> None:
        """Start the HTTP transport with uvicorn.

        Creates the ASGI app and runs uvicorn until shutdown.

        Parameters
        ----------
        server : FastMCP
            The FastMCP server instance.
        """
        import uvicorn

        app = self.create_app(server)

        logger.info(
            "Starting HTTP transport on %s:%d (stateless=%s, mount=%s)",
            self.config.host,
            self.config.port,
            self.config.stateless,
            self.config.mount_path,
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
            logger.info("HTTP transport shutdown complete")

    def status(self) -> dict[str, Any]:
        """Return a snapshot of the transport status.

        Returns
        -------
        dict[str, Any]
            Transport status including type, session mode, and config.
        """
        return {
            "transport": "streamable-http",
            "stateless": self.config.stateless,
            "json_response": self.config.json_response,
            "mount_path": self.config.mount_path,
            "idle_timeout_seconds": self.config.idle_timeout_seconds,
            "host": self.config.host,
            "port": self.config.port,
        }
