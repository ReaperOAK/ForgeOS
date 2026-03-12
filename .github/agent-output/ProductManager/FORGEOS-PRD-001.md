# ForgeOS v1.0 — Product Requirements Document

## Metadata

| Field | Value |
|-------|-------|
| **Document ID** | FORGEOS-PRD-001 |
| **Author** | ProductManager Agent |
| **Date** | 2026-03-05T00:00:00Z |
| **Status** | DRAFT |
| **Upstream Artifacts** | FORGEOS-RESEARCH-001 (Research), L1-distributed-orchestration (TODO) |
| **Confidence** | HIGH (85%) |

---

## 1. Product Vision & Scope

### 1.1 Vision Statement

ForgeOS transforms a file-based AI development orchestration system into a distributed AI software factory. Multiple Ticketer dispatcher agents running on multiple machines coordinate autonomous subagents (Architect, Backend, Frontend, QA, Security, etc.) through a deterministic SDLC pipeline backed by PostgreSQL and exposed via MCP (Model Context Protocol). The result is a self-bootstrapping, multi-machine, fault-tolerant development orchestration platform.

### 1.2 Problem Statement

**Current state:** The existing ForgeOS system uses filesystem directories as a state machine, `git push` as a distributed lock, and static HTML dashboards. This works for single-machine operation but breaks down at scale.

**Evidence of pain:**

| Problem | Impact | Current Workaround | Cost of Inaction |
|---------|--------|-------------------|------------------|
| Single-machine locking via `git push` | Race conditions, lost claims, unfair distribution | Manual retry; operators monitor for conflicts | Cannot scale beyond 1-2 machines reliably |
| No real-time state visibility | Operators must `git pull` + scan filesystem to see status | Run `todo_visual.py --html` periodically | Multi-machine coordination is blind |
| No file-level mutex | Agents can modify overlapping files concurrently | `file_paths` field is advisory only | Merge conflicts corrupt work |
| Zero authentication | Any process can claim any ticket | Trust-based; no audit trail | Security vulnerability; no accountability |
| No webhook integration | No external event ingestion (CI status, PR events) | Manual stage advancement after CI | Broken automation chain |
| Fragile 30-min fixed leases | Long-running tasks risk claim expiry mid-execution | Agents must work within 30-min windows | Artificial time pressure; wasted rework |
| Monolithic CLI (`tickets.py`) | No API boundary; cannot serve multiple consumers | All interactions through Python CLI | Dashboard, agents, and operators all locked to CLI |

### 1.3 Target Users

| Persona | Role | Primary Need | Anti-pattern |
|---------|------|-------------|--------------|
| **Ticketer** (Dispatcher) | Stateless orchestrator scanning for work | Discover available tickets and dispatch the correct subagent efficiently | Must NOT analyze code, compute dependencies, or implement |
| **Subagent** (Worker) | Specialized AI agent (Backend, QA, Security, etc.) | Claim work atomically, execute stage, advance to next | Must NOT cross ticket scope or claim multiple tickets |
| **Human Operator** | Developer running agents on their machine | Monitor multi-machine progress, intervene when needed | Must NOT bypass the SDLC pipeline |
| **System Administrator** | Platform maintainer | Audit agent actions, manage access, configure the system | Must NOT modify ticket state without audit trail |
| **Anti-persona: Direct DB user** | Someone bypassing the API | — | Must be prevented by API-only access patterns |

### 1.4 Scope

**Included in v1.0:**
- MCP server with 10 core tools for ticket operations
- PostgreSQL-backed distributed state machine with transactional locking
- File-level mutex to prevent merge conflicts across machines
- Web dashboard with real-time pipeline visualization (SSE)
- Git webhook state recovery (ghost commit fix)
- API key authentication (per-agent, per-machine)
- Commit message validation (Husky hooks)
- Blast radius validation (pre-commit scope check)
- Agent-runner wrapper for safe git operations
- Self-expanding workflow (`tickets.spawn` for subtask creation)
- Docker Compose development environment
- Migration bridge for dual-mode operation

**Excluded from v1.0 (future consideration):**
- OAuth 2.1 MCP-native auth (spec too immature per Research report — 40% confidence)
- Multi-region PostgreSQL replication
- Kubernetes deployment (Docker Compose is sufficient for v1)
- Slack/email notification integrations (webhook foundation only in v1)
- Custom plugin system for third-party agent types
- Horizontal MCP server scaling (single instance sufficient for 10+ machines)

---

## 2. User Stories

### 2.1 Ticketer (Dispatcher) Stories

#### US-01: Discover Available Work
**As** Ticketer, **I want** to call `tickets.next` with a stage filter **so that** I can discover unblocked tickets ready for a specific agent type.

**INVEST:** Independent (no side effects), Valuable (core dispatch loop), Estimable (single query), Small (one tool call), Testable (returns ticket or empty).

**Acceptance Criteria:**
```gherkin
Given tickets exist in READY stage with type "backend"
  And no other agent has claimed them
When Ticketer calls tickets.next with stage="BACKEND"
Then the system returns the highest-priority unclaimed ticket
  And the ticket has status READY
  And the response includes ticket_id, type, priority, and file_paths

Given all READY tickets are claimed by other agents
When Ticketer calls tickets.next with stage="BACKEND"
Then the system returns an empty result with message "No tickets available"

Given a ticket has an expired lease (lease_expiry < NOW())
When Ticketer calls tickets.next
Then the expired-lease ticket is eligible for return
```

#### US-02: Dispatch Subagent for Ticket
**As** Ticketer, **I want** to view the complete dependency graph via `tickets.graph` **so that** I can understand which tickets are blocked and which are available.

**Acceptance Criteria:**
```gherkin
Given 20 tickets exist with inter-dependencies
When Ticketer calls tickets.graph
Then the system returns a DAG structure with nodes (tickets) and edges (dependencies)
  And each node includes: ticket_id, stage, status, claimed_by
  And blocked tickets are marked with their unmet dependencies
```

#### US-03: Monitor System Health
**As** Ticketer, **I want** to call `tickets.stats` **so that** I can see aggregate system state before dispatching.

**Acceptance Criteria:**
```gherkin
Given tickets exist across multiple stages
When Ticketer calls tickets.stats
Then the system returns counts per stage (READY: N, BACKEND: M, QA: K, ...)
  And active claims count with lease health (healthy, expiring_soon, expired)
  And average time-in-stage per stage
  And rework count distribution
```

### 2.2 Subagent (Worker) Stories

#### US-04: Claim Ticket Atomically
**As** a Backend subagent, **I want** to claim a ticket atomically via `tickets.claim` **so that** no other machine can claim the same work.

**Acceptance Criteria:**
```gherkin
Given ticket FORGEOS-001 is in READY stage and unclaimed
When Backend agent on machine-1 calls tickets.claim with ticket_id="FORGEOS-001"
Then the ticket is locked to machine-1 with a 30-minute lease
  And the response includes lease_expiry timestamp
  And the ticket status changes to CLAIMED

Given ticket FORGEOS-001 is already claimed by machine-2
When Backend agent on machine-1 calls tickets.claim with ticket_id="FORGEOS-001"
Then the system returns error "ALREADY_CLAIMED" with claimant details
  And no state change occurs

Given two agents on different machines simultaneously claim the same ticket
When both calls arrive within the same millisecond
Then exactly one succeeds (SKIP LOCKED guarantees)
  And the other receives "ALREADY_CLAIMED"
  And no deadlock occurs
```

#### US-05: Extend Lease During Long Operations
**As** a subagent performing a long-running task, **I want** to call `tickets.extend` **so that** my lease doesn't expire mid-work.

**Acceptance Criteria:**
```gherkin
Given I have claimed ticket FORGEOS-001 with lease_expiry at T+30min
When I call tickets.extend with ticket_id="FORGEOS-001" and duration=30
Then lease_expiry is updated to NOW() + 30 minutes
  And the extension is logged in the audit trail

Given I try to extend a ticket I haven't claimed
When I call tickets.extend with ticket_id="FORGEOS-002"
Then the system returns error "NOT_CLAIM_OWNER"
```

#### US-06: Complete Stage Work
**As** a subagent, **I want** to call `tickets.complete` with stage evidence **so that** the ticket advances to the next SDLC stage.

**Acceptance Criteria:**
```gherkin
Given I have claimed ticket FORGEOS-001 in BACKEND stage
When I call tickets.complete with evidence={artifacts: [...], tests: "PASS", confidence: "HIGH"}
Then the ticket advances to the next stage (QA) per its SDLC flow
  And my claim is released
  And the stage transition is recorded in history
  And the completion evidence is stored

Given I call tickets.complete without required evidence fields
Then the system returns error "MISSING_EVIDENCE" listing required fields
```

