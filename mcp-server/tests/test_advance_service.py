"""Gap tests for TicketService.advance_ticket (FORGEOS-BE030).

These tests exercise the advance_ticket() method body directly by
mocking the transactional context manager and asyncpg connection.
The existing test_advance_tool.py tests the handler layer via
service-level mocking; these tests cover the service logic itself.
"""

from __future__ import annotations

import json
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

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_ticket_row(
    *,
    ticket_id: str = "FORGEOS-BE099",
    title: str = "Test ticket",
    ticket_type: str = "backend",
    stage: str = "BACKEND",
    sdlc_flow: list[str] | None = None,
    claimed_by_name: str | None = "backend",
) -> dict[str, Any]:
    """Build a fake asyncpg Row-like dict."""
    if sdlc_flow is None:
        sdlc_flow = ["READY", "BACKEND", "QA", "SECURITY", "CI", "DOCS", "VALIDATION", "DONE"]
    return {
        "ticket_id": ticket_id,
        "title": title,
        "type": ticket_type,
        "stage": stage,
        "sdlc_flow": sdlc_flow,
        "claimed_by_name": claimed_by_name,
    }


def _mock_conn(fetchrow_return: Any = None) -> AsyncMock:
    """Create a mock connection that acts like an asyncpg connection."""
    conn = AsyncMock()
    conn.fetchrow = AsyncMock(return_value=fetchrow_return)
    conn.execute = AsyncMock()
    return conn


@pytest.fixture()
def pool() -> MagicMock:
    return MagicMock()


@pytest.fixture()
def service(pool: MagicMock) -> TicketService:
    return TicketService(claim_queue=AsyncMock(), pool=pool)


# ---------------------------------------------------------------------------
# Pool not configured
# ---------------------------------------------------------------------------


class TestAdvanceTicketPoolGuard:
    """advance_ticket raises ValueError when pool is None."""

    async def test_raises_when_no_pool(self) -> None:
        svc = TicketService(claim_queue=AsyncMock(), pool=None)
        with pytest.raises(ValueError, match="Pool not configured"):
            await svc.advance_ticket(ticket_id="T-1", agent_id="backend")


# ---------------------------------------------------------------------------
# Ticket not found
# ---------------------------------------------------------------------------


class TestAdvanceTicketNotFound:
    """advance_ticket raises TicketNotFoundError when row is None."""

    async def test_raises_when_ticket_missing(self, service: TicketService) -> None:
        conn = _mock_conn(fetchrow_return=None)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(TicketNotFoundError, match="FORGEOS-BE099"):
                await service.advance_ticket(
                    ticket_id="FORGEOS-BE099", agent_id="backend"
                )


# ---------------------------------------------------------------------------
# Claim validation
# ---------------------------------------------------------------------------


class TestAdvanceClaimValidationService:
    """advance_ticket validates claim ownership at the service layer."""

    async def test_raises_when_no_claim(self, service: TicketService) -> None:
        row = _make_ticket_row(claimed_by_name=None)
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(ClaimValidationError, match="not currently claimed"):
                await service.advance_ticket(
                    ticket_id="FORGEOS-BE099", agent_id="backend"
                )

    async def test_raises_when_different_agent(self, service: TicketService) -> None:
        row = _make_ticket_row(claimed_by_name="qa")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(ClaimValidationError, match="claimed by 'qa'"):
                await service.advance_ticket(
                    ticket_id="FORGEOS-BE099", agent_id="backend"
                )


# ---------------------------------------------------------------------------
# Stage engine enforcement (through service)
# ---------------------------------------------------------------------------


class TestAdvanceStageEnforcementService:
    """advance_ticket delegates to validate_advance for SDLC flow checks."""

    async def test_raises_at_final_stage(self, service: TicketService) -> None:
        row = _make_ticket_row(stage="DONE")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(InvalidTransitionError, match="final stage"):
                await service.advance_ticket(
                    ticket_id="FORGEOS-BE099", agent_id="backend"
                )

    async def test_raises_on_empty_flow(self, service: TicketService) -> None:
        row = _make_ticket_row(sdlc_flow=[], stage="BACKEND")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            with pytest.raises(InvalidTransitionError, match="no SDLC flow"):
                await service.advance_ticket(
                    ticket_id="FORGEOS-BE099", agent_id="backend"
                )


