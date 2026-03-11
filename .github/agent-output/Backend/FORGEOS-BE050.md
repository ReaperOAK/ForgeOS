# FORGEOS-BE050 — BACKEND Complete

## Summary
Implemented `runner_hooks.py` — integration hooks for `agent-runner.py` two-commit protocol. Provides `RunnerHooks` class with `pre_claim_check` and `post_advance_or_rework` lifecycle methods that integrate with `ForgeOSClient` via `TicketOperations`.

## Files Created
- `agent-sdk/src/forgeos_sdk/runner_hooks.py` — RunnerHooks, HookConfig, HookResult
- `agent-sdk/tests/test_runner_hooks.py` — 28 tests covering all 6 ACs

## Files Modified
- `agent-sdk/src/forgeos_sdk/__init__.py` — Added RunnerHooks, HookConfig, HookResult exports

## TDD Evidence
- **RED:** Tests written first importing non-existent `runner_hooks` module → `ModuleNotFoundError`
- **GREEN:** Implemented `runner_hooks.py` → 28/28 tests pass
- **REFACTOR:** Removed unused imports flagged by ruff

## Coverage
- `runner_hooks.py`: **99%** (86 statements, 1 miss at line 130)

## Acceptance Criteria
1. ✅ Pre-run hook validates ticket claim before agent execution starts (`pre_claim_check`)
2. ✅ Post-run hook advances ticket or sends to rework based on agent result (`post_advance_or_rework`)
3. ✅ Hooks integrate with ForgeOSClient via TicketOperations for MCP operations
4. ✅ Hook lifecycle: `pre_claim_check -> agent_work -> post_advance_or_rework`
5. ✅ Errors in hooks log and surface error without crashing the runner (all exceptions caught → HookResult)
6. ✅ Hooks configurable via environment variables (`FORGEOS_HOOK_PRE_CLAIM`, `FORGEOS_HOOK_POST_ADVANCE`, `FORGEOS_HOOK_POST_REWORK`)

## Test Results
- 28 tests pass, 0 failures
- 325 total SDK tests pass (no regressions)
- Ruff: All checks passed (0 errors, 0 warnings)

## Confidence: HIGH
