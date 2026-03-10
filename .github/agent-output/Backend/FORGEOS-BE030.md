# FORGEOS-BE030 — BACKEND Stage Summary

## Ticket
**Title:** Implement tickets.advance MCP Tool  
**Type:** backend  
**Stage:** BACKEND → QA  

## Artifacts

### Created
- `mcp-server/src/mcp_server/services/stage_engine.py` — Pure domain logic for SDLC flow validation
- `mcp-server/tests/test_stage_engine.py` — 28 unit tests for stage engine (100% coverage)
- `mcp-server/tests/test_advance_tool.py` — 34 unit tests for advance tool and service layer

### Modified
- `mcp-server/src/mcp_server/services/ticket_service.py` — Added `AdvanceTicketResult`, `ClaimValidationError`, `advance_ticket()` method with SERIALIZABLE isolation
- `mcp-server/src/mcp_server/tools/ticket_tools.py` — Added `tickets.advance` tool schema, handler, factory, registration
- `mcp-server/src/mcp_server/services/__init__.py` — Exported `AdvanceTicketResult`, `ClaimValidationError`
- `mcp-server/src/mcp_server/tools/__init__.py` — Exported `TICKETS_ADVANCE_SCHEMA`, `handle_tickets_advance`

## Acceptance Criteria Coverage

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| AC1 | `tickets.advance` registered with dynamic tool registry | ✅ PASS | `TestAdvanceToolRegistration` (5 tests) |
| AC2 | Tool accepts ticket_id, agent_id, and evidence | ✅ PASS | `TestAdvanceToolInput` (11 tests) |
| AC3 | Validates agent holds active claim | ✅ PASS | `TestAdvanceClaimValidation` (3 tests) |
| AC4 | Stage engine enforces SDLC flow order | ✅ PASS | `TestAdvanceStageEnforcement` (2 tests) + `TestValidateAdvance*` (17 tests) |
| AC5 | SERIALIZABLE transaction isolation | ✅ PASS | `TestAdvanceTransactionIsolation` (1 test) — verifies `isolation_for(OperationType.ADVANCE) == SERIALIZABLE` |
| AC6 | Event history record on every transition | ✅ PASS | `advance_ticket()` inserts `STAGE_ADVANCED` event with agent, stages, payload |
| AC7 | Returns updated ticket data or MCP error | ✅ PASS | `TestAdvanceReturnValues` (5 tests) |

## TDD Evidence

### Cycle 1: Stage Engine (RED→GREEN→REFACTOR)
- **RED:** Wrote 28 tests for `get_next_stage()`, `validate_advance()`, `InvalidTransitionError`
- **GREEN:** Implemented pure functions in `stage_engine.py`
- **REFACTOR:** Kept simple — no refactoring needed for pure functions
- **Result:** 28/28 PASS, 100% coverage

### Cycle 2: Advance Tool + Service (RED→GREEN→REFACTOR)
- **RED:** Wrote 34 tests for `AdvanceTicketResult`, `ClaimValidationError`, tool schema, handler, registration
- **GREEN:** Implemented `AdvanceTicketResult` dataclass, `ClaimValidationError` exception, `advance_ticket()` method with `transactional()` context manager, tool handler and registration
- **REFACTOR:** Used existing `TicketNotFoundError` from `mcp_server.server` instead of creating duplicate
- **Result:** 34/34 PASS

## Test Results
- **Total:** 62 passed, 0 failed
- **stage_engine.py coverage:** 100%
- **Lint:** All BE030 files pass ruff (0 errors, 0 warnings)

## Architecture Notes
- `stage_engine.py` is a pure-domain module with no I/O — depends on nothing, easily testable
- `advance_ticket()` uses `transactional(pool, OperationType.ADVANCE)` for SERIALIZABLE isolation with automatic retry on SQLSTATE 40001
- Claim fields are cleared on advance (claimed_by, machine_id, operator, lease_expiry set to NULL)
- `completed_at` is set only when advancing to DONE stage
- Event payload includes optional `evidence` dict from the tool input

## Confidence
**HIGH** — All acceptance criteria met, all tests passing, lint clean, TDD followed.
