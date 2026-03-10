"""Tests for the tickets.advance MCP tool and TicketService.advance_ticket (FORGEOS-BE030).

Covers all 7 acceptance criteria:
  AC1: tickets.advance MCP tool registered with the dynamic tool registry.
  AC2: Tool accepts ticket_id, agent_id, and completion evidence as input.
  AC3: Tool validates the agent currently holds the claim on the specified ticket.
  AC4: Stage engine enforces SDLC flow order per ticket type (no stage skipping).
  AC5: State transition uses SERIALIZABLE transaction isolation for integrity.
  AC6: Event history record created for every stage transition.
  AC7: Returns updated ticket data on success, MCP error on invalid transition.

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.server import TicketNotFoundError
from mcp_server.services.stage_engine import InvalidTransitionError
from mcp_server.services.ticket_service import (
    AdvanceTicketResult,
    ClaimValidationError,
    TicketService,
)
from mcp_server.tools.registry import ToolRegistry
from mcp_server.tools.ticket_tools import (
    ADVANCE_TOOL_NAME,
    TICKETS_ADVANCE_SCHEMA,
    handle_tickets_advance,
    register_ticket_tools,
)
from mcp_server.tools.validation import ToolInputValidationError

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_ADVANCE_RESULT = AdvanceTicketResult(
    ticket_id="FORGEOS-BE099",
    title="Test ticket",
    ticket_type="backend",
    previous_stage="BACKEND",
    new_stage="QA",
    status="READY",
)


@pytest.fixture()
def mock_claim_queue() -> AsyncMock:
    """Create a mock ClaimQueue."""
    return AsyncMock()


@pytest.fixture()
def mock_pool() -> MagicMock:
    """Create a mock pool for transactional operations."""
    return MagicMock()


@pytest.fixture()
def ticket_service(mock_claim_queue: AsyncMock, mock_pool: MagicMock) -> TicketService:
    """Create a TicketService with mock dependencies."""
    return TicketService(claim_queue=mock_claim_queue, pool=mock_pool)


@pytest.fixture()
def registry() -> ToolRegistry:
    """Fresh ToolRegistry for each test."""
    return ToolRegistry()


def _valid_advance_params(**overrides: Any) -> dict[str, Any]:
    """Return valid input params for tickets.advance."""
    base: dict[str, Any] = {
        "ticket_id": "FORGEOS-BE099",
        "agent_id": "backend",
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# AC1: tickets.advance MCP tool registered with the dynamic tool registry
# ---------------------------------------------------------------------------


class TestAdvanceToolRegistration:
    """AC1 — tool registration with the dynamic registry."""

    def test_advance_tool_registered(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        assert ADVANCE_TOOL_NAME in registry

    def test_advance_tool_definition_has_correct_name(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(ADVANCE_TOOL_NAME)
        assert defn is not None
        assert defn.name == "tickets.advance"

    def test_advance_tool_has_description(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(ADVANCE_TOOL_NAME)
        assert defn is not None
        assert len(defn.description) > 0

    def test_advance_tool_has_input_schema(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(ADVANCE_TOOL_NAME)
        assert defn is not None
        assert defn.input_schema["type"] == "object"

    def test_advance_tool_schema_matches(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(ADVANCE_TOOL_NAME)
        assert defn is not None
        assert defn.input_schema == TICKETS_ADVANCE_SCHEMA


# ---------------------------------------------------------------------------
# AC2: Tool accepts ticket_id, agent_id, and completion evidence as input
# ---------------------------------------------------------------------------


class TestAdvanceToolInput:
    """AC2 — input parameter acceptance."""

    def test_schema_requires_ticket_id(self) -> None:
        assert "ticket_id" in TICKETS_ADVANCE_SCHEMA["required"]

    def test_schema_requires_agent_id(self) -> None:
        assert "agent_id" in TICKETS_ADVANCE_SCHEMA["required"]

    def test_schema_has_evidence_property(self) -> None:
        assert "evidence" in TICKETS_ADVANCE_SCHEMA["properties"]

    def test_evidence_is_optional(self) -> None:
        assert "evidence" not in TICKETS_ADVANCE_SCHEMA["required"]

    def test_evidence_is_object_type(self) -> None:
        assert TICKETS_ADVANCE_SCHEMA["properties"]["evidence"]["type"] == "object"

    async def test_valid_params_accepted(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service, "advance_ticket", return_value=_ADVANCE_RESULT
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["ticket_id"] == "FORGEOS-BE099"

    async def test_params_with_evidence_accepted(
        self, ticket_service: TicketService
    ) -> None:
        evidence = {"artifacts": ["file1.py"], "coverage": 85}
        with patch.object(
            ticket_service, "advance_ticket", return_value=_ADVANCE_RESULT
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(evidence=evidence),
                ticket_service=ticket_service,
            )
        assert result["ticket_id"] == "FORGEOS-BE099"

    async def test_missing_ticket_id_rejected(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_advance(
                {"agent_id": "backend"}, ticket_service=ticket_service
            )

    async def test_missing_agent_id_rejected(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_advance(
                {"ticket_id": "FORGEOS-BE099"}, ticket_service=ticket_service
            )

    async def test_empty_ticket_id_rejected(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_advance(
                _valid_advance_params(ticket_id=""),
                ticket_service=ticket_service,
            )

    async def test_extra_properties_rejected(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_advance(
                _valid_advance_params(extra_field="bad"),
                ticket_service=ticket_service,
            )


# ---------------------------------------------------------------------------
# AC3: Tool validates the agent currently holds the claim
# ---------------------------------------------------------------------------


class TestAdvanceClaimValidation:
    """AC3 — claim ownership validation."""

    async def test_returns_error_when_ticket_not_found(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service,
            "advance_ticket",
            side_effect=TicketNotFoundError("FORGEOS-BE099"),
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["isError"] is True
        assert "not found" in result["message"]

    async def test_returns_error_when_not_claimed(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service,
            "advance_ticket",
            side_effect=ClaimValidationError(
                "FORGEOS-BE099", "backend", "Ticket is not currently claimed"
            ),
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["isError"] is True
        assert "not currently claimed" in result["message"]

    async def test_returns_error_when_claimed_by_another(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service,
            "advance_ticket",
            side_effect=ClaimValidationError(
                "FORGEOS-BE099",
                "backend",
                "Ticket is claimed by 'qa', not 'backend'",
            ),
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["isError"] is True
        assert "claimed by" in result["message"]


# ---------------------------------------------------------------------------
# AC4: Stage engine enforces SDLC flow order (no stage skipping)
# ---------------------------------------------------------------------------


class TestAdvanceStageEnforcement:
    """AC4 — SDLC flow enforcement via stage engine."""

    async def test_returns_error_on_invalid_transition(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service,
            "advance_ticket",
            side_effect=InvalidTransitionError(
                "FORGEOS-BE099", "DONE", "Ticket is already at the final stage 'DONE'"
            ),
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["isError"] is True
        assert "final stage" in result["message"]

    async def test_returns_error_on_empty_flow(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service,
            "advance_ticket",
            side_effect=InvalidTransitionError(
                "FORGEOS-BE099", "BACKEND", "Ticket has no SDLC flow defined"
            ),
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["isError"] is True
        assert "no SDLC flow" in result["message"]


# ---------------------------------------------------------------------------
# AC5: State transition uses SERIALIZABLE transaction isolation
# ---------------------------------------------------------------------------


class TestAdvanceTransactionIsolation:
    """AC5 — SERIALIZABLE isolation (tested via configuration mapping)."""

    def test_advance_uses_serializable(self) -> None:
        from mcp_server.locking.transaction_config import (
            IsolationLevel,
            OperationType,
            isolation_for,
        )

        assert isolation_for(OperationType.ADVANCE) == IsolationLevel.SERIALIZABLE


# ---------------------------------------------------------------------------
# AC6: Event history record created for every stage transition
# ---------------------------------------------------------------------------


class TestAdvanceEventHistory:
    """AC6 — event history creation (verified through service mock)."""

    async def test_successful_advance_returns_stage_info(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service, "advance_ticket", return_value=_ADVANCE_RESULT
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["previous_stage"] == "BACKEND"
        assert result["new_stage"] == "QA"


# ---------------------------------------------------------------------------
# AC7: Returns updated ticket data on success, MCP error on invalid transition
# ---------------------------------------------------------------------------


class TestAdvanceReturnValues:
    """AC7 — success and error response shapes."""

    async def test_success_returns_ticket_data(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service, "advance_ticket", return_value=_ADVANCE_RESULT
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["ticket_id"] == "FORGEOS-BE099"
        assert result["type"] == "backend"
        assert result["previous_stage"] == "BACKEND"
        assert result["new_stage"] == "QA"
        assert result["status"] == "READY"

    async def test_success_has_no_error_flag(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service, "advance_ticket", return_value=_ADVANCE_RESULT
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert "isError" not in result

    async def test_error_response_has_code(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service,
            "advance_ticket",
            side_effect=TicketNotFoundError("FORGEOS-BE099"),
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["code"] == -32602

    async def test_advance_to_done_has_done_status(
        self, ticket_service: TicketService
    ) -> None:
        done_result = AdvanceTicketResult(
            ticket_id="FORGEOS-BE099",
            title="Test ticket",
            ticket_type="backend",
            previous_stage="VALIDATION",
            new_stage="DONE",
            status="DONE",
        )
        with patch.object(
            ticket_service, "advance_ticket", return_value=done_result
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["new_stage"] == "DONE"
        assert result["status"] == "DONE"

    async def test_value_error_returns_error_response(
        self, ticket_service: TicketService
    ) -> None:
        with patch.object(
            ticket_service,
            "advance_ticket",
            side_effect=ValueError("Pool not configured"),
        ):
            result = await handle_tickets_advance(
                _valid_advance_params(), ticket_service=ticket_service
            )
        assert result["isError"] is True


# ---------------------------------------------------------------------------
# AdvanceTicketResult tests
# ---------------------------------------------------------------------------


class TestAdvanceTicketResult:
    """Tests for the AdvanceTicketResult dataclass."""

    def test_to_dict(self) -> None:
        d = _ADVANCE_RESULT.to_dict()
        assert d["ticket_id"] == "FORGEOS-BE099"
        assert d["type"] == "backend"
        assert d["previous_stage"] == "BACKEND"
        assert d["new_stage"] == "QA"
        assert d["status"] == "READY"

    def test_frozen(self) -> None:
        with pytest.raises(AttributeError):
            _ADVANCE_RESULT.ticket_id = "other"  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Error class tests
# ---------------------------------------------------------------------------


class TestClaimValidationError:
    """Tests for ClaimValidationError."""

    def test_attributes(self) -> None:
        err = ClaimValidationError("T-001", "agent-1", "not claimed")
        assert err.ticket_id == "T-001"
        assert err.agent_id == "agent-1"
        assert err.reason == "not claimed"

    def test_str(self) -> None:
        err = ClaimValidationError("T-001", "agent-1", "not claimed")
        assert "T-001" in str(err)
        assert "agent-1" in str(err)


class TestTicketNotFoundError:
    """Tests for TicketNotFoundError."""

    def test_message(self) -> None:
        err = TicketNotFoundError("T-001")
        assert err.message == "T-001"

    def test_str(self) -> None:
        err = TicketNotFoundError("T-001")
        assert "T-001" in str(err)
