# L1 Capability Breakdown — Distributed AI-Native Orchestration Platform

## Project Vision

Transform the ForgeOS repository from a file-based ticket orchestration system into a distributed AI-native software development orchestration platform. The current filesystem-based state machine (`tickets.py`, `ticket-state/` directories, `agent-runner.py`, `todo_visual.py`) will be superseded by an MCP (Model Context Protocol) server backed by PostgreSQL for mutable state, while Git remains the immutable payload store for tickets, code, and artifacts. The migration uses the existing SDLC pipeline to bootstrap itself — the filesystem ticket system builds its own replacement.

---

## Current System Baseline (L0)

| Component | Location | Lines | Purpose |
|-----------|----------|-------|---------|
| Ticket State Machine | `.github/tickets.py` | 1000 | Sync, claim, advance, rework, parse L3, validate integrity |
| Agent Execution Runner | `.github/agent-runner.py` | 674 | Two-commit protocol (CLAIM + WORK), git push-based locking |
| Dashboard Visualizer | `todo_visual.py` | 1011 | Terminal + HTML dashboard, dependency graph, claim tracking |
| Ticket Schema | `.github/tickets/ticket-schema.json` | 193 | Canonical JSON schema for ticket files |
| Agent Definitions | `.github/agents/*.agent.md` | 14 files | Specialized agent roles with boot sequences and workflows |
| State Directories | `.github/ticket-state/{STAGE}/` | 11 stages | File-based state machine (directory = stage) |
| Summary Handoff | `.github/agent-output/{Agent}/` | per-ticket | Context baton-pass between SDLC stages |
| Memory Bank | `.github/memory-bank/` | 6 files | Append-only cross-session persistence |
| Vibecoding Chunks | `.github/vibecoding/` | ~50 chunks | Semantic context loading for agents |

### Current Limitations Driving Migration

1. **Single-machine locking** — `git push` race conditions are the only concurrency control; no queuing, no fairness, no deadlock detection
2. **No real-time state** — ticket state requires filesystem scan + git pull; no event streaming, no subscriptions
3. **No file-level mutex** — `file_paths` overlap detection is advisory only; no enforced blocking on shared files
4. **Monolithic CLI** — `tickets.py` conflates parsing, state management, validation, and display; no API boundary
5. **Dashboard is batch** — `todo_visual.py` generates static HTML; no live updates, no multi-machine view
6. **No auth** — any agent or operator can claim any ticket; no identity verification, no permission model
7. **No webhook** — no external event ingestion (GitHub events, CI callbacks, notifications)
8. **Fragile leases** — 30-minute lease timeout with no heartbeat; long-running tasks risk claim expiry mid-work

---

## L1 Capabilities

### CAP-01: Research & Analysis

**Description:** Investigate foundational technologies and validate design assumptions before architecture and implementation begin. Evaluate MCP protocol specification, PostgreSQL distributed locking patterns (`SELECT FOR UPDATE SKIP LOCKED`, advisory locks), existing system gap analysis, and technology alternatives.

**Scope:**
- MCP protocol specification review (message format, tool registration, session management, transport layer)
- PostgreSQL distributed locking patterns (row-level locks, advisory locks, `SKIP LOCKED` queue semantics)
- Comparative analysis: MCP vs gRPC vs REST for agent communication
- Gap analysis of current `tickets.py` capabilities vs distributed requirements
- Connection pooling strategies (PgBouncer vs application-level pooling)
- Event sourcing feasibility for ticket history

**Agent Ownership:** Research Analyst

**Estimated Effort:** L (multiple research tickets)

**Dependencies:** None — this is the entry point

---

### CAP-02: Architecture Design

**Description:** Produce the technical architecture for the distributed platform including MCP server architecture, database schema design, API contracts (OpenAPI + MCP tool definitions), component boundaries, migration strategy, and Architecture Decision Records (ADRs).

