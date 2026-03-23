---
title: "PRD: ForgeOS MCP Server — Production-Ready Standalone Distribution"
version: "1.0"
status: draft
author: ProductManager Agent
date: 2026-03-23
priority: P0
stakeholders:
  - ForgeOS maintainers
  - MCP ecosystem developers
  - AI agent builders
  - DevOps teams running multi-agent systems
upstream: MCP-DISTRIBUTION-RESEARCH.md (Research Analyst, 2026-03-23)
---

# PRD: ForgeOS MCP Server — Production-Ready Standalone Distribution

## 1. Product Vision

**Make the ForgeOS MCP Server installable, configurable, and production-safe in under five minutes — whether a user runs `npx`, `docker compose up`, or pastes a URL into VS Code.**

ForgeOS provides 22 MCP tools for distributed AI agent orchestration: ticket lifecycle management (claim, complete, reject, spawn), code intelligence (blast radius, symbol search, import chains), and memory/learning (lessons, context retrieval). Today, using these tools requires cloning the entire ForgeOS repository and manually wiring Docker Compose. This PRD defines the work to make the MCP server a standalone, distributable product across three channels — npm, Docker, and remote HTTP — while closing existing implementation gaps that block production use.

### Problem Statement

| Pain Point | Impact | Current Workaround |
|---|---|---|
| Must clone full repo to run | High adoption friction, >15 min setup | None — mandatory |
| Prompt compile queue uses in-memory store | Jobs lost on restart, no retry durability | Manual re-trigger |
| Compile triggers only fire on READY stage | BACKEND/FRONTEND/TODO tickets get stale prompts | Manually call `tickets.attach_prompts` |
| Agent definitions not seeded in DB | Prompt compiler falls back to filesystem markdown | Requires repo checkout |
| No published Docker image | Cannot integrate without build step | Build locally |
| No one-click VS Code install | Manual JSON editing for each new user | Copy-paste config |
| No npm package | Cannot `npx` a quick-try client | N/A |
| No MCP Registry listing | Invisible to 17,000+ server ecosystem | Direct URL sharing |

### Cost of Inaction

- ForgeOS remains an internal-only tool, invisible to the MCP ecosystem's 17,000+ servers
- Every new user faces 15+ minutes of friction (clone, Docker build, env config)
- In-memory compile queue silently drops jobs on container restart
- Agent definitions require filesystem access, blocking cloud-native deployments

---

## 2. Target Users

### Primary: Solo AI Developer ("Alex")

- Builds AI agent workflows using VS Code + GitHub Copilot
- Wants a ticket-driven orchestration layer without building one from scratch
- Technical comfort: `npm install`, `docker compose up`, but not infrastructure management
- Success criteria: Running ForgeOS MCP tools within 5 minutes of discovery
- Pain: Currently must clone an unfamiliar monorepo and debug Docker networking

### Secondary: DevOps / Platform Engineer ("Jordan")

- Operates AI agent infrastructure for a team of 3–10 developers
- Needs production guarantees: health checks, graceful shutdown, connection pool management, audit logs
- Runs containers in Kubernetes or Docker Swarm
- Success criteria: Deploying ForgeOS in a production environment with monitoring and zero-downtime restarts
- Pain: No published OCI image, no readiness probe, no rate limiting

### Secondary: MCP Ecosystem Explorer ("Sam")

- Browses VS Code MCP Gallery or the official MCP Registry looking for orchestration tools
- Wants to try a server with one click and evaluate in < 2 minutes
- Success criteria: Click badge → tools appear in VS Code → try `tickets.list`
- Pain: ForgeOS doesn't appear in any registry or gallery

### Anti-Persona: Non-Technical Project Manager

- Expects a GUI-only Jira alternative
- ForgeOS is an MCP tool server for AI agents, not a human-facing project management app
- The dashboard is a monitoring view, not a workflow management interface

---

## 3. Success Metrics

