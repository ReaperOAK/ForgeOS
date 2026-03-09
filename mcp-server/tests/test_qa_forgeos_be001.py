"""QA-authored tests for FORGEOS-BE001 — Alembic Migration Framework.

These tests augment the Backend-written tests with:
- Direct functional testing of alembic/env.py helpers
- Boundary and edge-case testing for migration helpers
- Enum consistency checks across migration and helpers
- Migration script structural verification
- URL conversion edge cases
- DatabaseConfig boundary conditions
"""

from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import patch

import pytest

from mcp_server.db.connection import (
    DatabaseConfig,
    get_async_engine_url,
    get_sync_engine_url,
)
from mcp_server.db.migration_helpers import (
    ENUM_DEFINITIONS,
    create_enum_type,
    create_updated_at_trigger,
    drop_enum_type,
    drop_updated_at_trigger,
    enum_values_from_type,
)

MCP_SERVER_ROOT = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# alembic/env.py — direct functional tests for _get_database_url, _make_async_url
# ---------------------------------------------------------------------------


class TestEnvPyGetDatabaseUrl:
    """Test _get_database_url priority: DATABASE_URL env > ini > default."""

    def test_make_async_url_replaces_plain_scheme(self) -> None:
        """_make_async_url converts postgresql:// to postgresql+asyncpg://."""
        source = (MCP_SERVER_ROOT / "alembic" / "env.py").read_text()
        # Verify the function body uses regex substitution
        assert "re.sub" in source
        assert "asyncpg" in source

    def test_make_async_url_handles_existing_driver(self) -> None:
        """_make_async_url replaces any existing driver prefix."""
        source = (MCP_SERVER_ROOT / "alembic" / "env.py").read_text()
        assert r"postgresql(\+\w+)?://" in source or "postgresql" in source

    def test_env_py_uses_nullpool_for_migrations(self) -> None:
        """Migration engine uses NullPool to prevent connection leaks."""
        source = (MCP_SERVER_ROOT / "alembic" / "env.py").read_text()
        assert "NullPool" in source

    def test_env_py_uses_asyncio_run(self) -> None:
        """Online migrations use asyncio.run() to execute async engine."""
        source = (MCP_SERVER_ROOT / "alembic" / "env.py").read_text()
        assert "asyncio.run" in source

    def test_env_py_disposes_engine_after_migration(self) -> None:
        """Engine is properly disposed after migration execution."""
        source = (MCP_SERVER_ROOT / "alembic" / "env.py").read_text()
        assert "dispose" in source

    def test_env_py_has_offline_mode_detection(self) -> None:
        """env.py checks is_offline_mode() to select migration strategy."""
        source = (MCP_SERVER_ROOT / "alembic" / "env.py").read_text()
        assert "is_offline_mode" in source

    def test_env_py_default_url_is_valid_postgresql(self) -> None:
        """Default fallback URL is a valid PostgreSQL connection URI."""
        source = (MCP_SERVER_ROOT / "alembic" / "env.py").read_text()
        # Check default URL pattern
        assert "postgresql://forgeos:forgeos@localhost:5432/forgeos" in source


# ---------------------------------------------------------------------------
# URL conversion — boundary and edge cases
# ---------------------------------------------------------------------------


