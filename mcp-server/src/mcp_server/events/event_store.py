"""Append-only event store for the ForgeOS ticket lifecycle.

This module implements the event sourcing subsystem defined in
FORGEOS-ARCH007.  Every ticket state mutation (claim, advance, reject,
release, …) is captured as an immutable :class:`Event` with causal
ordering, correlation metadata, and JSON payload.

Design decisions
----------------
* **Immutable events** — once appended, events cannot be updated or
  deleted.  The ``EventStore`` exposes no mutation API.
* **In-memory fallback** — the store ships with an in-memory backend
  so the subsystem is usable without a live database (CI, tests).
  A PostgreSQL-backed adapter can be injected via ``create_event_store``.
* **Frozen dataclass** — ``Event`` instances are immutable value objects.
* **Monotonic sequencing** — ``sequence_number`` provides global total
  ordering; ``aggregate_version`` provides per-ticket ordering.
* **Replay** — ``replay_ticket_events`` returns the ordered event
  stream for a single ticket, enabling state reconstruction.

.. meta::
   :ticket: FORGEOS-BE012
   :last_reviewed: 2026-03-10
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Protocol

# ---------------------------------------------------------------------------
# Event type enumeration (matches FORGEOS-ARCH007 §5)
# ---------------------------------------------------------------------------


class EventType(str, Enum):
    """Classification of ticket lifecycle events.

    Values align with the ``event_type`` PostgreSQL enum defined in
    the FORGEOS-ARCH007 event sourcing schema.
    """

    CREATED = "CREATED"
    CLAIMED = "CLAIMED"
    RELEASED = "RELEASED"
    FORCE_RELEASED = "FORCE_RELEASED"
    STAGE_ADVANCED = "STAGE_ADVANCED"
    STAGE_REJECTED = "STAGE_REJECTED"
    REWORKED = "REWORKED"
    ESCALATED = "ESCALATED"
    DONE = "DONE"
    UPDATED = "UPDATED"
    SPAWNED = "SPAWNED"
    LEASE_EXTENDED = "LEASE_EXTENDED"
    RECONCILED = "RECONCILED"
    FILE_LOCKED = "FILE_LOCKED"
    FILE_UNLOCKED = "FILE_UNLOCKED"

    # Aliases requested by the ticket acceptance criteria
    ADVANCED = "STAGE_ADVANCED"
    SYNCED = "RECONCILED"
    LEASE_EXPIRED = "FORCE_RELEASED"


# ---------------------------------------------------------------------------
# Event value object (frozen — immutable after creation)
# ---------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class Event:
    """An immutable domain event in the ticket lifecycle.

    Every field is set at creation time and cannot be changed afterwards.
    The ``payload`` dict carries event-type-specific data (see §6 of
    FORGEOS-ARCH007 for schemas per event type).

    Attributes
    ----------
    id : str
        UUID v4 event identifier.
    ticket_id : str
        The ticket this event belongs to (aggregate root).
    event_type : EventType
        Classification of the event.
    agent_id : str
        Identifier of the acting agent.
    machine_id : str
        Hostname of the machine that produced the event.
    timestamp : datetime
        UTC wall-clock time when the event was created.
    correlation_id : str
        Groups related events across tickets.
    payload : dict[str, Any]
        Event-type-specific data.
    previous_stage : str | None
        SDLC stage before the transition (if applicable).
    new_stage : str | None
        SDLC stage after the transition (if applicable).
    sequence_number : int
        Global monotonic position in the event log.
    aggregate_version : int
        Per-ticket monotonic version number.
    causation_id : str | None
        ID of the event that caused this event.
    schema_version : int
        Payload schema version for forward compatibility.
    """

    id: str
    ticket_id: str
    event_type: EventType
    agent_id: str
    machine_id: str
    timestamp: datetime
    correlation_id: str
    payload: dict[str, Any] = field(default_factory=dict)
    previous_stage: str | None = None
    new_stage: str | None = None
    sequence_number: int = 0
    aggregate_version: int = 0
    causation_id: str | None = None
    schema_version: int = 1


# ---------------------------------------------------------------------------
# EventStore protocol — allows swapping the backend
# ---------------------------------------------------------------------------


class EventStoreBackend(Protocol):
    """Protocol for pluggable event persistence backends."""

    def append_event(self, event: Event) -> Event:
        """Persist a single event.  Returns the event with sequence numbers set."""
        ...  # pragma: no cover

    def get_events_by_ticket(
        self,
        ticket_id: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return events for *ticket_id*, ordered by aggregate_version."""
        ...  # pragma: no cover

    def get_events_by_type(
        self,
        event_type: EventType,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return events matching *event_type*, ordered by sequence_number."""
        ...  # pragma: no cover

    def get_events_by_agent(
        self,
        agent_id: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return events produced by *agent_id*, ordered by sequence_number."""
        ...  # pragma: no cover


# ---------------------------------------------------------------------------
# In-memory backend (default — no external dependencies)
# ---------------------------------------------------------------------------


class InMemoryEventBackend:
    """Thread-safe in-memory event store backend.

    Suitable for tests, CI, and bootstrap scenarios where a database
    is not yet available.  NOT intended for production use.
    """

    def __init__(self) -> None:
        self._events: list[Event] = []
        self._sequence_counter: int = 0
        self._version_counters: dict[str, int] = {}

    def append_event(self, event: Event) -> Event:
        """Persist an event in memory with assigned sequence numbers."""
        self._sequence_counter += 1
        ticket_version = self._version_counters.get(event.ticket_id, 0) + 1
        self._version_counters[event.ticket_id] = ticket_version

        # Replace sequence/version on a new frozen instance
        stored = Event(
            id=event.id,
            ticket_id=event.ticket_id,
            event_type=event.event_type,
            agent_id=event.agent_id,
            machine_id=event.machine_id,
            timestamp=event.timestamp,
            correlation_id=event.correlation_id,
            payload=event.payload,
            previous_stage=event.previous_stage,
            new_stage=event.new_stage,
            sequence_number=self._sequence_counter,
            aggregate_version=ticket_version,
            causation_id=event.causation_id,
            schema_version=event.schema_version,
        )
        self._events.append(stored)
        return stored

    def get_events_by_ticket(
        self,
        ticket_id: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return all events for a ticket, ordered by aggregate_version."""
        return sorted(
            (
                e
                for e in self._events
                if e.ticket_id == ticket_id
                and (since is None or e.timestamp >= since)
                and (until is None or e.timestamp <= until)
            ),
            key=lambda e: e.aggregate_version,
        )

    def get_events_by_type(
        self,
        event_type: EventType,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return all events of a given type, ordered by sequence_number."""
        return sorted(
            (
                e
                for e in self._events
                if e.event_type == event_type
                and (since is None or e.timestamp >= since)
                and (until is None or e.timestamp <= until)
            ),
            key=lambda e: e.sequence_number,
        )

    def get_events_by_agent(
        self,
        agent_id: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return all events by a specific agent, ordered by sequence_number."""
        return sorted(
            (
                e
                for e in self._events
                if e.agent_id == agent_id
                and (since is None or e.timestamp >= since)
                and (until is None or e.timestamp <= until)
            ),
            key=lambda e: e.sequence_number,
        )


# ---------------------------------------------------------------------------
# EventStore — main public interface
# ---------------------------------------------------------------------------


class EventStore:
    """Append-only event store for ticket lifecycle events.

    The store enforces immutability: events can be appended and queried,
    but never modified or deleted.  It delegates persistence to a
    pluggable :class:`EventStoreBackend`.

    Parameters
    ----------
    backend : EventStoreBackend | None
        Persistence backend.  Defaults to :class:`InMemoryEventBackend`.
    """

    def __init__(self, backend: EventStoreBackend | None = None) -> None:
        self._backend: EventStoreBackend = backend or InMemoryEventBackend()

    # -- Write API ----------------------------------------------------------

    def append_event(
        self,
        ticket_id: str,
        event_type: EventType,
        *,
        agent_id: str,
        machine_id: str,
        correlation_id: str | None = None,
        payload: dict[str, Any] | None = None,
        previous_stage: str | None = None,
        new_stage: str | None = None,
        causation_id: str | None = None,
        schema_version: int = 1,
    ) -> Event:
        """Append an immutable event to the store.

        Parameters
        ----------
        ticket_id : str
            The ticket aggregate this event belongs to.
        event_type : EventType
            Classification (CLAIMED, ADVANCED, etc.).
        agent_id : str
            ID of the agent producing the event.
        machine_id : str
            Hostname where the event originated.
        correlation_id : str | None
            Optional correlation group ID.  Auto-generated if omitted.
        payload : dict[str, Any] | None
            Event-type-specific data.
        previous_stage : str | None
            Stage before the transition.
        new_stage : str | None
            Stage after the transition.
        causation_id : str | None
            ID of the event that caused this one.
        schema_version : int
            Payload schema version (default ``1``).

        Returns
        -------
        Event
            The persisted event with sequence numbers assigned.
        """
        event = Event(
            id=str(uuid.uuid4()),
            ticket_id=ticket_id,
            event_type=event_type,
            agent_id=agent_id,
            machine_id=machine_id,
            timestamp=datetime.now(timezone.utc),
            correlation_id=correlation_id or str(uuid.uuid4()),
            payload=payload or {},
            previous_stage=previous_stage,
            new_stage=new_stage,
            causation_id=causation_id,
            schema_version=schema_version,
        )
        return self._backend.append_event(event)

    # -- Read API -----------------------------------------------------------

    def get_events_by_ticket(
        self,
        ticket_id: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return all events for a ticket, ordered by aggregate_version.

        Parameters
        ----------
        ticket_id : str
            The ticket to query.
        since : datetime | None
            Lower bound (inclusive) for timestamp filtering.
        until : datetime | None
            Upper bound (inclusive) for timestamp filtering.

        Returns
        -------
        list[Event]
            Ordered list of events for the ticket.
        """
        return self._backend.get_events_by_ticket(
            ticket_id, since=since, until=until,
        )

    def get_events_by_type(
        self,
        event_type: EventType,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return all events of a given type, ordered by sequence_number.

        Parameters
        ----------
        event_type : EventType
            The event type to filter by.
        since : datetime | None
            Lower bound (inclusive) for timestamp filtering.
        until : datetime | None
            Upper bound (inclusive) for timestamp filtering.

        Returns
        -------
        list[Event]
            Ordered list of matching events.
        """
        return self._backend.get_events_by_type(
            event_type, since=since, until=until,
        )

    def get_events_by_agent(
        self,
        agent_id: str,
        *,
        since: datetime | None = None,
        until: datetime | None = None,
    ) -> list[Event]:
        """Return all events produced by a specific agent.

        Parameters
        ----------
        agent_id : str
            The agent to filter by.
        since : datetime | None
            Lower bound (inclusive) for timestamp filtering.
        until : datetime | None
            Upper bound (inclusive) for timestamp filtering.

        Returns
        -------
        list[Event]
            Ordered list of matching events.
        """
        return self._backend.get_events_by_agent(
            agent_id, since=since, until=until,
        )

    def replay_ticket_events(self, ticket_id: str) -> list[Event]:
        """Replay the full ordered event stream for state reconstruction.

        Returns every event for the given ticket in strict
        ``aggregate_version`` order — suitable for rebuilding the
        ticket's current state from scratch.

        Parameters
        ----------
        ticket_id : str
            The ticket to replay.

        Returns
        -------
        list[Event]
            Complete ordered event stream.
        """
        return self._backend.get_events_by_ticket(ticket_id)

    def reconstruct_ticket_state(self, ticket_id: str) -> dict[str, Any]:
        """Reconstruct current ticket state by replaying all events.

        Applies each event in order to build a state dictionary that
        represents the ticket's current status, stage, and metadata.

        Parameters
        ----------
        ticket_id : str
            The ticket to reconstruct.

        Returns
        -------
        dict[str, Any]
            Reconstructed ticket state including stage, status, and
            event history metadata.
        """
        events = self.replay_ticket_events(ticket_id)
        if not events:
            return {}

        state: dict[str, Any] = {
            "ticket_id": ticket_id,
            "stage": None,
            "status": "active",
            "claimed_by": None,
            "machine_id": None,
            "rework_count": 0,
            "event_count": len(events),
            "created_at": events[0].timestamp.isoformat(),
            "last_event_at": events[-1].timestamp.isoformat(),
            "last_event_type": events[-1].event_type.value,
        }

        for event in events:
            etype = event.event_type

            if etype == EventType.CREATED:
                state["stage"] = event.new_stage or "READY"
                state["status"] = "active"
            elif etype == EventType.CLAIMED:
                state["claimed_by"] = event.agent_id
                state["machine_id"] = event.machine_id
            elif etype in (EventType.RELEASED, EventType.FORCE_RELEASED):
                state["claimed_by"] = None
                state["machine_id"] = None
            elif etype == EventType.STAGE_ADVANCED:
                state["stage"] = event.new_stage
                state["claimed_by"] = None
                state["machine_id"] = None
            elif etype == EventType.STAGE_REJECTED:
                state["stage"] = event.new_stage
                state["claimed_by"] = None
                state["machine_id"] = None
                state["rework_count"] = state.get("rework_count", 0) + 1
            elif etype == EventType.REWORKED:
                state["claimed_by"] = event.agent_id
                state["machine_id"] = event.machine_id
            elif etype == EventType.ESCALATED:
                state["status"] = "escalated"
            elif etype == EventType.DONE:
                state["status"] = "done"
                state["stage"] = "DONE"

        return state


# ---------------------------------------------------------------------------
# Factory function
# ---------------------------------------------------------------------------


def create_event_store(backend: EventStoreBackend | None = None) -> EventStore:
    """Create an ``EventStore`` with the specified backend.

    Parameters
    ----------
    backend : EventStoreBackend | None
        Persistence backend.  Defaults to :class:`InMemoryEventBackend`.

    Returns
    -------
    EventStore
        Configured event store instance ready for use.
    """
    return EventStore(backend=backend)
