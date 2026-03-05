# L2 — ForgeOS Execution Blocks

## Source
- L1: `TODO/blocks/L1-forgeos-capabilities.md`
- Architecture: `.github/agent-output/Architect/FORGEOS-ARCH-001.md`
- PRD: `.github/agent-output/ProductManager/FORGEOS-PRD-001.md`

---

## Block 01: Database Foundation (CAP-01)

### Block 01-A: Schema & Migration
**Tickets:** TASK-FOS-01-001
**Effort:** M
**Description:** PostgreSQL DDL with all 7 tables, 8 enums, 18+ indexes, RLS policies, 7 SQL functions, NOTIFY trigger. Single migration file `001_initial.sql`.
**Dependencies:** None (standalone SQL file)

### Block 01-B: Connection & Seeding
**Tickets:** TASK-FOS-01-002, TASK-FOS-01-003
**Effort:** M
**Description:** pg.Pool singleton with health check, migration runner CLI, seed data (default project, admin agent), filesystem-to-PostgreSQL import tool.
**Dependencies:** Block 01-A

---

## Block 02: MCP Server Core (CAP-02)

### Block 02-A: Project Scaffold
**Tickets:** TASK-FOS-02-001, TASK-FOS-02-002
**Effort:** M
**Description:** package.json with all dependencies (@modelcontextprotocol/server, pg, zod, express, etc.), tsconfig.json (strict mode), entry point (index.ts), MCP server factory (server.ts), all TypeScript interfaces (types/index.ts).
**Dependencies:** None (standalone project setup)

### Block 02-B: Middleware & Error Handling
**Tickets:** TASK-FOS-02-003
**Effort:** S
**Description:** Structured JSON logging with correlation IDs, error handling (ForgeOSError enum, structured responses), request validation layer.
**Dependencies:** Block 02-A

---

## Block 03: Ticket Tools (CAP-03)

### Block 03-A: Core Operations (5 tools)
**Tickets:** TASK-FOS-03-001, TASK-FOS-03-002, TASK-FOS-03-003, TASK-FOS-03-004, TASK-FOS-03-005
**Effort:** L
**Description:** tickets.next (SKIP LOCKED), tickets.claim (atomic claim + file mutex), tickets.update (metadata), tickets.complete (SDLC stage engine + advance), tickets.reject (rework/escalate). Includes SDLC flow engine (flows.ts, transitions.ts).
**Dependencies:** Block 01-B (pool), Block 02-A (server + types), Block 04-C (file mutex)

### Block 03-B: Extended Operations (5 tools)
**Tickets:** TASK-FOS-03-006, TASK-FOS-03-007, TASK-FOS-03-008, TASK-FOS-03-009, TASK-FOS-03-010
**Effort:** M
**Description:** tickets.spawn (child tickets), tickets.graph (dependency DAG), tickets.release (claim release), tickets.extend (lease extension), tickets.stats (aggregate metrics).
**Dependencies:** Block 03-A (established patterns)

---

## Block 04: Authentication & Security (CAP-04)

### Block 04-A: API Key Auth
**Tickets:** TASK-FOS-04-001, TASK-FOS-04-002
**Effort:** M
**Description:** API key validation middleware (SHA-256 hash lookup, Bearer header), role-based authorization matrix, agent/machine registration endpoints, key creation/revocation.
**Dependencies:** Block 01-B (agents table), Block 02-A (server)

### Block 04-C: File Mutex
**Tickets:** TASK-FOS-04-003
**Effort:** S
**Description:** File-level locking via file_locks table. Check for conflicts on claim, lock files atomically, release on advance/release.
**Dependencies:** Block 01-B (pool + file_locks table)

---

## Block 05: Dashboard (CAP-05)

### Block 05-A: Backend (SSE + REST)
**Tickets:** TASK-FOS-05-002
**Effort:** M
**Description:** SSE endpoint (GET /api/events) backed by PostgreSQL NOTIFY/LISTEN, REST endpoints (GET /api/tickets, /api/tickets/:id, /api/tickets/:id/history, /api/stages).
**Dependencies:** Block 02-A (server), Block 01-B (pool)

### Block 05-B: Frontend (Pipeline + Graph)
**Tickets:** TASK-FOS-05-001, TASK-FOS-05-003, TASK-FOS-05-004
**Effort:** L
**Description:** Vanilla HTML + CSS pipeline board (Kanban by stage), D3.js force-directed dependency graph, JavaScript logic (SSE client, fetch/render cycle, auto-refresh, filtering).
**Dependencies:** Block 05-A (SSE + REST), Block 03-B (tickets.graph, tickets.stats)

