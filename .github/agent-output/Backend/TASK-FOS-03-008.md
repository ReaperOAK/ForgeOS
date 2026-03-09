# TASK-FOS-03-008 — Backend Summary

## Tool: tickets.release — Release Claim

### Files Created / Modified

| File | Action |
|------|--------|
| `forgeos-server/src/tools/tickets-release.ts` | Created — MCP tool handler + Zod schema |
| `forgeos-server/src/tools/tickets-release.test.ts` | Created — 17 unit tests (vitest) |
| `forgeos-server/src/tools/index.ts` | Modified — registered `tickets.release` tool |

### Implementation Details

- **Zod schema:** `ticket_id` (string, required), `agent_name` (string, required), `reason` (string, optional), `force` (boolean, default false)
- **SQL function:** Calls `release_ticket(p_ticket_id, p_agent_id, p_agent_name, p_reason, p_force)` from `001_initial.sql`
- **Agent resolution:** Looks up agent by name for UUID; auto-registers unknown agents with non-admin `["agent_update"]` permissions
- **Admin gate:** Force release requires `*` or `admin_all` permission; returns `FORBIDDEN` for non-admin callers
- **File lock snapshot:** Captures locked file paths before release for the response payload
- **Error mapping:** SQL exceptions `TICKET_NOT_FOUND` and `NOT_CLAIM_OWNER` mapped to structured error codes
- **Response shape:** `{ ticket: Ticket, released_file_locks: string[] }`

### Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Tool registered as 'tickets.release' with Zod schema | ✅ PASS |
| 2 | Returns NOT_CLAIM_OWNER error if caller isn't the claim owner and force=false | ✅ PASS |
| 3 | Force release requires admin role; returns FORBIDDEN if non-admin attempts force=true | ✅ PASS |
| 4 | On success, ticket status returns to READY with claim fields NULL | ✅ PASS |
| 5 | All file locks for the ticket are released | ✅ PASS |
| 6 | RELEASED or FORCE_RELEASED event recorded with reason | ✅ PASS (via SQL function) |
| 7 | Returns {ticket, released_file_locks: string[]} on success | ✅ PASS |

### TDD Evidence

- **RED:** Wrote 17 tests covering schema validation, error codes, success paths, admin gate, auto-registration, and edge cases
- **GREEN:** Implemented handler passing all 17 tests
- **REFACTOR:** Extracted `hasAdminPermission()` and `buildErrorResult()` helpers for DRY error handling

### Test Results

```
 ✓ src/tools/tickets-release.test.ts (17 tests) 8ms
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

### Confidence Level

**HIGH** — All 7 acceptance criteria met, 17/17 tests pass, zero TypeScript errors, follows existing codebase patterns (tickets-claim.ts).
