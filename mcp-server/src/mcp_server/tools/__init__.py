"""Dynamic tool registration for the ForgeOS MCP Server.

Public API
----------
- :class:`ToolRegistry` — register, discover, and look up MCP tools at runtime.
- :class:`ToolDefinition` — immutable descriptor for a single registered tool.
- :class:`ToolHandler` — protocol for async tool handler callables.
- :exc:`DuplicateToolError` — raised on duplicate name registration.
- :exc:`ToolNotFoundError` — raised by strict lookups on missing names.
"""

from __future__ import annotations

from mcp_server.tools.registry import (
    DuplicateToolError,
    ToolDefinition,
    ToolHandler,
    ToolNotFoundError,
    ToolRegistry,
)

__all__ = [
    "DuplicateToolError",
    "ToolDefinition",
    "ToolHandler",
    "ToolNotFoundError",
    "ToolRegistry",
]
