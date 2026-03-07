"""Initial ForgeOS schema — enum types, base tables, triggers, indexes.

Revision ID: 001
Revises: None
Create Date: 2026-03-07

Creates the foundational schema from docs/architecture/database-schema.md:
- 5 enum types: ticket_status, ticket_stage, ticket_type, ticket_priority, event_type
- 7 tables: projects, agents, sessions, tickets, file_locks, events, system_config
- Auto-update triggers for updated_at columns
- Indexes for primary query paths
- Partial unique index for file lock mutex
"""

from __future__ import annotations

from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Create the ForgeOS base schema."""
    # ------------------------------------------------------------------
    # Extensions
    # ------------------------------------------------------------------
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp";')

    # ------------------------------------------------------------------
    # Enum types
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TYPE ticket_status AS ENUM (
            'READY', 'BLOCKED', 'CLAIMED', 'IN_PROGRESS',
            'DONE', 'FAILED', 'ESCALATED'
        );
    """)

    op.execute("""
        CREATE TYPE ticket_stage AS ENUM (
            'READY', 'RESEARCH', 'ARCHITECT', 'PRODUCT_MANAGER',
            'UI_DESIGN', 'BACKEND', 'FRONTEND', 'QA', 'SECURITY',
            'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'
        );
    """)

    op.execute("""
        CREATE TYPE ticket_type AS ENUM (
            'backend', 'frontend', 'fullstack', 'infra', 'security',
            'docs', 'research', 'architecture', 'product', 'design'
        );
    """)

    op.execute("""
        CREATE TYPE ticket_priority AS ENUM (
            'critical', 'high', 'medium', 'low'
        );
    """)

    op.execute("""
        CREATE TYPE event_type AS ENUM (
            'CREATED', 'CLAIMED', 'RELEASED', 'STAGE_ADVANCED',
            'STAGE_REJECTED', 'UPDATED', 'SPAWNED', 'ESCALATED',
            'LEASE_EXTENDED', 'FORCE_RELEASED', 'RECONCILED',
            'FILE_LOCKED', 'FILE_UNLOCKED'
        );
    """)

    # ------------------------------------------------------------------
    # Shared trigger function for updated_at
    # ------------------------------------------------------------------
    op.execute("""
        CREATE OR REPLACE FUNCTION update_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # ------------------------------------------------------------------
    # Table: projects
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE projects (
            id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name                  TEXT NOT NULL UNIQUE,
            description           TEXT,
            repo_url              TEXT,
            default_lease_minutes INTEGER NOT NULL DEFAULT 30,
            max_lease_minutes     INTEGER NOT NULL DEFAULT 120,
            created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    op.execute("""
        CREATE TRIGGER trg_projects_updated_at
            BEFORE UPDATE ON projects
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    """)

    # ------------------------------------------------------------------
    # Table: agents
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE agents (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            name            TEXT NOT NULL,
            role            TEXT NOT NULL,
            api_key_hash    TEXT UNIQUE,
            permissions     JSONB NOT NULL DEFAULT '[]'::JSONB,
            machine_id      TEXT,
            is_active       BOOLEAN NOT NULL DEFAULT TRUE,
            revoked_at      TIMESTAMPTZ,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            CONSTRAINT agent_name_role_unique UNIQUE (name, role)
        );
    """)

    op.execute("""
        CREATE TRIGGER trg_agents_updated_at
            BEFORE UPDATE ON agents
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    """)

    # ------------------------------------------------------------------
    # Table: sessions
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE sessions (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
            session_token   TEXT NOT NULL UNIQUE,
            machine_id      TEXT NOT NULL,
            operator        TEXT,
            ip_address      INET,
            last_seen       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at      TIMESTAMPTZ NOT NULL,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # ------------------------------------------------------------------
    # Table: tickets
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE tickets (
            -- Identity
            id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ticket_id              TEXT NOT NULL UNIQUE,
            project_id             UUID REFERENCES projects(id) ON DELETE SET NULL,
            title                  TEXT NOT NULL,
            description            TEXT,

            -- Classification
            type                   ticket_type NOT NULL,
            priority               ticket_priority NOT NULL DEFAULT 'medium',

            -- State machine
            status                 ticket_status NOT NULL DEFAULT 'BLOCKED',
            stage                  ticket_stage NOT NULL DEFAULT 'READY',
            sdlc_flow              ticket_stage[] NOT NULL,

            -- Distributed claim (lease-based locking)
            claimed_by             UUID REFERENCES agents(id) ON DELETE SET NULL,
            claimed_by_name        TEXT,
            machine_id             TEXT,
            operator               TEXT,
            lease_expiry           TIMESTAMPTZ,
            lease_duration_minutes INTEGER NOT NULL DEFAULT 30,

            -- Dependency & scope
            depends_on             TEXT[] NOT NULL DEFAULT '{}',
            file_paths             TEXT[] NOT NULL DEFAULT '{}',
            acceptance_criteria    TEXT[] NOT NULL DEFAULT '{}',
            tags                   TEXT[] NOT NULL DEFAULT '{}',

            -- Rework tracking
            rework_count           INTEGER NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
            max_reworks            INTEGER NOT NULL DEFAULT 3,

            -- Extensible metadata
            metadata               JSONB NOT NULL DEFAULT '{}'::JSONB,

            -- Hierarchy
            parent_id              TEXT,
            source_task_file       TEXT,

            -- Timestamps
            created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            completed_at           TIMESTAMPTZ,

            -- Constraints
            CONSTRAINT valid_lease CHECK (
                (claimed_by IS NULL AND lease_expiry IS NULL) OR
                (claimed_by IS NOT NULL AND lease_expiry IS NOT NULL)
            ),
            CONSTRAINT valid_rework CHECK (rework_count <= max_reworks + 1)
        );
    """)

    op.execute("""
        CREATE TRIGGER trg_tickets_updated_at
            BEFORE UPDATE ON tickets
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at();
    """)

    # ------------------------------------------------------------------
    # Table: file_locks
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE file_locks (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            file_path       TEXT NOT NULL,
            ticket_id       TEXT NOT NULL,
            locked_by       UUID REFERENCES agents(id) ON DELETE SET NULL,
            machine_id      TEXT,
            locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            released_at     TIMESTAMPTZ
        );
    """)

    # Partial unique index — at most one active lock per file
    op.execute("""
        CREATE UNIQUE INDEX idx_file_locks_active
            ON file_locks(file_path)
            WHERE released_at IS NULL;
    """)

    # ------------------------------------------------------------------
    # Table: events
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE events (
            id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            ticket_id       TEXT NOT NULL,
            event_type      event_type NOT NULL,
            agent_id        UUID REFERENCES agents(id) ON DELETE SET NULL,
            agent_name      TEXT,
            machine_id      TEXT,
            operator        TEXT,
            previous_stage  ticket_stage,
            new_stage       ticket_stage,
            previous_status ticket_status,
            new_status      ticket_status,
            payload         JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # ------------------------------------------------------------------
    # Table: system_config
    # ------------------------------------------------------------------
    op.execute("""
        CREATE TABLE system_config (
            key             TEXT PRIMARY KEY,
            value           JSONB NOT NULL,
            description     TEXT,
            updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
    """)

    # ------------------------------------------------------------------
    # Indexes — primary query paths
    # ------------------------------------------------------------------

    # Tickets: lookup by ticket_id (already UNIQUE), stage, status
    op.execute("CREATE INDEX idx_tickets_stage ON tickets(stage);")
    op.execute("CREATE INDEX idx_tickets_status ON tickets(status);")
    op.execute("CREATE INDEX idx_tickets_type ON tickets(type);")
    op.execute("CREATE INDEX idx_tickets_priority ON tickets(priority);")
    op.execute("CREATE INDEX idx_tickets_claimed_by ON tickets(claimed_by);")
    op.execute("CREATE INDEX idx_tickets_project_id ON tickets(project_id);")

    # Partial index: claimable tickets (READY + not claimed)
    op.execute("""
        CREATE INDEX idx_tickets_claimable
            ON tickets(priority, created_at)
            WHERE status = 'READY' AND claimed_by IS NULL;
    """)

    # Partial index: expired leases
    op.execute("""
        CREATE INDEX idx_tickets_expired_leases
            ON tickets(lease_expiry)
            WHERE claimed_by IS NOT NULL AND lease_expiry IS NOT NULL;
    """)

    # GIN indexes for array containment queries
    op.execute("CREATE INDEX idx_tickets_depends_on ON tickets USING GIN(depends_on);")
    op.execute("CREATE INDEX idx_tickets_file_paths ON tickets USING GIN(file_paths);")
    op.execute("CREATE INDEX idx_tickets_tags ON tickets USING GIN(tags);")

    # GIN index for JSONB metadata queries
    op.execute("CREATE INDEX idx_tickets_metadata ON tickets USING GIN(metadata);")

    # Events: timeline and filtering
    op.execute("CREATE INDEX idx_events_ticket_id ON events(ticket_id);")
    op.execute("CREATE INDEX idx_events_event_type ON events(event_type);")
    op.execute("CREATE INDEX idx_events_agent_id ON events(agent_id);")
    op.execute("CREATE INDEX idx_events_created_at ON events(created_at);")
    op.execute("""
        CREATE INDEX idx_events_ticket_timeline
            ON events(ticket_id, created_at);
    """)

    # Sessions: lookup by agent and expiry
    op.execute("CREATE INDEX idx_sessions_agent_id ON sessions(agent_id);")
    op.execute("CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);")

    # ------------------------------------------------------------------
    # Seed data — system_config defaults
    # ------------------------------------------------------------------
    op.execute("""
        INSERT INTO system_config (key, value, description) VALUES
            ('default_lease_minutes', '30', 'Default claim lease duration in minutes'),
            ('max_lease_minutes', '120', 'Maximum lease extension allowed in minutes'),
            ('rate_limit_per_minute', '100', 'API rate limit per agent per minute'),
            ('reconciliation_interval_seconds', '300', 'Periodic reconciliation interval'),
            ('stale_machine_hours', '24', 'Hours before a machine is marked stale');
    """)


def downgrade() -> None:
    """Revert the ForgeOS base schema."""
    # Drop tables in reverse dependency order
    op.execute("DROP TABLE IF EXISTS system_config CASCADE;")
    op.execute("DROP TABLE IF EXISTS events CASCADE;")
    op.execute("DROP TABLE IF EXISTS file_locks CASCADE;")
    op.execute("DROP TABLE IF EXISTS tickets CASCADE;")
    op.execute("DROP TABLE IF EXISTS sessions CASCADE;")
    op.execute("DROP TABLE IF EXISTS agents CASCADE;")
    op.execute("DROP TABLE IF EXISTS projects CASCADE;")

    # Drop shared function
    op.execute("DROP FUNCTION IF EXISTS update_updated_at() CASCADE;")

    # Drop enum types
    op.execute("DROP TYPE IF EXISTS event_type CASCADE;")
    op.execute("DROP TYPE IF EXISTS ticket_priority CASCADE;")
    op.execute("DROP TYPE IF EXISTS ticket_type CASCADE;")
    op.execute("DROP TYPE IF EXISTS ticket_stage CASCADE;")
    op.execute("DROP TYPE IF EXISTS ticket_status CASCADE;")

    # Drop extension (only if we created it)
    op.execute('DROP EXTENSION IF EXISTS "uuid-ossp";')
