# Phase 2 — Database Layer L3 Tickets

Source blocks: BLK-05-01 (Database Schema & Migrations), BLK-05-02 (Distributed Locking Implementation), BLK-05-03 (Connection Pooling & Event History)

---

## FORGEOS-BE001: Initialize Alembic Migration Framework

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-ARCH005, FORGEOS-DO002
**Files:** database/alembic.ini, database/alembic/env.py, database/alembic/script.py.mako
**Tags:** backend, database, migrations, alembic, phase2, BLK-05-01

### Description

Set up the Alembic migration framework for the ForgeOS PostgreSQL database. Initialize the Alembic project structure, configure the database connection string to read from environment variables, set up the migration environment with async support (asyncpg), and create the migration script template. The framework must support both upgrade and downgrade operations.

### Acceptance Criteria

- [ ] Alembic project initialized with alembic.ini, env.py, and script template
- [ ] Database connection string loaded from DATABASE_URL environment variable
- [ ] Migration environment supports async database connections via asyncpg
- [ ] `alembic upgrade head` runs without errors on a clean database
- [ ] `alembic downgrade -1` reverts the most recent migration
- [ ] `alembic history` displays migration chain correctly
- [ ] Migration script template includes both upgrade() and downgrade() functions

---

## FORGEOS-BE002: Create Core Tables Migration

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE001, FORGEOS-ARCH005
**Files:** database/alembic/versions/001_core_tables.py
**Tags:** backend, database, schema, tickets, claims, phase2, BLK-05-01

### Description

Create the initial Alembic migration that implements the core tables from the database schema design (ARCH005). Tables include: tickets (with JSONB fields for dependencies, file_paths, acceptance_criteria), claims (linking tickets to agents with lease tracking), agents (agent identity registry), machines (machine identity registry), and operators (human operator registry). Include all primary keys, foreign keys, and NOT NULL constraints.

### Acceptance Criteria

- [ ] Tickets table created with columns: ticket_id (PK), title, description, type, priority, stage, sdlc_flow (JSONB), dependencies (JSONB), file_paths (JSONB), acceptance_criteria (JSONB), rework_count, created_at, created_by
- [ ] Claims table created with columns: claim_id (PK), ticket_id (FK), agent_id (FK), machine_id (FK), operator, lease_expiry, claimed_at, released_at
- [ ] Agents table created with columns: agent_id (PK), agent_name, role, created_at
- [ ] Machines table created with columns: machine_id (PK), hostname, registered_at, last_seen
- [ ] Operators table created with columns: operator_id (PK), name, created_at
- [ ] All foreign key relationships correctly defined with appropriate ON DELETE behavior
- [ ] Migration downgrades cleanly, dropping all created tables

---

## FORGEOS-BE003: Create Event History and Audit Tables Migration

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE001, FORGEOS-ARCH007
**Files:** database/alembic/versions/002_event_tables.py
**Tags:** backend, database, schema, events, audit, phase2, BLK-05-01

### Description

Create the Alembic migration for event sourcing and audit trail tables from the event sourcing schema design (ARCH007). Tables include: event_history (immutable append-only log of all ticket state changes), stage_transitions (records each SDLC stage transition with metadata), and file_locks (tracks which files are locked by which ticket/agent). These tables replace the embedded history array in ticket JSON.

### Acceptance Criteria

- [ ] Event_history table created with columns: event_id (PK), ticket_id (FK), event_type, previous_state (JSONB), new_state (JSONB), agent_id, machine_id, timestamp, metadata (JSONB)
- [ ] Stage_transitions table created with columns: transition_id (PK), ticket_id (FK), from_stage, to_stage, triggered_by, reason, timestamp
- [ ] File_locks table created with columns: lock_id (PK), file_path, ticket_id (FK), agent_id (FK), acquired_at, released_at
- [ ] Event_history table enforces append-only semantics (no UPDATE or DELETE via application-level policy)
- [ ] All foreign keys reference the core tables from migration 001
- [ ] Migration downgrades cleanly, dropping all event/audit tables

