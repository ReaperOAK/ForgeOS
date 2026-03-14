# TASK-PC-BE-003 — Backend Rework #1

- **Agent:** Backend
- **Stage:** BACKEND
- **Date:** 2026-03-14
- **Status:** COMPLETE
- **Confidence:** HIGH

## Scope
- `forgeos-server/src/__tests__/context-hash.test.ts`
- `forgeos-server/src/services/compiler.ts`

## Root Cause Addressed
1. Freshness-gate tests were failing because `compileTicketPrompt()` now enforces packet validation and test stubs were not guaranteed to be 11-section packets.
2. `compiler.ts` exceeded strict `max-depth` policy at several locations called out by CI.

## Implementation

### 1) Test isolation fix (`context-hash.test.ts`)
- Added a focused `vi.mock('../services/packet-validator.js', ...)` stub so freshness-gate tests validate cache/hash behavior only.
- Mocked validator returns `{ valid: true }` and preserves exported shape (`validatePacketSections`, `PacketValidationError`).
- This keeps packet schema enforcement covered in validator/compiler tests elsewhere, while removing cross-concern coupling in context-hash freshness tests.

### 2) Max-depth refactor (`compiler.ts`)
- Flattened nested control flow using helper extraction and guard patterns:
  - Added `validateCompiledPromptOrThrow(prompt)` and reused it for Gemini path.
  - Replaced nested queue-worker loop with:
    - `dequeueCompileJob()`
    - `processCompileQueue()`
    - `processCompileJob(job)`
    - `scheduleWorkerIfQueuePending()`
  - Simplified queue drain polling by introducing `isCompileWorkerBusy()` and using it in loop condition.
- Behavior remains unchanged: queue idempotency, compile/store flow, logging, and reschedule semantics are preserved.

## Verification

1. `npx vitest run src/__tests__/context-hash.test.ts`
- **Result:** PASS
- **Details:** 11 passed, 0 failed

2. `npx eslint src/services/compiler.ts src/__tests__/context-hash.test.ts --rule 'complexity:["warn",10]' --rule 'max-depth:["warn",1]' --max-warnings=0`
- **Result:** PASS
- **Details:** 0 warnings, 0 errors

3. `npm run typecheck`
- **Result:** PASS
- **Details:** `tsc --noEmit` clean

4. `npx vitest run src/__tests__/context-hash.test.ts --coverage --coverage.reporter=json-summary`
- **Result:** PASS
- **Details:** 11 passed, 0 failed
- **Coverage evidence (`coverage/coverage-summary.json`):**
  - `src/services/context-hash.ts`: lines **97.67%**, branches **81.48%** (>= 80%)

## Artifacts
- `forgeos-server/src/__tests__/context-hash.test.ts`
- `forgeos-server/src/services/compiler.ts`
- `.github/agent-output/Backend/TASK-PC-BE-003.md`
