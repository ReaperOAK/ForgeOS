# Initialization Checklist Template

> **Schema Version:** 1.0
> **Source:** `docs/architecture/sdlc-enforcement-design.md` §5
> **Usage:** Copy this template per module. Fill metadata, run checks, provide evidence.
> **Report Path:** `docs/reviews/init/{MODULE_NAME}-init.yaml`
> **Compatible With:** `delegation-packet-schema.json` → `initialization_checklist` field

---

## Metadata

| Field            | Value                          |
|------------------|--------------------------------|
| **module_name**  | `__MODULE_NAME__`              |
| **module_type**  | `backend` \| `frontend` \| `fullstack` |
| **checked_by**   | `__AGENT_NAME__`               |
| **checked_at**   | `__ISO8601_TIMESTAMP__`        |
| **project**      | `__PROJECT_NAME__`             |
| **all_passed**   | `true` \| `false`             |

---

## Applicability Legend

Each item is tagged with its applicable module type(s):

| Tag           | Meaning |
|---------------|---------|
| **ALL**       | Required for backend, frontend, and fullstack modules |
| **BACKEND**   | Required only for backend or fullstack modules |
| **FRONTEND**  | Required only for frontend or fullstack modules |

> Items not applicable to the current `module_type` are auto-passed.
> A fullstack module must satisfy ALL items.

---

## Initialization Checklist

All applicable items must pass before a task can enter the IMPLEMENT stage.
The check runs **once per module** — subsequent tasks reuse the cached result
if `all_passed: true` already exists on disk.

<!-- Machine-parseable: each checkbox line maps to an initialization_checklist field.
     Field mapping: INIT-01 → directory_structure, INIT-02 → linter_formatter, etc.
     Non-applicable items are auto-passed based on module_type. -->

### INIT-01: Directory Structure Validated

- [ ] **Status:** Module has the required directory layout.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **ALL** |
| **Description**        | Module has `src/`, `tests/`, and `docs/` directories (or framework-equivalent structure). Entry point files exist in expected locations. |
| **Verification Command** | `ls -d src/ tests/ docs/` (or framework equivalent, e.g., `app/`, `pages/`, `__tests__/`) |
| **Evidence Required**  | Directory listing output showing required directories exist. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Cannot proceed without valid directory structure. Agent must create missing directories before retrying. |
| **Schema Field**       | `initialization_checklist.directory_structure` |

---

### INIT-02: ESLint / Prettier Configured

- [ ] **Status:** Linter and formatter configuration files exist and are valid.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **ALL** |
| **Description**        | ESLint config (`.eslintrc.*`, `eslint.config.*`, or `eslint.config.mjs`) exists and is parseable. Prettier config (`.prettierrc.*` or `prettier.config.*`) exists. Both tools run without config errors. |
| **Verification Command** | `npx eslint --print-config .` and `npx prettier --check .` (verify configs load without errors) |
| **Evidence Required**  | Config file paths; output of verification commands showing no config errors. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Cannot proceed without linter/formatter. Agent must create config files following project conventions. |
| **Schema Field**       | `initialization_checklist.linter_formatter` |

---

### INIT-03: tsconfig.json Present and Consistent

- [ ] **Status:** TypeScript configuration exists with strict mode enabled.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **ALL** |
| **Description**        | `tsconfig.json` exists at the module root (or is referenced via `extends`). `"strict": true` is enabled. Compiler options are consistent with the project's root config if one exists. |
| **Verification Command** | `cat tsconfig.json \| grep '"strict"'` and `npx tsc --noEmit --showConfig` |
| **Evidence Required**  | `tsconfig.json` path; strict flag value; `tsc --showConfig` output confirming valid configuration. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Cannot proceed without TypeScript config. Agent must create tsconfig.json with strict mode. |
| **Schema Field**       | `initialization_checklist.tsconfig` |

---

### INIT-04: Test Framework Configured

- [ ] **Status:** Test runner is configured with a valid config file.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **ALL** |
| **Description**        | A test runner (Jest, Vitest, or Playwright) is configured with its config file present (`jest.config.*`, `vitest.config.*`, or `playwright.config.*`). The runner executes without config errors. |
| **Verification Command** | `npx vitest --run --passWithNoTests` or `npx jest --passWithNoTests` or `npx playwright test --list` |
| **Evidence Required**  | Test config file path; test runner name; output showing the runner initializes without errors. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Cannot proceed without test framework. Agent must install and configure the test runner. |
| **Schema Field**       | `initialization_checklist.test_framework` |

---

### INIT-05: Environment Variables Documented

- [ ] **Status:** `.env.example` exists listing all required environment variables.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **ALL** |
| **Description**        | A `.env.example` file exists at the module root listing every required environment variable with placeholder values and inline comments explaining purpose. No actual secrets are committed. |
| **Verification Command** | `test -f .env.example && echo "EXISTS" \|\| echo "MISSING"` |
| **Evidence Required**  | `.env.example` file path; variable count; confirmation that no real secrets are present. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Cannot proceed without documented env vars. Agent must create `.env.example` listing required variables. |
| **Schema Field**       | `initialization_checklist.env_documented` |

---

### INIT-06: Health Check Endpoint Present

- [ ] **Status:** Backend service exposes a health check endpoint returning 200 OK.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **BACKEND** |
| **Description**        | A `/health` or `/api/health` endpoint exists that returns HTTP 200 with a JSON body indicating service status (e.g., `{"status": "ok"}`). The endpoint requires no authentication. |
| **Verification Command** | `grep -rn "health" src/routes/ src/controllers/` or `curl http://localhost:PORT/health` (if server is running) |
| **Evidence Required**  | Endpoint file path; route definition; response schema. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Backend modules cannot proceed without a health check endpoint. Agent must create the endpoint. |
| **Auto-Pass Condition** | Frontend-only modules: this item is **auto-passed** (mark N/A in evidence). |
| **Schema Field**       | `initialization_checklist.health_check` |