# ---------------------------------------------------------------------------
# Successful advance
# ---------------------------------------------------------------------------


class TestAdvanceTicketSuccess:
    """advance_ticket returns correct result and performs DB writes."""

    async def test_returns_advance_result(self, service: TicketService) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )

        assert isinstance(result, AdvanceTicketResult)
        assert result.ticket_id == "FORGEOS-BE099"
        assert result.previous_stage == "BACKEND"
        assert result.new_stage == "QA"
        assert result.status == "READY"
        assert result.title == "Test ticket"
        assert result.ticket_type == "backend"

    async def test_updates_ticket_in_db(self, service: TicketService) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )

        # Two execute calls: UPDATE tickets + INSERT events
        assert conn.execute.call_count == 2
        update_call = conn.execute.call_args_list[0]
        assert "UPDATE tickets" in update_call.args[0]
        assert update_call.args[1] == "FORGEOS-BE099"
        assert update_call.args[2] == "QA"
        assert update_call.args[3] == "READY"

    async def test_inserts_event_record(self, service: TicketService) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )

        insert_call = conn.execute.call_args_list[1]
        assert "INSERT INTO events" in insert_call.args[0]
        assert insert_call.args[1] == "FORGEOS-BE099"
        assert insert_call.args[2] == "STAGE_ADVANCED"
        assert insert_call.args[3] == "backend"
        assert insert_call.args[4] == "BACKEND"  # previous_stage
        assert insert_call.args[5] == "QA"  # new_stage

    async def test_event_payload_empty_without_evidence(
        self, service: TicketService
    ) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )

        insert_call = conn.execute.call_args_list[1]
        payload_json = insert_call.args[8]
        assert json.loads(payload_json) == {}

    async def test_event_payload_includes_evidence(
        self, service: TicketService
    ) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        evidence = {"artifacts": ["file1.py"], "coverage": 85}
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            await service.advance_ticket(
                ticket_id="FORGEOS-BE099",
                agent_id="backend",
                evidence=evidence,
            )

        insert_call = conn.execute.call_args_list[1]
        payload_json = insert_call.args[8]
        payload = json.loads(payload_json)
        assert payload["evidence"] == evidence

    async def test_advance_to_done_sets_done_status(
        self, service: TicketService
    ) -> None:
        row = _make_ticket_row(stage="VALIDATION", claimed_by_name="validator")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            result = await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="validator"
            )

        assert result.new_stage == "DONE"
        assert result.status == "DONE"

    async def test_advance_clears_claim_fields(self, service: TicketService) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )

        update_sql = conn.execute.call_args_list[0].args[0]
        assert "claimed_by = NULL" in update_sql
        assert "claimed_by_name = NULL" in update_sql
        assert "machine_id = NULL" in update_sql
        assert "operator = NULL" in update_sql
        assert "lease_expiry = NULL" in update_sql

    async def test_advance_uses_transactional_with_advance_op(
        self, service: TicketService
    ) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )

        from mcp_server.locking.transaction_config import OperationType

        mock_txn.assert_called_once()
        call_args = mock_txn.call_args
        assert call_args.args[1] == OperationType.ADVANCE

    async def test_fetchrow_uses_for_update(self, service: TicketService) -> None:
        row = _make_ticket_row(stage="BACKEND", claimed_by_name="backend")
        conn = _mock_conn(fetchrow_return=row)
        with patch(
            "mcp_server.services.ticket_service.transactional"
        ) as mock_txn:
            mock_txn.return_value.__aenter__ = AsyncMock(return_value=conn)
            mock_txn.return_value.__aexit__ = AsyncMock(return_value=False)
            await service.advance_ticket(
                ticket_id="FORGEOS-BE099", agent_id="backend"
            )

        fetch_sql = conn.fetchrow.call_args.args[0]
        assert "FOR UPDATE" in fetch_sql
