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

Ticket Tools
~~~~~~~~~~~~
- :data:`TICKETS_NEXT_SCHEMA` — JSON Schema for tickets.next input.
- :func:`handle_tickets_next` — handler for the tickets.next tool.
- :func:`register_ticket_tools` — register ticket tools on a registry.
"""

from __future__ import annotations

from mcp_server.tools.registry import (
    DuplicateToolError,
    ToolDefinition,
    ToolHandler,
    ToolNotFoundError,
    ToolRegistry,
)
from mcp_server.tools.ticket_tools import (
    TICKETS_ADVANCE_SCHEMA,
    TICKETS_NEXT_SCHEMA,
    TICKETS_RELEASE_SCHEMA,
    TICKETS_STATUS_SCHEMA,
    TICKETS_SYNC_SCHEMA,
    TICKETS_VALIDATE_SCHEMA,
    handle_tickets_advance,
    handle_tickets_next,
    handle_tickets_release,
    handle_tickets_status,
    handle_tickets_sync,
    handle_tickets_validate,
    register_ticket_tools,
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
    "INVALID_PARAMS",
    "TICKETS_ADVANCE_SCHEMA",
    "TICKETS_NEXT_SCHEMA",
    "TICKETS_RELEASE_SCHEMA",
    "TICKETS_STATUS_SCHEMA",
    "TICKETS_SYNC_SCHEMA",
    "TICKETS_VALIDATE_SCHEMA",
    "DuplicateToolError",
    "FieldError",
    "McpValidationErrorData",
    "ToolDefinition",
    "ToolHandler",
    "ToolInputValidationError",
    "ToolNotFoundError",
    "ToolRegistry",
    "build_validation_error_data",
    "clear_validator_cache",
    "compile_validator",
    "handle_tickets_advance",
    "handle_tickets_next",
    "handle_tickets_release",
    "handle_tickets_status",
    "handle_tickets_sync",
    "handle_tickets_validate",
    "register_ticket_tools",
    "validate_tool_input",
]
