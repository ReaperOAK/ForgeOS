"""JSON Schema validation for MCP tool input parameters.

This module validates tool input arguments against a tool's registered
JSON Schema *before* the handler is invoked.  Validation errors produce
structured error responses following MCP error semantics (``INVALID_PARAMS``
/ ``-32602``), including the specific field path and failure reason.

Acceptance Criteria (FORGEOS-BE021)
------------------------------------
1. Tool inputs are validated against the registered JSON Schema before
   handler invocation.
2. Validation errors include the specific field path and failure reason.
3. Error responses follow MCP protocol error format with INVALID_PARAMS
   code.
4. Type coercion is NOT performed; inputs must match schema types exactly.
5. Missing required fields produce a clear error listing all missing
   fields.
6. Validation performance is acceptable (< 1 ms for typical tool inputs).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from jsonschema import Draft202012Validator, ValidationError

logger = logging.getLogger("forgeos.tools.validation")

INVALID_PARAMS = -32602


@dataclass(frozen=True, slots=True)
class FieldError:
    """A single validation failure for a specific schema path."""

    path: str
    message: str


class ToolInputValidationError(Exception):
    """Raised when tool input fails JSON Schema validation."""

    def __init__(
        self,
        tool_name: str,
        field_errors: list[FieldError],
    ) -> None:
        self.tool_name = tool_name
        self.field_errors = list(field_errors)
        summary = "; ".join(f"{e.path}: {e.message}" for e in self.field_errors)
        super().__init__(
            f"Validation failed for tool '{tool_name}': {summary}"
        )


def _format_path(path_deque: Any) -> str:
    """Convert a jsonschema error's ``absolute_path`` deque to a dotted string.

    The *path_deque* parameter is typed as :data:`~typing.Any` because
    ``jsonschema.ValidationError.absolute_path`` is a :class:`~collections.deque`
    whose elements are untyped in the library's own type stubs.

    Examples:
        >>> _format_path(deque([]))
        '$'
        >>> _format_path(deque(['ticket_id']))
        '$.ticket_id'
        >>> _format_path(deque(['nested', 0, 'name']))
        '$.nested[0].name'
    """
    parts: list[str] = ["$"]
    for segment in path_deque:
        if isinstance(segment, int):
            parts.append(f"[{segment}]")
        else:
            parts.append(f".{segment}")
    return "".join(parts)


_validator_cache: dict[str, Draft202012Validator] = {}


def compile_validator(
    tool_name: str,
    schema: dict[str, Any],
) -> Draft202012Validator:
    """Compile and cache a JSON Schema validator for a tool.

    Args:
        tool_name: Unique tool identifier used as the cache key.
        schema: JSON Schema (Draft 2020-12) to compile.

    Returns:
        A compiled :class:`Draft202012Validator` instance (cached on
        subsequent calls with the same *tool_name*).

    Raises:
        jsonschema.SchemaError: If *schema* is not a valid JSON Schema.
    """
    if tool_name in _validator_cache:
        return _validator_cache[tool_name]

    Draft202012Validator.check_schema(schema)

    validator = Draft202012Validator(schema)
    _validator_cache[tool_name] = validator
    logger.info("Compiled JSON Schema validator for tool: %s", tool_name)
    return validator


def clear_validator_cache() -> None:
    """Remove all cached validators.  Intended for testing."""
    _validator_cache.clear()


def validate_tool_input(
    tool_name: str,
    schema: dict[str, Any],
    params: dict[str, Any],
) -> None:
    """Validate params against the tool's JSON Schema.

    All validation errors are collected so the caller receives a complete
    picture in a single response.

    Raises ToolInputValidationError if one or more failures are detected.
    """
    validator = compile_validator(tool_name, schema)

    raw_errors: list[ValidationError] = sorted(
        validator.iter_errors(params),  # type: ignore[reportUnknownMemberType]
        key=lambda e: list(e.absolute_path),
    )
    errors: list[FieldError] = []
    for error in raw_errors:
        path = _format_path(error.absolute_path)
        errors.append(FieldError(path=path, message=error.message))

    if errors:
        logger.warning(
            "Input validation failed for tool '%s': %d error(s)",
            tool_name,
            len(errors),
        )
        raise ToolInputValidationError(tool_name=tool_name, field_errors=errors)


@dataclass(frozen=True, slots=True)
class McpValidationErrorData:
    """Structured data payload for MCP INVALID_PARAMS error responses."""

    tool_name: str
    errors: list[dict[str, str]] = field(default_factory=list)  # type: ignore[reportUnknownVariableType]

    def to_dict(self) -> dict[str, Any]:
        """Serialise to a plain dict suitable for MCP ErrorData.data."""
        return {
            "tool_name": self.tool_name,
            "errors": self.errors,
        }


def build_validation_error_data(
    exc: ToolInputValidationError,
) -> dict[str, Any]:
    """Convert a :exc:`ToolInputValidationError` into structured MCP error data.

    Returns a dict suitable for the ``data`` field of a JSON-RPC error
    response with code :data:`INVALID_PARAMS` (``-32602``).

    The returned dict has the shape::

        {
            "tool_name": "tickets.claim",
            "errors": [
                {"path": "$.ticket_id", "message": "..."},
            ]
        }
    """
    return McpValidationErrorData(
        tool_name=exc.tool_name,
        errors=[{"path": e.path, "message": e.message} for e in exc.field_errors],
    ).to_dict()
