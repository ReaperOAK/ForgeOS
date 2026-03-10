"""Dynamic tool registration and input validation for the ForgeOS MCP Server.

Public API
----------
Registration
~~~~~~~~~~~~
- :class:`ToolRegistry` — register, discover, and look up MCP tools at runtime.
- :class:`ToolDefinition` — immutable descriptor for a single registered tool.
- :class:`ToolHandler` — protocol for async tool handler callables.
- :exc:`DuplicateToolError` — raised on duplicate name registration.
- :exc:`ToolNotFoundError` — raised by strict lookups on missing names.

Validation
~~~~~~~~~~
- :func:`validate_tool_input` — validate params against a tool's JSON Schema.
- :func:`compile_validator` — compile and cache a JSON Schema validator.
- :func:`build_validation_error_data` — convert validation errors to MCP format.
- :class:`FieldError` — single field-level validation failure.
- :exc:`ToolInputValidationError` — raised when tool input is invalid.
"""

from __future__ import annotations

from mcp_server.tools.registry import (
    DuplicateToolError,
    ToolDefinition,
    ToolHandler,
    ToolNotFoundError,
    ToolRegistry,
)
from mcp_server.tools.validation import (
    INVALID_PARAMS,
    FieldError,
    McpValidationErrorData,
    ToolInputValidationError,
    build_validation_error_data,
    clear_validator_cache,
    compile_validator,
    validate_tool_input,
)

__all__ = [
    # Registry
    "DuplicateToolError",
    "ToolDefinition",
    "ToolHandler",
    "ToolNotFoundError",
    "ToolRegistry",
    # Validation
    "FieldError",
    "INVALID_PARAMS",
    "McpValidationErrorData",
    "ToolInputValidationError",
    "build_validation_error_data",
    "clear_validator_cache",
    "compile_validator",
    "validate_tool_input",
]
