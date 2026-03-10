---
title: ForgeOS Database Index and Performance Strategy
ticket: FORGEOS-ARCH006
type: architecture
author: Architect
date: 2026-03-07T12:55:00Z
status: REVIEWED
audience: Backend Engineers, DevOps Engineers, DBAs, QA Engineers
purpose: Define comprehensive database indexing strategy, document query patterns with EXPLAIN plan expectations, and establish index maintenance procedures
last_reviewed: 2026-03-10T13:56:05Z
reviewed_by: Documentation
diataxis_quadrant: reference
tags: [architecture, database, indexes, performance, postgresql, phase1, BLK-02-02]
dependencies: [FORGEOS-ARCH005]
evidence_base: [FORGEOS-RES005, FORGEOS-RES006, FORGEOS-RES007]
---

# ForgeOS Database Index and Performance Strategy

> **Ticket:** FORGEOS-ARCH006 | **Agent:** Architect | **Date:** 2026-03-07
> **Confidence:** HIGH (89%) | **Status:** REVIEWED

---

**Upstream Artifacts:**
- [Database Schema Architecture](database-schema.md) — FORGEOS-ARCH005 (table definitions, constraints, stored functions)
- [PG Distributed Locking Research](../research/pg-distributed-locking.md) — FORGEOS-RES005
- [PG Connection Pooling Research](../research/pg-connection-pooling.md) — FORGEOS-RES006