#### US-07: Report Rejection with Evidence
**As** a QA subagent, **I want** to call `tickets.reject` with rejection evidence **so that** the ticket returns to the implementation stage for rework.

**Acceptance Criteria:**
```gherkin
Given ticket FORGEOS-001 is in QA stage and I have claimed it
When I call tickets.reject with reason="test_coverage_below_80%" and evidence={coverage: 62%}
Then the ticket moves to REWORK state
  And rework_count increments by 1
  And the rejection reason and evidence are stored
  And the ticket re-enters at its implementation stage

Given ticket FORGEOS-001 has rework_count >= 3
When I call tickets.reject
Then the ticket moves to ESCALATED state
  And the system emits a notification for human intervention
```

#### US-08: Spawn Subtasks
**As** a subagent discovering additional work during implementation, **I want** to call `tickets.spawn` **so that** subtasks are created and linked to the parent ticket.

**Acceptance Criteria:**
```gherkin
Given I am working on ticket FORGEOS-001
When I call tickets.spawn with parent_id="FORGEOS-001" and subtask details
Then a new ticket is created with depends_on=["FORGEOS-001"] (or as a child)
  And the new ticket starts in READY (if dependencies met) or BLOCKED
  And the parent ticket's metadata includes a reference to the child

Given the subtask definition is missing required fields (title, type, acceptance_criteria)
Then the system returns error "INVALID_SUBTASK" listing missing fields
```

#### US-09: Release a Claim
**As** a subagent that cannot complete its work, **I want** to call `tickets.release` **so that** another agent can claim the ticket.

**Acceptance Criteria:**
```gherkin
Given I have claimed ticket FORGEOS-001
When I call tickets.release with ticket_id="FORGEOS-001" and reason="dependency_unavailable"
Then the ticket returns to READY stage
  And my claim is cleared (claimed_by = NULL, lease_expiry = NULL)
  And the release reason is logged

Given I try to release a ticket I haven't claimed
When I call tickets.release
Then the system returns error "NOT_CLAIM_OWNER"
```

#### US-10: Update Ticket Metadata
**As** a subagent, **I want** to call `tickets.update` **so that** I can attach intermediate progress or modify ticket metadata during my stage.

**Acceptance Criteria:**
```gherkin
Given I have claimed ticket FORGEOS-001
When I call tickets.update with metadata={progress: 75, notes: "API implementation complete, tests pending"}
Then the ticket metadata is updated
  And a history entry is created with the update details
  And the ticket's updated_at timestamp refreshes

Given I try to update a ticket I haven't claimed
Then the system returns error "NOT_CLAIM_OWNER"
```

### 2.3 Human Operator Stories

#### US-11: Monitor Multi-Machine Progress
**As** an operator, **I want** to see a real-time dashboard **so that** I can monitor which tickets are being worked on across all machines.

**Acceptance Criteria:**
```gherkin
Given 3 machines are running agents processing tickets
When I open the ForgeOS dashboard in my browser
Then I see a pipeline view showing tickets per SDLC stage
  And each ticket shows: ID, title, type, claimed_by, machine_id, lease countdown
  And the view updates within 1 second of any state change (SSE)
  And I can filter by stage, type, priority, machine, or agent

Given a ticket's lease is about to expire (< 5 minutes remaining)
Then the dashboard highlights the ticket with a warning indicator
```

#### US-12: View Dependency Graph
**As** an operator, **I want** to see an interactive dependency graph **so that** I can understand ticket relationships and identify blockers.

**Acceptance Criteria:**
```gherkin
Given tickets have inter-dependencies defined in depends_on
When I navigate to the dependency graph view
Then I see a DAG with tickets as nodes and dependencies as edges
  And DONE tickets are green, READY tickets are blue, BLOCKED tickets are red, IN_PROGRESS tickets are yellow
  And I can click a node to see ticket details
  And the critical path is visually highlighted
```

#### US-13: Force-Release Stale Claims
**As** an operator, **I want** to force-release a stale claim from the dashboard **so that** blocked work can be reclaimed.

**Acceptance Criteria:**
```gherkin
Given ticket FORGEOS-001 has an expired lease
When I click "Force Release" on the dashboard
Then the ticket moves back to READY
  And the force-release is logged with my operator identity
  And a confirmation dialog appears before the action executes
```

#### US-14: View Ticket History
**As** an operator, **I want** to see the complete history of a ticket **so that** I can audit what happened and debug issues.

**Acceptance Criteria:**
```gherkin
Given ticket FORGEOS-001 has been through READY → BACKEND → QA → REWORK → BACKEND → QA → SECURITY
When I view the ticket detail page
Then I see a timeline with every state transition, claim, release, and update
  And each entry shows: timestamp, agent, machine, operator, action, evidence
  And rework entries show the rejection reason
```

### 2.4 System Administrator Stories

#### US-15: Manage API Keys
**As** an admin, **I want** to create and revoke API keys for agents and machines **so that** I can control who can interact with the system.

**Acceptance Criteria:**
```gherkin
Given I am authenticated as an admin
When I create a new API key for agent "Backend" on machine "build-server-1"
Then a unique API key is generated and displayed once
  And the key hash is stored in PostgreSQL
  And the key is associated with the agent role and machine ID

When I revoke an API key
Then all future requests with that key receive 401 Unauthorized
  And existing sessions using that key are terminated
  And the revocation is logged
```

#### US-16: Audit Agent Actions
**As** an admin, **I want** to query the audit log **so that** I can see which agents performed what actions and when.

**Acceptance Criteria:**
```gherkin
Given multiple agents have been operating over the past 24 hours
When I query the audit log with filters (agent, machine, action, time_range)
Then I receive a paginated list of all matching actions
  And each entry includes: timestamp, agent_id, machine_id, operator, action, ticket_id, result
  And failed actions (claim conflicts, auth failures) are included
```

#### US-17: Configure Lease Durations
**As** an admin, **I want** to configure default and per-ticket-type lease durations **so that** I can tune the system for different workloads.

**Acceptance Criteria:**
```gherkin
Given I set the default lease duration to 45 minutes
When any agent claims a ticket without specifying duration
Then the lease is set to 45 minutes (not the default 30)

Given I set lease duration for "architecture" tickets to 60 minutes
When an Architect agent claims an architecture ticket
Then the lease is set to 60 minutes
  And other ticket types still use the default
```

#### US-18: Webhook State Recovery
**As** an admin, **I want** the system to reconcile state from Git push webhooks **so that** ghost commits (DB/Git divergence) are automatically fixed.

**Acceptance Criteria:**
```gherkin
Given a CLAIM commit exists in Git but the DB has no matching claim
When a GitHub push webhook fires
Then the system parses the commit message and creates the missing claim in DB
  And the reconciliation is logged

Given the DB shows a ticket as CLAIMED but no matching Git commit exists
  And the lease has expired
When the reconciliation runs
Then the stale claim is released in DB
  And the ticket returns to READY

Given the reconciliation encounters ambiguous state
Then the system logs a warning and does NOT auto-resolve
  And an admin notification is generated
```

#### US-19: Commit Message Validation
**As** an admin, **I want** Husky pre-commit hooks to validate commit message format **so that** only properly formatted commits reach the repository.

**Acceptance Criteria:**
```gherkin
Given a developer attempts to commit with message "fixed stuff"
When the pre-commit hook runs
Then the commit is rejected with error "Commit message must match [TICKET-ID] format"

Given a developer commits with message "[FORGEOS-001] BACKEND complete by Backend on machine-1"
When the pre-commit hook runs
Then the commit is accepted
  And blast radius validation checks that modified files are within FORGEOS-001's file_paths
```

#### US-20: Blast Radius Validation
**As** an admin, **I want** pre-commit hooks to validate that modified files are within the ticket's declared scope **so that** agents cannot modify files outside their assigned ticket.

**Acceptance Criteria:**
```gherkin
Given ticket FORGEOS-001 declares file_paths=["src/mcp/", "src/db/"]
  And an agent has staged files in "src/mcp/server.ts" and "src/dashboard/index.html"
When the pre-commit hook runs
Then the commit is rejected with error "src/dashboard/index.html is outside ticket scope"
  And the list of out-of-scope files is displayed

Given all staged files are within the ticket's declared file_paths
When the pre-commit hook runs
Then the commit is accepted
```

---

## 3. Functional Requirements

### 3.1 MCP Server Core (FR-01 through FR-10)

#### FR-01: MCP Tool — `tickets.next`
**Description:** Returns the next available ticket for a given agent stage, using `SELECT FOR UPDATE SKIP LOCKED` for fair distribution.

