---
name: Ticket System
applyTo: '**'
description: MCP-driven ticket state machine, server-side state management, MCP tool contracts, dependency resolution, ticket lifecycle.
---

# Ticket System

## 1. State = PostgreSQL Record

RULE: Ticket state is determined by the `stage` column in the PostgreSQL `tickets` table.
RULE: The ForgeOS MCP server is the sole authority for ticket state.
RULE: Agents query ticket state exclusively via MCP tools — never the filesystem.
PROHIBITED: Agents reading or writing `.github/ticket-state/` directories for workflow state.
PROHIBITED: Agents reading `.github/tickets/*.json` for workflow state.

Agents retrieve ticket state using MCP tools:

| MCP Tool | Purpose |
|----------|---------|
| `tickets.get` | Retrieve full ticket detail by ID |
| `tickets.list` | List tickets filtered by stage, status, or tags |
| `tickets.next` | Peek at the next available ticket for a given stage |

## 2. SDLC Stages

Tickets traverse a defined subset of stages managed by the MCP server:

```
READY > RESEARCH > PM > ARCHITECT > DevOps > BACKEND > UIDesigner > FRONTEND > QA > SECURITY > CI > DOCS > VALIDATION > DONE
```

| Stage | Description | Owner |
|-------|-------------|-------|
| READY | Dependencies met, eligible for claim | Server (automatic) |
| RESEARCH | Evidence-based research, PoC, analysis | Research Analyst |
| PM | Product management, stakeholder communication | Product Manager |
| ARCHITECT | Architecture design, ADRs, API contracts | Architect |
| DevOps | Infrastructure, deployment, monitoring | DevOps Engineer |
| BACKEND | Server-side implementation, APIs, business logic | Backend |
| UIDesigner | UI/UX design, mockups, prototypes | UIDesigner |
| FRONTEND | UI implementation, components, layouts | Frontend Engineer |
| QA | Test coverage, functional verification | QA Engineer |
| SECURITY | Vulnerability scan, STRIDE, OWASP review | Security Engineer |
| CI | Lint, type checks, complexity analysis | CI Reviewer |
| DOCS | Documentation updates, JSDoc/TSDoc, README | Documentation Specialist |
| VALIDATION | Independent DoD review | Validator |
| DONE | Lifecycle complete | Server (terminal) |

## 3. MCP Tool Contract

RULE: Agents interact with the ticket system exclusively through ForgeOS MCP tools.
RULE: The MCP server enforces all business rules — agents do not enforce lifecycle rules locally.

### Agent MCP Tools

| MCP Tool | Purpose | Caller |
|----------|---------|--------|
| `tickets.next` | Find the next available ticket for a given SDLC stage (peek, not claim) | ForgeOS orchestrator |
| `tickets.claim` | Atomically claim a specific ticket by ID with server-side lock | ForgeOS orchestrator |
| `tickets.complete` | Complete current stage and advance to next stage in the SDLC flow | Subagent (claim owner) |
| `tickets.reject` | Reject a ticket and send it back for rework with reason | QA, Security, Validator, CI |
| `tickets.release` | Release a claim on a ticket | Claim owner or admin |
| `tickets.extend` | Extend the lease on a claimed ticket to prevent expiry | Claim owner |
| `tickets.update` | Update metadata on a claimed ticket (merge via jsonb) | Claim owner |
| `tickets.spawn` | Create a child ticket under an existing parent | TODO agent, Architect |
| `tickets.stats` | Get aggregate system statistics (per-stage counts, claim health) | Any agent (read-only) |
| `tickets.graph` | Return the ticket dependency graph | Any agent (read-only) |
| `tickets.get` | Retrieve full ticket detail by ticket ID | Any agent (read-only) |
| `tickets.list` | List tickets filtered by stage, status, tags, or assignee | Any agent (read-only) |

### Claim Ownership Rules

RULE: Only the ForgeOS orchestrator calls `tickets.next` and `tickets.claim`.
RULE: Subagents receive a pre-claimed ticket — they never call `tickets.claim` themselves.
RULE: Only the claim owner may call `tickets.complete`, `tickets.update`, or `tickets.extend`.
RULE: `tickets.reject` may only be called by post-implementation review agents (QA, Security, Validator, CI).
RULE: `tickets.release` requires claim ownership or admin force-release.

