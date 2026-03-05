# FORGEOS-RES007 — Research Summary

> **Ticket:** FORGEOS-RES007 | **Agent:** Research Analyst | **Stage:** RESEARCH  
> **Date:** 2026-03-06 | **Confidence:** HIGH (88%)  
> **Deliverable:** `docs/research/pg-transaction-isolation.md`

---

## Research Question

What PostgreSQL transaction isolation level should ForgeOS use for each of its four primary operation types (ticket claiming, state advancement, dependency resolution, bulk sync)?

## Prior Belief → Posterior

- **Prior:** 70% — READ COMMITTED likely sufficient given explicit locking
- **Posterior:** 88% — Confirmed. All ForgeOS write operations use explicit `FOR UPDATE` / `FOR UPDATE SKIP LOCKED` locks which provide row-level serializability within READ COMMITTED. Higher isolation levels add serialization failure complexity without closing new anomaly vectors.

## Key Findings

### Recommendation: READ COMMITTED (default) for ALL operations

| Operation | Isolation | Confidence | Rationale |
|-----------|-----------|------------|-----------|
| Ticket Claiming | READ COMMITTED | 95% | `FOR UPDATE SKIP LOCKED` provides mutual exclusion. pgBoss/Graphile Worker use same pattern. |
| State Advancement | READ COMMITTED | 92% | `FOR UPDATE` provides exclusive row access. Claim ownership verified atomically. |
| Dependency Resolution | READ COMMITTED | 82% | MUST see latest committed state. Snapshot isolation would delay unblocking. Updates are idempotent. |
| Bulk Sync | READ COMMITTED | 90% | CTE-based batch operations are statement-atomic. Must see current lease state. |

### Why NOT Higher Isolation

- **REPEATABLE READ:** Snapshot visibility hides recently-committed DONE tickets from dependency resolution. Serialization failures on concurrent claims add complexity without benefit since SKIP LOCKED already handles contention.
- **SERIALIZABLE:** SIRead predicate locks on dependency resolution's wide read set cause near-certain serialization failures under ≥10 concurrent agents. Wasted work and retry overhead.

### Serialization Failure Handling

- Documented exponential backoff with decorrelated jitter retry pattern
- Implemented as defense-in-depth wrapper (`withSerializationRetry()`)
- Not needed under READ COMMITTED but protects future operations

## Weighted Comparison

| Level | Correctness (0.30) | Performance (0.25) | Simplicity (0.20) | Compatibility (0.15) | Flexibility (0.10) | **Total** |
|-------|:-:|:-:|:-:|:-:|:-:|:-:|
| READ COMMITTED | 9 | 10 | 10 | 10 | 7 | **9.35** |
| REPEATABLE READ | 8 | 7 | 5 | 9 | 8 | **7.30** |
| SERIALIZABLE | 10 | 4 | 3 | 7 | 10 | **6.30** |

## Contradictions Resolved

1. **"Always use SERIALIZABLE"** — Contextual: applies to apps without explicit locking. ForgeOS uses explicit locks.
2. **"REPEATABLE READ for consistency"** — Contextual: beneficial for OLAP, harmful for event-driven state machines needing latest state.
3. **"SSI failures are rare"** — Contextual: true for small read sets, false for ForgeOS's dependency resolution scanning the full graph.

## Artifacts

- Research report: `docs/research/pg-transaction-isolation.md`
- PoC SQL examples in report §8 (phantom reads, concurrent claims, write skew immunity)

## Acceptance Criteria Coverage

- [x] READ COMMITTED analyzed for claims: phantom read risks, concurrent claim safety (§3)
- [x] REPEATABLE READ analyzed for state transitions: snapshot isolation trade-offs (§4)
- [x] SERIALIZABLE analyzed for dependency resolution: failure rates, retry cost (§5)
- [x] Isolation level recommendation per operation type with justification (§6)
- [x] Serialization failure handling with exponential backoff strategy (§7)
- [x] Performance impact assessed with contention scenarios (§4.2, §5.2, §9)
- [x] Research report delivered at `docs/research/pg-transaction-isolation.md`

## Validity

- **Valid until:** 2026-09-06
- **Refresh triggers:** New operations without explicit locks, scale >100 agents, external security review