---

## FORGEOS-BE004: Create Database Indexes and Constraints

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE002, FORGEOS-BE003, FORGEOS-ARCH006
**Files:** database/alembic/versions/003_indexes_constraints.py
**Tags:** backend, database, indexes, performance, phase2, BLK-05-01

### Description

Create the Alembic migration implementing the index strategy from the database index design (ARCH006). Add GIN indexes on JSONB columns (dependencies, file_paths) for containment queries, composite indexes on (stage, claimed_by) for efficient claim lookups, unique constraints on active claims, and partial indexes for common query patterns (e.g., tickets in READY stage only). Include CHECK constraints for enum-like columns.

### Acceptance Criteria

- [ ] GIN index on tickets.dependencies for @> containment queries
- [ ] GIN index on tickets.file_paths for overlap queries
- [ ] Composite index on (stage, type, priority) for filtered ticket listing
- [ ] Unique partial index ensuring one active claim per ticket (WHERE released_at IS NULL)
- [ ] Index on event_history(ticket_id, timestamp) for efficient history queries
- [ ] CHECK constraints on tickets.type and tickets.priority for valid enum values
- [ ] Migration downgrades cleanly, removing all added indexes and constraints

---

## FORGEOS-BE005: Create Database Seed Script for JSON Import

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE002
**Files:** database/seed.py, database/seed_data/sample_tickets.json
**Tags:** backend, database, seed, import, phase2, BLK-05-01

### Description

Create a database seeding script that imports existing ticket JSON files from .github/tickets/ into the PostgreSQL database. The script should read all ticket JSON files, validate them against the ticket schema, transform them into database records, and insert them with proper conflict handling (skip existing). Include sample test data for development environments.

### Acceptance Criteria