**Scope:**
- System component diagram (MCP Server, PostgreSQL, Git, Agent Clients, Dashboard, Webhook Processor)
- MCP server architecture (transport, session management, tool registry, error handling)
- Database schema design (tickets, claims, leases, history, agents, machines, file_mutex)
- API contract design (OpenAPI 3.1 for REST endpoints, MCP tool definitions for agent interaction)
- ADRs for: PostgreSQL over alternatives, MCP as agent protocol, migration strategy, auth model
- Data flow diagrams (claim flow, advance flow, rework flow, sync flow)
- Technology selection matrix (web framework, ORM, migration tool, auth library)
- Fitness functions (p99 claim latency < 100ms, concurrent claim correctness, zero-downtime migration)

**Agent Ownership:** Architect

**Estimated Effort:** L (multiple architecture tickets)

**Dependencies:** CAP-01 (Research findings inform architecture decisions)

---

### CAP-03: Product Requirements

**Description:** Define the product requirements document (PRD) for the distributed orchestration platform. Capture user stories, acceptance criteria, and non-functional requirements from the perspective of operators, agents, and the system itself.

**Scope:**
- User personas: Human Operator, AI Agent, Ticketer Dispatcher, System Administrator
- User stories for each persona across all capability domains
- Non-functional requirements (availability, latency, throughput, scalability targets)
- Migration acceptance criteria (dual-mode operation, rollback plan, data integrity)
- Dashboard UX requirements (multi-machine view, real-time updates, dependency graph, claim monitoring)
- Priority matrix mapping requirements to capabilities

**Agent Ownership:** ProductManager

**Estimated Effort:** M (1-2 PRD tickets)

**Dependencies:** CAP-01 (Research informs feasibility constraints)

---

### CAP-04: MCP Server Core

**Description:** Implement the MCP server that becomes the primary interaction interface between agents and the orchestration layer. The server registers tools that map to ticket operations, manages sessions, handles transport (stdio + SSE), and enforces protocol semantics.

**Scope:**
- MCP server framework setup (Python, using official MCP SDK)
- Transport layer (stdio for local agents, SSE/HTTP for remote agents)
- Tool registration system (dynamic tool discovery, schema validation)
- Session management (agent sessions, heartbeat, timeout handling)
- Request/response lifecycle (tool calls, notifications, error propagation)
- Structured logging (JSON format, correlation IDs, no PII)
- Health check and readiness probes
- Graceful shutdown with in-flight request draining

**Agent Ownership:** Backend

**Estimated Effort:** L (core server is foundational — multiple tickets)

**Dependencies:** CAP-02 (Architecture defines server design), CAP-05 (Database must exist for state operations)

---

### CAP-05: Database Layer

**Description:** Design and implement the PostgreSQL database layer that replaces filesystem-based state management. This is the distributed lock manager and mutable state store for the entire platform.

**Scope:**
- PostgreSQL schema: `tickets`, `claims`, `lease_heartbeats`, `stage_transitions`, `event_history`, `file_locks`, `agents`, `machines`, `operators`
- Schema migrations framework (Alembic or similar)
- Connection pooling (asyncpg + connection pool, or PgBouncer)
- Distributed locking implementation:
  - `SELECT ... FOR UPDATE SKIP LOCKED` for ticket claiming (fair queue semantics)
  - Advisory locks for file-level mutex (`pg_advisory_xact_lock` keyed on file path hash)
  - Lease heartbeat mechanism replacing fixed 30-minute timeouts
- Transaction isolation levels (READ COMMITTED for claims, SERIALIZABLE for state transitions)
- Indexes: ticket_id (unique), stage + claimed_by (composite), dependencies (GIN on JSONB), file_paths (GIN)
- Event sourcing table for complete audit trail (replaces `history` array in ticket JSON)
- Database seeding from existing `.github/tickets/*.json` files (migration import)

**Agent Ownership:** Backend

**Estimated Effort:** L (schema + locking + pooling + migrations = multiple tickets)

**Dependencies:** CAP-02 (Architecture defines schema design), CAP-12 (Infrastructure provides PostgreSQL instance)

