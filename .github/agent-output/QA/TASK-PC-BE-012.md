# QA Report — TASK-PC-BE-012

## Verdict
- `FAIL`
- Not ready to advance from `QA`
- Confidence: `HIGH`
- Timestamp (UTC): `2026-03-15T16:43:59Z`

## Scope Reviewed
- `forgeos-server/src/services/compiler.ts`
- `forgeos-server/src/services/memory-provider.ts`
- `forgeos-server/src/services/context-hash.ts`
- `forgeos-server/src/__tests__/memory-snapshot-versioning.test.ts`

## Acceptance Criteria Verification
1. Same memory snapshot inputs yield deterministic lesson selection and ordering.
   - Verified by `src/__tests__/memory-snapshot-versioning.test.ts` asserting stable `learnings`, stable `bestPractices`, and identical snapshot `version` across repeated identical inputs.
2. Memory snapshot version changes alter the context hash inputs.
   - Verified by repeated `compileTicketPrompt('TASK-PC-BE-012')` executions with changed memory lesson content and assertions that both `memorySnapshotVersion` and `contextHash` change.
3. Packet generation preserves semantic separation between `LEARNINGS` and `BEST PRACTICES`.
   - Verified by fallback prompt-generation assertions that memory learnings remain only in `context.learnings` and instruction lessons remain only in `context.bestPractices`.
4. Partial memory-source degradation marks reduced completeness without crashing compile.
   - Verified by simulating an error payload from the instruction lesson search and asserting successful compile output plus `memoryCompleteness = 'reduced'` and `instruction-search-unavailable` warning propagation into the packet envelope.

## Test Evidence
- Command: `npm --prefix /home/reaperoak/Documents/ForgeOS/forgeos-server run test -- src/__tests__/memory-snapshot-versioning.test.ts src/__tests__/context-hash.test.ts src/__tests__/cognition-snapshot-versioning.test.ts src/__tests__/compiler-pipeline-determinism.test.ts --coverage.enabled true --coverage.provider v8 --coverage.reporter=text --coverage.reporter=json-summary --coverage.include=src/services/compiler.ts --coverage.include=src/services/memory-provider.ts --coverage.include=src/services/context-hash.ts`
- Result: `24/24 tests passed`, `4/4 test files passed`
- Duration: `549ms`

## Coverage Evidence
- Source: `forgeos-server/coverage/coverage-summary.json`
- `forgeos-server/src/services/compiler.ts`
  - Lines: `74.09%`
  - Statements: `74.09%`
  - Functions: `72.91%`
  - Branches: `50.71%`
- `forgeos-server/src/services/memory-provider.ts`
  - Lines: `78.52%`
  - Statements: `78.52%`
  - Functions: `100%`
  - Branches: `74.00%`
- `forgeos-server/src/services/context-hash.ts`
  - Lines: `97.95%`
  - Statements: `97.95%`
  - Functions: `100%`
  - Branches: `84.84%`
- Gate status: `FAIL` (`>=80%` line coverage is not met for all scoped implementation files; `compiler.ts` and `memory-provider.ts` remain below threshold.)

## Additional Validation
- Typecheck: `npm --prefix /home/reaperoak/Documents/ForgeOS/forgeos-server run typecheck` — `PASS`
- Lint: `npm --prefix /home/reaperoak/Documents/ForgeOS/forgeos-server run lint -- src/services/compiler.ts src/services/memory-provider.ts src/services/context-hash.ts src/__tests__/memory-snapshot-versioning.test.ts src/__tests__/context-hash.test.ts src/__tests__/cognition-snapshot-versioning.test.ts src/__tests__/compiler-pipeline-determinism.test.ts` — exit `0`, but the repo lint script still expands to `eslint "src/**/*.{ts,tsx}"` and reports `10` pre-existing warnings outside this ticket scope.
- Mutation testing: `N/A` — no mutation framework is configured in `forgeos-server/package.json` or repo test tooling for this ticket scope.

## Blocking Defects
- Coverage gate failure in `forgeos-server/src/services/compiler.ts`.
  - File-wide runtime coverage remains below the required threshold at `74.09%` lines and `50.71%` branches after the relevant regression suite.
- Coverage gate failure in `forgeos-server/src/services/memory-provider.ts`.
  - File-wide runtime coverage remains below the required threshold at `78.52%` lines and `74.00%` branches.

## Risks / Notes
- Functional behavior for all four acceptance criteria appears correct under the executed regression suite.
- The workspace did not contain an upstream backend summary file for `TASK-PC-BE-012`, so verification used the ticket brief, scoped implementation files, and executed regression tests directly.
- MCP ticket lifecycle tools were not available in this environment, so I could not submit `tickets.reject`; the rejection decision is documented here but not applied through the server.
