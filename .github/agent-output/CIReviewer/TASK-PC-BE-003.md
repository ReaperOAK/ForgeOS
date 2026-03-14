# TASK-PC-BE-003 — CI Review

- **Agent:** CI Reviewer
- **Stage:** CI
- **Date:** 2026-03-14T21:11:00Z
- **Verdict:** FAIL
- **Confidence:** HIGH

## Scope Reviewed
- `forgeos-server/src/services/compiler.ts`
- `forgeos-server/src/__tests__/context-hash.test.ts`

## Upstream Evidence Check
- QA summary found: `.github/agent-output/QA/TASK-PC-BE-003.md` (PASS)
- Security summary found: `.github/agent-output/Security/TASK-PC-BE-003.md` (PASS)
- Backend summary path provided by request was not present at `.github/agent-output/Backend/TASK-PC-BE-003.md`

## CI Checks (Executed From `forgeos-server/`)

1. `npm run typecheck`
- Result: PASS
- Output: `tsc --noEmit` completed without errors.

2. `npx eslint src/services/compiler.ts src/__tests__/context-hash.test.ts --max-warnings=0`
- Result: PASS
- Output: no lint errors/warnings for scoped files under default config.

3. `npx eslint src/services/compiler.ts --rule 'complexity:["warn",10]' --rule 'max-depth:["warn",1]' --max-warnings=0`
- Result: FAIL
- Output: 5 warnings (treated as blocking by `--max-warnings=0`):
  - `src/services/compiler.ts:159` `max-depth` (2 > 1)
  - `src/services/compiler.ts:337` `max-depth` (2 > 1)
  - `src/services/compiler.ts:339` `max-depth` (3 > 1)
  - `src/services/compiler.ts:375` `max-depth` (2 > 1)
  - `src/services/compiler.ts:398` `max-depth` (2 > 1)

4. `npx vitest run src/__tests__/context-hash.test.ts --coverage --coverage.reporter=json-summary`
- Result: FAIL
- Output: 3 failing tests, 8 passing tests.
- Failing tests:
  - `compiler freshness gate > recompiles when stored hash does not match current hash`
  - `compiler freshness gate > recompiles when no compiled prompt exists (missing case)`
  - `compiler freshness gate > explicit invalidation clears stored hash and forces recompile on next call`
- Failure reason (all 3): `PacketValidationError` due to missing required packet sections (`ROLE`, `TICKET`, `SYSTEM CONSTRAINTS`, `HISTORY`, `LEARNINGS`, `BEST PRACTICES`, `CONTEXT LOCATIONS`, `YOUR EXACT TASK`, `EXECUTION PLAN`, `EDGE CASES`, `POST-COMPLETION`).

5. Coverage gate (`context-hash.test.ts` coverage >= 80%)
- Result: BLOCKED/NOT SATISFIED
- `coverage-summary.json` was not produced by the failed coverage run, and the test gate itself failed. CI treats this as unmet coverage evidence for this run.

6. `npx madge --circular src/services/compiler.ts`
- Result: PASS
- Output: `No circular dependency found`.

## Findings

### Critical
- `CI-TEST-001`: Test gate failed with 3 failing tests in `src/__tests__/context-hash.test.ts` due to runtime `PacketValidationError` thrown from `src/services/compiler.ts:160` via `compileTicketPrompt`.

### Warnings
- `CI-CPLX-001`: `max-depth` threshold violation at `src/services/compiler.ts:159`.
- `CI-CPLX-002`: `max-depth` threshold violation at `src/services/compiler.ts:337`.
- `CI-CPLX-003`: `max-depth` threshold violation at `src/services/compiler.ts:339`.
- `CI-CPLX-004`: `max-depth` threshold violation at `src/services/compiler.ts:375`.
- `CI-CPLX-005`: `max-depth` threshold violation at `src/services/compiler.ts:398`.

## Score And Verdict
- Critical: 1
- Warnings: 5
- Suggestions: 0
- Quality score formula: `100 - (Critical * 25) - (Warning * 5) - (Suggestion * 1)`
- Quality score: `50/100`

**FAIL criteria met**:
- At least 1 critical finding
- Score below 60

## Required Rework
1. Fix freshness-gate test failures by ensuring the recompilation path in tests does not trigger packet validation failure unexpectedly.
2. Bring `compiler.ts` nesting depth into policy or explicitly refactor/justify policy exceptions.
3. Re-run CI command set and provide successful coverage evidence artifact for the required threshold gate.