| Attribute | Value |
|-----------|-------|
| **Input** | `stage` (string, required), `type` (string, optional filter), `priority` (string, optional filter) |
| **Output** | Ticket object or null |
| **Locking** | Row-level lock with `SKIP LOCKED` (no blocking) |
| **Idempotency** | Safe to call repeatedly (read-only until claim) |
| **Auth** | Requires valid API key with matching stage permission |

#### FR-02: MCP Tool — `tickets.claim`
**Description:** Atomically claims a specific ticket by ID, setting `claimed_by`, `machine_id`, `operator`, and `lease_expiry`.

| Attribute | Value |
|-----------|-------|
| **Input** | `ticket_id` (string), `agent_name` (string), `machine_id` (string), `operator` (string, optional) |
| **Output** | Claimed ticket object with lease_expiry, or error |
| **Locking** | `FOR UPDATE SKIP LOCKED` — atomic claim-or-fail |
| **Lease** | Default 30 minutes, configurable per ticket type |
| **Constraint** | Ticket must be in READY or have expired lease |
| **Auth** | Agent must have permission for the ticket's current stage |

#### FR-03: MCP Tool — `tickets.update`
**Description:** Updates metadata on a claimed ticket (progress, notes, intermediate state).

| Attribute | Value |
|-----------|-------|
| **Input** | `ticket_id` (string), `metadata` (object: progress, notes, custom fields) |
| **Output** | Updated ticket object |
| **Constraint** | Caller must be current claim owner |
| **Audit** | Every update creates a history entry |

#### FR-04: MCP Tool — `tickets.complete`
**Description:** Marks a ticket's current stage as complete, provides evidence, and advances to the next SDLC stage.

| Attribute | Value |
|-----------|-------|
| **Input** | `ticket_id` (string), `evidence` (object: artifacts, test_results, confidence) |
| **Output** | Advanced ticket object with new stage |
| **Constraint** | Caller must be claim owner; evidence must include required fields |
| **Side effect** | Releases claim, advances stage per SDLC flow, triggers dependency re-evaluation |

#### FR-05: MCP Tool — `tickets.reject`
**Description:** Rejects a ticket during a review stage (QA, Security, Validation), sending it back for rework.

| Attribute | Value |
|-----------|-------|
| **Input** | `ticket_id` (string), `reason` (string), `evidence` (object) |
| **Output** | Reworked ticket object or ESCALATED status |
| **Constraint** | `rework_count < 3` — otherwise ticket moves to ESCALATED |
| **Side effect** | Increments `rework_count`, stores rejection evidence, returns to implementation stage |

#### FR-06: MCP Tool — `tickets.spawn`
**Description:** Creates a child ticket linked to the current ticket, enabling self-expanding workflows.

| Attribute | Value |
|-----------|-------|
| **Input** | `parent_id` (string), `title` (string), `type` (string), `priority` (string), `acceptance_criteria` (array), `file_paths` (array) |
| **Output** | Created child ticket object |
| **Constraint** | Parent must exist; child inherits project context; `depends_on` links to parent |
| **Validation** | Title, type, and at least one acceptance criterion required |

#### FR-07: MCP Tool — `tickets.graph`
**Description:** Returns the full ticket dependency DAG for visualization and analysis.

| Attribute | Value |
|-----------|-------|
| **Input** | `filter` (optional: stage, type, status) |
| **Output** | DAG structure: `{ nodes: Ticket[], edges: {from, to}[] }` |
| **Performance** | Must return within 500ms for up to 500 tickets |

#### FR-08: MCP Tool — `tickets.release`
**Description:** Releases a claim on a ticket, returning it to READY.

| Attribute | Value |
|-----------|-------|
| **Input** | `ticket_id` (string), `reason` (string, optional) |
| **Output** | Released ticket object |
| **Constraint** | Caller must be claim owner OR admin (force-release) |
| **Side effect** | Clears `claimed_by`, `machine_id`, `lease_expiry`; logs release event |

#### FR-09: MCP Tool — `tickets.extend`
**Description:** Extends the lease on a claimed ticket to prevent expiry during long operations.

| Attribute | Value |
|-----------|-------|
| **Input** | `ticket_id` (string), `duration_minutes` (integer, default 30) |
| **Output** | Updated ticket with new `lease_expiry` |
| **Constraint** | Caller must be claim owner; max extension is configurable (default 120 min) |

#### FR-10: MCP Tool — `tickets.stats`
**Description:** Returns aggregate system statistics for dispatcher decision-making.

| Attribute | Value |
|-----------|-------|
| **Input** | None (or optional time_range filter) |
| **Output** | `{ stages: {stage: count}, claims: {healthy, expiring, expired}, avg_stage_duration: {}, rework_distribution: {} }` |
| **Caching** | May cache for up to 5 seconds |

### 3.2 Database Layer (FR-11 through FR-16)

#### FR-11: PostgreSQL Schema
**Description:** Relational schema replacing filesystem state directories.

**Core tables:**
- `tickets` — ticket metadata, current stage, claim state, file_paths (JSONB), depends_on (JSONB)
- `ticket_history` — append-only event log (stage transitions, claims, releases, updates)
- `agents` — registered agent identities, API key hashes, roles, permissions
- `machines` — registered machine identities
- `file_locks` — file-level mutex tracking (path, locking_ticket_id, locked_at)
- `system_config` — configurable settings (lease durations, rate limits)

**Indexes:**
- `tickets`: unique on `ticket_id`; composite on `(stage, claimed_by)`; GIN on `depends_on`; GIN on `file_paths`
- `ticket_history`: composite on `(ticket_id, created_at)` for timeline queries
- `file_locks`: unique on `file_path` for mutex enforcement

#### FR-12: Distributed Locking
**Description:** `SELECT FOR UPDATE SKIP LOCKED` for ticket claiming with lease-based expiry.

**Requirements:**
- Row-level lock acquisition must complete within 100ms at p99
- `SKIP LOCKED` ensures non-blocking behavior under contention
- Lease expiry (default 30 min) makes abandoned claims reclaimable
- Expired lease cleanup runs periodically (every 60 seconds) or on-demand via `tickets.next`

#### FR-13: File-Level Mutex
**Description:** Advisory lock system preventing concurrent modifications to the same files across tickets.

**Requirements:**
- When a ticket is claimed, all files in its `file_paths` are locked in `file_locks` table
- Before claiming, check for file conflicts: if any file in `file_paths` is locked by another active ticket, deny the claim
- File locks are released when the ticket's claim is released or when the ticket advances
- Use `pg_advisory_xact_lock` keyed on file path hash for transactional enforcement

#### FR-14: Event Sourcing
**Description:** Every state change is recorded as an immutable event in `ticket_history`.

**Event types:** `CREATED`, `CLAIMED`, `RELEASED`, `STAGE_ADVANCED`, `STAGE_REJECTED`, `UPDATED`, `SPAWNED`, `ESCALATED`, `LEASE_EXTENDED`, `FORCE_RELEASED`, `RECONCILED`

**Each event includes:** `event_id`, `ticket_id`, `event_type`, `agent_id`, `machine_id`, `operator`, `timestamp`, `payload` (JSONB), `previous_state`, `new_state`

#### FR-15: Schema Migrations
**Description:** Versioned, reversible database migrations.

**Requirements:**
- Use a migration framework (e.g., node-pg-migrate, dbmate, or knex migrations)
- Migrations must be idempotent
- Rollback capability for every migration
- Migration status tracked in a `schema_migrations` table
- CI pipeline validates migrations apply cleanly to a fresh database

#### FR-16: Data Import
**Description:** Seed PostgreSQL from existing `.github/tickets/*.json` and `.github/ticket-state/` directories.

**Requirements:**
- Parse all existing ticket JSON files
- Map directory location to current stage
- Preserve ticket history (from JSON `history` array)
- Validate imported data against schema
- Report import summary (success count, error count, skipped count)
- Idempotent — re-running import doesn't create duplicates

### 3.3 Authentication & Authorization (FR-17 through FR-21)

#### FR-17: API Key Authentication
**Description:** Per-agent, per-machine API keys for MCP server access (recommended by Research report for v1).

**Requirements:**
- API keys are SHA-256 hashed before storage
- Keys transmitted via `Authorization: Bearer <key>` header
- Each key is associated with: agent_role, machine_id, permissions, created_at, revoked_at
- Key creation returns the plaintext key exactly once
- Key validation latency < 5ms (indexed lookup on hash)

#### FR-18: Role-Based Authorization
**Description:** Agents can only perform actions matching their SDLC stage ownership.

