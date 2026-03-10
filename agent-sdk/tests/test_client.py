"""Tests for forgeos_sdk.client module."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.config import TransportType
from forgeos_sdk.exceptions import ConfigurationError


class TestForgeOSClientInit:
    """Verify ForgeOSClient constructor behavior."""

    def test_basic_construction(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="Backend",
            transport_type="streamable-http",
        )
        assert client.server_url == "http://localhost:8080/mcp"
        assert client.agent_id == "Backend"
        assert client.transport_type == TransportType.STREAMABLE_HTTP

    def test_sse_transport(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="QA",
            transport_type="sse",
        )
        assert client.transport_type == TransportType.SSE

    def test_stdio_transport(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="Frontend",
            transport_type="stdio",
        )
        assert client.transport_type == TransportType.STDIO

    def test_default_transport_is_streamable_http(self) -> None:
        client = ForgeOSClient(
            server_url="http://localhost:8080/mcp",
            agent_id="test",
        )
        assert client.transport_type == TransportType.STREAMABLE_HTTP

    def test_empty_server_url_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="server_url must not be empty"):
            ForgeOSClient(server_url="", agent_id="test")

    def test_empty_agent_id_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="agent_id must not be empty"):
            ForgeOSClient(server_url="http://localhost:8080/mcp", agent_id="")

    def test_invalid_transport_raises(self) -> None:
        with pytest.raises(ConfigurationError, match="Invalid transport_type"):
            ForgeOSClient(
                server_url="http://localhost:8080/mcp",
                agent_id="test",
                transport_type="websocket",
            )

    def test_invalid_transport_shows_valid_options(self) -> None:
        with pytest.raises(ConfigurationError, match="streamable-http"):
            ForgeOSClient(
                server_url="http://localhost:8080/mcp",
                agent_id="test",
                transport_type="grpc",
            )


class TestForgeOSClientFromEnv:
    """Verify ForgeOSClient.from_env() factory."""

    def test_from_env_defaults(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env()
        assert client.server_url == "http://localhost:8080/mcp"
        assert client.agent_id == "unknown-agent"
        assert client.transport_type == TransportType.STREAMABLE_HTTP

    def test_from_env_reads_variables(self) -> None:
        env = {
            "FORGEOS_SERVER_URL": "http://prod:9090/mcp",
            "FORGEOS_AGENT_ID": "Security",
            "FORGEOS_TRANSPORT": "sse",
        }
        with patch.dict(os.environ, env, clear=True):
            client = ForgeOSClient.from_env()
        assert client.server_url == "http://prod:9090/mcp"
        assert client.agent_id == "Security"
        assert client.transport_type == TransportType.SSE

    def test_from_env_with_overrides(self) -> None:
        env = {
            "FORGEOS_SERVER_URL": "http://prod:9090/mcp",
            "FORGEOS_AGENT_ID": "Backend",
        }
        with patch.dict(os.environ, env, clear=True):
            client = ForgeOSClient.from_env(overrides={"agent_id": "QA"})
        assert client.agent_id == "QA"
        assert client.server_url == "http://prod:9090/mcp"

    def test_from_env_override_server_url(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env(
                overrides={"server_url": "http://custom:3000/mcp"}
            )
        assert client.server_url == "http://custom:3000/mcp"

    def test_from_env_override_transport(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env(overrides={"transport": "stdio"})
        assert client.transport_type == TransportType.STDIO

    def test_from_env_none_overrides(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            client = ForgeOSClient.from_env(overrides=None)
        assert client.server_url == "http://localhost:8080/mcp"


class TestForgeOSClientProperties:
    """Verify client properties are read-only accessors."""

    def test_server_url_property(self) -> None:
        client = ForgeOSClient(
            server_url="http://test:8080/mcp",
            agent_id="test",
        )
        assert client.server_url == "http://test:8080/mcp"

    def test_agent_id_property(self) -> None:
        client = ForgeOSClient(
            server_url="http://test:8080/mcp",
            agent_id="my-agent",
        )
        assert client.agent_id == "my-agent"

    def test_transport_type_property(self) -> None:
        client = ForgeOSClient(
            server_url="http://test:8080/mcp",
            agent_id="test",
            transport_type="sse",
        )
        assert client.transport_type == TransportType.SSE


class TestForgeOSClientPublicAPI:
    """Verify public API exports from __init__.py."""

    def test_import_from_package(self) -> None:
        from forgeos_sdk import ForgeOSClient as Client
        assert Client is ForgeOSClient

    def test_import_exceptions(self) -> None:
        from forgeos_sdk import (
            AuthenticationError,
            ConfigurationError,
            ConnectionError,
            ForgeOSError,
            ToolCallError,
        )
        assert issubclass(ConfigurationError, ForgeOSError)
        assert issubclass(ConnectionError, ForgeOSError)
        assert issubclass(AuthenticationError, ForgeOSError)
        assert issubclass(ToolCallError, ForgeOSError)

    def test_import_config_types(self) -> None:
        from forgeos_sdk import SDKConfig, TransportType
        assert SDKConfig is not None
        assert TransportType.SSE.value == "sse"

    def test_version_available(self) -> None:
        import forgeos_sdk
        assert hasattr(forgeos_sdk, "__version__")
        assert forgeos_sdk.__version__ == "0.1.0"
