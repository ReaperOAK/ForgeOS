# Definition of Done (DoD) Template

> **Schema Version:** 1.0
> **Source:** `docs/architecture/sdlc-enforcement-design.md` §3
> **Usage:** Copy this template per task. Fill metadata, check items, provide evidence.
> **Report Path:** `docs/reviews/dod/{TASK_ID}-dod.yaml`
> **Compatible With:** `delegation-packet-schema.json` → `dod_checklist` field

---

## Metadata

| Field          | Value                          |
|----------------|--------------------------------|
| **task_id**    | `__TASK_ID__`                  |
| **task_title** | `__TASK_TITLE__`               |
| **agent**      | `__AGENT_NAME__`               |
| **project**    | `__PROJECT_NAME__`             |
| **submitted_at** | `__ISO8601_TIMESTAMP__`      |
| **validated_by** | `__VALIDATOR_OR_NULL__`       |
| **validated_at** | `__ISO8601_TIMESTAMP_OR_NULL__` |
| **verdict**    | `PENDING` \| `APPROVED` \| `REJECTED` |

---

## DoD Checklist

All 10 items must pass before a ticket can advance past QA_REVIEW.
Validator approval (DOD-07 verdict) is required before VALIDATION state.

<!-- Machine-parseable: each checkbox line maps to a dod_checklist boolean field.
     Field mapping: DOD-01 → code_implemented, DOD-02 → tests_written, etc.
     Agents fill DOD-01–06, DOD-08–10 (self-assessment).
     Only Validator may set DOD-07 to true. -->

### DOD-01: Code Implemented

- [ ] **Status:** Feature or fix matches all acceptance criteria from the task definition.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | All acceptance criteria listed in the TODO task or delegation packet are addressed in code. No partial implementations. |
| **Evidence Required**  | File paths of changed/created files; diff summary showing each acceptance criterion is covered. |
| **Verification Method** | Compare deliverables against `todo_acceptance_criteria[]` from the delegation packet. Each criterion must map to a concrete code change. |
| **Schema Field**       | `dod_checklist.code_implemented` |

---

### DOD-02: Tests Written

- [ ] **Status:** Unit tests at minimum; integration tests if applicable. Coverage ≥ 80% for new code.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | Unit tests exist for all new or modified functions. Integration tests cover cross-boundary interactions where applicable. Code coverage for new code is at least 80%. |
| **Evidence Required**  | Test file paths; test runner output showing pass counts; coverage report (line/branch percentage for new code). |
| **Verification Method** | Run test suite (`npm test` / `npx vitest` / `npx jest`). Verify coverage threshold via `--coverage` flag. Confirm no skipped or pending tests for new code. |
| **Schema Field**       | `dod_checklist.tests_written` |

---

### DOD-03: Lint Passes

- [ ] **Status:** Zero errors and zero warnings from the project linter.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | ESLint (or project-equivalent linter) reports zero errors and zero warnings on all files touched by this task. |
| **Evidence Required**  | Lint command output summary (e.g., `✔ No problems found` or `0 errors, 0 warnings`). |
| **Verification Method** | Run `npx eslint . --max-warnings=0` (or equivalent). Output must show zero problems. |
| **Schema Field**       | `dod_checklist.lint_passes` |

---

### DOD-04: Type Checks Pass

- [ ] **Status:** Zero TypeScript or type errors across the project.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | TypeScript compiler (`tsc --noEmit`) or equivalent type checker reports zero errors. No `@ts-ignore` or `any` type introduced. |
| **Evidence Required**  | `tsc --noEmit` output summary. Grep results confirming no new `@ts-ignore` or `any` usage in changed files. |
| **Verification Method** | Run `npx tsc --noEmit`. Verify exit code 0. Search changed files for `@ts-ignore`, `@ts-expect-error`, and `any` type usage. |
| **Schema Field**       | `dod_checklist.type_checks_pass` |

---

### DOD-05: CI Passes

- [ ] **Status:** All CI workflow checks pass on the current branch.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | All GitHub Actions (or equivalent CI) workflows pass. No skipped required checks. No flaky test failures attributed to this change. |
| **Evidence Required**  | CI run URL or screenshot showing all checks green. Commit SHA that was checked. |
| **Verification Method** | Push branch and verify CI status. All required status checks must report success. |
| **Schema Field**       | `dod_checklist.ci_passes` |

---

### DOD-06: Documentation Updated

- [ ] **Status:** README, API docs, and architecture docs updated if impacted.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | Public APIs have JSDoc/TSDoc comments. README updated if the public interface, setup steps, or configuration changed. Architecture docs updated if system topology or data flow changed. |
| **Evidence Required**  | File paths of updated documentation. For no-doc-change cases: explicit statement that no public interface, setup, or architecture was modified. |
| **Verification Method** | Review changed files for new exports/endpoints — each must have doc comments. Diff README and architecture docs if interface changed. |
| **Schema Field**       | `dod_checklist.docs_updated` |

---

### DOD-07: Reviewed by Validator Agent

- [ ] **Status:** Validator agent has independently reviewed and approved the task output.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | The Validator agent has run an independent compliance check against all DoD items and the SDLC loop. Only Validator may set this to true. Agents must submit with this item unchecked. |
| **Evidence Required**  | Validator report path (`docs/reviews/dod/{TASK_ID}-dod.yaml`) with `verdict: APPROVED`. |
| **Verification Method** | Validator reads agent deliverables, independently verifies DOD-01 through DOD-06 and DOD-08 through DOD-10, then sets verdict. |
| **Schema Field**       | `dod_checklist.validator_reviewed` |
| **Special Rule**       | Agent MUST submit this as `false`. Only Validator sets to `true`. |

---

### DOD-08: No Console Errors

