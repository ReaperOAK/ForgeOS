"""Tests for the event sourcing subsystem (FORGEOS-BE012).

Covers all acceptance criteria:
  AC1: EventStore.append_event() with ticket_id, event_type, prev_state, new_state, metadata
  AC2: Events are immutable once written (frozen dataclass, no update/delete API)
  AC3: Event types: CLAIMED, ADVANCED, REWORKED, RELEASED, SYNCED, CREATED, LEASE_EXPIRED
  AC4: Event replay returns ordered event stream for a given ticket_id
  AC5: Events include agent_id, machine_id, and ISO8601 timestamp
  AC6: Bulk query support: by ticket, by agent, by time range

TDD Methodology: RED-GREEN-REFACTOR per cycle.
"""

from __future__ import annotations

import re
from datetime import datetime, timedelta, timezone

import pytest

from mcp_server.events.event_store import (
    Event,
    EventStore,
    EventType,
    InMemoryEventBackend,
    create_event_store,
)

UUID4_PATTERN = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$"
)


# =========================================================================
# Fixtures
# =========================================================================


@pytest.fixture()
def store() -> EventStore:
    """Provide a fresh EventStore with in-memory backend."""
    return create_event_store()


@pytest.fixture()
def populated_store(store: EventStore) -> EventStore:
    """An EventStore pre-populated with events for two tickets."""
    # Ticket A: CREATED -> CLAIMED -> ADVANCED -> DONE
    store.append_event(
        "TICKET-A",
        EventType.CREATED,
        agent_id="agent-todo",
        machine_id="system",
        new_stage="READY",
    )
    store.append_event(
        "TICKET-A",
        EventType.CLAIMED,
        agent_id="agent-backend",
        machine_id="pop-os",
        payload={"lease_expiry": "2026-03-10T13:00:00+00:00"},
    )
    store.append_event(
        "TICKET-A",
        EventType.STAGE_ADVANCED,
        agent_id="agent-backend",
        machine_id="pop-os",
        previous_stage="BACKEND",
        new_stage="QA",
    )
    store.append_event(
        "TICKET-A",
        EventType.DONE,
        agent_id="agent-validator",
        machine_id="pop-os",
        new_stage="DONE",
    )

    # Ticket B: CREATED -> CLAIMED -> RELEASED
    store.append_event(
        "TICKET-B",
        EventType.CREATED,
        agent_id="agent-todo",
        machine_id="system",
        new_stage="READY",
    )
    store.append_event(
        "TICKET-B",
        EventType.CLAIMED,
        agent_id="agent-frontend",
        machine_id="dev-box",
    )
    store.append_event(
        "TICKET-B",
        EventType.RELEASED,
        agent_id="agent-frontend",
        machine_id="dev-box",
        payload={"reason": "need more info"},
    )
    return store


# =========================================================================
# AC1: EventStore.append_event() — append with full metadata
# =========================================================================


