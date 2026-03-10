"""Tests for forgeos_sdk.config module."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from pydantic import ValidationError

from forgeos_sdk.config import SDKConfig, TransportType


class TestTransportType:
    """Verify TransportType enum values."""

    def test_streamable_http_value(self) -> None:
        assert TransportType.STREAMABLE_HTTP.value == "streamable-http"

    def test_sse_value(self) -> None:
        assert TransportType.SSE.value == "sse"

    def test_stdio_value(self) -> None:
        assert TransportType.STDIO.value == "stdio"

    def test_transport_type_is_str_enum(self) -> None:
        assert isinstance(TransportType.SSE, str)


class TestSDKConfigDefaults:
    """Verify SDKConfig default values."""

    def test_default_server_url(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.server_url == "http://localhost:8080/mcp"

    def test_default_agent_id(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.agent_id == "unknown-agent"

    def test_default_transport(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.transport == TransportType.STREAMABLE_HTTP

    def test_default_api_key_is_none(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.api_key is None


class TestSDKConfigFromEnv:
    """Verify SDKConfig reads from environment variables."""

    def test_server_url_from_env(self) -> None:
        env = {"FORGEOS_SERVER_URL": "http://prod:9090/mcp"}
        with patch.dict(os.environ, env, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.server_url == "http://prod:9090/mcp"

    def test_agent_id_from_env(self) -> None:
        env = {"FORGEOS_AGENT_ID": "Backend"}
        with patch.dict(os.environ, env, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.agent_id == "Backend"

    def test_transport_from_env(self) -> None:
        env = {"FORGEOS_TRANSPORT": "sse"}
        with patch.dict(os.environ, env, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.transport == TransportType.SSE

    def test_stdio_transport_from_env(self) -> None:
        env = {"FORGEOS_TRANSPORT": "stdio"}
        with patch.dict(os.environ, env, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.transport == TransportType.STDIO

    def test_api_key_from_env(self) -> None:
        env = {"FORGEOS_API_KEY": "secret-key-123"}
        with patch.dict(os.environ, env, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.api_key == "secret-key-123"

    def test_all_env_vars_together(self) -> None:
        env = {
            "FORGEOS_SERVER_URL": "http://custom:3000/mcp",
            "FORGEOS_AGENT_ID": "QA",
            "FORGEOS_TRANSPORT": "streamable-http",
            "FORGEOS_API_KEY": "my-api-key",
        }
        with patch.dict(os.environ, env, clear=True):
            config = SDKConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert config.server_url == "http://custom:3000/mcp"
        assert config.agent_id == "QA"
        assert config.transport == TransportType.STREAMABLE_HTTP
        assert config.api_key == "my-api-key"


class TestSDKConfigValidation:
    """Verify SDKConfig rejects invalid configurations."""

    def test_empty_server_url_rejected(self) -> None:
        with pytest.raises(ValidationError, match="server_url"):
            SDKConfig(
                server_url="",
                _env_file=None,  # type: ignore[call-arg]
            )

    def test_whitespace_server_url_rejected(self) -> None:
        with pytest.raises(ValidationError, match="server_url"):
            SDKConfig(
                server_url="   ",
                _env_file=None,  # type: ignore[call-arg]
            )

    def test_empty_agent_id_rejected(self) -> None:
        with pytest.raises(ValidationError, match="agent_id"):
            SDKConfig(
                agent_id="",
                _env_file=None,  # type: ignore[call-arg]
            )

    def test_whitespace_agent_id_rejected(self) -> None:
        with pytest.raises(ValidationError, match="agent_id"):
            SDKConfig(
                agent_id="   ",
                _env_file=None,  # type: ignore[call-arg]
            )

    def test_invalid_transport_rejected(self) -> None:
        with pytest.raises(ValidationError):
            SDKConfig(
                transport="grpc",  # type: ignore[arg-type]
                _env_file=None,  # type: ignore[call-arg]
            )

    def test_empty_api_key_rejected(self) -> None:
        with pytest.raises(ValidationError, match="api_key"):
            SDKConfig(
                api_key="",
                _env_file=None,  # type: ignore[call-arg]
            )

    def test_whitespace_api_key_rejected(self) -> None:
        with pytest.raises(ValidationError, match="api_key"):
            SDKConfig(
                api_key="   ",
                _env_file=None,  # type: ignore[call-arg]
            )


class TestSDKConfigEnvPrefix:
    """Verify the FORGEOS_ prefix is used."""

    def test_env_prefix_is_forgeos(self) -> None:
        assert SDKConfig.model_config["env_prefix"] == "FORGEOS_"
