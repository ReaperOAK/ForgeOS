"""ForgeOS Agent SDK client.

The :class:`ForgeOSClient` is the primary entry point for agents to interact
with the ForgeOS MCP server.
"""

import logging
from typing import Optional

from forgeos_sdk.config import SDKConfig, TransportType
from forgeos_sdk.exceptions import ConfigurationError

logger = logging.getLogger("forgeos_sdk")


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
    """

    def __init__(
        self,
        server_url: str,
        agent_id: str,
        transport_type: str = "streamable-http",
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

        logger.info(
            "ForgeOSClient initialised",
            extra={
                "server_url": self._server_url,
                "agent_id": self._agent_id,
                "transport": self._transport_type.value,
            },
        )

    @classmethod
    def from_env(cls, overrides: Optional[dict[str, str]] = None) -> "ForgeOSClient":
        """Create a client from environment variables.

        Reads ``FORGEOS_SERVER_URL``, ``FORGEOS_AGENT_ID``, and
        ``FORGEOS_TRANSPORT`` from the environment with sensible defaults.

        Parameters:
            overrides: Optional dict to override specific config values.

        Returns:
            A configured :class:`ForgeOSClient` instance.
        """
        config = SDKConfig(_env_file=None)  # type: ignore[call-arg]

        server_url = config.server_url
        agent_id = config.agent_id
        transport = config.transport.value

        if overrides:
            server_url = overrides.get("server_url", server_url)
            agent_id = overrides.get("agent_id", agent_id)
            transport = overrides.get("transport", transport)

        return cls(
            server_url=server_url,
            agent_id=agent_id,
            transport_type=transport,
        )

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
