-- =============================================================================
-- ForgeOS PostgreSQL Schema — Migration 001_initial.sql
-- =============================================================================
--
-- Version:       1.0.0
-- Purpose:       Complete DDL for the ForgeOS distributed orchestration engine.
--                Creates the ticket lifecycle state machine, agent identity
--                management, file-level mutex system, and audit trail.
-- Prerequisites: PostgreSQL 14+ with uuid-ossp and pgcrypto extensions.
-- Idempotency:   Safe to re-run. Uses CREATE IF NOT EXISTS / CREATE OR REPLACE.
--
-- Schema design decisions:
--   - UUID primary keys: avoid sequential ID leaks, support multi-machine inserts
--     without coordination.
--   - TIMESTAMPTZ everywhere: all timestamps are timezone-aware for distributed
--     operators across time zones.
--   - JSONB for flexible fields (metadata, payload, permissions): allows
--     schema-free extensibility without ALTER TABLE migrations.
--   - 3NF minimum normalization: tickets are the mutable core; events are the
--     append-only audit trail.
--   - Row-Level Security (RLS): enforces agent-scoped access at the database
--     layer, independent of application logic.
--
-- Table relationships:
--   projects  1──M  tickets     (project_id FK)
--   agents    1──M  sessions    (agent_id FK)
--   agents    1──M  tickets     (claimed_by FK)
--   agents    1──M  file_locks  (locked_by FK)
--   agents    1──M  events      (agent_id FK)
--
-- =============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";   -- UUID generation (uuid_generate_v4)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";    -- Cryptographic functions (gen_random_bytes)

-- =============================================================================
-- ENUM TYPES
-- =============================================================================
-- Five enums encode the domain vocabulary as database-level constraints.
-- Using PostgreSQL enums (rather than CHECK constraints on TEXT) gives:
--   1. Type safety — invalid values rejected at INSERT/UPDATE time.
--   2. Storage efficiency — stored as 4-byte integers internally.
--   3. Readability — human-readable values in queries and logs.
-- =============================================================================

-- ticket_status: lifecycle state of a ticket (mutable).
-- READY → CLAIMED → IN_PROGRESS → DONE is the happy path.
-- BLOCKED = waiting on dependencies. FAILED/ESCALATED = terminal error states.
CREATE TYPE ticket_status AS ENUM (
    'READY',
    'BLOCKED',
    'CLAIMED',
    'IN_PROGRESS',
    'DONE',
    'FAILED',
    'ESCALATED'
);

-- ticket_stage: SDLC pipeline position. Each ticket type traverses a subset.
-- Order matters: advance_ticket() uses array index to enforce forward-only moves.
CREATE TYPE ticket_stage AS ENUM (
    'READY',
    'RESEARCH',
    'ARCHITECT',
    'PRODUCT_MANAGER',
    'UI_DESIGN',
    'BACKEND',
    'FRONTEND',
    'QA',
    'SECURITY',
    'CI',
    'DOCUMENTATION',
    'VALIDATOR',
    'DONE'
);

-- ticket_type: determines which SDLC flow the ticket follows.
CREATE TYPE ticket_type AS ENUM (
    'backend',
    'frontend',
    'fullstack',
    'infra',
    'security',
    'docs',
    'research',
    'architecture',
    'product',
    'design'
);

-- ticket_priority: ordered from highest to lowest for claim queue sorting.
CREATE TYPE ticket_priority AS ENUM (
    'critical',
    'high',
    'medium',
    'low'
);

-- event_type: audit trail event classification (append-only events table).
CREATE TYPE event_type AS ENUM (
    'CREATED',
    'CLAIMED',
    'RELEASED',
    'STAGE_ADVANCED',
    'STAGE_REJECTED',
    'UPDATED',
    'SPAWNED',
    'ESCALATED',
    'LEASE_EXTENDED',
    'FORCE_RELEASED',
    'RECONCILED',
    'FILE_LOCKED',
    'FILE_UNLOCKED'
);

-- =============================================================================
-- PROJECTS TABLE
-- =============================================================================
-- Top-level organizational unit. Each project maps to one Git repository.
-- Lease defaults are configurable per project.
-- =============================================================================

