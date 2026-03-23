# TASK-INT-BE013 — Backend Complete

## Summary
Implemented the `tickets.payload` MCP tool that returns the full delegation context for an agent working on a specific ticket.

## Artifacts Created
- `forgeos-server/src/tools/tickets-payload.ts` — Tool implementation (schema + handler)
- `forgeos-server/src/tools/tickets-payload.test.ts` — 15 unit tests (all passing)

## Artifacts Modified
- `forgeos-server/src/tools/index.ts` — Registered `tickets.payload` tool

## Implementation Details

### Tool Contract
- **Input:** `ticket_id` (string, required), `agent_role` (string, required) — Zod validated
- **Output:** `{ ticket, upstream_summary, file_scope, memory_entries, message }`

### Payload Assembly
1. Fetches ticket from PostgreSQL by `ticket_id`
2. Derives upstream stage from `sdlc_flow[]` (the stage immediately before current)
3. Maps upstream stage to agent folder via `STAGE_TO_AGENT_FOLDER` constant
4. Reads upstream summary from `.github/agent-output/{UpstreamAgent}/{ticket_id}.md`
5. Queries events table for all ticket-related memory entries
6. Returns `file_scope` from ticket's `file_paths` field

### Stage-to-Agent Mapping
| Stage | Agent Folder |
|-------|-------------|
| RESEARCH | Research |
| ARCHITECT | Architect |
| PRODUCT_MANAGER | ProductManager |
| UI_DESIGN | UIDesigner |
| BACKEND | Backend |
| FRONTEND | Frontend |
| QA | QA |
| SECURITY | Security |
| CI | CIReviewer |
| DOCUMENTATION | Documentation |
| VALIDATOR | Validator |

### TDD Evidence
- **RED:** Schema tests written first — reject empty/missing params, accept valid params
- **GREEN:** Handler returns correct payload shape, upstream summary, file scope, memory entries
- **REFACTOR:** Extracted `getUpstreamStage` and `readUpstreamSummary` helpers

### Test Results
```
15 passed (15)
- ticketsPayloadSchema: 5 tests (validation of required fields, empty strings, types)
- ticketsPayloadHandler: 10 tests (full payload, upstream summary present/missing/first-stage, file_scope, memory_entries, NOT_FOUND, DB error, frontend upstream derivation, MCP structure)
```

### Type Check
`tsc --noEmit` — 0 errors

## Decisions
- Used events table for memory_entries (matches ticket-system.instructions.md pattern)
- Used filesystem read for upstream summary (matches git-protocol.instructions.md summary handoff)
- Followed exact same patterns as `tickets-get.ts` for error handling and response shape

## Confidence
**HIGH** — All 7 acceptance criteria met, 15 tests passing, type-safe, follows established patterns.

## Timestamp
2026-03-12T21:36:00Z