---

### CAP-06: Ticket API

**Description:** Implement the ticket operations API exposed both as MCP tools (for agent consumption) and as REST endpoints (for dashboard and external integrations). This replaces the CLI interface of `tickets.py`.

**Scope:**
- MCP tools (registered on MCP server):
  - `tickets.next` — claim next available ticket for an agent role (`SELECT FOR UPDATE SKIP LOCKED`)
  - `tickets.claim` — claim specific ticket by ID
  - `tickets.advance` — move ticket to next SDLC stage
  - `tickets.rework` — send ticket back to implementation stage
  - `tickets.release` — release a claim
  - `tickets.status` — query ticket state (single or batch)
  - `tickets.sync` — trigger dependency resolution and unblock evaluation
  - `tickets.validate` — integrity check
- REST API (for dashboard and webhooks):
  - `GET /api/tickets` — list tickets with filters (stage, type, priority, claimed_by)
  - `GET /api/tickets/:id` — single ticket detail with full history
  - `GET /api/tickets/:id/history` — event log
  - `POST /api/tickets/:id/claim` — claim
  - `POST /api/tickets/:id/advance` — advance
  - `POST /api/tickets/:id/rework` — rework
  - `GET /api/stages` — stage pipeline overview
  - `GET /api/health` — health check
  - `WebSocket /ws/tickets` — real-time ticket state stream
- Input validation against ticket schema
- Idempotency keys for claim/advance operations
- Rate limiting per agent/machine

**Agent Ownership:** Backend

**Estimated Effort:** L (comprehensive API surface — multiple tickets)

**Dependencies:** CAP-04 (MCP Server hosts the tools), CAP-05 (Database provides state storage)

---

### CAP-07: Agent Client Library

**Description:** Build a client SDK that agents use to interact with the MCP server instead of directly manipulating filesystem state. This SDK replaces the file-based operations currently embedded in each agent's boot sequence and two-commit protocol.

**Scope:**
- Python client library (`forgeos-agent-sdk` or similar)
- MCP client connection management (connect, reconnect, session resumption)
- High-level operations: `claim()`, `advance()`, `rework()`, `release()`, `get_ticket()`, `heartbeat()`
- Automatic lease heartbeat (background thread/task extending lease during long operations)
- Summary handoff helpers (read previous stage summary, write current stage summary)
- Structured error handling (claim conflicts, lease expiry, network errors)
- Configuration via environment variables (MCP server URL, agent identity, transport mode)
- Backward compatibility shim: client can fall back to filesystem operations during migration
- Integration with `agent-runner.py` two-commit protocol (git operations remain for code commits)

**Agent Ownership:** Backend

**Estimated Effort:** M (client library wrapping MCP calls)

**Dependencies:** CAP-04 (MCP Server must exist to connect to), CAP-06 (Ticket API defines the tool interface)

---

### CAP-08: Authentication & Authorization

**Description:** Implement identity verification and permission enforcement for agents, machines, and operators. Currently there is zero authentication — any process can claim any ticket.

**Scope:**
- Agent identity: pre-shared API keys or JWT tokens per agent role
- Machine identity: machine registration with `machine_id` verification
- Operator authentication: operator credentials (simple token or OAuth integration)
- Authorization model:
  - Agents can only claim tickets matching their SDLC stage (Backend→BACKEND, QA→QA, etc.)
  - Operators can claim on behalf of any agent but only their registered machines
  - Admin role for force-release, force-advance, and system configuration
- Permission enforcement at MCP tool level and REST API level
- Audit logging of all authenticated operations
- Secret management (environment variables, no hardcoded credentials)
- Rate limiting per identity

**Agent Ownership:** Backend (implementation) + Security (review and threat model)

**Estimated Effort:** M (auth layer with role-based access)

**Dependencies:** CAP-04 (MCP Server for tool-level auth), CAP-05 (Database for identity storage), CAP-06 (API for endpoint protection)

---

### CAP-09: Webhook Processing

