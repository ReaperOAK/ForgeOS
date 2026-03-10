---
title: ForgeOS Database Schema Reference
type: Reference
audience: Backend Engineers, DevOps Engineers, Architects
last_reviewed: 2026-03-10T14:00:00Z  # Updated by Documentation Specialist 2026-03-10
migration_file: forgeos-server/src/db/migrations/001_initial.sql
migration_002: mcp-server/alembic/versions/20260310_000000_002_event_tables.py
migration_003_core: mcp-server/alembic/versions/20260310_000000_002_core_tables.py
migration_003_indexes: mcp-server/alembic/versions/20260310_000000_003_indexes_constraints.py
---

# ForgeOS Database Schema Reference


This document describes the PostgreSQL schema for the ForgeOS distributed orchestration engine. It covers all tables, enums, indexes, stored functions, triggers, Row-Level Security policies, and seed data defined in the initial migration ([001_initial.sql](../../forgeos-server/src/db/migrations/001_initial.sql)), the event sourcing migration ([002_event_tables.py](../../mcp-server/alembic/versions/20260310_000000_002_event_tables.py)), the core tables migration ([002_core_tables.py](../../mcp-server/alembic/versions/20260310_000000_002_core_tables.py)), and the indexes and constraints migration ([003_indexes_constraints.py](../../mcp-server/alembic/versions/20260310_000000_003_indexes_constraints.py)).

**See also:**
- [Core Database Schema Architecture](../architecture/database-schema.md)
- [Event Sourcing Audit Trail Schema](../architecture/event-sourcing-schema.md)
- [ADR-001: PostgreSQL as Primary State Store](../architecture/adr/adr-001-postgresql.md)
- [ADR-002: MCP as Agent Communication Protocol](../architecture/adr/adr-002-mcp-protocol.md)
- [PG Distributed Locking](../research/pg-distributed-locking.md)
- [PG Transaction Isolation](../research/pg-transaction-isolation.md)
- [PG Event Sourcing](../research/pg-event-sourcing.md)

**Prerequisites:** PostgreSQL 14+ with `uuid-ossp` and `pgcrypto` extensions.

---

## Table of Contents

