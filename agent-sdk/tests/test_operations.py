"""Tests for TicketOperations — high-level ticket API.

Covers all acceptance criteria:
  AC1: claim_next(role) calls tickets.next MCP tool and returns a Ticket model
  AC2: claim(ticket_id) calls tickets.claim MCP tool and returns a Ticket model
  AC3: advance(ticket_id, evidence) calls tickets.advance (tickets.complete) and returns Ticket
  AC4: rework(ticket_id, reason) calls tickets.rework (tickets.reject) and returns Ticket
  AC5: release(ticket_id) calls tickets.release and returns confirmation
  AC6: get_ticket(ticket_id) calls tickets.status and returns Ticket model
  AC7: All methods are async (async def) and usable in asyncio event loops
  AC8: Pydantic models define Ticket, Claim, OperationResult with proper field types

TDD approach: RED -> GREEN -> REFACTOR.
"""

from __future__ import annotations

import inspect
import json
from typing import Any
from unittest.mock import AsyncMock, MagicMock, PropertyMock

import pytest

from forgeos_sdk.client import ForgeOSClient
from forgeos_sdk.exceptions import ToolCallError
from forgeos_sdk.models import Evidence, OperationResult, Ticket
from forgeos_sdk.operations import TicketOperations

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _text_content(data: dict[str, Any] | str) -> MagicMock:
    """Create a MagicMock mimicking ``TextContent``."""
    content = MagicMock()
    content.text = data if isinstance(data, str) else json.dumps(data)
    return content


def _call_result(
    data: dict[str, Any] | str,
    *,
    is_error: bool = False,
) -> MagicMock:
    """Create a MagicMock mimicking ``CallToolResult``."""
    result = MagicMock()
    result.content = [_text_content(data)]
    result.isError = is_error
    return result


@pytest.fixture()
def mock_session() -> AsyncMock:
    """Mock MCP ``ClientSession``."""
    return AsyncMock()


@pytest.fixture()
def mock_client(mock_session: AsyncMock) -> MagicMock:
    """Mock ``ForgeOSClient`` with a connected session."""
    client = MagicMock(spec=ForgeOSClient)
    client.agent_id = "test-agent"
    type(client).session = PropertyMock(return_value=mock_session)
    return client


@pytest.fixture()
def ops(mock_client: MagicMock) -> TicketOperations:
    """TicketOperations wired to a mocked client."""
    return TicketOperations(mock_client)


# ---------------------------------------------------------------------------
# AC1: claim_next(role) calls tickets.next MCP tool and returns a Ticket
# ---------------------------------------------------------------------------


