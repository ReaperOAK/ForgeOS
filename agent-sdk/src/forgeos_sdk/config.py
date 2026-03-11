"""SDK configuration with environment variable loading.

Configuration is loaded from environment variables with the ``FORGEOS_`` prefix
using pydantic-settings.
"""

from __future__ import annotations

from enum import Enum

from pydantic import field_validator
from pydantic_settings import BaseSettings


class TransportType(str, Enum):
    """Supported MCP transport types."""

    STREAMABLE_HTTP = "streamable-http"
    SSE = "sse"
    STDIO = "stdio"


class OperationMode(str, Enum):
    """SDK operation mode controlling MCP vs filesystem fallback.

    - ``MCP``: Always use MCP server; fail if unreachable.
    - ``FILESYSTEM``: Always use filesystem fallback via ``tickets.py``.
    - ``AUTO``: Try MCP first, fall back to filesystem on connection failure.
    """

    MCP = "mcp"
    FILESYSTEM = "filesystem"
    AUTO = "auto"


class SDKConfig(BaseSettings):
    """ForgeOS Agent SDK configuration.

    All fields map to ``FORGEOS_`` prefixed environment variables:

    - ``FORGEOS_SERVER_URL`` — MCP server URL (default: ``http://localhost:8080/mcp``)
    - ``FORGEOS_AGENT_ID`` — Agent identifier (default: ``unknown-agent``)
    - ``FORGEOS_TRANSPORT`` — Transport type (default: ``streamable-http``)
    - ``FORGEOS_API_KEY`` — API key for authentication (optional)
    - ``FORGEOS_MODE`` — Operation mode: ``mcp``, ``filesystem``, or ``auto`` (default)
    """

    model_config = {"env_prefix": "FORGEOS_"}

    server_url: str = "http://localhost:8080/mcp"
    agent_id: str = "unknown-agent"
    transport: TransportType = TransportType.STREAMABLE_HTTP
    api_key: str | None = None
    mode: OperationMode = OperationMode.AUTO

    @field_validator("server_url", "agent_id")
    @classmethod
    def _must_not_be_blank(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("must not be empty or blank")
        return v

    @field_validator("api_key")
    @classmethod
    def _api_key_not_blank(cls, v: str | None) -> str | None:
        if v is not None and not v.strip():
            raise ValueError("api_key must not be empty or blank when provided")
        return v
