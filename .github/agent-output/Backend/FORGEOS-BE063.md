# FORGEOS-BE063 — BACKEND Complete

## Summary

Implemented the PR event handler for GitHub `pull_request` webhook events. The handler extracts ticket IDs from PR titles and branch names, parses PR metadata (author, reviewers, labels, merged status), and routes events through the existing webhook handler registry.

## Files Created

- **mcp-server/src/mcp_server/services/pr_service.py** — PR service with:
  - `extract_ticket_ids(title, branch)` — regex extraction of FORGEOS ticket IDs
  - `extract_pr_metadata(payload)` — GitHub PR payload parser
  - `PRAction` enum — `OPENED`, `CLOSED`, `MERGED`, `SYNCHRONIZE`, `OTHER`
  - `PRMetadata` dataclass — number, title, url, author, branch, base_branch, reviewers, labels, merged
  - `PREvent` dataclass — ticket_id, action, metadata, triggers_advancement, merge_target, timestamp, `to_dict()`
  - `PRService.handle_pr_event(event)` — main handler coroutine

- **mcp-server/tests/test_pr_service.py** — 34 tests covering:
  - Ticket ID extraction (title, branch, both, none, dedup, multiple)
  - PR metadata extraction (full, partial, reviewers, labels, merged)
  - PRAction enum (opened, closed, merged, synchronize, other)
  - PRService event processing (all actions, no-ticket warning, merge-to-main advancement, multi-ticket)
  - Handler registration integration tests

## Files Modified

- **mcp-server/src/mcp_server/webhooks/github_handler.py** — Added:
  - `handle_pull_request_event()` async handler
  - `register_pr_handler()` registration function

- **mcp-server/src/mcp_server/webhooks/__init__.py** — Added PR handler exports and eager registration

- **mcp-server/src/mcp_server/services/__init__.py** — Added `PRService`, `PREvent` exports

## Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | PR event handler registered for GitHub pull_request events | ✅ Registered via `register_pr_handler()` in `webhooks/__init__.py` |
| 2 | Handler processes opened, closed, merged, and synchronize actions | ✅ `PRAction.from_string()` maps all 4 actions + OTHER |
| 3 | On PR merge to main, triggers ticket advancement if applicable | ✅ `triggers_advancement=True` when merged to main/master |
| 4 | PR metadata (author, reviewers, labels) extracted and stored | ✅ `PRMetadata` dataclass with all fields |
| 5 | Handler correlates PRs to tickets via branch naming or PR title | ✅ Regex `FORGEOS-[A-Z]+\d+` scans both title and branch |
| 6 | Invalid or unrelated PRs logged and skipped gracefully | ✅ Warning log + empty return for no-correlation |

## TDD Evidence

- **RED:** Tests created before implementation (34 tests, all ImportError)
- **GREEN:** All 34 tests pass after implementation
- **REFACTOR:** ruff auto-fix applied (import sorting)
- **Coverage:** `pr_service.py` = **100%**

## Test Results

```
34 passed in 0.40s
```

## Lint

```
ruff check: All checks passed!
```

## Confidence

**HIGH** — All acceptance criteria met, 100% coverage on new code, zero lint warnings.

## Agent

Backend | Machine: pop-os | Operator: ReaperOAK
