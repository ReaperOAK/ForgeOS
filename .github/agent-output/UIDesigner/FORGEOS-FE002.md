---
ticket: FORGEOS-FE002
agent: UIDesigner
stage: UIDESIGNER
date: 2026-03-11T00:00:00Z
status: COMPLETE
confidence: HIGH
---

# UIDesigner Summary — FORGEOS-FE002

## Ticket

**FORGEOS-FE002** — Implement API Client and Data Models

## Work Performed

This is a **code-only library ticket** (no visual UI). UIDesigner stage produced
interface contracts and data model specifications for the Frontend Engineer.

### Artifacts Created

- `docs/uiux/components/api-client-spec.md` — Full interface specification (status: APPROVED)

### Specification Contents

1. **Data Model Interfaces** — 8 TypeScript interfaces matching backend models:
   - `Ticket` (28 fields, mirrors `forgeos-server/src/types/index.ts`)
   - `TicketDetail` (extends Ticket with `dependency_status`)
   - `Claim` (derived from Ticket for Claims view)
   - `StageTransition` (stage/status change event subset)
   - `EventHistory` (full audit event, mirrors backend `TicketEvent`)
   - `PipelineOverview` + `StageSummary` (mirrors `GET /api/stages` response)
   - `PaginatedResponse<T>` + `PaginationInfo` (generic pagination wrapper)
   - `DependencyStatus` (resolved dependency info)

2. **Type Aliases** — 5 union types matching backend enums:
   - `TicketStage` (13 values)
   - `TicketStatus` (7 values)
   - `TicketType` (10 values)
   - `TicketPriority` (4 values)
   - `EventType` (15 values)

3. **API Function Signatures** — 4 typed functions:
   - `fetchTickets(filters?: TicketFilters) → PaginatedResponse<Ticket>`
   - `fetchTicket(ticketId: string) → TicketDetail`
   - `fetchPipelineOverview() → PipelineOverview`
   - `fetchTicketHistory(ticketId: string) → EventHistory[]`

4. **Error Handling Model** — `ApiError` interface with HTTP status mapping table,
   error parsing function signature, and abort/timeout handling spec.

5. **Configuration Interface** — `ApiClientConfig` with `baseUrl`, `timeout`, `headers`,
   defaulting to `NEXT_PUBLIC_API_URL || 'http://localhost:3000'`.

6. **Barrel Export** — Complete `index.ts` re-export specification.

7. **Backend API Reference** — Endpoint table with response shapes, query parameters,
   and authentication requirements.

### Design Decisions

- **Extend existing `api-client.ts`** rather than replacing it — preserves the working
  `ApiClient` class, `ApiResponse<T>`, and singleton pattern.
- **No separate Claims endpoint** — Claims are derived by filtering tickets with
  `status = 'CLAIMED'`. The `Claim` interface is a client-side projection.
- **Dashboard-scoped types only** — Backend-only types (Agent, Session, FileLock) are
  excluded from dashboard types to keep the bundle lean.
- **SSE excluded** — Real-time events via `/api/events` SSE stream is a separate ticket.

### Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| TypeScript interfaces for Ticket, Claim, StageTransition, EventHistory, PipelineOverview | ✅ Defined |
| `fetchTickets(filters) → PaginatedResponse<Ticket>` | ✅ Specified |
| `fetchTicket(id) → TicketDetail` | ✅ Specified |
| `fetchPipelineOverview() → PipelineOverview` | ✅ Specified |
| `fetchTicketHistory(id) → EventHistory[]` | ✅ Specified |
| Error responses parsed into typed error objects | ✅ ApiError with status/code/message |
| Base URL configurable via NEXT_PUBLIC_API_URL | ✅ Documented in ApiClientConfig |

### Confidence

**HIGH** — All interfaces directly verified against `forgeos-server/src/types/index.ts`
and `forgeos-server/src/api/routes/` endpoint implementations.

## Next Stage

FRONTEND — Frontend Engineer implements `types.ts`, `client.ts`, `tickets.ts`, `index.ts`
based on these specifications.
