# FORGEOS-ARCH008 — Architecture Summary

## Context Map
- **Primary files:**
  - docs/architecture/api/openapi-spec.yaml (new)
  - forgeos-server/src/server.ts (Express app, MCP endpoint, REST, SSE)
  - forgeos-server/src/middleware/auth.ts (auth)
  - forgeos-server/src/types/index.ts (types)
  - forgeos-server/src/tools/ (MCP tools)
- **Secondary files:**
  - docs/architecture/system-components.md
  - docs/architecture/adr/adr-002-mcp-protocol.md
  - docs/architecture/adr/adr-001-postgresql.md
  - docs/research/mcp-protocol-spec.md
  - docs/research/mcp-transport-comparison.md

## Well-Architected Assessment
- **Operational Excellence:**
  - API versioned, OpenAPI 3.1, stateless, health checks, error model
- **Security:**
  - Bearer/JWT auth, RLS in DB, no sensitive data in error responses
- **Reliability:**
  - PostgreSQL as source of truth, atomic claim/advance, event-sourced audit
- **Performance:**
  - Pagination, indexed queries, SSE/WebSocket for real-time
- **Cost Optimization:**
  - Modular monolith, single server, no overprovisioning
- **Sustainability:**
  - OpenAPI spec, strong typing, Zod validation, clear boundaries

## Component Boundaries
- REST API is for dashboard/admin/ops, not agent orchestration (MCP covers that)
- All ticket state changes go through MCP tools (not REST)
- REST API is read/write for operators, read-only for dashboard

## ADRs
- ADR-001: PostgreSQL as state store
- ADR-002: MCP as agent protocol, REST for admin/dashboard

## DAG Task Graph
- 1. Write OpenAPI spec (this ticket)
- 2. Implement REST endpoints in server
- 3. Integrate with dashboard
- 4. Add WebSocket support

## Fitness Functions
- OpenAPI validates (3.1.0)
- All endpoints in acceptance criteria present
- Auth required except health/dashboard/events
- Error model matches spec
- Real-time updates via WebSocket contract

## Pattern Selection
- Modular monolith, REST for admin, MCP for agents, event-sourced audit

## Confidence: HIGH
- All requirements mapped to spec, aligns with approved architecture, no anti-patterns detected.

---

**Artifacts:**
- docs/architecture/api/openapi-spec.yaml

**Decisions:**
- REST API is for dashboard/admin, not agent orchestration (MCP covers agent flows)
- All state changes go through MCP tools, REST is a thin admin/operator layer
- WebSocket endpoint defined for real-time ticket streaming

**Timestamp:** 2026-03-06T00:00:00Z
