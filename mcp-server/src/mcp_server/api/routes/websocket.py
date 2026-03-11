"""WebSocket endpoint for real-time ticket state streaming.

Provides a Starlette WebSocket route handler at ``/ws/tickets`` that
streams ticket state change events to connected clients.

Query parameters:
- ``ticket_ids``: Comma-separated list of ticket IDs to filter
- ``stages``: Comma-separated list of SDLC stages to filter

.. meta::
   :ticket: FORGEOS-BE039
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

from starlette.websockets import WebSocket, WebSocketDisconnect

from mcp_server.observability import get_logger
from mcp_server.services.event_broadcaster import ClientFilter

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

    ticket_ids: frozenset[str] | None = None
    stages: frozenset[str] | None = None

    if raw_ticket_ids:
        ids = [tid.strip() for tid in raw_ticket_ids.split(",") if tid.strip()]
        if ids:
            ticket_ids = frozenset(ids)

    if raw_stages:
        stage_list = [s.strip().upper() for s in raw_stages.split(",") if s.strip()]
        if stage_list:
            stages = frozenset(stage_list)

    return ClientFilter(ticket_ids=ticket_ids, stages=stages)


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
                    _handle_client_message(websocket, broadcaster, message)
                except WebSocketDisconnect:
                    break
        finally:
            await broadcaster.unregister(websocket)
            logger.info("WebSocket client disconnected")

    return websocket_tickets


def _handle_client_message(
    ws: WebSocket,
    broadcaster: EventBroadcaster,
    raw_message: str,
) -> None:
    """Process an inbound client message (currently a no-op).

    Future extension point for dynamic filter updates or pong responses.
    Malformed messages are silently ignored to avoid crashing the
    connection loop.
    """
    try:
        data = json.loads(raw_message)
        msg_type = data.get("type", "")
        if msg_type == "pong":
            # Client responding to our ping — connection is alive
            pass
        else:
            logger.debug(
                "Received unhandled WebSocket message type",
                extra={"type": msg_type},
            )
    except (json.JSONDecodeError, TypeError):
        logger.debug("Received non-JSON WebSocket message — ignoring")
