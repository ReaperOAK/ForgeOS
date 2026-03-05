# Vibecoding

**Autonomous Software Agency Engine**

An adaptive, event-driven, elastic multi-worker orchestration system that
simulates a professional engineering organization — not a code generator.

Version 9.1.0 | Built on GitHub Copilot Agent Infrastructure

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

```
ReaperOAK (CTO / Elastic Multi-Worker Parallel Orchestrator)
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

**ReaperOAK** is the singular orchestrator. It never writes code. It selects
tickets, assigns workers from elastic pools, drives each ticket through its
lifecycle, reacts to events, and enforces commits. All inter-agent
communication routes through ReaperOAK — there is no direct agent-to-agent
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

An ordered log of all system events. ReaperOAK consumes events and routes
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
2. ReaperOAK evaluates the SDR. Scope expansions require operator approval.
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

---

## Required MCP and Tooling

Vibecoding is built on the Model Context Protocol (MCP) ecosystem. While
core orchestration logic operates with minimal tooling, maximum value is
achieved when connected to the full stack.

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
  ticket-state/            File-based state machine directories (READY..DONE)
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
ReaperOAK launches 5 workers in parallel. One triggers a strategic review.
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
         BE-010 pauses at BACKEND. ReaperOAK routes question.
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

- VS Code with GitHub Copilot (Agent Mode)
- Git configured with commit permissions
- Node.js / Python runtime (for project-specific builds)

### Setup

```bash
# Clone the repository
git clone <repository-url>
cd vibecoding

# Verify agent definitions
ls .github/agents/

# Verify chunk system
ls .github/vibecoding/chunks/

# Check guardian status
cat .github/guardian/STOP_ALL
```

### Configuration

1. **MCP Connections.** Configure required MCP servers in your VS Code
   settings. At minimum: file system, terminal, and Git access.

2. **Worker Pool Sizes.** Pool bounds are defined in the ReaperOAK agent
   definition at `.github/agents/ReaperOAK.agent.md` (Section 7). Adjust
   `minSize` and `maxSize` per role based on your workload profile.

3. **Git Provider.** Ensure Git is configured for the target repository.
  ReaperOAK enforces two-commit protocol per stage with explicit scoped staging.

4. **Optional Integrations.** Connect Stitch MCP for UI design, Playwright
   for E2E testing, Sentry for monitoring, MongoDB for data operations,
   Terraform for infrastructure — each expands the system's operational
   surface.

### Starting the Engine

Invoke ReaperOAK in GitHub Copilot Agent Mode. The boot protocol
(`agents.md`) loads automatically, reads memory bank state, checks the
guardian circuit breaker, and initializes the scheduling loop.

From there, provide a project vision or feature request. ReaperOAK will:

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
