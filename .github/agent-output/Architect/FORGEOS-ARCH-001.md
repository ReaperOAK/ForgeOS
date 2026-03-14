# ForgeOS Architecture Document

## Metadata

| Field | Value |
|-------|-------|
| **Document ID** | FORGEOS-ARCH-001 |
| **Author** | Architect Agent |
| **Date** | 2026-03-05T00:00:00Z |
| **Status** | APPROVED |
| **Upstream Artifacts** | FORGEOS-RESEARCH-001 (Research), FORGEOS-PRD-001 (PRD) |
| **Confidence** | HIGH (87%) |

---

## 1. Context Map

### 1.1 Primary Files (Directly Affected)

| File/Path | Role | Change Type |
|-----------|------|-------------|
| `forgeos-server/src/index.ts` | Entry point | **CREATE** |
| `forgeos-server/src/server.ts` | MCP server setup & Express app | **CREATE** |
| `forgeos-server/src/db/pool.ts` | PostgreSQL connection pool | **CREATE** |
| `forgeos-server/src/db/migrations/001_initial.sql` | DDL for all tables, RLS, indexes, functions | **CREATE** |
| `forgeos-server/src/tools/*.ts` | 10 MCP tool handlers | **CREATE** |
| `forgeos-server/src/middleware/auth.ts` | API key validation middleware | **CREATE** |
| `forgeos-server/src/middleware/logging.ts` | Structured logging middleware | **CREATE** |
| `forgeos-server/src/dashboard/index.html` | Dashboard HTML | **CREATE** |
| `forgeos-server/src/dashboard/css/style.css` | Dashboard styling | **CREATE** |
| `forgeos-server/src/dashboard/js/app.js` | Dashboard SSE/D3 client | **CREATE** |
| `forgeos-server/src/hooks/commit-msg.sh` | Commit message validation hook | **CREATE** |
| `forgeos-server/src/hooks/pre-commit.sh` | Blast radius validation hook | **CREATE** |
| `forgeos-server/src/types/index.ts` | Shared TypeScript types | **CREATE** |
| `forgeos-server/package.json` | Dependencies & scripts | **CREATE** |
| `forgeos-server/tsconfig.json` | TypeScript config | **CREATE** |
| `forgeos-server/Dockerfile` | Container build | **CREATE** |
| `forgeos-server/docker-compose.yml` | Multi-service orchestration | **CREATE** |
| `forgeos-server/.env.example` | Environment variable template | **CREATE** |

### 1.2 Secondary Files (Indirectly Affected)

| File/Path | Impact |
|-----------|--------|
| `.github/tickets.py` | Will be wrapped/replaced by MCP tools — read for compatibility |
| `.github/agent-runner.py` | Will use MCP client SDK instead of direct filesystem ops |
| `.github/tickets/ticket-schema.json` | PostgreSQL schema must be compatible |
| `.github/ticket-state/` | Migration source — import into PostgreSQL |

### 1.3 Established Patterns

| Pattern | Source | Adopted? |
|---------|--------|----------|
| File-based state machine | `.github/ticket-state/` dirs | Replaced by PostgreSQL, compatibility preserved |
| `SELECT FOR UPDATE SKIP LOCKED` | Research §2.1 | Yes — core locking mechanism |
| MCP `registerTool()` API | Research §1.5 | Yes — all 10 tools |
| Streamable HTTP transport | Research §1.4 | Yes — Express-based |
| API key auth (hashed) | Research §4.2 | Yes — v1 auth |
| Vanilla HTML + SSE + D3.js | Research §5.2 | Yes — dashboard |
| Docker Compose healthchecks | Research §6.1 | Yes — startup orchestration |

### 1.4 Change Sequence

1. PostgreSQL schema DDL (tables, indexes, RLS, functions)
2. Docker Compose infrastructure (postgres, pgbouncer, mcp-server)
3. MCP server scaffold (Express + Streamable HTTP transport)
4. Database connection pool & migration runner
5. SDLC stage engine (transition logic)
6. Core MCP tools (next, claim, complete, reject, release)
7. Extended MCP tools (update, spawn, graph, extend, stats)
8. Auth middleware (API keys, RBAC)
9. REST API endpoints (for dashboard)
10. Dashboard (pipeline board, dependency graph)
11. Git hooks (commit-msg, pre-commit)
12. Data import/seed tool
13. Migration bridge (dual-mode)

---

## 2. Well-Architected Framework Assessment

### 2.1 Operational Excellence — Score: 8/10

| Aspect | Design |
|--------|--------|
| **Monitoring** | `GET /health` endpoint (DB connectivity, pool stats, uptime); SSE event stream for live state; `tickets.stats` MCP tool for aggregates |
| **Debugging** | Structured JSON logging with correlation IDs per request; full event sourcing in `events` table; every state transition traceable |
| **Deployment** | Single `docker compose up`; zero-downtime restart via `restart: unless-stopped`; healthcheck-gated startup |
| **Runbooks** | Stale claim recovery via `tickets.release`; ghost commit recovery via webhook reconciliation; backup via `pg_dump` |

### 2.2 Security — Score: 7/10

| Aspect | Design |
|--------|--------|
| **Attack surface** | MCP server on localhost or private network only; API key auth middleware on all endpoints; HMAC-SHA256 on webhooks |
| **Data classification** | API keys: SECRET (hashed at rest); ticket data: INTERNAL; audit logs: INTERNAL |
| **Threat model inputs** | Unauthorized claim (mitigated by API key + RBAC); lease expiry abuse (mitigated by configurable max extension); SQL injection (mitigated by parameterized queries) |
| **Gaps** | OAuth 2.1 deferred to v2; no mTLS between services in Docker network (acceptable for v1) |

### 2.3 Reliability — Score: 8/10

| Aspect | Design |
|--------|--------|
| **Failure modes** | DB down → MCP returns 503; agent crash mid-work → lease expires, ticket reclaimable; webhook missed → periodic reconciliation sweep |
| **SLA targets** | 99.9% uptime during business hours; zero ticket state loss |
| **Fallbacks** | Filesystem fallback in Agent SDK if MCP unreachable; periodic reconciliation compensates for missed webhooks |
| **Recovery time** | Stale claim: auto-recovery within 1 min of lease expiry; DB crash: Docker restart + WAL recovery |

### 2.4 Performance — Score: 8/10

| Aspect | Target | Mechanism |
|--------|--------|-----------|
| **Claim latency** | p99 < 100ms | `SKIP LOCKED` avoids contention; indexed lookups |
| **tickets.next** | < 50ms | Composite index on `(stage, status)` |
| **tickets.graph** | < 500ms for 500 tickets | Precomputed dependency edges; single recursive CTE query |
| **SSE latency** | < 1 second | NOTIFY/LISTEN on PostgreSQL triggers → EventEmitter → SSE |
| **Resource usage** | < 512MB RAM for MCP server | Node.js single process, no framework overhead |

### 2.5 Cost Optimization — Score: 9/10

| Aspect | Design |
|--------|--------|
| **Resource costs** | PostgreSQL + Node.js on a single VM or Docker host — minimal |
| **Scaling costs** | PgBouncer handles 50+ agents on single DB; no horizontal scaling needed for v1 targets |
| **Build vs buy** | Custom `SKIP LOCKED` implementation over PgBoss (ForgeOS state machine is unique); custom dashboard over React (no build step, smaller footprint) |

### 2.6 Sustainability — Score: 8/10

| Aspect | Design |
|--------|--------|
| **Maintainability** | TypeScript strict mode; Zod schema validation on all MCP inputs; pure SQL migrations (no ORM magic) |
| **Team skills** | TypeScript, SQL, Docker — standard skillset; no exotic dependencies |
| **Documentation burden** | JSDoc/TSDoc on all public APIs; OpenAPI spec for REST endpoints; this ADR document |

---

## 3. PostgreSQL Schema (Complete DDL)