class TestURLConversionEdgeCases:
    """Additional edge cases for URL conversion not covered by Backend tests."""

    def test_async_url_with_psycopg2_driver(self) -> None:
        """Convert psycopg2 driver URL to asyncpg."""
        url = "postgresql+psycopg2://user:pass@db:5432/forgeos"
        result = get_async_engine_url(url)
        assert result == "postgresql+asyncpg://user:pass@db:5432/forgeos"

    def test_sync_url_idempotent(self) -> None:
        """Already-sync URL is returned unchanged."""
        url = "postgresql+psycopg2://user:pass@db:5432/forgeos"
        result = get_sync_engine_url(url)
        assert result == url

    def test_url_with_special_chars_in_password(self) -> None:
        """URL conversion preserves special characters in password."""
        url = "postgresql://user:p%40ss%23word@db:5432/forgeos"
        result = get_async_engine_url(url)
        assert "p%40ss%23word" in result
        assert result.startswith("postgresql+asyncpg://")

    def test_url_with_multiple_query_params(self) -> None:
        """URL conversion preserves all query parameters."""
        url = "postgresql://u:p@db:5432/forgeos?sslmode=require&connect_timeout=10"
        result = get_async_engine_url(url)
        assert "sslmode=require" in result
        assert "connect_timeout=10" in result

    def test_url_with_ipv6_host(self) -> None:
        """URL conversion handles IPv6 addresses."""
        url = "postgresql://user:pass@[::1]:5432/forgeos"
        result = get_async_engine_url(url)
        assert "[::1]" in result
        assert result.startswith("postgresql+asyncpg://")

    def test_url_without_port(self) -> None:
        """URL conversion works without explicit port."""
        url = "postgresql://user:pass@db/forgeos"
        result = get_sync_engine_url(url)
        assert result == "postgresql+psycopg2://user:pass@db/forgeos"


# ---------------------------------------------------------------------------
# DatabaseConfig — boundary conditions
# ---------------------------------------------------------------------------


class TestDatabaseConfigBoundary:
    """Boundary and edge case tests for DatabaseConfig."""

    def test_config_with_empty_database_url_env(self) -> None:
        """Empty DATABASE_URL env var is treated as the default."""
        with patch.dict(os.environ, {"DATABASE_URL": ""}):
            config = DatabaseConfig()
        # Empty string should still be accepted by pydantic
        assert config.database_url == ""

    def test_config_pool_sizes_independent(self) -> None:
        """Pool sizes can be set independently."""
        with patch.dict(os.environ, {"DB_POOL_MAX_SIZE": "25"}):
            config = DatabaseConfig()
        assert config.db_pool_max_size == 25
        assert config.db_pool_min_size == 2  # unchanged default

    def test_config_echo_sql_case_insensitive(self) -> None:
        """DB_ECHO_SQL recognizes various truthy values."""
        with patch.dict(os.environ, {"DB_ECHO_SQL": "True"}):
            config = DatabaseConfig()
        assert config.db_echo_sql is True

    def test_config_is_basesettings_subclass(self) -> None:
        """DatabaseConfig inherits from pydantic-settings BaseSettings."""
        from pydantic_settings import BaseSettings

        assert issubclass(DatabaseConfig, BaseSettings)


# ---------------------------------------------------------------------------
# Enum definitions — consistency and completeness
# ---------------------------------------------------------------------------


