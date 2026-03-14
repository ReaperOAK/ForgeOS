# TASK-PC-BE-001 — CI Review (CI Stage)

## Findings

### 🔴 Critical: Changed-file Coverage Gate Failed (AF-005)
**File:** `forgeos-server/src/services/compiler.ts`
**Evidence:** `forgeos-server/coverage/coverage-summary.json` reports `"/home/reaperoak/Documents/ForgeOS/forgeos-server/src/services/compiler.ts".lines.pct = 0`.
**Why this blocks:** CI policy requires coverage `>=80%` on changed files. This changed file is currently untested in this ticket run.
**Remediation:** Add targeted tests for compile path + fallback + packet metadata + investigation helpers, then rerun coverage.

### 🟡 Warning: Cyclomatic Complexity Exceeds Threshold
**File:** `forgeos-server/src/services/compiler.ts:347`
**Evidence:** ESLint rule `complexity` reports `gatherInvestigation` complexity `19` (threshold `10`).
**Remediation:** Split retrieval, lesson aggregation, blast-radius mapping, and symbol hint construction into dedicated helpers with early returns.

### 🟡 Warning: Cyclomatic Complexity Exceeds Threshold
**File:** `forgeos-server/src/services/compiler.ts:444`
**Evidence:** ESLint rule `complexity` reports `mapInvestigationToFallbackContext` complexity `13` (threshold `10`).
**Remediation:** Extract ticket mapping, lesson normalization, and file-scope mapping into separate pure functions.

### 🟡 Warning: Object Calisthenics Nesting Depth Violations (OC-001)
**File:** `forgeos-server/src/services/compiler.ts:117`
**Evidence:** ESLint `max-depth` warning: depth `2` (max `1`), with additional findings at `forgeos-server/src/services/compiler.ts:120`, `forgeos-server/src/services/compiler.ts:291`, `forgeos-server/src/services/compiler.ts:296`, `forgeos-server/src/services/compiler.ts:424`, `forgeos-server/src/services/compiler.ts:510`.
**Remediation:** Replace nested conditionals with guard clauses and helper extraction.

## Check Evidence
- `npm run lint` -> `0 errors, 10 warnings` (warnings are in unrelated files; non-blocking for this ticket scope).
- `npm run typecheck` -> PASS.
- `npm run test -- src/__tests__/db/migrate.test.ts` -> PASS (`16/16`).
- `npx eslint src/services/compiler.ts src/types/index.ts --max-warnings=0` -> PASS.
- `npx eslint src/services/compiler.ts --rule 'complexity: ["warn", 10]' --rule 'max-depth: ["warn", 1]' --rule 'no-else-return: ["warn"]' --format json` -> complexity/max-depth warnings recorded above.
- `npx madge --circular src/services/compiler.ts src/types/index.ts` -> PASS (no circular dependencies).
- `npx vitest run src/__tests__/db/migrate.test.ts --coverage --coverage.reporter=json-summary` -> changed file `forgeos-server/src/services/compiler.ts` lines coverage `0%`.
- Upstream stage verdicts verified: `.github/agent-output/QA/TASK-PC-BE-001.md` PASS and `.github/agent-output/Security/TASK-PC-BE-001.md` PASS.

## Verdict
- **REJECT**
- **Quality Score:** 60/100
- **Scoring:** `100 - (1 * 25) - (3 * 5) = 60`
- **Confidence:** HIGH

## Required Rework
1. Raise changed-file coverage for `forgeos-server/src/services/compiler.ts` to `>=80%`.
2. Reduce `gatherInvestigation` complexity to `<=10`.
3. Reduce `mapInvestigationToFallbackContext` complexity to `<=10`.
4. Flatten nesting to satisfy OC-001 depth expectations.

## Artifacts
- `.github/agent-output/CIReviewer/TASK-PC-BE-001.md`
- `.github/agent-output/CIReviewer/TASK-PC-BE-001.sarif`