**Permission matrix:**

| Role | tickets.next | tickets.claim | tickets.complete | tickets.reject | tickets.spawn | tickets.release | tickets.extend | tickets.stats | tickets.graph | Force operations |
|------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Backend | BACKEND only | BACKEND only | Yes | No | Yes | Own claims | Own claims | Yes | Yes | No |
| QA | QA only | QA only | Yes | Yes | No | Own claims | Own claims | Yes | Yes | No |
| Security | SECURITY only | SECURITY only | Yes | Yes | No | Own claims | Own claims | Yes | Yes | No |
| Frontend | FRONTEND only | FRONTEND only | Yes | No | Yes | Own claims | Own claims | Yes | Yes | No |
| Architect | ARCHITECT only | ARCHITECT only | Yes | No | Yes | Own claims | Own claims | Yes | Yes | No |
| Ticketer | All stages | No | No | No | No | No | No | Yes | Yes | No |
| Admin | All | All | All | All | All | All | All | Yes | Yes | Yes |

#### FR-19: Machine Registration
**Description:** Machines must be pre-registered before agents on them can interact with the system.

**Requirements:**
- Machine registration creates an entry with `machine_id`, `hostname`, `registered_at`, `last_seen`
- Heartbeat updates `last_seen` on every API call
- Stale machines (no activity for 24 hours) are flagged but not auto-removed

#### FR-20: Audit Logging
**Description:** All authenticated operations are logged for accountability.

**Requirements:**
- Every MCP tool call logged with: timestamp, agent_id, machine_id, tool_name, input_params (sanitized), result_status, duration_ms
- Log storage in `ticket_history` (for ticket operations) and a separate `audit_log` table (for auth events)
- Retention: 90 days minimum
- Queryable by: agent, machine, time range, action type

#### FR-21: Rate Limiting
**Description:** Per-identity rate limiting to prevent abuse or runaway agents.

**Requirements:**
- Default: 100 requests/minute per API key
- Configurable per agent role
- Rate limit headers in response: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- Exceeded limit returns `429 Too Many Requests`

### 3.4 Web Dashboard (FR-22 through FR-27)

#### FR-22: Pipeline Board View
**Description:** Kanban-style board showing tickets grouped by SDLC stage.

**Requirements:**
- Columns for each active stage (READY, BACKEND, FRONTEND, QA, SECURITY, CI, DOCS, VALIDATION)
- Ticket cards show: ID, title, type badge, priority indicator, claimed_by, lease countdown
- Cards are color-coded by status: unclaimed (blue), claimed (yellow), expiring (orange), expired (red)
- Real-time updates via SSE (< 1 second latency)
- Column counts update live

#### FR-23: Dependency Graph View
**Description:** Interactive DAG visualization of ticket dependencies.

**Requirements:**
- D3.js force-directed or DAG layout (per Research report recommendation)
- Nodes sized by ticket priority
- Edge direction shows dependency flow
- Click node to view ticket detail panel
- Critical path highlighted
- Zoom, pan, and search capabilities

#### FR-24: Ticket Detail Panel
**Description:** Detailed view of a single ticket with full history timeline.

**Requirements:**
- All ticket metadata displayed
- History timeline with every state transition
- Evidence attachments viewable
- Rework history with rejection reasons
- File paths list with lock status indicators
- Operator actions: Force Release, Force Advance (admin only, with confirmation dialog)

#### FR-25: Machine Status View
**Description:** Overview of all registered machines and their current activity.

**Requirements:**
- List of machines with: hostname, last_seen, active_claims count, agent_roles running
- Machine health indicator (active / stale / offline)
- Drill-down to see which tickets are claimed on each machine

#### FR-26: System Health Panel
**Description:** Operational health metrics.

**Requirements:**
- Database connection pool status (active, idle, waiting)
- MCP server uptime and request rate
- Webhook delivery success rate
- Expired lease count
- Average claim-to-completion time per stage

#### FR-27: No Frontend Build Step
**Description:** Dashboard served as static HTML + vanilla JS + D3.js (per Research report recommendation).

**Requirements:**
- No React, Vue, or other framework
- No npm/webpack/vite frontend build pipeline
- Single HTML file or small set of static files served by the MCP server's Express instance
- D3.js loaded via CDN or bundled as single file
- CSS inline or in a single stylesheet

### 3.5 Git Integration (FR-28 through FR-32)

#### FR-28: Webhook Receiver
**Description:** HTTP endpoint accepting GitHub push webhooks for state reconciliation.

**Requirements:**
- Endpoint: `POST /api/webhooks/github`
- HMAC-SHA256 signature verification using `WEBHOOK_SECRET`
- Parse push event payload to extract commit messages
- Use `@octokit/webhooks` for type-safe handling (per Research report)

#### FR-29: Commit Message Parsing
**Description:** Extract ticket ID, agent, machine, and stage from structured commit messages.

**Patterns:**
- CLAIM: `[TICKET-ID] CLAIM by AGENT on MACHINE (OPERATOR)`
- WORK: `[TICKET-ID] STAGE complete by AGENT on MACHINE`

**Requirements:**
- Regex parsing with named capture groups
- Unrecognized formats logged as warnings (not errors)
- Parsed data returned as structured objects

#### FR-30: Ghost Commit Recovery
**Description:** Reconcile DB state with Git state when divergence is detected.

**Reconciliation rules:**
1. Git has CLAIM commit, DB has no claim → Create claim in DB (Git is truth for commits)
2. Git has WORK complete, DB shows CLAIMED → Advance ticket in DB
3. DB has claim, no Git commit, lease expired → Release claim in DB
4. Ambiguous state → Log warning, flag for admin review, do NOT auto-resolve

**Requirements:**
- All reconciliation operations are idempotent (`ON CONFLICT DO UPDATE`)
- Reconciliation logged as `RECONCILED` events in ticket_history
- Periodic reconciliation sweep (configurable interval, default 5 minutes)

#### FR-31: Husky Pre-Commit Hooks
**Description:** Client-side Git hooks validating commit messages and blast radius.

**Requirements:**
- `commit-msg` hook: Validate message matches `[TICKET-ID] ...` pattern
- `pre-commit` hook: Validate staged files are within the ticket's `file_paths` scope
- Hooks installed via Husky (npm package)
- `.husky/` directory committed to repository
- Bypass available for emergency commits: `git commit --no-verify` (logged as warning)

#### FR-32: Agent Runner Wrapper
**Description:** Updated `agent-runner.py` that uses MCP for claim/advance while retaining Git for code commits.

**Requirements:**
- Phase 1: Replace `tickets.py --claim` with `tickets.claim` MCP call
- Phase 2: Replace `tickets.py --advance` with `tickets.complete` MCP call
- Retain two-commit protocol for code changes (Git is the code store)
- Fallback to filesystem operations if MCP server is unreachable
- Configuration: `FORGEOS_MCP_URL`, `FORGEOS_API_KEY` environment variables

### 3.6 Infrastructure (FR-33 through FR-36)

#### FR-33: Docker Compose Development Environment
**Description:** Single-command startup for the complete ForgeOS development stack.

**Services:**
- `postgres` — PostgreSQL 17 Alpine with healthcheck, persistent volume, init scripts
- `pgbouncer` — Connection pooler in transaction mode (for production parity)
- `mcp-server` — ForgeOS MCP server (Node.js/TypeScript)
- `dashboard` — Served by MCP server (same Express instance)

**Requirements:**
- `docker compose up` starts everything
- PostgreSQL healthcheck gates MCP server startup
- Persistent volume for PostgreSQL data
- `.env.example` template with all required variables
- Secrets via Docker secrets (not environment variables for passwords)

#### FR-34: Database Initialization
**Description:** Automatic schema setup on first run.

**Requirements:**
- SQL init scripts in `db/init/` directory, mounted to PostgreSQL's `docker-entrypoint-initdb.d`
- Schema creation is idempotent (IF NOT EXISTS)
- Seed data includes default admin API key and system configuration
- Migration runner available as CLI command

#### FR-35: Health Checks
**Description:** Container and application health monitoring.

**Requirements:**
- PostgreSQL: `pg_isready` healthcheck
- MCP server: `GET /health` endpoint returning `{ status: "ok", db: "connected", uptime: N }`
- PgBouncer: connection test query
- Docker Compose `depends_on` with `condition: service_healthy`

#### FR-36: Backup and Recovery
**Description:** PostgreSQL backup strategy.

