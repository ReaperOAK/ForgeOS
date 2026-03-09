"""Tests for migration 002 — Event History and Audit Tables.

TDD Evidence
------------
- RED: Tests written FIRST to define expected migration structure and behavior.
- GREEN: Migration script ``002_event_tables.py`` created to satisfy these tests.
- REFACTOR: SQL patterns standardized with migration 001 conventions.

Ticket: FORGEOS-BE003
Architecture: FORGEOS-ARCH007 (Event Sourcing Audit Trail Schema)
"""

from __future__ import annotations

import re
from pathlib import Path

MCP_SERVER_ROOT = Path(__file__).resolve().parent.parent
MIGRATION_DIR = MCP_SERVER_ROOT / "alembic" / "versions"


def _get_migration_002_path() -> Path:
    """Find migration 002 file by pattern."""
    candidates = list(MIGRATION_DIR.glob("*002*event*"))
    assert len(candidates) == 1, (
        f"Expected exactly 1 migration 002 file, found {len(candidates)}: {candidates}"
    )
    return candidates[0]


def _get_migration_002_content() -> str:
    """Read migration 002 source code."""
    return _get_migration_002_path().read_text()


# ---------------------------------------------------------------------------
# Migration file structure
# ---------------------------------------------------------------------------


class TestMigration002Structure:
    """Verify migration 002 file exists and has correct Alembic structure."""

    def test_migration_file_exists(self) -> None:
        """Migration 002 file exists in versions directory."""
        path = _get_migration_002_path()
        assert path.exists()

    def test_revision_is_002(self) -> None:
        """Revision identifier is '002'."""
        content = _get_migration_002_content()
        assert 'revision: str = "002"' in content

    def test_down_revision_is_001(self) -> None:
        """down_revision chains to migration 001."""
        content = _get_migration_002_content()
        assert "down_revision" in content
        assert '"001"' in content

    def test_has_upgrade_function(self) -> None:
        """upgrade() function is defined."""
        content = _get_migration_002_content()
        assert "def upgrade()" in content

    def test_has_downgrade_function(self) -> None:
        """downgrade() function is defined."""
        content = _get_migration_002_content()
        assert "def downgrade()" in content

    def test_uses_alembic_op(self) -> None:
        """Migration uses alembic op for DDL execution."""
        content = _get_migration_002_content()
        assert "from alembic import op" in content
        assert "op.execute(" in content


# ---------------------------------------------------------------------------
# AC1: Event_history table
# ---------------------------------------------------------------------------


class TestEventHistoryTable:
    """AC1: event_history table with required columns."""

    def test_creates_event_history_table(self) -> None:
        """CREATE TABLE event_history statement exists."""
        content = _get_migration_002_content()
        assert "CREATE TABLE event_history" in content

    def test_has_uuid_primary_key(self) -> None:
        """event_history uses UUID primary key (maps to AC 'event_id')."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert "UUID PRIMARY KEY" in eh_section

    def test_has_ticket_id_fk(self) -> None:
        """ticket_id references tickets table (FK)."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert re.search(
            r"ticket_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+tickets",
            eh_section,
        )

    def test_has_event_type_column(self) -> None:
        """event_type column uses event_type enum."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert re.search(r"event_type\s+event_type\s+NOT\s+NULL", eh_section)

    def test_has_previous_state_jsonb(self) -> None:
        """previous_state column is JSONB."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert re.search(r"previous_state\s+JSONB", eh_section)

    def test_has_new_state_jsonb(self) -> None:
        """new_state column is JSONB."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert re.search(r"new_state\s+JSONB", eh_section)

    def test_has_agent_id_fk(self) -> None:
        """agent_id references agents table (FK)."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert re.search(r"agent_id\s+UUID\s+REFERENCES\s+agents", eh_section)

    def test_has_machine_id(self) -> None:
        """machine_id column exists."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert re.search(r"machine_id\s+TEXT", eh_section)

    def test_has_timestamp(self) -> None:
        """Timestamp column with TIMESTAMPTZ type exists."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert "TIMESTAMPTZ" in eh_section

    def test_has_metadata_jsonb(self) -> None:
        """metadata column is JSONB with default empty object."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_section = content[eh_start:eh_start + 1000]
        assert re.search(r"metadata\s+JSONB\s+NOT\s+NULL\s+DEFAULT", eh_section)


# ---------------------------------------------------------------------------
# AC2: Stage_transitions table
# ---------------------------------------------------------------------------


class TestStageTransitionsTable:
    """AC2: stage_transitions table with required columns."""

    def test_creates_stage_transitions_table(self) -> None:
        """CREATE TABLE stage_transitions statement exists."""
        content = _get_migration_002_content()
        assert "CREATE TABLE stage_transitions" in content

    def test_has_uuid_primary_key(self) -> None:
        """stage_transitions uses UUID primary key (maps to AC 'transition_id')."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert "UUID PRIMARY KEY" in st_section

    def test_has_ticket_id_fk(self) -> None:
        """ticket_id references tickets table (FK)."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert re.search(
            r"ticket_id\s+TEXT\s+NOT\s+NULL\s+REFERENCES\s+tickets",
            st_section,
        )

    def test_has_from_stage(self) -> None:
        """from_stage column uses ticket_stage enum."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert re.search(r"from_stage\s+ticket_stage", st_section)

    def test_has_to_stage(self) -> None:
        """to_stage column uses ticket_stage enum, NOT NULL."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert re.search(r"to_stage\s+ticket_stage\s+NOT\s+NULL", st_section)

    def test_has_triggered_by(self) -> None:
        """triggered_by column exists for recording who triggered the transition."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert "triggered_by" in st_section

    def test_has_reason(self) -> None:
        """reason column exists for recording transition reason."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert re.search(r"reason\s+TEXT", st_section)

    def test_has_timestamp(self) -> None:
        """Timestamp column with TIMESTAMPTZ exists."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert "TIMESTAMPTZ" in st_section