class TestClaimNext:
    """AC1 — claim_next calls tickets.next and returns Ticket."""

    async def test_returns_ticket_model(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {
                "ticket": {
                    "ticket_id": "FORGEOS-BE003",
                    "title": "Connection Pool",
                    "type": "backend",
                    "priority": "high",
                    "status": "READY",
                    "stage": "BACKEND",
                },
                "message": "OK",
            }
        )

        ticket = await ops.claim_next("BACKEND")

        assert isinstance(ticket, Ticket)
        assert ticket.ticket_id == "FORGEOS-BE003"
        assert ticket.stage == "BACKEND"
        mock_session.call_tool.assert_called_once_with(
            "tickets.next", {"stage": "BACKEND"}
        )

    async def test_passes_optional_params(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}, "message": "OK"}
        )

        await ops.claim_next("QA", machine_id="host-1", operator="alice")

        mock_session.call_tool.assert_called_once_with(
            "tickets.next",
            {"stage": "QA", "machine_id": "host-1", "operator": "alice"},
        )

    async def test_null_ticket_raises(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": None, "message": "No tickets available"}
        )

        with pytest.raises(ToolCallError, match="No tickets available"):
            await ops.claim_next("BACKEND")

    async def test_error_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "DB unavailable"}, is_error=True
        )

        with pytest.raises(ToolCallError):
            await ops.claim_next("BACKEND")

    async def test_flat_response_parsed(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        """Python MCP server returns flat dict (no ``ticket`` wrapper)."""
        mock_session.call_tool.return_value = _call_result(
            {
                "ticket_id": "T-2",
                "title": "Flat",
                "status": "CLAIMED",
                "stage": "BACKEND",
            }
        )

        ticket = await ops.claim_next("BACKEND")
        assert ticket.ticket_id == "T-2"


# ---------------------------------------------------------------------------
# AC2: claim(ticket_id) calls tickets.claim MCP tool and returns a Ticket
# ---------------------------------------------------------------------------


class TestClaim:
    """AC2 — claim calls tickets.claim and returns Ticket."""

    async def test_returns_ticket_model(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {
                "ticket": {
                    "ticket_id": "T-1",
                    "status": "CLAIMED",
                    "stage": "BACKEND",
                },
                "lease_expiry": "2026-03-07T09:30:00Z",
                "file_locks": ["src/pool.ts"],
            }
        )

        ticket = await ops.claim("T-1", agent_name="Backend")

        assert isinstance(ticket, Ticket)
        assert ticket.status == "CLAIMED"
        mock_session.call_tool.assert_called_once_with(
            "tickets.claim",
            {
                "ticket_id": "T-1",
                "agent_name": "Backend",
                "machine_id": "unknown",
            },
        )

    async def test_defaults_agent_name_from_client(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.claim("T-1")

        args = mock_session.call_tool.call_args[0][1]
        assert args["agent_name"] == "test-agent"

    async def test_passes_optional_params(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.claim(
            "T-1",
            agent_name="QA",
            machine_id="host-2",
            operator="bob",
            lease_minutes=60,
        )

        args = mock_session.call_tool.call_args[0][1]
        assert args["operator"] == "bob"
        assert args["lease_minutes"] == 60
        assert args["machine_id"] == "host-2"

    async def test_error_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "ALREADY_CLAIMED"}, is_error=True
        )

        with pytest.raises(ToolCallError):
            await ops.claim("T-1")


# ---------------------------------------------------------------------------
# AC3: advance(ticket_id, evidence) calls tickets.complete and returns Ticket
# ---------------------------------------------------------------------------


class TestAdvance:
    """AC3 — advance calls tickets.complete and returns Ticket."""

    async def test_returns_updated_ticket(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {
                "ticket": {
                    "ticket_id": "T-1",
                    "status": "READY",
                    "stage": "QA",
                },
                "previous_stage": "BACKEND",
                "new_stage": "QA",
                "dependencies_unblocked": ["T-2"],
            }
        )

        evidence = Evidence(
            artifacts=["src/main.py"],
            test_results="12 pass, 0 fail. Coverage: 94%",
            confidence="HIGH",
        )
        ticket = await ops.advance("T-1", evidence)

        assert isinstance(ticket, Ticket)
        assert ticket.stage == "QA"

    async def test_calls_tickets_complete(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        evidence = Evidence(
            artifacts=["a.py"],
            test_results="pass",
            confidence="MEDIUM",
            notes="Refactored",
        )
        await ops.advance("T-1", evidence)

        call_args = mock_session.call_tool.call_args[0]
        assert call_args[0] == "tickets.complete"
        assert call_args[1]["ticket_id"] == "T-1"
        assert call_args[1]["evidence"]["confidence"] == "MEDIUM"
        assert call_args[1]["evidence"]["notes"] == "Refactored"

    async def test_evidence_excludes_none_notes(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        evidence = Evidence(
            artifacts=["a.py"],
            test_results="pass",
            confidence="HIGH",
        )
        await ops.advance("T-1", evidence)

        payload = mock_session.call_tool.call_args[0][1]["evidence"]
        assert "notes" not in payload

    async def test_error_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "LEASE_EXPIRED"}, is_error=True
        )

        evidence = Evidence(
            artifacts=["a.py"], test_results="pass", confidence="HIGH"
        )
        with pytest.raises(ToolCallError):
            await ops.advance("T-1", evidence)


# ---------------------------------------------------------------------------
# AC4: rework(ticket_id, reason) calls tickets.reject and returns Ticket
# ---------------------------------------------------------------------------


class TestRework:
    """AC4 — rework calls tickets.reject and returns Ticket."""

    async def test_returns_ticket(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {
                "ticket": {
                    "ticket_id": "T-1",
                    "status": "READY",
                    "stage": "BACKEND",
                    "rework_count": 1,
                },
                "rework_count": 1,
                "escalated": False,
                "returned_to_stage": "BACKEND",
            }
        )

        ticket = await ops.rework("T-1", "Coverage below 80%")

        assert isinstance(ticket, Ticket)
        assert ticket.rework_count == 1

    async def test_calls_tickets_reject(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.rework("T-1", "Test failures in error paths")

        call_args = mock_session.call_tool.call_args[0]
        assert call_args[0] == "tickets.reject"
        assert call_args[1]["ticket_id"] == "T-1"
        assert call_args[1]["reason"] == "Test failures in error paths"

    async def test_passes_optional_evidence(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.rework(
            "T-1",
            "Coverage too low",
            evidence={"coverage": 62, "required": 80},
        )

        args = mock_session.call_tool.call_args[0][1]
        assert args["evidence"]["coverage"] == 62

    async def test_no_evidence_omitted(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.rework("T-1", "Some reason")

        args = mock_session.call_tool.call_args[0][1]
        assert "evidence" not in args


# ---------------------------------------------------------------------------
# AC5: release(ticket_id) calls tickets.release and returns confirmation
# ---------------------------------------------------------------------------


class TestRelease:
    """AC5 — release calls tickets.release and returns OperationResult."""

    async def test_returns_operation_result(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {
                "ticket": {"ticket_id": "T-1", "status": "READY"},
                "released_file_locks": ["src/pool.ts"],
            }
        )

        result = await ops.release("T-1")

        assert isinstance(result, OperationResult)
        assert result.success is True
        assert result.ticket is not None
        assert result.ticket.ticket_id == "T-1"

    async def test_calls_tickets_release(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.release("T-1")

        call_args = mock_session.call_tool.call_args[0]
        assert call_args[0] == "tickets.release"
        assert call_args[1]["ticket_id"] == "T-1"
        assert call_args[1]["agent_name"] == "test-agent"

    async def test_passes_optional_reason(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.release("T-1", reason="Switching priority")

        args = mock_session.call_tool.call_args[0][1]
        assert args["reason"] == "Switching priority"

    async def test_passes_force_flag(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.release("T-1", force=True)

        args = mock_session.call_tool.call_args[0][1]
        assert args["force"] is True

    async def test_error_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "NOT_CLAIM_OWNER"}, is_error=True
        )

        with pytest.raises(ToolCallError):
            await ops.release("T-1")


# ---------------------------------------------------------------------------
# AC6: get_ticket(ticket_id) calls tickets.status and returns Ticket model
# ---------------------------------------------------------------------------


class TestGetTicket:
    """AC6 — get_ticket calls tickets.status and returns Ticket."""

    async def test_returns_ticket(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {
                "ticket": {
                    "ticket_id": "T-1",
                    "title": "Test Ticket",
                    "status": "CLAIMED",
                    "stage": "BACKEND",
                    "priority": "high",
                }
            }
        )

        ticket = await ops.get_ticket("T-1")

        assert isinstance(ticket, Ticket)
        assert ticket.ticket_id == "T-1"
        assert ticket.title == "Test Ticket"

    async def test_calls_tickets_status(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"ticket": {"ticket_id": "T-1"}}
        )

        await ops.get_ticket("T-1")

        mock_session.call_tool.assert_called_once_with(
            "tickets.status", {"ticket_id": "T-1"}
        )

    async def test_error_raises(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        mock_session.call_tool.return_value = _call_result(
            {"error": "TICKET_NOT_FOUND"}, is_error=True
        )

        with pytest.raises(ToolCallError):
            await ops.get_ticket("NONEXISTENT")


# ---------------------------------------------------------------------------
# AC7: All methods are async (async def)
# ---------------------------------------------------------------------------


class TestAsyncMethods:
    """AC7 — verify all public methods are async coroutines."""

    def test_claim_next_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.claim_next)

    def test_claim_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.claim)

    def test_advance_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.advance)

    def test_rework_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.rework)

    def test_release_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.release)

    def test_get_ticket_is_coroutine(self) -> None:
        assert inspect.iscoroutinefunction(TicketOperations.get_ticket)