**Requirements:**
- `pg_dump` script for on-demand backup
- Backup to local file with timestamp naming
- Restore procedure documented
- Database export to ticket JSON (reverse migration) for filesystem fallback

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target | Measurement Method |
|--------|--------|-------------------|
| Claim latency (p50) | < 50ms | Instrument `tickets.claim` handler |
| Claim latency (p95) | < 80ms | PostgreSQL query timing |
| Claim latency (p99) | < 100ms | PostgreSQL query timing |
| Dashboard SSE update latency | < 1 second | Client-side timestamp delta |
| `tickets.next` query time | < 50ms | PostgreSQL EXPLAIN ANALYZE |
| `tickets.graph` response time | < 500ms (up to 500 tickets) | End-to-end API timing |
| `tickets.stats` response time | < 200ms | End-to-end API timing |
| Webhook processing time | < 500ms per event | Handler duration logging |

### 4.2 Scalability

| Metric | Target | Justification |
|--------|--------|---------------|
| Concurrent machines | 10+ | Design target per delegation packet |
| Concurrent agents per machine | 5+ | Multiple agent types per operator |
| Total concurrent claims | 50+ | 10 machines × 5 agents |
| Ticket capacity | 10,000+ | Lifetime of a large project |
| SSE connections | 50+ | Operators + dashboards |

### 4.3 Reliability

| Metric | Target | Mechanism |
|--------|--------|-----------|
| Data durability | Zero ticket state loss on agent crash | PostgreSQL ACID + webhook recovery |
| Claim correctness | Exactly-once claim per ticket | `FOR UPDATE SKIP LOCKED` |
| Lease recovery | Stale claims reclaimable within 1 minute of expiry | Periodic cleanup + on-demand check |
| Webhook idempotency | Safe to replay any webhook event | `ON CONFLICT DO UPDATE` / idempotency keys |
| System availability | 99.9% during business hours | Docker restart policies + healthchecks |

### 4.4 Security

| Requirement | Target | Mechanism |
|-------------|--------|-----------|
| Authentication | All API calls authenticated | API key validation middleware |
| Authorization | Stage-scoped agent permissions | Role-based access control (FR-18) |
| Secrets | Zero hardcoded secrets | Environment variables + Docker secrets |
| Audit trail | All operations logged | Event sourcing (FR-14) + audit log (FR-20) |
| Input validation | All inputs validated | Zod schema validation on MCP tools |
| SQL injection | Zero risk | Parameterized queries only |
| HMAC verification | Webhook payloads verified | `@octokit/webhooks` built-in verification |
| API key storage | Hashed, never plaintext | SHA-256 hash stored in DB |

### 4.5 Maintainability

| Requirement | Target | Mechanism |
|-------------|--------|-----------|
| Code coverage | ≥ 80% for new code | Jest/Vitest test suite |
| Type safety | 100% TypeScript strict mode | `tsconfig.json` with `strict: true` |
| Linting | Zero errors, zero warnings | ESLint with flat config |
| Documentation | JSDoc/TSDoc on all public APIs | Documentation stage in SDLC |
| Migration reversibility | Every migration has a rollback | Migration framework requirement |

### 4.6 Accessibility (Dashboard)

| Requirement | Target |
|-------------|--------|
| WCAG compliance | WCAG 2.2 AA |
| Keyboard navigation | All interactive elements focusable and operable |
| Screen reader | ARIA labels on all controls and graph elements |
| Color contrast | Minimum 4.5:1 ratio |
| Motion | Respect `prefers-reduced-motion` for graph animations |

---

## 5. Task Specifications (for TODO Agent Decomposition)

### TASK-01: MCP Server Scaffold

| Field | Value |
|-------|-------|
| **Title** | MCP Server Scaffold and Transport Setup |
| **Description** | Initialize the ForgeOS MCP server using `@modelcontextprotocol/server` with Streamable HTTP transport via Express. Register health endpoint, configure session management, and set up structured logging. |
| **Type** | backend |
| **Priority** | critical |
| **Acceptance Criteria** | 1. MCP server starts and accepts connections on port 3000. 2. Health endpoint returns `{status: "ok"}`. 3. Session management with `mcp-session-id` header works. 4. Structured JSON logging with correlation IDs. 5. Graceful shutdown drains in-flight requests. |
| **File Paths** | `src/mcp/server.ts`, `src/mcp/transport.ts`, `src/mcp/health.ts`, `src/logging/logger.ts`, `src/index.ts` |
| **Dependencies** | TASK-03 (Database must be available for health check) |

### TASK-02: PostgreSQL Schema Design and Migrations

| Field | Value |
|-------|-------|
| **Title** | PostgreSQL Schema Design and Migration Framework |
| **Description** | Design and implement the PostgreSQL schema for tickets, ticket_history, agents, machines, file_locks, and system_config. Set up a migration framework with idempotent up/down migrations. |
| **Type** | backend |
| **Priority** | critical |
| **Acceptance Criteria** | 1. All tables created with proper indexes (GIN on JSONB, composite on stage+claimed_by). 2. Migration framework runs up/down migrations. 3. Migrations are idempotent. 4. Schema matches FR-11 specification. 5. `schema_migrations` table tracks applied migrations. |
| **File Paths** | `db/migrations/`, `db/schema.sql`, `src/db/connection.ts`, `src/db/migrate.ts` |
| **Dependencies** | TASK-03 (PostgreSQL container) |

### TASK-03: Docker Compose Infrastructure

| Field | Value |
|-------|-------|
| **Title** | Docker Compose Development Environment |
| **Description** | Create Docker Compose configuration with PostgreSQL 17, PgBouncer, and MCP server services. Include healthchecks, persistent volumes, init scripts, and secrets management. |
| **Type** | infra |
| **Priority** | critical |
| **Acceptance Criteria** | 1. `docker compose up` starts all services. 2. PostgreSQL healthcheck passes before MCP server starts. 3. Persistent volume preserves data across restarts. 4. `.env.example` documents all required variables. 5. Secrets use Docker secrets (not env vars for passwords). |
| **File Paths** | `docker-compose.yml`, `.env.example`, `Dockerfile`, `db/init/`, `.dockerignore` |
| **Dependencies** | None |

### TASK-04: Distributed Locking Implementation

| Field | Value |
|-------|-------|
| **Title** | SELECT FOR UPDATE SKIP LOCKED Ticket Claiming |
| **Description** | Implement the distributed locking layer for ticket claiming using PostgreSQL's `SELECT FOR UPDATE SKIP LOCKED`. Include lease-based expiry, automatic stale claim cleanup, and file-level mutex. |
| **Type** | backend |
| **Priority** | critical |
| **Acceptance Criteria** | 1. `claimTicket()` uses `SELECT FOR UPDATE SKIP LOCKED` atomically. 2. Concurrent claims from different machines never double-assign. 3. Expired leases make tickets reclaimable. 4. File-level mutex prevents overlapping `file_paths` claims. 5. Claim latency < 100ms at p99. 6. Integration test with 10 concurrent claimants. |
| **File Paths** | `src/db/locking.ts`, `src/db/file-mutex.ts`, `src/db/lease.ts` |
| **Dependencies** | TASK-02 (Schema), TASK-03 (PostgreSQL) |

### TASK-05: MCP Tool Registration — Core Operations

| Field | Value |
|-------|-------|
| **Title** | Register Core MCP Tools (next, claim, complete, reject, release) |
| **Description** | Register the 5 primary ticket operation tools on the MCP server with Zod schema validation, connecting to the PostgreSQL locking layer. |
| **Type** | backend |
| **Priority** | critical |
| **Acceptance Criteria** | 1. `tickets.next` returns highest-priority unclaimed ticket for a stage. 2. `tickets.claim` atomically claims a ticket. 3. `tickets.complete` advances to next SDLC stage with evidence. 4. `tickets.reject` sends ticket to rework (max 3). 5. `tickets.release` returns ticket to READY. 6. All tools validate input via Zod schemas. 7. All tools return structured JSON responses. |
| **File Paths** | `src/mcp/tools/next.ts`, `src/mcp/tools/claim.ts`, `src/mcp/tools/complete.ts`, `src/mcp/tools/reject.ts`, `src/mcp/tools/release.ts`, `src/mcp/tools/index.ts` |
| **Dependencies** | TASK-01 (MCP server), TASK-04 (Locking layer) |

### TASK-06: MCP Tool Registration — Extended Operations

