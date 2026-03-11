"""Tests for mcp_server.migration.config — DualModeConfig and OperationMode."""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from mcp_server.migration.config import DualModeConfig, OperationMode


class TestOperationMode:
    """OperationMode enum behaviour."""

    def test_file_mode_value(self) -> None:
        assert OperationMode.FILE.value == "file"

    def test_mcp_mode_value(self) -> None:
        assert OperationMode.MCP.value == "mcp"

    def test_from_string_file(self) -> None:
        assert OperationMode("file") is OperationMode.FILE

    def test_from_string_mcp(self) -> None:
        assert OperationMode("mcp") is OperationMode.MCP

    def test_invalid_mode_raises(self) -> None:
        with pytest.raises(ValueError):
            OperationMode("invalid")


class TestDualModeConfig:
    """DualModeConfig loads from env and provides sensible defaults."""

    def test_defaults(self) -> None:
        with patch.dict(os.environ, {}, clear=True):
            cfg = DualModeConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert cfg.mode is OperationMode.FILE
        assert cfg.mcp_server_url == "http://localhost:8080"
        assert cfg.tickets_py_path == ".github/tickets.py"
        assert cfg.fallback_enabled is True
        assert cfg.operation_timeout == 30

    def test_mode_from_env(self) -> None:
        with patch.dict(os.environ, {"FORGEOS_MODE": "mcp"}, clear=True):
            cfg = DualModeConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert cfg.mode is OperationMode.MCP

    def test_mcp_server_url_from_env(self) -> None:
        env = {"FORGEOS_MCP_SERVER_URL": "http://remote:9090"}
        with patch.dict(os.environ, env, clear=True):
            cfg = DualModeConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert cfg.mcp_server_url == "http://remote:9090"

    def test_tickets_py_path_from_env(self) -> None:
        env = {"FORGEOS_TICKETS_PY_PATH": "/opt/tickets.py"}
        with patch.dict(os.environ, env, clear=True):
            cfg = DualModeConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert cfg.tickets_py_path == "/opt/tickets.py"

    def test_fallback_disabled_from_env(self) -> None:
        env = {"FORGEOS_FALLBACK_ENABLED": "false"}
        with patch.dict(os.environ, env, clear=True):
            cfg = DualModeConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert cfg.fallback_enabled is False

    def test_operation_timeout_from_env(self) -> None:
        env = {"FORGEOS_OPERATION_TIMEOUT": "60"}
        with patch.dict(os.environ, env, clear=True):
            cfg = DualModeConfig(
                _env_file=None,  # type: ignore[call-arg]
            )
        assert cfg.operation_timeout == 60

    def test_is_mcp_mode_property(self) -> None:
        cfg = DualModeConfig(mode=OperationMode.MCP)
        assert cfg.is_mcp_mode is True

    def test_is_file_mode_property(self) -> None:
        cfg = DualModeConfig(mode=OperationMode.FILE)
        assert cfg.is_file_mode is True