| Metric | Baseline (Today) | Target (v1.0) | Measurement |
|---|---|---|---|
| Time-to-first-tool-call (Docker) | >15 min (requires repo clone + build) | ≤5 min | Manual user testing |
| Time-to-first-tool-call (VS Code badge) | N/A | ≤2 min (click badge → tool callable) | Manual user testing |
| Prompt compile job durability | 0% (in-memory, lost on restart) | 100% (PostgreSQL-backed, survives restart) | Automated test: restart container, verify pending jobs resume |
| Agent definition DB coverage | 0 rows seeded | 14 agents seeded (all defined agents) | `SELECT count(*) FROM agent_definitions` |
| Compile trigger stage coverage | 1 stage (READY) | 4+ stages (READY, BACKEND, FRONTEND, TODO) | Integration test |
| MCP Registry listing | Not listed | Listed at registry.modelcontextprotocol.io | Manual verification |
| Docker image availability | Local build only | `ghcr.io/forgeos/mcp-server:latest` pullable | `docker pull` test |
| npm package availability | Not published | `npx -y @forgeos/mcp-server` succeeds | npm registry check |

---

## 4. Feature Specifications

### F1: Durable Prompt Compile Queue (P0)

**Problem:** The current prompt compilation system uses an in-memory queue. If the container restarts, all pending compile jobs are lost. The migration `009-prompt-compile-queue.sql` defines the `prompt_compile_queue` table but the service layer (`compiler.ts`) does not persist jobs to it.

**Behavior:**

- **Given** a ticket transitions to a compilable stage  
- **When** `queueCompileTicketPrompt()` is called  
- **Then** a row is inserted into `prompt_compile_queue` with status `pending`, idempotency key `{ticketId}:{trigger}`, and `next_attempt_at = NOW()`

- **Given** the server starts or the poll interval fires  
- **When** the worker queries `SELECT ... FROM prompt_compile_queue WHERE status = 'pending' AND next_attempt_at <= NOW() ORDER BY next_attempt_at LIMIT 5 FOR UPDATE SKIP LOCKED`  
- **Then** each job is processed, status set to `running`, and on completion set to `done` (or back to `pending` with incremented `attempts` and exponential backoff on failure)

- **Given** `attempts >= max_attempts`  
- **When** the worker picks up the job  
- **Then** status is set to `failed` and `last_error` is recorded

- **Given** a compile job already exists with the same `idempotency_key`  
- **When** a duplicate enqueue is attempted  
- **Then** the duplicate is silently ignored (ON CONFLICT DO NOTHING)

**Acceptance Criteria:**

1. All compile jobs are persisted to PostgreSQL before processing
2. Container restart does not lose pending jobs — verified by integration test
3. Failed jobs retry with exponential backoff (1s, 4s, 16s) up to `max_attempts` (default 3)
4. Duplicate enqueue requests are idempotent
5. `prompt_compile_queue` table status breakdown available via `/health` or `tickets.stats`

---

### F2: Extended Compile Triggers (P0)

**Problem:** `queueCompileTicketPrompt()` is only called when a ticket enters `READY` stage. Tickets in `BACKEND`, `FRONTEND`, and `TODO` stages never get their prompts compiled or refreshed.

**Behavior:**

- **Given** a ticket transitions to `BACKEND`, `FRONTEND`, or `TODO` stage via `tickets.complete`  
- **When** the stage advance function fires  
- **Then** `queueCompileTicketPrompt(ticketId, stageName)` is called with the new stage as trigger

- **Given** a ticket is rejected and returns to its implementation stage via `tickets.reject`  
- **When** the rework routing completes  
- **Then** a recompilation is triggered with trigger `rework:{stageName}`

**Acceptance Criteria:**

1. `tickets.complete` triggers compilation for: READY, BACKEND, FRONTEND, TODO (at minimum)
2. `tickets.reject` triggers recompilation when returning ticket to implementation stage
3. Each trigger produces a distinct `idempotency_key` to prevent stale-prompt conflicts
4. At least one integration test verifies compilation fires on a BACKEND→QA transition

---

### F3: Agent Definitions Database Seeding (P0)

**Problem:** Migration `010-agent-definitions.sql` creates the `agent_definitions` table, but no seed data populates it. The prompt compiler (`getAgentByStage()`) falls back to reading filesystem markdown files in `.github/agents/`, which requires the full ForgeOS repo to be mounted.

**Behavior:**

