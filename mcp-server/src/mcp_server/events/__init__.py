"""ForgeOS event sourcing subsystem — append-only event store.

This package provides the event sourcing infrastructure for recording
every ticket state change as an immutable event.  It follows the
enhanced hybrid model from FORGEOS-ARCH007: the mutable ``tickets``
table remains the primary state source while the ``events`` table
provides a complete, append-only audit trail with replay capability.

Public API
----------
* :class:`EventType` — enumeration of all valid event types.
* :class:`Event` — frozen dataclass representing a single domain event.
* :class:`EventStore` — append-only event store with query and replay.
* :func:`create_event_store` — factory for constructing an ``EventStore``.
"""

from mcp_server.events.event_store import (
    Event,
    EventStore,
    EventType,
    create_event_store,
)

__all__ = [
    "Event",
    "EventStore",
    "EventType",
    "create_event_store",
]
