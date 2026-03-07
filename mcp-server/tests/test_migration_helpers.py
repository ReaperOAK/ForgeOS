"""Tests for migration helper utilities.

TDD Evidence
------------
- RED: Tests written FIRST to define expected migration helper behavior.
- GREEN: ``db/migration_helpers.py`` implemented to satisfy these tests.
- REFACTOR: Enum helper consolidated, naming standardized.
"""

from __future__ import annotations

import pytest

from mcp_server.db.migration_helpers import (
    create_enum_type,
    create_updated_at_trigger,
    drop_enum_type,
    drop_updated_at_trigger,
    enum_values_from_type,
)

# ---------------------------------------------------------------------------
# Enum type helpers
# ---------------------------------------------------------------------------


class TestEnumTypeHelpers:
    """Verify SQL generation for PostgreSQL enum type management."""

    def test_create_enum_type_generates_valid_sql(self) -> None:
        """create_enum_type generates CREATE TYPE ... AS ENUM (...)."""
        sql = create_enum_type("ticket_status", ["READY", "BLOCKED", "CLAIMED", "DONE"])
        assert "CREATE TYPE ticket_status AS ENUM" in sql
        assert "'READY'" in sql
        assert "'BLOCKED'" in sql
        assert "'CLAIMED'" in sql
        assert "'DONE'" in sql

    def test_create_enum_type_quotes_values(self) -> None:
        """Enum values are properly single-quoted."""
        sql = create_enum_type("priority", ["high", "medium", "low"])
        assert "'high'" in sql
        assert "'medium'" in sql
        assert "'low'" in sql

    def test_create_enum_type_handles_single_value(self) -> None:
        """Works with a single enum value."""
        sql = create_enum_type("singleton", ["ONLY"])
        assert "'ONLY'" in sql
        assert "CREATE TYPE singleton AS ENUM" in sql

    def test_drop_enum_type_generates_valid_sql(self) -> None:
        """drop_enum_type generates DROP TYPE IF EXISTS ... CASCADE."""
        sql = drop_enum_type("ticket_status")
        assert "DROP TYPE IF EXISTS ticket_status CASCADE" in sql

    def test_enum_values_from_type_extracts_values(self) -> None:
        """enum_values_from_type returns the defined values for a known enum."""
        values = enum_values_from_type("ticket_status")
        assert "READY" in values
        assert "BLOCKED" in values
        assert "CLAIMED" in values
        assert "IN_PROGRESS" in values
        assert "DONE" in values
        assert "FAILED" in values
        assert "ESCALATED" in values

    def test_enum_values_from_type_ticket_stage(self) -> None:
        """ticket_stage enum contains all SDLC stages."""
        values = enum_values_from_type("ticket_stage")
        assert "READY" in values
        assert "BACKEND" in values
        assert "FRONTEND" in values
        assert "QA" in values
        assert "SECURITY" in values
        assert "CI" in values
        assert "DONE" in values

    def test_enum_values_from_type_unknown_raises(self) -> None:
        """Unknown enum type raises ValueError."""
        with pytest.raises(ValueError, match="Unknown enum type"):
            enum_values_from_type("nonexistent_type")

    def test_create_enum_type_empty_values_raises(self) -> None:
        """Empty values list raises ValueError."""
        with pytest.raises(ValueError, match="at least one value"):
            create_enum_type("empty_enum", [])


# ---------------------------------------------------------------------------
# Updated-at trigger helpers
# ---------------------------------------------------------------------------


class TestUpdatedAtTriggerHelpers:
    """Verify SQL generation for updated_at auto-update triggers."""

    def test_create_trigger_generates_function_and_trigger(self) -> None:
        """create_updated_at_trigger generates both function and trigger SQL."""
        sql = create_updated_at_trigger("projects")
        assert "CREATE OR REPLACE FUNCTION" in sql
        assert "update_updated_at" in sql
        assert "CREATE TRIGGER" in sql
        assert "trg_projects_updated_at" in sql
        assert "BEFORE UPDATE" in sql
        assert "projects" in sql

    def test_create_trigger_uses_table_name_in_trigger_name(self) -> None:
        """Trigger name includes the table name for uniqueness."""
        sql = create_updated_at_trigger("agents")
        assert "trg_agents_updated_at" in sql

    def test_drop_trigger_generates_valid_sql(self) -> None:
        """drop_updated_at_trigger removes both trigger and function."""
        sql = drop_updated_at_trigger("projects")
        assert "DROP TRIGGER IF EXISTS trg_projects_updated_at" in sql
        assert "projects" in sql
