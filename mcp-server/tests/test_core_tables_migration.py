"""Tests for FORGEOS-BE002 — Core Tables Migration (002).

Verifies that the 002_core_tables migration creates the required tables
(machines, operators, claims) and adds the created_by column to tickets.

TDD Evidence
------------
- RED: Tests written FIRST to define expected migration structure and content.
- GREEN: Migration file created to satisfy these tests.
- REFACTOR: SQL cleaned up, comments added, naming standardized.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

# Root of the mcp-server package
MCP_SERVER_ROOT = Path(__file__).resolve().parent.parent
VERSIONS_DIR = MCP_SERVER_ROOT / "alembic" / "versions"


def _find_migration_file() -> Path:
    """Find the 002 core tables migration file."""
    candidates = sorted(VERSIONS_DIR.glob("*002*core_tables*"))
    assert len(candidates) == 1, (
        f"Expected exactly one 002_core_tables migration, found {len(candidates)}: {candidates}"
    )
    return candidates[0]


def _read_migration() -> str:
    """Read the migration file content."""
    return _find_migration_file().read_text()


def _parse_module() -> ast.Module:
    """Parse the migration file as Python AST."""
    content = _read_migration()
    return ast.parse(content)


# ---------------------------------------------------------------------------
# Migration file structure
# ---------------------------------------------------------------------------


class TestMigrationFileStructure:
    """Verify migration file exists and has correct Alembic structure."""

    def test_migration_file_exists(self) -> None:
        """002 core tables migration file exists in versions directory."""
        path = _find_migration_file()
        assert path.exists(), f"Migration file not found: {path}"

    def test_has_revision_identifier(self) -> None:
        """Migration sets a revision identifier."""
        content = _read_migration()
        assert "revision" in content
        # Should reference "002" (handles type annotation: `revision: str = "002"`)
        assert re.search(r'revision.*=\s*["\'\']002', content), (
            "revision should be '002'"
        )

    def test_has_down_revision(self) -> None:
        """Migration references the previous revision (001)."""
        content = _read_migration()
        assert re.search(r'down_revision.*=\s*["\'\']001', content), (
            "down_revision should reference '001'"
        )

    def test_has_upgrade_function(self) -> None:
        """Migration defines an upgrade() function."""
        tree = _parse_module()
        func_names = [
            node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
        ]
        assert "upgrade" in func_names

    def test_has_downgrade_function(self) -> None:
        """Migration defines a downgrade() function."""
        tree = _parse_module()
        func_names = [
            node.name for node in ast.walk(tree) if isinstance(node, ast.FunctionDef)
        ]
        assert "downgrade" in func_names


# ---------------------------------------------------------------------------
# Machines table
# ---------------------------------------------------------------------------


class TestMachinesTable:
    """Verify the machines table is created with required columns."""

    def test_create_machines_table(self) -> None:
        """Migration creates the machines table."""
        content = _read_migration()
        assert "CREATE TABLE machines" in content

    def test_machines_has_machine_id_pk(self) -> None:
        """machines table has machine_id as UUID primary key."""
        content = _read_migration()
        # Look for machine_id PRIMARY KEY in the machines CREATE TABLE block
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None, "machines CREATE TABLE block not found"
        assert "PRIMARY KEY" in machines_block
        assert "machine_id" in machines_block or "id" in machines_block

    def test_machines_has_hostname(self) -> None:
        """machines table has hostname column."""
        content = _read_migration()
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None
        assert "hostname" in machines_block

    def test_machines_has_registered_at(self) -> None:
        """machines table has registered_at timestamp column."""
        content = _read_migration()
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None
        assert "registered_at" in machines_block

    def test_machines_has_last_seen(self) -> None:
        """machines table has last_seen timestamp column."""
        content = _read_migration()
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None
        assert "last_seen" in machines_block

    def test_machines_hostname_not_null(self) -> None:
        """hostname column should be NOT NULL."""
        content = _read_migration()
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None
        # Find the hostname line and check for NOT NULL
        hostname_line = _find_column_line(machines_block, "hostname")
        assert hostname_line is not None, "hostname column not found"
        assert "NOT NULL" in hostname_line


# ---------------------------------------------------------------------------
# Operators table
# ---------------------------------------------------------------------------


class TestOperatorsTable:
    """Verify the operators table is created with required columns."""

    def test_create_operators_table(self) -> None:
        """Migration creates the operators table."""
        content = _read_migration()
        assert "CREATE TABLE operators" in content

    def test_operators_has_pk(self) -> None:
        """operators table has a primary key."""
        content = _read_migration()
        operators_block = _extract_table_block(content, "operators")
        assert operators_block is not None, "operators CREATE TABLE block not found"
        assert "PRIMARY KEY" in operators_block

    def test_operators_has_name(self) -> None:
        """operators table has name column."""
        content = _read_migration()
        operators_block = _extract_table_block(content, "operators")
        assert operators_block is not None
        assert "name" in operators_block

    def test_operators_has_created_at(self) -> None:
        """operators table has created_at timestamp column."""
        content = _read_migration()
        operators_block = _extract_table_block(content, "operators")
        assert operators_block is not None
        assert "created_at" in operators_block

    def test_operators_name_not_null(self) -> None:
        """name column should be NOT NULL."""
        content = _read_migration()
        operators_block = _extract_table_block(content, "operators")
        assert operators_block is not None
        name_line = _find_column_line(operators_block, "name")
        assert name_line is not None, "name column not found"
        assert "NOT NULL" in name_line


# ---------------------------------------------------------------------------
# Claims table
# ---------------------------------------------------------------------------


class TestClaimsTable:
    """Verify the claims table is created with required columns and FKs."""

    def test_create_claims_table(self) -> None:
        """Migration creates the claims table."""
        content = _read_migration()
        assert "CREATE TABLE claims" in content

    def test_claims_has_pk(self) -> None:
        """claims table has a primary key."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None, "claims CREATE TABLE block not found"
        assert "PRIMARY KEY" in claims_block

    def test_claims_has_ticket_id_fk(self) -> None:
        """claims table has ticket_id with FK to tickets."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "ticket_id" in claims_block
        assert "REFERENCES" in claims_block

    def test_claims_has_agent_id_fk(self) -> None:
        """claims table has agent_id with FK to agents."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "agent_id" in claims_block

    def test_claims_has_machine_id_fk(self) -> None:
        """claims table has machine_id with FK to machines."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "machine_id" in claims_block

    def test_claims_has_operator(self) -> None:
        """claims table has operator column."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "operator" in claims_block

    def test_claims_has_lease_expiry(self) -> None:
        """claims table has lease_expiry column."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "lease_expiry" in claims_block

    def test_claims_has_claimed_at(self) -> None:
        """claims table has claimed_at timestamp."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "claimed_at" in claims_block

    def test_claims_has_released_at(self) -> None:
        """claims table has released_at timestamp (nullable for active claims)."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "released_at" in claims_block

    def test_claims_ticket_fk_references_tickets(self) -> None:
        """claims.ticket_id FK references the tickets table."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        # Should reference tickets table
        assert re.search(r"REFERENCES\s+tickets", claims_block)

    def test_claims_agent_fk_references_agents(self) -> None:
        """claims.agent_id FK references the agents table."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert re.search(r"REFERENCES\s+agents", claims_block)

    def test_claims_machine_fk_references_machines(self) -> None:
        """claims.machine_id FK references the machines table."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert re.search(r"REFERENCES\s+machines", claims_block)