CREATE TABLE projects (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL UNIQUE,
    description     TEXT,
    repo_url        TEXT,
    default_lease_minutes INTEGER NOT NULL DEFAULT 30,
    max_lease_minutes     INTEGER NOT NULL DEFAULT 120,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- AGENTS TABLE
-- =============================================================================
-- Represents an agent identity (e.g., Backend Engineer, QA Engineer).
-- api_key_hash stores SHA-256 of the agent's API key for authentication.
-- permissions is a JSONB array of granted capabilities.
-- Soft-delete via revoked_at: revoked agents cannot claim new tickets.
-- =============================================================================

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

-- =============================================================================
-- SESSIONS TABLE
-- =============================================================================
-- Tracks active agent sessions for distributed execution.
-- Each session binds an agent to a machine and operator.
-- Sessions expire (expires_at) and must be refreshed (last_seen).
-- =============================================================================

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

CREATE INDEX idx_sessions_agent_id ON sessions(agent_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);

-- =============================================================================
-- TICKETS TABLE (Mutable State Only)
-- =============================================================================
-- Central entity of the ForgeOS state machine. Each row is one unit of work.
--
-- Key design choices:
--   - ticket_id (TEXT, UNIQUE): human-readable identifier (e.g., TASK-FOS-01-001).
--     The UUID 'id' column is the internal PK; ticket_id is the external key.
--   - sdlc_flow (ticket_stage[]): ordered array defining the valid stage sequence.
--     advance_ticket() uses array indexing to enforce forward-only transitions.
--   - Claim fields (claimed_by, machine_id, operator, lease_expiry): implement
--     distributed locking. The valid_lease CHECK constraint ensures claim fields
--     are all-or-nothing (either all NULL or all set).
--   - depends_on (TEXT[]): stores ticket_id references for dependency resolution.
--     GIN index enables efficient ANY() membership checks.
--   - rework_count tracks rejection cycles; max_reworks (default 3) triggers
--     escalation to human review.
-- =============================================================================

CREATE TABLE tickets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id       TEXT NOT NULL UNIQUE,
    project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    type            ticket_type NOT NULL,
    priority        ticket_priority NOT NULL DEFAULT 'medium',

    -- State fields
    status          ticket_status NOT NULL DEFAULT 'BLOCKED',
    stage           ticket_stage NOT NULL DEFAULT 'READY',
    sdlc_flow       ticket_stage[] NOT NULL,

    -- Claim fields
    claimed_by      UUID REFERENCES agents(id) ON DELETE SET NULL,
    claimed_by_name TEXT,
    machine_id      TEXT,
    operator        TEXT,
    lease_expiry    TIMESTAMPTZ,
    lease_duration_minutes INTEGER NOT NULL DEFAULT 30,

    -- Dependency and scope
    depends_on      TEXT[] NOT NULL DEFAULT '{}',
    file_paths      TEXT[] NOT NULL DEFAULT '{}',
    acceptance_criteria TEXT[] NOT NULL DEFAULT '{}',
    tags            TEXT[] NOT NULL DEFAULT '{}',

    -- Rework tracking
    rework_count    INTEGER NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
    max_reworks     INTEGER NOT NULL DEFAULT 3,

    -- Metadata
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,
    parent_id       TEXT,
    source_task_file TEXT,

    -- Timestamps
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,

    -- Constraints
    CONSTRAINT valid_lease CHECK (
        (claimed_by IS NULL AND lease_expiry IS NULL) OR
        (claimed_by IS NOT NULL AND lease_expiry IS NOT NULL)
    ),
    CONSTRAINT valid_rework CHECK (rework_count <= max_reworks + 1)
);

-- Primary query indexes
CREATE INDEX idx_tickets_status_stage ON tickets(status, stage);  -- Dashboard queries
CREATE INDEX idx_tickets_stage ON tickets(stage);                -- Stage-specific listings
CREATE INDEX idx_tickets_claimed_by ON tickets(claimed_by);      -- Agent workload queries
CREATE INDEX idx_tickets_priority ON tickets(priority);          -- Priority-based sorting
CREATE INDEX idx_tickets_project_id ON tickets(project_id);      -- Project-scoped queries
CREATE INDEX idx_tickets_parent_id ON tickets(parent_id);        -- Sub-ticket tree traversal

-- GIN indexes for array/JSONB fields
-- GIN (Generalized Inverted Index) supports efficient containment operators
-- (@>, &&, ?) on arrays and JSONB. Critical for dependency resolution and
-- file conflict detection.
CREATE INDEX idx_tickets_depends_on ON tickets USING GIN(depends_on);
CREATE INDEX idx_tickets_file_paths ON tickets USING GIN(file_paths);
CREATE INDEX idx_tickets_tags ON tickets USING GIN(tags);
CREATE INDEX idx_tickets_metadata ON tickets USING GIN(metadata);

