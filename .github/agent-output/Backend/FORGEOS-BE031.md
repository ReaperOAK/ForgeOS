# FORGEOS-BE031 — BACKEND Stage Summary

## Ticket
- **ID:** FORGEOS-BE031
- **Title:** Implement tickets.rework MCP Tool
- **Type:** backend
- **Agent:** Backend
- **Machine:** pop-os
- **Timestamp:** 2026-03-11T01:30:00Z

## Implementation Summary

Implemented the `tickets.rework` MCP tool that returns a ticket to its implementation stage with rejection evidence. The tool enforces the maximum rework count (3 attempts) and escalates when the limit is reached.

## Files Created/Modified

| File | Action |
|------|--------|
| `mcp-server/src/mcp_server/tools/ticket_tools.py` | Modified — added `REWORK_TOOL_NAME`, `TICKETS_REWORK_SCHEMA`, `handle_tickets_rework`, `_make_rework_handler`, registered in `register_ticket_tools` |
| `mcp-server/src/mcp_server/services/ticket_service.py` | Modified — added `ReworkResult` dataclass, `rework_ticket` method on `TicketService` |
| `mcp-server/tests/test_rework_tool.py` | Created — 34 tests covering all 8 acceptance criteria |

## TDD Evidence

### RED Phase
- Created `tests/test_rework_tool.py` with 34 tests covering all 8 ACs.
- Tests failed with `ImportError: cannot import name 'ReworkResult'` — confirming RED.

### GREEN Phase
- Added `ReworkResult` dataclass to `ticket_service.py`.
- Added `rework_ticket` method to `TicketService` class with SERIALIZABLE transaction isolation.
- Added `TICKETS_REWORK_SCHEMA`, `handle_tickets_rework`, `_make_rework_handler` to `ticket_tools.py`.
- Registered `tickets.rework` tool in `register_ticket_tools`.
- All 34 tests passed.

### REFACTOR Phase
- Fixed ruff lint errors (unused import, import sorting, line length).
- All checks pass with zero warnings.

## Acceptance Criteria Coverage

| AC | Description | Status |
|----|-------------|--------|
| AC1 | `tickets.rework` MCP tool registered with the dynamic tool registry | ✅ PASS (5 tests) |
| AC2 | Tool accepts ticket_id, agent_id, reason, and optional rejection_evidence | ✅ PASS (10 tests) |
| AC3 | Tool validates agent holds claim on the ticket | ✅ PASS (2 tests) |
| AC4 | Rework resets ticket to its implementation stage (per ticket type flow) | ✅ PASS (3 tests) |
| AC5 | rework_count incremented; at rework_count >= 3 ticket moves to ESCALATED | ✅ PASS (2 tests) |
| AC6 | Event history record created with rejection reason and evidence | ✅ PASS (2 tests) |
| AC7 | Previous stage summaries preserved for rework context | ✅ PASS (1 test) |
| AC8 | Returns updated ticket data or MCP error | ✅ PASS (3 tests + 6 service-level tests) |

## Architecture Decisions

- **SERIALIZABLE isolation** for rework transactions (same as advance) — prevents concurrent advance/rework conflicts.
- **Implementation stage** derived from `sdlc_flow[1]` — always the first stage after READY.
- **STAGE_REJECTED event** for normal rework, **ESCALATED event** when max reworks reached.
- **Claim released** on rework — ticket returns to READY status for re-claiming.
- **Rejection evidence preserved** in event payload — summaries not deleted to maintain rework context.

## Test Results
- 34 tests PASSED (test_rework_tool.py)
- 105 existing tests PASSED (test_ticket_tools.py) — no regression
- ruff: All checks passed

## Confidence
**HIGH** — All 8 acceptance criteria met with comprehensive test coverage.
