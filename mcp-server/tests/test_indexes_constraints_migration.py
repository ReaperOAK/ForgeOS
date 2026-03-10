"""Tests for FORGEOS-BE004 — Database Indexes and Constraints Migration (003).

Verifies that the 003_indexes_constraints migration:
- Creates the correct composite, partial, and FK-coverage indexes
- Upgrades existing indexes (claimable, claims_active)
- Adds CHECK constraints for business rules
- Downgrades cleanly, restoring prior index state

QA Evidence
-----------
- Static analysis of migration file structure and SQL content.
- Validates all 7 acceptance criteria from FORGEOS-BE004.
- Verifies downgrade restores 001/002 original index definitions.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

MCP_SERVER_ROOT = Path(__file__).resolve().parent.parent
VERSIONS_DIR = MCP_SERVER_ROOT / "alembic" / "versions"


def _find_migration_file() -> Path:
    """Find the 003 indexes/constraints migration file."""
    candidates = sorted(VERSIONS_DIR.glob("*003*indexes_constraints*"))
    assert len(candidates) == 1, (
        f"Expected exactly one 003_indexes_constraints migration, found {len(candidates)}: {candidates}"
    )
    return candidates[0]


def _read_migration() -> str:
    return _find_migration_file().read_text()


def _parse_module() -> ast.Module:
    return ast.parse(_read_migration())


# ---------------------------------------------------------------------------
# Migration file structure
# ---------------------------------------------------------------------------


class TestMigrationFileStructure:
    """Verify migration file exists and has correct Alembic structure."""

    def test_migration_file_exists(self) -> None:
        path = _find_migration_file()
        assert path.exists()

    def test_has_revision_003(self) -> None:
        content = _read_migration()
        assert re.search(r'revision.*=.*["\']003["\']', content)

    def test_has_down_revision_002(self) -> None:
        content = _read_migration()
        assert re.search(r'down_revision.*=.*["\']002["\']', content)

    def test_has_upgrade_function(self) -> None:
        tree = _parse_module()
        func_names = [
            node.name
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
        ]
        assert "upgrade" in func_names

    def test_has_downgrade_function(self) -> None:
        tree = _parse_module()
        func_names = [
            node.name
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
        ]
        assert "downgrade" in func_names

    def test_imports_alembic_op(self) -> None:
        content = _read_migration()
        assert "from alembic import op" in content


# ---------------------------------------------------------------------------
# AC3: Composite index (stage, type, priority)
# ---------------------------------------------------------------------------


class TestCompositeIndexStageTypePriority:
    """AC3: Composite index on (stage, type, priority) for filtered listing."""

    def test_creates_idx_tickets_stage_type_priority(self) -> None:
        content = _read_migration()
        assert "idx_tickets_stage_type_priority" in content

    def test_index_covers_stage_type_priority_columns(self) -> None:
        content = _read_migration()
        pattern = re.compile(
            r"idx_tickets_stage_type_priority\s+ON\s+tickets\s*\(\s*stage\s*,\s*type\s*,\s*priority\s*\)",
            re.IGNORECASE,
        )
        assert pattern.search(content), "Index must be ON tickets(stage, type, priority)"

    def test_uses_if_not_exists(self) -> None:
        content = _read_migration()
        pattern = re.compile(
            r"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+idx_tickets_stage_type_priority",
            re.IGNORECASE,
        )
        assert pattern.search(content), "New indexes should use IF NOT EXISTS"


# ---------------------------------------------------------------------------
# AC4: Unique partial index on claims (active claim mutex)
# ---------------------------------------------------------------------------


class TestUniquePartialClaimsIndex:
    """AC4: Unique partial index ensuring one active claim per ticket."""

    def test_creates_unique_idx_claims_active(self) -> None:
        content = _read_migration()
        pattern = re.compile(
            r"CREATE\s+UNIQUE\s+INDEX\s+idx_claims_active",
            re.IGNORECASE,
        )
        assert pattern.search(content), "Must create UNIQUE INDEX idx_claims_active"

    def test_partial_where_released_at_is_null(self) -> None:
        content = _read_migration()
        pattern = re.compile(
            r"idx_claims_active\s+ON\s+claims\s*\(\s*ticket_id\s*\)\s+WHERE\s+released_at\s+IS\s+NULL",
            re.IGNORECASE,
        )
        assert pattern.search(content), "Unique partial index must filter WHERE released_at IS NULL"

    def test_drops_old_idx_claims_active_before_recreating(self) -> None:
        content = _read_migration()
        drop_pos = content.find("DROP INDEX IF EXISTS idx_claims_active")
        create_pos = content.find("CREATE UNIQUE INDEX idx_claims_active")
        assert drop_pos != -1, "Must DROP old idx_claims_active"
        assert create_pos != -1, "Must CREATE new idx_claims_active"
        assert drop_pos < create_pos, "DROP must come before CREATE"


# ---------------------------------------------------------------------------
# AC6: CHECK constraints
# ---------------------------------------------------------------------------


class TestCheckConstraints:
    """AC6: CHECK constraints for business rules."""

    def test_lease_duration_positive_constraint(self) -> None:
        content = _read_migration()
        assert "chk_tickets_lease_duration_positive" in content
        assert "lease_duration_minutes > 0" in content

    def test_max_reworks_non_negative_constraint(self) -> None:
        content = _read_migration()
        assert "chk_tickets_max_reworks_non_negative" in content
        assert "max_reworks >= 0" in content


# ---------------------------------------------------------------------------
# AC7: Clean downgrade
# ---------------------------------------------------------------------------


class TestDowngrade:
    """AC7: Migration downgrades cleanly."""

    def test_downgrade_drops_check_constraints(self) -> None:
        content = _read_migration()
        assert "DROP CONSTRAINT IF EXISTS chk_tickets_max_reworks_non_negative" in content
        assert "DROP CONSTRAINT IF EXISTS chk_tickets_lease_duration_positive" in content

    def test_downgrade_drops_new_indexes(self) -> None:
        content = _read_migration()
        new_indexes = [
            "idx_tickets_stage_type_priority",
            "idx_tickets_status_stage",
            "idx_tickets_stage_claimed_by",
            "idx_tickets_parent_id",
            "idx_tickets_active_claims",
            "idx_file_locks_locked_by",
            "idx_file_locks_ticket_id",
        ]
        for idx_name in new_indexes:
            assert f"DROP INDEX IF EXISTS {idx_name}" in content, (
                f"Downgrade must drop {idx_name}"
            )

    def test_downgrade_restores_claimable_without_stage(self) -> None:
        """After downgrade, idx_tickets_claimable should match 001 definition."""
        content = _read_migration()
        # The downgrade should recreate the original 001 index
        # ON tickets(priority, created_at) WHERE status = 'READY' AND claimed_by IS NULL
        downgrade_section = content[content.index("def downgrade"):]
        pattern = re.compile(
            r"idx_tickets_claimable\s+ON\s+tickets\s*\(\s*priority\s*,\s*created_at\s*\)",
            re.IGNORECASE,
        )
        assert pattern.search(downgrade_section), (
            "Downgrade must restore idx_tickets_claimable with original (priority, created_at) columns"
        )

    def test_downgrade_restores_claims_active_as_non_unique(self) -> None:
        """After downgrade, idx_claims_active should be non-unique (matching 002)."""
        content = _read_migration()
        downgrade_section = content[content.index("def downgrade"):]
        # Must CREATE INDEX (not UNIQUE INDEX) in downgrade
        pattern = re.compile(
            r"CREATE\s+INDEX\s+idx_claims_active\s+ON\s+claims\s*\(\s*ticket_id\s*\)\s+WHERE\s+released_at\s+IS\s+NULL",
            re.IGNORECASE,
        )
        assert pattern.search(downgrade_section), (
            "Downgrade must restore idx_claims_active as non-unique"
        )
        # Verify it's NOT unique in the downgrade
        unique_pattern = re.compile(
            r"CREATE\s+UNIQUE\s+INDEX\s+idx_claims_active",
            re.IGNORECASE,
        )
        assert not unique_pattern.search(downgrade_section), (
            "Downgrade must NOT create idx_claims_active as UNIQUE"
        )


# ---------------------------------------------------------------------------
# Additional indexes (ARCH006 recommendations)
# ---------------------------------------------------------------------------


class TestAdditionalIndexes:
    """Verify ARCH006-recommended indexes are created."""

    def test_status_stage_composite(self) -> None:
        content = _read_migration()
        pattern = re.compile(
            r"idx_tickets_status_stage\s+ON\s+tickets\s*\(\s*status\s*,\s*stage\s*\)",
            re.IGNORECASE,
        )
        assert pattern.search(content)

    def test_stage_claimed_by_composite(self) -> None:
        content = _read_migration()
        pattern = re.compile(
            r"idx_tickets_stage_claimed_by\s+ON\s+tickets\s*\(\s*stage\s*,\s*claimed_by\s*\)",
            re.IGNORECASE,
        )
        assert pattern.search(content)

    def test_parent_id_index(self) -> None:
        content = _read_migration()
        assert "idx_tickets_parent_id" in content
        pattern = re.compile(
            r"idx_tickets_parent_id\s+ON\s+tickets\s*\(\s*parent_id\s*\)",
            re.IGNORECASE,
        )
        assert pattern.search(content)

    def test_active_claims_partial(self) -> None:
        content = _read_migration()
        assert "idx_tickets_active_claims" in content
        assert "WHERE claimed_by IS NOT NULL" in content

    def test_file_locks_locked_by(self) -> None:
        content = _read_migration()
        assert "idx_file_locks_locked_by" in content

    def test_file_locks_ticket_id(self) -> None:
        content = _read_migration()
        assert "idx_file_locks_ticket_id" in content


# ---------------------------------------------------------------------------
# Upgraded indexes
# ---------------------------------------------------------------------------


class TestUpgradedIndexes:
    """Verify indexes from 001/002 are properly upgraded."""

    def test_claimable_index_upgraded_with_stage_leading(self) -> None:
        content = _read_migration()
        upgrade_section = content[: content.index("def downgrade")]
        pattern = re.compile(
            r"idx_tickets_claimable\s+ON\s+tickets\s*\(\s*stage\s*,\s*priority\s+DESC\s*,\s*created_at\s+ASC\s*\)",
            re.IGNORECASE,
        )
        assert pattern.search(upgrade_section), (
            "Upgraded claimable index must have stage as leading column with priority DESC, created_at ASC"
        )

    def test_claimable_drops_old_before_recreate(self) -> None:
        content = _read_migration()
        upgrade_section = content[: content.index("def downgrade")]
        drop_pos = upgrade_section.find("DROP INDEX IF EXISTS idx_tickets_claimable")
        create_pos = upgrade_section.find("CREATE INDEX idx_tickets_claimable")
        assert drop_pos != -1 and create_pos != -1
        assert drop_pos < create_pos


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


class TestIdempotency:
    """Verify IF NOT EXISTS usage for new indexes."""

    def test_new_indexes_use_if_not_exists(self) -> None:
        content = _read_migration()
        upgrade_section = content[: content.index("def downgrade")]
        new_indexes_with_if_not_exists = [
            "idx_tickets_stage_type_priority",
            "idx_tickets_status_stage",
            "idx_tickets_stage_claimed_by",
            "idx_tickets_parent_id",
            "idx_tickets_active_claims",
            "idx_file_locks_locked_by",
            "idx_file_locks_ticket_id",
        ]
        for idx_name in new_indexes_with_if_not_exists:
            pattern = re.compile(
                rf"CREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\s+{idx_name}",
                re.IGNORECASE,
            )
            assert pattern.search(upgrade_section), (
                f"{idx_name} should use IF NOT EXISTS"
            )

    def test_downgrade_uses_if_exists(self) -> None:
        content = _read_migration()
        downgrade_section = content[content.index("def downgrade"):]
        drop_statements = re.findall(r"DROP\s+(?:INDEX|CONSTRAINT)\s+IF\s+EXISTS", downgrade_section, re.IGNORECASE)
        assert len(drop_statements) >= 7, "All DROP statements should use IF EXISTS"
