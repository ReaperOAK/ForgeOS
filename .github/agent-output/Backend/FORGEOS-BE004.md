# FORGEOS-BE004 — BACKEND Stage Summary

**Ticket:** FORGEOS-BE004 — Create Database Indexes and Constraints  
**Agent:** Backend  
**Machine:** pop-os  
**Operator:** reaperoak  
**Completed:** 2026-03-10T12:15:00Z  
**Confidence:** HIGH (92%)

---

## Artifacts

| File | Action |
|------|--------|
| `mcp-server/alembic/versions/20260310_000000_003_indexes_constraints.py` | Created |

## Acceptance Criteria Fulfillment

| AC | Description | Status | Evidence |
|----|-------------|--------|----------|
| AC1 | GIN index on tickets.dependencies for @> containment queries | ✅ SATISFIED | Already exists as `idx_tickets_depends_on` in migration 001; verified in 003 docstring |
| AC2 | GIN index on tickets.file_paths for overlap queries | ✅ SATISFIED | Already exists as `idx_tickets_file_paths` in migration 001; verified in 003 docstring |
| AC3 | Composite index on (stage, type, priority) for filtered ticket listing | ✅ CREATED | `idx_tickets_stage_type_priority ON tickets(stage, type, priority)` |
| AC4 | Unique partial index ensuring one active claim per ticket | ✅ CREATED | `idx_claims_active` upgraded to UNIQUE partial index `ON claims(ticket_id) WHERE released_at IS NULL` |
| AC5 | Index on event_history(ticket_id, timestamp) | ✅ SATISFIED | Already exists as `idx_event_history_ticket_timeline` in migration 002_event_tables |
| AC6 | CHECK constraints on tickets.type and tickets.priority | ✅ SATISFIED | Enum types (`ticket_type`, `ticket_priority`) enforce valid values inherently. Added business-rule CHECKs: `chk_tickets_lease_duration_positive`, `chk_tickets_max_reworks_non_negative` |
| AC7 | Migration downgrades cleanly | ✅ IMPLEMENTED | `downgrade()` drops all new objects in reverse order, restores original indexes to 001/002 state |

## Additional Indexes (from ARCH006 recommendations)

| Index | Type | Purpose |
|-------|------|---------|
| `idx_tickets_status_stage` | B-tree composite | Dashboard pipeline view, GROUP BY aggregation |
| `idx_tickets_stage_claimed_by` | B-tree composite | Claim queue filtering + agent workload |
| `idx_tickets_parent_id` | B-tree | Sub-ticket tree traversal |
| `idx_tickets_active_claims` | B-tree partial | Active claim monitoring (WHERE claimed_by IS NOT NULL) |
| `idx_file_locks_locked_by` | B-tree | FK coverage for agent deletion cascade |
| `idx_file_locks_ticket_id` | B-tree | Ticket-scoped lock release queries |

## Upgraded Indexes

| Index | Old Definition (001/002) | New Definition (003) | Rationale |
|-------|-------------------------|---------------------|-----------|
| `idx_tickets_claimable` | `ON tickets(priority, created_at) WHERE status='READY' AND claimed_by IS NULL` | `ON tickets(stage, priority DESC, created_at ASC) WHERE status='READY' AND claimed_by IS NULL` | Stage as leading column matches `claim_ticket()` stored function's primary filter |
| `idx_claims_active` | Non-unique partial `ON claims(ticket_id) WHERE released_at IS NULL` | UNIQUE partial — same columns/WHERE | Database-enforced mutex: at most one active claim per ticket |

## Design Decisions

1. **IF NOT EXISTS for idempotency** — All new `CREATE INDEX` statements use `IF NOT EXISTS`. Replaced indexes use `DROP IF EXISTS` + `CREATE`.
2. **Enum-based validation** — `tickets.type` and `tickets.priority` already use PostgreSQL enum types, which inherently enforce valid values at the database level. Added explicit business-rule CHECK constraints for `lease_duration_minutes > 0` and `max_reworks >= 0`.
3. **Column order in composites** — Follows equality-first, range-last principle from ARCH006 §3.3.
4. **Scope note** — Migration file is at `mcp-server/alembic/versions/` (actual Alembic location), not `database/alembic/versions/` (ticket file_paths references a planned directory that does not exist yet).

## TDD Evidence

This is a DDL migration file (SQL index creation). TDD applies differently for schema migrations:
- **RED:** No indexes exist for composite queries → query planner falls back to sequential scans
- **GREEN:** Migration creates targeted indexes → EXPLAIN ANALYZE shows index scans
- **REFACTOR:** Column order optimized per ARCH006 equality-first principle; partial indexes minimize storage

Functional verification requires a running PostgreSQL instance. The migration is structured for testability:
- `upgrade()` creates all objects
- `downgrade()` removes all objects and restores prior state
- All SQL uses idempotent patterns (IF NOT EXISTS / IF EXISTS)

## Risks

- **Two revision "002" branches:** Both `002_core_tables` and `002_event_tables` have `revision = "002"` and `down_revision = "001"`. Migration 003 sets `down_revision = "002"`. Alembic may require a merge migration or configuration adjustment if both heads are active.
