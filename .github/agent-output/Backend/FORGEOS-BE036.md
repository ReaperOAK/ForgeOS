# FORGEOS-BE036 — BACKEND Complete

## Summary

Implemented `POST /api/tickets/{ticket_id}/claim` and `DELETE /api/tickets/{ticket_id}/claim` REST endpoints for claiming/releasing tickets via the dashboard or external integrations.

## Files Created/Modified

| File | Action |
|------|--------|
| `mcp-server/src/mcp_server/api/schemas.py` | Added `ClaimRequest`, `ClaimResponse`, `ReleaseResponse` Pydantic models |
| `mcp-server/src/mcp_server/api/routes/tickets.py` | Added `create_claim_endpoint` factory with POST/DELETE handlers |
| `mcp-server/src/mcp_server/api/routes/__init__.py` | Exported `create_claim_endpoint` |
| `mcp-server/src/mcp_server/transport/http.py` | Wired up `ticket_service_ref` and claim route at `/api/tickets/{ticket_id}/claim` |
| `mcp-server/tests/test_ticket_claim_api.py` | 19 tests covering all acceptance criteria |

## TDD Evidence

- **RED**: Tests written first — `create_claim_endpoint` import failed (ImportError)
- **GREEN**: Implemented schemas + route handler → all 19 tests pass
- **REFACTOR**: Fixed lint (ruff --fix: sorted imports, removed unused import)

## Coverage

- `schemas.py`: 100%
- `routes/tickets.py`: 93% (combined with existing tests)
- **Total**: 96% (77 tests across 3 test files)

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | POST accepts agent_id, machine_id, operator | ✅ | `ClaimRequest` schema validates body; `TestClaimEndpointSuccess` |
| 2 | Delegates to shared ticket service | ✅ | Calls `ticket_service.claim_by_id()` — same as MCP handler |
| 3 | Returns 200 with claimed ticket data | ✅ | `test_returns_200_with_claim_details` |
| 4 | Returns 409 on already claimed | ✅ | `test_returns_409_when_not_eligible`, `test_returns_409_on_claim_error` |
| 5 | Returns 400 on bad request / not in READY | ✅ | `test_returns_400_on_missing_body_fields`, `test_returns_400_on_unknown_agent_role` |
| 6 | Returns 404 when ticket doesn't exist | ✅ | `test_returns_404_when_ticket_not_found` |
| 7 | Request body validated with Pydantic ClaimRequest | ✅ | `TestClaimRequestSchema`, validation error → 400 |
| + | DELETE releases existing claim | ✅ | `TestReleaseEndpointSuccess` (200, 404, 409, 503) |

## Architecture Notes

- **Thin controller pattern**: Route handler validates input, delegates to `TicketService`, maps domain errors to HTTP status codes
- **Factory pattern**: `create_claim_endpoint(service_getter, repo_getter)` — consistent with existing route patterns
- **Error mapping**: `NoEligibleTicketError`/`ClaimError` → 409, `TicketNotFoundError` → 404, `ValueError` → 400
- **Deferred binding**: `ticket_service_ref` added to `app.state` for late binding by lifespan

## Confidence

**HIGH** — All acceptance criteria met with tested evidence. No TODOs, no console.log, no any types.
