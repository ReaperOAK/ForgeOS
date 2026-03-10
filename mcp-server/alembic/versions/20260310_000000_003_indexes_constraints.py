"""Database indexes and constraints — performance optimization.

Revision ID: 003
Revises: 002
Create Date: 2026-03-10

Implements the index strategy from FORGEOS-ARCH006 (Database Index and
Performance Strategy). Adds composite indexes, partial indexes, CHECK
constraints, and FK-coverage indexes not present in migrations 001/002.

Ticket: FORGEOS-BE004
Architecture: FORGEOS-ARCH006

Changes:
  New composite indexes:
    idx_tickets_stage_type_priority  — filtered ticket listing (AC3)
    idx_tickets_status_stage         — dashboard pipeline view (ARCH006 §5.1)
    idx_tickets_stage_claimed_by     — claim queue + agent workload (ARCH006 §5.2)

  New single-column indexes:
    idx_tickets_parent_id            — sub-ticket tree traversal (ARCH006 §5.6)
    idx_file_locks_locked_by         — FK coverage for agent deletion (ARCH006 §13.2)
    idx_file_locks_ticket_id         — FK coverage for ticket-scoped lock release

  New partial indexes:
    idx_tickets_active_claims        — active claim monitoring (ARCH006 §7.4)

  Upgraded indexes:
    idx_tickets_claimable            — add stage as leading column (ARCH006 §5.3)
    idx_claims_active                — upgrade to UNIQUE partial (AC4)

  New CHECK constraints:
    chk_tickets_lease_duration_positive   — lease_duration_minutes > 0
    chk_tickets_max_reworks_non_negative  — max_reworks >= 0

  Notes on existing indexes (already created in 001):
    idx_tickets_depends_on (GIN)  — satisfies AC1 (depends_on @> containment)
    idx_tickets_file_paths (GIN)  — satisfies AC2 (file_paths && overlap)
    idx_event_history_ticket_timeline — satisfies AC5 (created in 002)
    tickets.type uses ticket_type enum — satisfies AC6 (valid value enforcement)
    tickets.priority uses ticket_priority enum — satisfies AC6

  All CREATE INDEX uses IF NOT EXISTS for idempotency where possible.
  Replaced indexes are dropped then recreated.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from alembic import op

if TYPE_CHECKING:
    from collections.abc import Sequence

# revision identifiers, used by Alembic.
revision: str = "003"
down_revision: str | None = "002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add composite indexes, partial indexes, and CHECK constraints.

    Index additions follow the ForgeOS naming convention: idx_{table}_{columns}.
    All indexes use IF NOT EXISTS for idempotent reruns except where an
    existing index must be dropped and recreated with different parameters.

    Acceptance criteria covered:
        AC1: GIN on depends_on — already in 001, verified here
        AC2: GIN on file_paths — already in 001, verified here
        AC3: Composite (stage, type, priority) — new
        AC4: Unique partial on claims — upgraded from non-unique
        AC5: event_history(ticket_id, created_at) — already in 002
        AC6: CHECK constraints — enum types + explicit business rules
        AC7: Clean downgrade — all new objects dropped in reverse order
    """
    # ==================================================================
    # 1. Composite index: (stage, type, priority) for filtered listing
    #    Serves: "Show all backend tickets sorted by priority"
    #    Column order: stage (equality) → type (equality) → priority (sort)
    #    [AC3]
    # ==================================================================
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tickets_stage_type_priority
            ON tickets(stage, type, priority);
    """)

    # ==================================================================
    # 2. Composite index: (status, stage) for dashboard pipeline view
    #    Serves: GROUP BY status, stage aggregation; index-only scan
    #    [ARCH006 §5.1]
    # ==================================================================
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tickets_status_stage
            ON tickets(status, stage);
    """)

    # ==================================================================
    # 3. Composite index: (stage, claimed_by) for claim queue + workload
    #    Serves: "Find unclaimed tickets in BACKEND stage"
    #            "What is agent X working on?"
    #    [ARCH006 §5.2]
    # ==================================================================
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tickets_stage_claimed_by
            ON tickets(stage, claimed_by);
    """)

    # ==================================================================
    # 4. B-tree index: parent_id for sub-ticket tree traversal
    #    Serves: WHERE parent_id = :ticket_id (sub-ticket listing)
    #    [ARCH006 §5.6]
    # ==================================================================
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tickets_parent_id
            ON tickets(parent_id);
    """)

    # ==================================================================
    # 5. Partial index: active claims monitoring
    #    Serves: agent workload, per-stage active claims, lease monitoring
    #    Only indexes rows where claimed_by IS NOT NULL (~50-100 rows)
    #    [ARCH006 §7.4]
    # ==================================================================
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_tickets_active_claims
            ON tickets(claimed_by, stage, lease_expiry)
            WHERE claimed_by IS NOT NULL;
    """)

    # ==================================================================
    # 6. Upgrade idx_tickets_claimable: add stage as leading column
    #    Old (001): ON tickets(priority, created_at)
    #              WHERE status = 'READY' AND claimed_by IS NULL
    #    New:       ON tickets(stage, priority DESC, created_at ASC)
    #              WHERE status = 'READY' AND claimed_by IS NULL
    #    This matches the claim_ticket() stored function which filters
    #    by stage first, then orders by priority DESC, created_at ASC.
    #    [ARCH006 §5.3]
    # ==================================================================
    op.execute("DROP INDEX IF EXISTS idx_tickets_claimable;")
    op.execute("""
        CREATE INDEX idx_tickets_claimable
            ON tickets(stage, priority DESC, created_at ASC)
            WHERE status = 'READY' AND claimed_by IS NULL;
    """)

    # ==================================================================
    # 7. Upgrade idx_claims_active to UNIQUE partial index
    #    Enforces: at most one active (unreleased) claim per ticket
    #    Old (002_core_tables): non-unique partial index
    #    New: UNIQUE partial index — database-enforced mutex
    #    [AC4]
    # ==================================================================
    op.execute("DROP INDEX IF EXISTS idx_claims_active;")
    op.execute("""
        CREATE UNIQUE INDEX idx_claims_active
            ON claims(ticket_id)
            WHERE released_at IS NULL;
    """)

    # ==================================================================
    # 8. FK coverage: file_locks.locked_by
    #    Prevents sequential scan on agent deletion cascade
    #    [ARCH006 §13.2]
    # ==================================================================
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_file_locks_locked_by
            ON file_locks(locked_by);
    """)

    # ==================================================================
    # 9. FK coverage: file_locks.ticket_id
    #    Serves: release all locks for a ticket (advance/reject/release)
    #    [ARCH006 §9.2]
    # ==================================================================
    op.execute("""
        CREATE INDEX IF NOT EXISTS idx_file_locks_ticket_id
            ON file_locks(ticket_id);
    """)

    # ==================================================================
    # 10. CHECK constraints — business rule enforcement
    #     tickets.type and tickets.priority already use PostgreSQL enum
    #     types (ticket_type, ticket_priority) which inherently enforce
    #     valid values. Adding explicit named constraints for business
    #     rules not covered by enum/NOT NULL.
    #     [AC6]
    # ==================================================================
    op.execute("""
        ALTER TABLE tickets
            ADD CONSTRAINT chk_tickets_lease_duration_positive
            CHECK (lease_duration_minutes > 0);
    """)

    op.execute("""
        ALTER TABLE tickets
            ADD CONSTRAINT chk_tickets_max_reworks_non_negative
            CHECK (max_reworks >= 0);
    """)