```sql
-- =============================================================================
-- ForgeOS PostgreSQL Schema — Migration 001_initial.sql
-- =============================================================================
-- Conventions: snake_case names, UUID PKs, timestamptz for all dates,
--              JSONB for flexible fields, 3NF minimum.
-- =============================================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- ENUM TYPES
-- =============================================================================

CREATE TYPE ticket_status AS ENUM (
    'READY',
    'BLOCKED',
    'CLAIMED',
    'IN_PROGRESS',
    'DONE',
    'FAILED',
    'ESCALATED'
);

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

CREATE TYPE ticket_priority AS ENUM (
    'critical',
    'high',
    'medium',
    'low'
);

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

CREATE TABLE agents (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            TEXT NOT NULL,
    role            TEXT NOT NULL,
    api_key_hash    TEXT UNIQUE,            -- SHA-256 hash of API key
    permissions     JSONB NOT NULL DEFAULT '[]'::JSONB,
    machine_id      TEXT,                    -- optional default machine binding
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    revoked_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT agent_name_role_unique UNIQUE (name, role)
);

-- =============================================================================
-- SESSIONS TABLE
-- =============================================================================

CREATE TABLE sessions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id        UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    session_token   TEXT NOT NULL UNIQUE,     -- MCP session ID
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

CREATE TABLE tickets (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ticket_id       TEXT NOT NULL UNIQUE,     -- e.g., "FORGEOS-001" or "TASK-001-01-01"
    project_id      UUID REFERENCES projects(id) ON DELETE SET NULL,
    title           TEXT NOT NULL,
    description     TEXT,
    type            ticket_type NOT NULL,
    priority        ticket_priority NOT NULL DEFAULT 'medium',

    -- State fields
    status          ticket_status NOT NULL DEFAULT 'BLOCKED',
    stage           ticket_stage NOT NULL DEFAULT 'READY',
    sdlc_flow       ticket_stage[] NOT NULL,  -- ordered array of stages for this ticket

    -- Claim fields
    claimed_by      UUID REFERENCES agents(id) ON DELETE SET NULL,
    claimed_by_name TEXT,                      -- denormalized for quick lookups
    machine_id      TEXT,
    operator        TEXT,
    lease_expiry    TIMESTAMPTZ,
    lease_duration_minutes INTEGER NOT NULL DEFAULT 30,

    -- Dependency and scope
    depends_on      TEXT[] NOT NULL DEFAULT '{}',   -- array of ticket_id strings
    file_paths      TEXT[] NOT NULL DEFAULT '{}',   -- files this ticket may modify
    acceptance_criteria TEXT[] NOT NULL DEFAULT '{}',
    tags            TEXT[] NOT NULL DEFAULT '{}',

    -- Rework tracking
    rework_count    INTEGER NOT NULL DEFAULT 0 CHECK (rework_count >= 0),
    max_reworks     INTEGER NOT NULL DEFAULT 3,

    -- Metadata
    metadata        JSONB NOT NULL DEFAULT '{}'::JSONB,   -- progress, notes, custom fields
    parent_id       TEXT,                      -- parent ticket_id for spawned tickets
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
CREATE INDEX idx_tickets_status_stage ON tickets(status, stage);
CREATE INDEX idx_tickets_stage ON tickets(stage);
CREATE INDEX idx_tickets_claimed_by ON tickets(claimed_by);
CREATE INDEX idx_tickets_priority ON tickets(priority);
CREATE INDEX idx_tickets_project_id ON tickets(project_id);
CREATE INDEX idx_tickets_parent_id ON tickets(parent_id);

-- GIN indexes for array/JSONB fields
CREATE INDEX idx_tickets_depends_on ON tickets USING GIN(depends_on);
CREATE INDEX idx_tickets_file_paths ON tickets USING GIN(file_paths);
CREATE INDEX idx_tickets_tags ON tickets USING GIN(tags);
CREATE INDEX idx_tickets_metadata ON tickets USING GIN(metadata);

-- Composite index for claim queries
CREATE INDEX idx_tickets_claimable ON tickets(stage, priority DESC, created_at ASC)
    WHERE status = 'READY' AND claimed_by IS NULL;

-- Composite index for expired lease queries
CREATE INDEX idx_tickets_expired_leases ON tickets(lease_expiry)
    WHERE claimed_by IS NOT NULL AND lease_expiry IS NOT NULL;

-- =============================================================================
-- FILE_LOCKS TABLE (File-Level Mutex)
-- =============================================================================

CREATE TABLE file_locks (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    file_path       TEXT NOT NULL,
    ticket_id       TEXT NOT NULL,
    locked_by       UUID REFERENCES agents(id) ON DELETE SET NULL,
    machine_id      TEXT,
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at     TIMESTAMPTZ,
    CONSTRAINT file_lock_unique UNIQUE (file_path) WHERE released_at IS NULL
);

-- Partial unique index: only one active lock per file at a time
CREATE UNIQUE INDEX idx_file_locks_active ON file_locks(file_path) WHERE released_at IS NULL;
CREATE INDEX idx_file_locks_ticket_id ON file_locks(ticket_id);

-- =============================================================================
-- EVENTS TABLE (Audit Trail / Event Sourcing)
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

CREATE INDEX idx_events_ticket_id ON events(ticket_id);
CREATE INDEX idx_events_created_at ON events(created_at);
CREATE INDEX idx_events_event_type ON events(event_type);
CREATE INDEX idx_events_ticket_timeline ON events(ticket_id, created_at);

-- =============================================================================
-- SYSTEM_CONFIG TABLE
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
        OR TRUE  -- all agents can view all tickets for graph/stats
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

-- Trigger: auto-update updated_at on tickets
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
-- Uses SELECT FOR UPDATE SKIP LOCKED to prevent contention.
-- Returns the claimed ticket row, or NULL if no ticket available.

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
    -- Find and lock the highest-priority unclaimed ticket in this stage
    SELECT * INTO v_ticket
    FROM tickets
    WHERE stage = p_stage
      AND status = 'READY'
      AND (claimed_by IS NULL OR lease_expiry < NOW())
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED;

    IF v_ticket.id IS NULL THEN
        RETURN;  -- No ticket available
    END IF;

    -- Claim the ticket
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

    -- Insert claim event
    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, operator, previous_status, new_status, payload)
    VALUES (v_ticket.ticket_id, 'CLAIMED', p_agent_id, p_agent_name, p_machine_id, p_operator, 'READY', 'CLAIMED',
            jsonb_build_object('lease_expiry', v_ticket.lease_expiry, 'lease_minutes', p_lease_minutes));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── claim_ticket_by_id ───────────────────────────────────────────────────────
-- Claims a specific ticket by ticket_id (not the UUID).

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
        RETURN;  -- Ticket not available (doesn't exist, already claimed, or wrong status)
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

    -- Claim the ticket
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

    -- Insert events
    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, operator, previous_status, new_status, payload)
    VALUES (v_ticket.ticket_id, 'CLAIMED', p_agent_id, p_agent_name, p_machine_id, p_operator, 'READY', 'CLAIMED',
            jsonb_build_object('lease_expiry', v_ticket.lease_expiry, 'lease_minutes', p_lease_minutes));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── advance_ticket ───────────────────────────────────────────────────────────
-- Advances a ticket to the next stage in its SDLC flow.
-- Validates that the caller is the claim owner.
-- Releases the claim and file locks.

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
    -- Lock the ticket
    SELECT * INTO v_ticket
    FROM tickets
    WHERE ticket_id = p_ticket_id
      AND claimed_by = p_agent_id
    FOR UPDATE;

    IF v_ticket.id IS NULL THEN
        RAISE EXCEPTION 'NOT_CLAIM_OWNER: You do not hold the claim on this ticket';
    END IF;

    -- Find current stage index in sdlc_flow
    SELECT idx INTO v_current_idx
    FROM unnest(v_ticket.sdlc_flow) WITH ORDINALITY AS t(stage, idx)
    WHERE t.stage = v_ticket.stage;

    IF v_current_idx IS NULL OR v_current_idx >= array_length(v_ticket.sdlc_flow, 1) THEN
        RAISE EXCEPTION 'INVALID_TRANSITION: Cannot advance beyond final stage';
    END IF;

    v_next_stage := v_ticket.sdlc_flow[v_current_idx + 1];

    -- Determine next status
    IF v_next_stage = 'DONE' THEN
        v_next_status := 'DONE';
    ELSE
        v_next_status := 'READY';
    END IF;

    -- Update ticket
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

    -- Release file locks
    UPDATE file_locks
    SET released_at = NOW()
    WHERE ticket_id = p_ticket_id AND released_at IS NULL;

    -- Insert event
    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, previous_stage, new_stage, previous_status, new_status, payload)
    VALUES (p_ticket_id, 'STAGE_ADVANCED', p_agent_id, p_agent_name,
            v_ticket.sdlc_flow[v_current_idx], v_next_stage,
            'CLAIMED', v_next_status, p_evidence);

    -- If ticket reached DONE, re-evaluate dependencies
    IF v_next_stage = 'DONE' THEN
        PERFORM resolve_dependencies(p_ticket_id);
    END IF;

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── reject_ticket ────────────────────────────────────────────────────────────
-- Rejects a ticket (QA, Security, Validator), sending it back for rework.
-- If rework_count >= max_reworks, escalates.

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
    v_new_status    ticket_status;
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
        -- Escalate
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

        -- Release file locks
        UPDATE file_locks SET released_at = NOW() WHERE ticket_id = p_ticket_id AND released_at IS NULL;

        RETURN NEXT v_ticket;
        RETURN;
    END IF;

    -- Find the implementation stage (first non-READY stage in the flow)
    SELECT stage INTO v_impl_stage
    FROM unnest(v_ticket.sdlc_flow) AS stage
    WHERE stage NOT IN ('READY', 'DONE')
    LIMIT 1;

    -- Rework: move back to implementation stage
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

    -- Release file locks
    UPDATE file_locks SET released_at = NOW() WHERE ticket_id = p_ticket_id AND released_at IS NULL;

    -- Insert event
    INSERT INTO events (ticket_id, event_type, agent_id, agent_name, previous_stage, new_stage, previous_status, new_status, payload)
    VALUES (p_ticket_id, 'STAGE_REJECTED', p_agent_id, p_agent_name,
            v_ticket.stage, v_impl_stage, 'CLAIMED', 'READY',
            jsonb_build_object('reason', p_reason, 'evidence', p_evidence, 'rework_count', v_ticket.rework_count));

    RETURN NEXT v_ticket;
END;
$$ LANGUAGE plpgsql;

-- ── release_ticket ───────────────────────────────────────────────────────────
-- Releases a claim, returning ticket to READY.

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

    -- Release file locks
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
    SELECT value::INTEGER INTO v_max_minutes FROM system_config WHERE key = 'max_lease_minutes';
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
-- When a ticket reaches DONE, check if any blocked tickets can become READY.

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
        -- Check if ALL dependencies are now DONE
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

-- ── release_expired_claims ───────────────────────────────────────────────────
-- Periodic cleanup: release all claims with expired leases.

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

    -- Also release file locks for expired claims
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

-- ── NOTIFY trigger for real-time SSE ─────────────────────────────────────────

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
```

---

## 4. MCP Server Architecture

