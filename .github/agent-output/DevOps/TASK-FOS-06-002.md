# TASK-FOS-06-002 — BACKEND Complete (DevOps)

## Ticket
- **ID:** TASK-FOS-06-002
- **Title:** Husky Pre-Commit Hook — Blast Radius Validation
- **Type:** infra
- **Stage:** BACKEND → QA

## Summary

Implemented a Husky pre-commit hook that validates the blast radius of staged
files against the ticket's declared `file_paths` scope. The hook queries the
ForgeOS MCP server REST API to retrieve allowed paths, then checks each staged
file using prefix matching. Commits with out-of-scope files are rejected with
a clear error listing violations and allowed paths.

## Artifacts Created

| File | Purpose |
|------|---------|
| `forgeos-server/.husky/pre-commit` | Husky v9 pre-commit hook entry point |
| `forgeos-server/scripts/validate-scope.sh` | Blast radius validation logic |

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `.husky/pre-commit` is executable and committed | ✅ PASS — mode 755 |
| 2 | Extracts ticket ID from `FORGEOS_TICKET_ID` env var or last commit `[TICKET-ID]` pattern | ✅ PASS — `resolve_ticket_id()` checks env first, then `git log -1` |
| 3 | Queries `FORGEOS_MCP_URL/api/tickets/{id}` for `file_paths` | ✅ PASS — `query_ticket_paths()` via curl + python3 JSON parse |
| 4 | Each staged file checked against `file_paths` using prefix matching | ✅ PASS — `validate_scope()` with `${file} == ${allowed}` or `${file} == ${allowed}/*` |
| 5 | Out-of-scope files cause rejection with error listing violations and allowed paths | ✅ PASS — formatted error block with ✗/✓ markers |
| 6 | MCP server unreachable → WARNING + exit 0 | ✅ PASS — curl failure returns warning, allows commit |
| 7 | No ticket context → INFO + exit 0 | ✅ PASS — `resolve_ticket_id` failure triggers info message, allows commit |
| 8 | `--no-verify` bypass available | ✅ PASS — Git built-in; documented in error output |

## Infrastructure Tests

- **Bash syntax check:** `bash -n` passes for both scripts
- **Permissions:** Both scripts have executable bit set (755)
- **Style consistency:** Matches existing `commit-msg` hook pattern (Husky v9 delegation)

## Design Decisions

1. **Delegation pattern:** `pre-commit` delegates to `scripts/validate-scope.sh`, consistent with existing `commit-msg` → `validate-commit.sh` pattern.
2. **Python3 for JSON parsing:** Used python3 (universally available on dev machines) instead of jq to avoid adding a dependency.
3. **Prefix matching:** `file == allowed || file == allowed/*` ensures both exact file matches and directory prefix matches work correctly.
4. **Configurable timeout:** `FORGEOS_CURL_TIMEOUT` env var (default 5s) prevents slow MCP servers from blocking commits.
5. **No jq dependency:** Keeps the tool chain minimal; python3 is already required by the project.

## Confidence Level

**HIGH** — Implementation is straightforward bash scripting with clear acceptance criteria. All criteria met. Syntax validated. Pattern consistent with existing hooks.

## Next Stage

QA → Functional testing of hook behavior under various scenarios (server up/down, valid/invalid ticket, in-scope/out-of-scope files).