- [Extensions](#extensions)
- [Enum Types](#enum-types)
- [Tables](#tables)
  - [projects](#projects)
  - [agents](#agents)
  - [sessions](#sessions)
  - [tickets](#tickets)
  - [file_locks](#file_locks)
  - [events](#events)
  - [event_history](#event_history)
  - [stage_transitions](#stage_transitions)
  - [system_config](#system_config)
  - [machines](#machines)
  - [operators](#operators)
  - [claims](#claims)
- [Indexes](#indexes)
- [Stored Functions](#stored-functions)
  - [claim_ticket](#claim_ticket)
  - [claim_ticket_by_id](#claim_ticket_by_id)
  - [advance_ticket](#advance_ticket)
  - [reject_ticket](#reject_ticket)
  - [release_ticket](#release_ticket)
  - [extend_lease](#extend_lease)
  - [resolve_dependencies](#resolve_dependencies)
  - [release_expired_claims](#release_expired_claims)
  - [update_updated_at](#update_updated_at)
  - [notify_ticket_change](#notify_ticket_change)
- [Triggers](#triggers)
- [Row-Level Security Policies](#row-level-security-policies)
- [Seed Data](#seed-data)
- [Entity Relationships](#entity-relationships)
- [Running Migrations](#running-migrations)

---

## Extensions

| Extension | Purpose |
|-----------|---------|
| `uuid-ossp` | Generates UUID v4 primary keys via `uuid_generate_v4()` |
| `pgcrypto` | Provides cryptographic functions (`gen_random_bytes`) |

---

## Enum Types

### ticket_status

Lifecycle state of a ticket (mutable).

| Value | Description |
|-------|-------------|
| `READY` | Unblocked, available for claim |
| `BLOCKED` | Waiting on dependency tickets to complete |
| `CLAIMED` | Locked by an agent with an active lease |
| `IN_PROGRESS` | Agent is actively working on the ticket |
| `DONE` | Completed successfully |
| `FAILED` | Terminal failure state |
| `ESCALATED` | Exceeded max rework attempts, requires human review |

### ticket_stage

SDLC pipeline position. Each ticket type traverses a specific subset of these stages.

| Value | Description |
|-------|-------------|
| `READY` | Entry point — dependencies satisfied |
| `RESEARCH` | Evidence research and proof of concept |
| `ARCHITECT` | System design, ADRs, API contracts |
| `PRODUCT_MANAGER` | PRDs, user stories, requirements |
| `UI_DESIGN` | Mockups and design specifications |
| `BACKEND` | Server-side implementation |
| `FRONTEND` | UI implementation |
| `QA` | Test coverage and functional verification |
| `SECURITY` | Vulnerability scan, STRIDE, OWASP review |
| `CI` | Lint, type checks, complexity analysis |
| `DOCUMENTATION` | Technical documentation |
| `VALIDATOR` | Independent Definition of Done review |
| `DONE` | Lifecycle complete |

### ticket_type

Determines which SDLC flow the ticket follows.

| Value | SDLC Flow |
|-------|-----------|
| `backend` | READY → BACKEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE |
| `frontend` | READY → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE |
| `fullstack` | READY → BACKEND → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE |
| `infra` | READY → BACKEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE |
| `security` | READY → SECURITY → QA → CI → DOCUMENTATION → VALIDATOR → DONE |
| `docs` | READY → DOCUMENTATION → VALIDATOR → DONE |
| `research` | READY → RESEARCH → DOCUMENTATION → VALIDATOR → DONE |
| `architecture` | READY → ARCHITECT → DOCUMENTATION → VALIDATOR → DONE |
| `product` | READY → PRODUCT_MANAGER → DOCUMENTATION → VALIDATOR → DONE |
| `design` | READY → UI_DESIGN → DOCUMENTATION → VALIDATOR → DONE |

### ticket_priority

Ordered from highest to lowest for claim queue sorting.

| Value | Usage |
|-------|-------|
| `critical` | Blocking other work; claimed first |
| `high` | Important but not blocking |
| `medium` | Default priority |
| `low` | Background or optional tasks |

### event_type

Audit trail event classification.

| Value | Description |
|-------|-------------|
| `CREATED` | Ticket created |
| `CLAIMED` | Agent acquired a claim |
| `RELEASED` | Voluntary claim release |
| `STAGE_ADVANCED` | Ticket moved to next SDLC stage |
| `STAGE_REJECTED` | Ticket sent back for rework |
| `UPDATED` | Metadata or field update |
| `SPAWNED` | Sub-ticket created |
| `ESCALATED` | Rework limit exceeded |
| `LEASE_EXTENDED` | Claim lease extended |
| `FORCE_RELEASED` | Admin forced a claim release |
| `RECONCILED` | State reconciliation applied |
| `FILE_LOCKED` | File lock acquired |
| `FILE_UNLOCKED` | File lock released |
| `DONE` | Ticket completed final validation |
| `REWORKED` | Ticket re-entered implementation after rejection |

---

## Tables

### projects

Top-level organizational unit. Each project maps to one Git repository.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `name` | TEXT | NOT NULL, UNIQUE | Project name |
| `description` | TEXT | | Project description |
| `repo_url` | TEXT | | Git repository URL |
| `default_lease_minutes` | INTEGER | NOT NULL, DEFAULT 30 | Default claim lease duration |
| `max_lease_minutes` | INTEGER | NOT NULL, DEFAULT 120 | Maximum allowed lease |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Last modification (auto-updated) |

### agents

Agent identity management. Each row represents an agent role instance.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `name` | TEXT | NOT NULL | Agent display name |
| `role` | TEXT | NOT NULL | Agent role (e.g., Backend, QA) |
| `api_key_hash` | TEXT | UNIQUE | SHA-256 hash of the agent's API key |
| `permissions` | JSONB | NOT NULL, DEFAULT `'[]'` | Granted capabilities array |
| `machine_id` | TEXT | | Last known machine hostname |
| `is_active` | BOOLEAN | NOT NULL, DEFAULT TRUE | Whether the agent can claim tickets |
| `revoked_at` | TIMESTAMPTZ | | Soft-delete timestamp |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Last modification (auto-updated) |

**Unique constraint:** `(name, role)` — one agent per name+role combination.

### sessions

Active agent sessions for distributed execution.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `agent_id` | UUID | NOT NULL, FK → agents(id) ON DELETE CASCADE | Owning agent |
| `session_token` | TEXT | NOT NULL, UNIQUE | Session authentication token |
| `machine_id` | TEXT | NOT NULL | Machine hostname |
| `operator` | TEXT | | Human operator name |
| `ip_address` | INET | | Client IP address |
| `last_seen` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Last heartbeat |
| `expires_at` | TIMESTAMPTZ | NOT NULL | Session expiry |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Creation timestamp |

### tickets

Central entity of the ForgeOS state machine. Each row is one unit of work.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `ticket_id` | TEXT | NOT NULL, UNIQUE | Human-readable ID (e.g., TASK-FOS-01-001) |
| `project_id` | UUID | FK → projects(id) ON DELETE SET NULL | Parent project |
| `title` | TEXT | NOT NULL | Short description |
| `description` | TEXT | | Full description |
| `type` | ticket_type | NOT NULL | Determines SDLC flow |
| `priority` | ticket_priority | NOT NULL, DEFAULT `'medium'` | Claim queue order |
| `status` | ticket_status | NOT NULL, DEFAULT `'BLOCKED'` | Current lifecycle state |
| `stage` | ticket_stage | NOT NULL, DEFAULT `'READY'` | Current SDLC position |
| `sdlc_flow` | ticket_stage[] | NOT NULL | Ordered stage sequence |
| `claimed_by` | UUID | FK → agents(id) ON DELETE SET NULL | Claiming agent |
| `claimed_by_name` | TEXT | | Agent name (denormalized for display) |
| `machine_id` | TEXT | | Machine hostname of claimer |
| `operator` | TEXT | | Human operator name |
| `lease_expiry` | TIMESTAMPTZ | | Claim expiration time |
| `lease_duration_minutes` | INTEGER | NOT NULL, DEFAULT 30 | Configured lease duration |
| `depends_on` | TEXT[] | NOT NULL, DEFAULT `'{}'` | Ticket IDs this depends on |
| `file_paths` | TEXT[] | NOT NULL, DEFAULT `'{}'` | Files this ticket modifies |
| `acceptance_criteria` | TEXT[] | NOT NULL, DEFAULT `'{}'` | Completion requirements |
| `tags` | TEXT[] | NOT NULL, DEFAULT `'{}'` | Categorization tags |
| `rework_count` | INTEGER | NOT NULL, DEFAULT 0, CHECK ≥ 0 | Rejection count |
| `max_reworks` | INTEGER | NOT NULL, DEFAULT 3 | Escalation threshold |
| `metadata` | JSONB | NOT NULL, DEFAULT `'{}'` | Extensible metadata |
| `parent_id` | TEXT | | Parent ticket ID (for sub-tickets) |
| `source_task_file` | TEXT | | Originating TODO file path |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Last modification (auto-updated) |
| `completed_at` | TIMESTAMPTZ | | Completion timestamp |
| `created_by` | TEXT | | Agent or system that created the ticket (added in Core Tables Migration) |

**Check constraints:**

- `valid_lease` — Claim fields are all-or-nothing: either both `claimed_by` and
  `lease_expiry` are NULL, or both are set.
- `valid_rework` — `rework_count` cannot exceed `max_reworks + 1`.
- `chk_tickets_lease_duration_positive` — `lease_duration_minutes > 0` (added in Migration 003).
- `chk_tickets_max_reworks_non_negative` — `max_reworks >= 0` (added in Migration 003).

### file_locks

File-level mutex system. Prevents two agents from modifying the same file.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `file_path` | TEXT | NOT NULL | Locked file path |
| `ticket_id` | TEXT | NOT NULL | Ticket holding the lock |
| `locked_by` | UUID | FK → agents(id) ON DELETE SET NULL | Agent holding the lock |
| `machine_id` | TEXT | | Machine hostname |
| `locked_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Lock acquisition time |
| `released_at` | TIMESTAMPTZ | | Lock release time (NULL = active) |

**Key behavior:** A partial unique index (`idx_file_locks_active`) on
`file_path WHERE released_at IS NULL` ensures at most one active lock per file.

### events

Append-only audit trail. Captures every state change for full lifecycle
reconstruction.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `ticket_id` | TEXT | NOT NULL | Associated ticket |
| `event_type` | event_type | NOT NULL | Event classification |
| `agent_id` | UUID | FK → agents(id) ON DELETE SET NULL | Acting agent |
| `agent_name` | TEXT | | Agent name (denormalized) |
| `machine_id` | TEXT | | Machine hostname |
| `operator` | TEXT | | Human operator name |
| `previous_stage` | ticket_stage | | Stage before transition |
| `new_stage` | ticket_stage | | Stage after transition |
| `previous_status` | ticket_status | | Status before change |
| `new_status` | ticket_status | | Status after change |
| `payload` | JSONB | NOT NULL, DEFAULT `'{}'` | Event-specific details |
| `sequence_number` | BIGINT | NOT NULL, DEFAULT `nextval(...)` | Global monotonic ordering (added in Migration 002) |
| `aggregate_version` | INTEGER | NOT NULL | Per-ticket monotonic sequence for optimistic concurrency (added in Migration 002) |
| `correlation_id` | UUID | | Links related events across tickets (added in Migration 002) |
| `causation_id` | UUID | | The event that caused this event (added in Migration 002) |
| `schema_version` | INTEGER | NOT NULL, DEFAULT `1` | Payload schema version for evolution (added in Migration 002) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Event timestamp |

> **See also:** [Event Sourcing Audit Trail Schema](../architecture/event-sourcing-schema.md)
> for full payload schemas, sequence numbering strategy, state reconstruction
> patterns, LISTEN/NOTIFY integration, and archival strategy.

### event_history

*(Added in Migration 002)*

Immutable append-only audit log of all ticket state changes. Each row captures
the full JSONB before-and-after state snapshot. Two database triggers prevent
any UPDATE or DELETE, enforcing the append-only invariant at the PostgreSQL
level.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `ticket_id` | TEXT | NOT NULL, FK → tickets(ticket_id) ON DELETE CASCADE | Associated ticket |
| `event_type` | event_type | NOT NULL | Event classification |
| `previous_state` | JSONB | | Full ticket state before the change |
| `new_state` | JSONB | | Full ticket state after the change |
| `agent_id` | UUID | FK → agents(id) ON DELETE SET NULL | Acting agent |
| `machine_id` | TEXT | | Machine hostname |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Event timestamp |
| `metadata` | JSONB | NOT NULL, DEFAULT `'{}'` | Additional event-specific data |

**Immutability triggers:**

| Trigger | Event | Function | Behavior |
|---------|-------|----------|----------|
| `trg_event_history_no_update` | BEFORE UPDATE | `prevent_event_history_update()` | Raises exception — UPDATE prohibited |
| `trg_event_history_no_delete` | BEFORE DELETE | `prevent_event_history_delete()` | Raises exception — DELETE prohibited |

**Design rationale:** The `event_history` table uses full JSONB state snapshots
rather than deltas to simplify querying and reduce reconstruction cost. Any
historical ticket state can be read directly from `new_state` without replaying
a chain of events. ARCH007 §4 establishes this design.

### stage_transitions

*(Added in Migration 002)*

Records each SDLC stage transition with the triggering agent and reason.
Provides a lightweight, queryable timeline of ticket movement through the
pipeline without the overhead of full state snapshots.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `ticket_id` | TEXT | NOT NULL, FK → tickets(ticket_id) ON DELETE CASCADE | Associated ticket |
| `from_stage` | ticket_stage | | Stage before transition (NULL for initial placement) |
| `to_stage` | ticket_stage | NOT NULL | Stage after transition |
| `triggered_by` | TEXT | NOT NULL | Agent or system that triggered the transition |
| `reason` | TEXT | | Transition reason (e.g., rejection rationale) |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Transition timestamp |

**Use cases:**
- Stage duration analytics (time between consecutive transitions per ticket).
- Bottleneck identification (which stages have the longest dwell times).
- Rework pattern detection (transitions back to implementation stages).

### system_config

Key-value store for runtime configuration parameters.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `key` | TEXT | PK | Configuration key |
| `value` | JSONB | NOT NULL | Configuration value |
| `description` | TEXT | | Human-readable description |
| `updated_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Last modification |

### machines

*(Added in Core Tables Migration — FORGEOS-BE002)*

<!-- last_reviewed: 2026-03-10T12:00:00Z -->

Machine identity registry. Each row represents a unique host that has
participated in the distributed orchestration system.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `machine_id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `hostname` | TEXT | NOT NULL, UNIQUE | Machine hostname |
| `registered_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | First registration time |
| `last_seen` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Last activity timestamp |

**Trigger:** `trg_machines_last_seen` (BEFORE UPDATE) calls
`update_updated_at()`. Note: the trigger sets the `updated_at` column, but the
machines table uses `last_seen` — the trigger is a no-op on this table.
Tracked as SEC-INFO-001 for future cleanup.

**Design rationale:** Machines are promoted to first-class entities so that
claims track the physical host via a UUID FK instead of a plain TEXT field.
The UNIQUE constraint on `hostname` prevents duplicate registrations.

### operators

*(Added in Core Tables Migration — FORGEOS-BE002)*

<!-- last_reviewed: 2026-03-10T12:00:00Z -->

Human operator registry. Each row identifies a person who initiates agent runs.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `operator_id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `name` | TEXT | NOT NULL, UNIQUE | Operator display name |
| `created_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Registration timestamp |

**Design rationale:** Operators as first-class entities enable proper FK
relationships and queryable audit trails. The UNIQUE constraint on `name`
prevents duplicate registrations.

### claims

*(Added in Core Tables Migration — FORGEOS-BE002)*

<!-- last_reviewed: 2026-03-10T12:00:00Z -->

Lease-based distributed locking. Each row represents one claim lifecycle —
from acquisition to release or expiry. Links a ticket to the agent, machine,
and operator responsible for the work.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `claim_id` | UUID | PK, DEFAULT `uuid_generate_v4()` | Internal identifier |
| `ticket_id` | UUID | NOT NULL, FK → tickets(id) ON DELETE CASCADE | Claimed ticket |
| `agent_id` | UUID | FK → agents(id) ON DELETE SET NULL | Claiming agent |
| `machine_id` | UUID | FK → machines(machine_id) ON DELETE SET NULL | Host machine |
| `operator` | TEXT | | Human operator name |
| `lease_expiry` | TIMESTAMPTZ | NOT NULL | Claim expiration time |
| `claimed_at` | TIMESTAMPTZ | NOT NULL, DEFAULT `NOW()` | Claim acquisition time |
| `released_at` | TIMESTAMPTZ | | Release time (NULL while active) |

**ON DELETE behaviors:**

| FK Column | Target | ON DELETE | Rationale |
|-----------|--------|-----------|-----------|
| `ticket_id` | tickets(id) | CASCADE | Deleting a ticket removes its claims |
| `agent_id` | agents(id) | SET NULL | Agent removal preserves claim history |
| `machine_id` | machines(machine_id) | SET NULL | Machine removal preserves claim history |

**Design rationale:** The claims table provides a full audit trail of claim
lifecycle, separate from the inline claim fields on the tickets table. Active
claims have `released_at IS NULL`. Expired claims can be identified by
`released_at IS NULL AND lease_expiry < NOW()`.

---

## Indexes

### Primary Query Indexes

| Index | Table | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| `idx_tickets_status_stage` | tickets | (status, stage) | B-tree | Dashboard queries |
| `idx_tickets_stage` | tickets | (stage) | B-tree | Stage-specific listings |
| `idx_tickets_claimed_by` | tickets | (claimed_by) | B-tree | Agent workload queries |
| `idx_tickets_priority` | tickets | (priority) | B-tree | Priority-based sorting |
| `idx_tickets_project_id` | tickets | (project_id) | B-tree | Project-scoped queries |
| `idx_tickets_parent_id` | tickets | (parent_id) | B-tree | Sub-ticket tree traversal |
| `idx_sessions_agent_id` | sessions | (agent_id) | B-tree | Session lookup by agent |
| `idx_sessions_expires_at` | sessions | (expires_at) | B-tree | Expired session cleanup |

### GIN Indexes

GIN (Generalized Inverted Index) supports efficient containment operators
(`@>`, `&&`, `?`) on arrays and JSONB.

| Index | Table | Column | Purpose |
|-------|-------|--------|---------|
| `idx_tickets_depends_on` | tickets | depends_on | Dependency resolution |
| `idx_tickets_file_paths` | tickets | file_paths | File conflict detection |
| `idx_tickets_tags` | tickets | tags | Tag-based filtering |
| `idx_tickets_metadata` | tickets | metadata | JSONB field queries |

### Partial Indexes

| Index | Table | Columns | Condition | Purpose |
|-------|-------|---------|-----------|---------|
| `idx_tickets_claimable` | tickets | (stage, priority DESC, created_at ASC) | `status = 'READY' AND claimed_by IS NULL` | `claim_ticket()` fast path |
| `idx_tickets_expired_leases` | tickets | (lease_expiry) | `claimed_by IS NOT NULL AND lease_expiry IS NOT NULL` | `release_expired_claims()` |
| `idx_file_locks_active` | file_locks | (file_path) UNIQUE | `released_at IS NULL` | File mutex enforcement |

### Core Tables Indexes

*(Added in Core Tables Migration — FORGEOS-BE002)*

| Index | Table | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| `idx_machines_hostname` | machines | (hostname) | B-tree | Hostname lookups (supplements UNIQUE constraint) |
| `idx_operators_name` | operators | (name) | B-tree | Operator name lookups (supplements UNIQUE constraint) |
| `idx_claims_ticket_id` | claims | (ticket_id) | B-tree | Find all claims for a ticket |
| `idx_claims_agent_id` | claims | (agent_id) | B-tree | Agent workload and claim history |
| `idx_claims_machine_id` | claims | (machine_id) | B-tree | Machine claim distribution |

### Core Tables Partial Indexes

*(Added in Core Tables Migration — FORGEOS-BE002)*

| Index | Table | Columns | Condition | Purpose |
|-------|-------|---------|-----------|---------|
| `idx_claims_active` | claims | (ticket_id) | `released_at IS NULL` | Fast lookup of currently held claims |
| `idx_claims_expired_leases` | claims | (lease_expiry) | `released_at IS NULL AND lease_expiry < NOW()` | Expired lease cleanup |

### Indexes and Constraints (Migration 003 — FORGEOS-BE004)

*(Added by Migration 003 — FORGEOS-BE004)*

**New composite indexes:**

| Index | Table | Columns | Type | Purpose |
|-------|-------|---------|------|----------|
| `idx_tickets_stage_type_priority` | tickets | (stage, type, priority) | B-tree | Filtered ticket listing by stage, type, and priority |
| `idx_tickets_status_stage` | tickets | (status, stage) | B-tree | Dashboard pipeline view and stage counts |
| `idx_tickets_stage_claimed_by` | tickets | (stage, claimed_by) | B-tree | Claim queue and agent workload queries |
| `idx_tickets_parent_id` | tickets | (parent_id) | B-tree | Sub-ticket tree traversal |

**New partial index:**

| Index | Table | Columns | Condition | Purpose |
|-------|-------|---------|-----------|----------|
| `idx_tickets_active_claims` | tickets | (claimed_by, stage, lease_expiry) | `WHERE claimed_by IS NOT NULL` | Active claim monitoring and lease tracking |

**Upgraded indexes:**

| Index | Table | Change | New Definition |
|-------|-------|--------|----------------|
| `idx_tickets_claimable` | tickets | Added `stage` as leading column | `(stage, priority DESC, created_at ASC) WHERE status = 'READY' AND claimed_by IS NULL` |
| `idx_claims_active` | claims | Upgraded to UNIQUE partial | `UNIQUE ON claims(ticket_id) WHERE released_at IS NULL` — enforces one active claim per ticket |

**FK coverage indexes:**

| Index | Table | Columns | Type | Purpose |
|-------|-------|---------|------|----------|
| `idx_file_locks_locked_by` | file_locks | (locked_by) | B-tree | FK coverage for agent deletion cascade |
| `idx_file_locks_ticket_id` | file_locks | (ticket_id) | B-tree | Ticket-scoped lock release |

**CHECK constraints:**

| Constraint | Table | Expression | Purpose |
|------------|-------|------------|----------|
| `chk_tickets_lease_duration_positive` | tickets | `lease_duration_minutes > 0` | Prevents zero or negative lease durations |
| `chk_tickets_max_reworks_non_negative` | tickets | `max_reworks >= 0` | Prevents negative rework limits |

### Event Indexes

| Index | Table | Columns | Purpose |
|-------|-------|---------|---------|
| `idx_events_ticket_id` | events | (ticket_id) | Per-ticket history |
| `idx_events_created_at` | events | (created_at) | Chronological queries |
| `idx_events_event_type` | events | (event_type) | Event type filtering |
| `idx_events_ticket_timeline` | events | (ticket_id, created_at) | Ticket timeline display |
| `idx_events_sequence` | events | (sequence_number) | Global ordering, catch-up polling (added in Migration 002) |
| `idx_events_aggregate_version` | events | (ticket_id, aggregate_version) UNIQUE | Per-ticket ordering, optimistic concurrency (added in Migration 002) |
| `idx_events_correlation` | events | (correlation_id) WHERE NOT NULL | Event chain tracing (added in Migration 002) |
| `idx_events_ticket_time` | events | (ticket_id, created_at) | Time-travel per ticket (added in Migration 002) |
| `idx_file_locks_ticket_id` | file_locks | (ticket_id) | Ticket → lock join |

### Event History Indexes

*(Added in Migration 002)*

| Index | Table | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| `idx_event_history_ticket_id` | event_history | (ticket_id) | B-tree | Per-ticket history lookup |
| `idx_event_history_event_type` | event_history | (event_type) | B-tree | Event type filtering |
| `idx_event_history_agent_id` | event_history | (agent_id) | B-tree | Agent activity queries |
| `idx_event_history_created_at` | event_history | (created_at) | B-tree | Chronological queries |
| `idx_event_history_ticket_timeline` | event_history | (ticket_id, created_at) | B-tree | Ticket timeline display |
| `idx_event_history_metadata` | event_history | (metadata) | GIN | JSONB metadata queries |

### Stage Transition Indexes

*(Added in Migration 002)*

| Index | Table | Columns | Type | Purpose |
|-------|-------|---------|------|---------|
| `idx_stage_transitions_ticket_id` | stage_transitions | (ticket_id) | B-tree | Per-ticket transitions |
| `idx_stage_transitions_from_stage` | stage_transitions | (from_stage) | B-tree | Source stage filtering |
| `idx_stage_transitions_to_stage` | stage_transitions | (to_stage) | B-tree | Destination stage filtering |
| `idx_stage_transitions_created_at` | stage_transitions | (created_at) | B-tree | Chronological queries |
| `idx_stage_transitions_ticket_timeline` | stage_transitions | (ticket_id, created_at) | B-tree | Ticket transition timeline |

---

## Stored Functions

### claim_ticket

Atomically claims the next available ticket for a given stage.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_stage` | ticket_stage | — | SDLC stage to claim from |
| `p_agent_id` | UUID | — | Claiming agent's ID |
| `p_agent_name` | TEXT | — | Agent display name |
| `p_machine_id` | TEXT | — | Machine hostname |
| `p_operator` | TEXT | NULL | Human operator name |
| `p_lease_minutes` | INTEGER | 30 | Lease duration |

**Returns:** The claimed ticket row (or empty set if none available).

**Concurrency model:** Uses `SELECT FOR UPDATE SKIP LOCKED` — locks the
selected row until transaction ends, and skips rows locked by other transactions
instead of waiting. This enables high-concurrency claiming without deadlocks.

### claim_ticket_by_id

Claims a specific ticket by its human-readable ticket ID.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_ticket_id` | TEXT | — | Target ticket ID |
| `p_agent_id` | UUID | — | Claiming agent's ID |
| `p_agent_name` | TEXT | — | Agent display name |
| `p_machine_id` | TEXT | — | Machine hostname |
| `p_operator` | TEXT | NULL | Human operator name |
| `p_lease_minutes` | INTEGER | 30 | Lease duration |

**Returns:** The claimed ticket row (or empty set if not claimable).

**Additional behavior:** Checks for file lock conflicts and acquires file locks
on all paths in the ticket's `file_paths` array. Raises `FILE_CONFLICT` if any
file is locked by another ticket.

### advance_ticket

Advances a ticket to the next stage in its SDLC flow.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_ticket_id` | TEXT | — | Target ticket ID |
| `p_agent_id` | UUID | — | Agent's ID (must hold claim) |
| `p_agent_name` | TEXT | — | Agent display name |
| `p_evidence` | JSONB | `'{}'` | Stage completion evidence |

**Returns:** The updated ticket row.

**Behavior:** Validates SDLC flow ordering using array index lookup. Clears
claim fields, releases file locks, merges evidence into metadata. If reaching
DONE, calls `resolve_dependencies()` to unblock waiting tickets.

**Raises:** `NOT_CLAIM_OWNER`, `INVALID_TRANSITION`.

### reject_ticket

Rejects a ticket, sending it back for rework or escalating.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_ticket_id` | TEXT | — | Target ticket ID |
| `p_agent_id` | UUID | — | Agent's ID (must hold claim) |
| `p_agent_name` | TEXT | — | Agent display name |
| `p_reason` | TEXT | — | Rejection reason |
| `p_evidence` | JSONB | `'{}'` | Supporting evidence |

**Returns:** The updated ticket row.

**Behavior:** If `rework_count < max_reworks`, resets ticket to its first
implementation stage with status READY. If `rework_count >= max_reworks`, sets
status to ESCALATED for human intervention. Logs the event in both cases.

### release_ticket

Voluntarily releases a claim, returning the ticket to READY.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_ticket_id` | TEXT | — | Target ticket ID |
| `p_agent_id` | UUID | — | Agent's ID |
| `p_agent_name` | TEXT | — | Agent display name |
| `p_reason` | TEXT | NULL | Release reason |
| `p_force` | BOOLEAN | FALSE | Admin override flag |

**Returns:** The updated ticket row.

**Raises:** `TICKET_NOT_FOUND`, `NOT_CLAIM_OWNER` (if not forced).

### extend_lease

Extends the lease on a claimed ticket.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_ticket_id` | TEXT | — | Target ticket ID |
| `p_agent_id` | UUID | — | Agent's ID (must hold claim) |
| `p_agent_name` | TEXT | — | Agent display name |
| `p_minutes` | INTEGER | 30 | Extension duration |

**Returns:** The updated ticket row.

**Behavior:** Reads `max_lease_minutes` from `system_config` to enforce an upper
bound. Raises `LEASE_TOO_LONG` if the requested duration exceeds the limit.

### resolve_dependencies

Checks if any BLOCKED tickets can become READY after a ticket completes.

| Parameter | Type | Description |
|-----------|------|-------------|
| `p_completed_ticket_id` | TEXT | Ticket ID that just reached DONE |

**Returns:** void.

**Behavior:** For each BLOCKED ticket that lists the completed ticket in
`depends_on`, verifies that ALL dependencies are now DONE. If all satisfied,
transitions the candidate to READY and logs a dependency resolution event.

Called automatically by `advance_ticket()` when a ticket reaches DONE.

### release_expired_claims

Batch releases all tickets whose lease has expired.

**Parameters:** None.

**Returns:** INTEGER — count of released claims.

**Behavior:** Finds all tickets where `claimed_by IS NOT NULL` and
`lease_expiry < NOW()`. Clears claim fields, sets status to READY, releases
orphaned file locks, and logs RELEASED events. Designed to run periodically.

### update_updated_at

Trigger function that sets `updated_at = NOW()` before any row update.

**Applied to:** tickets, agents, projects tables.

### notify_ticket_change

Trigger function that fires `pg_notify('ticket_changes', ...)` on every ticket
INSERT or UPDATE. The payload is a JSON object with `ticket_id`, `status`,
`stage`, `claimed_by`, `machine_id`, and `updated_at`.

The application server listens on the `ticket_changes` channel and pushes
events to SSE clients for real-time dashboard updates.

### prevent_event_mutation

*(Added in Migration 002)*

Trigger function that raises an exception on any UPDATE or DELETE against the
`events` table. Enforces the append-only immutability invariant at the database
level. The error message includes the attempted operation and directs users to
create a RECONCILED event instead.

**Applied to:** events table (via `trg_events_immutable_update` and
`trg_events_immutable_delete`).

### prevent_event_history_update

*(Added in Migration 002)*

Trigger function that raises an exception on any UPDATE against the
`event_history` table. The error message states that the table is append-only
and UPDATE operations are prohibited.

**Applied to:** event_history table (via `trg_event_history_no_update`).

### prevent_event_history_delete

*(Added in Migration 002)*

Trigger function that raises an exception on any DELETE against the
`event_history` table. The error message states that the table is append-only
and DELETE operations are prohibited.

**Applied to:** event_history table (via `trg_event_history_no_delete`).

### notify_event_created

*(Added in Migration 002)*

Trigger function that fires `pg_notify('ticket_events', ...)` on every event
INSERT. The payload is a compact JSON object with `event_id`, `ticket_id`,
`event_type`, `agent`, `machine`, stage transitions, `seq` (sequence_number),
`version` (aggregate_version), and `ts` (timestamp). If the payload exceeds
7,500 bytes, a truncated notification is sent and the consumer must fetch the
full event by ID.

### replay_ticket_state

*(Added in Migration 002)*

Reconstructs a ticket's state at any point in time by replaying its events in
`aggregate_version` order.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `p_ticket_id` | TEXT | — | Target ticket ID |
| `p_as_of` | TIMESTAMPTZ | `NOW()` | Reconstruct state as of this timestamp |

**Returns:** JSONB — reconstructed ticket state including status, stage,
claimed_by, rework_count, and version.

**Use cases:** Time-travel debugging, audit verification, incident
investigation, migration validation.

**Performance:** Sub-10ms for typical tickets (20 events). See
[Event Sourcing Schema §8.4](../architecture/event-sourcing-schema.md#84-replay-performance)
for benchmarks.

### verify_ticket_integrity

*(Added in Migration 002)*

Compares the mutable `tickets` row against the state reconstructed by
`replay_ticket_state()`. Returns a JSONB report with match status,
discrepancies, current state, replayed state, and event count.

| Parameter | Type | Description |
|-----------|------|-------------|
| `p_ticket_id` | TEXT | Target ticket ID |

**Returns:** JSONB — integrity report with `integrity_match` (boolean),
`current_state`, `replayed_state`, `discrepancies`, `event_count`, and
`checked_at`.

---

## Triggers

| Trigger | Table | Event | Function |
|---------|-------|-------|----------|
| `trg_tickets_updated_at` | tickets | BEFORE UPDATE | `update_updated_at()` |
| `trg_agents_updated_at` | agents | BEFORE UPDATE | `update_updated_at()` |
| `trg_projects_updated_at` | projects | BEFORE UPDATE | `update_updated_at()` |
| `trg_machines_last_seen` | machines | BEFORE UPDATE | `update_updated_at()` — intended to refresh `last_seen`, but trigger sets `updated_at` (column absent on machines); effectively a no-op. Tracked as SEC-INFO-001. (added in Core Tables Migration) |
| `trg_ticket_notify` | tickets | AFTER INSERT OR UPDATE | `notify_ticket_change()` |
| `trg_events_immutable_update` | events | BEFORE UPDATE | `prevent_event_mutation()` — raises exception to enforce append-only immutability (added in Migration 002) |
| `trg_events_immutable_delete` | events | BEFORE DELETE | `prevent_event_mutation()` — raises exception to enforce append-only immutability (added in Migration 002) |
| `trg_event_notify` | events | AFTER INSERT | `notify_event_created()` — sends NOTIFY on `ticket_events` channel for real-time streaming (added in Migration 002) |
| `trg_event_history_no_update` | event_history | BEFORE UPDATE | `prevent_event_history_update()` — raises exception to enforce append-only immutability (added in Migration 002) |
| `trg_event_history_no_delete` | event_history | BEFORE DELETE | `prevent_event_history_delete()` — raises exception to enforce append-only immutability (added in Migration 002) |

---

## Row-Level Security Policies

RLS is enabled on three tables: `tickets`, `events`, and `file_locks`.

Policies use PostgreSQL session variables set by the application layer:

- `app.agent_role` — set via `SET LOCAL app.agent_role = 'admin'`
- `app.agent_name` — set via `SET LOCAL app.agent_name = 'Backend'`

| Policy | Table | Operation | Rule |
|--------|-------|-----------|------|
| `admin_all_tickets` | tickets | ALL | Full access when `app.agent_role = 'admin'` |
| `agent_select_tickets` | tickets | SELECT | All agents can read all tickets |
| `agent_update_tickets` | tickets | UPDATE | Agents can update only their claimed tickets |
| `agent_insert_events` | events | INSERT | All agents can insert events |
| `agent_select_events` | events | SELECT | All agents can read events |
| `agent_file_locks` | file_locks | ALL | Permissive — operations mediated by stored functions |

---

## Seed Data

The `system_config` table is seeded with default operational parameters:

| Key | Value | Description |
|-----|-------|-------------|
| `default_lease_minutes` | 30 | Default claim lease duration (minutes) |
| `max_lease_minutes` | 120 | Maximum lease extension (minutes) |
| `rate_limit_per_minute` | 100 | API rate limit per agent per minute |
| `reconciliation_interval_seconds` | 300 | Webhook reconciliation check interval |
| `stale_machine_hours` | 24 | Hours before a machine is marked stale |

---

## Entity Relationships

```
┌──────────┐       ┌──────────┐       ┌──────────────┐
│ projects │──1:M──│ tickets  │──M:1──│   agents     │
└──────────┘       │          │       │ (claimed_by) │
                   └────┬─────┘       └──────┬───────┘
                        │                    │
                   ┌────┴─────┐         ┌────┴───────┐
                   │  events  │──M:1────│  sessions  │
                   │(ticket_id│         │ (agent_id) │
                   │ audit)   │         └────────────┘
                   └──────────┘
                   ┌──────────────────┐
                   │  event_history   │──M:1── tickets (ticket_id)
                   │ (state snapshots)│──M:1── agents  (agent_id)
                   └──────────────────┘
                   ┌──────────────────┐
                   │stage_transitions │──M:1── tickets (ticket_id)
                   │ (SDLC movement)  │
                   └──────────────────┘
                   ┌──────────┐
                   │file_locks│──M:1── agents (locked_by)
                   │(mutex)   │
                   └──────────┘
                   ┌──────────┐       ┌──────────────┐
                   │  claims  │──M:1──│   tickets    │
                   │(lease    │       └──────────────┘
                   │ locking) │──M:1── agents  (agent_id)
                   │          │──M:1── machines (machine_id)
                   └──────────┘
                   ┌──────────┐
                   │ machines │  (standalone, referenced by claims)
                   └──────────┘
                   ┌──────────┐
                   │operators │  (standalone registry)
                   └──────────┘
```

- **projects → tickets:** One project has many tickets (`project_id` FK).
- **agents → tickets:** One agent claims many tickets (`claimed_by` FK).
- **agents → sessions:** One agent has many sessions (`agent_id` FK, CASCADE).
- **agents → events:** One agent generates many events (`agent_id` FK).
- **agents → file_locks:** One agent holds many file locks (`locked_by` FK).
- **tickets → events:** Each ticket has an append-only event history.
- **tickets → event_history:** Each ticket has immutable state-change snapshots (append-only, CASCADE delete).
- **agents → event_history:** Each agent generates event history entries (`agent_id` FK, SET NULL on delete).
- **tickets → stage_transitions:** Each ticket has a timeline of SDLC stage movements (CASCADE delete).
- **tickets → file_locks:** Each ticket can hold multiple file locks.
- **tickets → claims:** Each ticket can have many claims over time (`ticket_id` FK, CASCADE). Only one active at a time (`released_at IS NULL`).
- **agents → claims:** One agent holds many claims over time (`agent_id` FK, SET NULL).
- **machines → claims:** One machine appears in many claims (`machine_id` FK, SET NULL).
- **operators:** Referenced by `claims.operator` as TEXT; no FK constraint.

---

## Running Migrations

<!-- last_reviewed: 2026-03-10T11:00:00Z -->

### TypeScript Migrations (Migration 001)

The migration runner (`forgeos-server/src/db/migrate.ts`) handles schema setup.

```bash
# Run all pending migrations
npm run migrate
# Or directly:
npx tsx src/db/migrate.ts
```

The runner:
1. Creates a `schema_migrations` tracking table (if it does not already exist)
   with columns: `id`, `name`, `checksum`, `applied_at`.
2. Reads all `.sql` files from `src/db/migrations/` in lexicographic order.
3. Verifies SHA-256 checksums of previously applied migrations — throws on
   mismatch to prevent silent schema drift.
4. Skips files already recorded in `schema_migrations`.
5. Executes each pending migration in a transaction (BEGIN → SQL → INSERT
   tracking row → COMMIT). On failure, rolls back the individual migration.

Migrations are idempotent: the schema uses `CREATE IF NOT EXISTS`,
`CREATE OR REPLACE`, and `ON CONFLICT DO NOTHING` where appropriate.

### schema_migrations Table

| Column | Type | Description |
|--------|------|-------------|
| `id` | SERIAL | Auto-increment primary key |
| `name` | TEXT | Migration filename (unique) |
| `checksum` | TEXT | SHA-256 hex digest of file contents at apply time |
| `applied_at` | TIMESTAMPTZ | Timestamp when the migration was executed |

### Alembic Migrations (Migration 002+)

Event sourcing and audit trail tables are managed by Alembic (Python) in the
`mcp-server/` directory. Alembic tracks applied migrations in its own
`alembic_version` table.

```bash
# From mcp-server/ directory:
cd mcp-server

# Run all pending migrations
alembic upgrade head

# Downgrade one revision
alembic downgrade -1

# Show current revision
alembic current

# Show migration history
alembic history
```

**Migration files:**

| Revision | File | Description |
|----------|------|-------------|
| 001 | `001_initial_schema.py` | Core tables (projects, agents, sessions, tickets, file_locks, events, system_config) |
| 002 | `20260310_000000_002_event_tables.py` | Event history, stage transitions, event sourcing enhancements (FORGEOS-BE003) |
| 002 | `20260310_000000_002_core_tables.py` | Machines, operators, claims tables; tickets.created_by column (FORGEOS-BE002) |
| 003 | `20260310_000000_003_indexes_constraints.py` | Composite indexes, upgraded partial indexes, CHECK constraints, FK coverage indexes (FORGEOS-BE004) |