| Field | Value |
|-------|-------|
| **Title** | Register Extended MCP Tools (update, spawn, graph, extend, stats) |
| **Description** | Register the 5 additional ticket operation tools on the MCP server. |
| **Type** | backend |
| **Priority** | high |
| **Acceptance Criteria** | 1. `tickets.update` modifies metadata on claimed ticket. 2. `tickets.spawn` creates linked child tickets. 3. `tickets.graph` returns dependency DAG within 500ms. 4. `tickets.extend` extends lease duration. 5. `tickets.stats` returns aggregate metrics. 6. All tools validate input via Zod schemas. |
| **File Paths** | `src/mcp/tools/update.ts`, `src/mcp/tools/spawn.ts`, `src/mcp/tools/graph.ts`, `src/mcp/tools/extend.ts`, `src/mcp/tools/stats.ts` |
| **Dependencies** | TASK-05 (Core tools establish patterns) |

### TASK-07: API Key Authentication

| Field | Value |
|-------|-------|
| **Title** | API Key Authentication and Role-Based Authorization |
| **Description** | Implement API key validation middleware, role-based permission enforcement, and agent/machine registration. |
| **Type** | backend |
| **Priority** | high |
| **Acceptance Criteria** | 1. API keys validated via SHA-256 hash lookup (< 5ms). 2. Role-based permissions enforced per FR-18 matrix. 3. Agents can only claim tickets matching their stage ownership. 4. Admin role can perform force operations. 5. Invalid/revoked keys return 401. 6. Key creation endpoint returns plaintext key once. |
| **File Paths** | `src/auth/middleware.ts`, `src/auth/keys.ts`, `src/auth/roles.ts`, `src/auth/types.ts` |
| **Dependencies** | TASK-01 (MCP server), TASK-02 (agents table in schema) |

### TASK-08: SDLC Stage Engine

| Field | Value |
|-------|-------|
| **Title** | SDLC Stage Transition Engine |
| **Description** | Implement the stage transition logic that enforces SDLC flows per ticket type, including the updated flow with RESEARCH, ARCHITECT, PRODUCT_MANAGER, and UI_DESIGN stages. |
| **Type** | backend |
| **Priority** | high |
| **Acceptance Criteria** | 1. Each ticket type has a defined stage flow (see Section 6). 2. `getNextStage()` returns the correct next stage. 3. Stage transitions are validated — skipping is rejected. 4. Rework returns to the correct implementation stage. 5. ESCALATED state is terminal at rework_count >= 3. 6. Skip rules correctly applied per ticket type. |
| **File Paths** | `src/sdlc/flows.ts`, `src/sdlc/transitions.ts`, `src/sdlc/types.ts` |
| **Dependencies** | TASK-02 (Schema with stage column) |

### TASK-09: Webhook Receiver and State Reconciliation

| Field | Value |
|-------|-------|
| **Title** | GitHub Webhook Receiver and Ghost Commit Recovery |
| **Description** | Implement the webhook endpoint for GitHub push events, commit message parsing, and DB/Git state reconciliation. |
| **Type** | backend |
| **Priority** | high |
| **Acceptance Criteria** | 1. `POST /api/webhooks/github` accepts push events. 2. HMAC-SHA256 signature verification passes. 3. CLAIM and WORK commit messages parsed correctly. 4. Ghost commit recovery reconciles DB with Git state. 5. All reconciliation operations are idempotent. 6. Reconciliation events logged in ticket_history. |
| **File Paths** | `src/webhooks/github.ts`, `src/webhooks/parser.ts`, `src/webhooks/reconciliation.ts` |
| **Dependencies** | TASK-02 (Schema), TASK-04 (Locking layer) |

### TASK-10: REST API Endpoints

| Field | Value |
|-------|-------|
| **Title** | REST API for Dashboard and External Integrations |
| **Description** | Implement REST endpoints for ticket listing, detail, history, stage overview, and SSE event stream. |
| **Type** | backend |
| **Priority** | high |
| **Acceptance Criteria** | 1. `GET /api/tickets` returns paginated, filterable ticket list. 2. `GET /api/tickets/:id` returns full ticket detail. 3. `GET /api/tickets/:id/history` returns event timeline. 4. `GET /api/stages` returns stage pipeline overview. 5. `GET /api/events` provides SSE stream with < 1s latency. 6. All endpoints require authentication. |
| **File Paths** | `src/api/routes/tickets.ts`, `src/api/routes/stages.ts`, `src/api/routes/events.ts`, `src/api/middleware/`, `src/api/index.ts` |
| **Dependencies** | TASK-01 (Express server), TASK-07 (Auth middleware) |

### TASK-11: Web Dashboard — Pipeline Board

| Field | Value |
|-------|-------|
| **Title** | Real-Time Pipeline Board Dashboard |
| **Description** | Build the Kanban-style pipeline board with real-time SSE updates, using vanilla HTML + CSS + D3.js. No frontend framework. |
| **Type** | frontend |
| **Priority** | high |
| **Acceptance Criteria** | 1. Pipeline board shows tickets grouped by SDLC stage. 2. Ticket cards display: ID, title, type, priority, claimed_by, lease countdown. 3. Cards color-coded by status. 4. Real-time updates via SSE (< 1s latency). 5. Filtering by stage, type, priority, machine, agent. 6. No frontend build step required. 7. Responsive layout (desktop-first). |
| **File Paths** | `public/index.html`, `public/css/dashboard.css`, `public/js/pipeline.js`, `public/js/sse-client.js` |
| **Dependencies** | TASK-10 (REST API + SSE endpoint) |

### TASK-12: Web Dashboard — Dependency Graph

| Field | Value |
|-------|-------|
| **Title** | Interactive Dependency Graph Visualization |
| **Description** | Build the D3.js-powered dependency graph view with interactive nodes, zoom/pan, and critical path highlighting. |
| **Type** | frontend |
| **Priority** | medium |
| **Acceptance Criteria** | 1. DAG rendered with D3.js force-directed or dagre layout. 2. Nodes colored by ticket status (DONE=green, READY=blue, BLOCKED=red, IN_PROGRESS=yellow). 3. Click node to view ticket detail. 4. Critical path visually highlighted. 5. Zoom, pan, and search functionality. 6. Updates in real-time via SSE. |
| **File Paths** | `public/js/graph.js`, `public/js/d3-helpers.js` |
| **Dependencies** | TASK-11 (Dashboard scaffold), TASK-06 (`tickets.graph` tool) |

### TASK-13: Husky Pre-Commit Hooks

| Field | Value |
|-------|-------|
| **Title** | Commit Message and Blast Radius Validation Hooks |
| **Description** | Install Husky and implement pre-commit hooks for commit message format validation and blast radius checking. |
| **Type** | infra |
| **Priority** | medium |
| **Acceptance Criteria** | 1. Husky installed and hooks committed to `.husky/`. 2. `commit-msg` hook validates `[TICKET-ID]` prefix. 3. `pre-commit` hook validates staged files against ticket's `file_paths`. 4. Invalid commits rejected with clear error messages. 5. `--no-verify` bypass available for emergencies. |
| **File Paths** | `.husky/commit-msg`, `.husky/pre-commit`, `scripts/validate-commit.ts`, `scripts/validate-scope.ts` |
| **Dependencies** | TASK-02 (Schema defines file_paths) |

### TASK-14: Data Import and Seeding

| Field | Value |
|-------|-------|
| **Title** | Import Existing Tickets from Filesystem to PostgreSQL |
| **Description** | Build an import tool that reads `.github/tickets/*.json` and `.github/ticket-state/` directories and seeds the PostgreSQL database. |
| **Type** | backend |
| **Priority** | medium |
| **Acceptance Criteria** | 1. All existing ticket JSON files parsed and imported. 2. Stage derived from directory location. 3. History preserved from JSON `history` array. 4. Import is idempotent (no duplicates on re-run). 5. Summary report: success/error/skipped counts. 6. Data validates against schema. |
| **File Paths** | `src/db/import.ts`, `src/db/seed.ts`, `scripts/import-tickets.ts` |
| **Dependencies** | TASK-02 (Schema), TASK-03 (PostgreSQL running) |

### TASK-15: Migration Bridge (Dual-Mode)

| Field | Value |
|-------|-------|
| **Title** | Dual-Mode Operation Bridge (Filesystem + PostgreSQL) |
| **Description** | Enable simultaneous operation of filesystem-based and PostgreSQL-based state management with feature flags for gradual cutover. |
| **Type** | backend |
| **Priority** | medium |
| **Acceptance Criteria** | 1. Feature flag toggles between filesystem-only, dual-mode, and DB-only. 2. Dual-mode writes to both PostgreSQL and filesystem. 3. Shadow mode compares results and logs divergences. 4. Rollback to filesystem-only works without data loss. 5. Agent SDK falls back to filesystem if MCP is unreachable. |
| **File Paths** | `src/migration/bridge.ts`, `src/migration/sync.ts`, `src/migration/flags.ts`, `src/migration/rollback.ts` |
| **Dependencies** | TASK-14 (Data import), TASK-05 (Core MCP tools), TASK-08 (Stage engine) |

