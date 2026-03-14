# QA Report — TASK-PC-BE-004 (Rework #1)

**Ticket:** Enforce Strict 11-Section Packet Schema Validator  
**Stage:** QA  
**Agent:** QA Engineer  
**Date:** 2026-03-14T21:10:00Z  
**Verdict:** ✅ PASS  
**Confidence:** HIGH

---

## Findings Summary

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| 1 | INFO | Test file placed at `src/services/packet-validator.test.ts` (co-located) vs ticket `file_paths` specifying `src/__tests__/` | ACCEPTED — co-location pattern; vitest picks it up normally |
| 2 | INFO | Line 106 in packet-validator.ts (`actual !== undefined` guard) uncovered — TypeScript defensive null-safety for `noUncheckedIndexedAccess`; arrays have equal length so guard never fires | EQUIVALENT MUTANT — not killable without contrived inputs |
| 3 | INFO | Queue-worker catch at compiler.ts:361 logs `err.message` (includes `structuredReason`) but does not separately surface `err.result.missingSections` array | ACCEPTABLE — message carries full context; fire-and-forget queue pattern |

No defects found. All findings are informational.

---

## Rework Items Verification

| Rework Item | Status | Evidence |
|-------------|--------|---------|
| 1. `packet-validator.ts` with 11-section enforcement | ✅ EXISTS | `src/services/packet-validator.ts` — REQUIRED_SECTIONS const array, `validatePacketSections`, `PacketValidationError` |
| 2. `packet-validator.test.ts` | ✅ EXISTS | `src/services/packet-validator.test.ts` — 24 tests, covers valid/empty/missing/misordered/class tests |
| 3. Validation gate in `compileTicketPrompt()` | ✅ INTEGRATED | compiler.ts:158-160 (Gemini path) and 176-178 (fallback path) both call `validatePacketSections()` and throw `PacketValidationError` |
| 4. `PROMPT_ARCHITECT_SYSTEM` 11-section alignment | ✅ FIXED | compiler.ts:74-94 — all 11 canonical sections in exact order: ROLE→TICKET→SYSTEM CONSTRAINTS→HISTORY→LEARNINGS→BEST PRACTICES→CONTEXT LOCATIONS→YOUR EXACT TASK→EXECUTION PLAN→EDGE CASES→POST-COMPLETION |

---

## Test Results

```
Test Files  2 passed (2)
      Tests  36 passed (36)  (24 packet-validator + 12 compiler)
   Duration  624ms
```

All tests pass. No failures, no skips.

---

## Coverage Report

| File | Lines | Branches | Functions | Gate (≥80%) |
|------|-------|----------|-----------|-------------|
| `packet-validator.ts` | **100%** | **91.66%** | **100%** | ✅ PASS |
| `compiler.ts` | **81.93%** | **83.72%** | **90%** | ✅ PASS |

Branch gap in `packet-validator.ts`: line 106 — `actual !== undefined` guard is a TypeScript `noUncheckedIndexedAccess` defensive check; arrays have equal length, making the `undefined` branch unreachable. Equivalent mutant.

---

## Typecheck

```
npm run typecheck → tsc --noEmit

Exit code: 0 — 0 errors
```

---

## Acceptance Criteria Verification

| AC | Statement | Verification | Result |
|----|-----------|-------------|--------|
| AC1 | Given a compiled packet, when validator runs, then all 11 sections must exist in exact order | `REQUIRED_SECTIONS` as const array in positional order; `validatePacketSections` compares actual position sequence against canonical; tests: `contains exactly 11 sections`, `contains all canonical section names in order`, `returns valid=true for correctly ordered packet` | ✅ PASS |
| AC2 | Given missing or misordered sections, when validator runs, then compile result is rejected with structured failure reason | `ValidationResult` interface exposes `missingSections[]`, `misordered[]`, `structuredReason`; `PacketValidationError` thrown carrying full result; tests cover missing SYSTEM CONSTRAINTS, EXECUTION PLAN, EDGE CASES, misordered TICKET-before-ROLE, reversed order | ✅ PASS |
| AC3 | Given two packet renders from identical inputs, when normalized, then section ordering and formatting are identical | Pure function with no global state; `REQUIRED_SECTIONS` is immutable `as const`; regex pattern matching is deterministic; no randomness or side effects | ✅ PASS |
| AC4 | Given compiler integration, when packet fails validation, then failure is surfaced as non-success compile outcome | `compileTicketPrompt()` throws `PacketValidationError` for both Gemini and fallback paths; compiler.test.ts tests verify throw for malformed Gemini output (missing SYSTEM CONSTRAINTS, EXECUTION PLAN, EDGE CASES) and malformed fallback output | ✅ PASS |

---

## Error Path Audit

