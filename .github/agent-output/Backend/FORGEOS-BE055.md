# FORGEOS-BE055 — BACKEND Complete

## Summary
Implemented role-based claim restrictions that enforce stage ownership.
Agents can only claim tickets matching their role's SDLC stage. The
authorization layer checks the agent's role against the ticket's current
stage before allowing a claim.

## Artifacts

### Modified
- `mcp-server/src/mcp_server/auth/authorization.py` — Added `RoleStagePolicy`,
  `RoleStageMismatchError`, `check_role_stage_authorization()`, `OPERATOR_ROLE`
- `mcp-server/src/mcp_server/auth/__init__.py` — Exported new symbols
- `mcp-server/src/mcp_server/services/ticket_service.py` — Integrated
  role-stage check into `TicketService.claim_next()` with `role_override`
  and `target_stage` parameters

### Created
- `mcp-server/tests/test_role_stage_authorization.py` — 54 tests covering
  all acceptance criteria

## Acceptance Criteria Evidence

| Criterion | Status | Evidence |
|-----------|--------|----------|
| Role-to-stage mapping for all 14 agent types | DONE | `_DEFAULT_ROLE_STAGE_MAP` covers architect, research, product_manager, ui_designer, backend, devops, frontend, qa, security, ci, documentation, validator, todo, dispatcher |
| Claim validates role matches stage | DONE | `check_role_stage_authorization()` called in `TicketService.claim_next()` |
| Mismatch rejected with descriptive error | DONE | `RoleStageMismatchError` with 403 status, includes `reason`, `agent_role`, `ticket_stage`, `authorized_stage` |
| Operator can claim with role override | DONE | `OPERATOR_ROLE` bypasses when no override; validates override role when provided |
| Integrated into claim service (MCP + REST) | DONE | `TicketService.claim_next()` is shared by both MCP tools and REST paths |
| Role mapping is configurable | DONE | `RoleStagePolicy(overrides=...)` with `add_role()`/`remove_role()` |

## TDD Evidence

- **RED:** 54 tests written first; all failed on import error (module
  symbols not yet defined).
- **GREEN:** Implementation added to `authorization.py` and
  `ticket_service.py`; all 54 tests pass.
- **REFACTOR:** Extracted `RoleStagePolicy` as configurable class;
  lint cleaned to zero errors.

## Test Results
- 54 new tests: ALL PASS
- 41 existing authorization tests: ALL PASS (no regressions)
- Coverage: 99% on authorization.py (combined test suites)
- Ruff: zero errors, zero warnings

## Decisions
- Defined `_DEFAULT_ROLE_STAGE_MAP` as a module-level dict matching the
  existing `_ROLE_TO_STAGE` in `claim_queue.py`, ensuring consistency.
- `todo` and `dispatcher` roles map to `None` (they do not process stages).
- `OPERATOR_ROLE` bypasses stage checks when no `role_override` is given;
  when override is present, the override role is validated.
- `ADMIN_ROLE` (from BE056) also bypasses stage checks.
- Added `ClaimOwnershipError` to `ticket_service.py` to fix pre-existing
  missing class that blocked imports.

## Confidence
HIGH — All acceptance criteria met, tests pass, no regressions.
