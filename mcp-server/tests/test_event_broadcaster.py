"""Tests for the EventBroadcaster service.

Covers client registration/unregistration, event publishing with and
without filters, heartbeat ping detection of stale connections, and
graceful handling of send failures.

.. meta::
   :ticket: FORGEOS-BE039
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from mcp_server.services.event_broadcaster import (
    ClientFilter,
    EventBroadcaster,
    TicketEvent,
    matches_filter,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


class FakeWebSocket:
    """In-memory fake WebSocket for testing."""

    def __init__(self, *, fail_on_send: bool = False) -> None:
        self.sent_texts: list[str] = []
        self.sent_bytes: list[bytes] = []
        self._fail_on_send = fail_on_send

    async def send_text(self, data: str) -> None:
        if self._fail_on_send:
            raise ConnectionError("send failed")
        self.sent_texts.append(data)

    async def send_bytes(self, data: bytes) -> None:
        if self._fail_on_send:
            raise ConnectionError("send failed")
        self.sent_bytes.append(data)


def _make_event(
    ticket_id: str = "FORGEOS-001",
    event_type: str = "ticket.advanced",
    old_stage: str = "BACKEND",
    new_stage: str = "QA",
    timestamp: str = "2026-03-11T00:00:00+00:00",
    payload: dict[str, Any] | None = None,
) -> TicketEvent:
    return TicketEvent(
        ticket_id=ticket_id,
        event_type=event_type,
        old_stage=old_stage,
        new_stage=new_stage,
        timestamp=timestamp,
        payload=payload or {},
    )


# ---------------------------------------------------------------------------
# TicketEvent tests
# ---------------------------------------------------------------------------


class TestTicketEvent:
    def test_to_dict_minimal(self) -> None:
        event = _make_event()
        d = event.to_dict()
        assert d["ticket_id"] == "FORGEOS-001"
        assert d["event_type"] == "ticket.advanced"
        assert d["old_stage"] == "BACKEND"
        assert d["new_stage"] == "QA"
        assert d["timestamp"] == "2026-03-11T00:00:00+00:00"
        assert "payload" not in d  # empty payload omitted

    def test_to_dict_with_payload(self) -> None:
        event = _make_event(payload={"agent_id": "Backend"})
        d = event.to_dict()
        assert d["payload"] == {"agent_id": "Backend"}

    def test_to_json_roundtrip(self) -> None:
        import json

        event = _make_event(payload={"reason": "test"})
        parsed = json.loads(event.to_json())
        assert parsed["ticket_id"] == "FORGEOS-001"
        assert parsed["payload"]["reason"] == "test"


# ---------------------------------------------------------------------------
# matches_filter tests
# ---------------------------------------------------------------------------


class TestMatchesFilter:
    def test_no_filter_matches_everything(self) -> None:
        event = _make_event()
        assert matches_filter(event, ClientFilter()) is True

    def test_ticket_id_match(self) -> None:
        event = _make_event(ticket_id="T-001")
        filt = ClientFilter(ticket_ids=frozenset({"T-001", "T-002"}))
        assert matches_filter(event, filt) is True

    def test_ticket_id_no_match(self) -> None:
        event = _make_event(ticket_id="T-099")
        filt = ClientFilter(ticket_ids=frozenset({"T-001"}))
        assert matches_filter(event, filt) is False

    def test_stage_match_old(self) -> None:
        event = _make_event(old_stage="BACKEND", new_stage="QA")
        filt = ClientFilter(stages=frozenset({"BACKEND"}))
        assert matches_filter(event, filt) is True

    def test_stage_match_new(self) -> None:
        event = _make_event(old_stage="BACKEND", new_stage="QA")
        filt = ClientFilter(stages=frozenset({"QA"}))
        assert matches_filter(event, filt) is True

    def test_stage_no_match(self) -> None:
        event = _make_event(old_stage="BACKEND", new_stage="QA")
        filt = ClientFilter(stages=frozenset({"SECURITY"}))
        assert matches_filter(event, filt) is False

    def test_combined_filter_ticket_match(self) -> None:
        event = _make_event(ticket_id="T-001", old_stage="CI", new_stage="DOCS")
        filt = ClientFilter(
            ticket_ids=frozenset({"T-001"}),
            stages=frozenset({"SECURITY"}),
        )
        # ticket_id matches, so overall match
        assert matches_filter(event, filt) is True

    def test_combined_filter_stage_match(self) -> None:
        event = _make_event(ticket_id="T-099", old_stage="CI", new_stage="DOCS")
        filt = ClientFilter(
            ticket_ids=frozenset({"T-001"}),
            stages=frozenset({"CI"}),
        )
        # stage matches, so overall match
        assert matches_filter(event, filt) is True

    def test_combined_filter_no_match(self) -> None:
        event = _make_event(ticket_id="T-099", old_stage="BACKEND", new_stage="QA")
        filt = ClientFilter(
            ticket_ids=frozenset({"T-001"}),
            stages=frozenset({"SECURITY"}),
        )
        assert matches_filter(event, filt) is False


# ---------------------------------------------------------------------------
# EventBroadcaster tests
# ---------------------------------------------------------------------------


class TestEventBroadcasterRegistration:
    @pytest.mark.asyncio
    async def test_register_increments_client_count(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)
        assert broadcaster.client_count == 1

    @pytest.mark.asyncio
    async def test_unregister_decrements_client_count(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)
        await broadcaster.unregister(ws)
        assert broadcaster.client_count == 0

    @pytest.mark.asyncio
    async def test_unregister_unknown_client_is_safe(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.unregister(ws)  # should not raise
        assert broadcaster.client_count == 0

    @pytest.mark.asyncio
    async def test_register_multiple_clients(self) -> None:
        broadcaster = EventBroadcaster()
        ws1 = FakeWebSocket()
        ws2 = FakeWebSocket()
        await broadcaster.register(ws1)
        await broadcaster.register(ws2)
        assert broadcaster.client_count == 2


class TestEventBroadcasterPublish:
    @pytest.mark.asyncio
    async def test_publish_to_no_clients(self) -> None:
        broadcaster = EventBroadcaster()
        event = _make_event()
        delivered = await broadcaster.publish(event)
        assert delivered == 0

    @pytest.mark.asyncio
    async def test_publish_to_single_client(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)
        event = _make_event()
        delivered = await broadcaster.publish(event)
        assert delivered == 1
        assert len(ws.sent_texts) == 1

    @pytest.mark.asyncio
    async def test_publish_to_multiple_clients(self) -> None:
        broadcaster = EventBroadcaster()
        ws1 = FakeWebSocket()
        ws2 = FakeWebSocket()
        await broadcaster.register(ws1)
        await broadcaster.register(ws2)
        event = _make_event()
        delivered = await broadcaster.publish(event)
        assert delivered == 2
        assert len(ws1.sent_texts) == 1
        assert len(ws2.sent_texts) == 1

    @pytest.mark.asyncio
    async def test_publish_respects_ticket_id_filter(self) -> None:
        broadcaster = EventBroadcaster()
        ws_filtered = FakeWebSocket()
        ws_all = FakeWebSocket()
        await broadcaster.register(ws_filtered, ClientFilter(ticket_ids=frozenset({"T-001"})))
        await broadcaster.register(ws_all)

        event = _make_event(ticket_id="T-002")
        delivered = await broadcaster.publish(event)
        assert delivered == 1
        assert len(ws_filtered.sent_texts) == 0
        assert len(ws_all.sent_texts) == 1

    @pytest.mark.asyncio
    async def test_publish_respects_stage_filter(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws, ClientFilter(stages=frozenset({"QA"})))

        event_match = _make_event(old_stage="BACKEND", new_stage="QA")
        event_no_match = _make_event(old_stage="CI", new_stage="DOCS")

        delivered1 = await broadcaster.publish(event_match)
        delivered2 = await broadcaster.publish(event_no_match)
        assert delivered1 == 1
        assert delivered2 == 0
        assert len(ws.sent_texts) == 1

    @pytest.mark.asyncio
    async def test_publish_removes_failed_client(self) -> None:
        broadcaster = EventBroadcaster()
        ws_good = FakeWebSocket()
        ws_bad = FakeWebSocket(fail_on_send=True)
        await broadcaster.register(ws_good)
        await broadcaster.register(ws_bad)
        assert broadcaster.client_count == 2

        event = _make_event()
        delivered = await broadcaster.publish(event)
        assert delivered == 1
        assert broadcaster.client_count == 1

    @pytest.mark.asyncio
    async def test_publish_event_json_format(self) -> None:
        import json

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)
        event = _make_event(
            ticket_id="T-X",
            event_type="ticket.claimed",
            old_stage="READY",
            new_stage="BACKEND",
        )
        await broadcaster.publish(event)

        parsed = json.loads(ws.sent_texts[0])
        assert parsed["ticket_id"] == "T-X"
        assert parsed["event_type"] == "ticket.claimed"
        assert parsed["old_stage"] == "READY"
        assert parsed["new_stage"] == "BACKEND"
        assert "timestamp" in parsed


class TestEventBroadcasterPing:
    @pytest.mark.asyncio
    async def test_start_creates_ping_task(self) -> None:
        broadcaster = EventBroadcaster(ping_interval=100.0)
        await broadcaster.start()
        # Task should be running
        assert broadcaster._ping_task is not None
        assert not broadcaster._ping_task.done()
        await broadcaster.stop()

    @pytest.mark.asyncio
    async def test_stop_cancels_ping_task(self) -> None:
        broadcaster = EventBroadcaster(ping_interval=100.0)
        await broadcaster.start()
        await broadcaster.stop()
        assert broadcaster._ping_task is None
        assert broadcaster.client_count == 0

    @pytest.mark.asyncio
    async def test_ping_removes_stale_client(self) -> None:
        broadcaster = EventBroadcaster(ping_interval=0.01)
        ws_good = FakeWebSocket()
        ws_stale = FakeWebSocket(fail_on_send=True)
        await broadcaster.register(ws_good)
        await broadcaster.register(ws_stale)
        assert broadcaster.client_count == 2

        await broadcaster.start()
        # Give the ping loop time to run
        await asyncio.sleep(0.05)
        await broadcaster.stop()

        # The stale client should have been removed
        assert broadcaster.client_count == 0  # stop clears all
        # But during the ping, ws_stale was detected as stale

    @pytest.mark.asyncio
    async def test_stop_is_idempotent(self) -> None:
        broadcaster = EventBroadcaster()
        await broadcaster.stop()  # no task started
        await broadcaster.stop()  # still fine
