# TASK-FOS-06-002 — QA Complete

## Ticket
- **ID:** TASK-FOS-06-002
- **Title:** Husky Pre-Commit Hook — Blast Radius Validation
- **Type:** infra
- **Stage:** QA → SECURITY

## Verdict: PASS

**Confidence: HIGH**

## Artifacts Reviewed

| File | Status |
|------|--------|
| `forgeos-server/.husky/pre-commit` | ✅ Exists, executable (755), correct structure |
| `forgeos-server/scripts/validate-scope.sh` | ✅ Exists, executable (755), correct structure |

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `.husky/pre-commit` is executable and committed | ✅ PASS | `ls -la` confirms 755 permissions, file tracked by git |
| 2 | Hook extracts ticket ID from `FORGEOS_TICKET_ID` env var or last commit `[TICKET-ID]` pattern | ✅ PASS | Functional tests 4-6: env var priority, commit msg extraction, no-context fallback all verified |
| 3 | Hook queries `FORGEOS_MCP_URL/api/tickets/{id}` for `file_paths` | ✅ PASS | `query_ticket_paths()` uses `curl -sf --max-time` with configurable URL and timeout |
| 4 | Each staged file checked against `file_paths` using prefix matching | ✅ PASS | Functional tests 1-3, 7-9: prefix matching with `/` boundary correctly handles exact files, directory children, and rejects similar-prefix directories |
| 5 | Out-of-scope files cause rejection with error listing violations and allowed paths | ✅ PASS | Test 2: rejection output shows `✗` for violations, `✓` for allowed paths, plus 3 remediation options |
| 6 | MCP server unreachable → WARNING + exit 0 | ✅ PASS | Graceful degradation confirmed via test with unreachable server (exit 0, WARNING printed). Note: message comes from empty-paths fallback rather than the intended `mapfile` check — see observations |
| 7 | No ticket context → INFO + exit 0 | ✅ PASS | Test 6: `[INFO] No ticket context available...` printed, exit 0 confirmed |
| 8 | `--no-verify` bypass available | ✅ PASS | Git built-in (`git commit --no-verify`); documented in rejection output |

## Test Results

### Static Analysis

| Check | Result |
|-------|--------|
| `bash -n` syntax check (pre-commit) | ✅ PASS |
| `bash -n` syntax check (validate-scope.sh) | ✅ PASS |
| ShellCheck (pre-commit) | ✅ PASS (0 issues) |
| ShellCheck (validate-scope.sh) | ✅ PASS — 1 info-level warning: SC2317 `error()` function defined but never called |
| TODO/FIXME/HACK/XXX scan | ✅ PASS — none found |
| File permissions | ✅ PASS — both 755 |
| Shebang consistency | ✅ PASS — all `#!/usr/bin/env bash` |

### Functional Tests (9/9 PASS)

| Test | Description | Result |
|------|-------------|--------|
| 1 | In-scope files pass validation | ✅ PASS |
| 2 | Out-of-scope files rejected with clear error | ✅ PASS |
| 3 | No staged files → info message, allow | ✅ PASS |
| 4 | `resolve_ticket_id` from `FORGEOS_TICKET_ID` env var | ✅ PASS |
| 5 | `resolve_ticket_id` from last commit message `[TICKET-ID]` pattern | ✅ PASS |
| 6 | `resolve_ticket_id` with no context → returns 1 | ✅ PASS |
| 7 | Exact file match (e.g., `pre-commit` against `pre-commit`) | ✅ PASS |
| 8 | Prefix boundary: `scripts-extra/` does NOT match `scripts` | ✅ PASS |
| 9 | Directory child: `scripts/subdir/file.sh` matches `scripts` | ✅ PASS |

### Pattern Consistency

| Aspect | pre-commit hook | commit-msg hook | Match |
|--------|----------------|-----------------|-------|
| Delegation pattern | `exec scripts/validate-scope.sh` | `exec scripts/validate-commit.sh "$1"` | ✅ Consistent |
| `SCRIPT_DIR` resolution | `$(cd "$(dirname "$0")/.." && pwd)` | Same | ✅ |
| Shebang | `#!/usr/bin/env bash` | Same | ✅ |
| Comments/header style | Box-style with `──────` | Same | ✅ |

### Existing Test Suite

- **Vitest suite:** 1142 passed, 90 failed (26 files)
- **Pre-existing failures:** All 90 failures are in `src/__tests__/middleware/auth.test.ts` (`requirePermission is not a function`) — **unrelated to this ticket**
- No test regressions introduced by this ticket's changes

## Observations (Non-Blocking)

### 1. Dead Code: `mapfile` error handling (Minor)

In `main()`, the construct:
```bash
if ! mapfile -t allowed_paths < <(query_ticket_paths "${ticket_id}"); then
    warn "MCP server unreachable..."
```
The `mapfile` command always returns 0 regardless of the process substitution's exit code. This means the "MCP server unreachable" branch is dead code. However, graceful degradation still works correctly because the `filtered_paths` empty check catches this case and exits 0 with a WARNING.

**Impact:** The warning message is slightly inaccurate ("returned no file_paths" vs "unreachable"), but the behavior (allow commit, exit 0) is correct. No functional impact.

**Recommendation:** Replace `mapfile` pattern with a temporary variable to capture the exit code, or use the empty-paths check as the sole fallback (current behavior).

### 2. Unused `error()` Function (Trivial)

ShellCheck SC2317: `error()` is defined but never called. Could be used in future error paths or removed.

### 3. `grep -oP` PCRE Dependency (Info)

`resolve_ticket_id` uses `grep -oP` (Perl regex). This is standard on Linux (GNU grep) but not available on macOS BSD grep. Acceptable for this project's Linux-targeted development environment.

## Bash Best Practices Checklist

| Practice | Status |
|----------|--------|
| `set -euo pipefail` | ✅ Used |
| Proper quoting of variables | ✅ All variables double-quoted |
| `local` variables in functions | ✅ Used throughout |
| Meaningful exit codes (0 = success, 1 = rejection) | ✅ Correct |
| Configurable via environment variables | ✅ `FORGEOS_MCP_URL`, `FORGEOS_TICKET_ID`, `FORGEOS_CURL_TIMEOUT` |
| No hardcoded secrets/tokens | ✅ Clean |
| Error output to stderr (info/warn helpers) | ⚠️ Uses stdout — acceptable for git hook context |
| Graceful degradation on failure | ✅ Both MCP-unreachable and no-ticket paths handle gracefully |

## Coverage & Mutation Testing

N/A — Shell scripts are not covered by vitest unit test coverage or mutation testing frameworks. Functional testing was performed manually via bash invocations with mocked `git` function to verify all code paths.

## Performance

Not applicable — the script executes in sub-second time. `curl` timeout is configurable (default 5s) to prevent slow MCP servers from blocking commits.

## Defects Found

None (blocking). Two minor observations documented above.

## Summary

The pre-commit hook implementation correctly validates blast radius by checking staged files against the ticket's declared scope. All 8 acceptance criteria are met. The delegation pattern is consistent with the existing commit-msg hook. Error handling, graceful degradation, and prefix matching all work correctly. The only minor issues are (1) dead code in the `mapfile` error handling path and (2) an unused `error()` helper function — neither affects functionality.

**Verdict: PASS — advance to SECURITY**
