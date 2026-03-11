"""WebSocket endpoint for real-time ticket state streaming.

Provides a Starlette WebSocket route handler at ``/ws/tickets`` that
streams ticket state change events to connected clients.

Query parameters:
- ``ticket_ids``: Comma-separated list of ticket IDs to filter
- ``stages``: Comma-separated list of SDLC stages to filter

.. meta::
   :ticket: FORGEOS-BE039, FORGEOS-BE040
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from starlette.websockets import WebSocket, WebSocketDisconnect

from mcp_server.observability import get_logger
from mcp_server.services.event_broadcaster import ClientFilter, WebSocketLike

if TYPE_CHECKING:
    from mcp_server.services.event_broadcaster import EventBroadcaster

logger = get_logger("api.routes.websocket")


def _parse_filters(ws: WebSocket) -> ClientFilter:
    """Parse optional filter query parameters from the WebSocket request.

    Supported parameters:
    - ``ticket_ids``: Comma-separated ticket IDs
    - ``stages``: Comma-separated SDLC stage names

    Returns a :class:`ClientFilter` for use with the event broadcaster.
    """
    raw_ticket_ids = ws.query_params.get("ticket_ids")
    raw_stages = ws.query_params.get("stages")
    raw_types = ws.query_params.get("types")
    raw_agent_ids = ws.query_params.get("agent_ids")

    ticket_ids: frozenset[str] | None = None
    stages: frozenset[str] | None = None
    types: frozenset[str] | None = None
    agent_ids: frozenset[str] | None = None

    if raw_ticket_ids:
        ids = [tid.strip() for tid in raw_ticket_ids.split(",") if tid.strip()]
        if ids:
            ticket_ids = frozenset(ids)

    if raw_stages:
        stage_list = [s.strip().upper() for s in raw_stages.split(",") if s.strip()]
        if stage_list:
            stages = frozenset(stage_list)

    if raw_types:
        type_list = [t.strip() for t in raw_types.split(",") if t.strip()]
        if type_list:
            types = frozenset(type_list)

    if raw_agent_ids:
        agent_list = [a.strip() for a in raw_agent_ids.split(",") if a.strip()]
        if agent_list:
            agent_ids = frozenset(agent_list)

    return ClientFilter(
        ticket_ids=ticket_ids, stages=stages, types=types, agent_ids=agent_ids,
    )


def create_websocket_endpoint(broadcaster_getter: Any) -> Any:
    """Create the WebSocket endpoint handler.

    Parameters
    ----------
    broadcaster_getter : callable
        A zero-argument callable that returns the
        :class:`EventBroadcaster` instance.  Uses deferred lookup so
        the broadcaster can be wired up after app creation.

    Returns
    -------
    coroutine
        An async WebSocket handler suitable for Starlette routing.
    """

    async def websocket_tickets(websocket: WebSocket) -> None:
        """Handle a WebSocket connection for ticket state streaming."""
        broadcaster: EventBroadcaster | None = broadcaster_getter()
        if broadcaster is None:
            await websocket.close(code=1013, reason="Service unavailable")
            return

        await websocket.accept()
        client_filter = _parse_filters(websocket)

        logger.info(
            "WebSocket client connected",
            extra={
                "ticket_ids": list(client_filter.ticket_ids) if client_filter.ticket_ids else None,
                "stages": list(client_filter.stages) if client_filter.stages else None,
            },
        )

        await broadcaster.register(websocket, client_filter)
        try:
            while True:
                try:
                    message = await websocket.receive_text()
                    # Handle client messages (e.g. filter updates)
                    await _handle_client_message(websocket, broadcaster, message)
                except WebSocketDisconnect:
                    break
        finally:
            await broadcaster.unregister(websocket)
            logger.info("WebSocket client disconnected")

    return websocket_tickets


async def _handle_client_message(
    ws: WebSocketLike,
    broadcaster: EventBroadcaster,
    raw_message: str,
) -> None:
    """Process an inbound client message.

    Supported message types:
    - ``subscribe``: Update client filter with provided criteria.
    - ``unsubscribe``: Reset client filter to receive all events.
    - ``pong``: Heartbeat response (no-op).

    Malformed messages are silently ignored to avoid crashing the
    connection loop.
    """
    try:
        data = json.loads(raw_message)
        msg_type = data.get("type", "")
        if msg_type == "subscribe":
            filters = data.get("filters", {})
            new_filter = _build_filter_from_message(filters)
            await broadcaster.update_filter(ws, new_filter)
            ack = json.dumps({"type": "subscribe_ack", "filters": _filter_to_dict(new_filter)})
            try:
                await ws.send_text(ack)
            except Exception:
                logger.warning("Failed to send subscribe ack")
        elif msg_type == "unsubscribe":
            await broadcaster.update_filter(ws, ClientFilter())
            ack = json.dumps({"type": "unsubscribe_ack"})
            try:
                await ws.send_text(ack)
            except Exception:
                logger.warning("Failed to send unsubscribe ack")
        elif msg_type == "pong":
            pass
        else:
            logger.debug(
                "Received unhandled WebSocket message type",
                extra={"type": msg_type},
            )
    except (json.JSONDecodeError, TypeError):
        logger.debug("Received non-JSON WebSocket message — ignoring")


def _build_filter_from_message(filters: dict[str, Any]) -> ClientFilter:
    """Build a ClientFilter from subscribe message filter criteria."""
    ticket_ids: frozenset[str] | None = None
    stages: frozenset[str] | None = None
    types: frozenset[str] | None = None
    agent_ids: frozenset[str] | None = None

    raw_tids = filters.get("ticket_ids")
    if isinstance(raw_tids, list) and raw_tids:
        ticket_ids = frozenset(str(t) for t in raw_tids)

    raw_stages = filters.get("stages")
    if isinstance(raw_stages, list) and raw_stages:
        stages = frozenset(str(s).upper() for s in raw_stages)

    raw_types = filters.get("types")
    if isinstance(raw_types, list) and raw_types:
        types = frozenset(str(t) for t in raw_types)

    raw_agents = filters.get("agent_ids")
    if isinstance(raw_agents, list) and raw_agents:
        agent_ids = frozenset(str(a) for a in raw_agents)

    return ClientFilter(
        ticket_ids=ticket_ids, stages=stages, types=types, agent_ids=agent_ids,
    )


def _filter_to_dict(filt: ClientFilter) -> dict[str, list[str] | None]:
    """Serialize a ClientFilter to a JSON-friendly dict for ack messages."""
    return {
        "ticket_ids": sorted(filt.ticket_ids) if filt.ticket_ids else None,
        "stages": sorted(filt.stages) if filt.stages else None,
        "types": sorted(filt.types) if filt.types else None,
        "agent_ids": sorted(filt.agent_ids) if filt.agent_ids else None,
    }