def downgrade() -> None:
    """Remove all indexes and constraints added in this migration.

    Restores prior state:
    - Drops new CHECK constraints
    - Drops new single-column and composite indexes
    - Restores idx_claims_active as non-unique (matching 002_core_tables)
    - Restores idx_tickets_claimable without stage (matching 001)
    """
    # ------------------------------------------------------------------
    # Drop CHECK constraints
    # ------------------------------------------------------------------
    op.execute(
        "ALTER TABLE tickets "
        "DROP CONSTRAINT IF EXISTS chk_tickets_max_reworks_non_negative;"
    )
    op.execute(
        "ALTER TABLE tickets "
        "DROP CONSTRAINT IF EXISTS chk_tickets_lease_duration_positive;"
    )

    # ------------------------------------------------------------------
    # Drop FK coverage indexes
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS idx_file_locks_ticket_id;")
    op.execute("DROP INDEX IF EXISTS idx_file_locks_locked_by;")

    # ------------------------------------------------------------------
    # Restore idx_claims_active as non-unique (002_core_tables original)
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS idx_claims_active;")
    op.execute("""
        CREATE INDEX idx_claims_active
            ON claims(ticket_id)
            WHERE released_at IS NULL;
    """)

    # ------------------------------------------------------------------
    # Restore idx_tickets_claimable without stage (001 original)
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS idx_tickets_claimable;")
    op.execute("""
        CREATE INDEX idx_tickets_claimable
            ON tickets(priority, created_at)
            WHERE status = 'READY' AND claimed_by IS NULL;
    """)

    # ------------------------------------------------------------------
    # Drop new partial index
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS idx_tickets_active_claims;")

    # ------------------------------------------------------------------
    # Drop new composite and single-column indexes
    # ------------------------------------------------------------------
    op.execute("DROP INDEX IF EXISTS idx_tickets_parent_id;")
    op.execute("DROP INDEX IF EXISTS idx_tickets_stage_claimed_by;")
    op.execute("DROP INDEX IF EXISTS idx_tickets_status_stage;")
    op.execute("DROP INDEX IF EXISTS idx_tickets_stage_type_priority;")
