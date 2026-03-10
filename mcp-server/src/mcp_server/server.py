"""ForgeOS MCP Server — initialization, configuration, and bootstrap.

This module creates the :class:`FastMCP` server instance, registers its
lifespan for database connectivity, defines MCP-compliant error handling,
and exposes a :func:`main` entry point that starts the Streamable HTTP
transport.

Public API
----------
* :class:`ServerConfig` — Pydantic-settings model for ``FORGEOS_*`` env vars.
* :class:`AppContext` — typed dependency container injected into tool handlers.
* :data:`mcp_server` — singleton :class:`FastMCP` instance.
* :func:`main` — CLI entry point (``forgeos-mcp`` script).
* :func:`health_check` — MCP tool returning component health status.

Error Hierarchy
~~~~~~~~~~~~~~~
* :class:`ForgeOSError` — base class.
* :class:`TicketNotFoundError` — ticket does not exist (``-32602``).
* :class:`TicketAlreadyClaimedError` — concurrent claim conflict (``-32602``).
* :class:`ValidationError` — bad input (``-32602``).
* :class:`DatabaseError` — DB failure (``-32603``).
* :func:`raise_mcp_error` — converts domain errors to :class:`McpError`.
* :func:`tool_error_response` — builds ``isError=True`` content list.

Design decisions
----------------
* **FastMCP high-level API** — decorator-based tool registration, automatic
  JSON Schema generation from type hints, built-in capability negotiation.
* **Stateless HTTP mode** — ``stateless_http=True`` for horizontal scaling;
  no server-side session state is kept between requests.
* **Lifespan pattern** — ``asyncpg`` connection pool is created on startup
  and closed on shutdown via ``@asynccontextmanager``.
* **Structured errors** — domain errors map to ``McpError`` with standard
  JSON-RPC error codes; tool-level failures use ``isError=True`` responses.

.. meta::
   :last_reviewed: 2026-03-11T14:30:00Z
"""

from __future__ import annotations
import sys

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from mcp.server.fastmcp import FastMCP
from mcp.shared.exceptions import McpError
from mcp.types import ErrorData, TextContent
from pydantic import Field
from pydantic_settings import BaseSettings

from mcp_server import __app_name__, __version__
from mcp_server.observability import configure_logging as _configure_logging
from mcp_server.observability import get_logger

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

# ---------------------------------------------------------------------------
# Structured logger — JSON output, no PII, no console.log
# ---------------------------------------------------------------------------

logger = get_logger("mcp")


# ---------------------------------------------------------------------------
# Configuration — validated via pydantic-settings
# ---------------------------------------------------------------------------


class ServerConfig(BaseSettings):
    """Server configuration loaded from environment variables.

    All values have sensible defaults for local development.
    Production deployments override via env vars or ``.env`` file.
    """

    model_config = {"env_prefix": "FORGEOS_"}

    host: str = Field(default="0.0.0.0", description="Bind address")
    port: int = Field(default=8080, description="Bind port")
    log_level: str = Field(default="INFO", description="Logging level")
    transport: str = Field(
        default="streamable-http",
        description="MCP transport type: stdio, streamable-http, or sse",
    )

    # Database settings — used by the lifespan to create the asyncpg pool.
    database_url: str = Field(
        default="postgresql://forgeos:forgeos@localhost:5432/forgeos",
        description="PostgreSQL connection URI",
    )
    db_min_pool_size: int = Field(default=2, description="Minimum pool connections")
    db_max_pool_size: int = Field(default=10, description="Maximum pool connections")
    db_required: bool = Field(
        default=False,
        description="If true, server exits with code 1 when DB is unreachable",
    )


# ---------------------------------------------------------------------------
# Application context — typed dependency container
# ---------------------------------------------------------------------------