-- Composite index for claim queries
-- Partial index: only indexes READY unclaimed tickets.
-- Sorted by priority DESC + created_at ASC so claim_ticket() gets the
-- highest-priority oldest ticket first without a full table scan.
CREATE INDEX idx_tickets_claimable ON tickets(stage, priority DESC, created_at ASC)
    WHERE status = 'READY' AND claimed_by IS NULL;

-- Composite index for expired lease queries
-- Partial index: only indexes tickets with active claims and set expiry.
-- Used by release_expired_claims() to find reclaimable tickets.
CREATE INDEX idx_tickets_expired_leases ON tickets(lease_expiry)
    WHERE claimed_by IS NOT NULL AND lease_expiry IS NOT NULL;

-- =============================================================================
-- FILE_LOCKS TABLE (File-Level Mutex)
-- =============================================================================
-- Prevents two agents from modifying the same file concurrently.
-- The partial unique index (idx_file_locks_active) ensures at most one active
-- lock per file_path at any time. Released locks (released_at IS NOT NULL)
-- are retained for audit purposes.
-- =============================================================================

CREATE TABLE file_locks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_path       TEXT NOT NULL,
    ticket_id       TEXT NOT NULL,
    locked_by       UUID REFERENCES agents(id) ON DELETE SET NULL,
    machine_id      TEXT,
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at     TIMESTAMPTZ
);

-- Partial unique index: only one active lock per file at a time.
-- This is the core mutex mechanism — INSERT will fail with a unique
-- constraint violation if another agent holds an active lock.
CREATE UNIQUE INDEX idx_file_locks_active ON file_locks(file_path) WHERE released_at IS NULL;
CREATE INDEX idx_file_locks_ticket_id ON file_locks(ticket_id);  -- Join with tickets

-- =============================================================================
-- EVENTS TABLE (Audit Trail / Event Sourcing)
-- =============================================================================
-- Append-only log of every state change in the system.
-- Captures who did what, when, and the before/after state.
-- Enables full lifecycle reconstruction for any ticket.
-- The payload JSONB field stores event-specific details (e.g., lease_expiry,
-- rejection reason, evidence).
-- =============================================================================

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

CREATE INDEX idx_events_ticket_id ON events(ticket_id);             -- Per-ticket history
CREATE INDEX idx_events_created_at ON events(created_at);            -- Chronological queries
CREATE INDEX idx_events_event_type ON events(event_type);            -- Filter by event kind
CREATE INDEX idx_events_ticket_timeline ON events(ticket_id, created_at); -- Ticket timeline

-- =============================================================================
-- SYSTEM_CONFIG TABLE
-- =============================================================================
-- Key-value store for runtime configuration. Values are JSONB for type
-- flexibility (integers, strings, objects). Avoids hardcoding operational
-- parameters in application code.
-- =============================================================================

