# L1 — ForgeOS Strategic Capability Breakdown

## Source Artifacts
- Architecture: `.github/agent-output/Architect/FORGEOS-ARCH-001.md` (2440 lines, 87% confidence)
- Research: `.github/agent-output/Research/FORGEOS-RESEARCH-001.md` (906 lines, 82% confidence)
- PRD: `.github/agent-output/ProductManager/FORGEOS-PRD-001.md` (1314 lines, 85% confidence)

## Vision
Transform ForgeOS from a file-based single-machine orchestration system into a distributed AI software factory backed by PostgreSQL, exposed via MCP (Model Context Protocol), with real-time dashboard monitoring and multi-machine coordination.

---

## Capability Areas

### CAP-01: Database Foundation
**Domain:** Data persistence and schema management
**Owner Agents:** Backend, DevOps
**Description:** PostgreSQL 17 schema with all tables (projects, tickets, agents, sessions, file_locks, events, system_config), enums, indexes (GIN on JSONB/arrays, composite on stage+status), RLS policies, SQL functions (claim_ticket, advance_ticket, reject_ticket, release_ticket, extend_lease, resolve_dependencies, release_expired_claims, notify_ticket_change), connection pooling via pg.Pool, and migration framework.
**Critical Path:** Yes — all other capabilities depend on the database.
**Upstream Evidence:** Architect §3 (complete DDL), Research §2 (SKIP LOCKED validation), PRD FR-11 through FR-16.

### CAP-02: MCP Server Core
**Domain:** Server infrastructure and transport
**Owner Agents:** Backend
**Description:** Node.js 22 + TypeScript server using `@modelcontextprotocol/server` with Streamable HTTP transport via Express. Entry point, MCP server factory with `registerTool()` API, session management via `mcp-session-id` header, health endpoint (`GET /health`), structured JSON logging with correlation IDs, graceful shutdown.
**Critical Path:** Yes — all tools and API endpoints depend on the server.
**Upstream Evidence:** Architect §4 (server setup), Research §1 (MCP SDK v1.27+), PRD TASK-01.

### CAP-03: Ticket Tools
**Domain:** Core business logic — 10 MCP tools
**Owner Agents:** Backend
**Description:** All 10 MCP tools for ticket lifecycle management: tickets.next (SKIP LOCKED fair distribution), tickets.claim (atomic claim with file mutex), tickets.update (metadata), tickets.complete (stage advancement with SDLC engine), tickets.reject (rework/escalation), tickets.spawn (child tickets), tickets.graph (dependency DAG), tickets.release (claim release), tickets.extend (lease extension), tickets.stats (aggregate metrics). Each tool uses Zod schema validation and returns structured JSON responses.
**Critical Path:** Yes — dashboard and agent SDK depend on tools.
**Upstream Evidence:** Architect §4.2 (all 10 tool definitions), PRD FR-01 through FR-10, Research §2.1 (SKIP LOCKED pattern).

### CAP-04: Authentication & Security
**Domain:** Identity, access control, file-level locking
**Owner Agents:** Backend, Security
**Description:** API key authentication middleware (SHA-256 hashed keys, `Authorization: Bearer` header), role-based authorization (13 roles × 10 operations matrix), agent/machine registration, file-level mutex (advisory locks on file_paths to prevent cross-ticket conflicts), rate limiting (100 req/min per API key).
**Critical Path:** Partial — auth middleware is needed before production, but tools can be developed without it.
**Upstream Evidence:** Architect §7 (security architecture), Research §4 (API keys over OAuth for v1), PRD FR-17 through FR-21.

### CAP-05: Dashboard
**Domain:** Real-time monitoring and visualization
**Owner Agents:** Frontend
**Description:** Vanilla HTML + CSS + D3.js dashboard (no framework, no build step). Pipeline board (Kanban-style by SDLC stage), dependency graph (D3.js force-directed DAG), ticket detail panel with history timeline, machine status view, system health panel. Real-time updates via SSE (Server-Sent Events) with < 1 second latency. REST API endpoints for dashboard data.
**Critical Path:** No — can be built after core tools.
**Upstream Evidence:** Architect §5 (file structure), Research §5 (Vanilla + SSE + D3.js), PRD FR-22 through FR-27.

### CAP-06: Git Integration
**Domain:** Webhook reconciliation and commit validation
**Owner Agents:** Backend, DevOps
**Description:** GitHub push webhook receiver (`POST /api/webhooks/github`) with HMAC-SHA256 verification, commit message parsing (CLAIM/WORK regex), ghost commit recovery (DB/Git state reconciliation), Husky pre-commit hooks (commit-msg format validation, blast radius scope checking), agent-runner wrapper for safe git operations with MCP fallback.
**Critical Path:** No — can be added after core tools.
**Upstream Evidence:** Architect §7.5 (git hooks), Research §3 (webhook integration), PRD FR-28 through FR-32.

### CAP-07: Agent System Update
**Domain:** Configuration and documentation
**Owner Agents:** Documentation
**Description:** Update all 14 .github/agents/*.agent.md files with MCP tool references, update 6 instruction files for new architecture, update agents.md/copilot-instructions.md/README.md, update tickets.py for backward compatibility bridge (dual-mode operation).
**Critical Path:** No — can be done after core implementation.
**Upstream Evidence:** PRD §5 (SDLC flow updates), Architect §6 (state machine design).

### CAP-08: Infrastructure
**Domain:** Containerization and deployment
**Owner Agents:** DevOps
**Description:** Multi-stage Dockerfile (Node.js 22 Alpine builder + runtime), Docker Compose with PostgreSQL 17 + PgBouncer + MCP server (healthcheck-gated startup, persistent volumes, Docker secrets), .env.example template, .dockerignore, startup scripts.
**Critical Path:** Partial — Docker Compose enables development environment.
**Upstream Evidence:** Architect §8 (deployment architecture), Research §6 (Docker Compose patterns), PRD FR-33 through FR-36.

---

## Domain Boundaries

| Capability | Bounded Context | Data Ownership |
|-----------|----------------|----------------|
| CAP-01 Database | Schema, migrations, pool | All persistent state |
| CAP-02 MCP Server | Transport, routing, sessions | MCP sessions |
| CAP-03 Ticket Tools | Business logic, state transitions | Ticket lifecycle |
| CAP-04 Auth | Identity, permissions, rate limits | Agent identities, API keys |
| CAP-05 Dashboard | Visualization, SSE streaming | Read-only views |
| CAP-06 Git Integration | Webhooks, hooks, reconciliation | Git commit state |
| CAP-07 System Update | Agent/instruction config files | Configuration |
| CAP-08 Infrastructure | Containers, networking, volumes | Runtime environment |

## Critical Path
```
CAP-01 (Database) → CAP-02 (Server) → CAP-03 (Tools) → CAP-05 (Dashboard)
                                     ↘ CAP-04 (Auth)
                                     ↘ CAP-06 (Git)
CAP-08 (Infrastructure) → runs in parallel
CAP-07 (System Update) → after CAP-03
```

---

*Generated by TODO Agent — 2026-03-05T00:00:00Z*
