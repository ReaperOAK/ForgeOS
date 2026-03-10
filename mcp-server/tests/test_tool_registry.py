"""Tests for mcp_server.tools.registry — Dynamic Tool Registration System.

Covers all six acceptance criteria for FORGEOS-BE020:
  AC1: ToolRegistry class allows registering tools with name, description,
       input schema, and handler.
  AC2: Registered tools are reported in the MCP server's tools/list response.
  AC3: Tool handlers are async functions accepting validated input parameters.
  AC4: Registry prevents duplicate tool name registration (raises error).
  AC5: Tool input schemas follow JSON Schema draft 2020-12 format.
  AC6: Registry provides a lookup method to resolve tool name to handler and
       schema.

TDD approach: RED (tests written first) -> GREEN (implementation) -> REFACTOR.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import MagicMock

import pytest

from mcp_server.tools.registry import (
    DuplicateToolError,
    ToolDefinition,
    ToolNotFoundError,
    ToolRegistry,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_schema(**overrides: Any) -> dict[str, Any]:
    """Return a minimal valid JSON Schema for tool input."""
    base: dict[str, Any] = {
        "type": "object",
        "properties": {},
    }
    base.update(overrides)
    return base


async def _noop_handler(params: dict[str, Any]) -> dict[str, Any]:
    """Async no-op handler for tests."""
    return {}


async def _echo_handler(params: dict[str, Any]) -> dict[str, Any]:
    """Async echo handler — returns its input."""
    return params


@pytest.fixture()
def registry() -> ToolRegistry:
    """Fresh ToolRegistry for each test."""
    return ToolRegistry()


# ---------------------------------------------------------------------------
# AC1: ToolRegistry allows registering tools (name, description, schema,
#      handler)
# ---------------------------------------------------------------------------


class TestToolRegistration:
    """AC1 — basic registration."""

    def test_register_tool_basic(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.claim", "Claim a ticket", schema, _noop_handler)
        assert registry.count == 1

    def test_register_multiple_tools(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.claim", "Claim", schema, _noop_handler)
        registry.register("tickets.release", "Release", schema, _echo_handler)
        assert registry.count == 2

    def test_register_returns_tool_definition(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        defn = registry.register("tickets.claim", "Claim a ticket", schema, _noop_handler)
        assert isinstance(defn, ToolDefinition)
        assert defn.name == "tickets.claim"
        assert defn.description == "Claim a ticket"
        assert defn.input_schema == schema
        assert defn.handler is _noop_handler

    def test_registered_tool_has_async_handler(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        defn = registry.register("tickets.claim", "Claim", schema, _noop_handler)
        assert asyncio.iscoroutinefunction(defn.handler)

    def test_register_preserves_order(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        names = ["tickets.claim", "tickets.release", "tickets.complete"]
        for name in names:
            registry.register(name, f"desc-{name}", schema, _noop_handler)
        assert registry.list_tool_names() == names


# ---------------------------------------------------------------------------
# AC2: Registered tools are reported in MCP server's tools/list response
# ---------------------------------------------------------------------------


class TestMCPIntegration:
    """AC2 — tools/list exposure."""

    def test_list_tools_empty(self, registry: ToolRegistry) -> None:
        assert registry.list_tools() == []

    def test_list_tools_returns_definitions(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.claim", "Claim", schema, _noop_handler)
        tools = registry.list_tools()
        assert len(tools) == 1
        assert tools[0].name == "tickets.claim"

    def test_list_tools_contains_schema(self, registry: ToolRegistry) -> None:
        schema = _make_schema(
            properties={"ticket_id": {"type": "string"}},
        )
        registry.register("tickets.claim", "Claim", schema, _noop_handler)
        tool = registry.list_tools()[0]
        assert tool.input_schema["properties"]["ticket_id"]["type"] == "string"


# ---------------------------------------------------------------------------
# AC3: Tool handlers are async functions accepting validated input
# ---------------------------------------------------------------------------


class TestToolHandlerExecution:
    """AC3 — async handler invocation."""

    @pytest.mark.asyncio()
    async def test_handler_receives_params(self, registry: ToolRegistry) -> None:
        schema = _make_schema(
            properties={"ticket_id": {"type": "string"}},
        )
        registry.register("tickets.claim", "Claim", schema, _echo_handler)
        defn = registry.get("tickets.claim")
        assert defn is not None
        result = await defn.handler({"ticket_id": "FORGEOS-001"})
        assert result == {"ticket_id": "FORGEOS-001"}

    @pytest.mark.asyncio()
    async def test_handler_with_empty_params(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("health", "Health check", schema, _noop_handler)
        defn = registry.get("health")
        assert defn is not None
        result = await defn.handler({})
        assert result == {}

    def test_sync_handler_rejected(self, registry: ToolRegistry) -> None:
        schema = _make_schema()

        def sync_handler(params: dict[str, Any]) -> dict[str, Any]:
            return params

        with pytest.raises(TypeError, match="async"):
            registry.register("bad_tool", "desc", schema, sync_handler)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# AC4: Duplicate tool name registration raises error
# ---------------------------------------------------------------------------


class TestDuplicateRegistration:
    """AC4 — duplicate prevention."""

    def test_duplicate_raises_error(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.next", "First", schema, _noop_handler)
        with pytest.raises(DuplicateToolError, match=r"tickets\.next"):
            registry.register("tickets.next", "Second", schema, _echo_handler)

    def test_duplicate_does_not_modify_registry(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.next", "First", schema, _noop_handler)
        with pytest.raises(DuplicateToolError):
            registry.register("tickets.next", "Second", schema, _echo_handler)
        assert registry.count == 1
        assert registry.get("tickets.next") is not None
        assert registry.get("tickets.next").description == "First"  # type: ignore[union-attr]


# ---------------------------------------------------------------------------
# AC5: Tool input schemas follow JSON Schema draft 2020-12
# ---------------------------------------------------------------------------


class TestSchemaValidation:
    """AC5 — JSON Schema compliance."""

    def test_valid_schema_accepted(self, registry: ToolRegistry) -> None:
        schema: dict[str, Any] = {
            "$schema": "https://json-schema.org/draft/2020-12/schema",
            "type": "object",
            "properties": {
                "ticket_id": {"type": "string"},
            },
            "required": ["ticket_id"],
        }
        defn = registry.register("tickets.claim", "Claim", schema, _noop_handler)
        assert defn.input_schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"

    def test_schema_without_dollar_schema_accepted(self, registry: ToolRegistry) -> None:
        schema: dict[str, Any] = {"type": "object", "properties": {}}
        registry.register("tickets.claim", "Claim", schema, _noop_handler)
        assert registry.count == 1

    def test_schema_must_be_object_type(self, registry: ToolRegistry) -> None:
        schema: dict[str, Any] = {"type": "array", "items": {"type": "string"}}
        with pytest.raises(ValueError, match=r"type.*object"):
            registry.register("bad_schema", "desc", schema, _noop_handler)

    def test_empty_schema_rejected(self, registry: ToolRegistry) -> None:
        with pytest.raises(ValueError, match="schema"):
            registry.register("bad_schema", "desc", {}, _noop_handler)

    def test_schema_with_properties(self, registry: ToolRegistry) -> None:
        schema: dict[str, Any] = {
            "type": "object",
            "properties": {
                "agent": {"type": "string", "enum": ["Backend", "Frontend"]},
                "machine_id": {"type": "string"},
            },
            "required": ["agent"],
        }
        defn = registry.register("tickets.claim", "Claim", schema, _noop_handler)
        assert "agent" in defn.input_schema["properties"]
        assert "machine_id" in defn.input_schema["properties"]


# ---------------------------------------------------------------------------
# AC6: Lookup method resolves tool name to handler and schema
# ---------------------------------------------------------------------------


class TestToolLookup:
    """AC6 — name-based resolution."""

    def test_get_existing_tool(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.claim", "Claim", schema, _noop_handler)
        defn = registry.get("tickets.claim")
        assert defn is not None
        assert defn.name == "tickets.claim"
        assert defn.handler is _noop_handler
        assert defn.input_schema is schema

    def test_get_nonexistent_returns_none(self, registry: ToolRegistry) -> None:
        assert registry.get("nonexistent") is None

    def test_get_strict_raises_on_missing(self, registry: ToolRegistry) -> None:
        with pytest.raises(ToolNotFoundError):
            registry.get_or_raise("nonexistent")

    def test_contains_check(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.claim", "Claim", schema, _noop_handler)
        assert "tickets.claim" in registry
        assert "tickets.nope" not in registry

    def test_list_tool_names(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("a.tool", "A", schema, _noop_handler)
        registry.register("b.tool", "B", schema, _noop_handler)
        assert registry.list_tool_names() == ["a.tool", "b.tool"]


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Boundary and edge-case coverage."""

    def test_empty_name_rejected(self, registry: ToolRegistry) -> None:
        with pytest.raises(ValueError, match="name"):
            registry.register("", "desc", _make_schema(), _noop_handler)

    def test_empty_description_rejected(self, registry: ToolRegistry) -> None:
        with pytest.raises(ValueError, match="description"):
            registry.register("tool", "", _make_schema(), _noop_handler)

    def test_name_with_dots(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        defn = registry.register("tickets.claim.v2", "Claim v2", schema, _noop_handler)
        assert defn.name == "tickets.claim.v2"

    def test_name_with_underscores(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        defn = registry.register("my_custom_tool", "Custom", schema, _noop_handler)
        assert defn.name == "my_custom_tool"

    def test_register_via_decorator(self, registry: ToolRegistry) -> None:
        schema = _make_schema()

        @registry.tool("decorated.tool", "Decorated", schema)
        async def my_handler(params: dict[str, Any]) -> dict[str, Any]:
            return {"decorated": True}

        assert "decorated.tool" in registry
        assert registry.count == 1

    def test_decorator_handler_callable(self, registry: ToolRegistry) -> None:
        schema = _make_schema()

        @registry.tool("callable.test", "Test", schema)
        async def handler_fn(params: dict[str, Any]) -> dict[str, Any]:
            return params

        defn = registry.get("callable.test")
        assert defn is not None
        assert asyncio.iscoroutinefunction(defn.handler)


# ---------------------------------------------------------------------------
# FastMCP server integration
# ---------------------------------------------------------------------------


class TestToolVersioning:
    """Tool versioning support."""

    def test_default_version_is_one(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        defn = registry.register("tickets.claim", "Claim", schema, _noop_handler)
        assert defn.version == "1.0.0"

    def test_explicit_version(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        defn = registry.register(
            "tickets.claim", "Claim", schema, _noop_handler, version="2.1.0"
        )
        assert defn.version == "2.1.0"

    def test_version_in_tool_definition(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.claim", "Claim", schema, _noop_handler, version="3.0.0")
        defn = registry.get("tickets.claim")
        assert defn is not None
        assert defn.version == "3.0.0"

    def test_list_tools_includes_version(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("a.tool", "A", schema, _noop_handler, version="1.2.3")
        tools = registry.list_tools()
        assert tools[0].version == "1.2.3"

    def test_invalid_version_format_rejected(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        with pytest.raises(ValueError, match="version"):
            registry.register("tickets.claim", "Claim", schema, _noop_handler, version="")

    def test_decorator_with_version(self, registry: ToolRegistry) -> None:
        schema = _make_schema()

        @registry.tool("versioned.tool", "Versioned", schema, version="2.0.0")
        async def handler_fn(params: dict[str, Any]) -> dict[str, Any]:
            return params

        defn = registry.get("versioned.tool")
        assert defn is not None
        assert defn.version == "2.0.0"


class TestMCPServerIntegration:
    """Integration — register_all_on bridges to FastMCP."""

    def test_register_all_on_fastmcp(self, registry: ToolRegistry) -> None:
        schema = _make_schema()
        registry.register("tickets.claim", "Claim", schema, _noop_handler)
        registry.register("tickets.release", "Release", schema, _noop_handler)

        mock_server = MagicMock()
        mock_server.add_tool = MagicMock()

        registry.register_all_on(mock_server)

        assert mock_server.add_tool.call_count == 2
        call_args_list = mock_server.add_tool.call_args_list
        names = [call.kwargs.get("name") for call in call_args_list]
        assert "tickets.claim" in names
        assert "tickets.release" in names

    def test_register_all_on_fastmcp_empty_registry(self, registry: ToolRegistry) -> None:
        mock_server = MagicMock()
        registry.register_all_on(mock_server)
        mock_server.add_tool.assert_not_called()