**Direct call path (`compileTicketPrompt`):**
- Gemini path (line 158-160): `validatePacketSections(geminiResult.prompt)` → throws `PacketValidationError` if invalid ✅
- Fallback path (line 176-178): `validatePacketSections(fallback.prompt)` → throws `PacketValidationError` if invalid ✅
- Propagates to caller — caller responsibility to catch (AC4 contract)

**Queue worker path (`runCompileWorker`):**
- Calls `compileAndStoreTicketPrompt` → `compileTicketPrompt` → may throw `PacketValidationError`
- Caught by `.catch((err) => logger.error({...error: err.message...}, 'compiler: failed to compile/store prompt'))` at line 361
- Error is logged with `ticketId`, `trigger`, `idempotencyKey`, and `err.message` (which includes `structuredReason`)
- **Assessment:** Handled — not silently lost. Fire-and-forget queue design, intentional.

---

## Property / Determinism Analysis

`validatePacketSections(text)` is a pure function:
- No module-level mutable state
- `REQUIRED_SECTIONS` is `as const` (immutable TypeScript tuple)
- `positions` Map is local to each invocation
- All regex patterns are constructed inline (no compiled cache with state)
- Output is fully determined by input text alone ✅

---

## Definition of Done Checklist (QA scope)

| Item | Status |
|------|--------|
| All tests pass | ✅ 36/36 |
| Line coverage ≥80% for new code | ✅ packet-validator 100%, compiler 81.93% |
| Branch coverage ≥80% for new code | ✅ packet-validator 91.66%, compiler 83.72% |
| No unhandled error paths | ✅ Audited — queue path logs errors; direct path propagates |
| Typecheck clean | ✅ 0 errors |
| AC1–AC4 all verified | ✅ |
| No `sleep()` / execution-order dependencies | ✅ |
| No mocking of unit under test | ✅ compiler.test.ts mocks validatePacketSections (external dep), tests packet-validator.test.ts directly without mocks |

---

## Artifacts

- `.github/agent-output/QA/TASK-PC-BE-004.md` (this report)
- `forgeos-server/src/services/packet-validator.ts` (verified)
- `forgeos-server/src/services/packet-validator.test.ts` (verified)
- `forgeos-server/src/services/compiler.ts` (verified, gate integration confirmed)
- `forgeos-server/src/services/compiler.test.ts` (verified, 3 new validation tests present)
**Ticket:** Enforce Strict 11-Section Packet Schema Validator  
**Stage:** QA  
**Verdict:** ❌ REJECT  
**Confidence:** HIGH  
**Reviewed by:** QA Engineer  
**Date:** 2026-03-14T20:46:00Z

---

## Findings Summary (Critical First)

### CRITICAL-1: Primary Artifact Missing — `packet-validator.ts` Never Created

The ticket `file_paths` requires `forgeos-server/src/services/packet-validator.ts`.  
**This file does not exist.** No 11-section validator was implemented. This is the foundational deliverable for the entire ticket.

### CRITICAL-2: `__tests__/packet-validator.test.ts` Never Created

The ticket `file_paths` requires `forgeos-server/src/__tests__/packet-validator.test.ts`.  
**This file does not exist.**

### CRITICAL-3: AC1 Not Met — No 11-Section Presence/Order Enforcement

**AC1:** _"Given a compiled packet, when validator runs, then all 11 sections must exist in exact order."_

Architecture doc (`docs/architecture/prompt-compiler-architecture.md §5.1`) defines the mandatory order:
1. ROLE, 2. TICKET, 3. SYSTEM CONSTRAINTS, 4. HISTORY, 5. LEARNINGS, 6. BEST PRACTICES,
7. CONTEXT LOCATIONS, 8. YOUR EXACT TASK, 9. EXECUTION PLAN, 10. EDGE CASES, 11. POST-COMPLETION

No enforcement logic exists anywhere in the codebase. The `PROMPT_ARCHITECT_SYSTEM` constant in `compiler.ts` lists only **7 sections** (merging HISTORY & LEARNINGS, omitting SYSTEM CONSTRAINTS, EXECUTION PLAN, EDGE CASES) — a further schema drift from the architecture spec.

### CRITICAL-4: AC2 Not Met — No Structured Rejection for Malformed Packets

**AC2:** _"Given missing or misordered sections, when validator runs, then compile result is rejected with structured failure reason."_

No rejection path for malformed packets exists. No structured error type/interface for validation failure was created.

### CRITICAL-5: AC4 Not Met — Compiler Integration with Validation Gating Absent

**AC4:** _"Given compiler integration, when packet fails validation, then failure is surfaced as non-success compile outcome."_

`compileTicketPrompt()` and `compileAndStoreTicketPrompt()` have no validation gate. No compile result structure carries a `validationFailure` or equivalent field.

### MAJOR-1: Scope Mismatch — Wrong Feature Implemented

