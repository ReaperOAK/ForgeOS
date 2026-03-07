# TASK-FOS-06-004 — BACKEND Complete

## Summary

Implemented the Webhook State Recovery Endpoint for GitHub push event processing
with HMAC-SHA256 verification, commit message parsing, and ghost commit
reconciliation engine.

## Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `forgeos-server/src/webhooks/parser.ts` | Pure-function GitHub push event parser; extracts CLAIM/WORK operations from commit messages | 216 |
| `forgeos-server/src/webhooks/reconciliation.ts` | Reconciliation engine; compares Git state with DB state, applies recovery rules | 609 |
| `forgeos-server/src/webhooks/github.ts` | Express router factory; POST / (push handler) + POST /recover (replay handler) with HMAC verification | 405 |
| `forgeos-server/src/webhooks/parser.test.ts` | Parser unit tests — 30 tests | 244 |
| `forgeos-server/src/webhooks/reconciliation.test.ts` | Reconciliation unit tests with mocked pool — 20 tests | 314 |
| `forgeos-server/src/webhooks/github.test.ts` | HMAC verification + HTTP handler integration tests — 22 tests | 365 |

## Test Results

```
✓ src/webhooks/parser.test.ts (30 tests)
✓ src/webhooks/reconciliation.test.ts (20 tests)
✓ src/webhooks/github.test.ts (22 tests)

Test Files  3 passed (3)
Tests       72 passed (72)
```

## Coverage

| File | Stmts | Branch | Funcs | Lines |
|------|-------|--------|-------|-------|
| parser.ts | 100% | 100% | 100% | 100% |
| reconciliation.ts | 98.84% | 94.44% | 100% | 98.84% |
| github.ts | 88.54% | 81.08% | 100% | 88.54% |
| **Overall** | **94.88%** | **90.09%** | **100%** | **94.88%** |

## Architecture Decisions

1. **Dependency Injection over direct imports**: `reconciliation.ts` defines `DatabasePool` and `StructuredLogger` interfaces rather than importing `pg` and `pino` directly. This enables lightweight mocking in tests and follows SOLID's Dependency Inversion Principle.

2. **Pure parser functions**: `parser.ts` has zero side effects — all functions are pure, stateless, and independently testable without mocking.

3. **Router factory pattern**: `createGitHubWebhookRouter(config)` takes injected dependencies and returns a configured Express Router, matching the existing codebase pattern in `server.ts`.

4. **express.raw() for HMAC**: The router uses `express.raw({ type: 'application/json' })` internally to preserve raw body bytes for HMAC-SHA256 verification. Must be mounted before `express.json()` or as a sub-application.

5. **Idempotent reconciliation**: CLAIM creation uses `UPDATE ... WHERE status = 'READY' RETURNING ticket_id` — if ticket was already claimed, the UPDATE matches 0 rows (no-op). WORK advancement uses `advance_ticket()` stored function with manual advance fallback.

6. **Agent UUID lookup for FK constraint**: The `valid_lease` CHECK constraint requires both `claimed_by` and `lease_expiry` to be NULL or both NOT NULL. Reconciliation looks up the agent UUID before creating a claim; if agent not found, flags as AMBIGUOUS rather than violating the constraint.

## Acceptance Criteria Coverage

| # | Criterion | Status |
|---|-----------|--------|
| 1 | POST /api/webhooks/github endpoint accepts push event payloads | ✅ Router with POST / handler |
| 2 | HMAC-SHA256 signature verification; rejects invalid with 401 | ✅ `verifyWebhookSignature()` + 9 tests |
| 3 | Parser extracts ticket_id, agent, machine, operator from CLAIM | ✅ `CLAIM_PATTERN` regex + 8 tests |
| 4 | Parser extracts ticket_id, stage, agent, machine from WORK | ✅ `WORK_PATTERN` regex + 4 tests |
| 5 | Ghost CLAIM recovery — creates DB claim (idempotent) | ✅ `reconcileClaimOp()` with RETURNING |
| 6 | Ghost WORK recovery — advances ticket in DB | ✅ `reconcileWorkOp()` with advance_ticket + manual fallback |
| 7 | Ambiguous divergence logged as WARNING | ✅ `AMBIGUOUS` action with logger.warn |
| 8 | All reconciliation ops recorded as RECONCILED events | ✅ `recordReconciliationEvent()` inserts into events table |
| 9 | Periodic reconciliation sweep (default 300s) | ✅ `runPeriodicReconciliation()` calls `release_expired_claims()` |
| 10 | Idempotent — replaying same webhook produces same result | ✅ Conditional UPDATE + RETURNING ensures no duplicate state changes |

## TDD Evidence

- **RED**: Wrote failing tests for parser patterns, reconciliation rules, and HMAC verification
- **GREEN**: Implemented minimum code to pass each test group
- **REFACTOR**: Extracted `extractRawBody()`, `parseBody()` helpers; introduced DI interfaces; split reconciliation into single-op and batch functions

## Mounting Instructions

The webhook router must be mounted **before** `express.json()` middleware:

```typescript
import { createGitHubWebhookRouter } from './webhooks/github.js';

const webhookRouter = createGitHubWebhookRouter({
  webhookSecret: config.WEBHOOK_SECRET,
  pool: getPool(),
  logger,
});
app.use('/api/webhooks/github', webhookRouter);
// Then mount express.json() for other routes
app.use(express.json());
```

## Confidence

**HIGH** — All 72 tests pass, 94.88% coverage, zero TypeScript errors, all acceptance criteria met.

## Timestamp

2026-03-07T22:01:00Z