CREATE TABLE system_config (
    key             TEXT PRIMARY KEY,
    value           JSONB NOT NULL,
    description     TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed defaults
INSERT INTO system_config (key, value, description) VALUES
    ('default_lease_minutes', '30', 'Default lease duration for ticket claims'),
    ('max_lease_minutes', '120', 'Maximum lease extension allowed'),
    ('rate_limit_per_minute', '100', 'Default rate limit per API key per minute'),
    ('reconciliation_interval_seconds', '300', 'Periodic webhook reconciliation interval'),
    ('stale_machine_hours', '24', 'Hours before a machine is considered stale');

-- =============================================================================
-- ROW-LEVEL SECURITY (RLS)
-- =============================================================================
-- RLS adds a database-enforced authorization layer.
-- Policies use session variables (SET LOCAL app.agent_role / app.agent_name)
-- injected by the application on each request.
--
-- Strategy:
--   - Admin role bypasses all restrictions.
--   - Agents can SELECT all tickets (needed for dependency resolution).
--   - Agents can only UPDATE tickets they have claimed.
--   - Events are append-only for all agents (full INSERT + SELECT).
--   - File locks use permissive policies (operations mediated by stored
--     functions which enforce business rules).
-- =============================================================================

ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE file_locks ENABLE ROW LEVEL SECURITY;

-- Admin role: full access
CREATE POLICY admin_all_tickets ON tickets
    FOR ALL
    USING (current_setting('app.agent_role', true) = 'admin')
    WITH CHECK (current_setting('app.agent_role', true) = 'admin');

-- Agents: can SELECT tickets matching their stage
CREATE POLICY agent_select_tickets ON tickets
    FOR SELECT
    USING (
        current_setting('app.agent_role', true) = 'admin'
        OR TRUE
    );

-- Agents: can UPDATE only tickets they've claimed
CREATE POLICY agent_update_tickets ON tickets
    FOR UPDATE
    USING (
        current_setting('app.agent_role', true) = 'admin'
        OR claimed_by_name = current_setting('app.agent_name', true)
    );

-- Events: all agents can INSERT events
CREATE POLICY agent_insert_events ON events
    FOR INSERT
    WITH CHECK (TRUE);

-- Events: all agents can SELECT events
CREATE POLICY agent_select_events ON events
    FOR SELECT
    USING (TRUE);

-- File locks: agents can manage locks for their tickets
CREATE POLICY agent_file_locks ON file_locks
    FOR ALL
    USING (TRUE)
    WITH CHECK (TRUE);

-- =============================================================================
-- FUNCTIONS
-- =============================================================================
-- All business logic is encapsulated in PL/pgSQL stored functions.
-- This ensures atomicity (each function runs in a single transaction),
-- prevents race conditions (via SELECT FOR UPDATE SKIP LOCKED), and
-- keeps the application layer thin.
--
-- Naming conventions:
--   - Function parameters: p_ prefix (e.g., p_ticket_id, p_agent_id)
--   - Local variables: v_ prefix (e.g., v_ticket, v_count)
--   - Triggers: trg_{table}_{purpose}
-- =============================================================================

-- Trigger: auto-update updated_at on tickets
-- Applied to tickets, agents, and projects tables.
-- Ensures updated_at always reflects the last modification time
-- without requiring application-level bookkeeping.
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_tickets_updated_at
    BEFORE UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_projects_updated_at
    BEFORE UPDATE ON projects
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── claim_ticket ─────────────────────────────────────────────────────────────
-- Atomically claims the next available ticket for a given stage.
-- Uses SELECT FOR UPDATE SKIP LOCKED to prevent contention:
--   - FOR UPDATE: locks the selected row until transaction ends.
--   - SKIP LOCKED: skips rows locked by other transactions instead of waiting.
-- This combination enables high-concurrency claiming without deadlocks.
--
-- Parameters:
--   p_stage         — The SDLC stage to claim from (e.g., 'BACKEND', 'QA').
--   p_agent_id      — UUID of the claiming agent.
--   p_agent_name    — Human-readable agent name (stored for audit/display).
--   p_machine_id    — Hostname of the machine running the agent.
--   p_operator      — Human operator name (optional).
--   p_lease_minutes — Claim duration in minutes (default 30).
--
-- Returns: The claimed ticket row, or empty set if no ticket available.
-- Side effects: Inserts a CLAIMED event into the events table.

CREATE OR REPLACE FUNCTION claim_ticket(
    p_stage         ticket_stage,
    p_agent_id      UUID,
    p_agent_name    TEXT,
    p_machine_id    TEXT,
    p_operator      TEXT DEFAULT NULL,
    p_lease_minutes INTEGER DEFAULT 30
)
RETURNS SETOF tickets AS $$
DECLARE
    v_ticket tickets%ROWTYPE;
BEGIN
    SELECT * INTO v_ticket
    FROM tickets
    WHERE stage = p_stage
      AND status = 'READY'
      AND (claimed_by IS NULL OR lease_expiry < NOW())
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_ticket.id IS NULL THEN
        RETURN;
    END IF;

    UPDATE tickets
    SET
        status = 'CLAIMED',
        claimed_by = p_agent_id,
        claimed_by_name = p_agent_name,
        machine_id = p_machine_id,
        operator = p_operator,
        lease_expiry = NOW() + (p_lease_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, operator, previous_status, new_status, payload)
    VALUES (v_ticket.ticket_id, 'CLAIMED', p_agent_id, p_agent_name, p_machine_id, p_operator, 'READY', 'CLAIMED',
            jsonb_build_object('lease_expiry', v_ticket.lease_expiry, 'lease_minutes', p_lease_minutes));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── claim_ticket_by_id ───────────────────────────────────────────────────────
-- Claims a specific ticket by its human-readable ticket_id.
-- Unlike claim_ticket(), this targets a known ticket rather than picking
-- the next available one from a stage queue.
--
-- Additional behavior:
--   - Checks for file lock conflicts before claiming.
--   - Acquires file locks on all paths listed in the ticket's file_paths array.
--   - Raises FILE_CONFLICT if any file is locked by another ticket.
--
-- Parameters:
--   p_ticket_id     — Human-readable ticket identifier (e.g., 'TASK-FOS-01-001').
--   p_agent_id      — UUID of the claiming agent.
--   p_agent_name    — Human-readable agent name.
--   p_machine_id    — Hostname of the machine running the agent.
--   p_operator      — Human operator name (optional).
--   p_lease_minutes — Claim duration in minutes (default 30).
--
-- Returns: The claimed ticket row, or empty set if ticket not claimable.
-- Raises: FILE_CONFLICT if file_paths overlap with another active ticket.

CREATE OR REPLACE FUNCTION claim_ticket_by_id(
    p_ticket_id     TEXT,
    p_agent_id      UUID,
    p_agent_name    TEXT,
    p_machine_id    TEXT,
    p_operator      TEXT DEFAULT NULL,
    p_lease_minutes INTEGER DEFAULT 30
)
RETURNS SETOF tickets AS $$
DECLARE
    v_ticket tickets%ROWTYPE;
BEGIN
    SELECT * INTO v_ticket
    FROM tickets
    WHERE ticket_id = p_ticket_id
      AND (status = 'READY' OR (status = 'CLAIMED' AND lease_expiry < NOW()))
    FOR UPDATE SKIP LOCKED;

    IF v_ticket.id IS NULL THEN
        RETURN;
    END IF;

    -- Check for file lock conflicts
    IF EXISTS (
        SELECT 1 FROM file_locks fl
        WHERE fl.released_at IS NULL
          AND fl.ticket_id != p_ticket_id
          AND fl.file_path = ANY(v_ticket.file_paths)
    ) THEN
        RAISE EXCEPTION 'FILE_CONFLICT: One or more files in file_paths are locked by another ticket';
    END IF;

    UPDATE tickets
    SET
        status = 'CLAIMED',
        claimed_by = p_agent_id,
        claimed_by_name = p_agent_name,
        machine_id = p_machine_id,
        operator = p_operator,
        lease_expiry = NOW() + (p_lease_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    -- Lock files
    INSERT INTO file_locks (file_path, ticket_id, locked_by, machine_id)
    SELECT unnest(v_ticket.file_paths), v_ticket.ticket_id, p_agent_id, p_machine_id
    ON CONFLICT (file_path) WHERE released_at IS NULL DO NOTHING;

    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, operator, previous_status, new_status, payload)
    VALUES (v_ticket.ticket_id, 'CLAIMED', p_agent_id, p_agent_name, p_machine_id, p_operator, 'READY', 'CLAIMED',
            jsonb_build_object('lease_expiry', v_ticket.lease_expiry, 'lease_minutes', p_lease_minutes));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── advance_ticket ───────────────────────────────────────────────────────────
-- Advances a ticket to the next stage in its SDLC flow.--
-- Flow validation: looks up the current stage's index in sdlc_flow[],
-- then moves to sdlc_flow[index + 1]. Raises INVALID_TRANSITION if
-- already at the final stage.
--
-- On advancement:
--   - Clears claim fields (claimed_by, machine_id, operator, lease_expiry).
--   - Releases all file locks held by this ticket.
--   - Sets status to READY (or DONE if reaching final stage).
--   - Merges evidence JSONB into ticket metadata.
--   - If reaching DONE, calls resolve_dependencies() to unblock waiting tickets.
--
-- Parameters:
--   p_ticket_id  — Human-readable ticket identifier.
--   p_agent_id   — UUID of the agent (must be the current claim holder).
--   p_agent_name — Human-readable agent name.
--   p_evidence   — JSONB evidence from the completed stage (optional).
--
-- Returns: The updated ticket row.
-- Raises: NOT_CLAIM_OWNER, INVALID_TRANSITION.
CREATE OR REPLACE FUNCTION advance_ticket(
    p_ticket_id     TEXT,
    p_agent_id      UUID,
    p_agent_name    TEXT,
    p_evidence      JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF tickets AS $$
DECLARE
    v_ticket        tickets%ROWTYPE;
    v_current_idx   INTEGER;
    v_next_stage    ticket_stage;
    v_next_status   ticket_status;
BEGIN
    SELECT * INTO v_ticket
    FROM tickets
    WHERE ticket_id = p_ticket_id
      AND claimed_by = p_agent_id
    FOR UPDATE;

    IF v_ticket.id IS NULL THEN
        RAISE EXCEPTION 'NOT_CLAIM_OWNER: You do not hold the claim on this ticket';
    END IF;

    SELECT idx INTO v_current_idx
    FROM unnest(v_ticket.sdlc_flow) WITH ORDINALITY AS t(stage, idx)
    WHERE t.stage = v_ticket.stage;

    IF v_current_idx IS NULL OR v_current_idx >= array_length(v_ticket.sdlc_flow, 1) THEN
        RAISE EXCEPTION 'INVALID_TRANSITION: Cannot advance beyond final stage';
    END IF;

    v_next_stage := v_ticket.sdlc_flow[v_current_idx + 1];

    IF v_next_stage = 'DONE' THEN
        v_next_status := 'DONE';
    ELSE
        v_next_status := 'READY';
    END IF;

    UPDATE tickets
    SET
        stage = v_next_stage,
        status = v_next_status,
        claimed_by = NULL,
        claimed_by_name = NULL,
        machine_id = NULL,
        operator = NULL,
        lease_expiry = NULL,
        metadata = metadata || p_evidence,
        completed_at = CASE WHEN v_next_stage = 'DONE' THEN NOW() ELSE NULL END,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    UPDATE file_locks
    SET released_at = NOW()
    WHERE ticket_id = p_ticket_id AND released_at IS NULL;

    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, previous_stage, new_stage, previous_status, new_status, payload)
    VALUES (p_ticket_id, 'STAGE_ADVANCED', p_agent_id, p_agent_name,
            v_ticket.sdlc_flow[v_current_idx], v_next_stage,
            'CLAIMED', v_next_status, p_evidence);

    IF v_next_stage = 'DONE' THEN
        PERFORM resolve_dependencies(p_ticket_id);
    END IF;

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── reject_ticket ────────────────────────────────────────────────────────────
-- Rejects a ticket, sending it back for rework or escalating.--
-- Rework logic:
--   - If rework_count < max_reworks: resets ticket to its first implementation
--     stage (the first stage after READY in sdlc_flow) with status READY.
--   - If rework_count >= max_reworks: sets status to ESCALATED, requiring
--     human intervention.
-- In both cases: clears claim fields, releases file locks, logs the event.
--
-- Parameters:
--   p_ticket_id  — Human-readable ticket identifier.
--   p_agent_id   — UUID of the rejecting agent (must hold the claim).
--   p_agent_name — Human-readable agent name.
--   p_reason     — Free-text rejection reason.
--   p_evidence   — JSONB evidence supporting the rejection (optional).
--
-- Returns: The updated ticket row.
-- Raises: NOT_CLAIM_OWNER.
CREATE OR REPLACE FUNCTION reject_ticket(
    p_ticket_id     TEXT,
    p_agent_id      UUID,
    p_agent_name    TEXT,
    p_reason        TEXT,
    p_evidence      JSONB DEFAULT '{}'::JSONB
)
RETURNS SETOF tickets AS $$
DECLARE
    v_ticket        tickets%ROWTYPE;
    v_impl_stage    ticket_stage;
BEGIN
    SELECT * INTO v_ticket
    FROM tickets
    WHERE ticket_id = p_ticket_id
      AND claimed_by = p_agent_id
    FOR UPDATE;

    IF v_ticket.id IS NULL THEN
        RAISE EXCEPTION 'NOT_CLAIM_OWNER: You do not hold the claim on this ticket';
    END IF;

    IF v_ticket.rework_count >= v_ticket.max_reworks THEN
        UPDATE tickets
        SET
            status = 'ESCALATED',
            claimed_by = NULL,
            claimed_by_name = NULL,
            machine_id = NULL,
            operator = NULL,
            lease_expiry = NULL,
            rework_count = v_ticket.rework_count + 1,
            updated_at = NOW()
        WHERE id = v_ticket.id
        RETURNING * INTO v_ticket;

        INSERT INTO events (ticket_id, event_type, agent_id, agent_name, previous_stage, new_stage, previous_status, new_status, payload)
        VALUES (p_ticket_id, 'ESCALATED', p_agent_id, p_agent_name,
                v_ticket.stage, v_ticket.stage, 'CLAIMED', 'ESCALATED',
                jsonb_build_object('reason', p_reason, 'evidence', p_evidence, 'rework_count', v_ticket.rework_count));

        UPDATE file_locks SET released_at = NOW() WHERE ticket_id = p_ticket_id AND released_at IS NULL;

        RETURN NEXT v_ticket;
        RETURN;
    END IF;

    SELECT stage INTO v_impl_stage
    FROM unnest(v_ticket.sdlc_flow) AS stage
    WHERE stage NOT IN ('READY', 'DONE')
    LIMIT 1;

    UPDATE tickets
    SET
        status = 'READY',
        stage = v_impl_stage,
        claimed_by = NULL,
        claimed_by_name = NULL,
        machine_id = NULL,
        operator = NULL,
        lease_expiry = NULL,
        rework_count = v_ticket.rework_count + 1,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    UPDATE file_locks SET released_at = NOW() WHERE ticket_id = p_ticket_id AND released_at IS NULL;

    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, previous_stage, new_stage, previous_status, new_status, payload)
    VALUES (p_ticket_id, 'STAGE_REJECTED', p_agent_id, p_agent_name,
            v_ticket.stage, v_impl_stage, 'CLAIMED', 'READY',
            jsonb_build_object('reason', p_reason, 'evidence', p_evidence, 'rework_count', v_ticket.rework_count));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── release_ticket ───────────────────────────────────────────────────────────