- **Given** the ForgeOS MCP server starts  
- **When** the seed step runs (after migrations)  
- **Then** all 14 agent definitions are upserted into `agent_definitions` with: name, role, stage, tools, constraints, forbidden_actions, boot_sequence, scope

- **Given** the prompt compiler calls `getAgentByStage('BACKEND')`  
- **When** the DB contains a matching agent definition row  
- **Then** the DB row is used — no filesystem access required

- **Given** a standalone Docker deployment (no repo mounted)  
- **When** any prompt compilation runs  
- **Then** it succeeds using DB-only agent definitions

**Acceptance Criteria:**

1. Seed script inserts/updates all 14 agents: Architect, Backend, Frontend, QA, Security, DevOps, Documentation, Research, ProductManager, CIReviewer, UIDesigner, TODO, Validator, ForgeOS
2. `getAgentByStage()` prefers DB lookup over filesystem
3. Filesystem fallback remains for development environments (backward compatible)
4. `SELECT count(*) FROM agent_definitions WHERE is_active = true` returns 14 after seed
5. Unit test verifies prompt compilation succeeds without workspace volume mount

---

### F4: Standalone Docker Distribution (P0)

**Problem:** Users must clone the ForgeOS repo and run `docker compose up` from `forgeos-server/`. There is no self-contained compose file that pulls pre-built images.

**Deliverables:**

1. **`docker-compose.mcp.yml`** — User-facing minimal compose file at repo root:
   - `forgeos-mcp` service: pulls `ghcr.io/forgeos/mcp-server:latest`
   - `postgres` service: pulls `postgres:17-alpine` with pgvector extension
   - `ollama` service (optional profile): pulls `ollama/ollama` for local LLM
   - Auto-runs migrations on startup
   - Exposes port 3011 (MCP) and 5432 (PostgreSQL, configurable)
   - Health checks on all services
   - Named volume for PostgreSQL data persistence

2. **`.env.example`** — Template with all configurable variables documented

**Behavior:**

- **Given** a user downloads `docker-compose.mcp.yml` and `.env.example`  
- **When** they run `docker compose -f docker-compose.mcp.yml up`  
- **Then** all services start, migrations run, health checks pass, and `http://localhost:3011/mcp` is callable within 60 seconds

- **Given** a user configures `EMBEDDING_PROVIDER=ollama` and includes the ollama profile  
- **When** `--profile ollama` is passed to docker compose  
- **Then** the Ollama service starts and the MCP server connects to it for embeddings

**Acceptance Criteria:**

1. `docker compose -f docker-compose.mcp.yml up` succeeds on a clean machine with only Docker installed
2. `curl http://localhost:3011/health` returns `200 OK` within 90 seconds of `up`
3. All 22 MCP tools respond without errors (verified by test script)
4. PostgreSQL data persists across `down`/`up` cycles (named volume)
5. `.env.example` documents every environment variable with description and default

---

### F5: One-Click VS Code Setup (P0)

**Problem:** No way to add ForgeOS MCP to VS Code without manually editing JSON configuration files.

**Deliverables:**

1. **VS Code install badge** in README.md using `vscode:mcp/install` URI scheme
2. **`.vscode/mcp.json`** example showing all three connection modes (HTTP, npx, Docker)
3. **Shields.io badge** linking to the install URI

**Behavior:**

- **Given** a user reads the ForgeOS README on GitHub  
- **When** they click the "Install in VS Code" badge  
- **Then** VS Code opens, prompts to add the ForgeOS MCP server, and writes the config to their `mcp.json`

- **Given** a user clones the ForgeOS repo  
- **When** they open the workspace in VS Code  
- **Then** `.vscode/mcp.json` pre-configures the HTTP connection to `localhost:3011`

**Acceptance Criteria:**

1. Badge renders correctly on GitHub README (Shields.io format)
2. Clicking badge on a machine with VS Code opens the MCP install prompt
3. `.vscode/mcp.json` includes HTTP, npx, and Docker configurations (commented alternatives)
4. `${input:...}` variables used for secrets (DATABASE_URL, API keys)

---

### F6: Production Hardening (P0)

