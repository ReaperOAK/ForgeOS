"""Dual-mode migration configuration.

Provides :class:`DualModeConfig` — a pydantic-settings model that reads
the ``FORGEOS_MODE`` environment variable to choose between MCP-backed
and file-based (``tickets.py``) ticket operations.

Environment variables
---------------------
``FORGEOS_MODE``
    ``"mcp"`` or ``"file"`` (default: ``"file"``).
``FORGEOS_MCP_SERVER_URL``
    Base URL of the MCP server (default: ``"http://localhost:8080"``).
``FORGEOS_TICKETS_PY_PATH``
    Path to the ``tickets.py`` CLI script (default: ``".github/tickets.py"``).
``FORGEOS_FALLBACK_ENABLED``
    Whether to fall back to file mode on MCP failure (default: ``True``).
``FORGEOS_OPERATION_TIMEOUT``
    Timeout in seconds for individual operations (default: ``30``).
"""

from __future__ import annotations

from enum import Enum

from pydantic import Field
from pydantic_settings import BaseSettings


class OperationMode(str, Enum):
    """Supported operation modes for the dual-mode wrapper."""

    MCP = "mcp"
    FILE = "file"


class DualModeConfig(BaseSettings):
    """Configuration for the dual-mode ticket operations wrapper.

    Loaded automatically from ``FORGEOS_*`` environment variables via
    pydantic-settings.
    """

    model_config = {"env_prefix": "FORGEOS_"}

    mode: OperationMode = Field(
        default=OperationMode.FILE,
        description="Operation mode: 'mcp' routes to the MCP server, 'file' uses tickets.py.",
    )
    mcp_server_url: str = Field(
        default="http://localhost:8080",
        description="Base URL of the ForgeOS MCP server.",
    )
    tickets_py_path: str = Field(
        default=".github/tickets.py",
        description="Path to the tickets.py CLI script.",
    )
    fallback_enabled: bool = Field(
        default=True,
        description="Automatically fall back to file mode when the MCP server is unreachable.",
    )
    operation_timeout: int = Field(
        default=30,
        description="Timeout in seconds for a single ticket operation.",
    )

    @property
    def is_mcp_mode(self) -> bool:
        """Return ``True`` when configured for MCP mode."""
        return self.mode is OperationMode.MCP

    @property
    def is_file_mode(self) -> bool:
        """Return ``True`` when configured for file mode."""
        return self.mode is OperationMode.FILE