# ---------------------------------------------------------------------------
# AC3: File_locks table (created in migration 001)
# ---------------------------------------------------------------------------


class TestFileLocksTable:
    """AC3: file_locks table exists — created in migration 001."""

    def test_file_locks_created_in_migration_001(self) -> None:
        """file_locks table was already created in migration 001."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        assert "CREATE TABLE file_locks" in content

    def test_file_locks_has_primary_key(self) -> None:
        """file_locks has UUID primary key (maps to AC 'lock_id')."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        fl_start = content.index("CREATE TABLE file_locks")
        fl_section = content[fl_start:fl_start + 800]
        assert "UUID PRIMARY KEY" in fl_section

    def test_file_locks_has_file_path(self) -> None:
        """file_locks has file_path column."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        fl_start = content.index("CREATE TABLE file_locks")
        fl_section = content[fl_start:fl_start + 800]
        assert "file_path" in fl_section

    def test_file_locks_has_ticket_id(self) -> None:
        """file_locks has ticket_id column (maps to AC 'ticket_id FK')."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        fl_start = content.index("CREATE TABLE file_locks")
        fl_section = content[fl_start:fl_start + 800]
        assert "ticket_id" in fl_section

    def test_file_locks_has_agent_reference(self) -> None:
        """file_locks references agents table (maps to AC 'agent_id FK')."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        fl_start = content.index("CREATE TABLE file_locks")
        fl_section = content[fl_start:fl_start + 800]
        assert "REFERENCES agents" in fl_section

    def test_file_locks_has_acquired_timestamp(self) -> None:
        """file_locks has acquisition timestamp (maps to AC 'acquired_at')."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        fl_start = content.index("CREATE TABLE file_locks")
        fl_section = content[fl_start:fl_start + 800]
        # Column is named locked_at in migration 001 (same semantics as acquired_at)
        assert "locked_at" in fl_section

    def test_file_locks_has_released_at(self) -> None:
        """file_locks has released_at column."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        fl_start = content.index("CREATE TABLE file_locks")
        fl_section = content[fl_start:fl_start + 800]
        assert "released_at" in fl_section


# ---------------------------------------------------------------------------
# AC4: Append-only semantics (immutability enforcement)
# ---------------------------------------------------------------------------


class TestImmutabilityEnforcement:
    """AC4: event_history enforces append-only semantics."""

    def test_update_trigger_exists(self) -> None:
        """BEFORE UPDATE trigger prevents modifications."""
        content = _get_migration_002_content()
        assert "trg_event_history_no_update" in content

    def test_delete_trigger_exists(self) -> None:
        """BEFORE DELETE trigger prevents deletions."""
        content = _get_migration_002_content()
        assert "trg_event_history_no_delete" in content

    def test_update_trigger_raises_exception(self) -> None:
        """Update prevention function raises an exception."""
        content = _get_migration_002_content()
        assert "RAISE EXCEPTION" in content

    def test_update_trigger_is_before_update(self) -> None:
        """Trigger fires BEFORE UPDATE on event_history."""
        content = _get_migration_002_content()
        assert re.search(r"BEFORE\s+UPDATE\s+ON\s+event_history", content)

    def test_delete_trigger_is_before_delete(self) -> None:
        """Trigger fires BEFORE DELETE on event_history."""
        content = _get_migration_002_content()
        assert re.search(r"BEFORE\s+DELETE\s+ON\s+event_history", content)

    def test_trigger_function_uses_plpgsql(self) -> None:
        """Trigger functions use plpgsql language."""
        content = _get_migration_002_content()
        assert "plpgsql" in content

    def test_trigger_is_per_row(self) -> None:
        """Triggers fire FOR EACH ROW."""
        content = _get_migration_002_content()
        assert content.count("FOR EACH ROW") >= 2


# ---------------------------------------------------------------------------
# AC5: Foreign keys reference core tables from migration 001
# ---------------------------------------------------------------------------


class TestForeignKeyReferences:
    """AC5: All foreign keys reference core tables from migration 001."""

    def test_event_history_ticket_id_references_tickets(self) -> None:
        """event_history.ticket_id -> tickets(ticket_id)."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_end = content.index("CREATE TABLE stage_transitions")
        eh_section = content[eh_start:eh_end]
        assert "REFERENCES tickets" in eh_section

    def test_event_history_agent_id_references_agents(self) -> None:
        """event_history.agent_id -> agents(id)."""
        content = _get_migration_002_content()
        eh_start = content.index("CREATE TABLE event_history")
        eh_end = content.index("CREATE TABLE stage_transitions")
        eh_section = content[eh_start:eh_end]
        assert "REFERENCES agents" in eh_section

    def test_stage_transitions_ticket_id_references_tickets(self) -> None:
        """stage_transitions.ticket_id -> tickets(ticket_id)."""
        content = _get_migration_002_content()
        st_start = content.index("CREATE TABLE stage_transitions")
        st_section = content[st_start:st_start + 1000]
        assert "REFERENCES tickets" in st_section

    def test_core_tables_exist_in_migration_001(self) -> None:
        """tickets and agents tables are defined in migration 001."""
        migration_001 = next(iter(MIGRATION_DIR.glob("*001*initial*")))
        content = migration_001.read_text()
        assert "CREATE TABLE tickets" in content
        assert "CREATE TABLE agents" in content


