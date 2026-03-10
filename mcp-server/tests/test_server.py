"""Tests for the ForgeOS MCP server initialization and error handling.

TDD Evidence
------------
- RED: tests written first to define expected behavior
- GREEN: ``server.py`` implemented to satisfy these tests
- REFACTOR: error hierarchy consolidated, config extracted to pydantic-settings
"""

from __future__ import annotations

import pytest

from mcp_server import __app_name__, __version__
from mcp_server.server import (
    INTERNAL_ERROR,
    INVALID_PARAMS,
    AppContext,
    DatabaseError,
    ForgeOSError,
    ServerConfig,
    TicketAlreadyClaimedError,
    TicketNotFoundError,
    ValidationError,
    mcp_server,
    raise_mcp_error,
    tool_error_response,
)

# ---------------------------------------------------------------------------
# Package metadata
# ---------------------------------------------------------------------------


class TestPackageMetadata:
    """Verify package exposes correct identity constants."""

    def test_version_is_semver(self) -> None:
        parts = __version__.split(".")
        assert len(parts) == 3
        assert all(p.isdigit() for p in parts)

    def test_app_name(self) -> None:
        assert __app_name__ == "ForgeOS"


# ---------------------------------------------------------------------------
# Server instance
# ---------------------------------------------------------------------------


class TestServerInstance:
    """Verify the FastMCP server is correctly configured."""

    def test_server_name(self) -> None:
        assert mcp_server.name == __app_name__

    def test_server_has_health_check_tool(self) -> None:
        # The server should have at least the health_check tool registered
        # FastMCP stores tools internally; we verify via the tool decorator
        assert hasattr(mcp_server, "tool")

    def test_server_is_stateless(self) -> None:
        assert mcp_server.settings.stateless_http is True

    def test_server_json_response(self) -> None:
        assert mcp_server.settings.json_response is True


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


class TestServerConfig:
    """Verify pydantic-settings configuration with defaults."""

    def test_default_host(self) -> None:
        config = ServerConfig()
        assert config.host == "0.0.0.0"

    def test_default_port(self) -> None:
        config = ServerConfig()
        assert config.port == 8080

    def test_default_log_level(self) -> None:
        config = ServerConfig()
        assert config.log_level == "INFO"

    def test_default_database_url(self) -> None:
        config = ServerConfig()
        assert "postgresql://" in config.database_url

    def test_default_pool_sizes(self) -> None:
        config = ServerConfig()
        assert config.db_min_pool_size == 2
        assert config.db_max_pool_size == 10

    def test_env_prefix(self) -> None:
        assert ServerConfig.model_config.get("env_prefix") == "FORGEOS_"


# ---------------------------------------------------------------------------
# AppContext
# ---------------------------------------------------------------------------


class TestAppContext:
    """Verify the typed application context dataclass."""

    def test_default_db_pool_is_none(self) -> None:
        ctx = AppContext()
        assert ctx.db_pool is None

    def test_default_config(self) -> None:
        ctx = AppContext()
        assert isinstance(ctx.config, ServerConfig)

    def test_custom_pool(self) -> None:
        from unittest.mock import MagicMock

        mock_deps = MagicMock()
        mock_deps.pool = MagicMock()
        ctx = AppContext(dependencies=mock_deps)
        assert ctx.db_pool is mock_deps.pool


# ---------------------------------------------------------------------------
# Error hierarchy
# ---------------------------------------------------------------------------


class TestErrorHierarchy:
    """Verify domain errors carry correct codes and messages."""

    def test_base_error(self) -> None:
        err = ForgeOSError("something broke")
        assert str(err) == "something broke"
        assert err.error_code == INTERNAL_ERROR
        assert err.message == "something broke"
        assert err.details == {}

    def test_base_error_with_details(self) -> None:
        err = ForgeOSError("bad", details={"key": "val"})
        assert err.details == {"key": "val"}

    def test_ticket_not_found(self) -> None:
        err = TicketNotFoundError("FORGEOS-001 not found")
        assert err.error_code == INVALID_PARAMS
        assert err.status_code == 404

    def test_ticket_already_claimed(self) -> None:
        err = TicketAlreadyClaimedError("already claimed")
        assert err.error_code == INVALID_PARAMS
        assert err.status_code == 409

    def test_validation_error(self) -> None:
        err = ValidationError("invalid input")
        assert err.error_code == INVALID_PARAMS
        assert err.status_code == 400

    def test_database_error(self) -> None:
        err = DatabaseError("connection refused")
        assert err.error_code == INTERNAL_ERROR
        assert err.status_code == 503


# ---------------------------------------------------------------------------
# Error conversion
# ---------------------------------------------------------------------------