**Description:** Enable external event ingestion and outbound notifications. The platform needs to react to GitHub events (PR merged, CI status), send notifications (Slack, email), and support custom webhook endpoints.

**Scope:**
- Inbound webhook receiver (HTTP endpoint accepting JSON payloads)
- GitHub webhook integration:
  - Push events → trigger `tickets.sync`
  - CI status events → update ticket stage on CI pass/fail
  - PR events → link PRs to ticket IDs
- Outbound notification system:
  - Ticket state change notifications
  - Claim expiry warnings
  - Rework notifications with rejection reason
  - Configurable notification channels (webhook URL, Slack incoming webhook)
- Event queue (in-database or lightweight queue) for reliable webhook delivery
- Webhook signature verification (HMAC for GitHub, custom for others)
- Retry logic with exponential backoff for failed outbound deliveries

**Agent Ownership:** Backend

**Estimated Effort:** M (webhook ingestion + notification engine)

**Dependencies:** CAP-04 (MCP Server for event handling), CAP-05 (Database for event queue), CAP-08 (Auth for webhook signature verification)

---

### CAP-10: Dashboard

**Description:** Web-based multi-machine dashboard replacing `todo_visual.py` → `index.html`. Real-time ticket board with dependency visualization, claim monitoring, stage pipeline view, and operator controls.

**Scope:**
- Web application (React/Next.js or similar SPA)
- Real-time updates via WebSocket connection to Ticket API
- Views:
  - Stage pipeline (Kanban-style board with ticket counts per stage)
  - Ticket detail (full metadata, history timeline, dependency tree)
  - Dependency graph (interactive DAG visualization, replaces `--dot` output)
  - Active claims monitor (agent, machine, operator, lease countdown)
  - Operator workbench (claim/release/advance actions from UI)
  - Multi-machine status (which machines are active, which agents are running)
  - System health (database connections, MCP server status, webhook delivery rate)
- Filtering: by stage, type, priority, operator, machine, agent
- Search: ticket ID, title, file paths
- Responsive layout (desktop-first, tablet-compatible)
- Dark/light theme
- Authentication via CAP-08 for operator actions

**Agent Ownership:** UIDesigner (mockups) + Frontend Engineer (implementation)

**Estimated Effort:** L (full web application — multiple tickets)

**Dependencies:** CAP-06 (Ticket API provides data), CAP-08 (Auth for operator actions), CAP-03 (PRD defines UX requirements)

---

### CAP-11: Migration Bridge

**Description:** Enable dual-mode operation where the system can use both filesystem-based and MCP-based state management simultaneously. This is the critical transition mechanism that allows gradual cutover without disrupting active work.

**Scope:**
- Dual-mode `tickets.py` wrapper:
  - Reads from PostgreSQL (primary) with filesystem fallback
  - Writes to both PostgreSQL and filesystem during transition
  - Feature flag to switch between modes per-operation
- Data synchronization:
  - Import existing `.github/tickets/*.json` and `.github/ticket-state/` into PostgreSQL
  - Periodic sync between filesystem and database during dual-mode
  - Conflict resolution strategy (database wins, filesystem is advisory)
- Agent migration path:
  - Phase 1: Agents continue using filesystem; a background sync process mirrors to DB
  - Phase 2: Agents use SDK with filesystem fallback; MCP server writes to both
  - Phase 3: Agents use SDK exclusively; filesystem becomes read-only archive
  - Phase 4: Filesystem state directories deprecated; Git stores only ticket specs
- Rollback capability:
  - Database → filesystem export at any point
  - Feature flag to revert all operations to filesystem mode
  - Automated rollback trigger on MCP server health check failure
- `agent-runner.py` evolution:
  - Phase 1: Unchanged (filesystem two-commit protocol)
  - Phase 2: CLAIM via MCP, WORK via git (hybrid)
  - Phase 3: CLAIM via MCP, WORK via git, advance via MCP
