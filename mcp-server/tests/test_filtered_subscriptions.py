"""Tests for filtered WebSocket subscriptions (FORGEOS-BE040).

Covers:
- Extended ClientFilter with types and agent_ids dimensions
- OR-logic filter matching across all four dimensions
- Dynamic subscribe/unsubscribe via WebSocket messages
- Backpressure management with buffer limits
- Default behavior (no subscription) receives all events

.. meta::
   :ticket: FORGEOS-BE040
"""

from __future__ import annotations

import asyncio
import json
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

    def __init__(self, *, fail_on_send: bool = False, slow: bool = False) -> None:
        self.sent_texts: list[str] = []
        self.sent_bytes: list[bytes] = []
        self._fail_on_send = fail_on_send
        self._slow = slow

    async def send_text(self, data: str) -> None:
        if self._fail_on_send:
            raise ConnectionError("send failed")
        if self._slow:
            await asyncio.sleep(0.5)
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
# AC 1: Extended ClientFilter — types and agent_ids
# ---------------------------------------------------------------------------


class TestClientFilterExtendedFields:
    """ClientFilter supports types and agent_ids filter dimensions."""

    def test_filter_has_types_field(self) -> None:
        filt = ClientFilter(types=frozenset({"backend", "frontend"}))
        assert filt.types == frozenset({"backend", "frontend"})

    def test_filter_has_agent_ids_field(self) -> None:
        filt = ClientFilter(agent_ids=frozenset({"Backend", "QA"}))
        assert filt.agent_ids == frozenset({"Backend", "QA"})

    def test_filter_defaults_none_for_new_fields(self) -> None:
        filt = ClientFilter()
        assert filt.types is None
        assert filt.agent_ids is None

    def test_filter_all_four_dimensions(self) -> None:
        filt = ClientFilter(
            ticket_ids=frozenset({"T-001"}),
            stages=frozenset({"QA"}),
            types=frozenset({"backend"}),
            agent_ids=frozenset({"Backend"}),
        )
        assert filt.ticket_ids == frozenset({"T-001"})
        assert filt.stages == frozenset({"QA"})
        assert filt.types == frozenset({"backend"})
        assert filt.agent_ids == frozenset({"Backend"})


# ---------------------------------------------------------------------------
# AC 4: OR logic across all filter dimensions
# ---------------------------------------------------------------------------


class TestMatchesFilterExtended:
    """matches_filter with type and agent_id dimensions uses OR logic."""

    def test_type_match_via_payload(self) -> None:
        event = _make_event(payload={"type": "backend"})
        filt = ClientFilter(types=frozenset({"backend"}))
        assert matches_filter(event, filt) is True

    def test_type_no_match(self) -> None:
        event = _make_event(payload={"type": "frontend"})
        filt = ClientFilter(types=frozenset({"backend"}))
        assert matches_filter(event, filt) is False

    def test_agent_id_match_via_payload(self) -> None:
        event = _make_event(payload={"agent_id": "Backend"})
        filt = ClientFilter(agent_ids=frozenset({"Backend"}))
        assert matches_filter(event, filt) is True

    def test_agent_id_no_match(self) -> None:
        event = _make_event(payload={"agent_id": "QA"})
        filt = ClientFilter(agent_ids=frozenset({"Backend"}))
        assert matches_filter(event, filt) is False

    def test_or_logic_type_matches_but_stage_does_not(self) -> None:
        """If type matches, event passes even if stage doesn't match."""
        event = _make_event(
            old_stage="CI",
            new_stage="DOCS",
            payload={"type": "backend"},
        )
        filt = ClientFilter(
            stages=frozenset({"SECURITY"}),
            types=frozenset({"backend"}),
        )
        assert matches_filter(event, filt) is True

    def test_or_logic_agent_matches_but_ticket_does_not(self) -> None:
        """If agent_id matches, event passes even if ticket doesn't match."""
        event = _make_event(
            ticket_id="T-099",
            payload={"agent_id": "Backend"},
        )
        filt = ClientFilter(
            ticket_ids=frozenset({"T-001"}),
            agent_ids=frozenset({"Backend"}),
        )
        assert matches_filter(event, filt) is True

    def test_or_logic_all_four_dimensions_none_match(self) -> None:
        """If no dimension matches, event is rejected."""
        event = _make_event(
            ticket_id="T-099",
            old_stage="BACKEND",
            new_stage="QA",
            payload={"type": "frontend", "agent_id": "Frontend"},
        )
        filt = ClientFilter(
            ticket_ids=frozenset({"T-001"}),
            stages=frozenset({"SECURITY"}),
            types=frozenset({"backend"}),
            agent_ids=frozenset({"Backend"}),
        )
        assert matches_filter(event, filt) is False

    def test_event_without_type_in_payload_does_not_match_type_filter(self) -> None:
        """When payload has no 'type', type filter should not match."""
        event = _make_event(payload={})
        filt = ClientFilter(types=frozenset({"backend"}))
        assert matches_filter(event, filt) is False

    def test_event_without_agent_id_in_payload_does_not_match_agent_filter(self) -> None:
        """When payload has no 'agent_id', agent filter should not match."""
        event = _make_event(payload={})
        filt = ClientFilter(agent_ids=frozenset({"Backend"}))
        assert matches_filter(event, filt) is False