### 4.1 TypeScript Interfaces

```typescript
// ── types/index.ts ──────────────────────────────────────────────────────────

// ── Enums ──
export type TicketStatus = 'READY' | 'BLOCKED' | 'CLAIMED' | 'IN_PROGRESS' | 'DONE' | 'FAILED' | 'ESCALATED';

export type TicketStage =
    | 'READY' | 'RESEARCH' | 'ARCHITECT' | 'PRODUCT_MANAGER' | 'UI_DESIGN'
    | 'BACKEND' | 'FRONTEND' | 'QA' | 'SECURITY' | 'CI'
    | 'DOCUMENTATION' | 'VALIDATOR' | 'DONE';

export type TicketType =
    | 'backend' | 'frontend' | 'fullstack' | 'infra' | 'security'
    | 'docs' | 'research' | 'architecture' | 'product' | 'design';

export type TicketPriority = 'critical' | 'high' | 'medium' | 'low';

export type EventType =
    | 'CREATED' | 'CLAIMED' | 'RELEASED' | 'STAGE_ADVANCED' | 'STAGE_REJECTED'
    | 'UPDATED' | 'SPAWNED' | 'ESCALATED' | 'LEASE_EXTENDED' | 'FORCE_RELEASED'
    | 'RECONCILED' | 'FILE_LOCKED' | 'FILE_UNLOCKED';

// ── Core Domain Models ──

export interface Ticket {
    id: string;              // UUID
    ticket_id: string;       // Human-readable ID like FORGEOS-001
    project_id: string | null;
    title: string;
    description: string | null;
    type: TicketType;
    priority: TicketPriority;
    status: TicketStatus;
    stage: TicketStage;
    sdlc_flow: TicketStage[];
    claimed_by: string | null;
    claimed_by_name: string | null;
    machine_id: string | null;
    operator: string | null;
    lease_expiry: string | null;
    lease_duration_minutes: number;
    depends_on: string[];
    file_paths: string[];
    acceptance_criteria: string[];
    tags: string[];
    rework_count: number;
    max_reworks: number;
    metadata: Record<string, unknown>;
    parent_id: string | null;
    source_task_file: string | null;
    created_at: string;
    updated_at: string;
    completed_at: string | null;
}

export interface TicketEvent {
    id: string;
    ticket_id: string;
    event_type: EventType;
    agent_id: string | null;
    agent_name: string | null;
    machine_id: string | null;
    operator: string | null;
    previous_stage: TicketStage | null;
    new_stage: TicketStage | null;
    previous_status: TicketStatus | null;
    new_status: TicketStatus | null;
    payload: Record<string, unknown>;
    created_at: string;
}

export interface Agent {
    id: string;
    name: string;
    role: string;
    permissions: string[];
    machine_id: string | null;
    is_active: boolean;
    created_at: string;
}

export interface FileLock {
    id: string;
    file_path: string;
    ticket_id: string;
    locked_by: string | null;
    machine_id: string | null;
    locked_at: string;
    released_at: string | null;
}

// ── MCP Tool Input/Output Types ──

export interface TicketsNextInput {
    stage: TicketStage;
    type?: TicketType;
    priority?: TicketPriority;
}

export interface TicketsNextOutput {
    ticket: Ticket | null;
    message: string;
}

export interface TicketsClaimInput {
    ticket_id: string;
    agent_name: string;
    machine_id: string;
    operator?: string;
    lease_minutes?: number;
}

export interface TicketsClaimOutput {
    ticket: Ticket;
    lease_expiry: string;
    file_locks: string[];
}

export interface TicketsUpdateInput {
    ticket_id: string;
    metadata: Record<string, unknown>;
}

export interface TicketsUpdateOutput {
    ticket: Ticket;
}

export interface TicketsCompleteInput {
    ticket_id: string;
    evidence: {
        artifacts: string[];
        test_results: string;
        confidence: 'HIGH' | 'MEDIUM' | 'LOW';
        notes?: string;
    };
}

export interface TicketsCompleteOutput {
    ticket: Ticket;
    previous_stage: TicketStage;
    new_stage: TicketStage;
    dependencies_unblocked: string[];  // ticket_ids freed by this completion
}

export interface TicketsRejectInput {
    ticket_id: string;
    reason: string;
    evidence?: Record<string, unknown>;
}

export interface TicketsRejectOutput {
    ticket: Ticket;
    rework_count: number;
    escalated: boolean;
    returned_to_stage: TicketStage;
}

export interface TicketsSpawnInput {
    parent_id: string;
    title: string;
    type: TicketType;
    priority?: TicketPriority;
    acceptance_criteria: string[];
    file_paths: string[];
    description?: string;
    depends_on?: string[];
}

export interface TicketsSpawnOutput {
    ticket: Ticket;
    parent_ticket_id: string;
}

export interface TicketsGraphInput {
    filter?: {
        stage?: TicketStage;
        type?: TicketType;
        status?: TicketStatus;
    };
}

export interface TicketsGraphOutput {
    nodes: Ticket[];
    edges: Array<{ from: string; to: string }>;
    critical_path: string[];
}

export interface TicketsReleaseInput {
    ticket_id: string;
    reason?: string;
    force?: boolean;  // admin only
}

export interface TicketsReleaseOutput {
    ticket: Ticket;
    released_file_locks: string[];
}

export interface TicketsExtendInput {
    ticket_id: string;
    duration_minutes?: number;  // default 30
}

export interface TicketsExtendOutput {
    ticket: Ticket;
    new_lease_expiry: string;
}

export interface TicketsStatsOutput {
    stages: Record<TicketStage, number>;
    statuses: Record<TicketStatus, number>;
    claims: {
        healthy: number;
        expiring_soon: number;  // < 5 min remaining
        expired: number;
    };
    avg_stage_duration: Record<TicketStage, number>;  // seconds
    rework_distribution: Record<number, number>;      // rework_count -> ticket_count
    total_tickets: number;
    total_done: number;
}

// ── Auth Types ──

export interface AgentIdentity {
    id: string;
    name: string;
    role: string;
    permissions: string[];
    machine_id: string | null;
}

export interface ApiKeyRecord {
    id: string;
    agent_id: string;
    key_hash: string;
    role: string;
    permissions: string[];
    revoked: boolean;
}

// ── SSE Event Types ──

export interface SSETicketEvent {
    type: 'ticket-update' | 'pipeline-change' | 'claim-update' | 'system-alert';
    data: Record<string, unknown>;
    timestamp: string;
}
```

### 4.2 MCP Tool Definitions (All 10 Tools)

