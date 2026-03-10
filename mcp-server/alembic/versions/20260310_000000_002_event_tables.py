"""Event history and audit tables — event sourcing enhancements.

Revision ID: 002
Revises: 001
Create Date: 2026-03-10

Implements the event sourcing and audit trail tables from FORGEOS-ARCH007:
- event_history: Immutable append-only log of all ticket state changes
  with JSONB before/after state snapshots.
- stage_transitions: Records each SDLC stage transition with metadata.
- Enhances existing events table with event sourcing columns
  (sequence_number, aggregate_version, correlation_id, causation_id,
  schema_version) per the enhanced hybrid model.
- Extends event_type enum with DONE and REWORKED values.
- Immutability enforcement via BEFORE UPDATE/DELETE triggers.

Note: file_locks table is created in migration 001 (001_initial_schema.py)
and satisfies AC3. This migration does not recreate it.

Architecture: FORGEOS-ARCH007 (Event Sourcing Audit Trail Schema)
Ticket: FORGEOS-BE003
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: str | None = "001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Create event history and audit tables with event sourcing enhancements.

    Creates the following database objects:

    Tables:
        event_history: Immutable append-only audit log with full JSONB state
            snapshots (previous_state, new_state). Foreign keys reference
            tickets(ticket_id) and agents(id) from migration 001.
        stage_transitions: SDLC stage transition log with from_stage, to_stage,
            triggered_by, and reason columns.

    Enum extensions:
        event_type: Adds DONE and REWORKED values for lifecycle completion
            and rework tracking.

    Enhanced columns (events table):
        sequence_number: Global monotonic ordering via events_sequence_number_seq.
        aggregate_version: Per-ticket version for optimistic concurrency.
        correlation_id: Links related events across tickets.
        causation_id: References the event that caused this event.
        schema_version: Payload schema version for event evolution.

    Triggers:
        trg_event_history_no_update: Prevents UPDATE on event_history.
        trg_event_history_no_delete: Prevents DELETE on event_history.

    Indexes:
        6 on event_history (ticket_id, event_type, agent_id, created_at,
            ticket+created_at composite, metadata GIN).
        5 on stage_transitions (ticket_id, from_stage, to_stage, created_at,
            ticket+created_at composite).
        4 on events (sequence_number, aggregate_version UNIQUE, correlation_id,
            causation_id).

    Raises:
        sqlalchemy.exc.OperationalError: If migration 001 has not been applied
            (missing tickets/agents tables or event_type enum).

    See Also:
        FORGEOS-ARCH007 (Event Sourcing Audit Trail Schema) for design rationale.
        docs/database/schema-reference.md for the full schema reference.
    """
    # ------------------------------------------------------------------
    # Extend event_type enum with new lifecycle values (ARCH007 §5.1)
    # ------------------------------------------------------------------
    op.execute("ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'DONE';")
    op.execute("ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'REWORKED';")

    # ------------------------------------------------------------------
    # Create global event sequence for monotonic ordering (ARCH007 §7.1)
    # ------------------------------------------------------------------
    op.execute("CREATE SEQUENCE IF NOT EXISTS events_sequence_number_seq;")

    # ------------------------------------------------------------------
    # Table: event_history — immutable append-only audit log (AC1)
    #
    # Records every ticket state change with full JSONB before/after
    # state snapshots. Foreign keys reference core tables from migration
    # 001 (tickets, agents). Immutability enforced via triggers below.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE event_history (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ticket_id       TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
            event_type      event_type NOT NULL,
            previous_state  JSONB,
            new_state       JSONB,
            agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
            machine_id      TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            metadata        JSONB NOT NULL DEFAULT '{}'::JSONB
        );
    """)

    # ------------------------------------------------------------------
    # Table: stage_transitions — SDLC stage transition log (AC2)
    #
    # Records each stage transition with who triggered it, the reason,
    # and from/to stages using the ticket_stage enum.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE stage_transitions (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ticket_id       TEXT NOT NULL REFERENCES tickets(ticket_id) ON DELETE CASCADE,
            from_stage      ticket_stage,
            to_stage        ticket_stage NOT NULL,
            triggered_by    TEXT NOT NULL,
            reason          TEXT,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # ------------------------------------------------------------------
    # Enhance existing events table with event sourcing columns (ARCH007 §4)
    #
    # These columns add global ordering, per-ticket versioning,
    # event correlation/causation, and schema evolution tracking.
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE events
            ADD COLUMN sequence_number BIGINT NOT NULL
                DEFAULT nextval('events_sequence_number_seq'),
            ADD COLUMN aggregate_version INTEGER NOT NULL DEFAULT 1,
            ADD COLUMN correlation_id UUID,
            ADD COLUMN causation_id UUID,
            ADD COLUMN schema_version INTEGER NOT NULL DEFAULT 1;
    """)

    # ------------------------------------------------------------------
    # Immutability enforcement: BEFORE UPDATE trigger (AC4)
    #
    # Prevents any UPDATE on event_history rows. Events are append-only.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_event_history_update()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'event_history table is append-only: UPDATE operations are prohibited';
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER trg_event_history_no_update
            BEFORE UPDATE ON event_history
            FOR EACH ROW
            EXECUTE FUNCTION prevent_event_history_update();
    """)

    # ------------------------------------------------------------------
    # Immutability enforcement: BEFORE DELETE trigger (AC4)
    #
    # Prevents any DELETE on event_history rows. Events are append-only.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION prevent_event_history_delete()
        RETURNS TRIGGER AS $$
        BEGIN
            RAISE EXCEPTION 'event_history table is append-only: DELETE operations are prohibited';
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER trg_event_history_no_delete
            BEFORE DELETE ON event_history
            FOR EACH ROW
            EXECUTE FUNCTION prevent_event_history_delete();
    """)

    # ------------------------------------------------------------------
    # Indexes: event_history — primary query paths
    # ------------------------------------------------------------------
    op.execute(
        "CREATE INDEX idx_event_history_ticket_id ON event_history(ticket_id);"
    )
    op.execute(
        "CREATE INDEX idx_event_history_event_type ON event_history(event_type);"
    )
    op.execute(
        "CREATE INDEX idx_event_history_agent_id ON event_history(agent_id);"
    )
    op.execute(
        "CREATE INDEX idx_event_history_created_at ON event_history(created_at);"
    )
    op.execute("""
        CREATE INDEX idx_event_history_ticket_timeline
            ON event_history(ticket_id, created_at);
    """)
    op.execute(
        "CREATE INDEX idx_event_history_metadata ON event_history USING GIN(metadata);"
    )

    # ------------------------------------------------------------------
    # Indexes: stage_transitions — primary query paths
    # ------------------------------------------------------------------
    op.execute(
        "CREATE INDEX idx_stage_transitions_ticket_id "
        "ON stage_transitions(ticket_id);"
    )
    op.execute(
        "CREATE INDEX idx_stage_transitions_from_stage "
        "ON stage_transitions(from_stage);"
    )
    op.execute(
        "CREATE INDEX idx_stage_transitions_to_stage "
        "ON stage_transitions(to_stage);"
    )
    op.execute(
        "CREATE INDEX idx_stage_transitions_created_at "
        "ON stage_transitions(created_at);"
    )
    op.execute("""
        CREATE INDEX idx_stage_transitions_ticket_timeline
            ON stage_transitions(ticket_id, created_at);
    """)

    # ------------------------------------------------------------------
    # Indexes: enhanced events table columns (ARCH007 §11)
    # ------------------------------------------------------------------
    op.execute(
        "CREATE INDEX idx_events_sequence_number ON events(sequence_number);"
    )
    op.execute("""
        CREATE UNIQUE INDEX idx_events_aggregate_version
            ON events(ticket_id, aggregate_version);
    """)
    op.execute(
        "CREATE INDEX idx_events_correlation_id ON events(correlation_id);"
    )
    op.execute(
        "CREATE INDEX idx_events_causation_id ON events(causation_id);"
    )


