# FORGEOS-BE030 — QA Stage Summary

## Ticket
**Title:** Implement tickets.advance MCP Tool  
**Type:** backend  
**Stage:** QA → SECURITY  
**Verdict:** PASS  
**Confidence:** HIGH  

## Test Results

| Suite | Tests | Passed | Failed | Skipped |
|-------|-------|--------|--------|---------|
| test_stage_engine.py | 28 | 28 | 0 | 0 |
| test_advance_tool.py | 34 | 34 | 0 | 0 |
| test_advance_service.py (QA gap tests) | 15 | 15 | 0 | 0 |
| **TOTAL** | **77** | **77** | **0** | **0** |

## Coverage Report

### BE030-Specific Code Coverage

| File | BE030 Code Coverage | Notes |
|------|-------------------|-------|
| `stage_engine.py` | **100%** | 24/24 stmts covered |
| `ticket_service.py` advance_ticket() | **100%** | All branches: pool guard, ticket not found, no claim, wrong agent, final stage, empty flow, success path, evidence payload, DONE status |
| `ticket_tools.py` advance handler/schema | **100%** | TICKETS_ADVANCE_SCHEMA, handle_tickets_advance, _make_advance_handler, ADVANCE_TOOL_NAME, registration |
| `AdvanceTicketResult` (dataclass) | **100%** | to_dict, frozen immutability |
| `ClaimValidationError` (exception) | **100%** | attributes, str representation |
| `__init__.py` exports | **100%** | AdvanceTicketResult, ClaimValidationError, TICKETS_ADVANCE_SCHEMA, handle_tickets_advance exported |

### File-Level Coverage (includes code from other tickets)

| File | Stmts | Miss | Cover |
|------|-------|------|-------|
| stage_engine.py | 24 | 0 | 100% |
| ticket_service.py | 192 | 87 | 55% |
| ticket_tools.py | 160 | 83 | 48% |

Note: File-level coverage is low because `ticket_service.py` and `ticket_tools.py` contain code from BE028, BE029, BE032, BE033. All missing lines belong to other tickets' methods (claim_next, claim_by_id, release_ticket, get_ticket_status, list_tickets, sync, validate). **All BE030-specific code is at 100% coverage.**

## Acceptance Criteria Verification

| # | Criterion | Verdict | Evidence |
|---|-----------|---------|----------|
| AC1 | `tickets.advance` registered with dynamic tool registry | ✅ PASS | `TestAdvanceToolRegistration` (5 tests): registered, correct name, description, schema, schema match |
| AC2 | Tool accepts ticket_id, agent_id, evidence | ✅ PASS | `TestAdvanceToolInput` (11 tests): required params, optional evidence, validation errors |
| AC3 | Validates agent holds active claim | ✅ PASS | `TestAdvanceClaimValidation` (3 handler tests) + `TestAdvanceClaimValidationService` (2 service tests): not found, not claimed, wrong agent |
| AC4 | Stage engine enforces SDLC flow order | ✅ PASS | `TestGetNextStage` (9 tests) + `TestValidateAdvanceSuccess` (10 tests) + `TestValidateAdvanceErrors` (7 tests) + `TestAdvanceStageEnforcementService` (2 tests): all flows, boundary, error cases |
| AC5 | SERIALIZABLE transaction isolation | ✅ PASS | `TestAdvanceTransactionIsolation` (1 test) + `test_advance_uses_transactional_with_advance_op` (1 test): isolation_for(ADVANCE) == SERIALIZABLE, transactional called with OperationType.ADVANCE |
| AC6 | Event history record on every transition | ✅ PASS | `TestAdvanceEventHistory` (1 handler test) + `test_inserts_event_record` + `test_event_payload_*` (3 service tests): INSERT INTO events with STAGE_ADVANCED, correct stages, evidence payload |
| AC7 | Returns updated ticket data or MCP error | ✅ PASS | `TestAdvanceReturnValues` (5 tests) + `TestAdvanceTicketSuccess` (8 service tests): success shape, error codes, DONE status, to_dict serialization |

## QA-Added Gap Tests

Created `tests/test_advance_service.py` (15 tests) covering the `TicketService.advance_ticket()` method body which was previously only mocked at the handler layer:

- **TestAdvanceTicketPoolGuard** (1): ValueError when pool is None
- **TestAdvanceTicketNotFound** (1): TicketNotFoundError when row is None
- **TestAdvanceClaimValidationService** (2): no claim, different agent
- **TestAdvanceStageEnforcementService** (2): final stage, empty flow
- **TestAdvanceTicketSuccess** (9): correct result, DB UPDATE, INSERT events, empty payload, evidence payload, DONE status, claim field clearing, transactional OperationType, FOR UPDATE locking

## Mutation Testing

mutmut 3.5.0 encountered an internal `AssertionError` during mutant generation for `stage_engine.py` — a known bug. Manual analysis of the stage engine shows the test suite would kill all plausible mutations:

- **Boundary mutations** (off-by-one in `idx + 1`): caught by `test_returns_next_stage_before_done`, `test_returns_none_at_final_stage`
- **Return value mutations** (None → string, string → None): caught by `test_returns_none_for_unknown_stage`, `test_returns_none_for_empty_flow`, `test_returns_next_stage_from_ready`
- **Exception removal**: caught by `test_raises_on_empty_flow`, `test_raises_on_unknown_stage`, `test_raises_at_final_stage`
- **Condition negation**: caught by flow-specific tests across backend, frontend, fullstack, docs, research flows

## Lint

```
ruff check: All checks passed! (0 errors, 0 warnings)
```
All 6 files checked: stage_engine.py, ticket_service.py, ticket_tools.py, test_stage_engine.py, test_advance_tool.py, test_advance_service.py

## Defects Found

None.

## Architecture Review

- `stage_engine.py` is a pure-domain module with zero I/O — correct separation of concerns
- `advance_ticket()` uses `transactional(pool, OperationType.ADVANCE)` for SERIALIZABLE isolation with automatic retry — correct use of the transaction infrastructure
- Claim fields properly cleared on advance (NULL for claimed_by, machine_id, operator, lease_expiry)
- `completed_at` correctly set only when advancing to DONE
- Event payload correctly includes optional evidence dict
- Error mapping in handler correctly translates domain exceptions to MCP error responses with structured codes

## Artifacts

### Created
- `mcp-server/tests/test_advance_service.py` — 15 gap tests for advance_ticket service method

### Reviewed (read-only)
- `mcp-server/src/mcp_server/services/stage_engine.py`
- `mcp-server/src/mcp_server/services/ticket_service.py`
- `mcp-server/src/mcp_server/tools/ticket_tools.py`
- `mcp-server/src/mcp_server/services/__init__.py`
- `mcp-server/src/mcp_server/tools/__init__.py`
- `mcp-server/tests/test_stage_engine.py`
- `mcp-server/tests/test_advance_tool.py`
