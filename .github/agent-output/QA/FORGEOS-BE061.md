# FORGEOS-BE061 — QA Report

## Implement Push Event Handler for Sync

**Agent:** QA Engineer | **Machine:** pop-os | **Timestamp:** 2026-03-11T03:00:00Z

## Verdict: REJECT (Rework #1)

3 of 6 acceptance criteria are unmet. The implementation covers main-branch sync triggering well but is missing ticket-branch file filtering and sync summary return.

## Acceptance Criteria Review

| AC# | Criterion | Status | Evidence |
|-----|-----------|--------|----------|
| 1 | Push events to main branch trigger a full tickets.sync operation | PASS | `create_push_handler` calls `sync_fn()` when `push.is_main_branch is True`. Tested: `test_main_branch_triggers_sync`, `test_master_branch_triggers_sync` |
| 2 | Push events to ticket branches trigger sync if ticket-related files are modified | FAIL | Handler skips ALL non-main branches (`push_non_main_acknowledged` log + return). No commit file inspection for ticket-related paths. Feature branches never trigger sync regardless of modified files. |
| 3 | File path filtering checks for changes in .github/tickets/ or .github/ticket-state/ | FAIL | Zero file path filtering logic exists in `github_handler.py`. No inspection of `commits[].added/modified/removed` arrays. `grep` for `github/tickets`, `github/ticket-state`, `added`, `modified` in handler returns zero matches. |
| 4 | Sync results logged including tickets released, unblocked, and errors | PASS | `push_sync_completed` log includes full `sync_result` dict with `correlation_id`. Content depends on sync engine return shape. |
| 5 | Non-ticket pushes are acknowledged but do not trigger sync | PASS | `push_non_main_acknowledged` logged for non-main branches. No sync called. |
| 6 | Handler returns the sync summary as the webhook response payload | FAIL | Handler signature is `async def _handle_push(event) -> None`. Returns `None`. Sync result is logged but not returned to caller. `WebhookHandler` type alias is `Callable[[WebhookEvent], Coroutine[Any, Any, None]]` — return type must be changed to support returning payload. |

## Rework Guidance

### AC2 — Ticket branch file filtering
Add logic in `_handle_push` after `is_main_branch` check: iterate `push.commits`, inspect `added`, `modified`, `removed` arrays for paths starting with `.github/tickets/` or `.github/ticket-state/`. If any match, call `sync_fn()`. Consider adding a helper `_has_ticket_file_changes(commits: list[dict]) -> bool`.

### AC3 — File path filtering
Implement the path check described above. Use a constant like `_TICKET_PATHS = frozenset({".github/tickets/", ".github/ticket-state/"})` and check `any(f.startswith(prefix) for prefix in _TICKET_PATHS for f in commit.get("added", []) + commit.get("modified", []) + commit.get("removed", []))`.

### AC6 — Return sync summary
Change `_handle_push` return type from `None` to `dict[str, Any] | None`. Return `sync_result` from `sync_fn()`. Update `WebhookHandler` type alias or create a separate `PushHandler` type. Ensure `dispatch()` can propagate the return value if needed.

## Test Results

| Metric | Value |
|--------|-------|
| Push handler tests (test_push_event_handler.py) | 31/31 PASSED |
| Webhook service tests (test_webhook_service.py) | 34/34 PASSED |
| Webhook signature tests (test_webhook_signature.py) | 14/14 PASSED |
| Total webhook regression | 79/79 PASSED |
| Push-specific code coverage (lines 120-300 of github_handler.py) | 100% |
| webhook_service.py coverage | 97% |
| Ruff lint | 0 errors, 0 warnings |

## Defects Found

| ID | Severity | File | Description |
|----|----------|------|-------------|
| D1 | HIGH | github_handler.py:268-270 | Non-main branches immediately return without inspecting commits for ticket-related file changes. AC2 requires conditional sync on ticket branches. |
| D2 | HIGH | github_handler.py | No file path filtering logic exists anywhere. AC3 requires checking `.github/tickets/` and `.github/ticket-state/` paths in commit diffs. |
| D3 | MEDIUM | github_handler.py:250 | Handler returns `None`. AC6 requires returning sync summary as response payload. |

## Notes

- The Backend agent's upstream summary listed rewritten ACs that differ from the ticket JSON. The actual ticket ACs include file path filtering (AC2, AC3) and return value (AC6) which were not implemented.
- Existing code quality is good: factory pattern, frozen dataclass, proper validation, correlation ID logging, exception handling. Only the scope is incomplete.

## Confidence

**HIGH** — Evidence is concrete: `grep` confirms missing code paths, test suite confirms what IS tested, ACs are clearly specified in ticket JSON.