**Problem:** While graceful shutdown exists in `index.ts`, several production readiness items are incomplete.

**Deliverables:**

1. **Readiness probe** (`/ready`) — separate from `/health`, verifies DB connectivity + migration status
2. **Connection pool cleanup** — ensure `closePool()` drains in-flight queries before exit
3. **Structured error responses** — all 22 tool handlers return `{ isError: true, content: [{ type: "text", text: JSON.stringify({ error, code }) }] }` on failure
4. **Request timeout** — 30s default timeout on MCP tool invocations
5. **Unhandled promise tracking** — log and metric on unhandled rejections (already partially implemented)

**Acceptance Criteria:**

1. `GET /health` returns `200` if process is alive (liveness)
2. `GET /ready` returns `200` only when DB is connected and migrations are current; returns `503` otherwise
3. Container orchestrators (Docker, K8s) can use `/ready` for readiness gates
4. All 22 tools return structured `isError` responses on failure (no raw exceptions)
5. Server shuts down cleanly within 10s on SIGTERM — zero connection leaks

---

### F7: npm Package — `@forgeos/mcp-server` (P1)

**Problem:** Users who already have a PostgreSQL instance running cannot easily connect a lightweight MCP client to it.

**Deliverables:**

1. **npm package** `@forgeos/mcp-server` published to npm registry
2. **Dual mode:**
   - `npx -y @forgeos/mcp-server --mode=client --url=http://localhost:3011/mcp` — thin HTTP client that proxies MCP stdio ↔ HTTP
   - `npx -y @forgeos/mcp-server --mode=server --database-url=postgresql://...` — full server mode
3. **`bin` entry** in package.json pointing to compiled entry point with `#!/usr/bin/env node` shebang
4. **`mcpName` field** for MCP Registry ownership verification

**Acceptance Criteria:**

1. `npx -y @forgeos/mcp-server --help` prints usage information
2. Client mode connects to a running ForgeOS HTTP endpoint and proxies all 22 tools via stdio
3. Server mode starts Express + MCP on configured port
4. Package size < 5 MB (excluding node_modules)
5. Works on Node.js 22+ (matching existing engine requirement)

---

### F8: Published Docker Image (P1)

**Problem:** No pre-built Docker image exists. Users must clone and build locally.

**Deliverables:**

1. **GitHub Actions workflow** that builds and pushes to `ghcr.io/forgeos/mcp-server` on release tags
2. **Multi-arch support:** `linux/amd64` and `linux/arm64`
3. **Docker labels** for MCP Registry: `LABEL io.modelcontextprotocol.server.name="io.github.forgeos/mcp-server"`
4. **Semantic versioning tags:** `latest`, `1.0.0`, `1.0`, `1`

**Acceptance Criteria:**

1. `docker pull ghcr.io/forgeos/mcp-server:latest` succeeds from any machine
2. Image includes health check, runs as non-root user
3. Image size < 200 MB (Alpine-based)
4. Image runs without requiring a workspace volume mount (agent definitions seeded in DB)
5. GitHub Actions workflow triggers on tag push (`v*`)

---

### F9: MCP Registry Listing (P1)

**Problem:** ForgeOS is invisible to MCP ecosystem discovery tools (VS Code Gallery, registry.modelcontextprotocol.io, Docker MCP Catalog).

**Deliverables:**

1. **`server.json`** at repo root conforming to MCP Registry schema
2. **npm ownership verification** via `mcpName` in package.json
3. **Docker ownership verification** via OCI label in Dockerfile
4. **Publication** via `mcp-publisher publish`

**Acceptance Criteria:**

1. `server.json` passes schema validation against `https://static.modelcontextprotocol.io/schemas/2025-07-09/server.schema.json`
2. ForgeOS appears in search results on registry.modelcontextprotocol.io
3. Documentation fields (description, repository URL, tool descriptions) are populated
4. Both npm and Docker packages are listed as distribution channels

---

### F10: Rate Limiting Middleware (P1)

**Problem:** No rate limiting on the MCP endpoint. A misbehaving agent could overwhelm the server.

**Behavior:**

- **Given** a client sends more than `RATE_LIMIT_PER_MINUTE` requests in a 60-second window  
- **When** the next request arrives  
- **Then** the server responds with HTTP 429 and `Retry-After` header

