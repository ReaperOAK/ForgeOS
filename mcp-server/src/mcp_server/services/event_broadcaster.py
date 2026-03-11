"""Real-time event broadcaster for WebSocket ticket state streaming.

Manages WebSocket client connections and broadcasts ticket state change
events to all connected clients.  Supports optional filtering by ticket
IDs or SDLC stages, and a configurable heartbeat ping to detect stale
connections.

.. meta::
   :ticket: FORGEOS-BE039, FORGEOS-BE040
"""

from __future__ import annotations

import asyncio
import contextlib
import json
from collections import deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

from mcp_server.observability import get_logger

logger = get_logger("services.event_broadcaster")


class WebSocketLike(Protocol):
    """Minimal protocol for WebSocket-like objects."""

    async def send_text(self, data: str) -> None: ...

    async def send_bytes(self, data: bytes) -> None: ...


@dataclass(frozen=True, slots=True)
class ClientFilter:
    """Optional filters for a connected WebSocket client.

    When all fields are ``None`` (the default), the client receives
    ALL ticket state change events.  When one or more dimensions are
    set, only events matching at least one dimension are delivered
    (OR logic across dimensions).

    Attributes
    ----------
    ticket_ids : frozenset[str] | None
        If set, only events for these ticket IDs are delivered.
    stages : frozenset[str] | None
        If set, only events involving these stages (old or new) are delivered.
    types : frozenset[str] | None
        If set, only events whose ``payload.type`` matches are delivered.
    agent_ids : frozenset[str] | None
        If set, only events whose ``payload.agent_id`` matches are delivered.
    """

    ticket_ids: frozenset[str] | None = None
    stages: frozenset[str] | None = None
    types: frozenset[str] | None = None
    agent_ids: frozenset[str] | None = None


