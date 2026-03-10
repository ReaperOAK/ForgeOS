"""Tests for the tickets.release and tickets.status MCP tools (FORGEOS-BE032).

Covers all 7 acceptance criteria:
  AC1: tickets.release MCP tool registered and accepts ticket_id and agent_id.
  AC2: Release validates the requesting agent holds the active claim.
  AC3: Released ticket moves back to READY stage with claim cleared.
  AC4: Release creates an event history record with release reason.
  AC5: tickets.status MCP tool registered and accepts optional ticket_id or filters.
  AC6: Status with ticket_id returns full ticket detail including history and claim.
  AC7: Status with filters returns a paginated list of matching tickets.

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock

import pytest

from mcp_server.locking.claim_queue import ClaimQueue
from mcp_server.repositories.claim_repo import ClaimInfo
from mcp_server.repositories.event_repo import EventRow
from mcp_server.repositories.ticket_repo import TicketRow
from mcp_server.server import TicketNotFoundError
from mcp_server.services.ticket_service import (
    ClaimOwnershipError,
    ReleaseResult,
    TicketDetail,
    TicketListResult,
    TicketService,
)
from mcp_server.tools.registry import ToolRegistry
from mcp_server.tools.ticket_tools import (
    RELEASE_TOOL_NAME,
    STATUS_TOOL_NAME,
    TICKETS_RELEASE_SCHEMA,
    TICKETS_STATUS_SCHEMA,
    handle_tickets_release,
    handle_tickets_status,
    register_ticket_tools,
)
from mcp_server.tools.validation import ToolInputValidationError

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_AGENT_UUID = uuid.uuid4()

_CLAIM_INFO = ClaimInfo(
    ticket_id="FORGEOS-BE099",
    claimed_by=_AGENT_UUID,
    claimed_by_name="backend",
    machine_id="test-host",
    operator="TestOperator",
    lease_expiry=datetime(2026, 3, 11, 12, 0, 0, tzinfo=timezone.utc),
    lease_duration_minutes=30,
)

_TICKET_ROW = TicketRow(
    id=uuid.uuid4(),
    ticket_id="FORGEOS-BE099",
    project_id=None,
    title="Test ticket",
    description="A test ticket for release and status",
    type="backend",
    priority="high",
    status="CLAIMED",
    stage="BACKEND",
    sdlc_flow=["READY", "BACKEND", "QA"],
    claimed_by=_AGENT_UUID,
    claimed_by_name="backend",
    machine_id="test-host",
    operator="TestOperator",
    lease_expiry=datetime(2026, 3, 11, 12, 0, 0, tzinfo=timezone.utc),
    lease_duration_minutes=30,
    depends_on=["FORGEOS-BE001"],
    file_paths=["src/server.py"],
    acceptance_criteria=["AC1: Implement feature"],
    tags=["backend"],
    rework_count=0,
    max_reworks=3,
    metadata={},
    parent_id=None,
    source_task_file=None,
    created_at=datetime(2026, 3, 10, 12, 0, 0, tzinfo=timezone.utc),
    updated_at=datetime(2026, 3, 11, 10, 0, 0, tzinfo=timezone.utc),
    completed_at=None,
)

_EVENT_ROW = EventRow(
    id=uuid.uuid4(),
    ticket_id="FORGEOS-BE099",
    event_type="CLAIMED",
    agent_id=_AGENT_UUID,
    agent_name="backend",
    machine_id="test-host",
    operator="TestOperator",
    previous_stage="READY",
    new_stage="BACKEND",
    previous_status="READY",
    new_status="CLAIMED",
    payload={},
    created_at=datetime(2026, 3, 11, 10, 0, 0, tzinfo=timezone.utc),
)


@pytest.fixture()
def mock_claim_queue() -> AsyncMock:
    return AsyncMock(spec=ClaimQueue)


@pytest.fixture()
def mock_claim_repo() -> AsyncMock:
    repo = AsyncMock()
    repo.get_active_claim = AsyncMock(return_value=_CLAIM_INFO)
    repo.release_claim = AsyncMock(return_value=True)
    return repo


@pytest.fixture()
def mock_ticket_repo() -> AsyncMock:
    repo = AsyncMock()
    repo.get_by_id = AsyncMock(return_value=_TICKET_ROW)
    repo.list_by_stage = AsyncMock(return_value=[_TICKET_ROW])
    repo.list_by_type = AsyncMock(return_value=[_TICKET_ROW])
    repo.list_filtered = AsyncMock(return_value=[_TICKET_ROW])
    return repo


@pytest.fixture()
def mock_event_repo() -> AsyncMock:
    repo = AsyncMock()
    repo.get_events_by_ticket = AsyncMock(return_value=[_EVENT_ROW])
    repo.append_event = AsyncMock(return_value=_EVENT_ROW)
    return repo


@pytest.fixture()
def ticket_service(
    mock_claim_queue: AsyncMock,
    mock_claim_repo: AsyncMock,
    mock_ticket_repo: AsyncMock,
    mock_event_repo: AsyncMock,
) -> TicketService:
    return TicketService(
        claim_queue=mock_claim_queue,
        claim_repo=mock_claim_repo,
        ticket_repo=mock_ticket_repo,
        event_repo=mock_event_repo,
    )


@pytest.fixture()
def registry() -> ToolRegistry:
    return ToolRegistry()


def _release_params(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ticket_id": "FORGEOS-BE099",
        "agent_id": "backend",
    }
    base.update(overrides)
    return base


def _status_params(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {}
    base.update(overrides)
    return base


# ===========================================================================
# AC1: tickets.release MCP tool registered and accepts ticket_id and agent_id
# ===========================================================================


class TestReleaseToolRegistration:
    """AC1 — tickets.release tool registration."""

    def test_release_tool_registered(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        assert RELEASE_TOOL_NAME in registry

    def test_release_tool_has_correct_name(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(RELEASE_TOOL_NAME)
        assert defn is not None
        assert defn.name == "tickets.release"

    def test_release_tool_has_description(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(RELEASE_TOOL_NAME)
        assert defn is not None
        assert len(defn.description) > 0

    def test_release_tool_has_schema(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(RELEASE_TOOL_NAME)
        assert defn is not None
        assert defn.input_schema == TICKETS_RELEASE_SCHEMA

    def test_schema_requires_ticket_id(self) -> None:
        assert "ticket_id" in TICKETS_RELEASE_SCHEMA["properties"]
        assert "ticket_id" in TICKETS_RELEASE_SCHEMA["required"]

    def test_schema_requires_agent_id(self) -> None:
        assert "agent_id" in TICKETS_RELEASE_SCHEMA["properties"]
        assert "agent_id" in TICKETS_RELEASE_SCHEMA["required"]

    def test_schema_has_optional_reason(self) -> None:
        assert "reason" in TICKETS_RELEASE_SCHEMA["properties"]
        assert "reason" not in TICKETS_RELEASE_SCHEMA["required"]

    def test_schema_disallows_additional_properties(self) -> None:
        assert TICKETS_RELEASE_SCHEMA.get("additionalProperties") is False


# ===========================================================================
# AC2: Release validates the requesting agent holds the active claim
# ===========================================================================


class TestReleaseOwnershipValidation:
    """AC2 — claim ownership validation on release."""

    async def test_release_with_matching_agent_succeeds(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        assert "ticket_id" in result
        assert result.get("isError") is not True

    async def test_release_with_wrong_agent_returns_error(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_release(
            _release_params(agent_id="wrong_agent"), ticket_service=ticket_service
        )
        assert result["isError"] is True
        assert "wrong_agent" in result["message"]

    async def test_release_with_no_active_claim_returns_error(
        self,
        mock_claim_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_repo.get_active_claim.return_value = None
        result = await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        assert result["isError"] is True
        assert "no active claim" in result["message"]

    async def test_release_nonexistent_ticket_returns_error(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_ticket_repo.get_by_id.return_value = None
        result = await handle_tickets_release(
            _release_params(ticket_id="FORGEOS-NONEXIST"),
            ticket_service=ticket_service,
        )
        assert result["isError"] is True
        assert "not found" in result["message"]

    async def test_release_validates_input_schema(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_release({}, ticket_service=ticket_service)

    async def test_release_rejects_extra_fields(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_release(
                _release_params(extra="bad"), ticket_service=ticket_service
            )


# ===========================================================================
# AC3: Released ticket moves back to READY stage with claim cleared
# ===========================================================================


class TestReleaseMovesToReady:
    """AC3 — ticket moves back to READY on release."""

    async def test_release_calls_release_claim(
        self,
        mock_claim_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        mock_claim_repo.release_claim.assert_awaited_once_with("FORGEOS-BE099")

    async def test_release_result_has_previous_stage(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        assert result["previous_stage"] == "BACKEND"

    async def test_release_result_has_released_by(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        assert result["released_by"] == "backend"


# ===========================================================================
# AC4: Release creates an event history record with release reason
# ===========================================================================


class TestReleaseCreatesEvent:
    """AC4 — RELEASED event recorded in audit trail."""

    async def test_release_appends_event(
        self,
        mock_event_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        await handle_tickets_release(
            _release_params(reason="No longer needed"),
            ticket_service=ticket_service,
        )
        mock_event_repo.append_event.assert_awaited_once()

    async def test_release_event_has_correct_type(
        self,
        mock_event_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        await handle_tickets_release(
            _release_params(reason="Switching focus"),
            ticket_service=ticket_service,
        )
        call_kwargs = mock_event_repo.append_event.call_args.kwargs
        assert call_kwargs["event_type"] == "RELEASED"

    async def test_release_event_includes_reason(
        self,
        mock_event_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        await handle_tickets_release(
            _release_params(reason="Switching focus"),
            ticket_service=ticket_service,
        )
        call_kwargs = mock_event_repo.append_event.call_args.kwargs
        assert call_kwargs["payload"]["reason"] == "Switching focus"

    async def test_release_event_has_stage_transition(
        self,
        mock_event_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        call_kwargs = mock_event_repo.append_event.call_args.kwargs
        assert call_kwargs["previous_stage"] == "BACKEND"
        assert call_kwargs["new_stage"] == "READY"

    async def test_release_event_has_status_transition(
        self,
        mock_event_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        call_kwargs = mock_event_repo.append_event.call_args.kwargs
        assert call_kwargs["previous_status"] == "CLAIMED"
        assert call_kwargs["new_status"] == "READY"

    async def test_release_without_reason_has_empty_payload(
        self,
        mock_event_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        call_kwargs = mock_event_repo.append_event.call_args.kwargs
        assert call_kwargs["payload"] == {}

    async def test_release_result_includes_reason(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_release(
            _release_params(reason="Done with it"),
            ticket_service=ticket_service,
        )
        assert result["reason"] == "Done with it"


# ===========================================================================
# AC5: tickets.status MCP tool registered and accepts optional params
# ===========================================================================


class TestStatusToolRegistration:
    """AC5 — tickets.status tool registration and schema."""

    def test_status_tool_registered(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        assert STATUS_TOOL_NAME in registry

    def test_status_tool_has_correct_name(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(STATUS_TOOL_NAME)
        assert defn is not None
        assert defn.name == "tickets.status"

    def test_status_tool_has_description(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(STATUS_TOOL_NAME)
        assert defn is not None
        assert len(defn.description) > 0

    def test_status_tool_has_schema(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(STATUS_TOOL_NAME)
        assert defn is not None
        assert defn.input_schema == TICKETS_STATUS_SCHEMA

    def test_schema_has_optional_ticket_id(self) -> None:
        assert "ticket_id" in TICKETS_STATUS_SCHEMA["properties"]
        # Not required — it's optional
        assert "required" not in TICKETS_STATUS_SCHEMA or \
            "ticket_id" not in TICKETS_STATUS_SCHEMA.get("required", [])

    def test_schema_has_stage_filter(self) -> None:
        assert "stage" in TICKETS_STATUS_SCHEMA["properties"]

    def test_schema_has_type_filter(self) -> None:
        assert "type" in TICKETS_STATUS_SCHEMA["properties"]

    def test_schema_has_priority_filter(self) -> None:
        assert "priority" in TICKETS_STATUS_SCHEMA["properties"]

    def test_schema_has_page_param(self) -> None:
        assert "page" in TICKETS_STATUS_SCHEMA["properties"]

    def test_schema_has_page_size_param(self) -> None:
        assert "page_size" in TICKETS_STATUS_SCHEMA["properties"]

    def test_schema_disallows_additional_properties(self) -> None:
        assert TICKETS_STATUS_SCHEMA.get("additionalProperties") is False

    def test_empty_params_accepted(self) -> None:
        """Empty params should be valid — returns all tickets."""
        from mcp_server.tools.validation import validate_tool_input

        # Should not raise
        validate_tool_input(STATUS_TOOL_NAME, TICKETS_STATUS_SCHEMA, {})


# ===========================================================================
# AC6: Status with ticket_id returns full detail with history and claim
# ===========================================================================


class TestStatusSingleTicket:
    """AC6 — ticket detail with history and current claim."""

    async def test_status_by_ticket_id_returns_detail(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert result["ticket_id"] == "FORGEOS-BE099"
        assert "history" in result
        assert "current_claim" in result

    async def test_status_detail_includes_title(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert result["title"] == "Test ticket"

    async def test_status_detail_includes_description(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert "description" in result

    async def test_status_detail_includes_stage(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert result["stage"] == "BACKEND"

    async def test_status_detail_includes_history(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert len(result["history"]) == 1
        assert result["history"][0]["event_type"] == "CLAIMED"

    async def test_status_detail_includes_current_claim(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert result["current_claim"] is not None
        assert result["current_claim"]["claimed_by_name"] == "backend"

    async def test_status_detail_without_claim(
        self,
        mock_claim_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_repo.get_active_claim.return_value = None
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert result["current_claim"] is None

    async def test_status_unknown_ticket_returns_error(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_ticket_repo.get_by_id.return_value = None
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-NONEXIST"),
            ticket_service=ticket_service,
        )
        assert result["isError"] is True
        assert "not found" in result["message"]

    async def test_status_detail_includes_file_paths(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert result["file_paths"] == ["src/server.py"]

    async def test_status_detail_includes_acceptance_criteria(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(ticket_id="FORGEOS-BE099"),
            ticket_service=ticket_service,
        )
        assert result["acceptance_criteria"] == ["AC1: Implement feature"]


# ===========================================================================
# AC7: Status with filters returns a paginated list of matching tickets
# ===========================================================================


class TestStatusFilteredList:
    """AC7 — paginated filtered ticket listing."""

    async def test_status_without_ticket_id_returns_list(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(), ticket_service=ticket_service
        )
        assert "tickets" in result
        assert "total" in result
        assert "page" in result
        assert "page_size" in result

    async def test_status_list_contains_tickets(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(), ticket_service=ticket_service
        )
        assert len(result["tickets"]) == 1
        assert result["tickets"][0]["ticket_id"] == "FORGEOS-BE099"

    async def test_status_list_with_stage_filter(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        result = await handle_tickets_status(
            _status_params(stage="BACKEND"),
            ticket_service=ticket_service,
        )
        mock_ticket_repo.list_by_stage.assert_awaited_once()
        assert "tickets" in result

    async def test_status_list_with_type_filter(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        result = await handle_tickets_status(
            _status_params(type="backend"),
            ticket_service=ticket_service,
        )
        mock_ticket_repo.list_by_type.assert_awaited_once()
        assert "tickets" in result

    async def test_status_list_with_combined_filters(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        result = await handle_tickets_status(
            _status_params(stage="BACKEND", type="backend"),
            ticket_service=ticket_service,
        )
        mock_ticket_repo.list_filtered.assert_awaited_once()
        assert "tickets" in result

    async def test_status_list_pagination_params(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(page=2, page_size=10),
            ticket_service=ticket_service,
        )
        assert result["page"] == 2
        assert result["page_size"] == 10

    async def test_status_list_default_pagination(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(), ticket_service=ticket_service
        )
        assert result["page"] == 1
        assert result["page_size"] == 20

    async def test_status_list_ticket_shape(
        self, ticket_service: TicketService
    ) -> None:
        result = await handle_tickets_status(
            _status_params(), ticket_service=ticket_service
        )
        ticket = result["tickets"][0]
        expected_keys = {"ticket_id", "title", "type", "priority", "stage", "status"}
        assert set(ticket.keys()) == expected_keys


# ===========================================================================
# Service-layer unit tests
# ===========================================================================


class TestTicketServiceRelease:
    """TicketService.release_ticket unit tests."""

    async def test_release_result_type(self, ticket_service: TicketService) -> None:
        result = await ticket_service.release_ticket(
            ticket_id="FORGEOS-BE099",
            agent_id="backend",
            reason="test",
        )
        assert isinstance(result, ReleaseResult)

    async def test_release_result_to_dict(self, ticket_service: TicketService) -> None:
        result = await ticket_service.release_ticket(
            ticket_id="FORGEOS-BE099",
            agent_id="backend",
            reason="test",
        )
        d = result.to_dict()
        assert d["ticket_id"] == "FORGEOS-BE099"
        assert d["released_by"] == "backend"
        assert d["reason"] == "test"

    async def test_release_raises_ticket_not_found(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_ticket_repo.get_by_id.return_value = None
        with pytest.raises(TicketNotFoundError):
            await ticket_service.release_ticket(
                ticket_id="FORGEOS-NONEXIST",
                agent_id="backend",
            )

    async def test_release_raises_no_active_claim(
        self,
        mock_claim_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_claim_repo.get_active_claim.return_value = None
        with pytest.raises(ClaimOwnershipError):
            await ticket_service.release_ticket(
                ticket_id="FORGEOS-BE099",
                agent_id="backend",
            )

    async def test_release_raises_wrong_agent(
        self, ticket_service: TicketService
    ) -> None:
        with pytest.raises(ClaimOwnershipError, match="wrong_agent"):
            await ticket_service.release_ticket(
                ticket_id="FORGEOS-BE099",
                agent_id="wrong_agent",
            )

    async def test_release_without_repos_raises_runtime(
        self, mock_claim_queue: AsyncMock
    ) -> None:
        service = TicketService(claim_queue=mock_claim_queue)
        with pytest.raises(RuntimeError, match="Repositories not configured"):
            await service.release_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )


class TestTicketServiceStatus:
    """TicketService.get_ticket_status and list_tickets unit tests."""

    async def test_get_ticket_status_returns_detail(
        self, ticket_service: TicketService
    ) -> None:
        result = await ticket_service.get_ticket_status(ticket_id="FORGEOS-BE099")
        assert isinstance(result, TicketDetail)
        assert result.ticket_id == "FORGEOS-BE099"

    async def test_get_ticket_status_to_dict(
        self, ticket_service: TicketService
    ) -> None:
        result = await ticket_service.get_ticket_status(ticket_id="FORGEOS-BE099")
        d = result.to_dict()
        assert d["ticket_id"] == "FORGEOS-BE099"
        assert "history" in d
        assert "current_claim" in d

    async def test_get_ticket_status_not_found(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        mock_ticket_repo.get_by_id.return_value = None
        with pytest.raises(TicketNotFoundError):
            await ticket_service.get_ticket_status(ticket_id="NONEXIST")

    async def test_list_tickets_returns_list_result(
        self, ticket_service: TicketService
    ) -> None:
        result = await ticket_service.list_tickets()
        assert isinstance(result, TicketListResult)

    async def test_list_tickets_to_dict(
        self, ticket_service: TicketService
    ) -> None:
        result = await ticket_service.list_tickets()
        d = result.to_dict()
        assert "tickets" in d
        assert "total" in d
        assert "page" in d
        assert "page_size" in d

    async def test_release_result_is_frozen(self) -> None:
        result = ReleaseResult(
            ticket_id="TEST",
            previous_stage="BACKEND",
            released_by="backend",
            reason="",
        )
        with pytest.raises(AttributeError):
            result.ticket_id = "CHANGED"  # type: ignore[misc]

    async def test_ticket_detail_is_frozen(self) -> None:
        detail = TicketDetail(
            ticket_id="TEST",
            title="Test",
            description="Test",
            ticket_type="backend",
            priority="high",
            stage="BACKEND",
            status="CLAIMED",
        )
        with pytest.raises(AttributeError):
            detail.ticket_id = "CHANGED"  # type: ignore[misc]

    async def test_list_without_repos_raises_runtime(
        self, mock_claim_queue: AsyncMock
    ) -> None:
        service = TicketService(claim_queue=mock_claim_queue)
        with pytest.raises(RuntimeError, match="Repositories not configured"):
            await service.list_tickets()

    async def test_status_without_repos_raises_runtime(
        self, mock_claim_queue: AsyncMock
    ) -> None:
        service = TicketService(claim_queue=mock_claim_queue)
        with pytest.raises(RuntimeError, match="Repositories not configured"):
            await service.get_ticket_status(ticket_id="TEST")


# ===========================================================================
# QA gap tests — additional coverage for edge paths (FORGEOS-BE032 QA)
# ===========================================================================


class TestReleaseStatusGapCoverage:
    """Gap tests added by QA to cover edge paths and strengthen coverage."""

    async def test_status_with_priority_filter_only(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        """Priority-only filter routes to list_filtered, not list_by_stage."""
        result = await handle_tickets_status(
            _status_params(priority="high"),
            ticket_service=ticket_service,
        )
        mock_ticket_repo.list_filtered.assert_awaited_once()
        assert "tickets" in result

    async def test_status_with_priority_and_stage(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        """Combined stage + priority routes to list_filtered."""
        result = await handle_tickets_status(
            _status_params(stage="QA", priority="critical"),
            ticket_service=ticket_service,
        )
        mock_ticket_repo.list_filtered.assert_awaited_once()
        assert "tickets" in result

    async def test_release_default_reason_is_empty(
        self, ticket_service: TicketService
    ) -> None:
        """Release without explicit reason yields empty-string reason."""
        result = await handle_tickets_release(
            _release_params(), ticket_service=ticket_service
        )
        assert result["reason"] == ""

    async def test_release_handler_via_registry(
        self,
        registry: ToolRegistry,
        ticket_service: TicketService,
    ) -> None:
        """Invoke the release tool through the registry closure."""
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(RELEASE_TOOL_NAME)
        assert defn is not None
        result = await defn.handler(_release_params())
        assert result["ticket_id"] == "FORGEOS-BE099"

    async def test_status_handler_via_registry_list(
        self,
        registry: ToolRegistry,
        ticket_service: TicketService,
    ) -> None:
        """Invoke the status tool through the registry closure — list mode."""
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(STATUS_TOOL_NAME)
        assert defn is not None
        result = await defn.handler({})
        assert "tickets" in result

    async def test_status_handler_via_registry_detail(
        self,
        registry: ToolRegistry,
        ticket_service: TicketService,
    ) -> None:
        """Invoke the status tool through the registry closure — detail mode."""
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(STATUS_TOOL_NAME)
        assert defn is not None
        result = await defn.handler({"ticket_id": "FORGEOS-BE099"})
        assert result["ticket_id"] == "FORGEOS-BE099"

    async def test_release_result_to_dict_keys(
        self, ticket_service: TicketService
    ) -> None:
        """Verify ReleaseResult.to_dict() contains all expected keys."""
        result = await ticket_service.release_ticket(
            ticket_id="FORGEOS-BE099",
            agent_id="backend",
            reason="cleanup",
        )
        d = result.to_dict()
        assert set(d.keys()) == {"ticket_id", "previous_stage", "released_by", "reason"}

    async def test_ticket_list_result_to_dict_keys(
        self, ticket_service: TicketService
    ) -> None:
        """Verify TicketListResult.to_dict() contains all expected keys."""
        result = await ticket_service.list_tickets()
        d = result.to_dict()
        assert set(d.keys()) == {"tickets", "total", "page", "page_size"}

    async def test_ticket_detail_to_dict_keys(
        self, ticket_service: TicketService
    ) -> None:
        """Verify TicketDetail.to_dict() contains all expected keys."""
        result = await ticket_service.get_ticket_status(ticket_id="FORGEOS-BE099")
        d = result.to_dict()
        expected = {
            "ticket_id", "title", "description", "type", "priority",
            "stage", "status", "file_paths", "acceptance_criteria",
            "depends_on", "current_claim", "history",
        }
        assert set(d.keys()) == expected

    async def test_list_tickets_stage_only_delegates_correctly(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        """Stage-only filter at service level calls list_by_stage."""
        await ticket_service.list_tickets(stage="QA")
        mock_ticket_repo.list_by_stage.assert_awaited_once()

    async def test_list_tickets_type_only_delegates_correctly(
        self,
        mock_ticket_repo: AsyncMock,
        ticket_service: TicketService,
    ) -> None:
        """Type-only filter at service level calls list_by_type."""
        await ticket_service.list_tickets(ticket_type="backend")
        mock_ticket_repo.list_by_type.assert_awaited_once()