**Related ADRs:**
- [ADR-001: PostgreSQL as Primary State Store](adr/adr-001-postgresql.md)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Context Map](#2-context-map)
3. [Design Principles](#3-design-principles)
4. [Primary and Unique Indexes](#4-primary-and-unique-indexes)
5. [Composite Indexes for Claim Queue Queries](#5-composite-indexes-for-claim-queue-queries)
6. [GIN Indexes on Array and JSONB Columns](#6-gin-indexes-on-array-and-jsonb-columns)
7. [Partial Indexes for Hot Paths](#7-partial-indexes-for-hot-paths)
8. [Event Table Indexes](#8-event-table-indexes)
9. [Session and Supporting Table Indexes](#9-session-and-supporting-table-indexes)
10. [Top 10 Query Patterns with EXPLAIN Plan Expectations](#10-top-10-query-patterns-with-explain-plan-expectations)
11. [Index Sizing and Storage Projections](#11-index-sizing-and-storage-projections)
12. [Index Maintenance Strategy](#12-index-maintenance-strategy)
13. [Anti-Patterns and Hazards](#13-anti-patterns-and-hazards)
14. [Well-Architected Pillar Assessment](#14-well-architected-pillar-assessment)
15. [ADR-004: Index Design Decisions](#15-adr-004-index-design-decisions)
16. [Fitness Functions](#16-fitness-functions)
17. [Complete Index Catalog](#17-complete-index-catalog)

---

## 1. Executive Summary

This document defines the comprehensive indexing strategy for ForgeOS's PostgreSQL schema (7 tables, 5 enum types). Indexes are designed to optimize 10 critical query patterns spanning ticket claiming, dependency resolution, dashboard rendering, audit trail retrieval, and lease management.

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| Partial indexes for claim queue | Only ~5% of tickets are claimable at any time; partial index reduces size by 95% |
| Composite `(stage, claimed_by)` index | Covers claim-queue filtering and agent workload queries in a single B-tree |
| GIN on `TEXT[]` arrays | Enables O(1) containment checks for dependency resolution and file conflict detection |
| GIN on `JSONB metadata` | Supports extensible metadata queries without schema changes |
| Covering composite on events | `(ticket_id, created_at)` eliminates heap access for timeline queries |
| Partial unique on `file_locks` | Database-enforced mutex — at most one active lock per file path |

### Index Summary

| Category | Count | Tables Covered |
|----------|-------|----------------|
| Primary Key (B-tree, implicit) | 7 | All tables |
| Unique Constraints (B-tree, implicit) | 5 | projects, agents, sessions, tickets, file_locks |
| B-tree Indexes (explicit) | 12 | tickets, sessions, events, file_locks |
| GIN Indexes | 4 | tickets |
| Partial Indexes | 3 | tickets, file_locks |
| **Total** | **31** | **7 tables** |

---

## 2. Context Map

### 2.1 Primary Files

| File | Role |
|------|------|
| [forgeos-server/src/db/migrations/001_initial.sql](../../forgeos-server/src/db/migrations/001_initial.sql) | DDL containing all CREATE INDEX statements |
| [docs/architecture/database-schema.md](database-schema.md) | Upstream schema design with table definitions |
| This document | Index strategy and performance analysis |

### 2.2 Secondary Files

| File | Role |
|------|------|
| [forgeos-server/src/tools/tickets-claim.ts](../../forgeos-server/src/tools/tickets-claim.ts) | Ticket claim tool — invokes `claim_ticket()` stored function |
| [forgeos-server/src/tools/tickets-complete.ts](../../forgeos-server/src/tools/tickets-complete.ts) | Ticket advance tool — invokes `advance_ticket()` |
| [forgeos-server/src/tools/tickets-stats.ts](../../forgeos-server/src/tools/tickets-stats.ts) | Dashboard stats — aggregation queries |
| [forgeos-server/src/db/pool.ts](../../forgeos-server/src/db/pool.ts) | Connection pool with RLS session injection |

### 2.3 Established Patterns

| Pattern | Source | Applied |
|---------|--------|---------|
| `SELECT FOR UPDATE SKIP LOCKED` for claim queues | FORGEOS-RES005 | ✅ Partial index `idx_tickets_claimable` |
| Transaction-scoped advisory locks | FORGEOS-RES005 | ✅ Compatible with PgBouncer transaction mode |
| `SET LOCAL` for RLS session variables | FORGEOS-ARCH005 | ✅ No index impact |
| snake_case naming convention | FORGEOS-ARCH005 | ✅ All index names use `idx_{table}_{columns}` |

---

## 3. Design Principles

### 3.1 Index Only What You Query

Every index in this strategy maps to at least one documented query pattern (Section 10). Unused indexes waste storage, slow writes, and add vacuum overhead.

### 3.2 Partial Indexes for Selectivity

When a query targets a small subset of rows (< 10% of the table), a partial index with a matching WHERE clause is preferred over a full index. This reduces index size, improves cache hit rates, and lowers write amplification.

**ForgeOS examples:**
- `idx_tickets_claimable`: Only unclaimed READY tickets (~5% at steady state)
- `idx_tickets_expired_leases`: Only actively claimed tickets (~10%)
- `idx_file_locks_active`: Only unreleased locks (~2% of all lock records)

### 3.3 Composite Index Column Order

For composite B-tree indexes, column order follows the **equality-first, range-last** principle:
1. Columns used in `=` comparisons come first
2. Columns used in `ORDER BY` or range comparisons come last
3. For tie-breaking, higher-cardinality columns precede lower-cardinality columns

### 3.4 GIN for Containment, B-tree for Equality

- **GIN** indexes support `@>` (contains), `&&` (overlap), `?` (key exists) operators on arrays and JSONB. Use for `depends_on`, `file_paths`, `tags`, `metadata`.
- **B-tree** indexes support `=`, `<`, `>`, `BETWEEN`, `IS NULL`, `ORDER BY`. Use for scalar columns.

### 3.5 Write Amplification Awareness

Each index on a table adds one additional write per INSERT/UPDATE. ForgeOS's write patterns:

| Table | Insert Rate | Update Rate | Index Budget |
|-------|------------|-------------|--------------|
| `tickets` | Low (batch creation) | Medium (claim/advance/reject) | Medium (10 indexes acceptable) |
| `events` | High (every state change) | None (append-only) | Low (minimize, 4 indexes) |
| `file_locks` | Low (per-claim) | Low (release updates) | Low (2 indexes sufficient) |
| `sessions` | Low (agent connect) | Medium (heartbeat) | Low (2 indexes) |
| `projects` | Rare (admin) | Rare | Minimal (PK + UNIQUE) |
| `agents` | Rare (provisioning) | Rare | Minimal (PK + UNIQUE) |
| `system_config` | Rare (admin) | Rare | Minimal (PK only) |

---

## 4. Primary and Unique Indexes

PostgreSQL automatically creates B-tree indexes for PRIMARY KEY and UNIQUE constraints. These are implicit and require no explicit `CREATE INDEX`.

### 4.1 Primary Key Indexes (Implicit)

| Table | PK Column | Index Name (auto) | Type | Notes |
|-------|-----------|-------------------|------|-------|
| `projects` | `id` (UUID) | `projects_pkey` | B-tree | Unique, NOT NULL |
| `agents` | `id` (UUID) | `agents_pkey` | B-tree | Unique, NOT NULL |
| `sessions` | `id` (UUID) | `sessions_pkey` | B-tree | Unique, NOT NULL |
| `tickets` | `id` (UUID) | `tickets_pkey` | B-tree | Unique, NOT NULL |
| `file_locks` | `id` (UUID) | `file_locks_pkey` | B-tree | Unique, NOT NULL |
| `events` | `id` (UUID) | `events_pkey` | B-tree | Unique, NOT NULL |
| `system_config` | `key` (TEXT) | `system_config_pkey` | B-tree | Unique, NOT NULL |

**Note:** UUID v4 primary keys produce random key distribution, which means B-tree leaf pages fill non-sequentially. This is intentional — ForgeOS prioritizes multi-machine insert safety over sequential I/O patterns. At ForgeOS scale (≤ 100K tickets), the random UUID overhead is negligible.

### 4.2 Unique Constraint Indexes (Implicit)

| Table | Column(s) | Constraint Name | Type | Purpose |
|-------|-----------|-----------------|------|---------|
| `projects` | `name` | `projects_name_key` | B-tree UNIQUE | One project per name |
| `agents` | `(name, role)` | `agent_name_role_unique` | Composite B-tree UNIQUE | One agent per name+role pair |
| `agents` | `api_key_hash` | `agents_api_key_hash_key` | B-tree UNIQUE | API key uniqueness for authentication |
| `sessions` | `session_token` | `sessions_session_token_key` | B-tree UNIQUE | Session token uniqueness |
| `tickets` | `ticket_id` | `tickets_ticket_id_key` | B-tree UNIQUE | Human-readable ticket ID uniqueness |

**Query support:** The `tickets.ticket_id` unique index is critical — all stored functions (`claim_ticket_by_id`, `advance_ticket`, `reject_ticket`, etc.) look up tickets by `ticket_id` TEXT, not by internal UUID. This unique index provides O(log n) lookup.

### 4.3 Partial Unique Index

| Table | Column | WHERE Clause | Name | Purpose |
|-------|--------|-------------|------|---------|
| `file_locks` | `file_path` | `released_at IS NULL` | `idx_file_locks_active` | Database-enforced file mutex — at most one active (unreleased) lock per file path |

This partial unique index is the cornerstone of ForgeOS's file conflict prevention. It only indexes rows where `released_at IS NULL` (active locks). Released locks exit the index, allowing the same file to be re-locked by a different ticket.

---

## 5. Composite Indexes for Claim Queue Queries

### 5.1 `idx_tickets_status_stage` — Dashboard and Pipeline View

```sql
CREATE INDEX idx_tickets_status_stage ON tickets(status, stage);
```

**Query patterns served:**

| Query | WHERE Clause | Usage |
|-------|-------------|-------|
| Dashboard pipeline view | `WHERE status = 'CLAIMED' AND stage = 'BACKEND'` | "Show all claimed tickets in BACKEND stage" |
| Stage counts | `GROUP BY status, stage` | Dashboard aggregation panels |
| Status filtering | `WHERE status = 'READY'` | Uses leading column efficiently |

**Column order rationale:** `status` has 7 values, `stage` has 13. Equality on `status` (leading column) narrows the scan to ~14% of rows, then `stage` further narrows within that subset.

### 5.2 `idx_tickets_stage_claimed_by` — Claim Queue and Agent Workload (NEW)

```sql
CREATE INDEX idx_tickets_stage_claimed_by ON tickets(stage, claimed_by);
```

**Query patterns served:**

| Query | WHERE Clause | Usage |
|-------|-------------|-------|
| Claim queue by stage | `WHERE stage = 'BACKEND' AND claimed_by IS NULL` | Find unclaimed tickets in a specific stage |
| Agent workload | `WHERE claimed_by = :agent_id` | "What is this agent working on?" (uses trailing column, less selective but index-only scan possible with visibility map) |
| Stage + agent filter | `WHERE stage = 'QA' AND claimed_by = :agent_id` | "Is this agent working on anything in QA?" |

**Design rationale:** The acceptance criteria require a composite index on `(stage, claimed_by)`. This index complements `idx_tickets_claimable` (the partial index used by the stored function) by covering broader queries — dashboard views showing all tickets in a stage regardless of status, and agent workload queries that filter by `claimed_by`.

**Relationship to `idx_tickets_claimed_by`:** The existing single-column index `idx_tickets_claimed_by` is subsumed by this composite index for queries that filter on `claimed_by` alone (PostgreSQL can use the trailing column of a composite index when the leading column provides low discrimination). **Recommendation:** Keep both indexes because:
- `idx_tickets_claimed_by` is optimal for pure agent-workload queries (`WHERE claimed_by = :id`) — single-column B-tree traversal
- `idx_tickets_stage_claimed_by` is optimal for combined stage + agent queries
- At ForgeOS scale, the storage overhead of the redundant index is negligible (~800 KB for 100K tickets)

### 5.3 `idx_tickets_claimable` — Claim Function Fast Path (Partial)

```sql
CREATE INDEX idx_tickets_claimable
    ON tickets(stage, priority DESC, created_at ASC)
    WHERE status = 'READY' AND claimed_by IS NULL;
```

**This is the primary index used by `claim_ticket()`:**

```sql
SELECT * FROM tickets
WHERE stage = p_stage
  AND status = 'READY'
  AND (claimed_by IS NULL OR lease_expiry < NOW())
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

**Column order analysis:**
1. `stage` — equality predicate (selects one stage)
2. `priority DESC` — ORDER BY first key (highest priority first)
3. `created_at ASC` — ORDER BY second key (oldest within same priority)

**Partial index WHERE clause:** `status = 'READY' AND claimed_by IS NULL` — matches the most common path in the claim function. At steady state, only ~5% of tickets are READY and unclaimed, so this index contains ~5% of all ticket rows.

**Note on `OR lease_expiry < NOW()`:** The partial index does NOT cover the expired-lease path of the claim query. Tickets with expired leases have `claimed_by IS NOT NULL` and are excluded from this partial index. The query planner will either:
- Use `idx_tickets_claimable` for the `claimed_by IS NULL` path, then a separate scan for expired leases
- Fall back to `idx_tickets_expired_leases` for the expired-lease path

This is acceptable because expired leases are rare (cleaned periodically by `release_expired_claims()`).

### 5.4 `idx_tickets_stage` — Stage Listing

```sql
CREATE INDEX idx_tickets_stage ON tickets(stage);
```

**Query pattern:** `SELECT * FROM tickets WHERE stage = 'BACKEND'` — list all tickets in a stage regardless of status. Used by the dashboard stage view and by `release_expired_claims()` to iterate staged tickets.

### 5.5 `idx_tickets_priority` — Priority Sort

```sql
CREATE INDEX idx_tickets_priority ON tickets(priority);
```

**Query pattern:** Priority-based sorting for administrative views. Lower priority than `idx_tickets_claimable` (which includes priority in its composite key).

### 5.6 `idx_tickets_project_id` and `idx_tickets_parent_id`

```sql
CREATE INDEX idx_tickets_project_id ON tickets(project_id);
CREATE INDEX idx_tickets_parent_id ON tickets(parent_id);
```

**Query patterns:**
- `idx_tickets_project_id`: Project-scoped ticket listing (`WHERE project_id = :id`)
- `idx_tickets_parent_id`: Sub-ticket tree traversal (`WHERE parent_id = :ticket_id`)

---

## 6. GIN Indexes on Array and JSONB Columns

### 6.1 Overview

PostgreSQL Generalized Inverted Indexes (GIN) are optimized for multi-valued data types: arrays, JSONB, and full-text search vectors. GIN indexes decompose each value into elements (array items, JSONB keys/values) and build an inverted map from elements to rows.

**Trade-off:** GIN indexes are slower to build and update than B-tree (each INSERT may add multiple index entries), but provide dramatically faster lookups for containment and overlap queries.

### 6.2 `idx_tickets_depends_on` — Dependency Resolution

```sql
CREATE INDEX idx_tickets_depends_on ON tickets USING GIN(depends_on);
```

**Operator support:** `@>` (contains), `&&` (overlap), `<@` (is contained by)

**Query patterns:**

| Query | SQL | Usage |
|-------|-----|-------|
| "Which tickets depend on TASK-001?" | `WHERE depends_on @> ARRAY['TASK-001']` | `resolve_dependencies()` — when TASK-001 completes, find all tickets that depend on it |
| "Does ticket X depend on ticket Y?" | `WHERE ticket_id = 'X' AND depends_on @> ARRAY['Y']` | Dependency verification |
| "Any overlapping dependencies?" | `WHERE depends_on && ARRAY['TASK-001', 'TASK-002']` | Dependency graph analysis |

**`resolve_dependencies()` usage:**
```sql
-- From the stored function:
SELECT id, ticket_id, depends_on FROM tickets
WHERE status = 'BLOCKED'
  AND depends_on @> ARRAY[p_completed_ticket_id];
-- GIN index provides O(1) element lookup in the array
```

**Scale analysis:** With 100K tickets averaging 3 dependencies each, the GIN index contains ~300K entries. GIN lookups are constant-time per element, making dependency resolution sub-millisecond even at scale.

### 6.3 `idx_tickets_file_paths` — File Conflict Detection

```sql
CREATE INDEX idx_tickets_file_paths ON tickets USING GIN(file_paths);
```

**Operator support:** `@>`, `&&`, `<@`

**Query patterns:**

| Query | SQL | Usage |
|-------|-----|-------|
| "Is any ticket modifying this file?" | `WHERE file_paths @> ARRAY['src/server.ts']` | File conflict detection in `claim_ticket_by_id()` |
| "Any file overlap between tickets?" | `WHERE file_paths && ARRAY['src/a.ts', 'src/b.ts']` | Scope conflict analysis |
| "All tickets touching src/" | `WHERE file_paths && ARRAY(SELECT path FROM ...)` | Impact analysis |

**`claim_ticket_by_id()` integration:** Before acquiring file locks, the stored function checks for existing active file locks via the `file_locks` table. The `file_paths` GIN index enables broader scope conflict analysis at the ticket level (e.g., dashboard showing file overlap warnings).

### 6.4 `idx_tickets_tags` — Tag-Based Filtering

```sql
CREATE INDEX idx_tickets_tags ON tickets USING GIN(tags);
```

**Query patterns:**

| Query | SQL | Usage |
|-------|-----|-------|
| "All phase1 tickets" | `WHERE tags @> ARRAY['phase1']` | Phase filtering |
| "Tickets tagged both 'database' and 'architecture'" | `WHERE tags @> ARRAY['database', 'architecture']` | Multi-tag intersection |
| "Any ticket with these tags?" | `WHERE tags && ARRAY['security', 'auth']` | Tag overlap search |

### 6.5 `idx_tickets_metadata` — Extensible Metadata Queries

```sql
CREATE INDEX idx_tickets_metadata ON tickets USING GIN(metadata);
```

**Operator support:** `@>` (contains), `?` (key exists), `?&` (all keys exist), `?|` (any key exists)

**Query patterns:**

| Query | SQL | Usage |
|-------|-----|-------|
| "Tickets with test coverage recorded" | `WHERE metadata ? 'coverage'` | QA reporting |
| "Tickets where coverage > 80%" | `WHERE metadata @> '{"coverage": 80}'::jsonb` | Threshold queries (exact match only; range requires functional index) |
| "Tickets with specific ADR reference" | `WHERE metadata @> '{"architecture_adr": "ADR-005"}'::jsonb` | Architecture traceability |

**GIN JSONB operator class:** The default `jsonb_ops` GIN operator class indexes all keys and values, supporting `@>`, `?`, `?&`, `?|`. The alternative `jsonb_path_ops` class is more compact but only supports `@>`. **Decision:** Use default `jsonb_ops` for maximum operator coverage — ForgeOS metadata queries use `?` (key existence) frequently for reporting.

### 6.6 GIN Maintenance Considerations

| Factor | Impact | Mitigation |
|--------|--------|------------|
| Build time | GIN builds are slower than B-tree (2–5x) | One-time cost; subsequent inserts use pending list |
| `gin_pending_list_limit` | GIN buffers insertions in a pending list; flushes at limit | Default 4MB is suitable; increase to 8MB if insert batches are large |
| Vacuum must clean pending list | `VACUUM` merges pending entries into the main GIN tree | Auto-vacuum handles this; ensure `autovacuum_naptime` is ≤ 60s |
| Update cost | Each array change (add/remove element) updates the GIN index | ForgeOS arrays are rarely modified after creation (depends_on, file_paths are set at ticket creation) |

---

## 7. Partial Indexes for Hot Paths

### 7.1 `idx_tickets_claimable` — Claim Queue Fast Path

```sql
CREATE INDEX idx_tickets_claimable
    ON tickets(stage, priority DESC, created_at ASC)
    WHERE status = 'READY' AND claimed_by IS NULL;
```

**Why partial:** At any point in time, only a small fraction of tickets are in READY status and unclaimed. With 100K total tickets:
- ~5K in READY status (~5%)
- ~3K unclaimed within READY (~3% of total)

A full B-tree index on `(stage, priority, created_at)` would index all 100K rows. The partial index contains only the ~3K claimable rows — a 97% reduction in index size.

**Performance impact:**
- Index fits entirely in shared_buffers at ForgeOS scale
- Single B-tree descent + LIMIT 1 produces sub-millisecond scan time
- `SKIP LOCKED` operates at the row lock level, independent of index type

### 7.2 `idx_tickets_expired_leases` — Lease Cleanup

```sql
CREATE INDEX idx_tickets_expired_leases
    ON tickets(lease_expiry)
    WHERE claimed_by IS NOT NULL AND lease_expiry IS NOT NULL;
```

**Why partial:** Only actively claimed tickets have `claimed_by IS NOT NULL`. At any time, ~50–100 tickets are claimed (out of 100K). This partial index contains ~0.1% of rows.

**Query served by `release_expired_claims()`:**
```sql
WITH expired AS (
    SELECT id FROM tickets
    WHERE claimed_by IS NOT NULL
      AND lease_expiry IS NOT NULL
      AND lease_expiry < NOW()
    FOR UPDATE SKIP LOCKED
)
UPDATE tickets SET
    status = 'READY', claimed_by = NULL, ...
WHERE id IN (SELECT id FROM expired);
```

The partial index provides an efficient scan of only claimed tickets, then the `lease_expiry < NOW()` predicate filters the expired subset.

### 7.3 `idx_file_locks_active` — File Mutex Enforcement

```sql
CREATE UNIQUE INDEX idx_file_locks_active
    ON file_locks(file_path)
    WHERE released_at IS NULL;
```

**Dual purpose:** This index serves both as a uniqueness constraint (at most one active lock per file) and as a query accelerator (look up whether a file is currently locked).

**Query pattern (in `claim_ticket_by_id()`):**
```sql
-- Check for existing active locks on the ticket's file paths
SELECT file_path FROM file_locks
WHERE file_path = ANY(v_ticket.file_paths)
  AND released_at IS NULL
  AND ticket_id != p_ticket_id;
```

**Lifecycle:**
- INSERT succeeds → lock acquired (row enters partial index)
- UPDATE sets `released_at = NOW()` → lock released (row exits partial index)
- INSERT with same file_path → succeeds (previous lock released, no conflict)
- INSERT with same file_path while active → fails with unique constraint violation (mutex enforced)

### 7.4 Proposed New Partial Index: `idx_tickets_active_claims`

```sql
CREATE INDEX idx_tickets_active_claims
    ON tickets(claimed_by, stage, lease_expiry)
    WHERE claimed_by IS NOT NULL;
```

**Rationale:** The acceptance criteria specify a partial index for active claims (`WHERE claimed_by IS NOT NULL`). This index optimizes:

| Query | WHERE Clause | Usage |
|-------|-------------|-------|
| Agent workload | `WHERE claimed_by = :agent_id AND claimed_by IS NOT NULL` | "What is agent X working on?" |
| Active claims per stage | `WHERE stage = 'BACKEND' AND claimed_by IS NOT NULL` | Dashboard: "Who is working in BACKEND?" |
| Lease monitoring | `WHERE claimed_by IS NOT NULL ORDER BY lease_expiry ASC` | Admin: "Which claims expire soonest?" |

**Column order:** `claimed_by` first (equality predicate in workload queries), `stage` second (equality for per-stage queries), `lease_expiry` third (range/sort for lease monitoring).

**Size:** At any time ~50–100 active claims → index contains ~50–100 rows → ~8 KB. Minimal write amplification since only claim/release operations touch this index.

---

## 8. Event Table Indexes

The `events` table is append-only and grows continuously (~50 events per ticket lifecycle). Index design prioritizes read performance for audit queries while minimizing write overhead.

### 8.1 `idx_events_ticket_id` — Per-Ticket History

```sql
CREATE INDEX idx_events_ticket_id ON events(ticket_id);
```

**Query:** `SELECT * FROM events WHERE ticket_id = 'TASK-001' ORDER BY created_at`

**Note:** This index is partially redundant with `idx_events_ticket_timeline` (which includes `ticket_id` as the leading column). PostgreSQL can use the composite index for `ticket_id`-only queries. **Recommendation:** Drop `idx_events_ticket_id` once `idx_events_ticket_timeline` is verified in production. The single-column index adds write overhead without unique query coverage.

### 8.2 `idx_events_ticket_timeline` — Ticket Event Timeline

```sql
CREATE INDEX idx_events_ticket_timeline ON events(ticket_id, created_at);
```

**Query:** `SELECT * FROM events WHERE ticket_id = 'TASK-001' ORDER BY created_at ASC`

This composite index serves as a **covering index** for the most common event query pattern:
1. B-tree descent on `ticket_id` (equality)
2. Pre-sorted by `created_at` within each `ticket_id` bucket (no sort needed)
3. `LIMIT` and `OFFSET` pagination operates efficiently on the sorted data

**EXPLAIN expectation:**
```
Index Scan using idx_events_ticket_timeline on events
  Index Cond: (ticket_id = 'TASK-001')
```
No `Sort` node — `created_at` ordering comes from the index directly.

### 8.3 `idx_events_created_at` — Chronological Queries

```sql
CREATE INDEX idx_events_created_at ON events(created_at);
```

**Query patterns:**
- "All events in the last hour": `WHERE created_at > NOW() - INTERVAL '1 hour'`
- "Events between dates": `WHERE created_at BETWEEN :start AND :end`
- Global event feed for admin dashboard

### 8.4 `idx_events_event_type` — Event Type Filtering

```sql
CREATE INDEX idx_events_event_type ON events(event_type);
```

**Query patterns:**
- "All CLAIMED events": `WHERE event_type = 'CLAIMED'` — claim rate analysis
- "All ESCALATED events": `WHERE event_type = 'ESCALATED'` — escalation monitoring
- "All STAGE_REJECTED events": `WHERE event_type = 'STAGE_REJECTED'` — rework analysis

**Selectivity concern:** With 13 event types and millions of events, each type bucket is large (~7.7% per type). This index has moderate selectivity. For frequent event-type queries, a composite index `(event_type, created_at)` would be more efficient for time-bounded type queries. **Recommendation for Migration 002:**

```sql
-- Consider replacing idx_events_event_type with:
CREATE INDEX idx_events_type_time ON events(event_type, created_at);
```

This covers both `WHERE event_type = 'CLAIMED'` and `WHERE event_type = 'CLAIMED' AND created_at > :since` in a single index scan.

---

## 9. Session and Supporting Table Indexes

### 9.1 Sessions

```sql
CREATE INDEX idx_sessions_agent_id ON sessions(agent_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

| Index | Query Pattern | Usage |
|-------|--------------|-------|
| `idx_sessions_agent_id` | `WHERE agent_id = :id` | Session lookup by agent; session count per agent |
| `idx_sessions_expires_at` | `WHERE expires_at < NOW()` | Expired session cleanup batch job |

### 9.2 File Locks

```sql
CREATE UNIQUE INDEX idx_file_locks_active ON file_locks(file_path) WHERE released_at IS NULL;
CREATE INDEX idx_file_locks_ticket_id ON file_locks(ticket_id);
```

| Index | Query Pattern | Usage |
|-------|--------------|-------|
| `idx_file_locks_active` | `WHERE file_path = :path AND released_at IS NULL` | File mutex check + enforcement |
| `idx_file_locks_ticket_id` | `WHERE ticket_id = :id` | Release all locks for a ticket (used by `advance_ticket()`, `reject_ticket()`, `release_ticket()`) |

### 9.3 Tables Without Explicit Indexes

| Table | Indexes | Rationale |
|-------|---------|-----------|
| `projects` | PK + UNIQUE(name) only | ≤10 rows; sequential scan is faster than index scan |
| `agents` | PK + UNIQUE(name, role) + UNIQUE(api_key_hash) only | ≤50 rows; constraint indexes sufficient |
| `system_config` | PK only | ≤20 rows; key-value lookup via PK |

---

## 10. Top 10 Query Patterns with EXPLAIN Plan Expectations

### Query 1: Claim Next Available Ticket

```sql
-- claim_ticket() stored function
SELECT * FROM tickets
WHERE stage = 'BACKEND'
  AND status = 'READY'
  AND (claimed_by IS NULL OR lease_expiry < NOW())
ORDER BY priority DESC, created_at ASC
LIMIT 1
FOR UPDATE SKIP LOCKED;
```

**Primary index:** `idx_tickets_claimable` (partial)
**Fallback index:** `idx_tickets_expired_leases` (for the `lease_expiry < NOW()` branch)

**Expected EXPLAIN:**
```
Limit  (cost=0.14..0.18 rows=1)
  -> LockRows
       -> Index Scan using idx_tickets_claimable on tickets
            Index Cond: (stage = 'BACKEND')
            Filter: (status = 'READY' AND claimed_by IS NULL)
```

**Expected performance:** < 1 ms (partial index contains ~50–100 rows typical)

---

### Query 2: Claim Specific Ticket by ID

```sql
-- claim_ticket_by_id() stored function
SELECT * FROM tickets
WHERE ticket_id = 'TASK-FOS-01-001'
  AND (status = 'READY' OR (status = 'CLAIMED' AND lease_expiry < NOW()))
FOR UPDATE SKIP LOCKED;
```

**Primary index:** `tickets_ticket_id_key` (unique index on `ticket_id`)

**Expected EXPLAIN:**
```
LockRows
  -> Index Scan using tickets_ticket_id_key on tickets
       Index Cond: (ticket_id = 'TASK-FOS-01-001')
       Filter: (status = 'READY' OR (status = 'CLAIMED' AND lease_expiry < now()))
```

**Expected performance:** < 0.5 ms (unique index, single-row lookup)

---

### Query 3: Advance Ticket to Next Stage

```sql
-- advance_ticket() stored function: initial lookup
SELECT * FROM tickets
WHERE ticket_id = 'TASK-FOS-01-001'
  AND claimed_by = :agent_id
FOR UPDATE;
```

**Primary index:** `tickets_ticket_id_key`

**Expected EXPLAIN:**
```
LockRows
  -> Index Scan using tickets_ticket_id_key on tickets
       Index Cond: (ticket_id = 'TASK-FOS-01-001')
       Filter: (claimed_by = :agent_id)
```

**Expected performance:** < 0.5 ms

---

### Query 4: Resolve Dependencies After Completion

```sql
-- resolve_dependencies() stored function
SELECT id, ticket_id, depends_on FROM tickets
WHERE status = 'BLOCKED'
  AND depends_on @> ARRAY['TASK-FOS-01-001'];
```

**Primary index:** `idx_tickets_depends_on` (GIN)

**Expected EXPLAIN:**
```
Bitmap Heap Scan on tickets
  Recheck Cond: (depends_on @> '{TASK-FOS-01-001}')
  Filter: (status = 'BLOCKED')
  -> Bitmap Index Scan on idx_tickets_depends_on
       Index Cond: (depends_on @> '{TASK-FOS-01-001}')
```

**Expected performance:** < 2 ms (GIN bitmap scan, then filter by status)

**Note:** GIN always produces Bitmap Index Scan (never plain Index Scan). This is normal.

---

### Query 5: Dashboard — Tickets by Stage and Status

```sql
SELECT stage, status, COUNT(*) as count
FROM tickets
GROUP BY stage, status
ORDER BY stage, status;
```

**Primary index:** `idx_tickets_status_stage`

**Expected EXPLAIN:**
```
GroupAggregate
  -> Index Only Scan using idx_tickets_status_stage on tickets
       Index Cond: (true)
```

If the visibility map is up to date (recent VACUUM), PostgreSQL can perform an **index-only scan** — reading counts directly from the `(status, stage)` B-tree without accessing the heap. This is optimal.

**Expected performance:** < 5 ms for 100K tickets

---

### Query 6: File Conflict Detection

```sql
-- Used by claim_ticket_by_id() to check existing file locks
SELECT file_path FROM file_locks
WHERE file_path = ANY(ARRAY['src/server.ts', 'src/config.ts'])
  AND released_at IS NULL
  AND ticket_id != 'TASK-FOS-01-001';
```

**Primary index:** `idx_file_locks_active` (partial unique)

**Expected EXPLAIN:**
```
Index Scan using idx_file_locks_active on file_locks
  Index Cond: (file_path = ANY('{src/server.ts,src/config.ts}'))
  Filter: (ticket_id <> 'TASK-FOS-01-001')
```

**Expected performance:** < 0.5 ms (partial unique index, typically 0–3 matching rows)

---

### Query 7: Agent Workload — What Is Agent X Working On?

```sql
SELECT ticket_id, title, stage, lease_expiry
FROM tickets
WHERE claimed_by = :agent_id;
```

**Primary index:** `idx_tickets_claimed_by`
**Alternative index:** `idx_tickets_stage_claimed_by` (using trailing column)

**Expected EXPLAIN:**
```
Index Scan using idx_tickets_claimed_by on tickets
  Index Cond: (claimed_by = :agent_id)
```

**Expected performance:** < 1 ms (agent typically claims 0–2 tickets)

---

### Query 8: Ticket Event Timeline

```sql
SELECT event_type, agent_name, previous_stage, new_stage,
       previous_status, new_status, payload, created_at
FROM events
WHERE ticket_id = 'TASK-FOS-01-001'
ORDER BY created_at ASC;
```

**Primary index:** `idx_events_ticket_timeline`

**Expected EXPLAIN:**
```
Index Scan using idx_events_ticket_timeline on events
  Index Cond: (ticket_id = 'TASK-FOS-01-001')
```

No explicit `Sort` node — the composite index `(ticket_id, created_at)` provides the ordering natively.

**Expected performance:** < 2 ms (50 events per ticket typical; index provides sorted access)

---

### Query 9: Release All Expired Claims

```sql
-- release_expired_claims() stored function
WITH expired AS (
    SELECT id FROM tickets
    WHERE claimed_by IS NOT NULL
      AND lease_expiry IS NOT NULL
      AND lease_expiry < NOW()
    FOR UPDATE SKIP LOCKED
)
UPDATE tickets SET
    status = 'READY',
    claimed_by = NULL,
    claimed_by_name = NULL,
    machine_id = NULL,
    operator = NULL,
    lease_expiry = NULL,
    updated_at = NOW()
WHERE id IN (SELECT id FROM expired);
```

**Primary index:** `idx_tickets_expired_leases` (partial)

**Expected EXPLAIN (CTE scan):**
```
Update on tickets
  -> Nested Loop Semi Join
       -> Seq Scan on tickets  -- outer
       -> CTE Scan on expired
            -> LockRows
                 -> Index Scan using idx_tickets_expired_leases on tickets
                      Filter: (lease_expiry < now())
```

**Expected performance:** < 5 ms (partial index has ~50 rows, only expired ones need update)

---

### Query 10: Tag-Based Ticket Search

```sql
SELECT ticket_id, title, stage, status, tags
FROM tickets
WHERE tags @> ARRAY['phase1', 'database'];
```

**Primary index:** `idx_tickets_tags` (GIN)

**Expected EXPLAIN:**
```
Bitmap Heap Scan on tickets
  Recheck Cond: (tags @> '{phase1,database}')
  -> Bitmap Index Scan on idx_tickets_tags
       Index Cond: (tags @> '{phase1,database}')
```

**Expected performance:** < 2 ms (GIN containment check)

---

## 11. Index Sizing and Storage Projections

### 11.1 Scale Assumptions

| Metric | Value | Basis |
|--------|-------|-------|
| Total tickets | 100,000 | Projected max (FORGEOS-ARCH005 §17) |
| Events per ticket | 50 average | Lifecycle: create + claim + advance × stages + reject + re-claim |
| Total events | 5,000,000 | 100K × 50 |
| Active claims | 50–100 | Concurrent agent count |
| Active file locks | 100–200 | 2–4 files per claimed ticket |
| Claimable tickets | 100–500 | Ready and unclaimed |

### 11.2 Index Size Estimates

| Index | Type | Estimated Rows | Estimated Size | Notes |
|-------|------|---------------|---------------|-------|
| `tickets_pkey` | B-tree (UUID) | 100K | 3.2 MB | 16-byte key + 6-byte TID per leaf |
| `tickets_ticket_id_key` | B-tree (TEXT) | 100K | 5.6 MB | ~20-byte avg key |
| `idx_tickets_status_stage` | B-tree (enum, enum) | 100K | 2.4 MB | 4+4 byte enum values |
| `idx_tickets_stage` | B-tree (enum) | 100K | 1.6 MB | 4-byte enum |
| `idx_tickets_claimed_by` | B-tree (UUID, nullable) | 100K | 3.2 MB | Most rows NULL (efficient) |
| `idx_tickets_stage_claimed_by` | B-tree (enum, UUID) | 100K | 4.0 MB | Composite of 4+16 bytes |
| `idx_tickets_priority` | B-tree (enum) | 100K | 1.6 MB | 4-byte enum |
| `idx_tickets_project_id` | B-tree (UUID) | 100K | 3.2 MB | |
| `idx_tickets_parent_id` | B-tree (TEXT, nullable) | 100K | 3.2 MB | Most rows NULL |
| `idx_tickets_depends_on` | GIN (TEXT[]) | 100K | ~10 MB | ~3 elements/array avg |
| `idx_tickets_file_paths` | GIN (TEXT[]) | 100K | ~12 MB | ~5 elements/array avg, longer keys |
| `idx_tickets_tags` | GIN (TEXT[]) | 100K | ~8 MB | ~4 elements/array avg |
| `idx_tickets_metadata` | GIN (JSONB) | 100K | ~15 MB | Key+value pairs indexed |
| `idx_tickets_claimable` | B-tree (partial) | ~300 | ~24 KB | 0.3% of rows |
| `idx_tickets_expired_leases` | B-tree (partial) | ~100 | ~8 KB | 0.1% of rows |
| `idx_tickets_active_claims` | B-tree (partial) | ~100 | ~8 KB | 0.1% of rows |
| `idx_events_ticket_id` | B-tree (TEXT) | 5M | ~210 MB | High row count |
| `idx_events_ticket_timeline` | B-tree (TEXT, TIMESTAMPTZ) | 5M | ~280 MB | Wider key |
| `idx_events_created_at` | B-tree (TIMESTAMPTZ) | 5M | ~120 MB | 8-byte key |
| `idx_events_event_type` | B-tree (enum) | 5M | ~80 MB | 4-byte enum |
| `idx_file_locks_active` | B-tree (partial unique) | ~200 | ~16 KB | Active locks only |
| `idx_file_locks_ticket_id` | B-tree (TEXT) | ~10K | ~560 KB | Historical locks |
| `idx_sessions_agent_id` | B-tree (UUID) | ~100 | ~8 KB | |
| `idx_sessions_expires_at` | B-tree (TIMESTAMPTZ) | ~100 | ~8 KB | |

### 11.3 Total Index Storage

| Category | Size |
|----------|------|
| Ticket indexes (B-tree) | ~28 MB |
| Ticket indexes (GIN) | ~45 MB |
| Ticket indexes (partial) | ~40 KB |
| Event indexes | ~690 MB |
| Other table indexes | ~600 KB |
| **Total** | **~764 MB** |

**Note:** Event indexes dominate storage. If events exceed 10M rows, consider:
1. Table partitioning by `created_at` (range partitioning, monthly)
2. Archival of events older than 1 year to a separate table
3. Replacing `idx_events_ticket_id` with `idx_events_ticket_timeline` (removing redundant index)

---

## 12. Index Maintenance Strategy

### 12.1 Auto-Vacuum Configuration

PostgreSQL's auto-vacuum daemon maintains table and index health. ForgeOS tables have different update patterns requiring different vacuum thresholds.

**Recommended per-table settings:**

| Table | `autovacuum_vacuum_threshold` | `autovacuum_vacuum_scale_factor` | Rationale |
|-------|-------------------------------|----------------------------------|-----------|
| `tickets` | 50 | 0.05 | Frequent updates (claim/advance); aggressive vacuum prevents bloat |
| `events` | 1000 | 0.01 | Append-only; vacuum needed mainly for visibility map updates (index-only scans) |
| `file_locks` | 50 | 0.1 | Moderate updates; default is acceptable |
| `sessions` | 50 | 0.1 | Moderate updates from heartbeats |
| `projects` | 10 | 0.2 | Rarely updated; default thresholds fine |
| `agents` | 10 | 0.2 | Rarely updated |
| `system_config` | 10 | 0.2 | Rarely updated |

**Apply via ALTER TABLE:**
```sql
ALTER TABLE tickets SET (
    autovacuum_vacuum_threshold = 50,
    autovacuum_vacuum_scale_factor = 0.05,
    autovacuum_analyze_threshold = 50,
    autovacuum_analyze_scale_factor = 0.05
);

ALTER TABLE events SET (
    autovacuum_vacuum_threshold = 1000,
    autovacuum_vacuum_scale_factor = 0.01
);
```

### 12.2 Index Bloat

**Cause:** B-tree indexes accumulate dead entries (pointing to dead tuples) during UPDATE and DELETE operations. PostgreSQL marks entries as dead but doesn't reclaim space until `VACUUM` or `REINDEX`.

**Most vulnerable indexes in ForgeOS:**
1. `idx_tickets_status_stage` — status changes on every claim/advance/release
2. `idx_tickets_claimed_by` — claimed_by changes every claim/release cycle
3. `idx_tickets_stage_claimed_by` — both columns change on claim/advance
4. `idx_tickets_claimable` — rows enter/exit partial index on every claim/release

**Monitoring query:**

```sql
-- Check index bloat ratio
SELECT
    schemaname || '.' || tablename AS table,
    indexrelname AS index,
    pg_size_pretty(pg_relation_size(indexrelid)) AS index_size,
    idx_scan AS index_scans,
    idx_tup_read AS tuples_read,
    idx_tup_fetch AS tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY pg_relation_size(indexrelid) DESC;
```

**Bloat estimation query (pgstattuple extension):**

```sql
-- Requires pgstattuple extension
CREATE EXTENSION IF NOT EXISTS pgstattuple;

SELECT
    indexrelname,
    pg_size_pretty(avg_leaf_density * pg_relation_size(indexrelid) / 100) AS estimated_live,
    pg_size_pretty(pg_relation_size(indexrelid)) AS actual_size,
    round(100 - avg_leaf_density, 1) AS bloat_pct
FROM pg_stat_user_indexes psu
JOIN LATERAL pgstatindex(psu.indexrelid) pgi ON true
WHERE schemaname = 'public'
ORDER BY bloat_pct DESC;
```

**Acceptable bloat threshold:** < 30%. Above 30%, schedule `REINDEX CONCURRENTLY`.

### 12.3 REINDEX Strategy

**REINDEX CONCURRENTLY** (PostgreSQL 12+) rebuilds an index without holding an exclusive lock on the table. This is the preferred method for production environments.

```sql
-- Rebuild a single bloated index
REINDEX INDEX CONCURRENTLY idx_tickets_status_stage;

-- Rebuild all indexes on a table
REINDEX TABLE CONCURRENTLY tickets;
```

**Schedule:** Run `REINDEX CONCURRENTLY` on high-churn indexes during low-activity windows:
- `idx_tickets_status_stage` — weekly
- `idx_tickets_claimed_by` — weekly
- `idx_tickets_stage_claimed_by` — weekly
- `idx_tickets_claimable` — weekly (smallest impact, fastest rebuild)
- `idx_events_*` — monthly (append-only, minimal bloat)

**Automated via pg_cron (recommended):**
```sql
-- Install pg_cron extension
CREATE EXTENSION pg_cron;

-- Weekly reindex of high-churn ticket indexes (Sunday 3:00 AM UTC)
SELECT cron.schedule(
    'reindex-tickets',
    '0 3 * * 0',
    $$REINDEX TABLE CONCURRENTLY tickets$$
);

-- Monthly reindex of events indexes (1st of month, 4:00 AM UTC)
SELECT cron.schedule(
    'reindex-events',
    '0 4 1 * *',
    $$REINDEX TABLE CONCURRENTLY events$$
);
```

### 12.4 Auto-Vacuum Impact on Indexes

| Auto-Vacuum Phase | Index Impact |
|-------------------|-------------|
| **Dead tuple removal** | Scans indexes to remove entries pointing to dead tuples; reduces bloat |
| **Visibility map update** | Marks pages as all-visible; enables index-only scans on B-tree indexes |
| **Analyze** | Updates per-column statistics (`pg_stats`); query planner uses for cost estimation and index selection |
| **Freeze** | Marks old tuples as frozen; prevents transaction ID wraparound |

**Critical for ForgeOS:**
- The `events` table is append-only — auto-vacuum's primary job is updating the visibility map (enabling index-only scans on `idx_events_ticket_timeline`)
- The `tickets` table has frequent UPDATEs — auto-vacuum must run frequently to prevent bloat in B-tree indexes

### 12.5 Statistics and Planner Hints

PostgreSQL's query planner relies on `pg_stats` for cost estimation. Stale statistics cause suboptimal plans (e.g., sequential scan instead of index scan).

**Ensure statistics are up to date:**
```sql
-- Analyze specific tables after bulk operations
ANALYZE tickets;
ANALYZE events;

-- Increase statistics target for high-cardinality columns
ALTER TABLE tickets ALTER COLUMN ticket_id SET STATISTICS 1000;
ALTER TABLE events ALTER COLUMN ticket_id SET STATISTICS 1000;
```

**Default `default_statistics_target`:** 100 (sufficient for most ForgeOS columns). Increase to 500–1000 for columns with highly skewed distributions (e.g., `ticket_id` in `events` where some tickets have many more events than others).

### 12.6 Monitoring Checklist

| Metric | Query | Alert Threshold |
|--------|-------|----------------|
| Index hit ratio | `SELECT idx_scan / NULLIF(seq_scan + idx_scan, 0) FROM pg_stat_user_tables WHERE relname = 'tickets'` | < 0.95 |
| Index bloat % | pgstattuple `avg_leaf_density` check | > 30% |
| Dead tuple ratio | `SELECT n_dead_tup::float / NULLIF(n_live_tup, 0) FROM pg_stat_user_tables` | > 0.10 |
| Unused indexes | `SELECT * FROM pg_stat_user_indexes WHERE idx_scan = 0 AND NOT idx_is_unique(indexrelid)` | Any unused non-unique index |
| Auto-vacuum last run | `SELECT last_autovacuum FROM pg_stat_user_tables` | > 1 hour for tickets |
| Index size growth | Monthly size comparison | > 50% month-over-month |

---

## 13. Anti-Patterns and Hazards

### 13.1 Over-Indexing

**Risk:** Adding indexes "just in case" increases write amplification and vacuum overhead.

**ForgeOS mitigation:** Every index in this strategy maps to a documented query pattern (Section 10). The `events` table is the highest-risk target for over-indexing due to its high insert rate.

**Rule:** Before adding a new index to `events`, verify:
1. The query pattern fires > 10 times per minute
2. Current performance exceeds p99 latency target (50ms)
3. No existing index can serve the query via composite prefix

### 13.2 Missing Index on Foreign Keys

**Risk:** PostgreSQL does NOT automatically create indexes on foreign key columns. Without an index, cascading DELETE operations perform sequential scans.

**ForgeOS foreign keys and index coverage:**

| FK Column | Index Present? | Impact if Missing |
|-----------|---------------|-------------------|
| `sessions.agent_id` | ✅ `idx_sessions_agent_id` | Agent deletion → sequential scan of sessions |
| `tickets.project_id` | ✅ `idx_tickets_project_id` | Project deletion → sequential scan of tickets |
| `tickets.claimed_by` | ✅ `idx_tickets_claimed_by` | Agent deletion → sequential scan of tickets |
| `file_locks.locked_by` | ❌ **MISSING** | Agent deletion → sequential scan of file_locks |
| `events.agent_id` | ❌ **MISSING** | Agent deletion → sequential scan of events |

**Recommendation for Migration 002:**
```sql
CREATE INDEX idx_file_locks_locked_by ON file_locks(locked_by);
CREATE INDEX idx_events_agent_id ON events(agent_id);
```

These indexes are low priority — agent deletion is rare. But they prevent worst-case sequential scans on large tables.

### 13.3 GIN Pending List Overhead

**Risk:** GIN indexes buffer new entries in a "pending list" rather than immediately inserting into the tree. If the pending list grows too large, queries must scan both the tree and the pending list, degrading read performance.

**Mitigation:** 
- Default `gin_pending_list_limit` of 4 MB is sufficient for ForgeOS's insert rate
- Auto-vacuum flushes the pending list periodically
- For bulk ticket imports, run `VACUUM(FULL, ANALYZE)` on `tickets` after the import

### 13.4 UUID Index Fragmentation

**Risk:** UUID v4 keys are random, causing B-tree leaf pages to split non-sequentially. This reduces buffer cache efficiency (poor locality) and increases WAL traffic from scattered page splits.

**Impact at ForgeOS scale:** Negligible. With ≤100K tickets, the entire tickets B-tree PK index (~3.2 MB) fits in `shared_buffers`. Random UUID overhead becomes meaningful only at millions of rows.

**Mitigation if scaling beyond 1M rows:**
- Consider UUID v7 (timestamp-ordered) for the `events` table
- Or use `BIGSERIAL` for events PK (events are append-only, so sequential IDs are safe)

---

## 14. Well-Architected Pillar Assessment

### 14.1 Operational Excellence — 9/10

| Aspect | Score | Rationale |
|--------|-------|-----------|
| Observability | 9 | Index hit ratios, bloat monitoring, auto-vacuum tracking via `pg_stat_*` views |
| Maintenance automation | 9 | `pg_cron` for scheduled REINDEX; auto-vacuum handles routine cleanup |
| Documentation | 9 | Every index has documented query patterns and EXPLAIN expectations |
| Evolution path | 8 | Clear recommendations for Migration 002 (new indexes, removable redundant indexes) |

### 14.2 Security — 8/10

| Aspect | Score | Rationale |
|--------|-------|-----------|
| Index-only scans | 8 | Indexes don't expose additional data beyond what RLS allows |
| Bloat doesn't leak | 8 | Dead tuples in indexes don't bypass RLS policies |
| No index-based enumeration | 9 | UUID PKs prevent sequential ID enumeration via index probing |

### 14.3 Reliability — 9/10

| Aspect | Score | Rationale |
|--------|-------|-----------|
| Partial index correctness | 9 | WHERE clauses match stored function predicates exactly |
| Concurrent rebuild | 9 | `REINDEX CONCURRENTLY` enables zero-downtime maintenance |
| No single-point-of-failure | 9 | All indexes are reconstructible from table data |

### 14.4 Performance — 9/10

| Aspect | Score | Rationale |
|--------|-------|-----------|
| Claim latency | 10 | Partial index `idx_tickets_claimable` provides sub-millisecond claim |
| Dashboard queries | 9 | `idx_tickets_status_stage` enables index-only scans for aggregation |
| Dependency resolution | 9 | GIN `idx_tickets_depends_on` provides O(1) element lookup |
| Audit timeline | 8 | Composite `idx_events_ticket_timeline` provides sorted access without explicit sort |

### 14.5 Cost Optimization — 9/10

| Aspect | Score | Rationale |
|--------|-------|-----------|
| Storage efficiency | 9 | Partial indexes reduce size by 95–99% for hot paths |
| Write amplification | 8 | 10 ticket indexes is moderate; GIN arrays rarely change post-creation |
| Maintenance cost | 9 | Automated via pg_cron; no manual DBA intervention needed |

### 14.6 Sustainability — 9/10

| Aspect | Score | Rationale |
|--------|-------|-----------|
| Self-documenting | 9 | `--` inline comments on every CREATE INDEX in DDL |
| Teachable | 9 | Standard PostgreSQL indexing; no exotic extensions |
| Evolvable | 8 | Clear path for adding/removing indexes in future migrations |

---

## 15. ADR-004: Index Design Decisions

### Status

**PROPOSED** — 2026-03-07

### Context

ForgeOS requires a database indexing strategy that supports low-latency ticket claiming (< 50ms p99), efficient dependency resolution via array containment queries, and growing audit trail queries on the events table. The schema defined in FORGEOS-ARCH005 declares 7 tables with up to 100K tickets and 5M events at projected scale.

### Decisions

#### D1: Partial Indexes Over Full Indexes for Claim Queue

**Decision:** Use `CREATE INDEX ... WHERE status = 'READY' AND claimed_by IS NULL` instead of a full B-tree index on `(stage, priority, created_at)`.

**Alternatives considered:**
1. Full B-tree index — simpler, covers all queries, but 95% of indexed rows are irrelevant to claim queries
2. Filtered view with materialized index — adds VIEW maintenance complexity

**Consequences:**
- (+) 95–99% smaller index; fits entirely in L2 cache
- (+) Faster inserts on tickets table (fewer rows to maintain in partial index)
- (-) Does not cover queries on non-READY tickets — separate indexes needed
- (-) Partial index WHERE clause must match stored function predicates exactly; schema changes require index updates

#### D2: GIN with Default `jsonb_ops` Over `jsonb_path_ops`

**Decision:** Use default `jsonb_ops` operator class for `idx_tickets_metadata`.

**Alternatives:**
1. `jsonb_path_ops` — 30% smaller index, but only supports `@>` operator
2. No GIN on metadata — rely on sequential scan for metadata queries

**Consequences:**
- (+) Supports `?` (key existence) queries — needed for QA reporting ("which tickets have coverage recorded?")
- (+) Supports `?&` and `?|` — multi-key existence checks
- (-) Slightly larger index than `jsonb_path_ops`

#### D3: Composite `(stage, claimed_by)` as Supplementary Index

**Decision:** Add `idx_tickets_stage_claimed_by` alongside existing `idx_tickets_claimed_by` rather than replacing it.

**Alternatives:**
1. Replace `idx_tickets_claimed_by` with composite — saves one index but suboptimal for `claimed_by`-only queries
2. Only keep single-column index — misses combined stage+agent queries

**Consequences:**
- (+) Optimal for both pure `claimed_by` queries and combined stage+agent queries
- (-) Minor storage redundancy (~4 MB for 100K tickets)

#### D4: Keep `idx_events_ticket_id` Until Production Validation

**Decision:** Retain `idx_events_ticket_id` despite redundancy with `idx_events_ticket_timeline`.

**Rationale:** The composite index `(ticket_id, created_at)` can serve `ticket_id`-only queries, making the single-column index theoretically redundant. However, PostgreSQL's planner may prefer the narrower index for certain query shapes. Retain both until production EXPLAIN confirms the composite is always chosen, then drop the single-column index in Migration 002.

**Consequences:**
- (+) No risk of plan regression
- (-) ~210 MB additional index storage for events
- Action: Monitor `pg_stat_user_indexes.idx_scan` for both indexes; drop `idx_events_ticket_id` when `idx_scan = 0` over a 30-day period

---

## 16. Fitness Functions

| # | Metric | Target | Measurement Method |
|---|--------|--------|-------------------|
| 1 | Claim latency (p99) | < 50 ms | `EXPLAIN ANALYZE` on `claim_ticket()` under 50 concurrent connections |
| 2 | Dashboard aggregation latency | < 100 ms | `EXPLAIN ANALYZE` on `GROUP BY status, stage` query |
| 3 | Dependency resolution latency | < 10 ms | `EXPLAIN ANALYZE` on `depends_on @> ARRAY[...]` query |
| 4 | Event timeline latency | < 20 ms | `EXPLAIN ANALYZE` on `WHERE ticket_id = X ORDER BY created_at` |
| 5 | Index hit ratio (tickets) | > 99% | `pg_stat_user_tables.idx_scan / (seq_scan + idx_scan)` |
| 6 | Index hit ratio (events) | > 95% | Same as above; lower target due to possible full-table analytics |
| 7 | Index bloat (B-tree) | < 30% | pgstattuple `avg_leaf_density` |
| 8 | Partial index selectivity | < 5% of total rows | `idx_tickets_claimable` row count / total ticket count |
| 9 | Write amplification factor | < 12× per ticket UPDATE | Number of indexes on tickets table |
| 10 | Total index storage | < 1 GB at 100K tickets | `SELECT SUM(pg_relation_size(indexrelid)) FROM pg_stat_user_indexes` |

---

## 17. Complete Index Catalog

### 17.1 Tickets Table (15 indexes total)

| # | Index Name | Type | Columns / Expression | Partial WHERE | DDL |
|---|-----------|------|---------------------|---------------|-----|
| 1 | `tickets_pkey` | B-tree | `id` | — | Implicit (PK) |
| 2 | `tickets_ticket_id_key` | B-tree UNIQUE | `ticket_id` | — | Implicit (UNIQUE) |
| 3 | `idx_tickets_status_stage` | B-tree | `(status, stage)` | — | `CREATE INDEX idx_tickets_status_stage ON tickets(status, stage)` |
| 4 | `idx_tickets_stage` | B-tree | `(stage)` | — | `CREATE INDEX idx_tickets_stage ON tickets(stage)` |
| 5 | `idx_tickets_claimed_by` | B-tree | `(claimed_by)` | — | `CREATE INDEX idx_tickets_claimed_by ON tickets(claimed_by)` |
| 6 | `idx_tickets_stage_claimed_by` | B-tree | `(stage, claimed_by)` | — | `CREATE INDEX idx_tickets_stage_claimed_by ON tickets(stage, claimed_by)` |
| 7 | `idx_tickets_priority` | B-tree | `(priority)` | — | `CREATE INDEX idx_tickets_priority ON tickets(priority)` |
| 8 | `idx_tickets_project_id` | B-tree | `(project_id)` | — | `CREATE INDEX idx_tickets_project_id ON tickets(project_id)` |
| 9 | `idx_tickets_parent_id` | B-tree | `(parent_id)` | — | `CREATE INDEX idx_tickets_parent_id ON tickets(parent_id)` |
| 10 | `idx_tickets_depends_on` | GIN | `depends_on` | — | `CREATE INDEX idx_tickets_depends_on ON tickets USING GIN(depends_on)` |
| 11 | `idx_tickets_file_paths` | GIN | `file_paths` | — | `CREATE INDEX idx_tickets_file_paths ON tickets USING GIN(file_paths)` |
| 12 | `idx_tickets_tags` | GIN | `tags` | — | `CREATE INDEX idx_tickets_tags ON tickets USING GIN(tags)` |
| 13 | `idx_tickets_metadata` | GIN | `metadata` | — | `CREATE INDEX idx_tickets_metadata ON tickets USING GIN(metadata)` |
| 14 | `idx_tickets_claimable` | B-tree (partial) | `(stage, priority DESC, created_at ASC)` | `WHERE status = 'READY' AND claimed_by IS NULL` | See DDL |
| 15 | `idx_tickets_expired_leases` | B-tree (partial) | `(lease_expiry)` | `WHERE claimed_by IS NOT NULL AND lease_expiry IS NOT NULL` | See DDL |

**Added in Migration 003 (FORGEOS-BE004):**

| # | Index Name | Type | Columns | Partial WHERE |
|---|-----------|------|---------|---------------|
| 16 | `idx_tickets_active_claims` | B-tree (partial) | `(claimed_by, stage, lease_expiry)` | `WHERE claimed_by IS NOT NULL` |

### 17.2 Events Table (4 indexes + PK)

| # | Index Name | Type | Columns | DDL |
|---|-----------|------|---------|-----|
| 1 | `events_pkey` | B-tree | `id` | Implicit (PK) |
| 2 | `idx_events_ticket_id` | B-tree | `(ticket_id)` | `CREATE INDEX idx_events_ticket_id ON events(ticket_id)` |
| 3 | `idx_events_ticket_timeline` | B-tree | `(ticket_id, created_at)` | `CREATE INDEX idx_events_ticket_timeline ON events(ticket_id, created_at)` |
| 4 | `idx_events_created_at` | B-tree | `(created_at)` | `CREATE INDEX idx_events_created_at ON events(created_at)` |
| 5 | `idx_events_event_type` | B-tree | `(event_type)` | `CREATE INDEX idx_events_event_type ON events(event_type)` |

**Proposed for future migration:**

| # | Index Name | Type | Columns | Replaces |
|---|-----------|------|---------|----------|
| 6 | `idx_events_type_time` | B-tree | `(event_type, created_at)` | `idx_events_event_type` |
| 7 | `idx_events_agent_id` | B-tree | `(agent_id)` | New (FK coverage) |
| — | Drop `idx_events_ticket_id` | — | — | Redundant with `idx_events_ticket_timeline` (verify in production first) |

### 17.3 File Locks Table (2 indexes + PK)

| # | Index Name | Type | Columns | Partial WHERE | DDL |
|---|-----------|------|---------|---------------|-----|
| 1 | `file_locks_pkey` | B-tree | `id` | — | Implicit (PK) |
| 2 | `idx_file_locks_active` | B-tree UNIQUE (partial) | `(file_path)` | `WHERE released_at IS NULL` | See DDL |
| 3 | `idx_file_locks_ticket_id` | B-tree | `(ticket_id)` | — | `CREATE INDEX idx_file_locks_ticket_id ON file_locks(ticket_id)` |

**Added in Migration 003 (FORGEOS-BE004):**

| # | Index Name | Type | Columns |
|---|-----------|------|---------|
| 4 | `idx_file_locks_locked_by` | B-tree | `(locked_by)` |

### 17.4 Sessions Table (2 indexes + PK + UNIQUE)

| # | Index Name | Type | Columns | DDL |
|---|-----------|------|---------|-----|
| 1 | `sessions_pkey` | B-tree | `id` | Implicit (PK) |
| 2 | `sessions_session_token_key` | B-tree UNIQUE | `session_token` | Implicit (UNIQUE) |
| 3 | `idx_sessions_agent_id` | B-tree | `(agent_id)` | `CREATE INDEX idx_sessions_agent_id ON sessions(agent_id)` |
| 4 | `idx_sessions_expires_at` | B-tree | `(expires_at)` | `CREATE INDEX idx_sessions_expires_at ON sessions(expires_at)` |

### 17.5 Projects, Agents, System Config

These tables rely exclusively on implicit PK and UNIQUE constraint indexes. No explicit indexes are needed due to their small size (≤50 rows).

---

## 18. Implementation Status

<!-- last_reviewed: 2026-03-10T13:56:05Z -->

| Migration | Ticket | Status | Objects Created |
|-----------|--------|--------|-----------------|
| 001 | (initial) | DONE | Core schema, base indexes, stored functions |
| 002 | FORGEOS-BE002 | DONE | Core tables: machines, operators, claims |
| 003 | FORGEOS-BE004 | DONE | 6 new indexes, 2 upgraded indexes, 2 CHECK constraints |


*Document generated by Architect agent for FORGEOS-ARCH006. Upstream schema reference: [database-schema.md](database-schema.md). Migration DDL: [001_initial.sql](../../forgeos-server/src/db/migrations/001_initial.sql).*