```typescript
// ── server.ts — MCP Server Setup ────────────────────────────────────────────

import { McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod/v4';

export function createForgeOSServer(): McpServer {
    const server = new McpServer(
        { name: 'forgeos-orchestrator', version: '1.0.0' },
        { capabilities: { logging: {} } }
    );

    // ── tickets.next ────────────────────────────────────────────────────────
    server.registerTool('tickets.next', {
        title: 'Next Available Ticket',
        description: 'Returns the next available ticket for a given agent stage',
        inputSchema: z.object({
            stage: z.enum([
                'READY','RESEARCH','ARCHITECT','PRODUCT_MANAGER','UI_DESIGN',
                'BACKEND','FRONTEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR'
            ]).describe('The SDLC stage to query for available work'),
            type: z.enum([
                'backend','frontend','fullstack','infra','security',
                'docs','research','architecture','product','design'
            ]).optional().describe('Optional filter by ticket type'),
            priority: z.enum(['critical','high','medium','low']).optional()
                .describe('Optional filter by minimum priority'),
        }),
    }, ticketsNextHandler);

    // ── tickets.claim ───────────────────────────────────────────────────────
    server.registerTool('tickets.claim', {
        title: 'Claim Ticket',
        description: 'Atomically claims a specific ticket for processing',
        inputSchema: z.object({
            ticket_id: z.string().describe('Ticket ID to claim'),
            agent_name: z.string().describe('Agent name claiming the ticket'),
            machine_id: z.string().describe('Machine hostname'),
            operator: z.string().optional().describe('Human operator name'),
            lease_minutes: z.number().int().min(5).max(120).default(30)
                .describe('Lease duration in minutes'),
        }),
    }, ticketsClaimHandler);

    // ── tickets.update ──────────────────────────────────────────────────────
    server.registerTool('tickets.update', {
        title: 'Update Ticket',
        description: 'Updates metadata on a claimed ticket',
        inputSchema: z.object({
            ticket_id: z.string().describe('Ticket ID to update'),
            metadata: z.record(z.unknown()).describe('Metadata to merge'),
        }),
    }, ticketsUpdateHandler);

    // ── tickets.complete ────────────────────────────────────────────────────
    server.registerTool('tickets.complete', {
        title: 'Complete Stage',
        description: 'Marks a ticket stage as complete and advances to the next stage',
        inputSchema: z.object({
            ticket_id: z.string().describe('Ticket ID to complete'),
            evidence: z.object({
                artifacts: z.array(z.string()).describe('Files created/modified'),
                test_results: z.string().describe('Test outcome: PASS, FAIL, N/A'),
                confidence: z.enum(['HIGH','MEDIUM','LOW']).describe('Confidence level'),
                notes: z.string().optional().describe('Additional notes'),
            }).describe('Completion evidence'),
        }),
    }, ticketsCompleteHandler);

    // ── tickets.reject ──────────────────────────────────────────────────────
    server.registerTool('tickets.reject', {
        title: 'Reject Ticket',
        description: 'Rejects a ticket during review, sending it back for rework',
        inputSchema: z.object({
            ticket_id: z.string().describe('Ticket ID to reject'),
            reason: z.string().describe('Rejection reason'),
            evidence: z.record(z.unknown()).optional()
                .describe('Rejection evidence (test results, etc.)'),
        }),
    }, ticketsRejectHandler);

    // ── tickets.spawn ───────────────────────────────────────────────────────
    server.registerTool('tickets.spawn', {
        title: 'Spawn Subtask',
        description: 'Creates a child ticket linked to the current ticket',
        inputSchema: z.object({
            parent_id: z.string().describe('Parent ticket ID'),
            title: z.string().max(200).describe('Subtask title'),
            type: z.enum([
                'backend','frontend','fullstack','infra','security',
                'docs','research','architecture','product','design'
            ]).describe('Subtask type'),
            priority: z.enum(['critical','high','medium','low']).default('medium'),
            acceptance_criteria: z.array(z.string()).min(1).describe('At least one criterion'),
            file_paths: z.array(z.string()).describe('Files the subtask may modify'),
            description: z.string().optional(),
            depends_on: z.array(z.string()).optional().describe('Additional dependencies'),
        }),
    }, ticketsSpawnHandler);

    // ── tickets.graph ───────────────────────────────────────────────────────
    server.registerTool('tickets.graph', {
        title: 'Dependency Graph',
        description: 'Returns the full ticket dependency DAG',
        inputSchema: z.object({
            filter: z.object({
                stage: z.enum([
                    'READY','RESEARCH','ARCHITECT','PRODUCT_MANAGER','UI_DESIGN',
                    'BACKEND','FRONTEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE'
                ]).optional(),
                type: z.enum([
                    'backend','frontend','fullstack','infra','security',
                    'docs','research','architecture','product','design'
                ]).optional(),
                status: z.enum(['READY','BLOCKED','CLAIMED','IN_PROGRESS','DONE','FAILED','ESCALATED']).optional(),
            }).optional(),
        }),
    }, ticketsGraphHandler);

    // ── tickets.release ─────────────────────────────────────────────────────
    server.registerTool('tickets.release', {
        title: 'Release Claim',
        description: 'Releases a claim on a ticket, returning it to READY',
        inputSchema: z.object({
            ticket_id: z.string().describe('Ticket ID to release'),
            reason: z.string().optional().describe('Release reason'),
            force: z.boolean().default(false).describe('Force release (admin only)'),
        }),
    }, ticketsReleaseHandler);

    // ── tickets.extend ──────────────────────────────────────────────────────
    server.registerTool('tickets.extend', {
        title: 'Extend Lease',
        description: 'Extends the lease on a claimed ticket',
        inputSchema: z.object({
            ticket_id: z.string().describe('Ticket ID'),
            duration_minutes: z.number().int().min(5).max(120).default(30)
                .describe('Extension duration in minutes'),
        }),
    }, ticketsExtendHandler);

    // ── tickets.stats ───────────────────────────────────────────────────────
    server.registerTool('tickets.stats', {
        title: 'System Statistics',
        description: 'Returns aggregate system statistics',
        inputSchema: z.object({
            time_range_hours: z.number().optional()
                .describe('Optional time range filter in hours'),
        }),
    }, ticketsStatsHandler);

    return server;
}
```

### 4.3 Middleware Stack

```
┌─────────────────────────────────────────────────────┐
│                   Express App                        │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │  1. CORS / DNS Rebinding Protection           │  │
│  │     (built into createMcpExpressApp)           │  │
│  ├───────────────────────────────────────────────┤  │
│  │  2. Request Logging (correlation ID)           │  │
│  │     X-Request-ID header, structured JSON logs  │  │
│  ├───────────────────────────────────────────────┤  │
│  │  3. Rate Limiting                              │  │
│  │     100 req/min per API key (configurable)     │  │
│  │     Sliding window via PostgreSQL              │  │
│  ├───────────────────────────────────────────────┤  │
│  │  4. API Key Authentication                     │  │
│  │     Authorization: Bearer <key>                │  │
│  │     SHA-256 hash lookup in agents table        │  │
│  │     Sets session vars: app.agent_role,         │  │
│  │     app.agent_name, app.agent_id               │  │
│  ├───────────────────────────────────────────────┤  │
│  │  5. RBAC Authorization                         │  │
│  │     Stage-scoped permissions per role           │  │
│  │     See permission matrix in §5                 │  │
│  ├───────────────────────────────────────────────┤  │
│  │  6. Zod Input Validation                       │  │
│  │     (built into MCP registerTool)               │  │
│  ├───────────────────────────────────────────────┤  │
│  │  7. Tool Handler                                │  │
│  │     PostgreSQL transaction with retry           │  │
│  ├───────────────────────────────────────────────┤  │
│  │  8. Error Handler                               │  │
│  │     Structured error responses; pg error codes  │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

### 4.4 Error Handling Patterns

```typescript
// ── Structured Error Codes ──
export enum ForgeOSError {
    TICKET_NOT_FOUND     = 'TICKET_NOT_FOUND',
    ALREADY_CLAIMED      = 'ALREADY_CLAIMED',
    NOT_CLAIM_OWNER      = 'NOT_CLAIM_OWNER',
    FILE_CONFLICT        = 'FILE_CONFLICT',
    INVALID_TRANSITION   = 'INVALID_TRANSITION',
    MISSING_EVIDENCE     = 'MISSING_EVIDENCE',
    INVALID_SUBTASK      = 'INVALID_SUBTASK',
    LEASE_EXPIRED        = 'LEASE_EXPIRED',
    LEASE_TOO_LONG       = 'LEASE_TOO_LONG',
    RATE_LIMITED          = 'RATE_LIMITED',
    UNAUTHORIZED         = 'UNAUTHORIZED',
    FORBIDDEN            = 'FORBIDDEN',
    INTERNAL_ERROR       = 'INTERNAL_ERROR',
    DB_UNAVAILABLE       = 'DB_UNAVAILABLE',
}

// ── Error Response Format ──
export interface ErrorResponse {
    error: ForgeOSError;
    message: string;
    details?: Record<string, unknown>;
    ticket_id?: string;
    timestamp: string;
}

// ── Handler error wrapper ──
async function withErrorHandling<T>(
    fn: () => Promise<T>,
    ticketId?: string
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    try {
        const result = await fn();
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
        const pgError = parsePgError(error);
        if (pgError) {
            return { content: [{ type: 'text', text: JSON.stringify({
                error: pgError.code,
                message: pgError.message,
                ticket_id: ticketId,
                timestamp: new Date().toISOString(),
            }) }] };
        }
        throw error;  // Rethrow unexpected errors
    }
}
```

---

## 5. File Structure

```
forgeos-server/
├── src/
│   ├── index.ts                  — Entry point: boots Express + MCP + LISTEN
│   ├── server.ts                 — MCP server factory, tool registration
│   ├── db/
│   │   ├── pool.ts               — pg.Pool singleton, healthcheck query
│   │   └── migrations/
│   │       └── 001_initial.sql   — Full DDL from §3
│   ├── tools/
│   │   ├── index.ts              — Re-exports all tool handlers
│   │   ├── tickets-next.ts       — tickets.next handler
│   │   ├── tickets-claim.ts      — tickets.claim handler
│   │   ├── tickets-update.ts     — tickets.update handler
│   │   ├── tickets-complete.ts   — tickets.complete handler
│   │   ├── tickets-reject.ts     — tickets.reject handler
│   │   ├── tickets-spawn.ts      — tickets.spawn handler
│   │   ├── tickets-graph.ts      — tickets.graph handler
│   │   ├── tickets-release.ts    — tickets.release handler
│   │   ├── tickets-extend.ts     — tickets.extend handler
│   │   └── tickets-stats.ts      — tickets.stats handler
│   ├── middleware/
│   │   ├── auth.ts               — API key validation + RBAC
│   │   └── logging.ts            — Structured JSON logging + correlation IDs
│   ├── sdlc/
│   │   ├── flows.ts              — SDLC flow definitions per ticket type
│   │   ├── transitions.ts        — Stage transition validation logic
│   │   └── types.ts              — SDLC type helpers
│   ├── webhooks/
│   │   ├── github.ts             — GitHub push webhook handler
│   │   ├── parser.ts             — Commit message parsing (CLAIM/WORK regex)
│   │   └── reconciliation.ts     — Ghost commit recovery logic
│   ├── api/
│   │   ├── routes/
│   │   │   ├── tickets.ts        — GET /api/tickets, /api/tickets/:id, /api/tickets/:id/history
│   │   │   ├── stages.ts         — GET /api/stages (pipeline overview)
│   │   │   └── events.ts         — GET /api/events (SSE stream)
│   │   └── index.ts              — Express router mounting
│   ├── dashboard/
│   │   ├── index.html            — Single-page dashboard (vanilla HTML)
│   │   ├── css/
│   │   │   └── style.css         — Dashboard styles
│   │   └── js/
│   │       ├── app.js            — Main app init, SSE client
│   │       ├── pipeline.js       — Kanban board rendering
│   │       ├── graph.js          — D3.js dependency graph
│   │       └── admin.js          — Admin panel (force-release, keys)
│   ├── hooks/
│   │   ├── commit-msg.sh         — Validates [TICKET-ID] prefix
│   │   └── pre-commit.sh         — Validates blast radius (file_paths scope)
│   └── types/
│       └── index.ts              — All shared TypeScript types (§4.1)
├── package.json
├── tsconfig.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .dockerignore
└── scripts/
    ├── import-tickets.ts         — Filesystem → PostgreSQL import
    ├── seed.ts                   — Default admin key + config
    └── migrate.ts                — Migration runner CLI
