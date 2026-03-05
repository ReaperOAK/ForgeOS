# FORGEOS-RES006 — Research Summary: PostgreSQL Connection Pooling Strategies

> **Agent:** Research Analyst | **Stage:** RESEARCH | **Date:** 2026-03-06  
> **Confidence:** HIGH (87%) | **Machine:** pop-os | **Operator:** reaperoak

---

## Research Question

What is the optimal PostgreSQL connection pooling strategy for ForgeOS, considering concurrent multi-agent workloads, advisory lock semantics, RLS session variables, and operational complexity?

## Key Findings

### 1. PgBouncer (External Pooler)

- **Transaction mode** is FULLY COMPATIBLE with all ForgeOS DB operations:
  - `pg_advisory_xact_lock` ✅ (transaction-scoped, released on COMMIT)
  - `SET LOCAL app.agent_role/agent_name` ✅ (RLS, transaction-scoped)
  - `SELECT FOR UPDATE SKIP LOCKED` ✅ (ticket claiming)
- **Session-scoped advisory locks (`pg_advisory_lock`) are BROKEN** in transaction mode — ForgeOS correctly uses transaction-scoped locks (per FORGEOS-RES005)
- **Statement mode** is INCOMPATIBLE (no transactions)
- PgBouncer ≥1.21 supports prepared statements via `max_prepared_statements`
- Operational overhead: separate container, ~15 lines docker-compose, ~2KB/connection memory
- **LISTEN/NOTIFY** broken in transaction mode — risk if webhooks require real-time push

### 2. asyncpg Pool (Python — Evaluated for Completeness)

- Python-only library — NOT applicable to ForgeOS's Node.js stack
- Full advisory lock compatibility (both session and transaction-scoped)
- Useful patterns mapped to `pg` Pool equivalents: `min_size` (no `pg` equivalent), `max_inactive_connection_lifetime` → `idleTimeoutMillis`, per-acquire hooks (ForgeOS uses `queryWithRLS` wrapper)

### 3. SQLAlchemy Async Pool (Python — Evaluated for Completeness)

- Python-only ORM — NOT applicable to ForgeOS's Node.js stack
- Notable pooling features: `pool_pre_ping` (checkout health check), `pool_recycle` (max connection age), `pool_use_lifo` (LIFO for idle timeout efficiency)
- These concepts are transferable to `pg` Pool via custom wrappers or PgBouncer server-side timeouts
- No Node.js ORM provides equivalent pool sophistication; raw `pg` Pool is simpler and sufficient

### 4. pg Pool (Current — Node.js)

- Already in use (`max: 10`, `idleTimeoutMillis: 30_000`)
- Recommended to increase `max` to 20 for production
- Add `waitingCount` monitoring for pool contention alerting
- Full PostgreSQL feature compatibility (all lock types, LISTEN/NOTIFY)

### 5. Advisory Lock Compatibility Matrix

| Lock Type | PgBouncer TX | PgBouncer Session | pg Pool | asyncpg |
|-----------|-------------|-------------------|---------|---------|
| `pg_advisory_xact_lock` | ✅ | ✅ | ✅ | ✅ |
| `pg_advisory_lock` (session) | ❌ | ✅ | ✅ | ✅ |
| `SET LOCAL` (RLS) | ✅ | ✅ | ✅ | ✅ |

### 6. Pool Sizing Recommendations

| Agents | Strategy | pg Pool `max` | PgBouncer | PG `max_connections` |
|--------|----------|---------------|-----------|---------------------|
| ≤10 | pg Pool only | 10 | Not needed | 100 (default) |
| 11-50 | pg Pool only | 20 | Optional | 100 (default) |
| 51-100 | pg Pool + PgBouncer TX mode | 10 | `pool_size=25` | 100 (default) |
| 100+ | pg Pool + PgBouncer TX mode | 10-15 | `pool_size=30-40` | 150+ |

## Recommendation

**Phased approach with HIGH confidence (87%):**

1. **Phase 1 (Immediate):** Tune `pg` Pool — increase `max` to 20, add `waitingCount` monitoring. Sufficient for ≤50 concurrent agents.
2. **Phase 2 (Scale):** Add PgBouncer in transaction mode when agents exceed 50 or multi-instance deployment is needed. Confirmed compatible with all ForgeOS DB patterns.
3. **Do NOT adopt:** asyncpg, SQLAlchemy, or Node.js ORMs for pooling — ForgeOS's raw SQL patterns are intentional and performant.

## Weighted Comparison Scores

| Strategy | Score (out of 10) |
|----------|------------------|
| pg Pool (current) | 8.60 |
| PgBouncer TX mode | 8.55 |
| asyncpg Pool | 7.80 (Python-only) |
| SQLAlchemy Async | 7.00 (Python-only) |

## Bayesian Update

- **Prior:** 75% — pg Pool sufficient for moderate concurrency
- **Posterior:** 87% — Confirmed. ForgeOS's short transactions ensure high connection reuse. PgBouncer compatibility with `pg_advisory_xact_lock` and `SET LOCAL` verified.

## Risks

- LISTEN/NOTIFY incompatibility with PgBouncer TX mode (mitigate: dedicated subscriber connection)
- Pool exhaustion under burst load (mitigate: `waitingCount` monitoring + alerting)

## Acceptance Criteria Status

| Criterion | Status |
|-----------|--------|
| PgBouncer evaluated (transaction/session modes, advisory lock compat, overhead) | ✅ Complete |
| asyncpg pool evaluated (sizing, health checks, async integration) | ✅ Complete |
| SQLAlchemy async pool evaluated (ORM benefits, config options) | ✅ Complete |
| Advisory lock compatibility assessed per strategy | ✅ Complete |
| Pool sizing for 10, 50, 100 concurrent agents | ✅ Complete |
| Recommendation with justification | ✅ Complete |
| Research report at docs/research/pg-connection-pooling.md | ✅ Delivered |

## Artifacts

- `docs/research/pg-connection-pooling.md` — Full research report (944+ lines)
- `.github/agent-output/Research/FORGEOS-RES006.md` — This summary

## Validity

- **Window:** 6 months (until 2026-09-06)
- **Refresh triggers:** PgBouncer breaking change, agent count >100, LISTEN/NOTIFY requirement, pg v9.x release
