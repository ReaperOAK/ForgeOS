# Vibecoding

[![MCP Server CI](https://github.com/Ticketer/ForgeOS/actions/workflows/mcp-server-ci.yml/badge.svg)](https://github.com/Ticketer/ForgeOS/actions/workflows/mcp-server-ci.yml)

**Autonomous Software Agency Engine**

An adaptive, event-driven, elastic multi-worker orchestration system that
simulates a professional engineering organization — not a code generator.

Version 9.1.0 | Built on GitHub Copilot Agent Infrastructure

## Install for Claude Code (plugin — fastest, no infra)

Run the full ForgeOS engine inside Claude Code in **any** project — no Docker,
no database, no MCP server required.

```bash
# 1. Add the marketplace, then install the plugin
claude plugin marketplace add reaperoak/ForgeOS
claude plugin install forgeos@forgeos
```

Then, in your project:

```
cd your-project && claude
/forgeos:init          # scaffold the engine into ./.forgeos/ (once per project)
/start <your vision>   # PRD → architecture → tickets, then build
```

This installs 15 SDLC agents, a 14-stage ticket lifecycle, governance hooks,
and 20+ skills. See [`plugin/forgeos/README.md`](plugin/forgeos/README.md) for
details, and [`scripts/build-plugin.sh`](scripts/build-plugin.sh) to regenerate
the plugin from source. The optional PostgreSQL-backed MCP server below is a
separate, heavier deployment for multi-worker fleets.

## Quick Start (self-hosted MCP server — optional)

```bash
git clone https://github.com/Ticketer/ForgeOS.git
cd ForgeOS
make setup   # checks prerequisites, installs deps, creates .env
make up      # starts PostgreSQL, MCP Server, and pgAdmin
make migrate && make seed  # apply schema and load sample data
```

---

## VS Code MCP Setup (Safe — No Hardcoded Credentials)

The ForgeOS MCP server authenticates via Bearer token. To configure VS Code
without committing secrets:

### 1. Run setup (or copy the env template manually)

```bash
make setup
# OR manually:
cp .env.example .env
```

### 2. Generate an admin token

Pick a strong random value and set it in `.env`:

```bash
# Generate a secure token
echo "FORGEOS_ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env
```

### 3. Start the server (so the token takes effect)

```bash
make up   # or: docker compose -f infra/docker-compose.yml up -d
```

The server reads `FORGEOS_ADMIN_TOKEN` from `.env` at startup.

### 4. Configure VS Code

The workspace ships with `.vscode/mcp.json` that references the token via
VS Code's variable substitution:

```jsonc
{
  "servers": {
    "forgeos": {
      "type": "http",
      "url": "http://localhost:3011/mcp",
      "headers": {
        "Authorization": "Bearer ${FORGEOS_ADMIN_TOKEN}"
      }
    }
  }
}
```

`${FORGEOS_ADMIN_TOKEN}` is resolved from VS Code's own environment (which
inherits from your shell, or from a `.env` file loaded by the
[vscode-env](https://marketplace.visualstudio.com/items?itemName=PKief.vscode-env)
extension, or via `"terminal.integrated.env.linux"` in settings).

**Never** hardcode the token in `mcp.json` — always use the variable reference.

### 5. Verify the connection

Open VS Code's MCP panel or check the DevTools console for:

```
[forgeos] connected to http://localhost:3011/mcp
[forgeos] tools: tickets.next, tickets.claim, tickets.complete, …
```

---

## Vision

AI tools generate code. They do not run engineering organizations.

The gap between "AI writes a function" and "AI ships a product" is
enormous. Real engineering requires decomposition, dependency management,
parallel execution, governance, quality gates, commit discipline, strategic
pivots, and continuous delivery — all coordinated across specialized roles with
conflict-free concurrency.

Vibecoding closes that gap.

It is a programmable engineering organization that operates as an elastic,
event-driven agency engine. It decomposes work into tickets, assigns them to
specialized workers from auto-scaling pools, enforces a strict stage-based SDLC
lifecycle per ticket, runs strategic planning concurrently with execution,
and enforces distributed two-commit execution (CLAIM + WORK) with scoped git.

The result is not generated code. It is governed, reviewable, production-grade
engineering output with full audit trails.

---

## High-Level Architecture

Vibecoding operates a **two-layer concurrent model** with no global phase
barriers. Strategic discovery and execution run simultaneously.

The runtime infrastructure consists of:

- **ForgeOS MCP Server** (`forgeos-server/`) — TypeScript/Express service
  exposing 19 tools (11 ticket-lifecycle + 3 code graph + 3 memory + 2 init)
  over the Model Context Protocol (MCP) via Streamable HTTP transport.
- **PostgreSQL 17** — Primary data store with Row-Level Security, stored
  functions for atomic ticket operations, event-sourcing audit trail, and
  `LISTEN/NOTIFY` for real-time Server-Sent Events.
- **Real-Time Dashboard** — Live Kanban board at
  **http://localhost:3011/dashboard** with SSE-driven updates, stage
  filtering, and ticket detail views.

```
ForgeOS Dispatcher (CTO / Elastic Multi-Worker Parallel Orchestrator)
|
+--- Strategic Layer ----------------------------------------
|    Research Analyst      Evidence research, PoC, tech radar
|    Product Manager       PRDs, user stories, requirements
|    Architect             System design, ADRs, API contracts
|    Security (strategic)  STRIDE, OWASP, threat models
|    UIDesigner            Conceptual mockups, design specs
|    DevOps (planning)     Infrastructure planning, capacity
|    TODO                  Progressive task decomposition
|
+--- Execution Layer ----------------------------------------
     Backend               Server code, APIs, business logic
     Frontend              UI, WCAG 2.2 AA, Core Web Vitals
     DevOps (execution)    CI/CD, Docker, IaC
     QA                    Tests, mutation testing, E2E
     Security (execution)  SBOM generation, vulnerability scans
     Documentation         Diataxis, Flesch-Kincaid scoring
     Validator             SDLC compliance, DoD enforcement
     CI Reviewer           Complexity, lint, SARIF findings
```

**ForgeOS dispatcher** is the singular orchestrator. It never writes code. It selects
tickets, assigns workers from elastic pools, drives each ticket through its
lifecycle, reacts to events, and enforces commits. All inter-agent
communication routes through the dispatcher — there is no direct agent-to-agent
messaging.

### Key Properties

- **Event-driven scheduling.** No global cycles. Workers are assigned tickets
  the moment they become available. The scheduler wakes on events, not timers.
- **Elastic worker pools.** Each agent role is backed by an auto-scaling pool
  with configurable min/max capacity. Pools grow when backlog exceeds active
  workers and shrink when workers idle.
- **Ticket-based execution.** Every unit of work is a ticket. Every ticket
  traverses a deterministic stage-based lifecycle. No exceptions.
- **No global phases.** There is no "planning phase" followed by a "build
  phase." Strategic agents produce artifacts continuously. Execution agents
  consume them as they become available.
- **Adaptive roadmap evolution.** Strategy can change mid-execution via
  Strategic Decision Records (SDRs). Only affected tickets are re-prioritized.
  Unrelated work continues without interruption.

---

## Core Concepts

### Ticket

The atomic unit of work. Each ticket has an ID, acceptance criteria, declared
file paths, priority, and dependency list. Tickets are produced by the TODO
Agent through progressive refinement (Vision -> Capabilities -> Blocks -> Tasks)
and enter the execution pipeline at the READY state.

### Worker

An ephemeral, stateless agent instance spawned to process exactly one ticket.
Workers are identified by dynamic IDs (`BackendWorker-a1b2c3`,
`FrontendWorker-d4e5f6`). A worker processes one ticket, completes its
lifecycle, and terminates. No worker is ever reused across tickets.

### Worker Pool

Each agent role (Backend, Frontend, QA, etc.) is backed by an elastic pool
with defined minimum and maximum capacity. Pools auto-scale based on ticket
backlog: scale up when READY tickets exceed active workers, scale down when
workers idle beyond a configurable timeout.

| Pool | Min | Max |
|------|-----|-----|
| Backend | 2 | 15 |
| Frontend | 1 | 10 |
| QA | 1 | 8 |
| Research | 1 | 8 |
| Security | 1 | 5 |
| DevOps | 1 | 5 |
| Documentation | 1 | 3 |
| Validator | 1 | 3 |
| CI Reviewer | 1 | 3 |
| Product Manager | 1 | 3 |
| Architect | 1 | 3 |
| UIDesigner | 1 | 3 |

### Strategic Decision Record (SDR)

A versioned artifact produced when project direction needs to change
mid-execution. SDRs follow a lifecycle: PROPOSED -> APPROVED -> APPLIED ->
ARCHIVED. Each approved SDR increments the roadmap minor version. SDRs enable
controlled pivots without halting unaffected work.

### Event Queue

An ordered log of all system events. The ForgeOS dispatcher consumes events and routes
them to the appropriate handler. Event types include TASK_STARTED,
TASK_COMPLETED, TASK_FAILED, WORKER_SPAWNED, WORKER_TERMINATED,
POOL_SCALED_UP, POOL_SCALED_DOWN, SDR_PROPOSED, SDR_APPROVED,
CONFLICT_DETECTED, REWORK_TRIGGERED, STALL_WARNING, and others.

### Ticket State Machine

Every ticket traverses a defined subset of 11 stages based on its type. No
stage may be skipped. The flow is enforced by `tickets.py`.

```
Available Stages: READY | ARCHITECT | RESEARCH | BACKEND | FRONTEND | QA | SECURITY | CI | DOCS | VALIDATION | DONE
```

| Type | Flow |
|------|------|
| backend | READY → BACKEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| frontend | READY → FRONTEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| fullstack | READY → BACKEND → FRONTEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| infra | READY → BACKEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE |
| security | READY → SECURITY → QA → CI → DOCS → VALIDATION → DONE |
| docs | READY → DOCS → VALIDATION → DONE |
| research | READY → RESEARCH → DOCS → VALIDATION → DONE |
| architecture | READY → ARCHITECT → DOCS → VALIDATION → DONE |

REWORK is a side-state (failure path) entered when QA, Security, Validator, or CI
Reviewer rejects output. Maximum 3 combined rework attempts before escalation
to the operator.

### Conflict Detection

Before assigning a ticket, the scheduler checks for conflicts with all
in-flight tickets across 6 dimensions: file path overlap, directory subtree
overlap, database schema collision, infrastructure resource contention,
shared config modification, and mutual exclusion flags.

### Elastic Scaling

Worker pools grow and shrink dynamically. When 5 READY tickets appear for a
role with 2 active workers, the pool scales to 5. When backlog clears and
workers idle, the pool contracts back toward its minimum. This simulates
hiring and releasing engineers based on workload — without the overhead.

---

## Parallelism Model

Vibecoding achieves true parallel execution through a continuous scheduling
loop that batches conflict-free tickets and dispatches them simultaneously.

### Principles

- **One worker = one ticket.** Strictly enforced. A worker that references
  any ticket other than its assigned one is immediately terminated.
- **Multiple workers per role.** The Backend pool can run 15 concurrent
  workers. The Frontend pool can run 10. Each processes its own ticket
  independently.
- **Auto-scaling pools.** Worker count adjusts to backlog size within
  configured bounds.
- **Independent ticket lifecycles.** Each ticket progresses through the
  stage-based lifecycle at its own pace. There is no synchronization barrier.
- **No artificial batching.** Tickets are dispatched as soon as they are
  ready and a worker is available. No waiting for "all tickets in a phase"
  to complete.
- **Continuous scheduler.** The scheduling loop runs on every event, not on
  a timer.

### Scheduling Loop (Pseudocode)

```
loop:
    # Auto-Scale Phase
    for each pool:
        ready_count = count(tickets where state=READY and role=pool.role)
        if ready_count > pool.active and pool.active < pool.maxSize:
            scale_up(pool, min(ready_count, pool.maxSize))

    # Assignment Phase
    batch = []
    for ticket in ready_tickets (sorted by priority):
        if all_dependencies_done(ticket):
            conflicts = detect_conflicts(ticket, in_flight_tickets + batch)
            if no conflicts:
                worker = spawn_worker(ticket.role)
                batch.append((ticket, worker))
                transition(ticket, LOCKED)

    # Parallel Dispatch Phase
    parallel_launch(batch)

    await next_event()
```

All workers in a batch execute concurrently. Workers of the same role share
no state between instances.

---

## SDLC Enforcement

Every ticket traverses a mandatory stage-based lifecycle per its type. No
stage may be skipped. No shortcut exists. This is not optional governance —
it is the execution model.

```
Available Stages: READY | ARCHITECT | RESEARCH | BACKEND | FRONTEND | QA | SECURITY | CI | DOCS | VALIDATION | DONE
```

| Stage | Description |
|-------|-------------|
| READY | Dependencies met, eligible for assignment |
| ARCHITECT | Architecture design, ADRs, API contracts |
| RESEARCH | Evidence-based research, PoC, analysis |
| BACKEND | Server-side implementation, APIs, business logic |
| FRONTEND | UI implementation, components, layouts |
| QA | QA Engineer reviews test coverage (>=80%), functional verification |
| SECURITY | Security Engineer performs STRIDE + OWASP review |
| CI | CI Reviewer checks lint, types, complexity |
| DOCS | Documentation Specialist updates relevant artifacts |
| VALIDATION | Validator independently verifies 10-item Definition of Done |
| DONE | Full lifecycle complete, worker released |

### Enforcement Rules

- **No skipping.** Guard conditions enforce every transition.
- **Two-commit required.** Each stage requires CLAIM commit then WORK commit.
- **Scoped changes only.** Commits must stage explicit ticket files only.
- **Ticket isolation.** A worker that modifies files outside its declared
  scope is rejected at QA.
- **Shared rework counter.** QA rejections, Validator rejections, and CI
  rejections share one counter. Three combined failures trigger escalation.

### Definition of Done (10 Items)

Every ticket must satisfy all items. The Validator independently verifies
each one. No exceptions without operator override.

1. Code implemented (all acceptance criteria met)
2. Tests written (>=80% coverage for new code)
3. Lint passes (zero errors, zero warnings)
4. Type checks pass
5. CI passes (all workflow checks green)
6. Docs updated (JSDoc/TSDoc, README if applicable)
7. Reviewed by Validator (independent review)
8. No console errors (structured logger only)
9. No unhandled promises
10. No TODO comments in code

---

## Strategic Evolution

Strategy is not static. Vibecoding supports controlled mid-execution pivots
through the SDR (Strategic Decision Record) protocol.

### How It Works

1. A strategic-layer agent (Research, Architect, Product Manager) identifies
   a necessary direction change and proposes an SDR.
2. The ForgeOS dispatcher evaluates the SDR. Scope expansions require operator approval.
   Priority reshuffling can be auto-approved.
3. On approval, affected tickets are re-prioritized, new tickets are generated
   by the TODO Agent, and obsolete tickets are cancelled.
4. The roadmap version increments (v1.0 -> v1.1 -> v1.2).
5. Unaffected tickets continue execution without interruption.

### Properties

- **Only affected tickets pause.** A strategy pivot does not trigger a global
  reset. Workers processing unrelated tickets continue uninterrupted.
- **Roadmap versioning.** Each SDR creates a traceable version increment.
  The full history of strategic evolution is preserved.
- **No global reset.** The system never stops and replans from scratch. It
  adapts incrementally.
- **Controlled pivots.** Every change is documented, approved, and versioned.
  No silent scope creep.

---

## UI/UX Hard Gating

UI-touching tickets are subject to a hard enforcement gate — not a soft
flag. Frontend workers cannot begin execution until design artifacts exist.

### Requirements

Before a UI-touching ticket transitions from READY to LOCKED for a Frontend
worker, all of the following must be verified:

- Stitch mockup file exists at the designated path
- Mockup approved by UIDesigner (status: APPROVED)
- Component inventory listed
- Responsive breakpoints defined
- Accessibility annotations present

### Enforcement

- If any artifact is missing, the ticket is **blocked**. It cannot proceed.
- If UIDesigner reports completion but artifacts are missing on disk, the
  completion is rejected and the UIDesigner is re-delegated with specific
  missing file paths.
- Backend tickets that are not UI-touching bypass this gate entirely.
- Override requires explicit operator approval, logged in the decision log.

### Tooling

UIDesigner produces mockups via Google Stitch MCP integration and validates
them with Playwright for visual regression. Design tokens, component specs,
and responsive breakpoints are delivered as structured artifacts that Frontend
workers consume directly.

### Design System Artifacts

| Artifact | Path | Description |
|----------|------|-------------|
| Design Tokens | `docs/uiux/design-tokens.json` | Dark/light themes, typography, spacing, breakpoints, shadows, z-index, transitions |
| Layout Specification | `docs/uiux/layout-spec.md` | Shell architecture, responsive matrix, 40+ component hierarchy, WCAG 2.2 AA |
| Mockup Specification | `docs/uiux/mockups/` | Screen-level mockups, component props, user flows, accessibility checklist |

---

## Intelligence Features

Beyond ticket orchestration, ForgeOS includes a cognitive intelligence layer
that makes agents context-aware and self-improving.

### Code Graph Engine (Phase 2)

AST-based code understanding powered by tree-sitter WASM parsers. The MCP
Server parses source files into a dependency graph stored in PostgreSQL.

| Tool | Purpose |
|------|---------|
| `code.blast_radius` | Compute which files and symbols are affected by a change |
| `code.search_symbols` | Search functions, classes, and methods by name pattern |
| `code.get_imports` | Trace the transitive import chain of a file |

Supported languages: TypeScript, JavaScript, Python, SQL (regex fallback for
others).

### Memory Engine (Phase 3)

Vector-based lesson storage using pgvector and OpenAI embeddings. Agents
record lessons from rework cycles, and future agents retrieve relevant
past lessons via semantic search.

| Tool | Purpose |
|------|---------|
| `memory.add_lesson` | Record a lesson with automatic embedding |
| `memory.search_lessons` | Semantic similarity search over past lessons |
| `memory.get_context` | Unified context for ticket dispatch (blast radius + lessons) |

### Drop-In Initialization (Phase 4)

Zero-config project onboarding. Index a new codebase and auto-detect its
tech stack in two tool calls.

| Tool | Purpose |
|------|---------|
| `init.index` | Parse and index all source files into the code graph |
| `init.orient` | Auto-discover frameworks, languages, entry points |

For setup instructions, see the
[Intelligence Setup Guide](docs/operations/intelligence-setup.md).
For architecture details, see the
[Intelligence Architecture](docs/architecture/intelligence-architecture.md).

---

## Required MCP and Tooling

Vibecoding is built on the Model Context Protocol (MCP) ecosystem. While
core orchestration logic operates with minimal tooling, maximum value is
achieved when connected to the full stack.

The ForgeOS MCP Server exposes 19 tools via the MCP protocol: 11 ticket
lifecycle tools, 3 code graph tools, 3 memory engine tools, and 2
initialization tools.

For complete input/output schemas, error codes, and usage examples, see the
[MCP Tool Definition Schemas](docs/architecture/api/mcp-tool-definitions.md)
reference document and the
[Intelligence Architecture](docs/architecture/intelligence-architecture.md)
for Phase 2–4 tool specifications.

The **Agent Registration API** (`/api/admin/*`) enables programmatic agent
lifecycle management — registration with one-time API key generation, key
revocation, deregistration, and MCP session association. See the
[Admin API](forgeos-server/README.md#admin-api-apiadmin) section in the
ForgeOS Server documentation for endpoint details.

### Core (Required)

| Tool | Purpose |
|------|---------|
| Code execution MCP | Terminal access for builds, tests, linting |
| File system MCP | File read/write/search across the workspace |
| Git integration | Commit enforcement, branch management, diff analysis |

### Recommended

| Tool | Purpose |
|------|---------|
| GitHub / GitLab API | Issue tracking, PR creation, code search |
| Stitch MCP | UI mockup generation, design iteration |
| Playwright MCP | Browser automation, E2E testing, visual validation |
| Container / Docker tooling | Staging environments, isolated builds |
| CI pipeline integration | Automated lint, type check, test execution |
| MongoDB MCP | Database operations, schema management |
| Sentry MCP | Error monitoring, issue tracking, trace analysis |
| Terraform MCP | Infrastructure as Code, provider/module management |

### Optional Enhancements

| Tool | Purpose |
|------|---------|
| Redis | Event queue persistence, distributed state |
| Message queue system | Durable event routing at scale |
| Secret management | Vault integration for credential handling |
| Firecrawl MCP | Web scraping, research automation |
| Memory MCP | Cross-session knowledge graph persistence |

Core logic works without all tools. Each additional integration expands the
system's operational surface — from basic code generation to full-stack
autonomous delivery.

---

## Repository Structure

```
.github/
  agents/                  14 agent definitions (*.agent.md) with YAML frontmatter
                           Includes role, tools, permissions, forbidden actions
  tickets/                 Ticket JSON files + schema (`ticket-schema.json`)
  ticket-state/            Legacy compatibility snapshots (not runtime state)
  agent-output/            Stage handoff summaries (`{Agent}/{ticket-id}.md`)
  memory-bank/             Persistent shared state (9 files + schema)
                           activeContext, progress, decisionLog, riskRegister,
                           systemPatterns, productContext, workflow-state,
                           artifacts-manifest, feedback-log
  vibecoding/
    catalog.yml            Semantic tag-to-chunk mapping (15 domains)
    index.json             Master file index with content hashes
    chunks/                Token-budgeted YAML instruction chunks (~35 dirs, ~93 files)
                           Each agent has a chunk directory with detailed protocols
  tasks/                   Delegation schemas, claim schemas, merge protocol,
                           Definition of Done template, initialization checklist
  guardian/                Circuit breaker (STOP_ALL), loop detection rules
  sandbox/                 Tool ACL definitions per agent
  observability/           Agent trace event schema
  workflows/               CI: task runner, sandbox merge, memory verify,
                           code review, doc sync, security scan, test validation
  hooks/                   Governance audit, session logger, auto-commit
  tickets.py               Distributed ticket state manager (`--sync --claim --advance`)
  agent-runner.py          Two-commit stage runner (CLAIM commit + WORK commit)
  proposals/               Self-improvement proposals (PROP-*.md)
  locks/                   File lock schema for concurrent access
  archives/                Historical orchestration artifacts
  ARCHITECTURE.instructions.md          Full system topology (1960 lines, 32 sections)
  security.agentic-guardrails.instructions.md   Threat models, MCP isolation
  orchestration.rules.instructions.md   DAG protocol, confidence gates, token tracking

agents.md                  Boot protocol loaded on every agent interaction
                           Safety checks, context loading, chunk routing

database/                  Database seeding tools (Python, psycopg2)
  seed.py                  CLI script — imports ticket JSON into PostgreSQL
  seed_data/               Sample ticket JSON for development environments
  tests/                   Pytest tests for the seed module (68 tests, 95% coverage)

forgeos-server/            TypeScript MCP Server (Express + PostgreSQL 17)
  src/
    server.ts              Express app with MCP Streamable HTTP transport
    config.ts              Zod-validated environment configuration
    db/                    Connection pool, migrations, seed, file-mutex
    tools/                 MCP tool handlers (claim, advance, reject, etc.)
    api/                   REST + SSE routes (tickets, stages, events, admin)
    auth/                  Agent registration, API key management
    dashboard/             Static Kanban dashboard (HTML/CSS/JS)
    middleware/            Logging, error handling, validation
    webhooks/              GitHub push reconciliation
  docker-compose.yml       PostgreSQL + PgBouncer + MCP Server
  Dockerfile               Multi-stage Docker build

dashboard/                 Next.js 14+ dashboard (App Router + Tailwind CSS)
  src/app/                 App Router pages (overview, health check)
  src/components/          React components (sidebar, metric cards, etc.)
  src/lib/                 API client, theme provider, types
  src/styles/              CSS custom properties (design tokens)

infra/                     Infrastructure and DevOps
  docker-compose.yml       Production Docker stack
  scripts/                 setup.sh, seed.sh, backup.sh, restore.sh
  config/                  Environment profiles (settings.py)
  monitoring/              Prometheus + Grafana stack

TODO/                      Task decomposition artifacts
  vision.md                L0 vision + L1 capabilities
  capabilities.md          L1 capability details with status
  blocks/                  L2 execution blocks per capability
  tasks/                   L3 actionable tickets per block
  micro/                   L4 micro-tasks (optional granularity)
```

---

## Example Execution Flow

**Scenario:** 5 conflict-free READY tickets trigger elastic pool spawning.
The ForgeOS dispatcher launches 5 workers in parallel. One triggers a strategic review.
Only that ticket pauses. The others continue to completion.

```
T+0:00   Scheduler detects 5 READY tickets:
           FE-001 (Frontend)  -- login form
           FE-002 (Frontend)  -- dashboard sidebar
           BE-010 (Backend)   -- user API endpoint
           BE-011 (Backend)   -- auth middleware
           DO-003 (DevOps)    -- Docker staging config

T+0:01   Conflict detection: no overlapping file paths.
         All 5 cleared for parallel dispatch.

T+0:02   Auto-scaling:
           Frontend pool: 0 -> 2 workers
           Backend pool:  0 -> 2 workers
           DevOps pool:   0 -> 1 worker

T+0:03   Parallel dispatch -- 5 simultaneous worker spawns:
           FrontendWorker-f1a2 -> FE-001
           FrontendWorker-f3b4 -> FE-002
           BackendWorker-b5c6  -> BE-010
           BackendWorker-b7d8  -> BE-011
           DevOpsWorker-d9e0   -> DO-003

T+20:00  BE-011 completes -> enters post-execution chain
         QA PASS -> Validator APPROVED -> Docs updated -> CI PASS
         CLAIM + WORK commits complete
         BE-011 -> DONE. Worker terminated.

T+22:00  BE-010 triggers NEEDS_INPUT_FROM (Architect).
         BE-010 pauses at BACKEND. Dispatcher routes question.
         All other tickets continue unaffected.

T+25:00  FE-001 completes -> full chain -> DONE
         CLAIM + WORK commits complete

T+28:00  Architect responds. BE-010 resumes.

T+33:00  BE-010 completes -> full chain -> DONE
         CLAIM + WORK commits complete

T+35:00  DO-003 completes -> full chain -> DONE
         CLAIM + WORK commits complete

T+40:00  FE-002 completes -> full chain -> DONE
         CLAIM + WORK commits complete

T+40:01  All pools at 0 active. System idle.

Commit history: scoped CLAIM/WORK commit pairs with full traceability.
```

Each ticket progressed independently. The strategic pause on BE-010 affected
only BE-010. Every other ticket completed its full lifecycle without delay.

---

## Scaling Model

Vibecoding models engineering team scaling as elastic pool management.

### How Scaling Works

- **Backlog drives capacity.** When READY tickets for a role exceed active
  workers, the pool expands. When backlog clears, it contracts.
- **Min/max bounds.** Every pool has a floor (minimum capacity reserved for
  responsiveness) and a ceiling (maximum concurrent workers to prevent
  resource exhaustion).
- **No pre-allocation.** Workers are spawned on demand. There are no idle
  workers consuming resources when there is no work.
- **Cooldown period.** After scaling up, a brief cooldown prevents
  oscillation before the next scaling decision.

### Scaling Analogy

| Engineering Org | Vibecoding |
|-----------------|------------|
| Hire contractors for a sprint | Pool scales up when backlog grows |
| Release contractors after delivery | Pool scales down when workers idle |
| Minimum team size for support | minSize keeps baseline capacity |
| Headcount cap from budget | maxSize prevents unbounded growth |

### Future: Economic-Aware Scaling

Planned extensions include cost-weighted priority scoring, where ticket
priority factors in estimated resource cost and business impact. High-ROI
tickets would be scheduled preferentially during constrained capacity.

---

## Who This Is For

- **AI-native dev agencies** replacing manual engineering coordination with
  autonomous orchestration
- **Technical founders** who need engineering discipline without a full team
- **Venture-backed startups** moving from prototype to production with
  governance from day one
- **Internal platform teams** building autonomous delivery pipelines
- **Research labs** exploring multi-agent software engineering at scale
- **Venture studios** operating multiple product lines with shared
  infrastructure
- **Infra/platform engineers** designing next-generation CI/CD beyond
  static pipelines

---

## What This Is NOT

- **Not a prompt collection.** There are no "awesome prompts" here. This is
  a state machine with governance, scheduling, and lifecycle enforcement.
- **Not a code generator.** Code generation is a side effect. The system's
  value is in orchestration, parallelism, quality gates, and commit
  discipline.
- **Not a single-agent copilot.** There are 14 specialized agents with
  defined scopes, permissions, and tool access. They do not freelance.
- **Not a chat-based dev assistant.** There is no conversational loop.
  Tickets enter a pipeline and exit as committed, reviewed, documented code.

It is a programmable engineering organization.

---

## Roadmap

### Near-Term

- Economic-aware scaling (cost-weighted ticket prioritization)
- Revenue-impact scheduling (business value drives execution order)
- Sprint simulation (time-boxed execution windows with velocity tracking)
- Incident response loop (production alerts trigger diagnostic tickets)

### Medium-Term

- Feature flag integration (progressive rollout gating per ticket)
- Release gating (staging-to-production promotion with approval workflow)
- Cross-repository orchestration (multi-repo monorepo-style coordination)
- Budget-aware pool sizing (token cost tracking per worker, per ticket)

### Long-Term

- Self-optimizing scheduling (historical performance data drives
  ticket estimation and worker allocation)
- Autonomous dependency updates (security patches as auto-generated tickets)
- Multi-org federation (shared worker pools across organizational boundaries)

---

## Installation and Usage

### Prerequisites

- Docker and Docker Compose (v2+)
- VS Code with GitHub Copilot (Agent Mode)
- Git configured with commit permissions
- Node.js 22+ / Python 3.12+ (for local development without Docker)

### Setup

```bash
# Clone the repository
git clone https://github.com/Ticketer/ForgeOS.git
cd ForgeOS

# One-command setup — checks prerequisites, installs deps, creates .env
make setup

# Start all services (PostgreSQL 17, MCP Server, pgAdmin)
make up

# Apply database migrations and load sample data
make migrate && make seed
```

The live Kanban dashboard is available at **http://localhost:3011/dashboard**.

### Configuration

1. **MCP Connections.** Configure required MCP servers in your VS Code
   settings. At minimum: file system, terminal, and Git access.

2. **Worker Pool Sizes.** Pool bounds are defined in the dispatcher agent
  definition at `.github/agents/Ticketer.agent.md` (Section 7). Adjust
   `minSize` and `maxSize` per role based on your workload profile.

3. **Git Provider.** Ensure Git is configured for the target repository.
  The dispatcher enforces two-commit protocol per stage with explicit scoped staging.

4. **Optional Integrations.** Connect Stitch MCP for UI design, Playwright
   for E2E testing, Sentry for monitoring, MongoDB for data operations,
   Terraform for infrastructure — each expands the system's operational
   surface.

### Local Development with Docker

The `infra/` directory contains a Docker Compose stack for running the full
ForgeOS platform locally. Three services start with a single command:
PostgreSQL 17, the MCP Server, and pgAdmin.

A root `Makefile` wraps all common operations. Run `make help` to list every
available target.

```bash
# First-time setup — checks prerequisites, installs deps, creates .env
make setup

# Start all services (Postgres, MCP server, pgAdmin)
make up

# Apply database migrations and load sample data
make migrate
make seed

# Run the full test suite
make test

# Show all available targets
make help
```

| Target | Purpose |
|--------|---------|
| `make up` | Start services in dev mode (detached) |
| `make down` | Stop containers, preserve volumes |
| `make restart` | Stop then start all services |
| `make migrate` | Apply pending database migrations |
| `make seed` | Load sample ticket data |
| `make test` | Run vitest test suite |
| `make logs` | Tail logs for all services |
| `make lint` | Run ESLint + Ruff linters |
| `make clean` | Remove build artefacts and stopped containers |

| Service    | URL                    |
|------------|------------------------|
| MCP Server | http://localhost:3011   |
| PostgreSQL | localhost:5432          |
| pgAdmin    | http://localhost:5050   |

See [`infra/README.md`](infra/README.md) for the full setup guide, including
environment variables, secrets, debugging, and troubleshooting.

### Database Seed Script

The seed script at `database/seed.py` imports ticket JSON files into the
PostgreSQL `tickets` table.  It validates each ticket against the schema,
maps JSON stage values to database enums, and uses upsert semantics so
duplicates are skipped rather than causing errors.

```bash
# Import all tickets from .github/tickets/ (default source)
python database/seed.py

# Import from sample data for development
python database/seed.py --source database/seed_data/sample_tickets.json

# Validate without writing to the database
python database/seed.py --dry-run

# Use a custom database URL
DATABASE_URL=postgresql://user:pass@host:5432/db python database/seed.py

# Enable debug logging
python database/seed.py --verbose
```

| Option | Description |
|--------|-------------|
| `--source PATH` | JSON file (array) or directory of ticket JSONs. Defaults to `.github/tickets/`. |
| `--database-url URL` | PostgreSQL connection string. Defaults to `DATABASE_URL` env var or `postgresql://forgeos:forgeos@localhost:5432/forgeos`. |
| `--dry-run` | Validate and transform tickets without inserting. |
| `--verbose`, `-v` | Enable debug-level logging. |

The script reports a summary of imported, skipped, and failed tickets on
completion.  Exit code is `0` when all tickets succeed and `1` when any
ticket fails validation or insertion.

Sample data at `database/seed_data/sample_tickets.json` provides 7
representative tickets across 6 types (`architecture`, `backend`, `docs`,
`frontend`, `fullstack`, `research`, `security`) for local development.

### Continuous Integration

The MCP Server CI workflow (`.github/workflows/mcp-server-ci.yml`) runs
automatically on every push to `main` and on pull requests. It validates
the TypeScript `forgeos-server`.

| Job | What it checks | Timeout |
|-----|----------------|---------|  
| TS Lint & Type Check | ESLint + TypeScript compiler (Node.js 22) | 5 min |
| TS Tests | Vitest with coverage, PostgreSQL 17 service container | 8 min |
| Docker Build | Multi-stage image build verification (no push) | 8 min |
| CI Gate | Aggregation — fails if any upstream job fails | 1 min |

Path filters restrict the workflow to changes in `forgeos-server/`
or the workflow file itself. Concurrency control cancels
in-progress runs when a newer commit is pushed to the same branch.

Coverage artifacts are uploaded with 7-day retention.

### Starting the Engine

Invoke the ForgeOS dispatcher in GitHub Copilot Agent Mode. The boot protocol
(`agents.md`) loads automatically, reads memory bank state, checks the
guardian circuit breaker, and initializes the scheduling loop.

From there, provide a project vision or feature request. The dispatcher will:

1. Invoke the TODO Agent to decompose work into tickets
2. Evaluate ticket dependencies and build the execution DAG
3. Assign workers from elastic pools to conflict-free READY tickets
4. Drive each ticket through its stage-based lifecycle
5. Produce scoped CLAIM/WORK commits with full audit trails

---

## License

See [LICENSE](LICENSE) for details.

---

**Vibecoding** is infrastructure, not a tool.

It does not write code for you. It runs an engineering organization for you.