- **Given** the `RATE_LIMIT_PER_MINUTE` config variable is set  
- **When** the server starts  
- **Then** rate limiting is applied to the `/mcp` endpoint with the configured limit

**Acceptance Criteria:**

1. Rate limiting applied to `/mcp` endpoint
2. Configurable via `RATE_LIMIT_PER_MINUTE` environment variable (default: 100)
3. Returns standard `429 Too Many Requests` with `Retry-After` header
4. `/health` and `/ready` endpoints are exempt from rate limiting
5. Rate limit state is per-IP (not global)

---

### F11: Comprehensive Error Handling (P1)

**Problem:** Not all 22 tool handlers have consistent error response structure. Some may throw unhandled exceptions.

**Acceptance Criteria:**

1. Every tool handler is wrapped in try/catch
2. Error responses follow MCP SDK pattern: `{ isError: true, content: [{ type: "text", text: ... }] }`
3. Internal error details (stack traces, SQL errors) are NOT exposed to clients
4. Errors are logged with correlation ID (request-id middleware already exists)
5. Zod schema validation errors return descriptive messages for the calling LLM

---

## 5. Non-Functional Requirements

### Performance

| Metric | Target | Measurement |
|---|---|---|
| Tool response latency (p50) | ≤100ms | `tickets.list`, `tickets.get` benchmarks |
| Tool response latency (p95) | ≤500ms | Under normal load |
| Tool response latency (p99) | ≤2000ms | Including code intelligence tools (tree-sitter parsing) |
| Throughput | ≥50 tool calls/sec sustained | Load test with 10 concurrent clients |
| Cold start (container) | ≤30s to healthy | Time from `docker compose up` to `/health` 200 |

### Reliability

| Metric | Target |
|---|---|
| Availability | ≥99.5% uptime during active use |
| Data durability (compile queue) | Zero job loss on container restart |
| Graceful shutdown | Complete within 10s, zero leaked connections |
| Unhandled promise rejections | Logged, counted, ≤0 per tool invocation |

### Security

| Requirement | Implementation |
|---|---|
| Authentication | API key required for remote `/mcp` access (configurable via `ADMIN_API_KEY`) |
| Input validation | Zod schemas on all 22 tool inputs (already implemented) |
| No hardcoded secrets | All secrets via environment variables or Docker secrets |
| CORS | Configurable allowed origins (currently allows requesting origin) |
| Audit logging | All tool invocations logged with timestamp, tool name, and correlation ID |
| Secret scanning | No secrets in Docker image layers or npm package |
| SQL injection | Parameterized queries only (pg library pattern) |
| Rate limiting | Per-IP rate limiting on `/mcp` (F10) |

### Compatibility

| Target | Version |
|---|---|
| Node.js | ≥22.0.0 |
| PostgreSQL | 17 with pgvector |
| MCP SDK | ≥1.27.1 |
| Docker | ≥24.0 |
| Docker Compose | ≥2.20 |
| VS Code | ≥1.99 (MCP support) |
| Ollama | ≥0.5 (optional, for embeddings) |

### Observability

| Signal | Implementation |
|---|---|
| Structured logs | pino (JSON in production, pretty in development) |
| Health endpoint | `/health` (liveness), `/ready` (readiness) |
| Metrics | Compile queue depth, tool call count, error rate via `/health` extended |
| Event stream | SSE on `/events` for real-time ticket state changes |

---

## 6. Out of Scope

| Item | Reason | Future Consideration |
|---|---|---|
| Cloud-hosted demo endpoint (P2) | Requires hosting infrastructure, ongoing cost | Post v1.0, if adoption justifies |
| CLI configuration wizard (P2) | Nice-to-have UX polish | v1.1 |
| Telemetry/observability dashboard (P2) | Grafana integration exists in `infra/monitoring/` but is not user-facing | v1.1 |
| OAuth 2.0 authentication | Complex, API keys sufficient for v1.0 | When hosted multi-tenant use case arises |
| GUI-based ticket management | ForgeOS is an AI agent tool, not a human PM tool | Never (anti-persona) |
| Kubernetes Helm chart | Docker Compose is sufficient for v1.0 | v1.2 based on user demand |
| Windows native support | Docker provides cross-platform; Node.js works natively | Low priority |
| Multi-tenancy / team isolation | Single-tenant model for v1.0 | v2.0 if SaaS model pursued |
| pgAdmin bundling | Convenience tool, not core; currently has restart issues | Users can add their own pgAdmin |