- Validation:
  - Shadow mode: run both paths, compare results, log divergences
  - Integrity check comparing DB state vs filesystem state
  - Automated regression testing during each migration phase

**Agent Ownership:** Backend (implementation) + DevOps (orchestration) + Architect (design)

**Estimated Effort:** XL (most complex capability — spans entire migration lifecycle)

**Dependencies:** CAP-05 (Database must be operational), CAP-06 (Ticket API must expose all operations), CAP-07 (Agent Client Library must have fallback mode)

---

### CAP-12: Infrastructure

**Description:** Container orchestration, CI/CD pipeline updates, environment configuration, and operational tooling for the distributed platform.

**Scope:**
- Docker Compose for local development:
  - MCP Server container
  - PostgreSQL container (with persistent volume)
  - Dashboard container (Node.js)
  - pgAdmin or similar DB admin tool
- Environment configuration:
  - `.env` template with all required variables
  - Database connection strings, MCP server URLs, auth secrets
  - Development vs production configuration profiles
- CI/CD pipeline updates:
  - GitHub Actions workflows for MCP server tests
  - Database migration CI step
  - Dashboard build and test pipeline
  - Integration test suite (MCP client ↔ server ↔ database)
- Health monitoring:
  - Container health checks
  - Database connection monitoring
  - MCP server availability probe
- Backup and recovery:
  - PostgreSQL backup strategy (pg_dump, WAL archiving)
  - Database restore procedure
- Development tooling:
  - `Makefile` or script for common operations (start, stop, migrate, seed, test)
  - Database seed script from existing ticket JSON files

**Agent Ownership:** DevOps

**Estimated Effort:** L (infrastructure spanning entire project lifecycle)

**Dependencies:** CAP-02 (Architecture defines component topology)

---

## Dependency Graph

```
CAP-01 (Research)
  │
  ├──→ CAP-02 (Architecture) ──→ CAP-12 (Infrastructure) ──→ CAP-05 (Database)
  │         │                                                       │
  │         └──→ CAP-04 (MCP Server Core) ←─────────────────────────┘
  │                    │
  │                    ├──→ CAP-06 (Ticket API) ──→ CAP-07 (Agent Client Library)
  │                    │         │                          │
  │                    │         ├──→ CAP-10 (Dashboard)    │
  │                    │         │                          │
  │                    │         └──→ CAP-09 (Webhooks)     │
  │                    │                                    │
  │                    └──→ CAP-08 (Auth) ←─────────────────┘
  │
  └──→ CAP-03 (Product Requirements) ──→ CAP-10 (Dashboard)

                    CAP-11 (Migration Bridge)
                         depends on:
                    CAP-05, CAP-06, CAP-07
```

## Critical Path

The longest dependency chain determines the minimum timeline:

```
CAP-01 → CAP-02 → CAP-12 → CAP-05 → CAP-04 → CAP-06 → CAP-07 → CAP-11
Research  Arch     Infra     DB        MCP       API      SDK       Migration
```

**Parallelizable work outside the critical path:**
- CAP-03 (Product Requirements) — can run in parallel with CAP-01 and CAP-02
- CAP-08 (Auth) — can start after CAP-04, parallel with CAP-06
- CAP-09 (Webhooks) — can start after CAP-06, parallel with CAP-07
- CAP-10 (Dashboard) — can start after CAP-06 (REST API), parallel with CAP-07/CAP-08
- CAP-12 (Infrastructure) — Docker Compose can start as soon as CAP-02 defines components

---

## Agent Ownership Mapping

