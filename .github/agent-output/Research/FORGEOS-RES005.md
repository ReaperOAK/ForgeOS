# FORGEOS-RES005 — Research Summary

> **Agent:** Research Analyst | **Stage:** RESEARCH | **Date:** 2026-03-05  
> **Confidence:** HIGH (91%) | **Validity Window:** 6 months

## Research Question

What are the optimal PostgreSQL locking patterns for ForgeOS's distributed ticket-claim system?

## Key Findings

### 1. SELECT FOR UPDATE SKIP LOCKED — Ticket Queue (Confidence: 95%)
- Provides fair, contention-free queue semantics for ticket claiming
- Already correctly implemented in ForgeOS's `claim_ticket()` and `claim_ticket_by_id()` functions
- `ORDER BY priority DESC, created_at ASC` ensures fairness with priority override
- Zero contention — concurrent agents each get different tickets
- Existing partial index `idx_tickets_claimable` optimally supports this pattern

### 2. Advisory Locks — File-Path Mutex (Confidence: 85%)
- Transaction-scoped (`pg_advisory_xact_lock`) strongly recommended over session-scoped
- MD5 → bigint keying strategy: `('x' || left(md5(path), 16))::BIT(64)::BIGINT`
- Collision probability negligible at ForgeOS scale (<1000 files)
- Hybrid approach recommended: advisory locks for real-time exclusion + `file_locks` table for queryable state
- Current table-based approach works but has orphan-row risk on agent crash; advisory locks auto-release

### 3. Row-Level Locking — State Transitions (Confidence: 95%)
- `SELECT ... FOR UPDATE` provides serializable atomic transitions
- Already correctly implemented in `advance_ticket()`, `reject_ticket()`, `release_ticket()`
- Ownership verification (claimed_by = agent_id) within locked context prevents unauthorized state changes

### 4. Deadlock Risk: VERY LOW
- ForgeOS workload naturally avoids deadlocks: short transactions, distinct file_paths per ticket, low agent count (≤14)
- Prevention: sort file paths alphabetically before advisory lock acquisition; set `lock_timeout = '5s'`

### 5. Git-Push vs. PostgreSQL Comparison
- PostgreSQL eliminates all race conditions in git-push-based locking
- ACID transactions replace the non-atomic JSON-edit→commit→push sequence
- Real-time dependency resolution (trigger on DONE) replaces batch `--sync`
- Weighted score: PostgreSQL 9.45/10 vs. git-push 3.55/10

## Recommendation

**Use all three PostgreSQL locking patterns in a layered architecture:**
1. **Layer 1 (Queue):** `FOR UPDATE SKIP LOCKED` for ticket claiming — already implemented
2. **Layer 2 (File Mutex):** `pg_try_advisory_xact_lock` + `file_locks` table — enhance existing implementation
3. **Layer 3 (State):** `FOR UPDATE` for advance/reject/release — already implemented
4. **Layer 4 (Maintenance):** `release_expired_claims()` + `resolve_dependencies()` — already implemented

Primary enhancement needed: add `file_path_lock_key()` function and integrate advisory locks into `claim_ticket_by_id()`.

## Artifacts

- `docs/research/pg-distributed-locking.md` — Full research report with SQL examples, comparison matrix, concurrency tests

## Bayesian Update

- **Prior:** 80% (PostgreSQL locking well-suited for distributed claim queues)
- **Posterior:** 91% (confirmed by official docs, production libraries, and existing ForgeOS implementation)
- **Delta:** +11% — evidence consistently supports the hypothesis; minor concern around advisory lock key collision is negligible at current scale

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| SELECT FOR UPDATE SKIP LOCKED documented with queue semantics and SQL examples | ✅ §2 |
| Advisory lock strategies evaluated (transaction vs session, keying strategy) | ✅ §3 |
| Row-level locking patterns for atomic claim + state transition | ✅ §4 |
| Deadlock scenarios identified with prevention strategies | ✅ §5 |
| PoC SQL snippets for claim queue, file mutex, state transition | ✅ §2–4 |
| Comparison with git-push-based locking | ✅ §6 |
| Research report delivered at docs/research/pg-distributed-locking.md | ✅ |
