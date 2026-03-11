"""ForgeOS migration package — dual-mode ticket operations wrapper.

Provides a unified interface that routes ticket lifecycle operations
(claim, advance, release, rework, sync, validate, status) to either
the MCP server or the file-based ``tickets.py`` CLI, depending on the
``FORGEOS_MODE`` environment variable.

Quick start::

    from mcp_server.migration import DualModeWrapper

    wrapper = DualModeWrapper.from_config()
    result = await wrapper.sync()
    print(result.mode_used)  # "file" or "mcp"
"""

from mcp_server.migration.config import DualModeConfig, OperationMode
from mcp_server.migration.dual_mode import (
    DualModeWrapper,
    FileMode,
    McpMode,
    OperationResult,
    TicketOperations,
)

__all__ = [
    "DualModeConfig",
    "DualModeWrapper",
    "FileMode",
    "McpMode",
    "OperationMode",
    "OperationResult",
    "TicketOperations",
]