- [ ] Seed script reads all .github/tickets/*.json files and inserts into the tickets table
- [ ] Script validates each ticket against ticket-schema.json before insertion
- [ ] Duplicate ticket_ids are skipped with a warning (not an error)
- [ ] Script reports count of imported, skipped, and failed tickets
- [ ] Sample test data file provides at least 5 representative tickets for development
- [ ] Script can be run via `make seed` or `python database/seed.py`

---

## FORGEOS-BE006: Implement Ticket Claim Queue with SKIP LOCKED

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE002, FORGEOS-BE011
**Files:** mcp-server/src/locking/claim_queue.py, mcp-server/src/locking/__init__.py
**Tags:** backend, locking, claims, skipLocked, phase2, BLK-05-02

### Description

Implement the ticket claim queue using PostgreSQL SELECT FOR UPDATE SKIP LOCKED for fair, non-blocking claim semantics. This replaces the git-push-based distributed lock. The claim queue allows agents to atomically claim the next available ticket matching their role criteria, without blocking other agents from claiming different tickets concurrently.

### Acceptance Criteria

- [ ] Claim function atomically selects and locks the next available ticket using SKIP LOCKED
- [ ] Claim filters by ticket type and agent role compatibility
- [ ] Claims respect ticket dependencies (only READY tickets are claimable)
- [ ] Concurrent claim attempts on the same ticket result in exactly one winner, others transparently skip
- [ ] Claim creates a record in the claims table with agent_id, machine_id, and lease_expiry
- [ ] Function returns the claimed ticket data or None if no eligible tickets exist

---

## FORGEOS-BE007: Implement File-Level Advisory Lock Mutex

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE002, FORGEOS-BE011
**Files:** mcp-server/src/locking/file_mutex.py
**Tags:** backend, locking, advisory, mutex, phase2, BLK-05-02

### Description

Implement file-level mutual exclusion using PostgreSQL advisory locks (pg_advisory_xact_lock) keyed on file path hashes. This prevents two agents from modifying the same file concurrently. The advisory lock is transaction-scoped, automatically releasing when the transaction commits or rolls back.

### Acceptance Criteria

- [ ] Advisory lock function accepts a file path and acquires a transaction-scoped lock on its hash
- [ ] Hash function produces consistent int64 keys from file paths using a deterministic algorithm
- [ ] Try-lock variant (pg_try_advisory_xact_lock) returns immediately if lock is held by another session
- [ ] Lock is automatically released when the transaction ends (commit or rollback)
- [ ] File_locks table updated to track active locks for observability
- [ ] Concurrent lock attempts on the same file path correctly serialize or fail-fast

---

## FORGEOS-BE008: Implement Lease Heartbeat Mechanism

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE006
**Files:** mcp-server/src/locking/lease_heartbeat.py
**Tags:** backend, locking, lease, heartbeat, phase2, BLK-05-02

### Description

Implement a dynamic lease heartbeat mechanism that replaces the fixed 30-minute lease timeout from the git-based system. Agents send periodic heartbeats to extend their lease while actively working on a ticket. Heartbeat intervals and maximum lease duration are configurable. The mechanism writes heartbeat timestamps to the lease_heartbeats table.

### Acceptance Criteria

- [ ] Heartbeat function extends the lease_expiry for an active claim
- [ ] Heartbeat interval is configurable (default: 60 seconds)
- [ ] Maximum lease duration is configurable (default: 2 hours)
- [ ] Heartbeat rejects extension if the claim has already been released or reassigned
- [ ] Heartbeat writes a record to lease_heartbeats table with timestamp
- [ ] Missing heartbeats beyond the configured interval mark the lease as stale

---

## FORGEOS-BE009: Implement Expired Lease Detection and Release

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE008
**Files:** mcp-server/src/locking/lease_cleanup.py
**Tags:** backend, locking, lease, cleanup, phase2, BLK-05-02

### Description

Implement a background task that periodically scans for expired leases and releases them, making the associated tickets available for reclaim. This replaces the `--release-expired` CLI command in tickets.py. The cleanup task runs on a configurable interval and logs all automatic releases for audit.

### Acceptance Criteria

- [ ] Background task scans claims table for leases past their expiry time
- [ ] Expired claims are released by setting released_at and clearing the ticket's claim
- [ ] Released tickets are moved back to READY stage for reclaim
- [ ] Each automatic release is recorded in the event_history table
- [ ] Cleanup interval is configurable (default: 30 seconds)
- [ ] Task logs each release with ticket_id, agent_id, and time since last heartbeat

---

## FORGEOS-BE010: Configure Transaction Isolation per Operation

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE006
**Files:** mcp-server/src/locking/transaction_config.py
**Tags:** backend, locking, transactions, isolation, phase2, BLK-05-02

### Description

Configure appropriate PostgreSQL transaction isolation levels for different operation types. Claim operations use READ COMMITTED (with SKIP LOCKED for non-blocking semantics). State transitions (advance, rework) use SERIALIZABLE to prevent concurrent state corruption. Provide a transaction context manager that sets the isolation level per operation type.

### Acceptance Criteria

- [ ] Transaction context manager accepts an isolation level parameter
- [ ] Claim operations run under READ COMMITTED isolation
- [ ] State transition operations (advance, rework) run under SERIALIZABLE isolation
- [ ] Serialization failures trigger automatic retry with configurable retry count (default: 3)
- [ ] Each transaction type is documented with justification for its isolation level
- [ ] Transaction wrapper integrates with the asyncpg connection pool

---

## FORGEOS-BE011: Implement asyncpg Connection Pool

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE002, FORGEOS-DO002
**Files:** mcp-server/src/db/pool.py, mcp-server/src/db/__init__.py
**Tags:** backend, database, pool, asyncpg, phase2, BLK-05-03

### Description

Implement the database connection pool using asyncpg for the ForgeOS MCP server. Configure min/max connection limits, connection timeout, idle connection recycling, and pool lifecycle (initialize on server start, close on shutdown). The pool must be reusable across the entire server via dependency injection or a global accessor.

### Acceptance Criteria

- [ ] asyncpg connection pool initializes with configurable min_size and max_size
- [ ] Pool configuration loaded from environment variables (DATABASE_URL, POOL_MIN, POOL_MAX)
- [ ] Pool provides async context manager for acquiring and releasing connections
- [ ] Idle connections are recycled after a configurable timeout (default: 300 seconds)
- [ ] Pool initialization verifies database connectivity and fails fast with a clear error
- [ ] Pool exposes a close() method for clean shutdown

---

## FORGEOS-BE012: Implement Event Sourcing Subsystem

**Type:** backend
**Priority:** high
**Dependencies:** FORGEOS-BE003, FORGEOS-ARCH007
**Files:** mcp-server/src/events/event_store.py, mcp-server/src/events/__init__.py
**Tags:** backend, events, sourcing, audit, phase2, BLK-05-03

### Description

Implement the event sourcing subsystem that records every ticket state change as an immutable event in the event_history table. Every claim, advance, rework, release, and sync operation produces an event with the ticket's previous and new state snapshots, the acting agent, and operation metadata. Provide event replay capability for audit and debugging.

### Acceptance Criteria

- [ ] EventStore class provides append(ticket_id, event_type, prev_state, new_state, metadata) method
- [ ] Events are immutable once written (no update or delete operations)
- [ ] Event types include: CLAIMED, ADVANCED, REWORKED, RELEASED, SYNCED, CREATED, LEASE_EXPIRED
- [ ] Event replay function returns ordered event stream for a given ticket_id
- [ ] Events include agent_id, machine_id, and ISO8601 timestamp
- [ ] Bulk query support: list events by ticket, by agent, by time range

---

## FORGEOS-BE013: Implement Repository Pattern Data Access Layer

**Type:** backend
**Priority:** critical
**Dependencies:** FORGEOS-BE011
**Files:** mcp-server/src/repositories/ticket_repo.py, mcp-server/src/repositories/claim_repo.py, mcp-server/src/repositories/event_repo.py, mcp-server/src/repositories/__init__.py
**Tags:** backend, repository, dal, pattern, phase2, BLK-05-03

### Description

Implement the repository pattern data access layer that all higher-level services consume. Create repository classes for tickets (CRUD, filtering, stage queries), claims (create, release, find active), and events (append, query by ticket). Repositories accept a database connection/pool and encapsulate all SQL queries. Both sync and async interfaces must be supported.

### Acceptance Criteria

- [ ] TicketRepository provides: get_by_id, list_by_stage, list_by_type, create, update_stage, count_by_stage
- [ ] ClaimRepository provides: create_claim, release_claim, get_active_claim, list_expired_claims
- [ ] EventRepository provides: append_event, get_events_by_ticket, get_events_by_agent, get_events_by_timerange
- [ ] All repositories accept an asyncpg connection or pool via constructor injection
- [ ] SQL queries use parameterized statements (no string interpolation) to prevent SQL injection
- [ ] All repository methods have type hints and docstrings

---

## FORGEOS-BE014: Implement Connection Pool Health Monitoring

**Type:** backend
**Priority:** medium
**Dependencies:** FORGEOS-BE011
**Files:** mcp-server/src/db/health.py
**Tags:** backend, database, pool, health, monitoring, phase2, BLK-05-03

### Description

Implement health monitoring for the asyncpg connection pool. Track pool statistics (active connections, idle connections, waiting requests), detect unhealthy connections via periodic ping, and trigger connection recycling when connections become stale. Expose pool health as a structured report for the health check endpoint.

### Acceptance Criteria

- [ ] Pool health monitor reports: total, active, idle, and waiting connection counts
- [ ] Periodic ping detects and removes dead connections from the pool
- [ ] Stale connections (exceeding max_lifetime) are recycled automatically
- [ ] Health report includes pool saturation percentage and average wait time
- [ ] Health data is exposed as a dict suitable for JSON serialization in the /health endpoint
- [ ] Health monitoring runs as a lightweight background task without impacting pool performance