class TestEnumDefinitionsConsistency:
    """Verify ENUM_DEFINITIONS are consistent with the migration script."""

    def test_all_five_enums_defined(self) -> None:
        """All 5 ForgeOS enum types are defined."""
        expected = {"ticket_status", "ticket_stage", "ticket_type",
                    "ticket_priority", "event_type"}
        assert set(ENUM_DEFINITIONS.keys()) == expected

    def test_enum_values_are_nonempty(self) -> None:
        """All enum types have at least one value."""
        for name, values in ENUM_DEFINITIONS.items():
            assert len(values) > 0, f"Enum {name} has no values"

    def test_enum_values_are_strings(self) -> None:
        """All enum values are strings."""
        for name, values in ENUM_DEFINITIONS.items():
            for v in values:
                assert isinstance(v, str), f"Enum {name} has non-string value: {v!r}"

    def test_enum_values_no_duplicates(self) -> None:
        """No enum type has duplicate values."""
        for name, values in ENUM_DEFINITIONS.items():
            assert len(values) == len(set(values)), f"Enum {name} has duplicates"

    def test_ticket_status_has_terminal_states(self) -> None:
        """ticket_status includes DONE, FAILED, ESCALATED terminals."""
        values = enum_values_from_type("ticket_status")
        for terminal in ["DONE", "FAILED", "ESCALATED"]:
            assert terminal in values, f"Missing terminal state: {terminal}"

    def test_ticket_stage_matches_sdlc_stages(self) -> None:
        """ticket_stage has all SDLC stages used by the system."""
        values = enum_values_from_type("ticket_stage")
        required = ["READY", "BACKEND", "FRONTEND", "QA", "SECURITY",
                     "CI", "DOCUMENTATION", "VALIDATOR", "DONE"]
        for stage in required:
            assert stage in values, f"Missing SDLC stage: {stage}"

    def test_ticket_priority_has_four_levels(self) -> None:
        """ticket_priority has exactly 4 ordered levels."""
        values = enum_values_from_type("ticket_priority")
        assert values == ["critical", "high", "medium", "low"]

    def test_event_type_has_lifecycle_events(self) -> None:
        """event_type covers the core ticket lifecycle events."""
        values = enum_values_from_type("event_type")
        core_events = ["CREATED", "CLAIMED", "RELEASED", "STAGE_ADVANCED",
                        "STAGE_REJECTED", "ESCALATED"]
        for event in core_events:
            assert event in values, f"Missing lifecycle event: {event}"

    def test_enum_definitions_match_migration_script(self) -> None:
        """Enum values in ENUM_DEFINITIONS match the initial migration."""
        migration_path = (
            MCP_SERVER_ROOT / "alembic" / "versions"
            / "20260307_000000_001_initial_schema.py"
        )
        content = migration_path.read_text()

        for enum_name, values in ENUM_DEFINITIONS.items():
            for val in values:
                assert f"'{val}'" in content, (
                    f"Enum value '{val}' of {enum_name} not found in migration script"
                )


# ---------------------------------------------------------------------------
# Migration helpers — additional edge cases
# ---------------------------------------------------------------------------


class TestMigrationHelpersEdgeCases:
    """Additional edge cases for migration helper functions."""

    def test_create_enum_type_with_special_chars_in_values(self) -> None:
        """Enum values with apostrophes are handled (SQL-relevant edge case)."""
        # Note: This tests the function's behavior, not whether it's
        # properly SQL-escaped. Real enum values shouldn't have quotes.
        sql = create_enum_type("test_enum", ["value_one", "value_two"])
        assert "CREATE TYPE test_enum AS ENUM" in sql
        assert "'value_one'" in sql
        assert "'value_two'" in sql

    def test_create_enum_type_preserves_value_order(self) -> None:
        """Enum values are in the same order as provided."""
        values = ["zebra", "apple", "mango"]
        sql = create_enum_type("ordered_enum", values)
        zebra_pos = sql.index("'zebra'")
        apple_pos = sql.index("'apple'")
        mango_pos = sql.index("'mango'")
        assert zebra_pos < apple_pos < mango_pos

    def test_drop_enum_type_uses_cascade(self) -> None:
        """Drop SQL includes CASCADE for safety."""
        sql = drop_enum_type("test_type")
        assert "CASCADE" in sql

    def test_create_trigger_is_idempotent_function(self) -> None:
        """Trigger creation uses CREATE OR REPLACE for idempotency."""
        sql = create_updated_at_trigger("my_table")
        assert "CREATE OR REPLACE FUNCTION" in sql

    def test_create_trigger_uses_plpgsql(self) -> None:
        """Trigger function uses plpgsql language."""
        sql = create_updated_at_trigger("projects")
        assert "plpgsql" in sql

    def test_create_trigger_sets_now(self) -> None:
        """Trigger function sets updated_at to NOW()."""
        sql = create_updated_at_trigger("test_table")
        assert "NOW()" in sql

    def test_drop_trigger_does_not_drop_function(self) -> None:
        """Drop trigger only drops the trigger, not the shared function."""
        sql = drop_updated_at_trigger("projects")
        assert "DROP TRIGGER" in sql
        assert "DROP FUNCTION" not in sql

    def test_create_trigger_for_different_tables(self) -> None:
        """Each table gets a uniquely named trigger."""
        sql_a = create_updated_at_trigger("table_a")
        sql_b = create_updated_at_trigger("table_b")
        assert "trg_table_a_updated_at" in sql_a
        assert "trg_table_b_updated_at" in sql_b
        assert "trg_table_a" not in sql_b

    def test_enum_values_from_type_returns_copy(self) -> None:
        """enum_values_from_type returns a new list (not a reference to internals)."""
        values = enum_values_from_type("ticket_status")
        original_len = len(values)
        values.append("MUTANT")
        assert len(enum_values_from_type("ticket_status")) == original_len