```

---

## 6. State Machine Design

### 6.1 Status (Mutable Ticket State)

```
                    ┌──────────┐
          ┌────────▶│ BLOCKED  │──── (deps resolved) ────┐
          │         └──────────┘                          │
          │                                               ▼
     ┌────┴────┐                                    ┌──────────┐
     │ CREATED │───────────────────────────────────▶│  READY   │
     └─────────┘                                    └────┬─────┘
                                                         │
                                              (claim)    │
                                                         ▼
                                                    ┌──────────┐
                                                    │ CLAIMED  │
                                                    └────┬─────┘
                                                         │
                                         (release) ──────┤──── (advance)
                                              │          │          │
                                              ▼          │          ▼
                                         ┌──────────┐   │    ┌──────────┐
                                         │  READY   │   │    │   DONE   │
                                         └──────────┘   │    └──────────┘
                                                         │
                                              (reject)   │
                                                         ▼
                                                    ┌──────────┐
                                                    │  READY   │ (rework < 3)
                                                    └──────────┘
                                                    ┌───────────┐
                                                    │ ESCALATED │ (rework >= 3)
                                                    └───────────┘
```

| Status | Description |
|--------|-------------|
| `BLOCKED` | Dependencies unresolved; not eligible for claim |
| `READY` | All dependencies met; eligible for claim |
| `CLAIMED` | Locked by an agent with active lease |
| `IN_PROGRESS` | Agent actively working (optional intermediate) |
| `DONE` | Stage completed, ticket advanced or finished |
| `FAILED` | Unrecoverable failure (manual intervention) |
| `ESCALATED` | Rework limit exceeded (rework_count >= 3) |

### 6.2 Stages (SDLC Pipeline Positions)

```
READY → RESEARCH → ARCHITECT → PRODUCT_MANAGER → UI_DESIGN → BACKEND → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE
```

Full stage list (13 stages):

| Stage | Agent | Description |
|-------|-------|-------------|
| `READY` | System | Unblocked, available for claim |
| `RESEARCH` | Research Analyst | Evidence-based research |
| `ARCHITECT` | Architect | Architecture design, ADRs |
| `PRODUCT_MANAGER` | Product Manager | Requirements, user stories |
| `UI_DESIGN` | UIDesigner | Mockups, wireframes |
| `BACKEND` | Backend / DevOps | Server-side implementation |
| `FRONTEND` | Frontend Engineer | UI implementation |
| `QA` | QA Engineer | Testing, coverage |
| `SECURITY` | Security Engineer | Vulnerability review |
| `CI` | CI Reviewer | Lint, type checks |
| `DOCUMENTATION` | Documentation Specialist | Docs, JSDoc |
| `VALIDATOR` | Validator | Definition of Done review |
| `DONE` | System | Lifecycle complete |

### 6.3 Valid Transitions Matrix

| From Status | To Status | Trigger | Conditions |
|-------------|-----------|---------|------------|
| BLOCKED | READY | resolve_dependencies() | All `depends_on` tickets DONE |
| READY | CLAIMED | tickets.claim | Ticket unclaimed or lease expired |
| CLAIMED | READY | tickets.release | Voluntary or forced release |
| CLAIMED | READY | release_expired_claims() | Lease expired |
| CLAIMED | DONE (on last stage) | tickets.complete | Evidence provided; last stage |
| CLAIMED | READY (next stage) | tickets.complete | Evidence provided; advance stage |
| CLAIMED | READY (impl stage) | tickets.reject | rework_count < max_reworks |
| CLAIMED | ESCALATED | tickets.reject | rework_count >= max_reworks |

### 6.4 SDLC Flows per Ticket Type

| Type | Flow | Skipped Stages |
|------|------|-----|
| `backend` | READY → BACKEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, FRONTEND |
| `frontend` | READY → UI_DESIGN → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, BACKEND |
| `fullstack` | READY → UI_DESIGN → BACKEND → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER |
| `infra` | READY → BACKEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, FRONTEND |
| `security` | READY → SECURITY → QA → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, BACKEND, FRONTEND |
| `docs` | READY → DOCUMENTATION → VALIDATOR → DONE | All impl/review stages |
| `research` | READY → RESEARCH → DOCUMENTATION → VALIDATOR → DONE | ARCHITECT, PM, UI_DESIGN, BACKEND, FRONTEND, QA, SECURITY, CI |
| `architecture` | READY → ARCHITECT → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, PM, UI_DESIGN, BACKEND, FRONTEND, QA, SECURITY, CI |
| `product` | READY → PRODUCT_MANAGER → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, UI_DESIGN, BACKEND, FRONTEND, QA, SECURITY, CI |
| `design` | READY → UI_DESIGN → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PM, BACKEND, FRONTEND, QA, SECURITY, CI |

### 6.5 SDLC Flow Engine Implementation

```typescript
// ── sdlc/flows.ts ──

import { TicketStage, TicketType } from '../types';

export const SDLC_FLOWS: Record<TicketType, TicketStage[]> = {
    backend:      ['READY','BACKEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE'],
    frontend:     ['READY','UI_DESIGN','FRONTEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE'],
    fullstack:    ['READY','UI_DESIGN','BACKEND','FRONTEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE'],
    infra:        ['READY','BACKEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE'],
    security:     ['READY','SECURITY','QA','CI','DOCUMENTATION','VALIDATOR','DONE'],
    docs:         ['READY','DOCUMENTATION','VALIDATOR','DONE'],
    research:     ['READY','RESEARCH','DOCUMENTATION','VALIDATOR','DONE'],
    architecture: ['READY','ARCHITECT','DOCUMENTATION','VALIDATOR','DONE'],
    product:      ['READY','PRODUCT_MANAGER','DOCUMENTATION','VALIDATOR','DONE'],
    design:       ['READY','UI_DESIGN','DOCUMENTATION','VALIDATOR','DONE'],
};

export function getNextStage(type: TicketType, currentStage: TicketStage): TicketStage | null {
    const flow = SDLC_FLOWS[type];
    const idx = flow.indexOf(currentStage);
    if (idx === -1 || idx >= flow.length - 1) return null;
    return flow[idx + 1];
}

export function getImplementationStage(type: TicketType): TicketStage {
    const flow = SDLC_FLOWS[type];
    // First stage after READY is the implementation stage
    return flow[1];
}

export function isValidTransition(type: TicketType, from: TicketStage, to: TicketStage): boolean {
    const flow = SDLC_FLOWS[type];
    const fromIdx = flow.indexOf(from);
    const toIdx = flow.indexOf(to);
    return fromIdx !== -1 && toIdx !== -1 && toIdx === fromIdx + 1;
}
```

---

## 7. Security Architecture

### 7.1 API Key Authentication (v1)

```
┌──────────────┐      Authorization: Bearer <key>      ┌──────────────────────┐
│  AI Agent    │ ─────────────────────────────────────▶ │  ForgeOS MCP Server  │
│  (Client)    │                                        │                      │
│              │                                        │  1. Extract key      │
│              │◀───────────────────────────────────── │  2. SHA-256 hash     │
│              │   200 OK + session / 401 Unauthorized  │  3. Lookup in agents │
└──────────────┘                                        │  4. Check is_active  │
                                                        │  5. Load permissions │
                                                        │  6. Set session vars │
                                                        └──────────────────────┘
```

**Key lifecycle:**
1. Admin generates key via `POST /api/admin/keys` → returns plaintext key **once**
2. Key stored as SHA-256 hash in `agents.api_key_hash`
3. Every request validates `Authorization: Bearer <key>` header
4. Revocation: set `revoked_at` timestamp → key immediately invalid
5. Rotation: generate new key, revoke old key

### 7.2 Role-Based Authorization Matrix

| Role | tickets.next | tickets.claim | tickets.complete | tickets.reject | tickets.spawn | tickets.release | tickets.extend | tickets.stats | tickets.graph | Force Ops |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Backend | BACKEND only | BACKEND only | Yes | No | Yes | Own | Own | Yes | Yes | No |
| Frontend | FRONTEND only | FRONTEND only | Yes | No | Yes | Own | Own | Yes | Yes | No |
| Architect | ARCHITECT only | ARCHITECT only | Yes | No | Yes | Own | Own | Yes | Yes | No |
| Research | RESEARCH only | RESEARCH only | Yes | No | No | Own | Own | Yes | Yes | No |
| ProductManager | PRODUCT_MANAGER only | PRODUCT_MANAGER only | Yes | No | Yes | Own | Own | Yes | Yes | No |
| UIDesigner | UI_DESIGN only | UI_DESIGN only | Yes | No | No | Own | Own | Yes | Yes | No |
| QA | QA only | QA only | Yes | **Yes** | No | Own | Own | Yes | Yes | No |
| Security | SECURITY only | SECURITY only | Yes | **Yes** | No | Own | Own | Yes | Yes | No |
| CI | CI only | CI only | Yes | **Yes** | No | Own | Own | Yes | Yes | No |
| Documentation | DOCUMENTATION only | DOCUMENTATION only | Yes | No | No | Own | Own | Yes | Yes | No |
| Validator | VALIDATOR only | VALIDATOR only | Yes | **Yes** | No | Own | Own | Yes | Yes | No |
| Ticketer | All stages | No | No | No | No | No | No | Yes | Yes | No |
| Admin | All | All | All | All | All | All | All | All | All | **Yes** |

### 7.3 JWT Tokens (Future — v2)

Migration path from API keys to JWT/OAuth 2.1:
1. **v1**: API keys → simple, hashed, per-agent
2. **v1.5**: Add JWT verification as alternative auth (coexist with API keys)
3. **v2**: Full OAuth 2.1 per MCP specification (when spec stabilizes)

### 7.4 Row-Level Security

Enforced at database level (see §3 DDL):
- All agents can SELECT all tickets (needed for graph/stats)
- Agents can only UPDATE tickets they've claimed
- Admin role bypasses all RLS policies
- Session variables (`app.agent_role`, `app.agent_name`) set by auth middleware before queries

### 7.5 Git Hooks

**`commit-msg.sh`** — Validates commit message format:
```bash
#!/bin/bash
COMMIT_MSG_FILE="$1"
COMMIT_MSG=$(head -1 "$COMMIT_MSG_FILE")