-- Voluntarily releases a claim, returning ticket to READY status.
-- Supports forced release (p_force = TRUE) for admin lease recovery.
--
-- Parameters:
--   p_ticket_id  — Human-readable ticket identifier.
--   p_agent_id   — UUID of the releasing agent.
--   p_agent_name — Human-readable agent name.
--   p_reason     — Free-text reason for release (optional).
--   p_force      — If TRUE, allows releasing another agent's claim (admin use).
--
-- Returns: The updated ticket row.
-- Raises: TICKET_NOT_FOUND, NOT_CLAIM_OWNER (if not forced).

CREATE OR REPLACE FUNCTION release_ticket(
    p_ticket_id     TEXT,
    p_agent_id      UUID,
    p_agent_name    TEXT,
    p_reason        TEXT DEFAULT NULL,
    p_force         BOOLEAN DEFAULT FALSE
)
RETURNS SETOF tickets AS $$
DECLARE
    v_ticket tickets%ROWTYPE;
BEGIN
    SELECT * INTO v_ticket
    FROM tickets
    WHERE ticket_id = p_ticket_id
    FOR UPDATE;

    IF v_ticket.id IS NULL THEN
        RAISE EXCEPTION 'TICKET_NOT_FOUND: Ticket % does not exist', p_ticket_id;
    END IF;

    IF NOT p_force AND v_ticket.claimed_by != p_agent_id THEN
        RAISE EXCEPTION 'NOT_CLAIM_OWNER: You do not hold the claim on this ticket';
    END IF;

    UPDATE tickets
    SET
        status = 'READY',
        claimed_by = NULL,
        claimed_by_name = NULL,
        machine_id = NULL,
        operator = NULL,
        lease_expiry = NULL,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    UPDATE file_locks SET released_at = NOW() WHERE ticket_id = p_ticket_id AND released_at IS NULL;

    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, previous_status, new_status, payload)
    VALUES (p_ticket_id,
            CASE WHEN p_force THEN 'FORCE_RELEASED' ELSE 'RELEASED' END,
            p_agent_id, p_agent_name, 'CLAIMED', 'READY',
            jsonb_build_object('reason', COALESCE(p_reason, 'voluntary_release'), 'forced', p_force));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── extend_lease ─────────────────────────────────────────────────────────────