The backend implemented an **in-process compile queue + worker scheduling + idempotent enqueue** foundation (in `compiler.ts`). This is a legitimate infrastructure concern but addresses a **different ticket scope**, not TASK-PC-BE-004. Implemented features:
- `QueuedCompileJob` / `QueueCompileOptions` interfaces
- `compileQueue` Map with idempotency-key deduplication
- `scheduleCompileWorker()` / `runCompileWorker()` microtask coalescing
- `waitForCompileQueueToDrain()` test helper

None of these address the 11-section schema validator acceptance criteria.

### MINOR-1: AC3 Partially Addressed (Insufficient)

**AC3:** _"Given two packet renders from identical inputs, when normalized, then section ordering and formatting are identical."_

A `contextHash` (SHA-256 over inputs) exists and is stable across runs — this satisfies input-level determinism. However AC3 requires **output**-level section ordering/formatting determinism enforced by a normalizer. No such normalizer was written.

---

## Test Results

| Metric | Value | Gate | Status |
|--------|-------|------|--------|
| Test files | 1 (compiler.test.ts) | — | ✓ |
| Tests passed | 9 / 9 | all pass | ✓ |
| Tests failed | 0 | — | ✓ |
| Lines covered (compiler.ts) | 93.02% (440/473) | ≥80% | ✓ |
| Branches covered (compiler.ts) | 83.20% (104/125) | ≥80% | ✓ |
| Functions covered (compiler.ts) | 100.0% (27/27) | ≥80% | ✓ |
| packet-validator.ts tests | 0 / 0 | required | ✗ MISSING |

Tests that pass cover the queue/worker/idempotency code. Zero tests exist for the required 11-section validator.

---

## Acceptance Criteria Verdict

| AC | Statement (abbreviated) | Status |
|----|--------------------------|--------|
| AC1 | 11 sections present in exact order when validator runs | ❌ NOT MET |
| AC2 | Missing/misordered sections → rejected with structured reason | ❌ NOT MET |
| AC3 | Two identical-input renders → identical section ordering/formatting | ⚠️ PARTIAL (hash only, no normalizer) |
| AC4 | Compiler integration: validation failure → non-success outcome | ❌ NOT MET |

---

## Promise Handling Audit (Queue/Worker Code)

The queue/worker code that was submitted is technically sound:
- `runCompileWorker()` wraps each job in `.then()/.catch()` — no unhandled rejections
- `scheduleCompileWorker()` uses `void runCompileWorker()` inside `queueMicrotask()` — appropriate for fire-and-forget
- Worker re-schedules itself if queue grows during processing (`finally` block)
- `gatherInvestigation()` uses `Promise.all` for parallel MCP calls — no uncaught paths

No unhandled-promise defects found **in the submitted code**. The concern is that the submitted code does not address this ticket's scope.

---

## Rework Requirements

The backend agent must:

1. **Create `forgeos-server/src/services/packet-validator.ts`** implementing:
   - `REQUIRED_SECTIONS` constant: the exact 11-section ordered array from architecture §5.1
   - `validatePacketSections(text: string): ValidationResult` — parses rendered markdown for section headers, verifies all 11 present in exact order
   - `ValidationResult` type with `valid: boolean`, `missingsections: string[]`, `misordered: string[]`, `structuredReason: string`

2. **Create `forgeos-server/src/__tests__/packet-validator.test.ts`** (or `src/services/packet-validator.test.ts`) with ≥80% coverage covering:
   - Valid 11-section packet passes
   - Missing sections produces structured failure with correct fields
   - Misordered sections produces structured failure
   - Empty/null input is safely rejected

3. **Integrate validator into `compileTicketPrompt()`** in `compiler.ts`:
   - After prompt generation, call `validatePacketSections(compiledPrompt)`
   - If validation fails, return a non-success compile outcome (throw or return `{ valid: false, reason: ... }`)
   - Add test coverage for the validation-failure path in `compiler.test.ts`

4. **Align `PROMPT_ARCHITECT_SYSTEM`** prompt in `compiler.ts` to list all **11 sections** from architecture spec (currently only lists 7, missing SYSTEM CONSTRAINTS, HISTORY vs HISTORY & LEARNINGS split, EXECUTION PLAN, EDGE CASES).

The queue/idempotency code added in this submission may be retained (it is well-implemented) but must not be counted as delivery for this ticket.

---

## Evidence

- `forgeos-server/src/services/packet-validator.ts` — **absent**
- `forgeos-server/src/__tests__/packet-validator.test.ts` — **absent**
- `forgeos-server/src/services/compiler.ts` — present, modified for queue/worker only
- `forgeos-server/src/services/compiler.test.ts` — present, 9 tests for queue/worker only
- `docs/architecture/prompt-compiler-architecture.md §5.1` — defines 11 mandatory sections
- Test run: 9/9 pass, 93% line coverage on compiler.ts (queue code only)
- AC coverage: 1/4 partially met (AC3 hash-level only), 3/4 not addressed