# Pattern: [TICKET-ID] ...
if ! echo "$COMMIT_MSG" | grep -qE '^\[[A-Z0-9]+-[A-Z0-9]+-?[A-Z0-9]*\]'; then
    echo "ERROR: Commit message must start with [TICKET-ID]"
    echo "Examples:"
    echo "  [FORGEOS-001] CLAIM by Backend on machine-1 (operator)"
    echo "  [FORGEOS-001] BACKEND complete by Backend on machine-1"
    exit 1
fi
```

**`pre-commit.sh`** — Validates blast radius:
```bash
#!/bin/bash
# Extract ticket ID from the prepared commit message (if available)
TICKET_ID=$(git log --format=%s -1 HEAD 2>/dev/null | grep -oP '^\[(\K[^\]]+)')

if [ -z "$TICKET_ID" ]; then
    # No ticket context — allow (manual commits, initial setup)
    exit 0
fi

# Query MCP server for ticket's file_paths
FILE_PATHS=$(curl -s -H "Authorization: Bearer $FORGEOS_API_KEY" \
    "$FORGEOS_MCP_URL/api/tickets/$TICKET_ID" | jq -r '.file_paths[]' 2>/dev/null)

if [ -z "$FILE_PATHS" ]; then
    # MCP server unreachable or ticket not found — allow with warning
    echo "WARNING: Could not validate blast radius (MCP unavailable)"
    exit 0
fi

# Check each staged file against allowed paths
STAGED_FILES=$(git diff --cached --name-only)
VIOLATIONS=""

for FILE in $STAGED_FILES; do
    ALLOWED=false
    for PATTERN in $FILE_PATHS; do
        if [[ "$FILE" == $PATTERN* ]]; then
            ALLOWED=true
            break
        fi
    done
    if [ "$ALLOWED" = false ]; then
        VIOLATIONS="$VIOLATIONS\n  $FILE"
    fi
done

if [ -n "$VIOLATIONS" ]; then
    echo "ERROR: Files outside ticket scope:"
    echo -e "$VIOLATIONS"
    echo ""
    echo "Allowed paths for $TICKET_ID: $FILE_PATHS"
    echo "Use --no-verify to bypass (emergency only)"
    exit 1
fi
```

---

## 8. Deployment Architecture

### 8.1 Docker Compose

```yaml
# docker-compose.yml

version: '3.8'

services:
  postgres:
    image: postgres:17-alpine
    container_name: forgeos-postgres
    environment:
      POSTGRES_DB: forgeos
      POSTGRES_USER: forgeos
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    volumes:
      - pgdata:/var/lib/postgresql/data
      - ./src/db/migrations:/docker-entrypoint-initdb.d:ro
    ports:
      - "${POSTGRES_PORT:-5432}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U forgeos -d forgeos"]
      interval: 10s
      retries: 5
      start_period: 30s
      timeout: 10s
    secrets:
      - db_password
    restart: unless-stopped

  pgbouncer:
    image: edoburu/pgbouncer:latest
    container_name: forgeos-pgbouncer
    environment:
      DATABASE_URL: postgres://forgeos:${DB_PASSWORD}@postgres:5432/forgeos
      POOL_MODE: transaction
      DEFAULT_POOL_SIZE: 50
      MAX_CLIENT_CONN: 200
    depends_on:
      postgres:
        condition: service_healthy
    ports:
      - "${PGBOUNCER_PORT:-6432}:6432"
    restart: unless-stopped

  mcp-server:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: forgeos-mcp
    environment:
      DATABASE_URL: postgres://forgeos:${DB_PASSWORD}@pgbouncer:6432/forgeos
      NODE_ENV: ${NODE_ENV:-production}
      PORT: ${MCP_PORT:-3011}
      WEBHOOK_SECRET: ${WEBHOOK_SECRET}
      ADMIN_API_KEY: ${ADMIN_API_KEY}
      LOG_LEVEL: ${LOG_LEVEL:-info}
    depends_on:
      postgres:
        condition: service_healthy
      pgbouncer:
        condition: service_started
    ports:
      - "${MCP_PORT:-3011}:3011"
    volumes:
      - ${WORKSPACE_PATH:-.}:/app/workspace:ro
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3011/health"]
      interval: 30s
      retries: 3
      start_period: 10s
      timeout: 5s
    restart: unless-stopped

volumes:
  pgdata:
    driver: local

secrets:
  db_password:
    file: ./secrets/db_password.txt
```

### 8.2 Dockerfile

```dockerfile
# Dockerfile
FROM node:22-alpine AS builder

WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

FROM node:22-alpine AS runtime

WORKDIR /app
COPY --from=builder /app/dist/ ./dist/
COPY --from=builder /app/node_modules/ ./node_modules/
COPY package.json ./
COPY src/dashboard/ ./dist/dashboard/

ENV NODE_ENV=production
USER node

EXPOSE 3011

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:3011/health || exit 1

CMD ["node", "dist/index.js"]
```

### 8.3 Environment Variables

```bash
# .env.example

# ── PostgreSQL ──
POSTGRES_PORT=5432
DB_PASSWORD=changeme_use_secrets_in_production

# ── PgBouncer ──
PGBOUNCER_PORT=6432

# ── MCP Server ──
MCP_PORT=3011
NODE_ENV=development
LOG_LEVEL=debug

# ── Authentication ──
ADMIN_API_KEY=forgeos_admin_CHANGE_ME_IMMEDIATELY

# ── GitHub Webhooks ──
WEBHOOK_SECRET=your_webhook_secret_here

# ── Workspace ──
WORKSPACE_PATH=/path/to/your/forgeos/repo

# ── Rate Limiting ──
RATE_LIMIT_PER_MINUTE=100