### TASK-16: Agent Client SDK

| Field | Value |
|-------|-------|
| **Title** | Agent Client Library for MCP Interaction |
| **Description** | Build a client SDK that agents use to interact with the MCP server, replacing filesystem-based operations. Includes automatic lease heartbeat and filesystem fallback. |
| **Type** | backend |
| **Priority** | medium |
| **Acceptance Criteria** | 1. `claim()`, `advance()`, `rework()`, `release()`, `heartbeat()` methods work. 2. Automatic lease heartbeat in background. 3. Filesystem fallback when MCP server unreachable. 4. Configuration via environment variables. 5. Structured error handling for claim conflicts and lease expiry. |
| **File Paths** | `src/sdk/client.ts`, `src/sdk/heartbeat.ts`, `src/sdk/fallback.ts`, `src/sdk/config.ts` |
| **Dependencies** | TASK-05 (Core MCP tools), TASK-07 (Auth) |

### TASK-17: Event Sourcing and Audit Trail

| Field | Value |
|-------|-------|
| **Title** | Event Sourcing for Ticket History and Audit Logging |
| **Description** | Implement the event sourcing layer that records every state change as an immutable event, plus a separate audit log for authentication events. |
| **Type** | backend |
| **Priority** | medium |
| **Acceptance Criteria** | 1. Every ticket state change creates a `ticket_history` entry. 2. Event types match FR-14 specification. 3. Events include previous_state and new_state. 4. Audit log captures auth events (login, key creation, revocation). 5. Events queryable by ticket_id, event_type, time_range. 6. 90-day retention enforced. |
| **File Paths** | `src/events/sourcing.ts`, `src/events/audit.ts`, `src/events/types.ts` |
| **Dependencies** | TASK-02 (ticket_history table) |

### TASK-18: Rate Limiting

| Field | Value |
|-------|-------|
| **Title** | Per-Identity Rate Limiting |
| **Description** | Implement rate limiting middleware for API and MCP endpoints, configurable per agent role. |
| **Type** | backend |
| **Priority** | low |
| **Acceptance Criteria** | 1. Default 100 requests/minute per API key. 2. Rate limit headers in responses. 3. 429 response on exceeded limit. 4. Configurable per agent role. 5. Rate limiting works across multiple MCP sessions. |
| **File Paths** | `src/api/middleware/rate-limit.ts` |
| **Dependencies** | TASK-07 (Auth middleware identifies caller) |

### TASK-19: Dashboard — Machine Status and Admin Views

| Field | Value |
|-------|-------|
| **Title** | Machine Status View and Admin Operations Panel |
| **Description** | Build dashboard views for machine health monitoring, ticket detail with history, and admin operations (force-release, API key management). |
| **Type** | frontend |
| **Priority** | medium |
| **Acceptance Criteria** | 1. Machine list with health indicators (active/stale/offline). 2. Ticket detail view with full history timeline. 3. Admin panel with force-release and force-advance (confirmation dialog). 4. System health metrics displayed. 5. API key management UI (create/revoke). |
| **File Paths** | `public/js/machines.js`, `public/js/admin.js`, `public/js/ticket-detail.js` |
| **Dependencies** | TASK-11 (Dashboard scaffold), TASK-10 (REST API) |

### TASK-20: Connection Pooling (PgBouncer)

| Field | Value |
|-------|-------|
| **Title** | PgBouncer Connection Pooling Configuration |
| **Description** | Configure PgBouncer in transaction mode for multi-machine database connection pooling. |
| **Type** | infra |
| **Priority** | medium |
| **Acceptance Criteria** | 1. PgBouncer runs in Docker Compose. 2. Transaction mode configured. 3. MCP server connects through PgBouncer. 4. Connection pooling tested under concurrent load. 5. Health check for PgBouncer service. |
| **File Paths** | `docker-compose.yml`, `config/pgbouncer.ini` |
| **Dependencies** | TASK-03 (Docker Compose) |

---

## 6. Updated SDLC Flow Definition

### 6.1 Full Stage List

```
READY → RESEARCH → ARCHITECT → PRODUCT_MANAGER → UI_DESIGN → BACKEND → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE
```

### 6.2 Flows by Ticket Type (with Skip Rules)

Not all tickets traverse all stages. Stages are skipped based on ticket type:

| Type | Flow | Skipped Stages |
|------|------|---------------|
| **backend** | READY → BACKEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, FRONTEND |
| **frontend** | READY → UI_DESIGN → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, BACKEND |
| **fullstack** | READY → UI_DESIGN → BACKEND → FRONTEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER |
| **infra** | READY → BACKEND → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, FRONTEND |
| **security** | READY → SECURITY → QA → CI → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, BACKEND, FRONTEND |
| **docs** | READY → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, BACKEND, FRONTEND, QA, SECURITY, CI |
| **research** | READY → RESEARCH → DOCUMENTATION → VALIDATOR → DONE | ARCHITECT, PRODUCT_MANAGER, UI_DESIGN, BACKEND, FRONTEND, QA, SECURITY, CI |
| **architecture** | READY → ARCHITECT → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, PRODUCT_MANAGER, UI_DESIGN, BACKEND, FRONTEND, QA, SECURITY, CI |
| **product** | READY → PRODUCT_MANAGER → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, UI_DESIGN, BACKEND, FRONTEND, QA, SECURITY, CI |
| **design** | READY → UI_DESIGN → DOCUMENTATION → VALIDATOR → DONE | RESEARCH, ARCHITECT, PRODUCT_MANAGER, BACKEND, FRONTEND, QA, SECURITY, CI |

### 6.3 Skip Rules

1. **RESEARCH** — Only for `research` type tickets. All other types skip.
2. **ARCHITECT** — Only for `architecture` type tickets. All other types skip.
3. **PRODUCT_MANAGER** — Only for `product` type tickets. All other types skip.
4. **UI_DESIGN** — Required for `frontend`, `fullstack`, and `design` type tickets. Skipped for backend, infra, security, docs, research, architecture, product.
5. **BACKEND** — Required for `backend`, `fullstack`, and `infra` type tickets.
6. **FRONTEND** — Required for `frontend` and `fullstack` type tickets.
7. **QA through VALIDATOR** — Required for all implementation types (backend, frontend, fullstack, infra, security). Skipped for non-implementation types (docs, research, architecture, product, design).
8. **DOCUMENTATION** — Required for ALL ticket types (every ticket needs docs).
9. **VALIDATOR** — Required for ALL ticket types (every ticket needs validation).

### 6.4 Post-Implementation Chain

After any implementation stage completes, the post-implementation chain is strict and non-negotiable:

```
[Implementation Stage] → QA → SECURITY → CI → DOCUMENTATION → VALIDATOR → DONE
```

Any rejection in the chain returns the ticket to REWORK, which re-enters at the implementation stage.

### 6.5 Stage Ownership Updates

| Stage | Agent |
|-------|-------|
| READY | System (tickets.py / MCP engine) |
| RESEARCH | Research Analyst |
| ARCHITECT | Architect |
| PRODUCT_MANAGER | Product Manager |
| UI_DESIGN | UIDesigner |
| BACKEND | Backend Engineer / DevOps Engineer (infra) |
| FRONTEND | Frontend Engineer |
| QA | QA Engineer |
| SECURITY | Security Engineer |
| CI | CI Reviewer |
| DOCUMENTATION | Documentation Specialist |
| VALIDATOR | Validator |
| DONE | System |

---

## 7. Risk Assessment

### 7.1 Technical Risks

| ID | Risk | Probability | Impact | Mitigation | Owner |
|----|------|-------------|--------|------------|-------|
| R-01 | MCP SDK breaking changes in v2.x | MEDIUM | MEDIUM | Pin to `^1.27`, monitor release notes, wrap SDK usage behind abstraction layer | Backend |
| R-02 | MCP auth spec changes invalidate API key approach | LOW (v1) | LOW | API keys are independent of MCP auth spec; migration path documented | Backend |
| R-03 | PostgreSQL single point of failure | HIGH | HIGH | Monitor with `pg_stat`; plan read replicas for v2; backup strategy in FR-36 | DevOps |
| R-04 | Dual-mode migration data divergence | MEDIUM | CRITICAL | Shadow mode validation (TASK-15); automated rollback triggers; reconciliation sweeps | Backend |
| R-05 | Dashboard scope creep | HIGH | MEDIUM | PRD locks scope to FR-22 through FR-27; no framework; MVP-first | Frontend |
| R-06 | Agent SDK adoption breaks existing workflows | MEDIUM | HIGH | Filesystem fallback in SDK (TASK-16); phased migration; rollback capability | Backend |
| R-07 | Concurrent claim race conditions under extreme load | LOW | HIGH | `SKIP LOCKED` is battle-tested; integration tests with 10+ concurrent claimants | Backend |
| R-08 | SSE connection limits per browser domain | LOW | LOW | Single EventSource per dashboard tab; connection pooling in browser | Frontend |
| R-09 | Docker volume permission issues | MEDIUM | LOW | Document `user:` configuration; test on Linux/macOS/WSL | DevOps |
| R-10 | Webhook delivery not guaranteed by GitHub | MEDIUM | MEDIUM | Periodic reconciliation sweep (FR-30); idempotent operations | Backend |