---

## 7. Technical Architecture (Reference Only — NOT prescriptive)

> The Architect agent owns all technical decisions. This section records the known current state for context.

```
┌─────────────────────────────────────────────────────────┐
│                   Distribution Layer                     │
│                                                         │
│  ┌──────────┐  ┌──────────────┐  ┌──────────────────┐  │
│  │ npm/npx  │  │ Docker Image │  │ Remote HTTP URL  │  │
│  │ (stdio   │  │ (ghcr.io)    │  │ (for VS Code     │  │
│  │  client)  │  │              │  │  http type)      │  │
│  └────┬─────┘  └──────┬───────┘  └────────┬─────────┘  │
│       │               │                    │            │
│       └───────────────┼────────────────────┘            │
│                       ▼                                 │
│  ┌──────────────────────────────────────────────────┐   │
│  │         ForgeOS MCP Server (Express)             │   │
│  │  /mcp (Streamable HTTP) │ /health │ /ready       │   │
│  │  /events (SSE)          │ /dashboard              │   │
│  │  22 MCP Tools ─ 14 ticket + 5 code + 3 memory   │   │
│  └──────────────────────┬───────────────────────────┘   │
│                         │                               │
│  ┌──────────────────────┼───────────────────────────┐   │
│  │              Data Layer                          │   │
│  │  PostgreSQL 17 + pgvector                         │   │
│  │  ├─ tickets, events, file_locks                   │   │
│  │  ├─ agent_definitions (seeded)                    │   │
│  │  ├─ prompt_compile_queue (durable)                │   │
│  │  ├─ code_files, code_symbols, code_imports        │   │
│  │  └─ lessons (pgvector embeddings)                 │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │              Ollama (Optional)                     │   │
│  │  Embeddings: mxbai-embed-large                    │   │
│  │  Prompt LLM: qwen2.5:7b-instruct                 │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 8. Dependencies & Assumptions

### Dependencies

| Dependency | Owner | Risk |
|---|---|---|
| `@modelcontextprotocol/sdk ≥1.27.1` | Anthropic / MCP community | Low — stable, widely used |
| PostgreSQL 17 with pgvector | PostgreSQL community | Low — mature, well-supported |
| VS Code MCP support | Microsoft | Low — shipping in stable releases since 1.99 |
| MCP Registry availability | Anthropic + GitHub + Microsoft | Medium — still in preview |
| Ollama availability | Ollama community | Medium — optional dependency |
| GitHub Container Registry | GitHub | Low — established service |

### Assumptions

| # | Assumption | Validation Plan |
|---|---|---|
| A1 | Users have Docker ≥24.0 installed | Document requirement, provide fallback npm instructions |
| A2 | `vscode:mcp/install` URI works on GitHub README links | Test on Chrome, Firefox, and Safari rendering of GitHub markdown |
| A3 | MCP Registry will remain backward compatible through v1.0 | Pin schema version in server.json |
| A4 | Ollama is not required for core ticket tools | Verify all 14 ticket tools work without Ollama; only memory/code intelligence needs embeddings |
| A5 | Users accept API key auth for v1.0 (not OAuth) | User feedback after launch; plan OAuth for v1.1 if needed |

---

## 9. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| MCP Registry schema breaking change | Medium | Medium | Pin schema version, watch for updates, support direct `mcp.json` config as fallback |
| npm package name `@forgeos/mcp-server` taken | Low | High | Check availability before implementation; have alternate names ready |
| Docker image size exceeds 200MB target | Medium | Low | Use Alpine, multi-stage build, strip dev dependencies |
| pgvector not available in `postgres:17-alpine` | Medium | Medium | Use custom Dockerfile for postgres with pgvector extension |
| Ollama model download on first start adds latency | High | Medium | Document in README, provide `--profile ollama` so it's opt-in |
| Security vulnerabilities in MCP transport | Medium | High | Follow OWASP MCP checklist, input validation on all tools, rate limiting |

---

## 10. Phased Delivery Plan

### Phase A: Fix Internal Gaps (P0 — Sprint 1)

| Feature | Tickets |
|---|---|
| F1: Durable compile queue | BACKEND: Refactor `compiler.ts` to write/read `prompt_compile_queue` |
| F2: Extended compile triggers | BACKEND: Hook `tickets.complete` and `tickets.reject` for additional stages |
| F3: Agent definitions seeding | BACKEND: Create seed data for 14 agents, update `getAgentByStage()` |

**Exit Criteria:** All prompt compilations survive container restart. `agent_definitions` has 14 rows. Compilation triggers on READY, BACKEND, FRONTEND, TODO.

### Phase B: Distribution (P0 — Sprint 2)

| Feature | Tickets |
|---|---|
| F4: Standalone Docker Compose | DEVOPS: Create `docker-compose.mcp.yml` + `.env.example` |
| F5: VS Code one-click | FRONTEND/DOCS: Badge generation, `.vscode/mcp.json` |
| F6: Production hardening | BACKEND: `/ready` endpoint, structured errors, request timeout |

**Exit Criteria:** `docker compose -f docker-compose.mcp.yml up` works on clean machine. Badge installs MCP server in VS Code.

### Phase C: Ecosystem Integration (P1 — Sprint 3)

| Feature | Tickets |
|---|---|
| F7: npm package | BACKEND: Package, bin entry, dual-mode support |
| F8: Docker image CI | DEVOPS: GitHub Actions for ghcr.io publish |
| F9: MCP Registry | DOCS: server.json, registry publication |
| F10: Rate limiting | BACKEND: express-rate-limit middleware |
| F11: Error handling | BACKEND: Audit all 22 handlers |

**Exit Criteria:** `npx @forgeos/mcp-server --help` works. `ghcr.io/forgeos/mcp-server` pullable. Registry listing live.

---

## 11. Discovery Matrix

| Question | Category | Status | Answer |
|---|---|---|---|
| Who are the primary users? | WHO | Answered | Solo AI developers, DevOps engineers, MCP ecosystem explorers |
| What is the core problem? | WHAT | Answered | Cannot use ForgeOS MCP without cloning the repo; internal gaps block production use |
| What is the current workaround? | WHAT | Answered | Clone repo, manual Docker build, manual prompt re-trigger |
| What are the success criteria? | WHAT | Answered | <5 min setup, zero job loss, 14 agents seeded, registry listed |
| How do other MCP servers distribute? | HOW (research) | Answered | npm/npx (stdio), Docker (stdio/HTTP), Remote HTTP — dual distribution recommended |
| What does VS Code one-click look like? | HOW (research) | Answered | `vscode:mcp/install` URI scheme + Shields.io badge |
| What production checks are needed? | WHAT | Answered | Health/ready probes, rate limiting, structured errors, graceful shutdown |
| Is Ollama required? | CONSTRAINT | Answered | Optional — required only for embeddings and prompt compilation LLM |
| What is the npm package scope? | CONSTRAINT | Open | Need to verify `@forgeos` npm org availability |
| What auth model for v1.0? | CONSTRAINT | Answered | API key (existing `ADMIN_API_KEY`), OAuth deferred to v1.1 |

---

## 12. Appendix: Tool Inventory

The ForgeOS MCP server exposes 22 tools across three domains:

**Ticket Lifecycle (14 tools):**
`tickets.next`, `tickets.claim`, `tickets.complete`, `tickets.reject`, `tickets.release`, `tickets.extend`, `tickets.update`, `tickets.spawn`, `tickets.stats`, `tickets.graph`, `tickets.list`, `tickets.get`, `tickets.payload`, `tickets.attach_prompts`

**Code Intelligence (5 tools):**
`init.index`, `init.orient`, `code.search_symbols`, `code.blast_radius`, `code.get_imports`

**Memory & Learning (3 tools):**
`memory.add_lesson`, `memory.search_lessons`, `memory.get_context`
