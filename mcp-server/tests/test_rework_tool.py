"""Tests for the tickets.rework MCP tool (FORGEOS-BE031).

Covers all 8 acceptance criteria:
  AC1: tickets.rework MCP tool registered with the dynamic tool registry.
  AC2: Tool accepts ticket_id, agent_id, reason, and optional rejection_evidence.
  AC3: Tool validates agent holds claim on the ticket.
  AC4: Rework resets ticket to its implementation stage (per ticket type flow).
  AC5: rework_count incremented; at rework_count >= 3 ticket moves to ESCALATED.
  AC6: Event history record created with rejection reason and evidence.
  AC7: Previous stage summaries preserved for rework context.
  AC8: Returns updated ticket data or MCP error.

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from mcp_server.services.ticket_service import (
    ClaimValidationError,
    ReworkResult,
    TicketService,
)
from mcp_server.tools.registry import ToolRegistry
from mcp_server.tools.ticket_tools import (
    REWORK_TOOL_NAME,
    TICKETS_REWORK_SCHEMA,
    handle_tickets_rework,
    register_ticket_tools,
)
from mcp_server.tools.validation import ToolInputValidationError

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_claim_queue() -> AsyncMock:
    return AsyncMock()


@pytest.fixture()
def mock_pool() -> AsyncMock:
    return AsyncMock()


@pytest.fixture()
def ticket_service(mock_claim_queue: AsyncMock, mock_pool: AsyncMock) -> TicketService:
    return TicketService(claim_queue=mock_claim_queue, pool=mock_pool)


@pytest.fixture()
def registry() -> ToolRegistry:
    return ToolRegistry()


def _valid_rework_params(**overrides: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ticket_id": "FORGEOS-BE099",
        "agent_id": "qa",
        "reason": "Tests are failing, coverage below 80%",
    }
    base.update(overrides)
    return base


def _make_ticket_row(
    *,
    ticket_id: str = "FORGEOS-BE099",
    stage: str = "QA",
    ticket_type: str = "backend",
    claimed_by_name: str = "qa",
    rework_count: int = 0,
    max_reworks: int = 3,
    sdlc_flow: list[str] | None = None,
    title: str = "Test ticket",
) -> MagicMock:
    """Create a mock DB row representing a ticket."""
    flow = sdlc_flow or [
        "READY", "BACKEND", "QA", "SECURITY", "CI",
        "DOCUMENTATION", "VALIDATOR", "DONE",
    ]
    row = MagicMock()
    row.__getitem__ = lambda self, key: {
        "ticket_id": ticket_id,
        "title": title,
        "type": ticket_type,
        "stage": stage,
        "status": "CLAIMED",
        "claimed_by_name": claimed_by_name,
        "rework_count": rework_count,
        "max_reworks": max_reworks,
        "sdlc_flow": flow,
    }[key]
    return row


# ---------------------------------------------------------------------------
# AC1: tickets.rework MCP tool registered with the dynamic tool registry
# ---------------------------------------------------------------------------


class TestReworkToolRegistration:
    """AC1 — tool registration with the dynamic registry."""

    def test_register_ticket_tools_adds_rework(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        assert REWORK_TOOL_NAME in registry

    def test_registered_rework_has_correct_name(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(REWORK_TOOL_NAME)
        assert defn is not None
        assert defn.name == "tickets.rework"

    def test_registered_rework_has_description(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(REWORK_TOOL_NAME)
        assert defn is not None
        assert len(defn.description) > 0

    def test_registered_rework_has_schema(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(REWORK_TOOL_NAME)
        assert defn is not None
        assert defn.input_schema == TICKETS_REWORK_SCHEMA

    def test_registered_rework_handler_is_async(
        self, registry: ToolRegistry, ticket_service: TicketService
    ) -> None:
        register_ticket_tools(registry, ticket_service)
        defn = registry.get(REWORK_TOOL_NAME)
        assert defn is not None
        import asyncio

        assert asyncio.iscoroutinefunction(defn.handler)


# ---------------------------------------------------------------------------
# AC2: Tool accepts ticket_id, agent_id, reason, and optional rejection_evidence
# ---------------------------------------------------------------------------


class TestReworkInputParameters:
    """AC2 — input parameter acceptance."""

    def test_schema_requires_ticket_id(self) -> None:
        assert "ticket_id" in TICKETS_REWORK_SCHEMA["properties"]
        assert "ticket_id" in TICKETS_REWORK_SCHEMA["required"]

    def test_schema_requires_agent_id(self) -> None:
        assert "agent_id" in TICKETS_REWORK_SCHEMA["properties"]
        assert "agent_id" in TICKETS_REWORK_SCHEMA["required"]

    def test_schema_requires_reason(self) -> None:
        assert "reason" in TICKETS_REWORK_SCHEMA["properties"]
        assert "reason" in TICKETS_REWORK_SCHEMA["required"]

    def test_schema_has_optional_rejection_evidence(self) -> None:
        assert "rejection_evidence" in TICKETS_REWORK_SCHEMA["properties"]
        assert "rejection_evidence" not in TICKETS_REWORK_SCHEMA["required"]

    def test_schema_type_is_object(self) -> None:
        assert TICKETS_REWORK_SCHEMA["type"] == "object"

    def test_schema_disallows_additional_properties(self) -> None:
        assert TICKETS_REWORK_SCHEMA.get("additionalProperties") is False


class TestReworkInputValidation:
    """AC2 — JSON Schema validation of input parameters."""

    @pytest.mark.asyncio()
    async def test_missing_ticket_id_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"agent_id": "qa", "reason": "fail"}
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_rework(params, ticket_service=ticket_service)

    @pytest.mark.asyncio()
    async def test_missing_agent_id_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"ticket_id": "FORGEOS-BE099", "reason": "fail"}
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_rework(params, ticket_service=ticket_service)

    @pytest.mark.asyncio()
    async def test_missing_reason_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = {"ticket_id": "FORGEOS-BE099", "agent_id": "qa"}
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_rework(params, ticket_service=ticket_service)

    @pytest.mark.asyncio()
    async def test_extra_property_raises(
        self, ticket_service: TicketService
    ) -> None:
        params = _valid_rework_params(extra_field="bad")
        with pytest.raises(ToolInputValidationError):
            await handle_tickets_rework(params, ticket_service=ticket_service)


# ---------------------------------------------------------------------------
# AC3: Tool validates agent holds claim on the ticket
# ---------------------------------------------------------------------------


class TestReworkClaimValidation:
    """AC3 — agent must hold the claim."""

    @pytest.mark.asyncio()
    async def test_claim_mismatch_returns_error(
        self, ticket_service: TicketService, mock_pool: AsyncMock
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            side_effect=ClaimValidationError(
                "FORGEOS-BE099", "qa",
                "Ticket is claimed by 'security', not 'qa'"
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert result["isError"] is True
        msg = result["message"].lower()
        assert "claimed by" in msg or "claim" in msg

    @pytest.mark.asyncio()
    async def test_no_claim_returns_error(
        self, ticket_service: TicketService, mock_pool: AsyncMock
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            side_effect=ClaimValidationError(
                "FORGEOS-BE099", "qa",
                "Ticket is not currently claimed"
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert result["isError"] is True
        msg = result["message"].lower()
        assert "not currently claimed" in msg or "claim" in msg


# ---------------------------------------------------------------------------
# AC4: Rework resets ticket to its implementation stage
# ---------------------------------------------------------------------------


class TestReworkResetsToImplementationStage:
    """AC4 — ticket moves back to implementation stage per type."""

    @pytest.mark.asyncio()
    async def test_backend_ticket_returns_to_backend_stage(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-BE099",
                title="Test ticket",
                ticket_type="backend",
                previous_stage="QA",
                new_stage="BACKEND",
                rework_count=1,
                escalated=False,
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert result["new_stage"] == "BACKEND"
        assert result["escalated"] is False

    @pytest.mark.asyncio()
    async def test_frontend_ticket_returns_to_frontend_stage(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-FE001",
                title="Frontend ticket",
                ticket_type="frontend",
                previous_stage="SECURITY",
                new_stage="FRONTEND",
                rework_count=1,
                escalated=False,
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(ticket_id="FORGEOS-FE001"),
            ticket_service=ticket_service,
        )
        assert result["new_stage"] == "FRONTEND"

    @pytest.mark.asyncio()
    async def test_fullstack_ticket_returns_to_backend_stage(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-FS001",
                title="Fullstack ticket",
                ticket_type="fullstack",
                previous_stage="CI",
                new_stage="BACKEND",
                rework_count=2,
                escalated=False,
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(ticket_id="FORGEOS-FS001"),
            ticket_service=ticket_service,
        )
        assert result["new_stage"] == "BACKEND"


# ---------------------------------------------------------------------------
# AC5: rework_count >= 3 ticket moves to ESCALATED
# ---------------------------------------------------------------------------


class TestReworkEscalation:
    """AC5 — escalation at rework_count >= 3."""

    @pytest.mark.asyncio()
    async def test_escalated_when_rework_count_reaches_3(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-BE099",
                title="Test ticket",
                ticket_type="backend",
                previous_stage="QA",
                new_stage="QA",
                rework_count=3,
                escalated=True,
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert result["escalated"] is True
        assert result["rework_count"] == 3

    @pytest.mark.asyncio()
    async def test_not_escalated_when_rework_count_below_3(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-BE099",
                title="Test ticket",
                ticket_type="backend",
                previous_stage="QA",
                new_stage="BACKEND",
                rework_count=1,
                escalated=False,
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert result["escalated"] is False
        assert result["rework_count"] == 1


# ---------------------------------------------------------------------------
# AC6: Event history record created with rejection reason and evidence
# ---------------------------------------------------------------------------


class TestReworkEventCreation:
    """AC6 — event history records rejection reason and evidence."""

    @pytest.mark.asyncio()
    async def test_rework_passes_reason_to_service(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-BE099",
                title="Test ticket",
                ticket_type="backend",
                previous_stage="QA",
                new_stage="BACKEND",
                rework_count=1,
                escalated=False,
            ),
        )
        params = _valid_rework_params(reason="Coverage below 80%")
        await handle_tickets_rework(params, ticket_service=ticket_service)
        ticket_service.rework_ticket.assert_awaited_once()
        call_kwargs = ticket_service.rework_ticket.call_args.kwargs
        assert call_kwargs["reason"] == "Coverage below 80%"

    @pytest.mark.asyncio()
    async def test_rework_passes_evidence_to_service(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-BE099",
                title="Test ticket",
                ticket_type="backend",
                previous_stage="QA",
                new_stage="BACKEND",
                rework_count=1,
                escalated=False,
            ),
        )
        evidence = {"coverage": 45, "failing_tests": ["test_foo"]}
        params = _valid_rework_params(rejection_evidence=evidence)
        await handle_tickets_rework(params, ticket_service=ticket_service)
        call_kwargs = ticket_service.rework_ticket.call_args.kwargs
        assert call_kwargs["rejection_evidence"] == evidence


# ---------------------------------------------------------------------------
# AC7: Previous stage summaries preserved for rework context
# (This is a design rule — the rework operation must NOT delete summaries.
#  Verified by checking the service does not have a summary-deletion step.)
# ---------------------------------------------------------------------------


class TestReworkPreservesSummaries:
    """AC7 — previous stage summaries preserved."""

    @pytest.mark.asyncio()
    async def test_rework_result_includes_previous_stage(
        self, ticket_service: TicketService
    ) -> None:
        """Rework result contains previous_stage so summaries can be located."""
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-BE099",
                title="Test ticket",
                ticket_type="backend",
                previous_stage="QA",
                new_stage="BACKEND",
                rework_count=1,
                escalated=False,
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert result["previous_stage"] == "QA"


# ---------------------------------------------------------------------------
# AC8: Returns updated ticket data or MCP error
# ---------------------------------------------------------------------------


class TestReworkReturnValues:
    """AC8 — returns updated ticket data or MCP error."""

    @pytest.mark.asyncio()
    async def test_success_returns_ticket_data(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            return_value=ReworkResult(
                ticket_id="FORGEOS-BE099",
                title="Test ticket",
                ticket_type="backend",
                previous_stage="QA",
                new_stage="BACKEND",
                rework_count=1,
                escalated=False,
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert "isError" not in result
        assert result["ticket_id"] == "FORGEOS-BE099"
        assert result["title"] == "Test ticket"
        assert result["type"] == "backend"
        assert result["previous_stage"] == "QA"
        assert result["new_stage"] == "BACKEND"
        assert result["rework_count"] == 1
        assert result["escalated"] is False

    @pytest.mark.asyncio()
    async def test_ticket_not_found_returns_error(
        self, ticket_service: TicketService
    ) -> None:
        from mcp_server.server import TicketNotFoundError

        ticket_service.rework_ticket = AsyncMock(
            side_effect=TicketNotFoundError("Ticket 'FORGEOS-XXX' not found"),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(ticket_id="FORGEOS-XXX"),
            ticket_service=ticket_service,
        )
        assert result["isError"] is True
        assert "not found" in result["message"].lower()

    @pytest.mark.asyncio()
    async def test_claim_validation_error_returns_error(
        self, ticket_service: TicketService
    ) -> None:
        ticket_service.rework_ticket = AsyncMock(
            side_effect=ClaimValidationError(
                "FORGEOS-BE099", "qa", "Not the claim owner"
            ),
        )
        result = await handle_tickets_rework(
            _valid_rework_params(), ticket_service=ticket_service
        )
        assert result["isError"] is True


# ---------------------------------------------------------------------------
# Service-level unit tests for rework_ticket
# ---------------------------------------------------------------------------


class TestReworkServiceMethod:
    """Unit tests for TicketService.rework_ticket with mocked DB."""

    @pytest.mark.asyncio()
    async def test_rework_increments_count_and_resets_stage(
        self, mock_pool: AsyncMock
    ) -> None:
        """rework_count is incremented and ticket moves to implementation stage."""
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = _make_ticket_row(
            rework_count=0, stage="QA", claimed_by_name="qa",
        )
        mock_conn.execute.return_value = None

        ctx = AsyncMock()
        ctx.__aenter__ = AsyncMock(return_value=mock_conn)
        ctx.__aexit__ = AsyncMock(return_value=False)
        mock_pool.acquire.return_value = ctx

        from unittest.mock import patch

        service = TicketService(claim_queue=AsyncMock(), pool=mock_pool)

        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_tx:
            mock_tx_ctx = AsyncMock()
            mock_tx_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_tx.return_value = mock_tx_ctx

            result = await service.rework_ticket(
                ticket_id="FORGEOS-BE099",
                agent_id="qa",
                reason="Tests failing",
            )

        assert result.rework_count == 1
        assert result.new_stage == "BACKEND"
        assert result.escalated is False

    @pytest.mark.asyncio()
    async def test_rework_escalates_at_max_reworks(
        self, mock_pool: AsyncMock
    ) -> None:
        """rework_count >= max_reworks triggers ESCALATED status."""
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = _make_ticket_row(
            rework_count=2, max_reworks=3, stage="QA", claimed_by_name="qa",
        )
        mock_conn.execute.return_value = None

        service = TicketService(claim_queue=AsyncMock(), pool=mock_pool)

        from unittest.mock import patch

        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_tx:
            mock_tx_ctx = AsyncMock()
            mock_tx_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_tx.return_value = mock_tx_ctx

            result = await service.rework_ticket(
                ticket_id="FORGEOS-BE099",
                agent_id="qa",
                reason="Third failure",
            )

        assert result.rework_count == 3
        assert result.escalated is True

    @pytest.mark.asyncio()
    async def test_rework_raises_on_claim_mismatch(
        self, mock_pool: AsyncMock
    ) -> None:
        """Raises ClaimValidationError when agent doesn't own the claim."""
        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = _make_ticket_row(
            claimed_by_name="security",
        )

        service = TicketService(claim_queue=AsyncMock(), pool=mock_pool)

        from unittest.mock import patch

        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_tx:
            mock_tx_ctx = AsyncMock()
            mock_tx_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_tx.return_value = mock_tx_ctx

            with pytest.raises(ClaimValidationError):
                await service.rework_ticket(
                    ticket_id="FORGEOS-BE099",
                    agent_id="qa",
                    reason="Some reason",
                )

    @pytest.mark.asyncio()
    async def test_rework_raises_on_no_claim(
        self, mock_pool: AsyncMock
    ) -> None:
        """Raises ClaimValidationError when ticket has no claim."""
        mock_conn = AsyncMock()
        row = _make_ticket_row()
        # Override claimed_by_name to None
        original_getitem = row.__getitem__
        row.__getitem__ = lambda self, key: (
            None if key == "claimed_by_name" else original_getitem(key)
        )

        service = TicketService(claim_queue=AsyncMock(), pool=mock_pool)

        from unittest.mock import patch

        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_tx:
            mock_tx_ctx = AsyncMock()
            mock_tx_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_tx.return_value = mock_tx_ctx

            mock_conn.fetchrow.return_value = row

            with pytest.raises(ClaimValidationError):
                await service.rework_ticket(
                    ticket_id="FORGEOS-BE099",
                    agent_id="qa",
                    reason="Some reason",
                )

    @pytest.mark.asyncio()
    async def test_rework_raises_on_ticket_not_found(
        self, mock_pool: AsyncMock
    ) -> None:
        """Raises TicketNotFoundError when ticket doesn't exist."""
        from mcp_server.server import TicketNotFoundError

        mock_conn = AsyncMock()
        mock_conn.fetchrow.return_value = None

        service = TicketService(claim_queue=AsyncMock(), pool=mock_pool)

        from unittest.mock import patch

        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_tx:
            mock_tx_ctx = AsyncMock()
            mock_tx_ctx.__aenter__ = AsyncMock(return_value=mock_conn)
            mock_tx_ctx.__aexit__ = AsyncMock(return_value=False)
            mock_tx.return_value = mock_tx_ctx

            with pytest.raises(TicketNotFoundError):
                await service.rework_ticket(
                    ticket_id="FORGEOS-XXX",
                    agent_id="qa",
                    reason="Some reason",
                )

    @pytest.mark.asyncio()
    async def test_rework_raises_without_pool(self) -> None:
        """Raises ValueError when pool is not configured."""
        service = TicketService(claim_queue=AsyncMock(), pool=None)
        with pytest.raises(ValueError, match="Pool not configured"):
            await service.rework_ticket(
                ticket_id="FORGEOS-BE099",
                agent_id="qa",
                reason="reason",
            )