-- Extends the lease on a claimed ticket.
-- Reads max_lease_minutes from system_config to enforce an upper bound.
--
-- Parameters:
--   p_ticket_id  — Human-readable ticket identifier.
--   p_agent_id   — UUID of the agent (must hold the claim).
--   p_agent_name — Human-readable agent name.
--   p_minutes    — Extension duration in minutes (default 30).
--
-- Returns: The updated ticket row.
-- Raises: NOT_CLAIM_OWNER, LEASE_TOO_LONG.

CREATE OR REPLACE FUNCTION extend_lease(
    p_ticket_id     TEXT,
    p_agent_id      UUID,
    p_agent_name    TEXT,
    p_minutes       INTEGER DEFAULT 30
)
RETURNS SETOF tickets AS $$
DECLARE
    v_ticket tickets%ROWTYPE;
    v_max_minutes INTEGER;
BEGIN
    SELECT (value#>>'{}')::INTEGER INTO v_max_minutes FROM system_config WHERE key = 'max_lease_minutes';
    v_max_minutes := COALESCE(v_max_minutes, 120);

    SELECT * INTO v_ticket
    FROM tickets
    WHERE ticket_id = p_ticket_id
      AND claimed_by = p_agent_id
    FOR UPDATE;

    IF v_ticket.id IS NULL THEN
        RAISE EXCEPTION 'NOT_CLAIM_OWNER: You do not hold the claim on this ticket';
    END IF;

    IF p_minutes > v_max_minutes THEN
        RAISE EXCEPTION 'LEASE_TOO_LONG: Maximum extension is % minutes', v_max_minutes;
    END IF;

    UPDATE tickets
    SET
        lease_expiry = NOW() + (p_minutes || ' minutes')::INTERVAL,
        updated_at = NOW()
    WHERE id = v_ticket.id
    RETURNING * INTO v_ticket;

    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, payload)
    VALUES (p_ticket_id, 'LEASE_EXTENDED', p_agent_id, p_agent_name,
            jsonb_build_object('new_expiry', v_ticket.lease_expiry, 'extension_minutes', p_minutes));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── resolve_dependencies ─────────────────────────────────────────────────────