---

### INIT-07: Logging Configured

- [ ] **Status:** Structured, leveled logging utility exists (not raw `console.log`).

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **ALL** |
| **Description**        | A logger utility module exists that outputs structured JSON logs with configurable levels (ERROR, WARN, INFO, DEBUG). No direct `console.log` in production source code. Logger includes `requestId`/`correlationId` context where applicable. |
| **Verification Command** | `find src/ -name "logger*" -o -name "logging*"` and `grep -rn "console\.log" src/ \| wc -l` (should be 0) |
| **Evidence Required**  | Logger file path; supported log levels; structured output format sample; grep confirming zero `console.log` in `src/`. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Cannot proceed without logging. Agent must create a structured logger utility. |
| **Schema Field**       | `initialization_checklist.logging` |

---

### INIT-08: Error Boundaries Present

- [ ] **Status:** Frontend React Error Boundary wraps the application root.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **FRONTEND** |
| **Description**        | A React Error Boundary component (or framework equivalent) wraps the application root to catch rendering errors gracefully. The boundary displays a fallback UI and reports errors to the tracking service. |
| **Verification Command** | `grep -rn "ErrorBoundary\|error.boundary\|componentDidCatch" src/` |
| **Evidence Required**  | Error boundary component file path; confirmation it wraps the root in the entry point (e.g., `App.tsx`, `main.tsx`). |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Frontend modules cannot proceed without error boundaries. Agent must create the Error Boundary component. |
| **Auto-Pass Condition** | Backend-only modules: this item is **auto-passed** (mark N/A in evidence). |
| **Schema Field**       | `initialization_checklist.error_boundaries` |

---

### INIT-09: Sentry / Error Tracking Instrumented

- [ ] **Status:** Backend error tracking is configured and capturing unhandled exceptions.

| Attribute              | Detail |
|------------------------|--------|
| **Applies To**         | **BACKEND** |
| **Description**        | Sentry SDK (or equivalent error tracking service) is initialized in the application entry point. Global error handler middleware forwards uncaught exceptions to the tracking service. DSN is configured via environment variable (not hardcoded). |
| **Verification Command** | `grep -rn "Sentry\|sentry\|@sentry" src/` and `grep "SENTRY_DSN" .env.example` |
| **Evidence Required**  | Sentry initialization file path; confirmation DSN is in `.env.example`; global error handler middleware file path. |
| **Blocking Behavior**  | **BLOCKS IMPLEMENT** — Backend modules cannot proceed without error tracking. Agent must install and configure Sentry. |
| **Auto-Pass Condition** | Frontend-only modules: this item is **auto-passed** (mark N/A in evidence). |
| **Schema Field**       | `initialization_checklist.error_tracking` |

---

## Summary

| Field               | Value       |
|----------------------|-------------|
| **total_items**      | 9           |
| **applicable_items** | `__COUNT__` (based on module_type) |
| **pass_count**       | `__0-9__`   |
| **fail_count**       | `__0-9__`   |
| **auto_passed**      | `__COUNT__` (items not applicable to module_type) |
| **all_passed**       | `true` only if all applicable items pass |

---

## Applicability Matrix

| Item    | Backend | Frontend | Fullstack |
|---------|---------|----------|-----------|
| INIT-01 | ✅       | ✅        | ✅         |
| INIT-02 | ✅       | ✅        | ✅         |
| INIT-03 | ✅       | ✅        | ✅         |
| INIT-04 | ✅       | ✅        | ✅         |
| INIT-05 | ✅       | ✅        | ✅         |
| INIT-06 | ✅       | N/A      | ✅         |
| INIT-07 | ✅       | ✅        | ✅         |
| INIT-08 | N/A     | ✅        | ✅         |
| INIT-09 | ✅       | N/A      | ✅         |

---

## Enforcement Rules

| Rule | Effect |
|------|--------|
| Any applicable item with `status: false` | Task BLOCKED from entering IMPLEMENT stage |
| `applicableTo` mismatch with `module_type` | Item auto-passes (e.g., INIT-06 for frontend modules) |
| Module already initialized (`all_passed: true` on disk) | Skip re-check, proceed to IMPLEMENT |
| Initialization fails after 2 attempts | BLOCK task and escalate to user |

## Initialization Flow

```
1. Task enters INITIALIZE stage
2. Agent checks: does docs/reviews/init/{MODULE}-init.yaml exist with all_passed: true?
3. If yes → skip to IMPLEMENT (cached result)
4. If no → run all 9 checks, write results to init checklist file
5. For each applicable item that fails:
   a. Agent creates missing scaffolding (directories, configs, utilities)
   b. Re-run failed checks
6. If still failing after 2 attempts → BLOCK and escalate to user
7. Once all_passed: true → proceed to IMPLEMENT
```

## `initialization_checklist` Field Mapping (delegation-packet-schema.json)

```json
{
  "initialization_checklist": {
    "directory_structure": false,
    "linter_formatter": false,
    "tsconfig": false,
    "test_framework": false,
    "env_documented": false,
    "health_check": false,
    "logging": false,
    "error_boundaries": false,
    "error_tracking": false
  }
}
```

> Each boolean maps 1:1 to an INIT-XX item above. Default: all `false`.
> Non-applicable items are auto-set to `true` based on `module_type`.