# ---------------------------------------------------------------------------
# Tickets table — created_by column addition
# ---------------------------------------------------------------------------


class TestTicketsCreatedByColumn:
    """Verify the tickets table gets a created_by column."""

    def test_adds_created_by_to_tickets(self) -> None:
        """Migration adds created_by column to tickets table."""
        content = _read_migration()
        assert "created_by" in content
        assert re.search(r"ALTER\s+TABLE\s+tickets\s+ADD", content, re.IGNORECASE)


# ---------------------------------------------------------------------------
# Foreign key ON DELETE behavior
# ---------------------------------------------------------------------------


class TestForeignKeyBehavior:
    """Verify appropriate ON DELETE behavior on foreign keys."""

    def test_claims_has_on_delete_behavior(self) -> None:
        """claims table foreign keys specify ON DELETE behavior."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "ON DELETE" in claims_block


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------


class TestDowngrade:
    """Verify downgrade drops all created tables and reverts changes."""

    def test_downgrade_drops_claims(self) -> None:
        """Downgrade drops the claims table."""
        content = _read_migration()
        assert re.search(r"DROP\s+TABLE.*claims", content, re.IGNORECASE)

    def test_downgrade_drops_machines(self) -> None:
        """Downgrade drops the machines table."""
        content = _read_migration()
        assert re.search(r"DROP\s+TABLE.*machines", content, re.IGNORECASE)

    def test_downgrade_drops_operators(self) -> None:
        """Downgrade drops the operators table."""
        content = _read_migration()
        assert re.search(r"DROP\s+TABLE.*operators", content, re.IGNORECASE)

    def test_downgrade_removes_created_by(self) -> None:
        """Downgrade removes the created_by column from tickets."""
        content = _read_migration()
        assert re.search(r"ALTER\s+TABLE\s+tickets\s+DROP.*created_by", content, re.IGNORECASE)


# ---------------------------------------------------------------------------
# Indexes
# ---------------------------------------------------------------------------


class TestIndexes:
    """Verify appropriate indexes are created."""

    def test_claims_ticket_id_index(self) -> None:
        """Claims table has an index on ticket_id for FK lookups."""
        content = _read_migration()
        assert re.search(r"CREATE\s+INDEX.*claims.*ticket_id", content, re.IGNORECASE)

    def test_machines_hostname_index_or_unique(self) -> None:
        """Machines table has an index or unique constraint on hostname."""
        content = _read_migration()
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None
        has_unique_in_table = "UNIQUE" in machines_block
        has_index = bool(re.search(r"CREATE.*INDEX.*machines.*hostname", content, re.IGNORECASE))
        assert has_unique_in_table or has_index, (
            "machines.hostname should have a UNIQUE constraint or index"
        )


# ---------------------------------------------------------------------------
# UUID usage
# ---------------------------------------------------------------------------


class TestUUIDUsage:
    """Verify UUID primary keys following established patterns."""

    def test_machines_uses_uuid_pk(self) -> None:
        """machines table uses UUID for primary key."""
        content = _read_migration()
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None
        assert "UUID" in machines_block.upper()

    def test_operators_uses_uuid_pk(self) -> None:
        """operators table uses UUID for primary key."""
        content = _read_migration()
        operators_block = _extract_table_block(content, "operators")
        assert operators_block is not None
        assert "UUID" in operators_block.upper()

    def test_claims_uses_uuid_pk(self) -> None:
        """claims table uses UUID for primary key."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "UUID" in claims_block.upper()


