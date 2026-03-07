# FORGEOS-ARCH008 — Architecture Summary

## Ticket
- **Title:** Design REST API OpenAPI Specification
- **Type:** architecture
- **Stage:** ARCHITECT → DOCS

## Context Map

### Primary Files
- `docs/architecture/api/openapi-spec.yaml` — **deliverable** (created/replaced)

### Secondary Files (referenced, not modified)
- `forgeos-server/src/types/index.ts` — canonical TypeScript type definitions (28-field Ticket, TicketEvent, ForgeOSErrorCode enum, SDLC_FLOWS, MCP tool I/O types)
- `docs/architecture/system-components.md` — system architecture (FORGEOS-ARCH001)
- `docs/architecture/database-schema.md` — PostgreSQL schema (FORGEOS-ARCH005)
- `forgeos-server/src/server.ts` — Express app, MCP endpoint, REST router
- `forgeos-server/src/middleware/auth.ts` — BearerAuth + ApiKeyAuth middleware
- `docs/architecture/adr/adr-001-postgresql.md` — PostgreSQL ADR
- `docs/architecture/adr/adr-002-mcp-protocol.md` — MCP protocol ADR

### Established Patterns
- Modular monolith (Express + MCP on single server)
- PostgreSQL as source of truth with RLS per-agent
- Event-sourced audit log (events table)
- MCP JSON-RPC for agent orchestration, REST for admin/dashboard
- Zod validation on all inputs

## Well-Architected Assessment

| Pillar | Score | Notes |
|--------|-------|-------|
| Operational Excellence | HIGH | OpenAPI 3.1 spec with health probes, structured errors, pagination |
| Security | HIGH | Dual auth (BearerAuth + ApiKeyAuth), no secrets in error responses, security: [] only on /health |
| Reliability | HIGH | Atomic claim/advance via PostgreSQL, event-sourced audit, structured error codes |
| Performance | HIGH | Pagination with configurable page_size, connection pool metrics in health, WebSocket for real-time |
| Cost Optimization | HIGH | Single spec file, modular monolith — no overprovisioning |
| Sustainability | HIGH | OpenAPI-generated clients, strong typing, comprehensive examples |

## Component Boundaries
- **REST API** — Dashboard/admin/operator visibility and manual intervention
- **MCP Protocol** — Agent-to-server orchestration (claims, advances, rejections)
- **WebSocket** — Real-time streaming of ticket state changes to dashboards
- All ticket state mutations flow through MCP tools or REST endpoints → PostgreSQL stored functions

## ADRs Referenced
- ADR-001: PostgreSQL as state store (FORGEOS-ARCH001)
- ADR-002: MCP as agent protocol, REST for admin/dashboard (FORGEOS-ARCH002)

## Spec Coverage

### Acceptance Criteria Mapping
1. ✅ All REST endpoints defined: GET /tickets, GET /tickets/:id, POST claim/advance/rework/release
2. ✅ Query filters: stage, type, priority, status, claimed_by with pagination (page, page_size)
3. ✅ GET /tickets/:id/history — returns TicketHistoryResponse with full TicketEvent array
4. ✅ GET /stages — returns StageOverviewResponse with StageInfo[], sdlc_flows map, total_tickets
5. ✅ GET /health — readiness/liveness with database/server sub-checks, 200 vs 503
6. ✅ Request/response schemas: ClaimRequest/Response, AdvanceRequest/Response, ReworkRequest/Response, ReleaseRequest/Response, TicketListResponse, TicketHistoryResponse
7. ✅ ErrorResponse: status, error_code (ForgeOSErrorCode enum — 14 codes), message, details, ticket_id, timestamp
8. ✅ WebSocket /ws/tickets: WebSocketMessage (10 event types), WebSocketSubscription filter, heartbeat contract
9. ✅ Spec delivered at docs/architecture/api/openapi-spec.yaml

### Schema Alignment with TypeScript
- Ticket schema: all 28 fields from `types/index.ts` Ticket interface
- TicketEvent schema: all 14 fields from `types/index.ts` TicketEvent interface
- TicketStatus enum: 7 values (READY, BLOCKED, CLAIMED, IN_PROGRESS, DONE, FAILED, ESCALATED)
- TicketStage enum: 13 values (READY through DONE, including PRODUCT_MANAGER, UI_DESIGN)
- TicketType enum: 10 values (backend through design)
- TicketPriority enum: 4 values (critical, high, medium, low)
- EventType enum: 15 values (CREATED through COMPLETED)
- ForgeOSErrorCode enum: 14 codes (TICKET_NOT_FOUND through DB_UNAVAILABLE)

## DAG Task Graph
1. ✅ Write OpenAPI spec (this ticket — FORGEOS-ARCH008)
2. → Implement REST endpoints in `forgeos-server/src/server.ts` (downstream)
3. → Integrate dashboard with REST API (downstream)
4. → Add WebSocket support (downstream)

## Fitness Functions
- OpenAPI 3.1.0 format validates
- All 9 acceptance criteria endpoints present
- Authentication required on all endpoints except `/health`
- ErrorResponse uses ForgeOSErrorCode enum for machine-readable error handling
- Real-time updates contract: WebSocket with subscription filtering and heartbeat
- Pagination: configurable page_size (1–100), total/total_pages in response

## Pattern Selection
- **Modular monolith** — REST for admin, MCP for agents, event-sourced audit
- **Justification:** Single deployment, clear bounded contexts via tool/route modules, no need for microservice overhead at current scale

## Anti-Pattern Checks
- ✅ No Big Ball of Mud — clear separation between MCP and REST surfaces
- ✅ No Golden Hammer — REST for admin, MCP for agents, WebSocket for streaming
- ✅ No Distributed Monolith — single process
- ✅ No God Service — each endpoint has focused responsibility
- ✅ No Shared Database anti-pattern — all access through defined API contracts

## Confidence: HIGH
All 9 acceptance criteria fully addressed. Schemas align 1:1 with TypeScript types. Dual authentication. Comprehensive error model with 14 machine-readable error codes. WebSocket contract with subscription filtering. Health endpoint with readiness/liveness semantics.

---

**Artifacts:**
- docs/architecture/api/openapi-spec.yaml

**Decisions:**
- REST API serves dashboard/admin needs; MCP protocol serves agent orchestration
- Added `status` query filter beyond acceptance criteria (value-add for operators)
- AdvanceRequest requires structured evidence (artifacts, test_results, confidence) to enforce DoD
- WebSocket uses subscription-based filtering for efficient dashboard updates
- Health endpoint returns sub-checks (database, server) with pool and memory metrics

**Timestamp:** 2026-03-07T08:45:00Z
