"""Tests for the tickets.next and tickets.claim MCP tools (FORGEOS-BE028, FORGEOS-BE029).

Tests for tickets.next cover all 7 acceptance criteria from FORGEOS-BE028.
Tests for tickets.claim cover all 7 acceptance criteria from FORGEOS-BE029:
  AC1: tickets.claim MCP tool registered with the dynamic tool registry.
  AC2: Tool accepts ticket_id, agent_id, machine_id, and operator as input parameters.
  AC3: Tool validates that the target ticket exists and is in READY stage.
  AC4: Tool validates that the agent role matches the ticket's expected SDLC stage.
  AC5: Concurrent claim attempts on the same ticket result in exactly one winner.
  AC6: Returns claimed ticket data on success, MCP error on conflict or invalid state.
  AC7: Lease expiry set according to configurable lease_duration_minutes.

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from mcp_server.locking.claim_queue import (
    AgentRoleMap,
    ClaimError,
    ClaimQueue,
    ClaimResult,
    NoEligibleTicketError,
)
from mcp_server.services.ticket_service import NextTicketResult, TicketService
from mcp_server.tools.registry import ToolRegistry
from mcp_server.tools.ticket_tools import (
    CLAIM_TOOL_NAME,
    TICKETS_CLAIM_SCHEMA,
    TICKETS_NEXT_SCHEMA,
    TOOL_NAME,
    handle_tickets_claim,
    handle_tickets_next,
    register_ticket_tools,
)
from mcp_server.tools.validation import ToolInputValidationError

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_CLAIM_RESULT = ClaimResult(
    id=str(uuid.uuid4()),
    ticket_id="FORGEOS-BE099",
    title="Test ticket for claim",
    ticket_type="backend",
    priority="critical",
    stage="BACKEND",
    status="CLAIMED",
    agent_id=str(uuid.uuid4()),
    agent_name="backend",
    machine_id="test-host",
    lease_expiry=datetime(2026, 3, 11, 12, 0, 0, tzinfo=timezone.utc),
    file_paths=["src/server.py", "src/config.py"],
    acceptance_criteria=["AC1: Implement feature", "AC2: Write tests"],
    depends_on=["FORGEOS-BE001"],
    metadata={"source": "test"},
)


@pytest.fixture()
def mock_claim_queue() -> AsyncMock:
    """Create a mock ClaimQueue."""
    queue = AsyncMock(spec=ClaimQueue)
    return queue


@pytest.fixture()
def ticket_service(mock_claim_queue: AsyncMock) -> TicketService:
    """Create a TicketService with a mock claim queue."""
    return TicketService(claim_queue=mock_claim_queue)


@pytest.fixture()
def registry() -> ToolRegistry:
    """Fresh ToolRegistry for each test."""
    return ToolRegistry()


def _valid_params(**overrides: Any) -> dict[str, Any]:
    """Return valid input params for tickets.next."""
    base: dict[str, Any] = {
        "agent_role": "backend",
        "machine_id": "test-host",
        "operator": "TestOperator",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# AC1: tickets.next MCP tool registered with the dynamic tool registry
# ---------------------------------------------------------------------------


class TestToolRegistration:
    """AC1 — tool registration with the dynamic registry."""

    def test_register_ticket_tools_adds_tool(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        assert TOOL_NAME in registry

    def test_registered_tool_has_correct_name(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(TOOL_NAME)
        assert defn is not None
        assert defn.name == "tickets.next"

    def test_registered_tool_has_description(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(TOOL_NAME)
        assert defn is not None
        assert len(defn.description) > 0

    def test_registered_tool_has_schema(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(TOOL_NAME)
        assert defn is not None
        assert defn.input_schema == TICKETS_NEXT_SCHEMA

    def test_registered_tool_handler_is_async(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(TOOL_NAME)
        assert defn is not None
        import asyncio

        assert asyncio.iscoroutinefunction(defn.handler)

    def test_tool_count_after_registration(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        assert registry.count >= 2


# ---------------------------------------------------------------------------
# AC2: Tool accepts agent_role, machine_id, and operator
# ---------------------------------------------------------------------------


class TestToolInputParameters:
    """AC2 — input parameter acceptance."""

    def test_schema_requires_agent_role(self) -> None:
        assert "agent_role" in TICKETS_NEXT_SCHEMA["properties"]
        assert "agent_role" in TICKETS_NEXT_SCHEMA["required"]

    def test_schema_requires_machine_id(self) -> None:
        assert "machine_id" in TICKETS_NEXT_SCHEMA["properties"]
        assert "machine_id" in TICKETS_NEXT_SCHEMA["required"]

    def test_schema_requires_operator(self) -> None:
        assert "operator" in TICKETS_NEXT_SCHEMA["properties"]
        assert "operator" in TICKETS_NEXT_SCHEMA["required"]

    def test_schema_type_is_object(self) -> None:
        assert TICKETS_NEXT_SCHEMA["type"] == "object"

    def test_schema_disallows_additional_properties(self) -> None:
        assert TICKETS_NEXT_SCHEMA.get("additionalProperties") is False

    def test_all_properties_are_strings(self) -> None:
        for prop in TICKETS_NEXT_SCHEMA["properties"].values():
            assert prop["type"] == "string"

    def test_all_properties_have_min_length(self) -> None:
        for prop in TICKETS_NEXT_SCHEMA["properties"].values():
            assert prop.get("minLength", 0) >= 1


# ---------------------------------------------------------------------------
# AC3: Input parameters validated against JSON Schema
# ---------------------------------------------------------------------------


class TestInputValidation:
    """AC3 — JSON Schema validation of input parameters."""

    @pytest.mark.asyncio()
    async def test_missing_agent_role_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"machine_id": "host", "operator": "op"}
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_next(params, ticket_service=ticket_service)
        assert any("agent_role" in e.message for e in exc_info.value.field_errors)

    @pytest.mark.asyncio()
    async def test_missing_machine_id_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"agent_role": "backend", "operator": "op"}
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_next(params, ticket_service=ticket_service)
        assert any("machine_id" in e.message for e in exc_info.value.field_errors)

    @pytest.mark.asyncio()
    async def test_missing_operator_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"agent_role": "backend", "machine_id": "host"}
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_next(params, ticket_service=ticket_service)
        assert any("operator" in e.message for e in exc_info.value.field_errors)

    @pytest.mark.asyncio()
    async def test_empty_params_raises(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_next({}, ticket_service=ticket_service)
        assert len(exc_info.value.field_errors) == 3

    @pytest.mark.asyncio()
    async def test_extra_property_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = _valid_params(extra_field="bad")
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_next(params, ticket_service=ticket_service)

    @pytest.mark.asyncio()
    async def test_non_string_agent_role_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = _valid_params(agent_role=42)
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_next(params, ticket_service=ticket_service)

    @pytest.mark.asyncio()
    async def test_empty_string_agent_role_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = _valid_params(agent_role="")
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_next(params, ticket_service=ticket_service)


# ---------------------------------------------------------------------------
# AC4: Tool calls the claim queue to atomically claim the next READY ticket
# ---------------------------------------------------------------------------


class TestClaimQueueInvocation:
    """AC4 — claim queue is called with correct parameters."""

    @pytest.mark.asyncio()
    async def test_calls_claim_next_on_queue(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        params = _valid_params()
        await handle_tickets_next(params, ticket_service=ticket_service)
        mock_claim_queue.claim_next.assert_awaited_once()

    @pytest.mark.asyncio()
    async def test_passes_correct_stage_for_role(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        params = _valid_params(agent_role="backend")
        await handle_tickets_next(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_next.call_args
        assert call_kwargs.kwargs["stage"] == "BACKEND"

    @pytest.mark.asyncio()
    async def test_passes_machine_id(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        params = _valid_params(machine_id="my-machine")
        await handle_tickets_next(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_next.call_args
        assert call_kwargs.kwargs["machine_id"] == "my-machine"

    @pytest.mark.asyncio()
    async def test_passes_operator(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        params = _valid_params(operator="ReaperOAK")
        await handle_tickets_next(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_next.call_args
        assert call_kwargs.kwargs["operator"] == "ReaperOAK"

    @pytest.mark.asyncio()
    async def test_qa_role_resolves_to_qa_stage(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        qa_result = ClaimResult(
            id=str(uuid.uuid4()),
            ticket_id="FORGEOS-QA001",
            title="QA ticket",
            ticket_type="backend",
            priority="medium",
            stage="QA",
            status="CLAIMED",
            agent_id=str(uuid.uuid4()),
            agent_name="qa",
            machine_id="host",
            lease_expiry=datetime(2026, 3, 11, 12, 0, 0, tzinfo=timezone.utc),
        )
        mock_claim_queue.claim_next.return_value = qa_result
        params = _valid_params(agent_role="qa")
        await handle_tickets_next(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_next.call_args
        assert call_kwargs.kwargs["stage"] == "QA"


# ---------------------------------------------------------------------------
# AC5: Returns claimed ticket data on success
# ---------------------------------------------------------------------------


class TestSuccessResponse:
    """AC5 — claimed ticket data returned."""

    @pytest.mark.asyncio()
    async def test_returns_ticket_id(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["ticket_id"] == "FORGEOS-BE099"

    @pytest.mark.asyncio()
    async def test_returns_title(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["title"] == "Test ticket for claim"

    @pytest.mark.asyncio()
    async def test_returns_type(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["type"] == "backend"

    @pytest.mark.asyncio()
    async def test_returns_stage(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["stage"] == "BACKEND"

    @pytest.mark.asyncio()
    async def test_returns_file_paths(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["file_paths"] == ["src/server.py", "src/config.py"]

    @pytest.mark.asyncio()
    async def test_returns_acceptance_criteria(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["acceptance_criteria"] == [
            "AC1: Implement feature",
            "AC2: Write tests",
        ]

    @pytest.mark.asyncio()
    async def test_full_response_shape(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        expected_keys = {
            "ticket_id",
            "title",
            "type",
            "stage",
            "file_paths",
            "acceptance_criteria",
        }
        assert set(result.keys()) == expected_keys


# ---------------------------------------------------------------------------
# AC6: Returns structured MCP error response when no eligible tickets
# ---------------------------------------------------------------------------


class TestErrorResponse:
    """AC6 — structured error when no tickets available."""

    @pytest.mark.asyncio()
    async def test_no_ticket_returns_error(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = None
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["isError"] is True

    @pytest.mark.asyncio()
    async def test_no_ticket_returns_error_code(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = None
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["code"] == -32602

    @pytest.mark.asyncio()
    async def test_no_ticket_returns_error_message(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = None
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert "backend" in result["message"]

    @pytest.mark.asyncio()
    async def test_unknown_role_returns_error(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        params = _valid_params(agent_role="nonexistent_role")
        result = await handle_tickets_next(
            params, ticket_service=ticket_service
        )
        assert result["isError"] is True
        assert "nonexistent_role" in result["message"]

    @pytest.mark.asyncio()
    async def test_unknown_role_does_not_call_queue(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        params = _valid_params(agent_role="nonexistent_role")
        await handle_tickets_next(params, ticket_service=ticket_service)
        mock_claim_queue.claim_next.assert_not_awaited()


# ---------------------------------------------------------------------------
# AC7: Ticket service layer created as shared module
# ---------------------------------------------------------------------------


class TestTicketServiceLayer:
    """AC7 — TicketService is a standalone module."""

    def test_ticket_service_importable(self) -> None:
        from mcp_server.services.ticket_service import TicketService

        assert TicketService is not None

    def test_next_ticket_result_importable(self) -> None:
        from mcp_server.services.ticket_service import NextTicketResult

        assert NextTicketResult is not None

    def test_service_exported_from_services_init(self) -> None:
        from mcp_server.services import NextTicketResult, TicketService

        assert TicketService is not None
        assert NextTicketResult is not None

    @pytest.mark.asyncio()
    async def test_service_claim_next_returns_result(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        result = await ticket_service.claim_next(
            agent_role="backend",
            machine_id="host",
            operator="op",
        )
        assert isinstance(result, NextTicketResult)
        assert result.ticket_id == "FORGEOS-BE099"

    @pytest.mark.asyncio()
    async def test_service_claim_next_raises_on_no_ticket(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = None
        with pytest.raises(NoEligibleTicketError):
            await ticket_service.claim_next(
                agent_role="backend",
                machine_id="host",
                operator="op",
            )

    @pytest.mark.asyncio()
    async def test_service_claim_next_raises_on_unknown_role(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        with pytest.raises(ValueError, match="Unknown agent role"):
            await ticket_service.claim_next(
                agent_role="invalid_role",
                machine_id="host",
                operator="op",
            )

    def test_next_ticket_result_to_dict(self) -> None:
        result = NextTicketResult(
            ticket_id="TEST-001",
            title="Test",
            ticket_type="backend",
            stage="BACKEND",
            file_paths=["src/a.py"],
            acceptance_criteria=["AC1"],
        )
        d = result.to_dict()
        assert d == {
            "ticket_id": "TEST-001",
            "title": "Test",
            "type": "backend",
            "stage": "BACKEND",
            "file_paths": ["src/a.py"],
            "acceptance_criteria": ["AC1"],
        }

    def test_next_ticket_result_is_frozen(self) -> None:
        result = NextTicketResult(
            ticket_id="TEST-001",
            title="Test",
            ticket_type="backend",
            stage="BACKEND",
        )
        with pytest.raises(AttributeError):
            result.ticket_id = "CHANGED"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Integration: registered handler works end-to-end via registry
# ---------------------------------------------------------------------------


class TestRegistryIntegration:
    """End-to-end: register, lookup, and invoke handler via registry."""

    @pytest.mark.asyncio()
    async def test_invoke_registered_handler_success(
        self,
        registry: ToolRegistry,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = _CLAIM_RESULT
        register_ticket_tools(registry, ticket_service)
        defn = registry.get_or_raise(TOOL_NAME)
        result = await defn.handler(_valid_params())
        assert result["ticket_id"] == "FORGEOS-BE099"

    @pytest.mark.asyncio()
    async def test_invoke_registered_handler_no_ticket(
        self,
        registry: ToolRegistry,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_next.return_value = None
        register_ticket_tools(registry, ticket_service)
        defn = registry.get_or_raise(TOOL_NAME)
        result = await defn.handler(_valid_params())
        assert result["isError"] is True

    @pytest.mark.asyncio()
    async def test_invoke_registered_handler_validation_error(
        self,
        registry: ToolRegistry,
        ticket_service: TicketService,
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get_or_raise(TOOL_NAME)
        with pytest.raises(ToolInputValidationError):
            await defn.handler({})


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Edge cases and boundary conditions."""

    @pytest.mark.asyncio()
    async def test_all_valid_roles_resolve(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        """All known roles should resolve to a stage (not error)."""
        valid_roles = [
            "architect", "research", "backend", "frontend",
            "qa", "security", "ci", "documentation", "validator",
        ]
        for role in valid_roles:
            stage = AgentRoleMap.stage_for_role(role)
            assert stage is not None, f"Role '{role}' should have a stage"

    @pytest.mark.asyncio()
    async def test_frontend_role_resolves_correctly(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        fe_result = ClaimResult(
            id=str(uuid.uuid4()),
            ticket_id="FORGEOS-FE001",
            title="Frontend ticket",
            ticket_type="frontend",
            priority="high",
            stage="FRONTEND",
            status="CLAIMED",
            agent_id=str(uuid.uuid4()),
            agent_name="frontend",
            machine_id="host",
            lease_expiry=datetime(2026, 3, 11, 12, 0, 0, tzinfo=timezone.utc),
        )
        mock_claim_queue.claim_next.return_value = fe_result
        params = _valid_params(agent_role="frontend")
        result = await handle_tickets_next(params, ticket_service=ticket_service)
        assert result["stage"] == "FRONTEND"
        assert result["type"] == "frontend"

    def test_tool_name_constant(self) -> None:
        assert TOOL_NAME == "tickets.next"

    @pytest.mark.asyncio()
    async def test_empty_file_paths_on_result(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        minimal_result = ClaimResult(
            id=str(uuid.uuid4()),
            ticket_id="TEST-MIN",
            title="Minimal",
            ticket_type="backend",
            priority="low",
            stage="BACKEND",
            status="CLAIMED",
            agent_id=str(uuid.uuid4()),
            agent_name="backend",
            machine_id="host",
            lease_expiry=datetime(2026, 3, 11, 12, 0, 0, tzinfo=timezone.utc),
        )
        mock_claim_queue.claim_next.return_value = minimal_result
        result = await handle_tickets_next(
            _valid_params(), ticket_service=ticket_service
        )
        assert result["file_paths"] == []
        assert result["acceptance_criteria"] == []


# ===========================================================================
# FORGEOS-BE029: tickets.claim tests
# ===========================================================================


def _valid_claim_params(**overrides: Any) -> dict[str, Any]:
    """Return valid input params for tickets.claim."""
    base: dict[str, Any] = {
        "ticket_id": "FORGEOS-BE099",
        "agent_id": "backend",
        "machine_id": "test-host",
        "operator": "TestOperator",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# AC1: tickets.claim MCP tool registered with the dynamic tool registry
# ---------------------------------------------------------------------------


class TestClaimToolRegistration:
    """AC1 — tickets.claim tool registration with the dynamic registry."""

    def test_register_adds_claim_tool(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        assert CLAIM_TOOL_NAME in registry

    def test_registered_claim_tool_has_correct_name(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(CLAIM_TOOL_NAME)
        assert defn is not None
        assert defn.name == "tickets.claim"

    def test_registered_claim_tool_has_description(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(CLAIM_TOOL_NAME)
        assert defn is not None
        assert len(defn.description) > 0

    def test_registered_claim_tool_has_schema(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(CLAIM_TOOL_NAME)
        assert defn is not None
        assert defn.input_schema == TICKETS_CLAIM_SCHEMA

    def test_registered_claim_tool_handler_is_async(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(CLAIM_TOOL_NAME)
        assert defn is not None
        import asyncio

        assert asyncio.iscoroutinefunction(defn.handler)

    def test_claim_tool_name_constant(self) -> None:
        assert CLAIM_TOOL_NAME == "tickets.claim"


# ---------------------------------------------------------------------------
# AC2: Tool accepts ticket_id, agent_id, machine_id, and operator
# ---------------------------------------------------------------------------


class TestClaimToolInputParameters:
    """AC2 — input parameter acceptance."""

    def test_schema_requires_ticket_id(self) -> None:
        assert "ticket_id" in TICKETS_CLAIM_SCHEMA["properties"]
        assert "ticket_id" in TICKETS_CLAIM_SCHEMA["required"]

    def test_schema_requires_agent_id(self) -> None:
        assert "agent_id" in TICKETS_CLAIM_SCHEMA["properties"]
        assert "agent_id" in TICKETS_CLAIM_SCHEMA["required"]

    def test_schema_requires_machine_id(self) -> None:
        assert "machine_id" in TICKETS_CLAIM_SCHEMA["properties"]
        assert "machine_id" in TICKETS_CLAIM_SCHEMA["required"]

    def test_schema_requires_operator(self) -> None:
        assert "operator" in TICKETS_CLAIM_SCHEMA["properties"]
        assert "operator" in TICKETS_CLAIM_SCHEMA["required"]

    def test_schema_type_is_object(self) -> None:
        assert TICKETS_CLAIM_SCHEMA["type"] == "object"

    def test_schema_disallows_additional_properties(self) -> None:
        assert TICKETS_CLAIM_SCHEMA.get("additionalProperties") is False

    def test_required_properties_are_strings(self) -> None:
        for name in TICKETS_CLAIM_SCHEMA["required"]:
            assert TICKETS_CLAIM_SCHEMA["properties"][name]["type"] == "string"

    def test_required_properties_have_min_length(self) -> None:
        for name in TICKETS_CLAIM_SCHEMA["required"]:
            prop = TICKETS_CLAIM_SCHEMA["properties"][name]
            assert prop.get("minLength", 0) >= 1

    def test_lease_duration_minutes_is_optional(self) -> None:
        assert "lease_duration_minutes" not in TICKETS_CLAIM_SCHEMA["required"]

    def test_lease_duration_minutes_is_integer(self) -> None:
        prop = TICKETS_CLAIM_SCHEMA["properties"]["lease_duration_minutes"]
        assert prop["type"] == "integer"


# ---------------------------------------------------------------------------
# AC3: Tool validates that the target ticket exists and is in READY stage
# ---------------------------------------------------------------------------


class TestClaimInputValidation:
    """AC3 — JSON Schema validation and ticket existence check."""

    @pytest.mark.asyncio()
    async def test_missing_ticket_id_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"agent_id": "backend", "machine_id": "host", "operator": "op"}
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_claim(params, ticket_service=ticket_service)
        assert any("ticket_id" in e.message for e in exc_info.value.field_errors)

    @pytest.mark.asyncio()
    async def test_missing_agent_id_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"ticket_id": "T-001", "machine_id": "host", "operator": "op"}
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_claim(params, ticket_service=ticket_service)
        assert any("agent_id" in e.message for e in exc_info.value.field_errors)

    @pytest.mark.asyncio()
    async def test_missing_machine_id_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"ticket_id": "T-001", "agent_id": "backend", "operator": "op"}
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_claim(params, ticket_service=ticket_service)
        assert any("machine_id" in e.message for e in exc_info.value.field_errors)

    @pytest.mark.asyncio()
    async def test_missing_operator_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"ticket_id": "T-001", "agent_id": "backend", "machine_id": "host"}
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_claim(params, ticket_service=ticket_service)
        assert any("operator" in e.message for e in exc_info.value.field_errors)

    @pytest.mark.asyncio()
    async def test_empty_params_raises(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError) as exc_info:
            await handle_tickets_claim({}, ticket_service=ticket_service)
        assert len(exc_info.value.field_errors) == 4

    @pytest.mark.asyncio()
    async def test_extra_property_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = _valid_claim_params(extra_field="bad")
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_claim(params, ticket_service=ticket_service)

    @pytest.mark.asyncio()
    async def test_empty_string_ticket_id_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = _valid_claim_params(ticket_id="")
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_claim(params, ticket_service=ticket_service)

    @pytest.mark.asyncio()
    async def test_ticket_not_in_ready_returns_error(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = None
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["isError"] is True
        assert "not claimable" in result["message"]


# ---------------------------------------------------------------------------
# AC4: Tool validates that the agent role matches the ticket's expected stage
# ---------------------------------------------------------------------------


class TestClaimRoleValidation:
    """AC4 — agent role must match the ticket's SDLC stage."""

    @pytest.mark.asyncio()
    async def test_unknown_role_returns_error(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        params = _valid_claim_params(agent_id="nonexistent_role")
        result = await handle_tickets_claim(
            params, ticket_service=ticket_service
        )
        assert result["isError"] is True
        assert "nonexistent_role" in result["message"]

    @pytest.mark.asyncio()
    async def test_unknown_role_does_not_call_queue(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        params = _valid_claim_params(agent_id="nonexistent_role")
        await handle_tickets_claim(params, ticket_service=ticket_service)
        mock_claim_queue.claim_by_id.assert_not_awaited()

    @pytest.mark.asyncio()
    async def test_valid_role_calls_claim_by_id(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        params = _valid_claim_params()
        await handle_tickets_claim(params, ticket_service=ticket_service)
        mock_claim_queue.claim_by_id.assert_awaited_once()

    @pytest.mark.asyncio()
    async def test_passes_ticket_id_to_queue(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        params = _valid_claim_params(ticket_id="FORGEOS-FE001")
        await handle_tickets_claim(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_by_id.call_args
        assert call_kwargs.kwargs["ticket_id"] == "FORGEOS-FE001"

    @pytest.mark.asyncio()
    async def test_passes_machine_id_to_queue(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        params = _valid_claim_params(machine_id="my-machine")
        await handle_tickets_claim(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_by_id.call_args
        assert call_kwargs.kwargs["machine_id"] == "my-machine"

    @pytest.mark.asyncio()
    async def test_passes_operator_to_queue(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        params = _valid_claim_params(operator="ReaperOAK")
        await handle_tickets_claim(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_by_id.call_args
        assert call_kwargs.kwargs["operator"] == "ReaperOAK"


# ---------------------------------------------------------------------------
# AC5: Concurrent claim attempts result in exactly one winner
# ---------------------------------------------------------------------------


class TestClaimConcurrency:
    """AC5 — concurrent claims produce exactly one winner."""

    @pytest.mark.asyncio()
    async def test_second_claim_gets_error_when_already_claimed(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        """Simulate: first claim wins, second gets None (already claimed)."""
        mock_claim_queue.claim_by_id.side_effect = [_CLAIM_RESULT, None]

        result1 = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        result2 = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )

        assert "ticket_id" in result1
        assert result2["isError"] is True

    @pytest.mark.asyncio()
    async def test_file_conflict_returns_error(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.side_effect = ClaimError(
            "FILE_CONFLICT: src/server.py locked",
            details={"ticket_id": "T-001"},
        )
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["isError"] is True
        assert "FILE_CONFLICT" in result["message"]


# ---------------------------------------------------------------------------
# AC6: Returns claimed ticket data on success, MCP error on conflict
# ---------------------------------------------------------------------------


class TestClaimSuccessResponse:
    """AC6 — claimed ticket data returned on success."""

    @pytest.mark.asyncio()
    async def test_returns_ticket_id(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["ticket_id"] == "FORGEOS-BE099"

    @pytest.mark.asyncio()
    async def test_returns_title(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["title"] == "Test ticket for claim"

    @pytest.mark.asyncio()
    async def test_returns_type(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["type"] == "backend"

    @pytest.mark.asyncio()
    async def test_returns_stage(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["stage"] == "BACKEND"

    @pytest.mark.asyncio()
    async def test_returns_file_paths(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["file_paths"] == ["src/server.py", "src/config.py"]

    @pytest.mark.asyncio()
    async def test_returns_acceptance_criteria(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["acceptance_criteria"] == [
            "AC1: Implement feature",
            "AC2: Write tests",
        ]

    @pytest.mark.asyncio()
    async def test_full_response_shape(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        expected_keys = {
            "ticket_id",
            "title",
            "type",
            "stage",
            "file_paths",
            "acceptance_criteria",
        }
        assert set(result.keys()) == expected_keys

    @pytest.mark.asyncio()
    async def test_not_claimable_error_has_code(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = None
        result = await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        assert result["code"] == -32602


# ---------------------------------------------------------------------------
# AC7: Lease expiry set according to configurable lease_duration_minutes
# ---------------------------------------------------------------------------


class TestClaimLeaseConfiguration:
    """AC7 — configurable lease duration."""

    @pytest.mark.asyncio()
    async def test_default_lease_minutes_is_30(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        await handle_tickets_claim(
            _valid_claim_params(), ticket_service=ticket_service
        )
        call_kwargs = mock_claim_queue.claim_by_id.call_args
        assert call_kwargs.kwargs["lease_minutes"] == 30

    @pytest.mark.asyncio()
    async def test_custom_lease_minutes(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        params = _valid_claim_params(lease_duration_minutes=60)
        await handle_tickets_claim(params, ticket_service=ticket_service)
        call_kwargs = mock_claim_queue.claim_by_id.call_args
        assert call_kwargs.kwargs["lease_minutes"] == 60

    def test_lease_minimum_is_1(self) -> None:
        prop = TICKETS_CLAIM_SCHEMA["properties"]["lease_duration_minutes"]
        assert prop["minimum"] == 1

    def test_lease_maximum_is_1440(self) -> None:
        prop = TICKETS_CLAIM_SCHEMA["properties"]["lease_duration_minutes"]
        assert prop["maximum"] == 1440


# ---------------------------------------------------------------------------
# tickets.claim — Service layer tests
# ---------------------------------------------------------------------------


class TestTicketServiceClaimById:
    """TicketService.claim_by_id unit tests."""

    @pytest.mark.asyncio()
    async def test_claim_by_id_returns_result(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        result = await ticket_service.claim_by_id(
            ticket_id="FORGEOS-BE099",
            agent_role="backend",
            machine_id="host",
            operator="op",
        )
        assert isinstance(result, NextTicketResult)
        assert result.ticket_id == "FORGEOS-BE099"

    @pytest.mark.asyncio()
    async def test_claim_by_id_raises_on_not_claimable(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = None
        with pytest.raises(NoEligibleTicketError):
            await ticket_service.claim_by_id(
                ticket_id="FORGEOS-BE099",
                agent_role="backend",
                machine_id="host",
                operator="op",
            )

    @pytest.mark.asyncio()
    async def test_claim_by_id_raises_on_unknown_role(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        with pytest.raises(ValueError, match="Unknown agent role"):
            await ticket_service.claim_by_id(
                ticket_id="FORGEOS-BE099",
                agent_role="invalid_role",
                machine_id="host",
                operator="op",
            )

    @pytest.mark.asyncio()
    async def test_claim_by_id_calls_role_stage_authorization(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        """claim_by_id must call check_role_stage_authorization (CWE-862 fix)."""
        from mcp_server.auth.authorization import RoleStageMismatchError

        with (
            patch(
                "mcp_server.services.ticket_service.check_role_stage_authorization",
                side_effect=RoleStageMismatchError(
                    "Role 'backend' not authorized for stage 'QA'",
                    details={"agent_role": "backend", "ticket_stage": "QA"},
                ),
            ),
            pytest.raises(RoleStageMismatchError),
        ):
            await ticket_service.claim_by_id(
                    ticket_id="FORGEOS-BE099",
                    agent_role="backend",
                    machine_id="host",
                    operator="op",
                )
        mock_claim_queue.claim_by_id.assert_not_awaited()

    @pytest.mark.asyncio()
    async def test_claim_by_id_propagates_claim_error(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.side_effect = ClaimError(
            "FILE_CONFLICT: file locked",
            details={"ticket_id": "T-001"},
        )
        with pytest.raises(ClaimError):
            await ticket_service.claim_by_id(
                ticket_id="FORGEOS-BE099",
                agent_role="backend",
                machine_id="host",
                operator="op",
            )

    @pytest.mark.asyncio()
    async def test_claim_by_id_passes_custom_lease(
        self,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        await ticket_service.claim_by_id(
            ticket_id="FORGEOS-BE099",
            agent_role="backend",
            machine_id="host",
            operator="op",
            lease_minutes=45,
        )
        call_kwargs = mock_claim_queue.claim_by_id.call_args
        assert call_kwargs.kwargs["lease_minutes"] == 45


# ---------------------------------------------------------------------------
# tickets.claim — Registry integration
# ---------------------------------------------------------------------------


class TestClaimRegistryIntegration:
    """End-to-end: register, lookup, and invoke tickets.claim via registry."""

    @pytest.mark.asyncio()
    async def test_invoke_claim_handler_success(
        self,
        registry: ToolRegistry,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = _CLAIM_RESULT
        register_ticket_tools(registry, ticket_service)
        defn = registry.get_or_raise(CLAIM_TOOL_NAME)
        result = await defn.handler(_valid_claim_params())
        assert result["ticket_id"] == "FORGEOS-BE099"

    @pytest.mark.asyncio()
    async def test_invoke_claim_handler_not_claimable(
        self,
        registry: ToolRegistry,
        mock_claim_queue: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_queue.claim_by_id.return_value = None
        register_ticket_tools(registry, ticket_service)
        defn = registry.get_or_raise(CLAIM_TOOL_NAME)
        result = await defn.handler(_valid_claim_params())
        assert result["isError"] is True

    @pytest.mark.asyncio()
    async def test_invoke_claim_handler_validation_error(
        self,
        registry: ToolRegistry,
        ticket_service: TicketService,
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get_or_raise(CLAIM_TOOL_NAME)
        with pytest.raises(ToolInputValidationError):
            await defn.handler({})