# ---------------------------------------------------------------------------
# Edge cases: disconnected client, malformed responses
# ---------------------------------------------------------------------------


class TestEdgeCases:
    """Error handling and edge case coverage."""

    async def test_disconnected_client_raises(self) -> None:
        client = MagicMock(spec=ForgeOSClient)
        type(client).session = PropertyMock(return_value=None)
        ops = TicketOperations(client)

        with pytest.raises(ToolCallError, match="not connected"):
            await ops.claim_next("BACKEND")

    async def test_invalid_json_response_raises(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        result = MagicMock()
        content = MagicMock()
        content.text = "not valid json"
        result.content = [content]
        result.isError = False
        mock_session.call_tool.return_value = result

        with pytest.raises(ToolCallError, match="Invalid JSON"):
            await ops.claim_next("BACKEND")

    async def test_empty_content_returns_empty_dict(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        result = MagicMock()
        result.content = []
        result.isError = False
        mock_session.call_tool.return_value = result

        # _call_tool returns {} for empty content, _parse_ticket will fail
        # on missing ticket_id — but _call_tool itself should not raise
        data = await ops._call_tool("tickets.test", {})
        assert data == {}

    async def test_error_with_empty_text(
        self, ops: TicketOperations, mock_session: AsyncMock
    ) -> None:
        result = MagicMock()
        result.content = []
        result.isError = True
        mock_session.call_tool.return_value = result

        with pytest.raises(ToolCallError, match="Unknown error"):
            await ops._call_tool("tickets.test", {})