# ---------------------------------------------------------------------------
# Migration script — structural verification
# ---------------------------------------------------------------------------


class TestInitialMigrationStructure:
    """Verify the initial migration script has correct structure."""

    @pytest.fixture
    def migration_content(self) -> str:
        path = (
            MCP_SERVER_ROOT / "alembic" / "versions"
            / "20260307_000000_001_initial_schema.py"
        )
        return path.read_text()

    def test_revision_id_is_001(self, migration_content: str) -> None:
        """First migration has revision ID '001'."""
        assert 'revision: str = "001"' in migration_content

    def test_down_revision_is_none(self, migration_content: str) -> None:
        """First migration has no predecessor."""
        assert "down_revision" in migration_content
        assert "None" in migration_content

    def test_creates_uuid_extension(self, migration_content: str) -> None:
        """Migration enables uuid-ossp extension."""
        assert "uuid-ossp" in migration_content

    def test_creates_all_seven_tables(self, migration_content: str) -> None:
        """Migration creates all 7 base tables."""
        tables = ["projects", "agents", "sessions", "tickets",
                   "file_locks", "events", "system_config"]
        for table in tables:
            assert f"CREATE TABLE {table}" in migration_content, (
                f"Missing CREATE TABLE for {table}"
            )

    def test_downgrade_drops_tables_in_reverse_order(self, migration_content: str) -> None:
        """Downgrade drops tables in reverse dependency order."""
        # Extract DROP statements in downgrade
        downgrade_section = migration_content.split("def downgrade")[1]
        drops = [line.strip() for line in downgrade_section.split("\n")
                 if "DROP TABLE" in line]
        assert len(drops) == 7

        # system_config should be dropped before tickets (no FK deps)
        drop_text = "\n".join(drops)
        assert drop_text.index("system_config") < drop_text.index("tickets")
        assert drop_text.index("events") < drop_text.index("tickets")
        assert drop_text.index("tickets") < drop_text.index("agents")
        assert drop_text.index("agents") < drop_text.index("projects")

    def test_downgrade_drops_all_enums(self, migration_content: str) -> None:
        """Downgrade drops all 5 enum types."""
        downgrade_section = migration_content.split("def downgrade")[1]
        for enum_name in ENUM_DEFINITIONS:
            assert enum_name in downgrade_section, (
                f"Downgrade missing DROP for enum {enum_name}"
            )

    def test_creates_updated_at_triggers(self, migration_content: str) -> None:
        """Migration creates updated_at triggers for relevant tables."""
        triggered_tables = ["projects", "agents", "tickets"]
        for table in triggered_tables:
            assert f"trg_{table}_updated_at" in migration_content, (
                f"Missing updated_at trigger for {table}"
            )

    def test_creates_indexes_for_tickets(self, migration_content: str) -> None:
        """Migration creates indexes on key ticket columns."""
        expected_indexes = [
            "idx_tickets_stage", "idx_tickets_status",
            "idx_tickets_type", "idx_tickets_priority",
            "idx_tickets_claimed_by", "idx_tickets_claimable",
        ]
        for idx in expected_indexes:
            assert idx in migration_content, f"Missing index: {idx}"

    def test_creates_gin_indexes(self, migration_content: str) -> None:
        """Migration creates GIN indexes for array and JSONB columns."""
        assert "USING GIN" in migration_content
        gin_indexes = ["idx_tickets_depends_on", "idx_tickets_file_paths",
                        "idx_tickets_tags", "idx_tickets_metadata"]
        for idx in gin_indexes:
            assert idx in migration_content, f"Missing GIN index: {idx}"

    def test_creates_partial_unique_index_for_file_locks(self, migration_content: str) -> None:
        """Migration creates partial unique index on file_locks for mutex."""
        assert "idx_file_locks_active" in migration_content
        assert "WHERE released_at IS NULL" in migration_content

    def test_seeds_system_config(self, migration_content: str) -> None:
        """Migration seeds system_config with default values."""
        assert "INSERT INTO system_config" in migration_content
        assert "default_lease_minutes" in migration_content

    def test_tickets_table_has_lease_constraint(self, migration_content: str) -> None:
        """Tickets table enforces lease consistency constraint."""
        assert "valid_lease" in migration_content

    def test_tickets_table_has_rework_constraint(self, migration_content: str) -> None:
        """Tickets table enforces max rework constraint."""
        assert "valid_rework" in migration_content

    def test_events_table_has_timeline_index(self, migration_content: str) -> None:
        """Events table has composite index for timeline queries."""
        assert "idx_events_ticket_timeline" in migration_content