@dataclass(frozen=True, slots=True)
class TicketEvent:
    """Immutable representation of a ticket state change event.

    Attributes
    ----------
    ticket_id : str
        The ticket identifier (e.g. ``FORGEOS-BE039``).
    event_type : str
        The type of state change (e.g. ``ticket.claimed``).
    old_stage : str
        The SDLC stage before the change.
    new_stage : str
        The SDLC stage after the change.
    timestamp : str
        ISO 8601 timestamp of the event.
    payload : dict[str, Any]
        Additional event data (agent_id, reason, etc.).
    """

    ticket_id: str
    event_type: str
    old_stage: str
    new_stage: str
    timestamp: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    payload: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the event to a JSON-compatible dictionary."""
        result: dict[str, Any] = {
            "ticket_id": self.ticket_id,
            "event_type": self.event_type,
            "old_stage": self.old_stage,
            "new_stage": self.new_stage,
            "timestamp": self.timestamp,
        }
        if self.payload:
            result["payload"] = self.payload
        return result

    def to_json(self) -> str:
        """Serialize the event to a JSON string."""
        return json.dumps(self.to_dict())


def matches_filter(event: TicketEvent, client_filter: ClientFilter) -> bool:
    """Check whether *event* passes the client's filter criteria.

    Returns ``True`` when no filters are set (wildcard), or when the
    event matches at least one of the configured filter dimensions.
    Multiple filter dimensions are combined with OR logic.
    """
    has_any = (
        client_filter.ticket_ids is not None
        or client_filter.stages is not None
        or client_filter.types is not None
        or client_filter.agent_ids is not None
    )
    if not has_any:
        return True

    if client_filter.ticket_ids is not None and event.ticket_id in client_filter.ticket_ids:
        return True

    if client_filter.stages is not None and (
        event.old_stage in client_filter.stages or event.new_stage in client_filter.stages
    ):
        return True

    if client_filter.types is not None:
        event_type = event.payload.get("type")
        if event_type is not None and event_type in client_filter.types:
            return True

    if client_filter.agent_ids is not None:
        event_agent = event.payload.get("agent_id")
        if event_agent is not None and event_agent in client_filter.agent_ids:
            return True

    return False


_DEFAULT_PING_INTERVAL_SECONDS = 30.0
_DEFAULT_BUFFER_LIMIT = 256


class EventBroadcaster:
    """Manages WebSocket clients and broadcasts ticket state events.

    The broadcaster maintains a registry of connected clients with
    their optional filters.  When :meth:`publish` is called, the event
    is fan-out delivered to every client whose filter matches.

    A background ping task periodically sends WebSocket pings to detect
    stale connections and remove them.  Start the ping loop with
    :meth:`start` and stop it with :meth:`stop`.
    """

    def __init__(
        self,
        *,
        ping_interval: float = _DEFAULT_PING_INTERVAL_SECONDS,
        buffer_limit: int = _DEFAULT_BUFFER_LIMIT,
    ) -> None:
        self._clients: dict[WebSocketLike, ClientFilter] = {}
        self._buffers: dict[WebSocketLike, deque[str]] = {}
        self._ping_interval = ping_interval
        self._buffer_limit = buffer_limit
        self._ping_task: asyncio.Task[None] | None = None

    @property
    def buffer_limit(self) -> int:
        """Return the per-client buffer limit."""
        return self._buffer_limit

    @property
    def client_count(self) -> int:
        """Return the number of currently connected clients."""
        return len(self._clients)

    async def register(
        self,
        ws: WebSocketLike,
        client_filter: ClientFilter | None = None,
    ) -> None:
        """Register a WebSocket client for event delivery.

        Parameters
        ----------
        ws : WebSocketLike
            The WebSocket connection to register.
        client_filter : ClientFilter | None
            Optional filter criteria.  ``None`` means receive all events.
        """
        filt = client_filter or ClientFilter()
        self._clients[ws] = filt
        self._buffers[ws] = deque(maxlen=self._buffer_limit)
        logger.info(
            "WebSocket client registered",
            extra={"client_count": len(self._clients)},
        )

    async def unregister(self, ws: WebSocketLike) -> None:
        """Remove a WebSocket client from the broadcast list.

        Safe to call even if the client is not registered.
        """
        removed = self._clients.pop(ws, None)
        self._buffers.pop(ws, None)
        if removed is not None:
            logger.info(
                "WebSocket client unregistered",
                extra={"client_count": len(self._clients)},
            )

    async def publish(self, event: TicketEvent) -> int:
        """Broadcast an event to all matching connected clients.

        Delivery failures for individual clients are caught and logged;
        the failing client is automatically unregistered.

        Returns
        -------
        int
            Number of clients the event was successfully delivered to.
        """
        if not self._clients:
            return 0

        message = event.to_json()
        delivered = 0
        failed: list[WebSocketLike] = []

        for ws, filt in list(self._clients.items()):
            if not matches_filter(event, filt):
                continue
            try:
                await ws.send_text(message)
                delivered += 1
            except Exception:
                logger.warning(
                    "Failed to send event to WebSocket client — removing",
                    extra={"ticket_id": event.ticket_id, "event_type": event.event_type},
                )
                failed.append(ws)

            # Track the event in the per-client backpressure buffer.
            # deque(maxlen=N) automatically drops the oldest entry.
            buf = self._buffers.get(ws)
            if buf is not None:
                buf.append(message)

        for ws in failed:
            self._clients.pop(ws, None)
            self._buffers.pop(ws, None)

        return delivered

    async def update_filter(self, ws: WebSocketLike, new_filter: ClientFilter) -> None:
        """Update the filter for an already-registered client.

        No-op if the client is not registered.
        """
        if ws not in self._clients:
            return
        self._clients[ws] = new_filter
        logger.info(
            "WebSocket client filter updated",
            extra={"client_count": len(self._clients)},
        )

    def get_filter(self, ws: WebSocketLike) -> ClientFilter | None:
        """Return the current filter for a registered client, or None."""
        return self._clients.get(ws)

    def get_buffer(self, ws: WebSocketLike) -> deque[str] | None:
        """Return the backpressure buffer for a client, or None."""
        return self._buffers.get(ws)

    async def _ping_loop(self) -> None:
        """Periodically send ping frames to detect stale connections."""
        while True:
            await asyncio.sleep(self._ping_interval)
            stale: list[WebSocketLike] = []
            for ws in list(self._clients):
                try:
                    await ws.send_bytes(b"ping")
                except Exception:
                    logger.info("Stale WebSocket client detected — removing")
                    stale.append(ws)
            for ws in stale:
                self._clients.pop(ws, None)

    async def start(self) -> None:
        """Start the background heartbeat ping loop."""
        if self._ping_task is None or self._ping_task.done():
            self._ping_task = asyncio.create_task(self._ping_loop())
            logger.info(
                "EventBroadcaster ping loop started",
                extra={"ping_interval": self._ping_interval},
            )

    async def stop(self) -> None:
        """Stop the background heartbeat ping loop and clear all clients."""
        if self._ping_task is not None and not self._ping_task.done():
            self._ping_task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._ping_task
            self._ping_task = None
        self._clients.clear()
        self._buffers.clear()
        logger.info("EventBroadcaster stopped")