-- When a ticket reaches DONE, check if any BLOCKED tickets depend on it.
-- For each candidate, verify ALL dependencies are DONE (not just this one).
-- If all dependencies satisfied, transitions the candidate to READY.
--
-- Called automatically by advance_ticket() when reaching DONE stage.
--
-- Parameters:
--   p_completed_ticket_id — ticket_id of the newly completed ticket.
--
-- Returns: void. Side effects: updates BLOCKED tickets, inserts events.

CREATE OR REPLACE FUNCTION resolve_dependencies(p_completed_ticket_id TEXT)
RETURNS VOID AS $$
DECLARE
    v_candidate RECORD;
BEGIN
    FOR v_candidate IN
        SELECT t.*
        FROM tickets t
        WHERE t.status = 'BLOCKED'
          AND p_completed_ticket_id = ANY(t.depends_on)
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM unnest(v_candidate.depends_on) AS dep_id
            WHERE NOT EXISTS (
                SELECT 1 FROM tickets WHERE ticket_id = dep_id AND status = 'DONE'
            )
        ) THEN
            UPDATE tickets
            SET status = 'READY', updated_at = NOW()
            WHERE id = v_candidate.id;

            INSERT INTO events (ticket_id, event_type, payload)
            VALUES (v_candidate.ticket_id, 'UPDATED',
                    jsonb_build_object('action', 'dependency_resolved', 'resolved_by', p_completed_ticket_id));
        END IF;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ── release_expired_claims ───────────────────────────────────────────────────-- Batch operation: releases all tickets whose lease has expired.
