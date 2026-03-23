# TASK-INT-BE018 — BACKEND Complete

## Summary
Integration tests for the MCP-only ticket workflow. Covers the full lifecycle: spawn → claim → payload → advance → reject/rework → complete to DONE.

## Artifacts
- `forgeos-server/src/__tests__/integration/mcp-workflow.test.ts` (NEW — 877 lines, 17 tests)

## Acceptance Criteria Verification

| AC | Description | Status | Tests |
|----|-------------|--------|-------|
| AC1 | `tickets.spawn` — create child ticket | ✅ PASS | 2 tests (success + TICKET_NOT_FOUND) |
| AC2 | `tickets.claim` — claim a ticket | ✅ PASS | 2 tests (success + ALREADY_CLAIMED) |
| AC3 | `tickets.payload` — retrieve delegation context | ✅ PASS | 2 tests (full payload + NOT_FOUND) |
| AC4 | `tickets.complete` — advance through stages | ✅ PASS | 4 tests (BACKEND→QA, QA→SECURITY, NOT_CLAIM_OWNER, TICKET_NOT_FOUND) |
| AC5 | `tickets.reject` — rework flow | ✅ PASS | 3 tests (rework, escalation, re-claim after rework) |
| AC6 | Full lifecycle — spawn through DONE | ✅ PASS | 1 test (spawn → claim → BACKEND → QA reject → rework → QA → SECURITY → CI → DOCS → VALIDATOR → DONE + dependency unblock) |
| AC7 | Test isolation — mocked database | ✅ PASS | 3 tests (pool.query mock, pool.connect mock, mock clearing) |

## Test Results
```
17 passed (17)
Duration: 384ms
```

## TDD Evidence
- RED: Wrote failing test assertions for each handler's expected behavior
- GREEN: Configured mocks to match handler call patterns (pool.query for claim/complete/reject/payload, pool.connect for spawn transactions)
- REFACTOR: Added beforeEach(vi.clearAllMocks) to AC7 describe block to fix mock leakage

## Decisions
- Used `vi.hoisted()` pattern consistent with existing tests in `src/__tests__/tools/`
- Mocked `pool.connect()` with transaction client (`BEGIN`/`COMMIT`/`RELEASE`) for spawn handler
- Full lifecycle test exercises 8 stage transitions including one rework cycle
- Dependency unblocking verified in DONE stage completion

## Confidence: HIGH
