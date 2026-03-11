# FORGEOS-BE037 — BACKEND Complete

## Summary
Implemented `POST /api/tickets/{ticket_id}/advance` and `POST /api/tickets/{ticket_id}/rework` REST endpoints that delegate to the shared `TicketService` layer.

## Artifacts

### Modified
- `mcp-server/src/mcp_server/api/routes/tickets.py` — Added `create_advance_endpoint` and `create_rework_endpoint` factory functions
- `mcp-server/src/mcp_server/api/schemas.py` — Added `AdvanceRequest`, `AdvanceResponse`, `ReworkRequest`, `ReworkResponse` Pydantic models
- `mcp-server/src/mcp_server/api/routes/__init__.py` — Updated exports
- `mcp-server/src/mcp_server/transport/http.py` — Wired routes into Starlette app

### Created
- `mcp-server/tests/test_ticket_advance_rework_api.py` — 24 tests covering all ACs

## TDD Evidence
- **RED**: Tests written first importing non-existent schemas/endpoints → `ImportError`
- **GREEN**: Schemas + endpoints implemented → 24 tests pass
- **REFACTOR**: ruff --fix applied for import ordering

## Acceptance Criteria Coverage

| AC | Description | Status |
|----|-------------|--------|
| AC1 | POST /api/tickets/:id/advance advances ticket to next SDLC stage | PASS — delegates to `TicketService.advance_ticket` |
| AC2 | POST /api/tickets/:id/rework sends ticket back to implementation stage | PASS — delegates to `TicketService.rework_ticket` |
| AC3 | Advance validates agent holds claim and ticket is in correct stage | PASS — `ClaimValidationError` → 409, `InvalidTransitionError` → 409 |
| AC4 | Rework accepts reason and optional rejection_evidence in request body | PASS — `ReworkRequest` schema validates both fields |
| AC5 | Rework increments rework_count; at >=3 returns ESCALATED status | PASS — test verifies escalated=True with rework_count=3 |
| AC6 | Both endpoints return updated ticket state with before/after stages | PASS — `AdvanceResponse` and `ReworkResponse` include previous_stage/new_stage |
| AC7 | Both endpoints create audit trail entries | PASS — delegated to `TicketService` which inserts events rows |

## Test Results
- 24 new tests: 24 passed
- 101 total ticket API tests: 101 passed (0 regressions)
- Ruff lint: 0 errors on modified files

## Confidence: HIGH