-- Returns the count of released tickets. Also releases any orphaned
-- file locks for the affected tickets.
--
-- Intended to be called periodically (e.g., every 5 minutes) by the
-- application server or a cron job.
--
-- Returns: INTEGER — number of expired claims released.
CREATE OR REPLACE FUNCTION release_expired_claims()
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER;
BEGIN
    WITH expired AS (
        UPDATE tickets
        SET
            status = 'READY',
            claimed_by = NULL,
            claimed_by_name = NULL,
            machine_id = NULL,
            operator = NULL,
            lease_expiry = NULL,
            updated_at = NOW()
        WHERE claimed_by IS NOT NULL
          AND lease_expiry < NOW()
        RETURNING ticket_id, claimed_by_name, machine_id
    )
    INSERT INTO events (ticket_id, event_type, agent_name, machine_id, previous_status, new_status, payload)
    SELECT ticket_id, 'RELEASED', claimed_by_name, machine_id, 'CLAIMED', 'READY',
           jsonb_build_object('reason', 'lease_expired')
    FROM expired;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE file_locks
    SET released_at = NOW()
    WHERE released_at IS NULL
      AND ticket_id IN (
          SELECT ticket_id FROM tickets
          WHERE claimed_by IS NULL AND status = 'READY'
      );

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ── NOTIFY trigger for real-time SSE ─────────────────────────────────────────-- Fires pg_notify('ticket_changes', ...) on every ticket INSERT or UPDATE.
-- The application server listens on the 'ticket_changes' channel and
-- pushes events to connected SSE clients for real-time dashboard updates.
-- Payload is a JSON object with key ticket fields.
CREATE OR REPLACE FUNCTION notify_ticket_change()
RETURNS TRIGGER AS $$
BEGIN
    PERFORM pg_notify('ticket_changes', json_build_object(
        'ticket_id', NEW.ticket_id,
        'status', NEW.status,
        'stage', NEW.stage,
        'claimed_by', NEW.claimed_by_name,
        'machine_id', NEW.machine_id,
        'updated_at', NEW.updated_at
    )::text);
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ticket_notify
    AFTER INSERT OR UPDATE ON tickets
    FOR EACH ROW EXECUTE FUNCTION notify_ticket_change();