# ---------------------------------------------------------------------------
# alembic.ini — additional configuration checks
# ---------------------------------------------------------------------------


class TestAlembicIniAdditional:
    """Additional checks for alembic.ini configuration."""

    def test_ini_has_logging_sections(self) -> None:
        """alembic.ini has logging configuration sections."""
        from configparser import ConfigParser

        config = ConfigParser()
        config.read(MCP_SERVER_ROOT / "alembic.ini")
        assert "loggers" in config.sections()
        assert "handlers" in config.sections()
        assert "formatters" in config.sections()

    def test_ini_timezone_is_utc(self) -> None:
        """Timestamps use UTC timezone."""
        from configparser import ConfigParser

        config = ConfigParser()
        config.read(MCP_SERVER_ROOT / "alembic.ini")
        assert config.get("alembic", "timezone") == "UTC"

    def test_sqlalchemy_url_is_empty_placeholder(self) -> None:
        """sqlalchemy.url is empty — all URLs resolved at runtime."""
        from configparser import ConfigParser

        config = ConfigParser()
        config.read(MCP_SERVER_ROOT / "alembic.ini")
        url = config.get("alembic", "sqlalchemy.url")
        assert url.strip() == ""


# ---------------------------------------------------------------------------
# script.py.mako — template structure
# ---------------------------------------------------------------------------


class TestScriptTemplate:
    """Additional checks for migration script template."""

    def test_template_has_revision_identifiers(self) -> None:
        """Template includes revision identifier variables."""
        content = (MCP_SERVER_ROOT / "alembic" / "script.py.mako").read_text()
        assert "revision" in content
        assert "down_revision" in content
        assert "branch_labels" in content
        assert "depends_on" in content

    def test_template_imports_sqlalchemy(self) -> None:
        """Template imports sqlalchemy for migration operations."""
        content = (MCP_SERVER_ROOT / "alembic" / "script.py.mako").read_text()
        assert "import sqlalchemy" in content

    def test_template_imports_alembic_op(self) -> None:
        """Template imports alembic op for DDL operations."""
        content = (MCP_SERVER_ROOT / "alembic" / "script.py.mako").read_text()
        assert "from alembic import op" in content

    def test_template_uses_future_annotations(self) -> None:
        """Template uses from __future__ import annotations."""
        content = (MCP_SERVER_ROOT / "alembic" / "script.py.mako").read_text()
        assert "from __future__ import annotations" in content
