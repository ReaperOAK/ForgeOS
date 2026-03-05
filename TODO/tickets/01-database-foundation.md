# Database Foundation Tickets

## TASK-FOS-01-001: PostgreSQL Schema — Initial Migration

**Type:** backend
**Priority:** critical
**Dependencies:**
**Files:** forgeos-server/src/db/migrations/001_initial.sql

### Description
Create the initial PostgreSQL migration file containing the complete DDL for ForgeOS. This includes all 7 tables (projects, agents, sessions, tickets, file_locks, events, system_config), 5 enum types (ticket_status, ticket_stage, ticket_type, ticket_priority, event_type), all indexes (GIN on arrays/JSONB, composite on stage+status, partial indexes for claimable tickets and expired leases), Row-Level Security policies, 8 SQL functions (claim_ticket, claim_ticket_by_id, advance_ticket, reject_ticket, release_ticket, extend_lease, resolve_dependencies, release_expired_claims), the update_updated_at trigger, and the notify_ticket_change trigger for SSE real-time updates via pg_notify. Schema must match the Architecture document §3 specification exactly.

### Acceptance Criteria
- [ ] All 7 tables created with proper column types, constraints, and defaults matching Architecture §3
- [ ] 5 PostgreSQL enum types defined (ticket_status, ticket_stage, ticket_type, ticket_priority, event_type)
- [ ] GIN indexes on tickets.depends_on, tickets.file_paths, tickets.tags, tickets.metadata
- [ ] Composite index idx_tickets_claimable on (stage, priority DESC, created_at ASC) WHERE status='READY' AND claimed_by IS NULL
- [ ] Partial unique index on file_locks(file_path) WHERE released_at IS NULL for mutex enforcement
- [ ] RLS enabled on tickets, events, and file_locks with admin bypass and agent scoped policies
- [ ] claim_ticket function uses SELECT FOR UPDATE SKIP LOCKED and returns the claimed ticket row
- [ ] advance_ticket function validates SDLC flow ordering, releases file locks, and calls resolve_dependencies on DONE
- [ ] reject_ticket function increments rework_count and escalates when >= max_reworks
- [ ] notify_ticket_change trigger fires pg_notify on ticket INSERT/UPDATE for SSE streaming
- [ ] system_config table seeded with default_lease_minutes=30, max_lease_minutes=120, rate_limit_per_minute=100
- [ ] Migration is idempotent (uses CREATE IF NOT EXISTS, CREATE OR REPLACE where appropriate)

---

## TASK-FOS-01-002: Database Connection Pool and Migration Runner

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-FOS-01-001, TASK-FOS-02-001
**Files:** forgeos-server/src/db/pool.ts, forgeos-server/src/db/migrate.ts, forgeos-server/src/db/index.ts

### Description
Implement the PostgreSQL connection pool singleton using node-postgres (pg.Pool) with configurable pool size, idle timeout, and connection timeout. Include a health check query function that validates database connectivity. Build a migration runner that reads SQL files from the migrations directory, tracks applied migrations in a schema_migrations table, and supports both up and down migrations. The pool must set PostgreSQL session variables (app.agent_role, app.agent_name, app.agent_id) for RLS enforcement when executing queries on behalf of authenticated agents.

### Acceptance Criteria
- [ ] pg.Pool singleton created with configurable max connections (default 20), idle timeout (30s), and connection timeout (10s)
- [ ] getPool() function returns the singleton pool instance; pool is lazily initialized on first call
- [ ] healthCheck() function executes SELECT 1 and returns pool stats (total, idle, waiting counts)
- [ ] Migration runner reads .sql files from src/db/migrations/ in lexicographic order
- [ ] schema_migrations table tracks migration name, applied_at timestamp, and checksum
- [ ] Migration runner skips already-applied migrations (idempotent re-runs)
- [ ] setSessionContext(client, agentRole, agentName, agentId) sets PostgreSQL session variables for RLS
- [ ] Pool emits structured log events for connection errors, pool exhaustion, and slow queries

---

## TASK-FOS-01-003: Seed Data and Filesystem Import Tool

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-FOS-01-001, TASK-FOS-01-002
**Files:** forgeos-server/src/db/seed.ts, forgeos-server/src/db/import.ts, forgeos-server/scripts/import-tickets.ts

### Description
Build a seed script that populates the database with initial data: default project entry, system configuration defaults, and an admin agent with a generated API key. Build an import tool that reads existing .github/tickets/*.json files and .github/ticket-state/ directory structure, maps directory location to current stage, preserves ticket history from JSON history arrays, validates imported data against the schema, and produces an import summary report. The import must be idempotent — re-running it does not create duplicates (uses ON CONFLICT DO UPDATE).

### Acceptance Criteria
- [ ] seed.ts creates a default project named "ForgeOS" with repo_url and default lease settings
- [ ] seed.ts creates an admin agent with a generated API key; the plaintext key is printed exactly once to stdout
- [ ] import.ts reads all .github/tickets/*.json files (excluding ticket-schema.json) and inserts them into the tickets table
- [ ] Import derives current stage from .github/ticket-state/ directory location for each ticket
- [ ] Import preserves the history array from each ticket JSON as events in the events table
- [ ] Import is idempotent — uses ON CONFLICT (ticket_id) DO UPDATE to avoid duplicates
- [ ] Import produces a summary: {success: N, errors: N, skipped: N} printed to stdout
- [ ] scripts/import-tickets.ts is a CLI entry point that runs seed + import in sequence