### tickets.py — Human Operator CLI Only

RULE: `tickets.py` is a human operator CLI tool. It is NOT called by agents.
RULE: Location: `.github/tickets.py`

| Command | Purpose | Caller |
|---------|---------|--------|
| `--sync` | Evaluate deps, move unblocked to READY, release expired claims | Human operator |
| `--parse <dir>` | Parse L3 markdown into ticket JSON | Human operator |
| `--status` | Dashboard view of all tickets | Human operator |
| `--status --json` | Machine-readable ticket state | Human operator |
| `--validate` | Full integrity check | Human operator |
| `--release-expired` | Clear all expired claims | Human operator |

PROHIBITED: Any agent executing `tickets.py` or any of its subcommands.
PROHIBITED: Agents using `tickets.py --claim`, `--advance`, `--rework`, or `--release`.

## 4. Dependency Resolution

RULE: Dependency resolution is performed server-side by the ForgeOS MCP server.
RULE: A ticket enters READY only when all `depends_on` tickets reach DONE in PostgreSQL.
RULE: The server evaluates the dependency graph automatically on every state transition.
RULE: No agent computes, evaluates, or reasons about dependency resolution.
RULE: Agents discover available work by calling `tickets.next` — the server returns only unblocked tickets.
PROHIBITED: Agents manually moving tickets to READY.
PROHIBITED: Agents reading dependency fields to determine execution order.

Agents may call `tickets.graph` for read-only visibility into the dependency DAG, but they must not use this information to make scheduling decisions.

## 5. State Transitions via MCP

RULE: All state transitions are atomic operations executed by the MCP server.
RULE: Transitions are validated server-side — invalid transitions are rejected.

| Transition | MCP Tool | Guard |
|------------|----------|-------|
| READY → implementation stage | `tickets.claim` | Atomic claim with server-side lock |
| implementation stage → next stage | `tickets.complete` | Claim owner provides completion evidence |
| Any review stage → REWORK | `tickets.reject` | Reviewer provides rejection reason |
| REWORK → implementation stage | `tickets.claim` (re-claim) | Rework count < 3 |
| REWORK (count ≥ 3) → ESCALATED | Automatic | Server escalates after max reworks |
| VALIDATION → DONE | `tickets.complete` | Validator approves with evidence |

### Completion Evidence

RULE: `tickets.complete` requires structured evidence:

- `artifacts` — list of file paths created or modified
- `test_results` — test outcome summary or justified N/A
- `confidence` — HIGH, MEDIUM, or LOW

### Rejection Evidence

RULE: `tickets.reject` requires a `reason` string explaining the rejection.
RULE: The server increments the rework counter and re-routes the ticket.

## 6. UI Gate

RULE: Frontend tickets require UIDesigner artifacts to exist before implementation begins.
RULE: The MCP server enforces this gate — `tickets.claim` for FRONTEND stage validates UIDesigner artifacts.
RULE: Missing UI artifacts cause the claim to be rejected by the server.
RULE: Backend-only tickets skip this gate.

## 7. Parallelism and Concurrency

RULE: The ForgeOS orchestrator queries `tickets.next` to discover available work.
RULE: `tickets.claim` provides atomic server-side locking via PostgreSQL row-level locks.
RULE: Concurrent claim attempts on the same ticket result in exactly one winner — all others receive an error.
RULE: The MCP server handles all concurrency control — agents and the orchestrator do not compute safe parallel groups.
RULE: File-level mutex in the MCP server prevents concurrent modifications to overlapping file scopes.
PROHIBITED: Agents reasoning about parallelism, file conflicts, or safe batching.
PROHIBITED: Grouping logic or dependency reasoning in the orchestrator dispatch loop.

### Lease Management

RULE: Default lease duration is 30 minutes (configurable per ticket).
RULE: Expired leases are automatically released by the MCP server.
RULE: Agents call `tickets.extend` to extend leases during long-running operations.
RULE: Any operator or the orchestrator may reclaim a ticket after lease expiry.