### 7.2 Process Risks

| ID | Risk | Probability | Impact | Mitigation |
|----|------|-------------|--------|------------|
| R-11 | Architect document not yet produced | HIGH | MEDIUM | PRD is compatible with Research findings; Architect can refine schema/contracts during ARCHITECT stage |
| R-12 | Too many tasks for incremental delivery | MEDIUM | MEDIUM | Tasks are ordered by dependency; critical path is clear; parallel work identified |
| R-13 | Self-bootstrapping creates circular dependency | LOW | HIGH | Use existing filesystem system to build the replacement; migration is phased |

---

## 8. Success Metrics

### 8.1 Launch Criteria (v1.0 GA)

| Metric | Target | Measurement |
|--------|--------|-------------|
| All 10 MCP tools functional | 10/10 tools passing integration tests | CI pipeline |
| Concurrent claim correctness | Zero double-claims in 1000-claim stress test | Automated test |
| Dashboard real-time updates | SSE latency < 1s measured over 1 hour | Client instrumentation |
| Migration data integrity | Zero data loss in dual-mode shadow test | Shadow mode comparison |
| Auth enforcement | Zero unauthorized operations in penetration test | Security review |
| Webhook recovery | 100% ghost commit resolution in test scenarios | Integration test |
| Documentation coverage | 100% of public APIs documented | Documentation review |

### 8.2 Operational Metrics (Post-Launch)

| Metric | Baseline (current) | Target (v1.0) | Measurement |
|--------|-------------------|---------------|-------------|
| Machines operating concurrently | 1-2 | 10+ | `tickets.stats` |
| Claim conflicts per day | Unknown (git push failures) | < 5 (conflict-free claims) | Audit log |
| Average claim-to-completion time | Unknown | Measured and tracked | `ticket_history` |
| Rework rate | Unknown | < 15% of tickets | `tickets.stats` |
| System uptime | N/A (CLI tool) | 99.9% | Healthcheck monitoring |
| Operator intervention rate | Manual (all operations) | < 10% of tickets need manual action | Dashboard analytics |

### 8.3 KPI Timeline

| Milestone | Date Target | Success Criteria |
|-----------|-------------|-----------------|
| Phase 0 complete (PRD + Research) | Week 1 | This PRD approved; Research report complete |
| Phase 1 complete (DB + MCP + Infra) | Week 3 | MCP server running with 5 core tools, PostgreSQL schema deployed |
| Phase 2 complete (API + SDK + Auth) | Week 5 | All 10 tools, REST API, auth, agent SDK functional |
| Phase 3 complete (Dashboard + Webhooks) | Week 7 | Dashboard live with real-time updates; webhooks integrated |
| Phase 4 complete (Migration + Cutover) | Week 9 | Dual-mode validated; agents using SDK; ready for cutover |
| v1.0 GA | Week 10 | All success metrics met; filesystem deprecated |

---

## 9. Discovery Matrix

### 9.1 Answered Questions

| # | Question | Answer | Source | Confidence |
|---|----------|--------|--------|------------|
| 1 | Which MCP SDK to use? | `@modelcontextprotocol/server` v1.27+ | Research Report §1 | HIGH (85%) |
| 2 | Which transport? | Streamable HTTP via Express | Research Report §1.4 | HIGH (85%) |
| 3 | How to do distributed locking? | `SELECT FOR UPDATE SKIP LOCKED` | Research Report §2.1 | HIGH (88%) |
| 4 | Which auth for v1? | API keys (hashed, per-agent) | Research Report §4.2 | MEDIUM-HIGH (73%) |
| 5 | Dashboard tech stack? | Vanilla HTML + SSE + D3.js | Research Report §5.2 | HIGH (80%) |
| 6 | Docker Compose pattern? | PG + PgBouncer + MCP Server with healthchecks | Research Report §6.1 | HIGH (90%) |
| 7 | How to handle ghost commits? | Webhook + commit message parsing + reconciliation | Research Report §3.3 | HIGH (82%) |
| 8 | PgBoss or custom? | Custom (ForgeOS state machine is unique) | Research Report §2.6 | HIGH |
| 9 | Connection pooling? | pg.Pool dev, PgBouncer production | Research Report §2.5 | HIGH (85%) |
| 10 | Webhook library? | `@octokit/webhooks` | Research Report §3.3 | HIGH (82%) |

### 9.2 Open Questions (Deferred to Architect)

| # | Question | Impact | Proposed Default |
|---|----------|--------|-----------------|
| 1 | Exact table column types and constraints? | Schema implementation | Use JSONB for flexible fields |
| 2 | Transaction isolation levels per operation? | Correctness | READ COMMITTED for claims, SERIALIZABLE for transitions |
| 3 | ORM vs raw SQL? | Developer experience | Raw SQL with parameterized queries (per Research) |
| 4 | TypeScript strict mode configuration? | Type safety | `strict: true` with all flags |
| 5 | File-level mutex granularity (file vs directory)? | Locking scope | File-level with directory prefix matching |

### 9.3 Assumptions

| # | Assumption | Validation Approach | Status |
|---|-----------|---------------------|--------|
| 1 | PostgreSQL is accessible from all machines via network | Tested in Docker Compose | UNVALIDATED |
| 2 | 10 concurrent machines is sufficient for v1 | Confirmed with project scope | VALIDATED |
| 3 | 30-minute default lease is appropriate | Configurable; adjust based on usage data | VALIDATED (with override) |
| 4 | Vanilla JS dashboard is sufficient | Research report validates for ForgeOS complexity | VALIDATED |
| 5 | API keys are secure enough for v1 | Research report §4; migration path to OAuth documented | VALIDATED |
| 6 | Architect document will be compatible with this PRD | PRD based on Research report; Architect builds on same input | UNVALIDATED |

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **MCP** | Model Context Protocol — standardized protocol for AI tool interaction |
| **Ticketer** | Stateless dispatcher agent that scans for available work and dispatches subagents |
| **Subagent** | Specialized AI agent (Backend, QA, Security, etc.) that performs a specific SDLC stage |
| **SDLC** | Software Development Lifecycle — the staged pipeline tickets traverse |
| **SKIP LOCKED** | PostgreSQL clause that skips rows locked by other transactions instead of blocking |
| **SSE** | Server-Sent Events — unidirectional server-to-client event streaming |
| **Lease** | Time-limited claim on a ticket; expires if not extended or completed |
| **Ghost commit** | A Git commit whose state is not reflected in the database (divergence) |
| **Blast radius** | The set of files a ticket is allowed to modify |
| **Dual-mode** | Operating with both filesystem and PostgreSQL state simultaneously during migration |
| **DAG** | Directed Acyclic Graph — the dependency structure of tickets |

---

## Upstream Artifacts Referenced

1. `.github/agent-output/Research/FORGEOS-RESEARCH-001.md` — Technology research report (906 lines, 82% overall confidence)
2. `TODO/L1-distributed-orchestration.md` — L1 capability breakdown (477 lines, 12 capabilities)
3. `.github/agent-output/Architect/FORGEOS-ARCH-001.md` — **NOT YET PRODUCED** (only `.gitkeep` exists)

## Evidence

- **PRD:** This document (FORGEOS-PRD-001)
- **User stories:** 20 stories with Given/When/Then acceptance criteria
- **Functional requirements:** 36 requirements (FR-01 through FR-36)
- **Non-functional requirements:** 6 categories with measurable targets
- **Task specifications:** 20 tasks for TODO agent decomposition
- **SDLC flow:** Updated with 12 stages and skip rules for 10 ticket types
- **Risk assessment:** 13 risks with probability, impact, and mitigation
- **Success metrics:** 7 launch criteria + 6 operational KPIs
- **Discovery matrix:** 10 answered questions, 5 deferred, 6 assumptions tracked
- **Confidence:** HIGH (85%) — bounded by missing Architect document

---

*Generated by ProductManager Agent — 2026-03-05T00:00:00Z*
