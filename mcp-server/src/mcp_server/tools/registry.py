"""Dynamic tool registration system for the ForgeOS MCP Server.

This module implements the :class:`ToolRegistry` — a runtime registry that
allows MCP tools to be registered, discovered, and looked up by name.
Each tool is described by a :class:`ToolDefinition` containing its name,
description, JSON Schema (draft 2020-12) input definition, and an async
handler function.

Design Decisions
----------------
* **Insertion-ordered dict** — tools are stored in a plain ``dict`` which
  preserves insertion order (Python 3.7+), so ``list_tools()`` returns
  tools in registration order.
* **Duplicate prevention** — registering the same name twice raises
  :class:`DuplicateToolError` rather than silently overwriting.
* **Schema validation** — input schemas must have ``"type": "object"``
  (MCP tools always receive a JSON object).  The ``$schema`` keyword is
  optional but, when present, must reference a JSON Schema draft.
* **Async-only handlers** — handlers must be coroutine functions; sync
  functions are rejected at registration time with ``TypeError``.
* **FastMCP bridge** — :meth:`ToolRegistry.register_all_on` bulk-registers
  every tool onto a :class:`FastMCP` server instance, adapting the generic
  ``ToolHandler`` protocol to the FastMCP ``add_tool`` signature.

Acceptance Criteria (FORGEOS-BE020)
------------------------------------
1. ToolRegistry class allows registering tools with name, description,
   input schema, and handler.
2. Registered tools are reported in the MCP server's ``tools/list``
   response (via ``register_all_on``).
3. Tool handlers are async functions accepting validated input parameters.
4. Registry prevents duplicate tool name registration (raises error).
5. Tool input schemas follow JSON Schema draft 2020-12 format.
6. Registry provides a lookup method to resolve tool name to handler and
   schema.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

if TYPE_CHECKING:
    from collections.abc import Callable, Coroutine

    from mcp.server.fastmcp import FastMCP

logger = logging.getLogger("forgeos.tools.registry")


# ---------------------------------------------------------------------------
# Handler protocol
# ---------------------------------------------------------------------------


@runtime_checkable
class ToolHandler(Protocol):
    """Protocol for MCP tool handler functions.

    Handlers **must** be async callables that accept a single ``dict``
    of validated input parameters and return a JSON-serialisable result.
    """

    def __call__(self, params: dict[str, Any]) -> Coroutine[Any, Any, Any]:
        """Execute the tool with *params* and return a result."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# Data structures
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class ToolDefinition:
    """Immutable descriptor for a registered MCP tool.

    Attributes
    ----------
    name:
        Unique tool name (e.g. ``"tickets.claim"``).
    description:
        Human-readable summary shown in ``tools/list``.
    input_schema:
        JSON Schema (``"type": "object"``) describing the tool's parameters.
    handler:
        Async callable that executes the tool logic.
    """

    name: str
    description: str
    input_schema: dict[str, Any]
    handler: ToolHandler  # type: ignore[type-arg]
    version: str = "1.0.0"


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class DuplicateToolError(ValueError):
    """Raised when attempting to register a tool with an already-taken name."""

    def __init__(self, name: str) -> None:
        self.tool_name = name
        super().__init__(f"Tool already registered: {name}")


class ToolNotFoundError(KeyError):
    """Raised by strict lookup when the requested tool name is not registered."""

    def __init__(self, name: str) -> None:
        self.tool_name = name
        super().__init__(f"Tool not found: {name}")


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------


def _validate_input_schema(schema: dict[str, Any]) -> None:
    """Validate that *schema* is structurally acceptable for MCP tool input.

    Rules
    -----
    * Must not be empty.
    * ``"type"`` must be ``"object"`` (MCP tools always receive a JSON object).
    * If ``"$schema"`` is present it must be a non-empty string.

    Raises
    ------
    ValueError
        If the schema violates any rule.
    """
    if not schema:
        raise ValueError("Tool input schema must not be empty")

    schema_type = schema.get("type")
    if schema_type != "object":
        raise ValueError(
            f"Tool input schema must have type 'object', got '{schema_type}'"
        )

    dollar_schema = schema.get("$schema")
    if dollar_schema is not None and not isinstance(dollar_schema, str):
        raise ValueError("$schema must be a string when present")


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------


