"""SDK configuration with environment variable loading.

Configuration is loaded from environment variables with the ``FORGEOS_`` prefix
using pydantic-settings.
"""

from enum import Enum

from pydantic_settings import BaseSettings


class TransportType(str, Enum):
    """Supported MCP transport types."""

    STREAMABLE_HTTP = "streamable-http"
    SSE = "sse"
    STDIO = "stdio"


class SDKConfig(BaseSettings):
    """ForgeOS Agent SDK configuration.

    All fields map to ``FORGEOS_`` prefixed environment variables:

    - ``FORGEOS_SERVER_URL`` — MCP server URL (default: ``http://localhost:8080/mcp``)
    - ``FORGEOS_AGENT_ID`` — Agent identifier (default: ``unknown-agent``)
    - ``FORGEOS_TRANSPORT`` — Transport type (default: ``streamable-http``)
    """

    model_config = {"env_prefix": "FORGEOS_"}

    server_url: str = "http://localhost:8080/mcp"
    agent_id: str = "unknown-agent"
    transport: TransportType = TransportType.STREAMABLE_HTTP