# ---------------------------------------------------------------------------
# AC 5: Default behavior — no subscription receives all events
# ---------------------------------------------------------------------------


class TestDefaultBehavior:
    """No filters means receive all events."""

    @pytest.mark.asyncio
    async def test_no_filter_receives_all(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)  # no filter
        for i in range(5):
            await broadcaster.publish(
                _make_event(ticket_id=f"T-{i}", payload={"type": "backend"})
            )
        assert len(ws.sent_texts) == 5


# ---------------------------------------------------------------------------
# AC 1 & 2: Dynamic subscribe/unsubscribe
# ---------------------------------------------------------------------------


class TestDynamicSubscriptions:
    """EventBroadcaster supports dynamic filter updates."""

    @pytest.mark.asyncio
    async def test_update_filter_changes_subscription(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        # Initially receives all
        await broadcaster.publish(_make_event(ticket_id="T-001"))
        assert len(ws.sent_texts) == 1

        # Subscribe to only T-002
        await broadcaster.update_filter(
            ws,
            ClientFilter(ticket_ids=frozenset({"T-002"})),
        )
        await broadcaster.publish(_make_event(ticket_id="T-001"))
        await broadcaster.publish(_make_event(ticket_id="T-002"))
        # Should only get T-002 (total 2: 1 from before + 1 matching)
        assert len(ws.sent_texts) == 2

    @pytest.mark.asyncio
    async def test_update_filter_to_default_receives_all(self) -> None:
        """Unsubscribing (resetting filter) receives all events again."""
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(
            ws, ClientFilter(ticket_ids=frozenset({"T-001"}))
        )

        # Only T-001 events
        await broadcaster.publish(_make_event(ticket_id="T-002"))
        assert len(ws.sent_texts) == 0

        # Reset to default (no filter)
        await broadcaster.update_filter(ws, ClientFilter())
        await broadcaster.publish(_make_event(ticket_id="T-002"))
        assert len(ws.sent_texts) == 1

    @pytest.mark.asyncio
    async def test_update_filter_for_unregistered_client_is_noop(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        # Should not raise
        await broadcaster.update_filter(
            ws,
            ClientFilter(ticket_ids=frozenset({"T-001"})),
        )

    @pytest.mark.asyncio
    async def test_get_filter_returns_current(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        filt = ClientFilter(ticket_ids=frozenset({"T-001"}))
        await broadcaster.register(ws, filt)
        assert broadcaster.get_filter(ws) == filt

    @pytest.mark.asyncio
    async def test_get_filter_returns_none_for_unknown(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        assert broadcaster.get_filter(ws) is None


# ---------------------------------------------------------------------------
# AC 3: Filtered clients receive only matching events
# ---------------------------------------------------------------------------


class TestFilteredDelivery:
    """Filtered clients only receive matching events."""

    @pytest.mark.asyncio
    async def test_type_filter_delivery(self) -> None:
        broadcaster = EventBroadcaster()
        ws_backend = FakeWebSocket()
        ws_frontend = FakeWebSocket()
        await broadcaster.register(
            ws_backend,
            ClientFilter(types=frozenset({"backend"})),
        )
        await broadcaster.register(
            ws_frontend,
            ClientFilter(types=frozenset({"frontend"})),
        )

        await broadcaster.publish(
            _make_event(payload={"type": "backend"})
        )
        assert len(ws_backend.sent_texts) == 1
        assert len(ws_frontend.sent_texts) == 0

    @pytest.mark.asyncio
    async def test_agent_id_filter_delivery(self) -> None:
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(
            ws,
            ClientFilter(agent_ids=frozenset({"Backend"})),
        )

        await broadcaster.publish(
            _make_event(payload={"agent_id": "Backend"})
        )
        await broadcaster.publish(
            _make_event(payload={"agent_id": "QA"})
        )
        assert len(ws.sent_texts) == 1

    @pytest.mark.asyncio
    async def test_multiple_filters_or_logic(self) -> None:
        """Client with multiple filter dimensions receives if ANY matches."""
        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(
            ws,
            ClientFilter(
                ticket_ids=frozenset({"T-001"}),
                types=frozenset({"frontend"}),
            ),
        )

        # Matches ticket_id
        await broadcaster.publish(_make_event(ticket_id="T-001", payload={"type": "backend"}))
        # Matches type
        await broadcaster.publish(_make_event(ticket_id="T-099", payload={"type": "frontend"}))
        # Matches neither
        await broadcaster.publish(_make_event(ticket_id="T-099", payload={"type": "backend"}))

        assert len(ws.sent_texts) == 2


# ---------------------------------------------------------------------------
# AC 6: Backpressure management
# ---------------------------------------------------------------------------


class TestBackpressure:
    """Backpressure drops oldest events for slow consumers after buffer limit."""

    @pytest.mark.asyncio
    async def test_buffer_limit_drops_oldest(self) -> None:
        """When buffer is full, oldest events are dropped."""
        broadcaster = EventBroadcaster(buffer_limit=3)
        ws = FakeWebSocket(slow=True)
        await broadcaster.register(ws)

        # Publish more events than the buffer can hold
        # With buffered delivery, events go to the buffer first
        for i in range(5):
            await broadcaster.publish(
                _make_event(ticket_id=f"T-{i}")
            )

        # The buffer should have kept only the most recent events
        # (dropped oldest when full)
        buffer = broadcaster.get_buffer(ws)
        assert buffer is not None
        assert len(buffer) <= 3

    @pytest.mark.asyncio
    async def test_default_buffer_limit(self) -> None:
        """Default buffer limit is 256."""
        broadcaster = EventBroadcaster()
        assert broadcaster.buffer_limit == 256

    @pytest.mark.asyncio
    async def test_custom_buffer_limit(self) -> None:
        """Custom buffer limit can be set."""
        broadcaster = EventBroadcaster(buffer_limit=10)
        assert broadcaster.buffer_limit == 10

    @pytest.mark.asyncio
    async def test_buffer_drains_on_publish(self) -> None:
        """Events are delivered from buffer on publish for non-slow clients."""
        broadcaster = EventBroadcaster(buffer_limit=10)
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        await broadcaster.publish(_make_event(ticket_id="T-001"))
        assert len(ws.sent_texts) == 1

    @pytest.mark.asyncio
    async def test_buffer_created_per_client(self) -> None:
        """Each client gets its own buffer."""
        broadcaster = EventBroadcaster(buffer_limit=5)
        ws1 = FakeWebSocket()
        ws2 = FakeWebSocket()
        await broadcaster.register(ws1)
        await broadcaster.register(ws2)

        buf1 = broadcaster.get_buffer(ws1)
        buf2 = broadcaster.get_buffer(ws2)
        assert buf1 is not None
        assert buf2 is not None
        assert buf1 is not buf2

    @pytest.mark.asyncio
    async def test_unregister_clears_buffer(self) -> None:
        """Unregistering a client removes its buffer."""
        broadcaster = EventBroadcaster(buffer_limit=5)
        ws = FakeWebSocket()
        await broadcaster.register(ws)
        assert broadcaster.get_buffer(ws) is not None
        await broadcaster.unregister(ws)
        assert broadcaster.get_buffer(ws) is None


# ---------------------------------------------------------------------------
# WebSocket endpoint subscribe/unsubscribe message handling
# ---------------------------------------------------------------------------


class TestWebSocketSubscribeMessages:
    """Test subscribe/unsubscribe message handling in the websocket route."""

    @pytest.mark.asyncio
    async def test_subscribe_message_updates_filter(self) -> None:
        from mcp_server.api.routes.websocket import _handle_client_message

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        msg = json.dumps({
            "type": "subscribe",
            "filters": {
                "ticket_ids": ["T-001", "T-002"],
                "stages": ["QA"],
                "types": ["backend"],
                "agent_ids": ["Backend"],
            },
        })
        await _handle_client_message(ws, broadcaster, msg)

        filt = broadcaster.get_filter(ws)
        assert filt is not None
        assert filt.ticket_ids == frozenset({"T-001", "T-002"})
        assert filt.stages == frozenset({"QA"})
        assert filt.types == frozenset({"backend"})
        assert filt.agent_ids == frozenset({"Backend"})

    @pytest.mark.asyncio
    async def test_unsubscribe_message_resets_filter(self) -> None:
        from mcp_server.api.routes.websocket import _handle_client_message

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(
            ws, ClientFilter(ticket_ids=frozenset({"T-001"}))
        )

        msg = json.dumps({"type": "unsubscribe"})
        await _handle_client_message(ws, broadcaster, msg)

        filt = broadcaster.get_filter(ws)
        assert filt is not None
        assert filt.ticket_ids is None
        assert filt.stages is None
        assert filt.types is None
        assert filt.agent_ids is None

    @pytest.mark.asyncio
    async def test_subscribe_with_partial_filters(self) -> None:
        from mcp_server.api.routes.websocket import _handle_client_message

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        msg = json.dumps({
            "type": "subscribe",
            "filters": {"stages": ["BACKEND", "QA"]},
        })
        await _handle_client_message(ws, broadcaster, msg)

        filt = broadcaster.get_filter(ws)
        assert filt is not None
        assert filt.stages == frozenset({"BACKEND", "QA"})
        assert filt.ticket_ids is None
        assert filt.types is None
        assert filt.agent_ids is None

    @pytest.mark.asyncio
    async def test_subscribe_sends_ack(self) -> None:
        from mcp_server.api.routes.websocket import _handle_client_message

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        msg = json.dumps({
            "type": "subscribe",
            "filters": {"ticket_ids": ["T-001"]},
        })
        await _handle_client_message(ws, broadcaster, msg)

        # Should have sent an ack message
        assert len(ws.sent_texts) == 1
        ack = json.loads(ws.sent_texts[0])
        assert ack["type"] == "subscribe_ack"

    @pytest.mark.asyncio
    async def test_unsubscribe_sends_ack(self) -> None:
        from mcp_server.api.routes.websocket import _handle_client_message

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        msg = json.dumps({"type": "unsubscribe"})
        await _handle_client_message(ws, broadcaster, msg)

        assert len(ws.sent_texts) == 1
        ack = json.loads(ws.sent_texts[0])
        assert ack["type"] == "unsubscribe_ack"

    @pytest.mark.asyncio
    async def test_invalid_json_does_not_crash(self) -> None:
        from mcp_server.api.routes.websocket import _handle_client_message

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        await _handle_client_message(ws, broadcaster, "not json {{{")
        # Should not raise

    @pytest.mark.asyncio
    async def test_pong_still_works(self) -> None:
        from mcp_server.api.routes.websocket import _handle_client_message

        broadcaster = EventBroadcaster()
        ws = FakeWebSocket()
        await broadcaster.register(ws)

        await _handle_client_message(ws, broadcaster, '{"type": "pong"}')
        # No ack for pong
        assert len(ws.sent_texts) == 0


# ---------------------------------------------------------------------------
# WebSocket endpoint integration with extended filters
# ---------------------------------------------------------------------------


class TestWebSocketEndpointExtendedFilters:
    """Starlette TestClient integration for extended filter params."""

    def test_connect_with_types_filter(self) -> None:
        from starlette.applications import Starlette
        from starlette.routing import WebSocketRoute
        from starlette.testclient import TestClient

        from mcp_server.api.routes.websocket import create_websocket_endpoint

        broadcaster = EventBroadcaster()
        handler = create_websocket_endpoint(lambda: broadcaster)
        app = Starlette(routes=[WebSocketRoute("/ws/tickets", handler)])

        with TestClient(app) as client, client.websocket_connect(
            "/ws/tickets?types=backend,frontend",
        ):
            assert broadcaster.client_count == 1

    def test_connect_with_agent_ids_filter(self) -> None:
        from starlette.applications import Starlette
        from starlette.routing import WebSocketRoute
        from starlette.testclient import TestClient

        from mcp_server.api.routes.websocket import create_websocket_endpoint

        broadcaster = EventBroadcaster()
        handler = create_websocket_endpoint(lambda: broadcaster)
        app = Starlette(routes=[WebSocketRoute("/ws/tickets", handler)])

        with TestClient(app) as client, client.websocket_connect(
            "/ws/tickets?agent_ids=Backend,QA",
        ):
            assert broadcaster.client_count == 1
