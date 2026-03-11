"""Tests for the state change notification emitter.

.. meta::
   :ticket: FORGEOS-BE065
"""

from __future__ import annotations

from datetime import datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from mcp_server.notifications.emitter import (
    EventType,
    StateChangeEmitter,
)

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def mock_queue() -> AsyncMock:
    """Return an AsyncMock that mimics NotificationQueue.enqueue."""
    queue = AsyncMock()
    queue.enqueue = AsyncMock(return_value="notif-id-001")
    return queue


@pytest.fixture()
def emitter(mock_queue: AsyncMock) -> StateChangeEmitter:
    return StateChangeEmitter(queue=mock_queue)


# ---------------------------------------------------------------------------
# EventType registry
# ---------------------------------------------------------------------------


class TestEventTypeRegistry:
    def test_claimed_value(self) -> None:
        assert EventType.TICKET_CLAIMED == "ticket.claimed"

    def test_advanced_value(self) -> None:
        assert EventType.TICKET_ADVANCED == "ticket.advanced"

    def test_released_value(self) -> None:
        assert EventType.TICKET_RELEASED == "ticket.released"

    def test_reworked_value(self) -> None:
        assert EventType.TICKET_REWORKED == "ticket.reworked"


# ---------------------------------------------------------------------------
# emit_claimed
# ---------------------------------------------------------------------------