# ---------------------------------------------------------------------------
# AC6: Migration downgrades cleanly
# ---------------------------------------------------------------------------


class TestCleanDowngrade:
    """AC6: Migration downgrades cleanly, dropping all event/audit tables."""

    def test_downgrade_drops_event_history(self) -> None:
        """downgrade() drops event_history table."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        assert "DROP TABLE IF EXISTS event_history" in downgrade

    def test_downgrade_drops_stage_transitions(self) -> None:
        """downgrade() drops stage_transitions table."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        assert "DROP TABLE IF EXISTS stage_transitions" in downgrade

    def test_downgrade_drops_update_trigger(self) -> None:
        """downgrade() drops the no-update trigger."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        assert "DROP TRIGGER IF EXISTS trg_event_history_no_update" in downgrade

    def test_downgrade_drops_delete_trigger(self) -> None:
        """downgrade() drops the no-delete trigger."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        assert "DROP TRIGGER IF EXISTS trg_event_history_no_delete" in downgrade

    def test_downgrade_drops_trigger_functions(self) -> None:
        """downgrade() drops the trigger prevention functions."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        assert "DROP FUNCTION IF EXISTS prevent_event_history_update" in downgrade
        assert "DROP FUNCTION IF EXISTS prevent_event_history_delete" in downgrade

    def test_downgrade_drops_sequence(self) -> None:
        """downgrade() drops the events_sequence_number_seq sequence."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        assert "DROP SEQUENCE IF EXISTS events_sequence_number_seq" in downgrade

    def test_downgrade_removes_enhanced_events_columns(self) -> None:
        """downgrade() removes event sourcing columns from events table."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        for col in [
            "sequence_number",
            "aggregate_version",
            "correlation_id",
            "causation_id",
            "schema_version",
        ]:
            assert col in downgrade, f"Downgrade missing column removal: {col}"

    def test_downgrade_does_not_drop_file_locks(self) -> None:
        """downgrade() does NOT drop file_locks (owned by migration 001)."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        assert "DROP TABLE IF EXISTS file_locks" not in downgrade