@dataclass
class AppContext:
    """Typed application context available to every tool handler.

    Attributes
    ----------
    config : ServerConfig
        Validated server configuration.
    dependencies : Dependencies | None
        The dependency container (pool + repositories).  ``None`` when the
        database is unavailable (degraded mode).
    health_checker : HealthChecker | None
        The :class:`HealthChecker` instance for health/readiness probes.
    """

    config: ServerConfig = field(default_factory=ServerConfig)
    dependencies: Any = field(default=None)
    health_checker: Any = field(default=None)

    @property
    def db_pool(self) -> Any:
        """Backward-compatible accessor for the connection pool wrapper."""
        if self.dependencies is not None:
            return self.dependencies.pool
        return None

    @property
    def ticket_repo(self) -> Any:
        """Shortcut to the ticket repository."""
        return self.dependencies.ticket_repo if self.dependencies else None

    @property
    def claim_repo(self) -> Any:
        """Shortcut to the claim repository."""
        return self.dependencies.claim_repo if self.dependencies else None

    @property
    def event_repo(self) -> Any:
        """Shortcut to the event repository."""
        return self.dependencies.event_repo if self.dependencies else None


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown resource management
# ---------------------------------------------------------------------------


@asynccontextmanager
async def _app_lifespan(server: FastMCP) -> AsyncIterator[AppContext]:
    """Manage server lifecycle: connect DB pool on start, close on stop.

    Parameters
    ----------
    server : FastMCP
        The FastMCP instance (unused but required by the lifespan protocol).

    Yields
    ------
    AppContext
        Typed dependency container passed to tool handlers via ``ctx``.
    """
    config = ServerConfig()
    _configure_logging(config.log_level)
    logger.info(
        "Starting %s v%s on %s:%d",
        __app_name__,
        __version__,
        config.host,
        config.port,
    )

    from mcp_server.dependencies import Dependencies
    from mcp_server.observability.health import HealthChecker

    deps: Dependencies | None = None
    health_checker: HealthChecker | None = None
    try:
        try:
            deps = await Dependencies.create(
                dsn=config.database_url,
                min_size=config.db_min_pool_size,
                max_size=config.db_max_pool_size,
            )
            logger.info(
                "Database wired (min=%d, max=%d, repos=3)",
                config.db_min_pool_size,
                config.db_max_pool_size,
            )
        except (ConnectionError, Exception) as exc:
            if config.db_required:
                logger.error(
                    "Database connection required but failed: %s", exc
                )
                sys.exit(1)
            logger.warning(
                "Database connection unavailable \u2014 running in degraded mode: %s",
                exc,
            )

        pool_wrapper = deps.pool if deps is not None else None
        health_checker = HealthChecker(pool=pool_wrapper)
        health_checker.mark_ready()

        yield AppContext(
            config=config,
            dependencies=deps,
            health_checker=health_checker,
        )
    finally:
        if health_checker is not None:
            health_checker.mark_draining()
        if deps is not None:
            await deps.close()
            logger.info("Dependencies closed")
        logger.info("Server shutdown complete")


# ---------------------------------------------------------------------------
# MCP-compliant error codes
# ---------------------------------------------------------------------------

# Standard JSON-RPC error codes (from MCP spec)
PARSE_ERROR = -32700
INVALID_REQUEST = -32600
METHOD_NOT_FOUND = -32601
INVALID_PARAMS = -32602
INTERNAL_ERROR = -32603


class ForgeOSError(Exception):
    """Base class for ForgeOS domain errors.

    Subclasses define an ``error_code`` and ``status_code`` for mapping
    to MCP JSON-RPC error responses.
    """

    error_code: int = INTERNAL_ERROR
    status_code: int = 500

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        """Create a new domain error.

        Parameters
        ----------
        message : str
            Human-readable error description.
        details : dict[str, Any] | None
            Optional structured data included in the MCP error response.
        """
        super().__init__(message)
        self.message = message
        self.details = details or {}


class TicketNotFoundError(ForgeOSError):
    """Raised when a referenced ticket does not exist."""

    error_code: int = INVALID_PARAMS
    status_code: int = 404


class TicketAlreadyClaimedError(ForgeOSError):
    """Raised when a ticket is already claimed by another agent."""

    error_code: int = INVALID_PARAMS
    status_code: int = 409


class ValidationError(ForgeOSError):
    """Raised when input validation fails."""

    error_code: int = INVALID_PARAMS
    status_code: int = 400