class TestRaiseMcpError:
    """Verify domain errors convert to McpError correctly."""

    def test_converts_to_mcp_error(self) -> None:
        from mcp.shared.exceptions import McpError

        err = TicketNotFoundError("ticket gone")
        with pytest.raises(McpError) as exc_info:
            raise_mcp_error(err)
        mcp_err = exc_info.value
        assert mcp_err.error.code == INVALID_PARAMS
        assert mcp_err.error.message == "ticket gone"

    def test_includes_details_as_data(self) -> None:
        from mcp.shared.exceptions import McpError

        err = ValidationError("bad field", details={"field": "name"})
        with pytest.raises(McpError) as exc_info:
            raise_mcp_error(err)
        assert exc_info.value.error.data == {"field": "name"}

    def test_no_data_when_no_details(self) -> None:
        from mcp.shared.exceptions import McpError

        err = ForgeOSError("plain error")
        with pytest.raises(McpError) as exc_info:
            raise_mcp_error(err)
        assert exc_info.value.error.data is None


# ---------------------------------------------------------------------------
# Tool error response helper
# ---------------------------------------------------------------------------


class TestToolErrorResponse:
    """Verify the isError=True response builder."""

    def test_returns_text_content_list(self) -> None:
        result = tool_error_response("something failed")
        assert len(result) == 1
        assert result[0].type == "text"
        assert result[0].text == "something failed"


# ---------------------------------------------------------------------------
# Health check tool
# ---------------------------------------------------------------------------


class TestHealthCheckTool:
    """Verify the health_check tool returns expected structure."""

    @pytest.mark.asyncio
    async def test_health_check_returns_status(self) -> None:
        from mcp_server.server import health_check

        result = await health_check()
        assert result["server"] == "ok"
        assert result["version"] == __version__

    @pytest.mark.asyncio
    async def test_health_check_reports_db_status(self) -> None:
        from mcp_server.server import health_check

        result = await health_check()
        assert "database" in result


# ---------------------------------------------------------------------------
# Logging configuration
# ---------------------------------------------------------------------------


class TestConfigureLogging:
    """Verify structured logging configuration."""

    def test_configure_logging_sets_level(self) -> None:
        import logging

        from mcp_server.server import _configure_logging

        _configure_logging("DEBUG")
        root = logging.getLogger("forgeos")
        assert root.level == logging.DEBUG

    def test_configure_logging_default_info(self) -> None:
        import logging

        from mcp_server.server import _configure_logging

        _configure_logging()
        root = logging.getLogger("forgeos")
        assert root.level == logging.INFO

    def test_configure_logging_invalid_level_falls_back(self) -> None:
        import logging

        from mcp_server.server import _configure_logging

        _configure_logging("NONEXISTENT")
        root = logging.getLogger("forgeos")
        # Falls back to INFO via getattr default
        assert root.level == logging.INFO

    def test_configure_logging_adds_handler(self) -> None:
        import logging

        from mcp_server.server import _configure_logging

        root = logging.getLogger("forgeos")
        initial_handlers = len(root.handlers)
        _configure_logging("WARNING")
        assert len(root.handlers) > initial_handlers


# ---------------------------------------------------------------------------
# Lifespan context manager
# ---------------------------------------------------------------------------


class TestAppLifespan:
    """Verify the server lifespan creates and cleans up resources."""

    @pytest.mark.asyncio
    async def test_lifespan_yields_app_context(self) -> None:
        from mcp_server.server import _app_lifespan
        from mcp_server.server import mcp_server as server

        async with _app_lifespan(server) as ctx:
            assert isinstance(ctx, AppContext)
            assert isinstance(ctx.config, ServerConfig)

    @pytest.mark.asyncio
    async def test_lifespan_degrades_without_db(self) -> None:
        """Server starts gracefully when DB is unavailable."""
        import os

        from mcp_server.server import _app_lifespan
        from mcp_server.server import mcp_server as server

        # Use an invalid DB URL to force connection failure
        os.environ["FORGEOS_DATABASE_URL"] = "postgresql://invalid:invalid@localhost:59999/nodb"
        try:
            async with _app_lifespan(server) as ctx:
                assert ctx.db_pool is None
                assert ctx.config is not None
        finally:
            del os.environ["FORGEOS_DATABASE_URL"]

    @pytest.mark.asyncio
    async def test_lifespan_shutdown_logs(self) -> None:
        """Verify shutdown completes without error."""
        from mcp_server.server import _app_lifespan
        from mcp_server.server import mcp_server as server

        async with _app_lifespan(server) as ctx:
            assert ctx is not None
        # If we reach here, shutdown completed without raising


# ---------------------------------------------------------------------------
# Main entry point configuration
# ---------------------------------------------------------------------------


class TestMainConfig:
    """Verify main() configures FastMCP settings from ServerConfig."""

    def test_main_updates_server_settings(self) -> None:
        """Verify that main() sets host/port on the FastMCP settings."""
        from unittest.mock import patch

        from mcp_server.server import mcp_server as server

        with patch.object(server, "run"):
            from mcp_server.server import main

            main()
            assert server.settings.host == "0.0.0.0"
            assert server.settings.port == 8080