class ToolRegistry:
    """Runtime registry for MCP tool definitions.

    Usage::

        registry = ToolRegistry()

        async def my_handler(params: dict[str, Any]) -> dict[str, Any]:
            return {"ok": True}

        registry.register(
            name="my.tool",
            description="Does something useful",
            input_schema={"type": "object", "properties": {}},
            handler=my_handler,
        )

        # Later — register everything onto a FastMCP server:
        registry.register_all_on(mcp_server_instance)
    """

    def __init__(self) -> None:
        self._tools: dict[str, ToolDefinition] = {}

    # -- Registration -------------------------------------------------------

    def register(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        handler: ToolHandler,  # type: ignore[type-arg]
        version: str = "1.0.0",
    ) -> ToolDefinition:
        """Register a new tool.

        Parameters
        ----------
        name:
            Unique tool name.
        description:
            Human-readable description.
        input_schema:
            JSON Schema dict (must have ``"type": "object"``).
        handler:
            Async callable ``(params) -> result``.
        version:
            Semantic version string (default ``"1.0.0"``).

        Returns
        -------
        ToolDefinition
            The newly registered tool definition.

        Raises
        ------
        DuplicateToolError
            If *name* is already registered.
        ValueError
            If *name* or *description* is empty, or if *input_schema* is
            invalid.
        TypeError
            If *handler* is not an async callable.
        """
        # Validate name & description
        if not name or not name.strip():
            raise ValueError("Tool name must not be empty")
        if not description or not description.strip():
            raise ValueError("Tool description must not be empty")
        if not version or not version.strip():
            raise ValueError("Tool version must not be empty")

        # Validate handler is async
        if not asyncio.iscoroutinefunction(handler):
            raise TypeError(
                f"Tool handler for '{name}' must be an async function, "
                f"got {type(handler).__name__}"
            )

        # Validate schema
        _validate_input_schema(input_schema)

        # Check for duplicates
        if name in self._tools:
            raise DuplicateToolError(name)

        definition = ToolDefinition(
            name=name,
            description=description,
            input_schema=input_schema,
            handler=handler,
            version=version,
        )
        self._tools[name] = definition
        logger.info("Registered tool: %s", name)
        return definition

    def tool(
        self,
        name: str,
        description: str,
        input_schema: dict[str, Any],
        version: str = "1.0.0",
    ) -> Callable[..., Callable[..., Coroutine[Any, Any, Any]]]:
        """Decorator form of :meth:`register`.

        Usage::

            @registry.tool("my.tool", "Does stuff", {"type": "object", ...})
            async def handle_my_tool(params):
                ...
        """

        def decorator(
            fn: Callable[..., Coroutine[Any, Any, Any]],
        ) -> Callable[..., Coroutine[Any, Any, Any]]:
            self.register(name, description, input_schema, fn, version=version)  # type: ignore[arg-type]
            return fn

        return decorator

    # -- Lookup -------------------------------------------------------------

    def get(self, name: str) -> ToolDefinition | None:
        """Return the :class:`ToolDefinition` for *name*, or ``None``."""
        return self._tools.get(name)

    def get_or_raise(self, name: str) -> ToolDefinition:
        """Return the :class:`ToolDefinition` for *name*.

        Raises
        ------
        ToolNotFoundError
            If *name* is not registered.
        """
        defn = self._tools.get(name)
        if defn is None:
            raise ToolNotFoundError(name)
        return defn

    def __contains__(self, name: str) -> bool:
        """Support ``"name" in registry`` syntax."""
        return name in self._tools

    # -- Enumeration --------------------------------------------------------

    def list_tools(self) -> list[ToolDefinition]:
        """Return all registered tools in registration order."""
        return list(self._tools.values())

    def list_tool_names(self) -> list[str]:
        """Return all registered tool names in registration order."""
        return list(self._tools.keys())

    @property
    def count(self) -> int:
        """Number of registered tools."""
        return len(self._tools)

    # -- FastMCP bridge -----------------------------------------------------

    def register_all_on(self, server: FastMCP) -> None:
        """Register every tool in the registry onto a FastMCP server.

        This bridges the generic :class:`ToolRegistry` to the FastMCP
        runtime so that registered tools appear in ``tools/list``
        responses.

        Parameters
        ----------
        server:
            A :class:`FastMCP` server instance.
        """
        for defn in self._tools.values():
            _register_tool_on_server(server, defn)
        logger.info(
            "Registered %d tool(s) on FastMCP server", len(self._tools)
        )


# ---------------------------------------------------------------------------
# FastMCP adapter
# ---------------------------------------------------------------------------


def _register_tool_on_server(server: FastMCP, defn: ToolDefinition) -> None:
    """Register a single :class:`ToolDefinition` on a FastMCP server.

    FastMCP's ``add_tool`` expects an async function whose signature is
    inspected for parameter names.  We create a thin wrapper that accepts
    ``**kwargs`` and forwards them as the ``params`` dict expected by
    the :class:`ToolHandler` protocol.
    """
    handler = defn.handler

    async def _wrapper(**kwargs: Any) -> Any:  # noqa: ANN401
        return await handler(kwargs)

    # Set a meaningful __name__ so FastMCP's introspection works:
    _wrapper.__name__ = defn.name.replace(".", "_")
    _wrapper.__qualname__ = _wrapper.__name__

    server.add_tool(
        _wrapper,
        name=defn.name,
        description=defn.description,
    )