class TestAppendEvent:
    """AC1: EventStore provides append_event() with all required fields."""

    def test_append_returns_event_with_uuid_id(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001",
            EventType.CREATED,
            agent_id="agent-1",
            machine_id="host-1",
        )
        assert UUID4_PATTERN.match(event.id), f"Not a UUID v4: {event.id}"

    def test_append_assigns_sequence_number(self, store: EventStore) -> None:
        e1 = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        e2 = store.append_event(
            "T-001", EventType.CLAIMED, agent_id="a", machine_id="m"
        )
        assert e1.sequence_number == 1
        assert e2.sequence_number == 2

    def test_append_assigns_aggregate_version(self, store: EventStore) -> None:
        e1 = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        e2 = store.append_event(
            "T-001", EventType.CLAIMED, agent_id="a", machine_id="m"
        )
        assert e1.aggregate_version == 1
        assert e2.aggregate_version == 2

    def test_append_aggregate_version_per_ticket(self, store: EventStore) -> None:
        store.append_event("T-001", EventType.CREATED, agent_id="a", machine_id="m")
        store.append_event("T-002", EventType.CREATED, agent_id="a", machine_id="m")
        e3 = store.append_event(
            "T-001", EventType.CLAIMED, agent_id="a", machine_id="m"
        )
        e4 = store.append_event(
            "T-002", EventType.CLAIMED, agent_id="a", machine_id="m"
        )
        # Each ticket has independent versioning
        assert e3.aggregate_version == 2
        assert e4.aggregate_version == 2

    def test_append_preserves_payload(self, store: EventStore) -> None:
        payload = {"lease_expiry": "2026-03-10T13:00:00+00:00", "lease_minutes": 30}
        event = store.append_event(
            "T-001",
            EventType.CLAIMED,
            agent_id="agent-be",
            machine_id="host",
            payload=payload,
        )
        assert event.payload == payload

    def test_append_stores_stage_transitions(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001",
            EventType.STAGE_ADVANCED,
            agent_id="a",
            machine_id="m",
            previous_stage="BACKEND",
            new_stage="QA",
        )
        assert event.previous_stage == "BACKEND"
        assert event.new_stage == "QA"

    def test_append_auto_generates_correlation_id(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        assert UUID4_PATTERN.match(event.correlation_id)

    def test_append_accepts_explicit_correlation_id(self, store: EventStore) -> None:
        cid = "aaaaaaaa-bbbb-4ccc-9ddd-eeeeeeeeeeee"
        event = store.append_event(
            "T-001",
            EventType.CREATED,
            agent_id="a",
            machine_id="m",
            correlation_id=cid,
        )
        assert event.correlation_id == cid

    def test_append_stores_causation_id(self, store: EventStore) -> None:
        e1 = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        e2 = store.append_event(
            "T-001",
            EventType.CLAIMED,
            agent_id="a",
            machine_id="m",
            causation_id=e1.id,
        )
        assert e2.causation_id == e1.id

    def test_append_default_schema_version_is_one(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        assert event.schema_version == 1

    def test_append_empty_payload_default(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        assert event.payload == {}


# =========================================================================
# AC2: Events are immutable (no update/delete)
# =========================================================================


class TestImmutability:
    """AC2: Events are immutable once appended — frozen dataclass."""

    def test_event_is_frozen(self) -> None:
        event = Event(
            id="test-id",
            ticket_id="T-001",
            event_type=EventType.CREATED,
            agent_id="a",
            machine_id="m",
            timestamp=datetime.now(timezone.utc),
            correlation_id="cid",
        )
        with pytest.raises(AttributeError):
            event.ticket_id = "T-002"  # type: ignore[misc]

    def test_event_timestamp_immutable(self) -> None:
        event = Event(
            id="test-id",
            ticket_id="T-001",
            event_type=EventType.CREATED,
            agent_id="a",
            machine_id="m",
            timestamp=datetime.now(timezone.utc),
            correlation_id="cid",
        )
        with pytest.raises(AttributeError):
            event.timestamp = datetime.now(timezone.utc)  # type: ignore[misc]

    def test_no_update_api_on_store(self, store: EventStore) -> None:
        """EventStore has no update or delete methods."""
        assert not hasattr(store, "update_event")
        assert not hasattr(store, "delete_event")
        assert not hasattr(store, "remove_event")

    def test_no_mutation_api_on_backend(self) -> None:
        """InMemoryEventBackend has no update or delete methods."""
        backend = InMemoryEventBackend()
        assert not hasattr(backend, "update_event")
        assert not hasattr(backend, "delete_event")
        assert not hasattr(backend, "remove_event")


# =========================================================================
# AC3: Event types cover required set
# =========================================================================


class TestEventTypes:
    """AC3: Required event types are present."""

    def test_created_type_exists(self) -> None:
        assert EventType.CREATED == "CREATED"

    def test_claimed_type_exists(self) -> None:
        assert EventType.CLAIMED == "CLAIMED"

    def test_advanced_alias_maps_to_stage_advanced(self) -> None:
        assert EventType.ADVANCED == EventType.STAGE_ADVANCED

    def test_reworked_type_exists(self) -> None:
        assert EventType.REWORKED == "REWORKED"

    def test_released_type_exists(self) -> None:
        assert EventType.RELEASED == "RELEASED"

    def test_synced_alias_maps_to_reconciled(self) -> None:
        assert EventType.SYNCED == EventType.RECONCILED

    def test_lease_expired_alias_maps_to_force_released(self) -> None:
        assert EventType.LEASE_EXPIRED == EventType.FORCE_RELEASED

    def test_all_arch_event_types_present(self) -> None:
        """All 15 event types from FORGEOS-ARCH007 §5 are present."""
        required = {
            "CREATED",
            "CLAIMED",
            "RELEASED",
            "FORCE_RELEASED",
            "STAGE_ADVANCED",
            "STAGE_REJECTED",
            "REWORKED",
            "ESCALATED",
            "DONE",
            "UPDATED",
            "SPAWNED",
            "LEASE_EXTENDED",
            "RECONCILED",
            "FILE_LOCKED",
            "FILE_UNLOCKED",
        }
        actual = {e.value for e in EventType}
        assert required.issubset(actual), f"Missing: {required - actual}"

    def test_event_type_is_string_enum(self) -> None:
        assert isinstance(EventType.CREATED, str)
        assert EventType.CREATED == "CREATED"


# =========================================================================
# AC4: Event replay for ticket state reconstruction
# =========================================================================


class TestReplay:
    """AC4: Event replay returns ordered event stream."""

    def test_replay_returns_ordered_stream(
        self, populated_store: EventStore
    ) -> None:
        events = populated_store.replay_ticket_events("TICKET-A")
        assert len(events) == 4
        versions = [e.aggregate_version for e in events]
        assert versions == sorted(versions)

    def test_replay_returns_only_target_ticket(
        self, populated_store: EventStore
    ) -> None:
        events = populated_store.replay_ticket_events("TICKET-A")
        assert all(e.ticket_id == "TICKET-A" for e in events)

    def test_replay_empty_for_unknown_ticket(self, store: EventStore) -> None:
        assert store.replay_ticket_events("NONEXISTENT") == []

    def test_reconstruct_state_from_events(
        self, populated_store: EventStore
    ) -> None:
        state = populated_store.reconstruct_ticket_state("TICKET-A")
        assert state["ticket_id"] == "TICKET-A"
        assert state["stage"] == "DONE"
        assert state["status"] == "done"
        assert state["event_count"] == 4

    def test_reconstruct_active_ticket(
        self, populated_store: EventStore
    ) -> None:
        state = populated_store.reconstruct_ticket_state("TICKET-B")
        assert state["ticket_id"] == "TICKET-B"
        assert state["status"] == "active"
        # After RELEASED, claimed_by should be None
        assert state["claimed_by"] is None

    def test_reconstruct_unknown_ticket_returns_empty(
        self, store: EventStore
    ) -> None:
        assert store.reconstruct_ticket_state("NONEXISTENT") == {}

    def test_reconstruct_tracks_rework_count(self, store: EventStore) -> None:
        store.append_event(
            "T-RW",
            EventType.CREATED,
            agent_id="a",
            machine_id="m",
            new_stage="READY",
        )
        store.append_event(
            "T-RW",
            EventType.STAGE_REJECTED,
            agent_id="qa",
            machine_id="m",
            previous_stage="QA",
            new_stage="BACKEND",
        )
        state = store.reconstruct_ticket_state("T-RW")
        assert state["rework_count"] == 1


# =========================================================================
# AC5: Events include agent_id, machine_id, ISO8601 timestamp
# =========================================================================


class TestEventMetadata:
    """AC5: Each event has agent_id, machine_id, and ISO8601 timestamp."""

    def test_event_has_agent_id(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001",
            EventType.CREATED,
            agent_id="agent-backend",
            machine_id="host",
        )
        assert event.agent_id == "agent-backend"

    def test_event_has_machine_id(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001",
            EventType.CREATED,
            agent_id="agent-backend",
            machine_id="pop-os",
        )
        assert event.machine_id == "pop-os"

    def test_event_timestamp_is_utc(self, store: EventStore) -> None:
        event = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        assert event.timestamp.tzinfo is not None
        assert event.timestamp.tzinfo == timezone.utc

    def test_event_timestamp_is_iso8601_serializable(
        self, store: EventStore
    ) -> None:
        event = store.append_event(
            "T-001", EventType.CREATED, agent_id="a", machine_id="m"
        )
        iso = event.timestamp.isoformat()
        # Should contain timezone info ('+00:00')
        assert "+00:00" in iso or "Z" in iso


# =========================================================================
# AC6: Bulk query — by ticket, by agent, by time range
# =========================================================================


class TestBulkQueries:
    """AC6: Bulk query support — list events by ticket, by agent, by time range."""

    def test_get_events_by_ticket(self, populated_store: EventStore) -> None:
        events = populated_store.get_events_by_ticket("TICKET-A")
        assert len(events) == 4
        assert all(e.ticket_id == "TICKET-A" for e in events)

    def test_get_events_by_ticket_ordered(
        self, populated_store: EventStore
    ) -> None:
        events = populated_store.get_events_by_ticket("TICKET-A")
        versions = [e.aggregate_version for e in events]
        assert versions == sorted(versions)

    def test_get_events_by_type(self, populated_store: EventStore) -> None:
        events = populated_store.get_events_by_type(EventType.CREATED)
        assert len(events) == 2  # One per ticket
        assert all(e.event_type == EventType.CREATED for e in events)

    def test_get_events_by_type_ordered_by_sequence(
        self, populated_store: EventStore
    ) -> None:
        events = populated_store.get_events_by_type(EventType.CLAIMED)
        seqs = [e.sequence_number for e in events]
        assert seqs == sorted(seqs)

    def test_get_events_by_agent(self, populated_store: EventStore) -> None:
        events = populated_store.get_events_by_agent("agent-backend")
        assert len(events) == 2  # CLAIMED + STAGE_ADVANCED for TICKET-A
        assert all(e.agent_id == "agent-backend" for e in events)

    def test_get_events_by_agent_ordered_by_sequence(
        self, populated_store: EventStore
    ) -> None:
        events = populated_store.get_events_by_agent("agent-todo")
        seqs = [e.sequence_number for e in events]
        assert seqs == sorted(seqs)

    def test_time_range_filter_on_ticket_query(self, store: EventStore) -> None:
        now = datetime.now(timezone.utc)
        # Append two events
        store.append_event(
            "T-TR", EventType.CREATED, agent_id="a", machine_id="m"
        )
        store.append_event(
            "T-TR", EventType.CLAIMED, agent_id="a", machine_id="m"
        )
        # Query with since=future should return nothing
        future = now + timedelta(hours=1)
        events = store.get_events_by_ticket("T-TR", since=future)
        assert len(events) == 0

    def test_time_range_filter_since_returns_subset(
        self, store: EventStore
    ) -> None:
        # Everything is created "now", so since=past returns all
        past = datetime(2020, 1, 1, tzinfo=timezone.utc)
        store.append_event(
            "T-TR2", EventType.CREATED, agent_id="a", machine_id="m"
        )
        events = store.get_events_by_ticket("T-TR2", since=past)
        assert len(events) == 1

    def test_time_range_filter_on_type_query(self, store: EventStore) -> None:
        store.append_event(
            "T-X", EventType.CREATED, agent_id="a", machine_id="m"
        )
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        events = store.get_events_by_type(EventType.CREATED, since=future)
        assert len(events) == 0

    def test_time_range_filter_on_agent_query(self, store: EventStore) -> None:
        store.append_event(
            "T-X", EventType.CREATED, agent_id="agent-x", machine_id="m"
        )
        future = datetime.now(timezone.utc) + timedelta(hours=1)
        events = store.get_events_by_agent("agent-x", since=future)
        assert len(events) == 0

    def test_empty_results_for_unknown_ticket(self, store: EventStore) -> None:
        assert store.get_events_by_ticket("NONEXISTENT") == []

    def test_empty_results_for_unknown_agent(self, store: EventStore) -> None:
        assert store.get_events_by_agent("unknown-agent") == []


# =========================================================================
# Factory function
# =========================================================================


class TestFactory:
    """create_event_store() builds an EventStore."""

    def test_creates_event_store_instance(self) -> None:
        store = create_event_store()
        assert isinstance(store, EventStore)

    def test_accepts_custom_backend(self) -> None:
        backend = InMemoryEventBackend()
        store = create_event_store(backend=backend)
        store.append_event(
            "T-1", EventType.CREATED, agent_id="a", machine_id="m"
        )
        # Verify backend received the event
        assert len(backend.get_events_by_ticket("T-1")) == 1


# =========================================================================
# Package import
# =========================================================================


class TestPackageImport:
    """Verify the events package __init__.py exports correctly."""

    def test_import_event_type(self) -> None:
        from mcp_server.events import EventType

        assert EventType.CREATED == "CREATED"

    def test_import_event(self) -> None:
        from mcp_server.events import Event

        assert Event is not None

    def test_import_event_store(self) -> None:
        from mcp_server.events import EventStore

        assert EventStore is not None

    def test_import_factory(self) -> None:
        from mcp_server.events import create_event_store as f

        assert callable(f)