class TestEmitClaimed:
    @pytest.mark.asyncio()
    async def test_enqueues_claimed_event(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        await emitter.emit_claimed(
            ticket_id="FORGEOS-BE001",
            stage="BACKEND",
            agent_id="backend-agent",
            machine_id="pop-os",
            operator="ReaperOAK",
        )

        mock_queue.enqueue.assert_awaited_once()
        call_args = mock_queue.enqueue.call_args
        assert call_args.kwargs["event_type"] == "ticket.claimed"
        payload = call_args.kwargs["payload"]
        assert payload["ticket_id"] == "FORGEOS-BE001"
        assert payload["new_stage"] == "BACKEND"
        assert payload["agent_id"] == "backend-agent"
        assert payload["machine_id"] == "pop-os"
        assert payload["operator"] == "ReaperOAK"
        assert "timestamp" in payload

    @pytest.mark.asyncio()
    async def test_claimed_old_stage_is_ready(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        await emitter.emit_claimed(
            ticket_id="FORGEOS-BE001",
            stage="BACKEND",
            agent_id="backend-agent",
        )

        payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert payload["old_stage"] == "READY"


# ---------------------------------------------------------------------------
# emit_advanced
# ---------------------------------------------------------------------------


class TestEmitAdvanced:
    @pytest.mark.asyncio()
    async def test_enqueues_advanced_event(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        await emitter.emit_advanced(
            ticket_id="FORGEOS-BE002",
            old_stage="BACKEND",
            new_stage="QA",
            agent_id="backend-agent",
        )

        mock_queue.enqueue.assert_awaited_once()
        call_args = mock_queue.enqueue.call_args
        assert call_args.kwargs["event_type"] == "ticket.advanced"
        payload = call_args.kwargs["payload"]
        assert payload["ticket_id"] == "FORGEOS-BE002"
        assert payload["old_stage"] == "BACKEND"
        assert payload["new_stage"] == "QA"
        assert payload["agent_id"] == "backend-agent"
        assert "timestamp" in payload

    @pytest.mark.asyncio()
    async def test_advanced_with_evidence(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        evidence = {"coverage": "85%", "tests_passed": 42}
        await emitter.emit_advanced(
            ticket_id="FORGEOS-BE002",
            old_stage="BACKEND",
            new_stage="QA",
            agent_id="backend-agent",
            evidence=evidence,
        )

        payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert payload["evidence"] == evidence


# ---------------------------------------------------------------------------
# emit_released
# ---------------------------------------------------------------------------


class TestEmitReleased:
    @pytest.mark.asyncio()
    async def test_enqueues_released_event(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        await emitter.emit_released(
            ticket_id="FORGEOS-BE003",
            stage="BACKEND",
            agent_id="backend-agent",
            reason="timeout",
        )

        mock_queue.enqueue.assert_awaited_once()
        call_args = mock_queue.enqueue.call_args
        assert call_args.kwargs["event_type"] == "ticket.released"
        payload = call_args.kwargs["payload"]
        assert payload["ticket_id"] == "FORGEOS-BE003"
        assert payload["old_stage"] == "BACKEND"
        assert payload["new_stage"] == "READY"
        assert payload["agent_id"] == "backend-agent"
        assert payload["reason"] == "timeout"

    @pytest.mark.asyncio()
    async def test_released_without_reason(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        await emitter.emit_released(
            ticket_id="FORGEOS-BE003",
            stage="BACKEND",
            agent_id="backend-agent",
        )

        payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert payload.get("reason") == ""


# ---------------------------------------------------------------------------
# emit_reworked
# ---------------------------------------------------------------------------


class TestEmitReworked:
    @pytest.mark.asyncio()
    async def test_enqueues_reworked_event(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        await emitter.emit_reworked(
            ticket_id="FORGEOS-BE004",
            old_stage="QA",
            new_stage="BACKEND",
            agent_id="qa-agent",
            reason="Tests fail on edge case",
        )

        mock_queue.enqueue.assert_awaited_once()
        call_args = mock_queue.enqueue.call_args
        assert call_args.kwargs["event_type"] == "ticket.reworked"
        payload = call_args.kwargs["payload"]
        assert payload["ticket_id"] == "FORGEOS-BE004"
        assert payload["old_stage"] == "QA"
        assert payload["new_stage"] == "BACKEND"
        assert payload["agent_id"] == "qa-agent"
        assert payload["reason"] == "Tests fail on edge case"


# ---------------------------------------------------------------------------
# Fire-and-forget guarantee
# ---------------------------------------------------------------------------


class TestFireAndForget:
    @pytest.mark.asyncio()
    async def test_emit_claimed_does_not_raise_on_queue_failure(
        self, mock_queue: AsyncMock
    ) -> None:
        mock_queue.enqueue = AsyncMock(side_effect=RuntimeError("DB down"))
        emitter = StateChangeEmitter(queue=mock_queue)

        # Must NOT raise
        await emitter.emit_claimed(
            ticket_id="FORGEOS-BE005",
            stage="BACKEND",
            agent_id="backend-agent",
        )

    @pytest.mark.asyncio()
    async def test_emit_advanced_does_not_raise_on_queue_failure(
        self, mock_queue: AsyncMock
    ) -> None:
        mock_queue.enqueue = AsyncMock(side_effect=RuntimeError("DB down"))
        emitter = StateChangeEmitter(queue=mock_queue)

        await emitter.emit_advanced(
            ticket_id="FORGEOS-BE005",
            old_stage="BACKEND",
            new_stage="QA",
            agent_id="backend-agent",
        )

    @pytest.mark.asyncio()
    async def test_emit_released_does_not_raise_on_queue_failure(
        self, mock_queue: AsyncMock
    ) -> None:
        mock_queue.enqueue = AsyncMock(side_effect=RuntimeError("DB down"))
        emitter = StateChangeEmitter(queue=mock_queue)

        await emitter.emit_released(
            ticket_id="FORGEOS-BE005",
            stage="BACKEND",
            agent_id="backend-agent",
        )

    @pytest.mark.asyncio()
    async def test_emit_reworked_does_not_raise_on_queue_failure(
        self, mock_queue: AsyncMock
    ) -> None:
        mock_queue.enqueue = AsyncMock(side_effect=RuntimeError("DB down"))
        emitter = StateChangeEmitter(queue=mock_queue)

        await emitter.emit_reworked(
            ticket_id="FORGEOS-BE005",
            old_stage="QA",
            new_stage="BACKEND",
            agent_id="qa-agent",
            reason="failure",
        )


# ---------------------------------------------------------------------------
# Payload structure
# ---------------------------------------------------------------------------


class TestPayloadStructure:
    @pytest.mark.asyncio()
    async def test_all_payloads_have_required_fields(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        required_fields = {"ticket_id", "old_stage", "new_stage", "agent_id", "timestamp"}

        await emitter.emit_claimed(
            ticket_id="T1", stage="BACKEND", agent_id="a1"
        )
        claimed_payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert required_fields <= set(claimed_payload.keys())

        mock_queue.enqueue.reset_mock()
        await emitter.emit_advanced(
            ticket_id="T2", old_stage="BACKEND", new_stage="QA", agent_id="a2"
        )
        advanced_payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert required_fields <= set(advanced_payload.keys())

        mock_queue.enqueue.reset_mock()
        await emitter.emit_released(
            ticket_id="T3", stage="BACKEND", agent_id="a3"
        )
        released_payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert required_fields <= set(released_payload.keys())

        mock_queue.enqueue.reset_mock()
        await emitter.emit_reworked(
            ticket_id="T4",
            old_stage="QA",
            new_stage="BACKEND",
            agent_id="a4",
            reason="bad",
        )
        reworked_payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert required_fields <= set(reworked_payload.keys())

    @pytest.mark.asyncio()
    async def test_timestamp_is_iso8601(
        self, emitter: StateChangeEmitter, mock_queue: AsyncMock
    ) -> None:
        await emitter.emit_claimed(
            ticket_id="T1", stage="BACKEND", agent_id="a1"
        )
        payload = mock_queue.enqueue.call_args.kwargs["payload"]
        # Should not raise
        datetime.fromisoformat(payload["timestamp"])


# ---------------------------------------------------------------------------
# Integration with TicketService
# ---------------------------------------------------------------------------


class TestTicketServiceIntegration:
    """Verify the emitter is invoked from TicketService operations."""

    @pytest.mark.asyncio()
    async def test_claim_next_emits_notification(self) -> None:
        from mcp_server.notifications.emitter import StateChangeEmitter
        from mcp_server.services.ticket_service import TicketService

        mock_queue = AsyncMock()
        mock_queue.enqueue = AsyncMock(return_value="n-001")
        emitter = StateChangeEmitter(queue=mock_queue)

        mock_claim_queue = AsyncMock()
        mock_claim_result = MagicMock()
        mock_claim_result.ticket_id = "FORGEOS-BE010"
        mock_claim_result.title = "Test ticket"
        mock_claim_result.ticket_type = "backend"
        mock_claim_result.stage = "BACKEND"
        mock_claim_result.file_paths = []
        mock_claim_result.acceptance_criteria = []
        mock_claim_queue.claim_next = AsyncMock(return_value=mock_claim_result)

        service = TicketService(
            claim_queue=mock_claim_queue,
            emitter=emitter,
        )

        with patch(
            "mcp_server.services.ticket_service.check_role_stage_authorization"
        ), patch(
            "mcp_server.services.ticket_service.AgentRoleMap.stage_for_role",
            return_value="BACKEND",
        ):
            await service.claim_next(
                agent_role="backend",
                machine_id="pop-os",
                operator="ReaperOAK",
            )

        mock_queue.enqueue.assert_awaited_once()
        payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert payload["ticket_id"] == "FORGEOS-BE010"
        assert payload["new_stage"] == "BACKEND"

    @pytest.mark.asyncio()
    async def test_claim_failure_does_not_emit(self) -> None:
        from mcp_server.locking.claim_queue import NoEligibleTicketError
        from mcp_server.notifications.emitter import StateChangeEmitter
        from mcp_server.services.ticket_service import TicketService

        mock_queue = AsyncMock()
        mock_queue.enqueue = AsyncMock()
        emitter = StateChangeEmitter(queue=mock_queue)

        mock_claim_queue = AsyncMock()
        mock_claim_queue.claim_next = AsyncMock(return_value=None)

        service = TicketService(
            claim_queue=mock_claim_queue,
            emitter=emitter,
        )

        with patch(
            "mcp_server.services.ticket_service.check_role_stage_authorization"
        ), patch(
            "mcp_server.services.ticket_service.AgentRoleMap.stage_for_role",
            return_value="BACKEND",
        ), pytest.raises(NoEligibleTicketError):
            await service.claim_next(
                agent_role="backend",
                machine_id="pop-os",
                operator="ReaperOAK",
            )

        mock_queue.enqueue.assert_not_awaited()

    @pytest.mark.asyncio()
    async def test_release_emits_notification(self) -> None:
        from mcp_server.notifications.emitter import StateChangeEmitter
        from mcp_server.services.ticket_service import TicketService

        mock_queue = AsyncMock()
        mock_queue.enqueue = AsyncMock(return_value="n-002")
        emitter = StateChangeEmitter(queue=mock_queue)

        mock_ticket_repo = AsyncMock()
        mock_ticket = MagicMock()
        mock_ticket.ticket_id = "FORGEOS-BE011"
        mock_ticket.stage = "BACKEND"
        mock_ticket.status = "CLAIMED"
        mock_ticket_repo.get_by_id = AsyncMock(return_value=mock_ticket)

        mock_claim_repo = AsyncMock()
        mock_claim = MagicMock()
        mock_claim.claimed_by_name = "backend-agent"
        mock_claim_repo.get_active_claim = AsyncMock(return_value=mock_claim)
        mock_claim_repo.release_claim = AsyncMock()

        mock_event_repo = AsyncMock()
        mock_event_repo.append_event = AsyncMock()

        service = TicketService(
            claim_queue=AsyncMock(),
            ticket_repo=mock_ticket_repo,
            claim_repo=mock_claim_repo,
            event_repo=mock_event_repo,
            emitter=emitter,
        )

        await service.release_ticket(
            ticket_id="FORGEOS-BE011",
            agent_id="backend-agent",
            reason="done",
        )

        mock_queue.enqueue.assert_awaited_once()
        payload = mock_queue.enqueue.call_args.kwargs["payload"]
        assert payload["ticket_id"] == "FORGEOS-BE011"
        assert mock_queue.enqueue.call_args.kwargs["event_type"] == "ticket.released"

    @pytest.mark.asyncio()
    async def test_rework_emits_notification(self) -> None:
        from mcp_server.notifications.emitter import StateChangeEmitter
        from mcp_server.services.ticket_service import TicketService

        mock_queue = AsyncMock()
        mock_queue.enqueue = AsyncMock(return_value="n-003")
        emitter = StateChangeEmitter(queue=mock_queue)

        # Build a fake asyncpg row with dict-like access
        fake_row = {
            "ticket_id": "FORGEOS-BE012",
            "stage": "QA",
            "sdlc_flow": ["READY", "BACKEND", "QA", "SECURITY"],
            "claimed_by_name": "qa-agent",
            "rework_count": 0,
            "max_reworks": 3,
            "type": "backend",
            "title": "Test rework ticket",
        }

        mock_conn = AsyncMock()
        mock_conn.fetchrow = AsyncMock(return_value=fake_row)
        mock_conn.execute = AsyncMock()

        mock_pool = AsyncMock()

        service = TicketService(
            claim_queue=AsyncMock(),
            emitter=emitter,
        )
        service._pool = mock_pool

        with patch(
            "mcp_server.services.ticket_service.transactional",
        ) as mock_transactional:
            mock_transactional.return_value.__aenter__ = AsyncMock(
                return_value=mock_conn
            )
            mock_transactional.return_value.__aexit__ = AsyncMock(return_value=False)

            result = await service.rework_ticket(
                ticket_id="FORGEOS-BE012",
                agent_id="qa-agent",
                reason="Tests failing",
            )

        assert result.ticket_id == "FORGEOS-BE012"
        assert result.previous_stage == "QA"
        assert result.new_stage == "BACKEND"

        mock_queue.enqueue.assert_awaited_once()
        call_kwargs = mock_queue.enqueue.call_args.kwargs
        assert call_kwargs["event_type"] == "ticket.reworked"
        payload = call_kwargs["payload"]
        assert payload["ticket_id"] == "FORGEOS-BE012"
        assert payload["old_stage"] == "QA"
        assert payload["new_stage"] == "BACKEND"
        assert payload["agent_id"] == "qa-agent"
        assert payload["reason"] == "Tests failing"
