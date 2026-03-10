# FORGEOS-BE055 — Backend Rework #1

## Summary

Fixed CWE-862 / OWASP A01 authorization bypass in `TicketService.claim_by_id()`.
The method was missing the `check_role_stage_authorization()` call that
`claim_next()` already enforced. Any authenticated agent could bypass
role-stage restrictions by calling the `tickets.claim` MCP tool with a
specific ticket ID.

## Fix Applied

Added `check_role_stage_authorization(agent_role, stage)` call in
`claim_by_id()` immediately after `AgentRoleMap.stage_for_role()` resolution
and before `ClaimQueue.claim_by_id()` delegation. This mirrors the
authorization pattern in `claim_next()` (line 288).

## Files Modified

- `mcp-server/src/mcp_server/services/ticket_service.py` — Added
  `check_role_stage_authorization(agent_role, stage)` call in `claim_by_id()`.
- `mcp-server/tests/test_ticket_tools.py` — Added
  `test_claim_by_id_calls_role_stage_authorization` test verifying the
  authorization check is invoked and blocks claims when policy rejects.
  Added `patch` to `unittest.mock` imports.

## TDD Evidence

- **RED:** Patched `check_role_stage_authorization` to raise
  `RoleStageMismatchError`; verified `claim_by_id` does NOT call
  `ClaimQueue.claim_by_id` when authorization fails.
- **GREEN:** Added `check_role_stage_authorization(agent_role, stage)` in
  `claim_by_id()`; test passes.
- **REFACTOR:** Combined nested `with` statements per SIM117 (ruff).

## Test Results

- 186 tests passed (test_ticket_tools + test_claim_queue + test_authorization)
- 0 failures, 0 errors
- ruff: All checks passed

## Confidence: HIGH
