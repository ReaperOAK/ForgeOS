# FORGEOS-BE034 — Backend Rework #1 Report

**Agent:** Backend  
**Machine:** pop-os  
**Operator:** ReaperOAK  
**Completed:** 2026-03-11T06:15:00Z  
**Verdict:** COMPLETE  
**Confidence:** HIGH

---

## Rework Summary

Addressed both blocker defects identified in QA rejection:

### DEFECT-1 FIX: Added `list_tickets()` to `TicketRepository`

- **File:** `mcp-server/src/mcp_server/repositories/ticket_repo.py`
- **Method:** `async def list_tickets(self, *, stage, ticket_type, priority, claimed_by, machine_id, limit, offset) -> tuple[list[TicketRow], int]`
- **Implementation:**
  - Dynamic WHERE clause with positional `$N` params for all 5 filters (stage, ticket_type, priority, claimed_by, machine_id)
  - `claimed_by` maps to `claimed_by_name` column; `machine_id` maps to `machine_id` column
  - Uses `COUNT(*) OVER() AS full_count` window function for efficient total count in a single query
  - Returns `tuple[list[TicketRow], int]` — matching the contract expected by `routes/tickets.py`
  - Parameterized queries throughout — zero SQL injection risk

### DEFECT-2 FIX: Mounted `/api/tickets` in `transport/http.py`

- **File:** `mcp-server/src/mcp_server/transport/http.py`
- **Changes:**
  - Imported `create_tickets_endpoint` from `mcp_server.api.routes`
  - Created `_ticket_repo_ref` with same late-binding pattern as `_audit_repo_ref`
  - Added `Route("/api/tickets", tickets_handler, methods=["GET"])` to routes list
  - Stored `ticket_repo_ref` on `app.state` for lifespan binding

## Files Modified

| File | Change |
|------|--------|
| `mcp-server/src/mcp_server/repositories/ticket_repo.py` | Added `list_tickets()` method with 5-filter dynamic WHERE + COUNT(*) OVER() |
| `mcp-server/src/mcp_server/transport/http.py` | Mounted `/api/tickets` route with late-binding ticket_repo_ref |
| `mcp-server/tests/test_ticket_list_api.py` | Added 3 new tests: method existence guard, route mount verification, app.state ref check |

## TDD Evidence

- **RED:** Added `TestTicketRepositoryMethodExists` — asserts `TicketRepository` has `list_tickets` with correct signature params. Added `TestTicketsRouteMounted` — asserts `/api/tickets` appears in create_app() routes and `ticket_repo_ref` on app.state.
- **GREEN:** Implemented `list_tickets()` in ticket_repo.py and mounted route in http.py.
- **REFACTOR:** Reused existing `list_filtered` dynamic WHERE pattern; followed `_audit_repo_ref` late-binding pattern.

## Test Results

- **Tests:** 29/29 PASS (3 new tests added)
- **Ruff lint:** 0 new errors (4 pre-existing TC002/TC003 warnings unchanged)
- **New tests guard against AsyncMock masking** — `TestTicketRepositoryMethodExists` verifies the real class has `list_tickets` with the expected signature

## Acceptance Criteria Status

| # | Criterion | Status |
|---|-----------|--------|
| 1 | GET /api/tickets returns paginated list | ✅ PASS |
| 2 | Filtering by stage, type, priority, claimed_by, machine_id | ✅ PASS |
| 3 | Pagination via offset/limit with total count | ✅ PASS |
| 4 | Response schema with Pydantic models | ✅ PASS |
| 5 | API routes mounted on HTTP/SSE transport | ✅ PASS |
| 6 | Empty filter returns all; invalid filter → 400 | ✅ PASS |
