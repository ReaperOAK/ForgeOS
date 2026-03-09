# TASK-FOS-03-005 — Backend Summary

## Ticket
**Title:** tickets.reject — Reject and Trigger Rework
**Stage:** BACKEND → QA
**Agent:** Backend
**Machine:** pop-os
**Operator:** reaperoak
**Timestamp:** 2026-03-09T20:56:54Z

## Artifacts

### Created
- `forgeos-server/src/tools/tickets-reject.ts` — MCP tool handler (172 lines)
- `forgeos-server/src/__tests__/tools/tickets-reject.test.ts` — 25 unit tests (~480 lines)

### Modified
- `forgeos-server/src/tools/index.ts` — Added `tickets.reject` registration with Zod schema and handler

## Implementation Details

### Tool Registration (AC1)
- Registered as `tickets.reject` on McpServer via `server.tool()`
- Zod schema: `ticket_id` (string), `reason` (string, min 10 chars), `evidence` (optional `Record<string, unknown>`)
- Follows established pattern from tickets.claim/tickets.next

### Claim Ownership Validation (AC2)
- Looks up agent UUID by name from `agents` table
- Auto-registers agent if not found (INSERT … ON CONFLICT DO NOTHING + re-SELECT)
- Passes agent_id to `reject_ticket()` SQL function which validates claim ownership

### SQL Function Call (AC3)
- Calls `SELECT * FROM reject_ticket($1, $2, $3, $4, $5::JSONB)` with:
  - ticket_id, agent_id (UUID), agent_name, reason, evidence (JSON stringified)
- SQL function handles all rework vs escalation logic internally

### Rework Result (AC4)
- Returns `{ ticket, rework_count, escalated: false, returned_to_stage }` on normal rework
- `returned_to_stage` extracted from ticket's `current_stage` field (implementation stage)

### Escalation Result (AC5)
- Returns `{ ticket, rework_count, escalated: true, returned_to_stage }` when `rework_count >= max_reworks`
- Detection: checks `ticket.status === 'ESCALATED'`

### Event Recording (AC6)
- STAGE_REJECTED event recorded by SQL function with reason, evidence, and rework_count

### File Lock Release (AC7)
- File locks released by SQL function as part of rejection process

### Escalated Ticket State (AC8)
- Escalated tickets have `status: 'ESCALATED'` and `claimed_by: null`

### Error Handling
- NOT_CLAIM_OWNER: Parsed from SQL exception message, returned as structured error
- INTERNAL_ERROR: Catch-all for unexpected failures
- Structured logging with requestId correlation

## TDD Evidence

### Red Phase
- Wrote 25 failing tests covering all 8 acceptance criteria before implementation
- Tests organized by AC section: schema validation (8), claim ownership (1), SQL call (2), rework result (2), escalation (2), event recording (1), file lock release (1), escalated state (1), error handling (4), MCP response format (3)

### Green Phase
- Implemented handler to pass all tests
- Minimum viable implementation following existing patterns

### Refactor Phase
- Extracted agent lookup with auto-registration pattern
- Clean error extraction from SQL exceptions
- Consistent MCP CallToolResult formatting

## Test Results
- **25/25 tests passing**
- **Statement coverage:** 100%
- **Branch coverage:** 90.9%
- **Function coverage:** 100%
- **Line coverage:** 100%

## Confidence
**HIGH** — All 8 acceptance criteria met with full test coverage. Implementation follows established patterns from tickets.claim and tickets.next tools.