class DatabaseError(ForgeOSError):
    """Raised when a database operation fails."""

    error_code: int = INTERNAL_ERROR
    status_code: int = 503


def raise_mcp_error(error: ForgeOSError) -> None:
    """Convert a ForgeOS domain error into an ``McpError``.

    Parameters
    ----------
    error : ForgeOSError
        Domain error to convert.

    Raises
    ------
    McpError
        MCP-protocol-compliant error with code, message, and optional data.
    """
    raise McpError(
        ErrorData(
            code=error.error_code,
            message=error.message,
            data=error.details if error.details else None,
        )
    )


def tool_error_response(message: str) -> list[TextContent]:
    """Build an ``isError=True`` tool response content list.

    Use this for *expected* operational failures that are not protocol
    errors (e.g. "ticket already claimed") where the tool should return
    a result rather than raising.

    Parameters
    ----------
    message : str
        Human-readable error description.

    Returns
    -------
    list[TextContent]
        Single-item list suitable for ``CallToolResult.content``.
    """
    return [TextContent(type="text", text=message)]


# ---------------------------------------------------------------------------
# Server instance
# ---------------------------------------------------------------------------

mcp_server = FastMCP(
    name=__app_name__,
    lifespan=_app_lifespan,
    host="0.0.0.0",
    port=8080,
    stateless_http=True,
    json_response=True,
)
"""The singleton FastMCP server instance.

Capabilities are negotiated automatically during the MCP ``initialize``
handshake. The server currently advertises:

* **tools** — ticket lifecycle operations (to be registered in tool modules).

Tools are registered via ``@mcp_server.tool()`` decorators in dedicated
tool modules (e.g. ``mcp_server.tools.tickets_next``).
"""


# ---------------------------------------------------------------------------
# Health-check tool — verifies server + DB connectivity
# ---------------------------------------------------------------------------


@mcp_server.tool()
async def health_check(ctx: Any = None) -> dict[str, Any]:
    """Return health status of the ForgeOS MCP server.

    Checks server liveness, database connectivity, pool saturation,
    and uptime.  Uses the :class:`HealthChecker` instance from the
    application lifespan context when available.
    """
    # Attempt to use the HealthChecker from the app context.
    if ctx is not None and hasattr(ctx, "request_context"):
        app_ctx = ctx.request_context.lifespan_context
        if hasattr(app_ctx, "health_checker") and app_ctx.health_checker is not None:
            return await app_ctx.health_checker.health_check()

    # Fallback: basic liveness response when no context is available.
    return {
        "status": "healthy",
        "server": "ok",
        "version": __version__,
        "database": {"status": "not_configured"},
    }


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """Start the ForgeOS MCP server with the configured transport.

    Reads configuration from environment variables (``FORGEOS_*`` prefix)
    and CLI arguments.  The ``--transport`` flag overrides the env var.

    Supported transports:

    * ``streamable-http`` (default) — HTTP-based remote transport.
    * ``stdio`` — stdin/stdout pipes for local agent processes.
    * ``sse`` — legacy Server-Sent Events transport.
    """
    import argparse

    from mcp_server.transport import parse_transport
    from mcp_server.transport.stdio import run_stdio

    parser = argparse.ArgumentParser(description="ForgeOS MCP Server")
    parser.add_argument(
        "--transport",
        choices=["stdio", "streamable-http", "sse"],
        default=None,
        help="MCP transport type (overrides FORGEOS_TRANSPORT env var)",
    )
    args = parser.parse_args()

    config = ServerConfig()
    _configure_logging(config.log_level)

    # CLI arg takes precedence over env var
    transport = parse_transport(args.transport or config.transport)

    # Override FastMCP settings from validated config / env vars
    mcp_server.settings.host = config.host
    mcp_server.settings.port = config.port

    logger.info(
        "Launching %s MCP server v%s — transport=%s, host=%s, port=%d",
        __app_name__,
        __version__,
        transport,
        config.host,
        config.port,
    )

    if transport == "stdio":
        import asyncio

        asyncio.run(run_stdio(mcp_server))
    else:
        mcp_server.run(transport=transport)