# ---------------------------------------------------------------------------
# Event sourcing enhancements (ARCH007)
# ---------------------------------------------------------------------------


class TestEventSourcingEnhancements:
    """Verify ARCH007 event sourcing enhancements on existing events table."""

    def test_creates_sequence(self) -> None:
        """Creates events_sequence_number_seq for global ordering."""
        content = _get_migration_002_content()
        assert "CREATE SEQUENCE" in content
        assert "events_sequence_number_seq" in content

    def test_adds_sequence_number_to_events(self) -> None:
        """ALTER TABLE events adds sequence_number column."""
        content = _get_migration_002_content()
        assert "sequence_number" in content
        assert "nextval" in content

    def test_adds_aggregate_version_to_events(self) -> None:
        """ALTER TABLE events adds aggregate_version column."""
        content = _get_migration_002_content()
        assert "aggregate_version" in content

    def test_adds_correlation_id_to_events(self) -> None:
        """ALTER TABLE events adds correlation_id UUID column."""
        content = _get_migration_002_content()
        assert "correlation_id" in content

    def test_adds_causation_id_to_events(self) -> None:
        """ALTER TABLE events adds causation_id UUID column."""
        content = _get_migration_002_content()
        assert "causation_id" in content

    def test_adds_schema_version_to_events(self) -> None:
        """ALTER TABLE events adds schema_version column."""
        content = _get_migration_002_content()
        assert "schema_version" in content

    def test_extends_event_type_enum_with_done(self) -> None:
        """Adds DONE value to event_type enum."""
        content = _get_migration_002_content()
        assert re.search(r"ADD\s+VALUE.*'DONE'", content)

    def test_extends_event_type_enum_with_reworked(self) -> None:
        """Adds REWORKED value to event_type enum."""
        content = _get_migration_002_content()
        assert re.search(r"ADD\s+VALUE.*'REWORKED'", content)

    def test_unique_aggregate_version_index(self) -> None:
        """UNIQUE index on (ticket_id, aggregate_version) for optimistic concurrency."""
        content = _get_migration_002_content()
        assert "idx_events_aggregate_version" in content
        assert re.search(r"UNIQUE\s+INDEX\s+idx_events_aggregate_version", content)


# ---------------------------------------------------------------------------
# Indexes
# ---------------------------------------------------------------------------


class TestIndexes:
    """Verify query-path indexes are created for new tables and columns."""

    def test_event_history_ticket_id_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_event_history_ticket_id" in content

    def test_event_history_event_type_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_event_history_event_type" in content

    def test_event_history_created_at_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_event_history_created_at" in content

    def test_event_history_ticket_timeline_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_event_history_ticket_timeline" in content

    def test_event_history_metadata_gin_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_event_history_metadata" in content
        assert "GIN" in content

    def test_stage_transitions_ticket_id_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_stage_transitions_ticket_id" in content

    def test_stage_transitions_created_at_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_stage_transitions_created_at" in content

    def test_stage_transitions_ticket_timeline_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_stage_transitions_ticket_timeline" in content

    def test_events_sequence_number_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_events_sequence_number" in content

    def test_events_correlation_id_index(self) -> None:
        content = _get_migration_002_content()
        assert "idx_events_correlation_id" in content

    def test_downgrade_drops_all_new_indexes(self) -> None:
        """downgrade() drops all indexes created in this migration."""
        content = _get_migration_002_content()
        downgrade = content[content.index("def downgrade"):]
        expected_indexes = [
            "idx_event_history_ticket_id",
            "idx_event_history_event_type",
            "idx_event_history_created_at",
            "idx_event_history_ticket_timeline",
            "idx_event_history_metadata",
            "idx_stage_transitions_ticket_id",
            "idx_stage_transitions_created_at",
            "idx_stage_transitions_ticket_timeline",
            "idx_events_sequence_number",
            "idx_events_aggregate_version",
            "idx_events_correlation_id",
            "idx_events_causation_id",
        ]
        for idx in expected_indexes:
            assert idx in downgrade, f"Downgrade missing index drop: {idx}"