---

## Block 06: Git Integration (CAP-06)

### Block 06-A: Hooks
**Tickets:** TASK-FOS-06-001, TASK-FOS-06-002
**Effort:** S
**Description:** Husky commit-msg hook (regex validation of [TICKET-ID] prefix), pre-commit hook (blast radius — staged files must be within ticket's file_paths).
**Dependencies:** None (standalone shell scripts)

### Block 06-B: Webhooks & Agent Runner
**Tickets:** TASK-FOS-06-003, TASK-FOS-06-004
**Effort:** M
**Description:** GitHub push webhook receiver (POST /api/webhooks/github, HMAC-SHA256 verification, commit message parsing, ghost commit recovery), updated agent-runner wrapper using MCP for claim/advance with filesystem fallback.
**Dependencies:** Block 02-B (middleware), Block 01-B (pool), Block 03-A (core tools)

---

## Block 07: System Update (CAP-07)

### Block 07-A: Agent & Instruction Updates
**Tickets:** TASK-FOS-07-001, TASK-FOS-07-002, TASK-FOS-07-003
**Effort:** M
**Description:** Update all .github/agents/*.agent.md files with MCP tool references, update instruction files for new architecture, update agents.md, copilot-instructions.md, README.md.
**Dependencies:** Block 03-A (core tools defined)

### Block 07-B: Backward Compatibility Bridge
**Tickets:** TASK-FOS-07-004
**Effort:** M
**Description:** Update tickets.py to support dual-mode operation (filesystem + PostgreSQL), feature flags for gradual cutover, shadow mode for validation.
**Dependencies:** Block 03-A (core tools)

---

## Block 08: Infrastructure (CAP-08)

### Block 08-A: Containerization
**Tickets:** TASK-FOS-08-001, TASK-FOS-08-002
**Effort:** M
**Description:** Multi-stage Dockerfile (Node.js 22 Alpine), Docker Compose with PostgreSQL 17 + PgBouncer + MCP server (healthcheck-gated startup, persistent volumes, Docker secrets).
**Dependencies:** Block 02-A (scaffold — for Dockerfile context)

### Block 08-B: Configuration
**Tickets:** TASK-FOS-08-003
**Effort:** XS
**Description:** .env.example template with all required variables, config loader module.
**Dependencies:** None

---

## Dependency Graph (Blocks)

```
Block 08-B (Config) ──────────────────────────────────────┐
Block 06-A (Hooks) ───────────────────────────────────────┤
                                                          │
Block 01-A (Schema) ─────┐                               │
Block 02-A (Scaffold) ───┤                               │ (parallel, no deps)
                          │                               │
                          ▼                               │
                    Block 01-B (Pool) ────┐               │
                    Block 02-B (MW)       │               │
                    Block 08-A (Docker)   │               │
                          │               │               │
                          ▼               ▼               │
                    Block 04-A (Auth)  Block 04-C (Mutex) │
                          │               │               │
                          └───────┬───────┘               │
                                  ▼                       │
                          Block 03-A (Core Tools) ────────┤
                                  │                       │
                          ┌───────┼───────┐               │
                          ▼       ▼       ▼               │
                    Block 03-B  Block 05-A  Block 07-A    │
                    (Extended)  (SSE/REST)  (Agent Update) │
                          │       │                       │
                          ▼       ▼                       │
                    Block 05-B  Block 06-B                │
                    (Dashboard) (Webhooks)                 │
                                                          │
                    Block 07-B (Bridge) ──────────────────┘
```

## Estimated Effort by Phase

| Phase | Blocks | Duration |
|-------|--------|----------|
| Phase 1 | 01-A, 02-A, 08-B, 06-A | 1 week (parallel) |
| Phase 2 | 01-B, 02-B, 08-A | 1 week (parallel) |
| Phase 3 | 04-A, 04-C | 1 week (parallel) |
| Phase 4 | 03-A | 1 week |
| Phase 5 | 03-B, 05-A, 06-B | 1 week (parallel) |
| Phase 6 | 05-B, 07-A, 07-B | 1 week (parallel) |
| **Total** | | **6 weeks** |

---

*Generated by TODO Agent — 2026-03-05T00:00:00Z*