# ---------------------------------------------------------------------------
# TIMESTAMPTZ usage
# ---------------------------------------------------------------------------


class TestTimestamptzUsage:
    """Verify TIMESTAMPTZ is used for all timestamp columns (not TIMESTAMP)."""

    def test_machines_uses_timestamptz(self) -> None:
        """machines timestamp columns use TIMESTAMPTZ."""
        content = _read_migration()
        machines_block = _extract_table_block(content, "machines")
        assert machines_block is not None
        assert "TIMESTAMPTZ" in machines_block

    def test_claims_uses_timestamptz(self) -> None:
        """claims timestamp columns use TIMESTAMPTZ."""
        content = _read_migration()
        claims_block = _extract_table_block(content, "claims")
        assert claims_block is not None
        assert "TIMESTAMPTZ" in claims_block


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _extract_table_block(sql: str, table_name: str) -> str | None:
    """Extract the CREATE TABLE block for a given table name.

    Returns the full text between CREATE TABLE and the matching closing
    parenthesis + semicolon, or None if not found.
    """
    pattern = rf"CREATE\s+TABLE\s+{table_name}\s*\("
    match = re.search(pattern, sql, re.IGNORECASE)
    if not match:
        return None

    start = match.start()
    # Find the matching closing paren by counting nesting
    depth = 0
    pos = match.end() - 1  # Start at the opening paren
    while pos < len(sql):
        if sql[pos] == "(":
            depth += 1
        elif sql[pos] == ")":
            depth -= 1
            if depth == 0:
                # Find the semicolon after
                end = sql.find(";", pos)
                if end == -1:
                    end = pos + 1
                else:
                    end += 1
                return sql[start:end]
        pos += 1
    return sql[start:]


def _find_column_line(table_block: str, column_name: str) -> str | None:
    """Find the line defining a specific column within a table block."""
    for line in table_block.split("\n"):
        # Match column name at the start of a trimmed line (ignoring leading whitespace)
        stripped = line.strip()
        if stripped.lower().startswith(column_name.lower()):
            return line
    return None