def downgrade() -> None:
    """Revert event history and audit tables and event sourcing enhancements.

    Drops objects in reverse dependency order:

    1. Enhanced events column indexes (causation, correlation, aggregate_version,
       sequence_number).
    2. stage_transitions indexes and table.
    3. event_history triggers (no_delete, no_update), trigger functions
       (prevent_event_history_delete, prevent_event_history_update),
       indexes, and table.
    4. Enhanced columns from events table (schema_version, causation_id,
       correlation_id, aggregate_version, sequence_number).
    5. events_sequence_number_seq sequence.

    Note:
        PostgreSQL does not support removing individual enum values. The DONE
        and REWORKED values added to event_type persist until the enum type
        is dropped entirely (in migration 001's downgrade).
    """
    # ------------------------------------------------------------------
    # Drop indexes on enhanced events columns
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS idx_events_causation_id;")
    op.execute("DROP INDEX IF EXISTS idx_events_correlation_id;")
    op.execute("DROP INDEX IF EXISTS idx_events_aggregate_version;")
    op.execute("DROP INDEX IF EXISTS idx_events_sequence_number;")

    # ------------------------------------------------------------------
    # Drop stage_transitions indexes and table
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS idx_stage_transitions_ticket_timeline;")
    op.execute("DROP INDEX IF EXISTS idx_stage_transitions_created_at;")
    op.execute("DROP INDEX IF EXISTS idx_stage_transitions_to_stage;")
    op.execute("DROP INDEX IF EXISTS idx_stage_transitions_from_stage;")
    op.execute("DROP INDEX IF EXISTS idx_stage_transitions_ticket_id;")
    op.execute("DROP TABLE IF EXISTS stage_transitions CASCADE;")

    # ------------------------------------------------------------------
    # Drop event_history triggers, functions, indexes, and table
    # ------------------------------------------------------------------
    op.execute(
        "DROP TRIGGER IF EXISTS trg_event_history_no_delete ON event_history;"
    )
    op.execute(
        "DROP TRIGGER IF EXISTS trg_event_history_no_update ON event_history;"
    )
    op.execute("DROP FUNCTION IF EXISTS prevent_event_history_delete() CASCADE;")
    op.execute("DROP FUNCTION IF EXISTS prevent_event_history_update() CASCADE;")
    op.execute("DROP INDEX IF EXISTS idx_event_history_metadata;")
    op.execute("DROP INDEX IF EXISTS idx_event_history_ticket_timeline;")
    op.execute("DROP INDEX IF EXISTS idx_event_history_created_at;")
    op.execute("DROP INDEX IF EXISTS idx_event_history_agent_id;")
    op.execute("DROP INDEX IF EXISTS idx_event_history_event_type;")
    op.execute("DROP INDEX IF EXISTS idx_event_history_ticket_id;")
    op.execute("DROP TABLE IF EXISTS event_history CASCADE;")

    # ------------------------------------------------------------------
    # Remove enhanced columns from events table
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE events
            DROP COLUMN IF EXISTS schema_version,
            DROP COLUMN IF EXISTS causation_id,
            DROP COLUMN IF EXISTS correlation_id,
            DROP COLUMN IF EXISTS aggregate_version,
            DROP COLUMN IF EXISTS sequence_number;
    """)

    # ------------------------------------------------------------------
    # Drop sequence
    # ------------------------------------------------------------------
    op.execute("DROP SEQUENCE IF EXISTS events_sequence_number_seq;")

    # ------------------------------------------------------------------
    # Note: Cannot easily remove enum values (DONE, REWORKED) in
    # PostgreSQL. They persist until the enum type is dropped in
    # migration 001's downgrade. This is a known PostgreSQL limitation.
    # ------------------------------------------------------------------
