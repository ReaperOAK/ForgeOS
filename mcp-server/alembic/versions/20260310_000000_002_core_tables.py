"""Core tables extension — machines, operators, claims, tickets.created_by.

Revision ID: 002
Revises: 001
Create Date: 2026-03-10

Adds the core entity tables specified by FORGEOS-BE002:
- machines: machine identity registry with hostname tracking
- operators: human operator registry
- claims: lease-based distributed locking linking tickets to agents/machines
- ALTER tickets: add created_by column (missing from 001 initial schema)

Design rationale:
- machines + operators as first-class entities enable proper FK relationships
  for claim tracking, replacing the TEXT fields in the tickets table.
- claims table provides a full audit trail of claim lifecycle (claimed_at,
  released_at) separate from the inline claim fields on tickets.
- UUIDs, TIMESTAMPTZ, TEXT follow patterns established in 001_initial_schema.
- ON DELETE behaviors:
  - CASCADE on claims.ticket_id: deleting a ticket removes its claims
  - SET NULL on claims.agent_id: agent removal preserves claim history
  - SET NULL on claims.machine_id: machine removal preserves claim history
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create machines, operators, claims tables; add tickets.created_by."""
    # ------------------------------------------------------------------
    # Table: machines — machine identity registry
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE machines (
            machine_id      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            hostname        TEXT NOT NULL UNIQUE,
            registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    op.execute("""
        CREATE TRIGGER trg_machines_last_seen
            BEFORE UPDATE ON machines
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    """)

    # Index on hostname for lookups (already UNIQUE, but explicit for clarity)
    op.execute("CREATE INDEX idx_machines_hostname ON machines(hostname);")

    # ------------------------------------------------------------------
    # Table: operators — human operator registry
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE operators (
            operator_id     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name            TEXT NOT NULL UNIQUE,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    op.execute("CREATE INDEX idx_operators_name ON operators(name);")

    # ------------------------------------------------------------------
    # Table: claims — lease-based distributed locking
    #
    # Links a ticket to the agent that claimed it, the machine it runs
    # on, the operator who initiated the run, and the lease expiry.
    # released_at is NULL while a claim is active.
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE claims (
            claim_id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ticket_id       UUID NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
            agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
            machine_id      UUID REFERENCES machines(machine_id) ON DELETE SET NULL,
            operator        TEXT,
            lease_expiry    TIMESTAMPTZ NOT NULL,
            claimed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            released_at     TIMESTAMPTZ
        );
    """)

    # Indexes for common query paths
    op.execute("CREATE INDEX idx_claims_ticket_id ON claims(ticket_id);")
    op.execute("CREATE INDEX idx_claims_agent_id ON claims(agent_id);")
    op.execute("CREATE INDEX idx_claims_machine_id ON claims(machine_id);")

    # Partial index: active (unreleased) claims
    op.execute("""
        CREATE INDEX idx_claims_active
            ON claims(ticket_id)
            WHERE released_at IS NULL;
    """)

    # Partial index: expired leases for cleanup
    op.execute("""
        CREATE INDEX idx_claims_expired_leases
            ON claims(lease_expiry)
            WHERE released_at IS NULL AND lease_expiry < NOW();
    """)

    # ------------------------------------------------------------------
    # ALTER tickets: add created_by column
    #
    # The original 001 migration omitted created_by. This column tracks
    # which agent or system created the ticket (e.g., "TODO", "Backend").
    # ------------------------------------------------------------------
    op.execute("""
        ALTER TABLE tickets ADD COLUMN created_by TEXT;
    """)


def downgrade() -> None:
    """Revert: drop claims, operators, machines; remove tickets.created_by."""
    # Remove created_by column from tickets
    op.execute("ALTER TABLE tickets DROP COLUMN IF EXISTS created_by;")

    # Drop tables in reverse dependency order
    op.execute("DROP TABLE IF EXISTS claims CASCADE;")
    op.execute("DROP TABLE IF EXISTS operators CASCADE;")
    op.execute("DROP TABLE IF EXISTS machines CASCADE;")
