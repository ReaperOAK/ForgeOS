"""Tests for the Streamable HTTP transport layer — config, app factory, health.

TDD Evidence
------------
- RED: tests written to define expected HTTP transport behavior
- GREEN: http.py implemented to satisfy these tests
- REFACTOR: config extraction, health endpoint consolidation

Ticket: FORGEOS-BE017
"""

from __future__ import annotations

import pytest

from mcp_server.transport.http import (
    HTTPTransport,
    HTTPTransportConfig,
)


# ---------------------------------------------------------------------------
# HTTPTransportConfig
# ---------------------------------------------------------------------------


class TestHTTPTransportConfig:
    """Verify HTTP transport configuration with pydantic-settings."""

    def test_default_host(self) -> None:
        config = HTTPTransportConfig()
        assert config.host == "0.0.0.0"

    def test_default_port(self) -> None:
        config = HTTPTransportConfig()
        assert config.port == 8080

    def test_default_stateless(self) -> None:
        config = HTTPTransportConfig()
        assert config.stateless is True

    def test_default_json_response(self) -> None:
        config = HTTPTransportConfig()
        assert config.json_response is True

    def test_default_mount_path(self) -> None:
        config = HTTPTransportConfig()
        assert config.mount_path == "/mcp"

    def test_default_idle_timeout(self) -> None:
        config = HTTPTransportConfig()
        assert config.idle_timeout_seconds == 300

    def test_default_log_level(self) -> None:
        config = HTTPTransportConfig()
        assert config.log_level == "INFO"

    def test_env_prefix(self) -> None:
        assert HTTPTransportConfig.model_config.get("env_prefix") == "FORGEOS_HTTP_"

    def test_custom_config(self) -> None:
        config = HTTPTransportConfig(
            host="127.0.0.1",
            port=9090,
            stateless=False,
            json_response=False,
            mount_path="/api/mcp",
            idle_timeout_seconds=120,
        )
        assert config.host == "127.0.0.1"
        assert config.port == 9090
        assert config.stateless is False
        assert config.json_response is False
        assert config.mount_path == "/api/mcp"
        assert config.idle_timeout_seconds == 120


# ---------------------------------------------------------------------------
# HTTPTransport
# ---------------------------------------------------------------------------


class TestHTTPTransport:
    """Verify HTTP transport creation and app factory."""

    def test_creation_with_defaults(self) -> None:
        transport = HTTPTransport()
        assert transport.config.host == "0.0.0.0"
        assert transport.config.port == 8080
        assert transport.config.stateless is True

    def test_creation_with_custom_config(self) -> None:
        config = HTTPTransportConfig(host="127.0.0.1", port=9090, stateless=False)
        transport = HTTPTransport(config=config)
        assert transport.config.host == "127.0.0.1"
        assert transport.config.port == 9090
        assert transport.config.stateless is False

    def test_create_app_returns_starlette(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = HTTPTransport()
        app = transport.create_app(server)
        assert hasattr(app, "routes")

    def test_create_app_includes_health_route(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = HTTPTransport()
        app = transport.create_app(server)
        route_paths = [getattr(r, "path", None) for r in app.routes]
        assert "/health" in route_paths

    def test_create_app_includes_mcp_mount(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = HTTPTransport()
        app = transport.create_app(server)
        route_paths = [getattr(r, "path", None) for r in app.routes]
        assert "/mcp" in route_paths

    def test_create_app_custom_mount_path(self) -> None:
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        config = HTTPTransportConfig(mount_path="/api/v1/mcp")
        transport = HTTPTransport(config=config)
        app = transport.create_app(server)
        route_paths = [getattr(r, "path", None) for r in app.routes]
        assert "/api/v1/mcp" in route_paths

    def test_transport_status(self) -> None:
        transport = HTTPTransport()
        status = transport.status()
        assert status["transport"] == "streamable-http"
        assert status["stateless"] is True
        assert status["json_response"] is True
        assert status["mount_path"] == "/mcp"
        assert status["idle_timeout_seconds"] == 300

    def test_transport_status_stateful(self) -> None:
        config = HTTPTransportConfig(stateless=False)
        transport = HTTPTransport(config=config)
        status = transport.status()
        assert status["stateless"] is False


# ---------------------------------------------------------------------------
# Integration: health endpoint
# ---------------------------------------------------------------------------


class TestHTTPHealthEndpoint:
    """Verify the HTTP transport health endpoint."""

    @pytest.mark.asyncio
    async def test_health_returns_200(self) -> None:
        from starlette.testclient import TestClient
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        transport = HTTPTransport()
        app = transport.create_app(server)

        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert data["transport"] == "streamable-http"

    @pytest.mark.asyncio
    async def test_health_includes_config(self) -> None:
        from starlette.testclient import TestClient
        from mcp.server.fastmcp import FastMCP

        server = FastMCP(name="test-server")
        config = HTTPTransportConfig(stateless=False, mount_path="/custom")
        transport = HTTPTransport(config=config)
        app = transport.create_app(server)

        client = TestClient(app)
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["stateless"] is False
        assert data["mount_path"] == "/custom"