- [ ] **Status:** Zero `console.error` / `console.warn` / `console.log` in production code.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | No direct `console.*` calls in production source code. All runtime logging uses the project's structured logger utility. Dev-only console usage must be guarded or removed before submission. |
| **Evidence Required**  | Grep results for `console.log`, `console.error`, `console.warn` across `src/` (or equivalent source directory) showing zero matches. |
| **Verification Method** | Run `grep -rn "console\.\(log\|error\|warn\)" src/` and verify zero results. Exclude test files and dev-only scripts. |
| **Schema Field**       | `dod_checklist.no_console_errors` |

---

### DOD-09: No Unhandled Promises

- [ ] **Status:** All async functions use proper error handling; no floating promises.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | Every `async` function uses `try/catch` or `.catch()`. No floating promises (promise returned but not awaited or handled). ESLint `no-floating-promises` rule passes. |
| **Evidence Required**  | ESLint output for `@typescript-eslint/no-floating-promises` rule showing zero violations. Alternatively, manual grep for `async` functions confirming each has error handling. |
| **Verification Method** | Run `npx eslint . --rule '{"@typescript-eslint/no-floating-promises": "error"}'` or verify the rule is active in ESLint config and passes. |
| **Schema Field**       | `dod_checklist.no_unhandled_promises` |

---

### DOD-10: No TODO Comments in Code

- [ ] **Status:** No leftover `// TODO`, `// FIXME`, `// HACK`, or `// XXX` markers in committed code.

| Attribute              | Detail |
|------------------------|--------|
| **Description**        | All TODO/FIXME/HACK/XXX comments have been resolved or extracted into tracked TODO tasks before submission. No deferred work hidden in source code. |
| **Evidence Required**  | Grep results for `TODO`, `FIXME`, `HACK`, `XXX` across source files showing zero matches in files touched by this task. |
| **Verification Method** | Run `grep -rn "TODO\|FIXME\|HACK\|XXX" src/` and verify zero results in changed files. Exclude pre-existing markers in untouched files. |
| **Schema Field**       | `dod_checklist.no_todo_comments` |

---

## Summary

| Field               | Value       |
|----------------------|-------------|
| **pass_count**       | `__0-10__`  |
| **fail_count**       | `__0-10__`  |
| **all_passed**       | `true` only if pass_count == 10 |
| **rejection_reasons** | `[]` — list of DOD-XX IDs that failed (if verdict == REJECTED) |

---

## Enforcement Rules

| Rule | Effect |
|------|--------|
| `all_passed == false` | Ticket CANNOT advance past QA_REVIEW |
| `verdict != APPROVED` | Ticket CANNOT reach VALIDATION state |
| Agent submits with `DOD-07 == false` | Auto-set — only Validator can mark true |
| Any item `status: false` at Validator review | Validator MUST issue `REJECTED` verdict |
| 3 consecutive rejections | Task escalated to user for intervention |

## Workflow

```
1. Agent completes implementation work
2. Agent self-assesses DOD-01 through DOD-06, DOD-08 through DOD-10
3. Agent sets DOD-07 = false (cannot self-verify)
4. Agent writes DoD report to docs/reviews/dod/{TASK_ID}-dod.yaml
5. ReaperOAK delegates to Validator at VALIDATION stage
6. Validator independently verifies ALL 10 items
7. Validator sets verdict = APPROVED or REJECTED
8. If REJECTED → Validator lists failing items in rejection_reasons[]
9. ReaperOAK reads verdict and routes accordingly (rework or proceed)
```

## `dod_checklist` Field Mapping (delegation-packet-schema.json)

```json
{
  "dod_checklist": {
    "code_implemented": false,
    "tests_written": false,
    "lint_passes": false,
    "type_checks_pass": false,
    "ci_passes": false,
    "docs_updated": false,
    "validator_reviewed": false,
    "no_console_errors": false,
    "no_unhandled_promises": false,
    "no_todo_comments": false
  }
}
```

> Each boolean maps 1:1 to a DOD-XX item above. Default: all `false`.
> Agent sets applicable items to `true` with evidence. Validator confirms.

---

## DOD-to-CHK Cross-Reference

The Validator independently verifies DOD items using CHK-01 through CHK-10
(defined in `.github/agents/Validator.agent.md` → Extended Validation Checklist).
This table maps each DOD item to the CHK items the Validator uses for
independent verification.

| DOD Item | DOD Description | Verified By CHK Items | CHK Verification Scope |
|----------|----------------|----------------------|------------------------|
| DOD-01 | Code Implemented | CHK-01, CHK-02, CHK-03, CHK-04, CHK-05 | Test existence, assertion quality, lint, no console errors, no TODO comments |
| DOD-02 | Tests Written | CHK-01, CHK-02 | Test file existence per module + actual assertions in each test file |
| DOD-03 | Lint Passes | CHK-03 | `npx eslint . --max-warnings 0` — zero errors AND zero warnings |
| DOD-06 | Docs Updated | CHK-06, CHK-09 | Module README + JSDoc/TSDoc present; CHANGELOG.md updated |
| DOD-08 | No Console Errors | CHK-04 | `grep -rn "console\.(log\|warn\|error)" {src}/` — zero matches (test files excluded) |
| DOD-09 | No Unhandled Promises | CHK-10 | `.then()` chains have `.catch()`; `async` functions have try/catch or are awaited |
| DOD-10 | No TODO Comments | CHK-05 | `grep -rn "// TODO\|// FIXME\|// HACK" {src}/` — zero matches |

**Note:** DOD-04 (Type Checks), DOD-05 (CI Passes), and DOD-07 (Validator
Reviewed) do not have dedicated CHK items — they are verified through existing
Validator protocols (gates G1–G8 and the DOD-07 exclusive rule).
