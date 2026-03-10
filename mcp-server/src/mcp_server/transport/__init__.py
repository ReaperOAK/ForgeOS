"""ForgeOS MCP Server - transport layer.

Provides pluggable transport implementations for the MCP server.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal


class TransportType(str, Enum):
    """Supported MCP transport types."""

    STDIO = "stdio"
    STREAMABLE_HTTP = "streamable-http"
    SSE = "sse"


TransportLiteral = Literal["stdio", "streamable-http", "sse"]
DEFAULT_TRANSPORT: TransportLiteral = "streamable-http"


def parse_transport(value: str) -> TransportLiteral:
    """Parse and validate a transport string."""
    normalised = value.strip().lower()
    try:
        return TransportType(normalised).value  # type: ignore[return-value]
    except ValueError:
        valid = ", ".join(t.value for t in TransportType)
        msg = f"Unknown transport: {value!r}. Valid transports: {valid}"
        raise ValueError(msg) from None


from mcp_server.transport.stdio import (
    StdioMessageReader,
    StdioMessageWriter,
    run_stdio,
    stdio_streams,
)

__all__ = [
    "DEFAULT_TRANSPORT",
    "StdioMessageReader",
    "StdioMessageWriter",
    "TransportLiteral",
    "TransportType",
    "parse_transport",
    "run_stdio",
    "stdio_streams",
]
