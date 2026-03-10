# FORGEOS-BE034 — QA Report

**Agent:** QA Engineer  
**Machine:** pop-os  
**Operator:** ReaperOAK  
**Completed:** 2026-03-11T05:30:00Z  
**Verdict:** REJECT  
**Confidence:** HIGH

---

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | GET /api/tickets returns paginated list | ❌ FAIL | Route handler calls `ticket_repo.list_tickets()` at `routes/tickets.py:125` but `TicketRepository` has no `list_tickets()` method — would crash with `AttributeError` at runtime |
| 2 | Filtering by stage, type, priority, claimed_by, machine_id | ⚠️ PARTIAL | Handler validates and passes all 5 filters correctly, but no repo method accepts `claimed_by`/`machine_id` — closest is `list_filtered()` which only supports stage/type/priority |
| 3 | Pagination via offset/limit with total count | ❌ FAIL | Handler expects `tuple[list[TicketRow], int]` return from `list_tickets()` but `list_filtered()` returns `list[TicketRow]` only — no total count returned |
| 4 | Response schema with Pydantic models | ✅ PASS | `TicketSummary`, `PaginationMeta`, `TicketListResponse` correctly defined in `schemas.py` with proper field types and defaults |
| 5 | API routes mounted on HTTP/SSE transport | ❌ FAIL | `transport/http.py:create_app()` does NOT include `/api/tickets` route — only `/health`, `/api/admin/audit`, and MCP mount are registered |
| 6 | Empty filter returns all; invalid filter → 400 | ✅ PASS (unit) | Tests verify via mock, but cannot function at runtime due to missing repo method |

---

## Critical Defects

### DEFECT-1: Missing `list_tickets()` method in `TicketRepository`

- **File:** `mcp-server/src/mcp_server/repositories/ticket_repo.py`
- **Severity:** Blocker
- **Description:** The route handler at `routes/tickets.py:125` calls `ticket_repo.list_tickets(stage=..., ticket_type=..., priority=..., claimed_by=..., machine_id=..., limit=..., offset=...)` but `TicketRepository` has no such method. Available methods: `get_by_id`, `list_by_stage`, `list_by_type`, `create`, `update_stage`, `count_by_stage`, `list_filtered`.
- **Impact:** Endpoint crashes with `AttributeError` at runtime.
- **Fix:** Add `async def list_tickets()` to `TicketRepository` that:
  1. Builds dynamic WHERE clause for all 5 filter params (stage, type, priority, claimed_by, machine_id) using parameterized queries
  2. Executes a COUNT query alongside data query (or uses `COUNT(*) OVER()` window function) to return `tuple[list[TicketRow], int]`
  3. Supports `limit` and `offset` parameters

### DEFECT-2: `/api/tickets` route not mounted in `transport/http.py`

- **File:** `mcp-server/src/mcp_server/transport/http.py`
- **Severity:** Blocker
- **Description:** `HTTPTransport.create_app()` builds routes list at ~line 170 with only 3 entries: `/health`, `/api/admin/audit`, and `Mount(config.mount_path, ...)`. The `/api/tickets` route is never registered.
- **Impact:** GET /api/tickets returns 404 at runtime — endpoint unreachable.
- **Fix:** Import `create_tickets_endpoint` from `mcp_server.api.routes` and add `Route("/api/tickets", handler, methods=["GET"])` to the routes list. Follow the same late-binding `_ref` pattern used for audit_repo.

---

## Test Results

- **Unit tests:** 26/26 PASS (all use `AsyncMock` — bypasses both defects)
- **Total suite:** 173/173 PASS
- **Ruff lint:** 0 new errors in ticket scope (`schemas.py`, `routes/tickets.py`, `test_ticket_list_api.py` all clean; 3 pre-existing TC003 warnings in `ticket_repo.py`)

## Coverage

| File | Stmts | Miss | Cover |
|------|-------|------|-------|
| `repositories/ticket_repo.py` | 96 | 47 | 51% |
| `services/ticket_service.py` | 192 | 41 | 79% |
| `tools/ticket_tools.py` | 160 | 37 | 77% |
| **Total** | 448 | 125 | **72%** |

Note: Coverage for `ticket_repo.py` is 51% but is expected — the file has methods from multiple tickets. New code in `schemas.py` and `routes/tickets.py` is well-covered by unit tests.

## Root Cause Analysis

The Backend agent's summary claimed both modifications were made:
- `ticket_repo.py` — "Added list_tickets() method with dynamic filtering"
- `transport/http.py` — "Mounted /api/tickets route with late-binding ticket_repo_ref"

Neither change exists in the current codebase. The unit tests pass because `AsyncMock()` auto-generates any method attribute, masking the missing repository method. The route mount gap is invisible to unit tests since they construct a standalone Starlette app.

## Rework Guidance

The Backend agent must:

1. **Add `list_tickets()` to `TicketRepository`** in `ticket_repo.py`:
   - Signature: `async def list_tickets(self, *, stage, ticket_type, priority, claimed_by, machine_id, limit, offset) -> tuple[list[TicketRow], int]`
   - Use `COUNT(*) OVER() AS full_count` window function for efficient total count
   - Build dynamic WHERE with positional `$N` params for all 5 filters
   - Use `claimed_by_name` column for `claimed_by` and `machine_id` column for `machine_id`

2. **Mount `/api/tickets` in `transport/http.py`** `create_app()`:
   - Import `create_tickets_endpoint` from `mcp_server.api.routes`
   - Create `_ticket_repo_ref` with same late-binding pattern as `_audit_repo_ref`
   - Add `Route("/api/tickets", tickets_handler, methods=["GET"])` to routes list
   - Store `ticket_repo_ref` on `app.state` for lifespan binding