| Capability | Primary Agent | Supporting Agents | Ticket Type |
|------------|--------------|-------------------|-------------|
| CAP-01: Research & Analysis | Research Analyst | — | research |
| CAP-02: Architecture Design | Architect | — | architecture |
| CAP-03: Product Requirements | ProductManager | — | docs |
| CAP-04: MCP Server Core | Backend | DevOps (containerization) | backend |
| CAP-05: Database Layer | Backend | DevOps (PostgreSQL provisioning) | backend |
| CAP-06: Ticket API | Backend | — | backend |
| CAP-07: Agent Client Library | Backend | — | backend |
| CAP-08: Authentication & Authorization | Backend | Security (threat model, review) | backend + security |
| CAP-09: Webhook Processing | Backend | — | backend |
| CAP-10: Dashboard | Frontend Engineer | UIDesigner (mockups) | frontend |
| CAP-11: Migration Bridge | Backend | DevOps, Architect | backend + infra |
| CAP-12: Infrastructure | DevOps | — | infra |

---

## Risk Register

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| MCP protocol insufficient for agent needs | High | Low | CAP-01 validates protocol fit before implementation |
| Migration data loss during dual-mode | Critical | Medium | Shadow mode validation, automated rollback triggers |
| PostgreSQL performance under concurrent claims | High | Low | `SKIP LOCKED` is well-proven; load test in CAP-05 |
| Agent SDK adoption breaks existing workflows | High | Medium | Filesystem fallback shim in CAP-07; phased migration |
| Dashboard scope creep | Medium | High | CAP-03 PRD locks scope; MVP-first approach |
| Infrastructure complexity overwhelms team | Medium | Medium | Docker Compose simplifies local dev; incremental infra |

---

## Migration Phases (Summary)

| Phase | Description | Capabilities Involved | Exit Criteria |
|-------|-------------|----------------------|---------------|
| **Phase 0** | Research + Architecture + PRD | CAP-01, CAP-02, CAP-03 | ADRs approved, schema designed, PRD complete |
| **Phase 1** | Foundation (DB + MCP + Infra) | CAP-04, CAP-05, CAP-12 | MCP server running, DB schema deployed, Docker Compose working |
| **Phase 2** | API + SDK + Auth | CAP-06, CAP-07, CAP-08 | All `tickets.py` operations available via MCP tools + REST |
| **Phase 3** | Dashboard + Webhooks | CAP-09, CAP-10 | Web dashboard shows real-time state; GitHub webhooks integrated |
| **Phase 4** | Migration + Cutover | CAP-11 | Full dual-mode operation validated; agents using SDK; filesystem deprecated |

---

## Files Read for Context Derivation

1. `.github/guardian/STOP_ALL` — halt gate (CLEAR)
2. `.github/instructions/core.instructions.md` — system identity, boot sequence, memory gate
3. `.github/instructions/sdlc.instructions.md` — stage lifecycle, post-chain, rework rules
4. `.github/instructions/ticket-system.instructions.md` — state machine, tickets.py contract
5. `.github/instructions/git-protocol.instructions.md` — two-commit protocol, scoped git
6. `.github/instructions/agent-behavior.instructions.md` — worker model, scope enforcement
7. `.github/vibecoding/chunks/TODO.agent/chunk-01.yaml` — decomposition protocol, task format
8. `.github/vibecoding/chunks/TODO.agent/chunk-02.yaml` — governance, lifecycle, completion
9. `.github/vibecoding/catalog.yml` — semantic chunk catalog
10. `.github/tickets.py` (1000 lines) — full ticket state machine implementation
11. `.github/agent-runner.py` (674 lines) — two-commit protocol runner
12. `todo_visual.py` (1011 lines) — dashboard visualizer
13. `.github/tickets/ticket-schema.json` (193 lines) — ticket JSON schema
14. `Migration_plan.md` (432 lines) — migration strategy document
15. `.github/agents/Architect.agent.md` — Architect agent definition
16. `.github/agents/Backend.agent.md` — Backend agent definition
17. `.github/agents/Frontend.agent.md` — Frontend Engineer agent definition
18. `.github/agents/DevOps.agent.md` — DevOps agent definition
19. `.github/agents/Security.agent.md` — Security Engineer agent definition
20. `.github/agents/Research.agent.md` — Research Analyst agent definition
21. `agents.md` — Agent execution contract

---

*Generated by TODO Agent (Strategic Mode, L0→L1) — 2026-03-05T00:00:00Z*
