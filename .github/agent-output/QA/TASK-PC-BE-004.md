# QA Report — TASK-PC-BE-004
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
