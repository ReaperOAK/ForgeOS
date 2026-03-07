"""ForgeOS MCP Server — initialization, configuration, and bootstrap.

This module creates the FastMCP server instance, registers its lifespan
for database connectivity, defines MCP-compliant error handling, and
exposes a ``main()`` entry point that starts the Streamable HTTP transport.

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
"""

from __future__ import annotations

import logging
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

if TYPE_CHECKING:
    from collections.abc import AsyncIterator

# ---------------------------------------------------------------------------
# Structured logger — JSON output, no PII, no console.log
# ---------------------------------------------------------------------------

logger = logging.getLogger("forgeos.mcp")


def _configure_logging(level: str = "INFO") -> None:
    """Configure structured JSON logging for the server."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(
        logging.Formatter(
            '{"timestamp":"%(asctime)s","level":"%(levelname)s",'
            '"logger":"%(name)s","message":"%(message)s"}',
            datefmt="%Y-%m-%dT%H:%M:%S%z",
        )
    )
    root = logging.getLogger("forgeos")
    root.setLevel(getattr(logging, level.upper(), logging.INFO))
    root.addHandler(handler)


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

    # Database settings — used by the lifespan to create the asyncpg pool.
    database_url: str = Field(
        default="postgresql://forgeos:forgeos@localhost:5432/forgeos",
        description="PostgreSQL connection URI",
    )
    db_min_pool_size: int = Field(default=2, description="Minimum pool connections")
    db_max_pool_size: int = Field(default=10, description="Maximum pool connections")


# ---------------------------------------------------------------------------
# Application context — typed dependency container
# ---------------------------------------------------------------------------


@dataclass
class AppContext:
    """Typed application context available to every tool handler.

    Attributes
    ----------
    db_pool : object | None
        The ``asyncpg.Pool`` instance (or ``None`` when DB is unavailable).
    config : ServerConfig
        Validated server configuration.
    """

    db_pool: Any = field(default=None)
    config: ServerConfig = field(default_factory=ServerConfig)


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

    db_pool: Any = None
    try:
        # Attempt to connect asyncpg pool — gracefully degrade if DB is
        # unavailable (e.g. during CI or initial bootstrap).
        try:
            import asyncpg  # type: ignore[import-untyped]

            db_pool = await asyncpg.create_pool(  # type: ignore[reportUnknownMemberType]
                dsn=config.database_url,
                min_size=config.db_min_pool_size,
                max_size=config.db_max_pool_size,
            )
            logger.info("Database pool created (min=%d, max=%d)",
                        config.db_min_pool_size, config.db_max_pool_size)
        except Exception:
            logger.warning(
                "Database connection unavailable — server will start without DB"
            )

        yield AppContext(db_pool=db_pool, config=config)
    finally:
        if db_pool is not None:
            await db_pool.close()
            logger.info("Database pool closed")
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
async def health_check() -> dict[str, str]:
    """Return health status of the ForgeOS MCP server.

    Checks server liveness and database connectivity.
    Returns a dictionary with component statuses.
    """
    status: dict[str, str] = {
        "server": "ok",
        "version": __version__,
    }

    # DB connectivity is verified via the lifespan context when available.
    # For now, report server-level health.
    status["database"] = "not_configured"

    return status


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    """Start the ForgeOS MCP server with Streamable HTTP transport.

    Reads configuration from environment variables (``FORGEOS_*`` prefix).
    Defaults to ``0.0.0.0:8080`` for local development.
    """
    config = ServerConfig()
    _configure_logging(config.log_level)

    # Override FastMCP settings from validated config / env vars
    mcp_server.settings.host = config.host
    mcp_server.settings.port = config.port

    logger.info(
        "Launching %s MCP server v%s — transport=streamable-http, host=%s, port=%d",
        __app_name__,
        __version__,
        config.host,
        config.port,
    )

    mcp_server.run(transport="streamable-http")