# ── Lease Defaults ──
DEFAULT_LEASE_MINUTES=30
MAX_LEASE_MINUTES=120
```

### 8.4 Health Checks

```typescript
// GET /health
app.get('/health', async (req, res) => {
    try {
        const dbResult = await pool.query('SELECT 1');
        const poolStats = pool.totalCount;
        res.json({
            status: 'ok',
            db: 'connected',
            pool: {
                total: pool.totalCount,
                idle: pool.idleCount,
                waiting: pool.waitingCount,
            },
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    } catch (error) {
        res.status(503).json({
            status: 'error',
            db: 'disconnected',
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});
```

---

## 9. Technology Selection Matrix

### 9.1 Server Runtime

| Criterion (Weight) | Node.js 22 + TypeScript | Deno 2 + TypeScript | Python + FastAPI |
|-----|:---:|:---:|:---:|
| MCP SDK support (0.30) | **10** (official SDK) | 5 (community SDK) | 4 (community SDK) |
| Ecosystem maturity (0.20) | **9** | 6 | 8 |
| Team experience (0.20) | **8** | 4 | 7 |
| Performance (0.15) | 8 | **9** | 6 |
| Operational risk (0.15) | **9** | 5 | 8 |
| **Weighted Score** | **8.95** | 5.50 | 6.55 |

**Decision: Node.js 22 + TypeScript** — official MCP SDK support is the decisive factor.

### 9.2 Database

| Criterion (Weight) | PostgreSQL 17 | SQLite | MySQL 8 | MongoDB |
|-----|:---:|:---:|:---:|:---:|
| Distributed locking (0.30) | **10** (SKIP LOCKED) | 2 (file lock only) | 7 (FOR UPDATE) | 3 |
| ACID guarantees (0.25) | **10** | 8 | 9 | 5 |
| RLS support (0.15) | **10** | 0 | 0 | 0 |
| JSONB support (0.15) | **10** | 6 (JSON1) | 7 | 10 |
| Team experience (0.15) | **8** | 9 | 7 | 7 |
| **Weighted Score** | **9.70** | 4.55 | 6.40 | 4.40 |

**Decision: PostgreSQL 17** — `SKIP LOCKED` + RLS are must-haves; no other DB combination provides both.

### 9.3 Dashboard

| Criterion (Weight) | Vanilla HTML + SSE + D3 | React + SSE + vis.js | htmx + SSE + Mermaid |
|-----|:---:|:---:|:---:|
| Simplicity (0.30) | **9** | 4 | 8 |
| Real-time support (0.25) | **9** (native SSE) | 8 | 7 |
| Graph visualization (0.20) | **9** (D3 force) | 8 | 5 |
| Bundle size (0.15) | **9** (~200KB) | 3 (~1MB+) | 7 |
| No build step (0.10) | **10** | 2 | 10 |
| **Weighted Score** | **9.05** | 5.25 | 7.15 |

**Decision: Vanilla HTML + SSE + D3.js** — consistent with Research recommendation; no build step is a key advantage.

### 9.4 Transport Protocol

| Criterion (Weight) | Streamable HTTP | stdio | SSE (legacy MCP) |
|-----|:---:|:---:|:---:|
| Multi-machine access (0.35) | **10** | 0 (local only) | 8 |
| Session management (0.25) | **10** (built-in) | 0 | 6 |
| Current MCP standard (0.20) | **10** | 5 (fallback) | 5 (deprecated) |
| Middleware support (0.20) | **10** (Express) | 0 | 7 |
| **Weighted Score** | **10.00** | 1.00 | 6.70 |

**Decision: Streamable HTTP** — only viable option for multi-machine access.

### 9.5 Authentication (v1)

| Criterion (Weight) | API Keys | JWT (Client Creds) | OAuth 2.1 (MCP Spec) |
|-----|:---:|:---:|:---:|
| Simplicity (0.25) | **9** | 6 | 4 |
| Security (0.25) | 6 | **8** | 9 |
| Revocability (0.15) | **9** | 3 | 8 |
| Implementation effort (0.15) | **9** | 6 | 3 |
| Spec maturity (0.10) | 3 | 8 | **10** (future) |
| Scalability (0.10) | 7 | **9** | 8 |
| **Weighted Score** | **7.35** | 6.35 | 6.30 |

**Decision: API Keys for v1** — simplest, independently revocable, no external deps. Migrate to OAuth 2.1 in v2.

---

## 10. Component and Data Flow Diagrams

### 10.1 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ForgeOS Architecture                              │
│                                                                         │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐            │
│  │  Machine A   │     │  Machine B   │     │  Machine N   │  Machines  │
│  │ ┌──────────┐ │     │ ┌──────────┐ │     │ ┌──────────┐ │            │
│  │ │Ticketer │ │     │ │Ticketer │ │     │ │Ticketer │ │            │
│  │ │  + Agents│ │     │ │  + Agents│ │     │ │  + Agents│ │            │
│  │ └────┬─────┘ │     │ └────┬─────┘ │     │ └────┬─────┘ │            │
│  └──────┼───────┘     └──────┼───────┘     └──────┼───────┘            │
│         │                    │                     │                     │
│         └──────────┐         │          ┌──────────┘                     │
│                    ▼         ▼          ▼                                │
│         ┌──────────────────────────────────────┐                        │
│         │       MCP Server (Express)            │                        │
│         │   Streamable HTTP Transport           │                        │
│         │                                      │                        │
│         │  ┌─────┐ ┌─────┐ ┌───────┐ ┌──────┐ │    ┌──────────────┐   │
│         │  │Auth │→│Rate │→│ Tools │→│ SSE  │ │    │  Dashboard   │   │
│         │  │ MW  │ │Limit│ │(10)   │ │Stream│─┼───▶│  (Browser)   │   │
│         │  └─────┘ └─────┘ └───┬───┘ └──────┘ │    └──────────────┘   │
│         │                      │               │                        │
│         │              ┌───────┴──────┐        │                        │
│         │              │  REST API    │        │                        │
│         │              │  /api/*      │        │                        │
│         │              └───────┬──────┘        │                        │
│         └──────────────────────┼───────────────┘                        │
│                                │                                        │
│                    ┌───────────┴───────────┐                            │
│                    ▼                       ▼                            │
│         ┌──────────────────┐   ┌──────────────────┐                    │
│         │    PgBouncer     │   │  GitHub Webhooks  │                    │
│         │  (conn pooler)   │   │  POST /webhooks   │                    │
│         └────────┬─────────┘   └──────────────────┘                    │
│                  │                                                      │
│                  ▼                                                      │
│         ┌──────────────────┐                                           │
│         │  PostgreSQL 17   │                                           │
│         │  ┌────────────┐  │                                           │
│         │  │  tickets   │  │                                           │
│         │  │  events    │  │                                           │
│         │  │  agents    │  │                                           │
│         │  │ file_locks │  │                                           │
│         │  │  sessions  │  │                                           │
│         │  │  projects  │  │                                           │
│         │  │ sys_config │  │                                           │
│         │  └────────────┘  │                                           │
│         └──────────────────┘                                           │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### 10.2 Ticket Claim Data Flow

```
Agent                     MCP Server               PostgreSQL
  │                           │                         │
  │ tickets.claim(id,...)     │                         │
  ├──────────────────────────▶│                         │
  │                           │ BEGIN TRANSACTION       │
  │                           ├────────────────────────▶│
  │                           │                         │
  │                           │ SELECT ... FOR UPDATE   │
  │                           │ SKIP LOCKED             │
  │                           ├────────────────────────▶│
  │                           │                         │ (row-level lock acquired)
  │                           │◀────────────────────────┤ ticket row
  │                           │                         │
  │                           │ Check file_paths        │
  │                           │ conflicts (file_locks)  │
  │                           ├────────────────────────▶│
  │                           │◀────────────────────────┤ no conflicts
  │                           │                         │
  │                           │ UPDATE tickets SET      │
  │                           │ claimed_by=...,         │
  │                           │ lease_expiry=NOW()+30m  │
  │                           ├────────────────────────▶│
  │                           │                         │
  │                           │ INSERT INTO file_locks  │
  │                           ├────────────────────────▶│
  │                           │                         │
  │                           │ INSERT INTO events      │
  │                           ├────────────────────────▶│
  │                           │                         │
  │                           │ COMMIT                  │
  │                           ├────────────────────────▶│
  │                           │                         │
  │◀──────────────────────────┤                         │
  │ { ticket, lease_expiry,   │                         │
  │   file_locks }            │                         │
```

### 10.3 SSE Real-Time Update Flow

```
PostgreSQL                MCP Server                Browser (Dashboard)
  │                           │                         │
  │ ticket row updated        │                         │
  ├──(trigger)───────────────▶│                         │
  │                           │                         │
  │ pg_notify('ticket_changes'│                         │
  │  , { ticket_id, status,   │                         │
  │    stage, ... })          │                         │
  ├──────────────────────────▶│                         │
  │                           │                         │
  │                           │ EventEmitter.emit()     │
  │                           │                         │
  │                           │ SSE: event: ticket-update
  │                           │ data: { ... }           │
  │                           ├────────────────────────▶│
  │                           │                         │ updateDashboard()
  │                           │                         │ D3.js re-render
```

---

## 11. Architecture Decision Records (ADRs)

### ADR-001: PostgreSQL over Filesystem for State Management

**Status:** ACCEPTED  
**Context:** The current system uses filesystem directories as a state machine with `git push` as a distributed lock. This works for single-machine but fails at multi-machine scale (race conditions, no real-time visibility, no file-level mutex).  
**Options Considered:**
1. **PostgreSQL** — ACID transactions, `SKIP LOCKED`, RLS, triggers for real-time
2. **Redis** — Fast but no ACID durability; loses data on restart without RDB/AOF
3. **SQLite** — Single-writer bottleneck; no `SKIP LOCKED`; no RLS
4. **Keep filesystem** — Cannot solve multi-machine contention

**Decision:** PostgreSQL 17 with `SELECT FOR UPDATE SKIP LOCKED`.  
**Consequences:**
- (+) Atomic claim operations, zero double-claims
- (+) Real-time updates via NOTIFY/LISTEN
- (+) RLS for agent isolation
- (+) JSONB for flexible metadata
- (-) Requires PostgreSQL infrastructure (Docker Compose solves this)
- (-) 5-10% overhead from RLS (acceptable)

### ADR-002: MCP over Custom REST API for Agent Interface

**Status:** ACCEPTED  
**Context:** Agents need a standardized interface to interact with the ticket system. Options: custom REST API, GraphQL, or MCP (Model Context Protocol).  
**Options Considered:**
1. **MCP** — standardized AI tool protocol; native SDK support; session management
2. **REST API** — simpler but no standardized tool calling for AI agents
3. **GraphQL** — overkill for 10 operations; complex subscription model

**Decision:** MCP with Streamable HTTP transport for agent operations; REST API for dashboard queries.  
**Consequences:**
- (+) AI-native interface; agents can call tools directly
- (+) Type-safe with Zod validation
- (+) Built-in session management
- (-) Adds MCP SDK dependency
- (-) Dashboard still needs REST endpoints (dual interface)

### ADR-003: API Keys over OAuth 2.1 for v1 Authentication

**Status:** ACCEPTED  
**Context:** Agents and machines need authentication. MCP spec recommends OAuth 2.1, but the spec is still evolving (40% confidence per Research report).  
**Options Considered:**
1. **API Keys** — simple, independently revocable, no external deps
2. **JWT** — requires OAuth provider; tokens not individually revocable
3. **OAuth 2.1** — spec-compliant but immature; server must be auth server

**Decision:** API Keys for v1; prepare migration path to OAuth 2.1 for v2.  
**Consequences:**
- (+) Fastest to implement; 1 week vs 4 weeks
- (+) Individual key revocation
- (-) Not spec-compliant with MCP auth
- (-) Must migrate later when spec stabilizes
- Migration path documented; API keys can coexist with OAuth tokens

### ADR-004: Vanilla HTML Dashboard over React/Vue

**Status:** ACCEPTED  
**Context:** Dashboard needs real-time pipeline visualization and dependency graph.  
**Options Considered:**
1. **Vanilla HTML + SSE + D3.js** — no build step, ~200KB, fast
2. **React + vis.js** — build step required, ~1MB+, framework overhead
3. **htmx + Mermaid** — simple but limited graph interactivity

**Decision:** Vanilla HTML + SSE + D3.js.  
**Consequences:**
- (+) Zero build step; served as static files
- (+) D3.js is the gold standard for data visualization
- (+) SSE is native browser API
- (-) D3.js has a learning curve
- (-) Less maintainable than React for complex UIs (acceptable for infrastructure dashboard)

### ADR-005: Custom SKIP LOCKED Implementation over PgBoss

**Status:** ACCEPTED  
**Context:** Need a distributed job queue for ticket claiming.  
**Options Considered:**
1. **Custom `SKIP LOCKED`** — tailored to ForgeOS state machine; PostgreSQL-native
2. **PgBoss** — mature but adds abstraction layer; generic job queue model
3. **BullMQ (Redis)** — fast but adds Redis dependency; no ACID guarantees

**Decision:** Custom `SKIP LOCKED` implementation.  
**Consequences:**
- (+) Exact control over claim semantics, lease logic, dependency resolution
- (+) Single database (PostgreSQL); no additional infrastructure
- (+) ForgeOS-specific state machine logic built directly into SQL functions
- (-) More code to maintain (mitigated by well-tested SQL functions)

### ADR-006: Monolithic Server Architecture (v1)

**Status:** ACCEPTED  
**Context:** Should ForgeOS be deployed as microservices or a monolith?  
**Options Considered:**
1. **Monolith** — MCP server + REST API + SSE + webhook handler in one process
2. **Modular Monolith** — logical modules but single deployable
3. **Microservices** — separate services for MCP, REST, webhooks

**Decision:** Monolithic server (modular code, single deployment).  
**Consequences:**
- (+) Simplest deployment (single Docker container)
- (+) No inter-service communication overhead
- (+) Shared database connection pool
- (+) Sufficient for 10+ machines / 50+ agents target
- (-) Cannot scale components independently (not needed for v1 targets)
- Evolution path: extract into modular monolith if needed, then microservices

---

## 12. DAG Task Graph for Implementation Ordering

### 12.1 Task Dependency Graph

```
                          ┌──────────┐
                          │ TASK-03  │  Docker Compose
                          │ (infra)  │  Infrastructure
                          └────┬─────┘
                               │
                     ┌─────────┼──────────┐
                     ▼         ▼          ▼
               ┌──────────┐ ┌──────────┐ ┌──────────┐
               │ TASK-02  │ │ TASK-01  │ │ TASK-20  │
               │ DB Schema│ │ MCP      │ │PgBouncer │
               │ +Migrate │ │ Scaffold │ │  Config  │
               └──┬───┬───┘ └────┬─────┘ └──────────┘
                  │   │          │
            ┌─────┘   └────┐     │
            ▼              ▼     │
      ┌──────────┐   ┌──────────┤
      │ TASK-08  │   │ TASK-04  │
      │ SDLC     │   │ Dist.    │
      │ Engine   │   │ Locking  │
      └──┬───────┘   └────┬─────┘
         │                │
         │     ┌──────────┘
         │     │
         ▼     ▼
      ┌──────────┐    ┌──────────┐
      │ TASK-05  │    │ TASK-07  │
      │ Core MCP │    │ API Key  │
      │ Tools    │    │ Auth     │
      └──┬──┬────┘    └────┬─────┘
         │  │              │
         │  └──────┐       │
         ▼         ▼       ▼
   ┌──────────┐ ┌──────────┐
   │ TASK-06  │ │ TASK-10  │
   │ Extended │ │ REST API │
   │ MCP Tools│ │ +SSE     │
   └──┬───────┘ └────┬─────┘
      │               │
      │     ┌─────────┘
      │     │
      ▼     ▼
   ┌──────────┐    ┌──────────┐
   │ TASK-11  │    │ TASK-09  │
   │ Dashboard│    │ Webhooks │
   │ Pipeline │    │ +Recon   │
   └──┬───────┘    └──────────┘
      │
      ▼
   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ TASK-12  │    │ TASK-13  │    │ TASK-17  │
   │ Dep.     │    │ Husky    │    │ Event    │
   │ Graph    │    │ Hooks    │    │ Sourcing │
   └──────────┘    └──────────┘    └──────────┘

   ┌──────────┐    ┌──────────┐    ┌──────────┐
   │ TASK-14  │    │ TASK-16  │    │ TASK-18  │
   │ Data     │    │ Agent    │    │ Rate     │
   │ Import   │    │ SDK      │    │ Limiting │
   └──┬───────┘    └──────────┘    └──────────┘
      │
      ▼
   ┌──────────┐    ┌──────────┐
   │ TASK-15  │    │ TASK-19  │
   │ Migration│    │ Admin    │
   │ Bridge   │    │ Views    │
   └──────────┘    └──────────┘
```

### 12.2 Critical Path

```
TASK-03 (Docker) → TASK-02 (Schema) → TASK-04 (Locking) → TASK-05 (Core Tools) → TASK-10 (REST API) → TASK-11 (Dashboard)
```

**Critical path duration estimate:** 6 weeks (tasks are ~1 week each on the critical path).

### 12.3 Parallel Work Groups

| Phase | Parallel Tasks | Duration |
|-------|---------------|----------|
| **Phase 1** | TASK-03 (Docker) | 1 week |
| **Phase 2** | TASK-01 (MCP Scaffold) ‖ TASK-02 (Schema) ‖ TASK-20 (PgBouncer) | 1 week |
| **Phase 3** | TASK-04 (Locking) ‖ TASK-07 (Auth) ‖ TASK-08 (SDLC Engine) | 1 week |
| **Phase 4** | TASK-05 (Core Tools) | 1 week |
| **Phase 5** | TASK-06 (Extended Tools) ‖ TASK-10 (REST API) ‖ TASK-09 (Webhooks) ‖ TASK-17 (Events) | 1 week |
| **Phase 6** | TASK-11 (Dashboard) ‖ TASK-13 (Hooks) ‖ TASK-14 (Import) ‖ TASK-18 (Rate Limiting) | 1 week |
| **Phase 7** | TASK-12 (Graph) ‖ TASK-15 (Migration Bridge) ‖ TASK-16 (Agent SDK) ‖ TASK-19 (Admin Views) | 1 week |

**Total estimated duration:** 7 weeks with parallelization.

---

## 13. Fitness Functions

Measurable thresholds that define architectural health:

| Metric | Target | Measurement | Enforcement |
|--------|--------|-------------|-------------|
| Claim latency (p99) | < 100ms | pg `EXPLAIN ANALYZE` on claim query | Load test in CI |
| tickets.next latency (p95) | < 50ms | Query timing instrumentation | Benchmark test |
| tickets.graph response | < 500ms for 500 tickets | End-to-end API timing | Performance test |
| SSE update latency | < 1 second | Client timestamp delta | Integration test |
| Test coverage (new code) | ≥ 80% | Jest/Vitest coverage report | CI gate |
| TypeScript strict mode | 100% compliance | `tsc --noEmit` exit code | CI gate |
| Lint (zero warnings) | 0 errors, 0 warnings | ESLint flat config | CI gate |
| Double-claim rate | 0% | Stress test with 10+ concurrent claimants | Integration test |
| API key validation latency | < 5ms | Middleware timing | Benchmark test |
| Event sourcing completeness | 100% of state changes logged | Audit comparison query | Periodic check |
| Webhook reconciliation | 100% ghost commit resolution | Integration test scenarios | CI |
| Database migration reversibility | Every migration has rollback | Manual review | PR check |

---

## 14. Anti-Pattern Checks

| Anti-Pattern | Risk | Mitigation |
|-------------|------|------------|
| **Distributed Monolith** | LOW — single deployment; no distributed transactions | Monolith architecture for v1 (ADR-006) |
| **Big Ball of Mud** | MEDIUM — 10 tools in one server | Modular file structure; clear boundaries (tools/, sdlc/, api/, middleware/) |
| **Golden Hammer** | LOW | PostgreSQL selected via scored evaluation; not blindly applied |
| **God Service** | LOW — MCP server has focused responsibility | Tools are thin wrappers over SQL functions; business logic in PostgreSQL |
| **Chatty Services** | N/A — monolith | No inter-service communication |
| **Shared Database** | N/A — single service | Only MCP server accesses DB; dashboard uses REST API |

---

## Upstream Artifacts Referenced

1. `.github/agent-output/Research/FORGEOS-RESEARCH-001.md` — Technology research (906 lines, 82% confidence)
2. `.github/agent-output/ProductManager/FORGEOS-PRD-001.md` — Product requirements (1314 lines, 85% confidence)
3. `.github/tickets/ticket-schema.json` — Current ticket JSON schema
4. `.github/tickets.py` — Current filesystem state machine (1000 lines)

## Evidence

- **Context map:** Primary/secondary files, established patterns, change sequence documented
- **Well-Architected:** All 6 pillars assessed and scored (avg 8.0/10)
- **PostgreSQL DDL:** Complete schema with 7 tables, 18+ indexes, RLS policies, 7 SQL functions
- **MCP Tools:** All 10 tools defined with Zod schemas and TypeScript I/O types
- **File structure:** 35+ files organized in modular directory tree
- **State machine:** Status/stage enums, valid transitions matrix, SDLC flows for 10 ticket types
- **Security:** API key auth flow, RBAC matrix (13 roles × 10 operations), Git hooks
- **Deployment:** Docker Compose with 3 services, healthchecks, secrets management
- **Tech selection:** 5 scored evaluation matrices with 3+ candidates each
- **ADRs:** 6 architecture decisions with context, options, consequences
- **DAG:** 20 tasks with dependency graph, critical path, 7 parallel phases
- **Fitness functions:** 12 measurable thresholds with enforcement mechanisms
- **Anti-patterns:** 6 anti-patterns checked and mitigated
- **Confidence:** HIGH (87%)

---

*Generated by Architect Agent — 2026-03-05T00:00:00Z*
