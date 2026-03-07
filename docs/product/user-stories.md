---
title: ForgeOS User Stories
ticket: FORGEOS-PM002
type: reference
author: Documentation Specialist
date: 2026-03-07T00:00:00Z
status: APPROVED
audience: Product managers, engineers, and UX designers building ForgeOS
purpose: Define comprehensive user stories for all four ForgeOS personas with acceptance criteria and MoSCoW prioritization
last_reviewed: 2026-03-07T13:30:00Z
diataxis_quadrant: reference
tags: [product, user-stories, phase1, BLK-03-01]
upstream: docs/product/user-personas.md
---

# ForgeOS User Stories

> **Ticket:** FORGEOS-PM002 | **Agent:** Documentation Specialist | **Date:** 2026-03-07
> **Confidence:** HIGH (94%)

---

## Table of Contents

1. [Overview](#1-overview)
2. [MoSCoW Priority Legend](#2-moscow-priority-legend)
3. [Persona 1: Human Operator Stories](#3-persona-1-human-operator-stories)
4. [Persona 2: AI Agent Stories](#4-persona-2-ai-agent-stories)
5. [Persona 3: ReaperOAK Dispatcher Stories](#5-persona-3-reaperoak-dispatcher-stories)
6. [Persona 4: System Administrator Stories](#6-persona-4-system-administrator-stories)
7. [Story Map Summary](#7-story-map-summary)
8. [Traceability Matrix](#8-traceability-matrix)

---

## 1. Overview

This document captures user stories for the four ForgeOS personas defined in the
[User Personas](user-personas.md) reference. Each story follows the standard format:

> **As a** [persona], **I want to** [action], **so that** [benefit].

Every story includes acceptance criteria in Given/When/Then format and a MoSCoW
priority classification. Stories are grouped by persona and ordered by priority
within each group.

**Total stories:** 24 (6 per persona)

---

## 2. MoSCoW Priority Legend

| Priority | Meaning | Implication |
|----------|---------|-------------|
| **Must** | Non-negotiable for MVP | System is unusable without this capability |
| **Should** | Important but not blocking | Significant value; schedule for early iterations |
| **Could** | Desirable if time permits | Nice-to-have; defer without impacting core functionality |
| **Won't** | Out of scope for current release | Documented for future consideration only |

---

## 3. Persona 1: Human Operator Stories

### HO-01: View Ticket Pipeline Status

**Priority:** Must

**As a** Human Operator, **I want to** view the current state of all tickets
across every SDLC stage in a single dashboard, **so that** I can identify
bottlenecks, blocked tickets, and overall pipeline throughput at a glance.

**Acceptance Criteria:**

- **Given** I am authenticated and the dashboard is open,
  **When** I navigate to the pipeline view,
  **Then** I see a stage-by-stage breakdown showing ticket counts for READY,
  ARCHITECT, RESEARCH, BACKEND, FRONTEND, QA, SECURITY, CI, DOCS, VALIDATION,
  and DONE.

- **Given** the pipeline view is displayed,
  **When** a ticket transitions to a new stage,
  **Then** the dashboard updates within 5 seconds via server-sent events without
  requiring a page refresh.

- **Given** I am viewing the pipeline,
  **When** I click on a specific stage,
  **Then** I see a list of all tickets in that stage with their title, priority,
  assignee, and time-in-stage duration.

---

### HO-02: Monitor Agent Claims

**Priority:** Must

**As a** Human Operator, **I want to** see which agents have claimed which
tickets and their lease expiry times, **so that** I can detect stale claims and
identify agents that may be stuck or crashed.

**Acceptance Criteria:**

- **Given** I am viewing the dashboard,
  **When** I open the active claims panel,
  **Then** I see a table listing each claimed ticket with the agent name, machine
  ID, operator, claim timestamp, and lease expiry countdown.

- **Given** an agent's lease has expired,
  **When** I view the claims panel,
  **Then** the expired claim is highlighted in red with a "Release" action button.

- **Given** I click the "Release" action on an expired claim,
  **When** the system processes the release,
  **Then** the ticket returns to READY and a release event is recorded in the
  audit log.

---

### HO-03: Manual Intervention on Blocked Tickets

**Priority:** Must

**As a** Human Operator, **I want to** manually rework, release, or escalate
tickets that are blocked or stuck, **so that** the pipeline continues to progress
when automated processes fail.

**Acceptance Criteria:**

- **Given** a ticket is in any active stage,
  **When** I select "Rework" and provide a reason,
  **Then** the ticket returns to its implementation stage with the rework reason
  attached and the rework counter increments by one.

- **Given** I rework a ticket that has already been reworked 3 times,
  **When** I attempt a fourth rework,
  **Then** the system blocks the rework and offers "Escalate" as the only option.

- **Given** I choose to escalate a ticket,
  **When** the escalation is processed,
  **Then** the ticket moves to ESCALATED state and the system administrator
  receives a notification.

---

### HO-04: Dashboard Filtering and Search

**Priority:** Should

**As a** Human Operator, **I want to** filter and search tickets by priority,
tag, assignee, type, and date range, **so that** I can focus on the specific
subset of work that requires my attention.

**Acceptance Criteria:**

- **Given** I am on the ticket list view,
  **When** I select a filter for priority "high",
  **Then** only tickets with priority "high" are displayed and the URL updates
  to reflect the filter state.

- **Given** I type a search query in the search bar,
  **When** the query matches a ticket title, ID, or tag,
  **Then** matching tickets appear within 500 milliseconds.

- **Given** multiple filters are active,
  **When** I apply them together,
  **Then** the results reflect the intersection of all active filters.

---

### HO-05: Migration Control

**Priority:** Should

**As a** Human Operator, **I want to** trigger and monitor the migration of
ticket state from the filesystem-based system to the distributed PostgreSQL
system, **so that** I can transition the team to the new platform with confidence
and rollback capability.

**Acceptance Criteria:**

- **Given** I have filesystem-based tickets in `.github/ticket-state/`,
  **When** I initiate the migration tool,
  **Then** the tool reads all ticket JSON files and imports them into PostgreSQL
  with their full history preserved.

- **Given** migration is in progress,
  **When** I view the migration dashboard,
  **Then** I see a progress bar showing tickets migrated, tickets remaining, and
  any errors encountered.

- **Given** migration has completed,
  **When** I run the validation check,
  **Then** the system confirms that every ticket in the filesystem has a matching
  record in PostgreSQL with identical metadata.

---

### HO-06: Dependency Graph Visualization

**Priority:** Could

**As a** Human Operator, **I want to** view an interactive dependency graph
showing how tickets relate to one another, **so that** I can understand blocking
relationships and plan work sequencing.

**Acceptance Criteria:**

- **Given** I open the dependency graph view,
  **When** the graph renders,
  **Then** I see each ticket as a node, with directed edges showing `depends_on`
  relationships, colored by stage status.

- **Given** I hover over a ticket node,
  **When** the tooltip appears,
  **Then** it shows the ticket title, current stage, assignee, and list of
  blocking and blocked-by tickets.

- **Given** a ticket transitions to DONE,
  **When** the graph updates,
  **Then** newly unblocked tickets are visually highlighted for 10 seconds.

---

## 4. Persona 2: AI Agent Stories

### AG-01: Claim a Ticket Atomically

**Priority:** Must

**As an** AI Agent, **I want to** claim the highest-priority available ticket in
my target SDLC stage using an atomic database operation, **so that** no two
agents can claim the same ticket simultaneously.

**Acceptance Criteria:**

- **Given** I query for available tickets in my stage,
  **When** I call the `tickets.claim` MCP tool with my agent ID, machine ID,
  and operator,
  **Then** the system uses `SELECT FOR UPDATE SKIP LOCKED` to atomically assign
  the ticket to me and returns the full ticket JSON.

- **Given** another agent attempts to claim the same ticket at the same instant,
  **When** both requests arrive concurrently,
  **Then** exactly one agent receives the ticket and the other receives a
  structured error with code `TICKET_ALREADY_CLAIMED`.

- **Given** no tickets are available in my stage,
  **When** I call the claim tool,
  **Then** I receive a structured response with code `NO_TICKETS_AVAILABLE` and
  an empty result set.

---

### AG-02: Advance Ticket to Next Stage

**Priority:** Must

**As an** AI Agent, **I want to** advance a ticket I have claimed to the next
SDLC stage after completing my work, **so that** downstream agents can pick it up
and the pipeline progresses.

**Acceptance Criteria:**

- **Given** I have completed my stage work and written my summary,
  **When** I call the `tickets.advance` MCP tool with the ticket ID,
  **Then** the ticket moves to the next stage in its `sdlc_flow`, my claim is
  released, and a `STAGE_ADVANCED` event is emitted.

- **Given** I attempt to advance a ticket that is not claimed by me,
  **When** the system processes the request,
  **Then** it rejects the advance with error code `NOT_TICKET_OWNER`.

- **Given** the ticket is at the last stage before DONE,
  **When** I advance it,
  **Then** the ticket moves to DONE and a `TICKET_COMPLETED` event is emitted via
  `pg_notify`.

---

### AG-03: Extend Lease via Heartbeat

**Priority:** Must

**As an** AI Agent, **I want to** send periodic heartbeat signals to extend my
lease on a claimed ticket, **so that** long-running tasks do not get reclaimed by
other agents due to lease expiry.

**Acceptance Criteria:**

- **Given** I hold a valid claim on a ticket,
  **When** I call the `tickets.extend` MCP tool,
  **Then** my lease expiry is extended by the configured lease duration from the
  current time and a `LEASE_EXTENDED` event is recorded.

- **Given** my lease has already expired,
  **When** I attempt to extend it,
  **Then** the system rejects the extension with error code `LEASE_EXPIRED` and
  I must re-claim the ticket.

- **Given** I am actively working,
  **When** I fail to send a heartbeat within the lease window,
  **Then** the system marks my claim as expired and the ticket becomes available
  for other agents.

---

### AG-04: Report Results with Structured Evidence

**Priority:** Must

**As an** AI Agent, **I want to** submit my work results including artifact
paths, test outcomes, and confidence level, **so that** downstream agents and
human operators can verify my output.

**Acceptance Criteria:**

- **Given** I have completed my stage work,
  **When** I call the `tickets.complete` MCP tool with my results payload,
  **Then** the system stores my summary including artifact paths, test results,
  and confidence level (HIGH/MEDIUM/LOW) as a completion event.

- **Given** I submit results without required evidence fields,
  **When** the system validates my payload,
  **Then** it rejects the submission with error code `INVALID_PAYLOAD` listing
  the missing fields.

- **Given** I submit results successfully,
  **When** the completion is processed,
  **Then** subscribed clients receive a real-time SSE notification with the
  completion summary.

---

### AG-05: Handle Rework After Rejection

**Priority:** Must

**As an** AI Agent, **I want to** receive rework instructions with rejection
evidence when my work is rejected by QA, Security, or Validator, **so that** I
can address the specific issues and resubmit.

**Acceptance Criteria:**

- **Given** my work has been rejected by a downstream agent,
  **When** I receive a rework notification for the ticket,
  **Then** the notification includes the rejection reason, the rejecting agent's
  ID, and specific items that failed review.

- **Given** I am reworking a ticket,
  **When** I re-read the ticket JSON,
  **Then** the `rework_count` field reflects the current attempt number and the
  history array contains all previous rejection events.

- **Given** the rework count has reached 3,
  **When** I attempt to claim the ticket for a fourth attempt,
  **Then** the system blocks the claim and the ticket is moved to ESCALATED.

---

### AG-06: Discover Available Tickets by Stage

**Priority:** Should

**As an** AI Agent, **I want to** query for all available tickets in my target
SDLC stage sorted by priority, **so that** I always work on the most important
task first.

**Acceptance Criteria:**

- **Given** I call the `tickets.list` MCP tool with a stage filter,
  **When** the query executes,
  **Then** I receive a list of unclaimed tickets sorted by priority (critical >
  high > medium > low) and then by creation date (oldest first).

- **Given** the list contains tickets with unresolved dependencies,
  **When** I view the results,
  **Then** those tickets are excluded because dependency resolution has already
  filtered them out of the READY stage.

- **Given** I request tickets with a specific tag filter,
  **When** the query returns results,
  **Then** only tickets matching the tag are included in the response.

---

## 5. Persona 3: ReaperOAK Dispatcher Stories

### RO-01: Scan for Ready Tickets

**Priority:** Must

**As** ReaperOAK, **I want to** scan for all unclaimed tickets in the READY
stage, **so that** I can dispatch the appropriate agent for each one.

**Acceptance Criteria:**

- **Given** the dispatch loop starts a new cycle,
  **When** I query the ticket store for READY tickets,
  **Then** I receive a list of all tickets in READY state that have no active
  claim and whose dependencies are fully resolved.

- **Given** the READY queue is empty,
  **When** I query for available tickets,
  **Then** I receive an empty list and the dispatch loop can idle or terminate.

- **Given** new tickets enter READY via dependency resolution,
  **When** a `pg_notify` event fires on the `ticket_events` channel,
  **Then** I receive the notification and immediately start a new scan cycle
  instead of waiting for the next polling interval.

---

### RO-02: Dispatch Agents to Tickets

**Priority:** Must

**As** ReaperOAK, **I want to** dispatch the correct agent type for each READY
ticket based on the ticket's SDLC flow and current stage, **so that** the right
specialist handles each piece of work.

**Acceptance Criteria:**

- **Given** I have a list of READY tickets,
  **When** I process each ticket,
  **Then** I map the next SDLC stage to the correct agent type using the
  `STAGE_TO_AGENT` mapping (BACKEND → Backend, FRONTEND → Frontend, QA → QA,
  etc.).

- **Given** I dispatch an agent for a ticket,
  **When** the dispatch call is made,
  **Then** exactly one agent is invoked per ticket with no batching or grouping.

- **Given** the dispatched agent fails to claim the ticket (push conflict),
  **When** the agent reports failure,
  **Then** I leave the ticket in READY for the next dispatch cycle.

---

### RO-03: Advance Pipeline After Agent Completion

**Priority:** Must

**As** ReaperOAK, **I want to** detect when an agent has finished its work and
ensure the ticket moves to the next stage, **so that** the pipeline progresses
without manual intervention.

**Acceptance Criteria:**

- **Given** an agent completes its work and pushes the WORK commit,
  **When** the ticket moves to the next SDLC stage,
  **Then** I detect the stage change on the next scan cycle and dispatch the
  next agent in the chain.

- **Given** a ticket completes the final stage (VALIDATION),
  **When** it moves to DONE,
  **Then** I run dependency resolution to check if any blocked tickets are now
  unblocked and can move to READY.

- **Given** an agent's lease expires without completion,
  **When** I detect the expired lease,
  **Then** I release the stale claim and the ticket returns to READY for
  re-dispatch.

---

### RO-04: Handle Escalated Tickets

**Priority:** Should

**As** ReaperOAK, **I want to** detect tickets that have reached the ESCALATED
state after 3 failed rework cycles, **so that** I can notify the system
administrator and stop dispatching agents for that ticket.

**Acceptance Criteria:**

- **Given** a ticket's rework count reaches 3,
  **When** a rejection triggers the fourth rework attempt,
  **Then** the ticket moves to ESCALATED instead of returning to the
  implementation stage.

- **Given** a ticket is in ESCALATED state,
  **When** I scan for dispatchable tickets,
  **Then** I skip the escalated ticket and do not attempt to dispatch any agent
  for it.

- **Given** a ticket is escalated,
  **When** the state change occurs,
  **Then** an `ESCALATED` event is emitted that the system administrator's
  alerting mechanism can consume.

---

### RO-05: Synchronize Ticket State

**Priority:** Must

**As** ReaperOAK, **I want to** trigger a full state synchronization that
evaluates dependencies, releases expired claims, and moves unblocked tickets to
READY, **so that** the ticket state machine remains consistent.

**Acceptance Criteria:**

- **Given** the sync operation is invoked,
  **When** the system evaluates all ticket dependencies,
  **Then** every ticket whose `depends_on` list contains only DONE tickets is
  moved to READY.

- **Given** expired claims exist,
  **When** the sync operation runs,
  **Then** all claims with `lease_expiry` in the past are released and the
  tickets return to their stage's unclaimed pool.

- **Given** a ticket exists in multiple stage directories (integrity violation),
  **When** the sync detects the duplicate,
  **Then** the duplicate is removed and the ticket is placed in the correct stage
  based on the master ticket record.

---

### RO-06: Priority-Based Dispatch Ordering

**Priority:** Could

**As** ReaperOAK, **I want to** dispatch agents to tickets in priority order
(critical first, then high, medium, low), **so that** the most important work is
processed before lower-priority items.

**Acceptance Criteria:**

- **Given** multiple tickets are in READY state,
  **When** I process the dispatch queue,
  **Then** tickets with priority "critical" are dispatched before "high", which
  are dispatched before "medium", which are dispatched before "low".

- **Given** two tickets share the same priority,
  **When** I determine dispatch order,
  **Then** the older ticket (earlier `created_at`) is dispatched first.

- **Given** a new critical ticket enters READY while lower-priority agents are
  running,
  **When** the next dispatch cycle begins,
  **Then** the critical ticket is dispatched immediately without waiting for
  lower-priority work to finish.

---

## 6. Persona 4: System Administrator Stories

### SA-01: Configure Authentication and API Keys

**Priority:** Must

**As a** System Administrator, **I want to** create, revoke, and manage API keys
for agents and operators with role-based access control, **so that** only
authorized entities can interact with the system.

**Acceptance Criteria:**

- **Given** I am on the agent management page,
  **When** I create a new API key for an agent with role "backend",
  **Then** the system generates a unique key, stores the hashed version in the
  `agents` table, and returns the plaintext key exactly once.

- **Given** an API key is compromised,
  **When** I revoke the key,
  **Then** all active sessions using that key are terminated within 60 seconds
  and subsequent requests with the revoked key return HTTP 401.

- **Given** an agent with role "backend" attempts to claim a "frontend" ticket,
  **When** the request is processed,
  **Then** the system rejects the claim with error code `ROLE_MISMATCH` enforced
  by PostgreSQL row-level security policies.

---

### SA-02: Monitor System Health

**Priority:** Must

**As a** System Administrator, **I want to** view real-time health metrics for
the ForgeOS MCP Server, PostgreSQL database, and Docker containers, **so that** I
can respond to outages and performance degradation proactively.

**Acceptance Criteria:**

- **Given** I call the `/health` endpoint,
  **When** all services are operational,
  **Then** I receive a JSON response with `status: "healthy"`, database
  connection pool stats (total, idle, waiting), and server uptime.

- **Given** the PostgreSQL connection pool is exhausted,
  **When** I call the `/health` endpoint,
  **Then** the response returns `status: "degraded"` with the pool utilization
  percentage and queue depth.

- **Given** Docker health checks are configured,
  **When** the MCP Server container becomes unhealthy,
  **Then** Docker emits a health event that can trigger automated alerting via
  webhook or log monitoring.

---

### SA-03: Manage Agent Registration

**Priority:** Must

**As a** System Administrator, **I want to** register new agents, deactivate
stale agents, and view all active agent sessions, **so that** I maintain control
over which entities are operating in the system.

**Acceptance Criteria:**

- **Given** I access the agent management interface,
  **When** I register a new agent with a name, role, and machine ID,
  **Then** the agent record is created in the `agents` table with status
  "active" and a unique API key is generated.

- **Given** an agent has not connected in 7 days,
  **When** I view the agent list,
  **Then** the agent is flagged as "stale" and I can deactivate it with one
  action.

- **Given** I deactivate an agent,
  **When** the deactivation is processed,
  **Then** the agent's API key is revoked, all active claims are released, and
  a `DEACTIVATED` event is logged.

---

### SA-04: Handle System Failures and Recovery

**Priority:** Must

**As a** System Administrator, **I want to** diagnose and recover from system
failures including database connection issues, orphaned claims, and inconsistent
ticket state, **so that** the pipeline resumes operation with minimal downtime.

**Acceptance Criteria:**

- **Given** the database connection is lost,
  **When** the connection is restored,
  **Then** the connection pool automatically reconnects and the MCP Server
  resumes processing requests within 30 seconds.

- **Given** orphaned claims exist due to agent crashes,
  **When** I run the lease cleanup operation,
  **Then** all claims with expired leases are released and the affected tickets
  return to their unclaimed pool.

- **Given** a ticket is in an inconsistent state (conflicting stage data),
  **When** I run the integrity validation tool,
  **Then** the tool reports all inconsistencies with the affected ticket IDs and
  provides a one-command fix option.

---

### SA-05: View Audit Trail

**Priority:** Must

**As a** System Administrator, **I want to** search and filter the complete audit
trail of all ticket operations, agent actions, and system events, **so that** I
can investigate incidents and maintain compliance.

**Acceptance Criteria:**

- **Given** I access the events log,
  **When** I filter by ticket ID,
  **Then** I see every event for that ticket in chronological order: creation,
  claims, advances, rejections, reworks, and completion.

- **Given** I filter events by time range and event type,
  **When** the query executes,
  **Then** I receive paginated results with each event showing timestamp, agent,
  machine, event type, and details.

- **Given** I need to export audit data,
  **When** I request a CSV or JSON export,
  **Then** the system generates a downloadable file containing all events
  matching my current filter criteria.

---

### SA-06: Configure Runtime Parameters

**Priority:** Should

**As a** System Administrator, **I want to** update runtime configuration
parameters like lease duration, max rework count, and rate limits without
restarting the server, **so that** I can tune system behavior in response to
operational conditions.

**Acceptance Criteria:**

- **Given** I update the `default_lease_minutes` value in the `system_config`
  table,
  **When** the next agent claims a ticket,
  **Then** the new lease duration is applied without requiring a server restart.

- **Given** I change the `max_rework_count` from 3 to 5,
  **When** a ticket with 3 reworks receives another rejection,
  **Then** the ticket is reworked (not escalated) because the new limit has not
  been reached.

- **Given** I set the `rate_limit_per_minute` to 30,
  **When** an agent exceeds 30 MCP tool calls in one minute,
  **Then** subsequent calls receive HTTP 429 with a `Retry-After` header
  indicating when the limit resets.

---

## 7. Story Map Summary

| Persona | ID | Story Title | Priority |
|---------|----|-------------|----------|
| **Human Operator** | HO-01 | View Ticket Pipeline Status | Must |
| | HO-02 | Monitor Agent Claims | Must |
| | HO-03 | Manual Intervention on Blocked Tickets | Must |
| | HO-04 | Dashboard Filtering and Search | Should |
| | HO-05 | Migration Control | Should |
| | HO-06 | Dependency Graph Visualization | Could |
| **AI Agent** | AG-01 | Claim a Ticket Atomically | Must |
| | AG-02 | Advance Ticket to Next Stage | Must |
| | AG-03 | Extend Lease via Heartbeat | Must |
| | AG-04 | Report Results with Structured Evidence | Must |
| | AG-05 | Handle Rework After Rejection | Must |
| | AG-06 | Discover Available Tickets by Stage | Should |
| **ReaperOAK** | RO-01 | Scan for Ready Tickets | Must |
| | RO-02 | Dispatch Agents to Tickets | Must |
| | RO-03 | Advance Pipeline After Agent Completion | Must |
| | RO-04 | Handle Escalated Tickets | Should |
| | RO-05 | Synchronize Ticket State | Must |
| | RO-06 | Priority-Based Dispatch Ordering | Could |
| **System Admin** | SA-01 | Configure Authentication and API Keys | Must |
| | SA-02 | Monitor System Health | Must |
| | SA-03 | Manage Agent Registration | Must |
| | SA-04 | Handle System Failures and Recovery | Must |
| | SA-05 | View Audit Trail | Must |
| | SA-06 | Configure Runtime Parameters | Should |

### Priority Distribution

| Priority | Count | Percentage |
|----------|-------|------------|
| Must | 17 | 71% |
| Should | 5 | 21% |
| Could | 2 | 8% |
| Won't | 0 | 0% |

---

## 8. Traceability Matrix

Maps each user story to the persona pain points it addresses (from
[User Personas](user-personas.md) Section 8).

| Story ID | Pain Points Addressed | Platform Feature |
|----------|-----------------------|------------------|
| HO-01 | No real-time updates, Scattered state | SSE dashboard, unified query |
| HO-02 | No visibility into agent status | Claims panel with lease countdown |
| HO-03 | Manual sync required, Git state fragility | Rework/release/escalate via MCP tools |
| HO-04 | No search or filtering | Indexed queries with faceted filters |
| HO-05 | Mixed code and state in git | Migration tool with validation |
| HO-06 | Scattered state | Interactive dependency graph |
| AG-01 | Git push contention, No atomic operations | `SELECT FOR UPDATE SKIP LOCKED` |
| AG-02 | Two-commit overhead | Single MCP tool call for advance |
| AG-03 | No atomic operations (orphan risk) | Heartbeat-based lease extension |
| AG-04 | Limited error feedback | Structured evidence payload |
| AG-05 | No file conflict detection | Rejection evidence with structured codes |
| AG-06 | File scanning is slow | Indexed stage queries |
| RO-01 | Sequential dispatch, Directory scanning overhead | `pg_notify` event-driven scan |
| RO-02 | No parallel safety | Stage-to-agent mapping with atomic claim |
| RO-03 | No visibility into agent status | Stage change detection via events |
| RO-04 | Stale claim detection is slow | ESCALATED state with event emission |
| RO-05 | Sequential dispatch, No prioritization | Full sync with dependency resolution |
| RO-06 | No prioritization | Priority-ordered query |
| SA-01 | No role-based access control | API keys with RLS policies |
| SA-02 | No health monitoring | `/health` endpoint with pool stats |
| SA-03 | No RBAC, No centralized logging | Agent management with lifecycle events |
| SA-04 | Git state fragility, Hardcoded configuration | Auto-reconnect, integrity validation |
| SA-05 | No centralized logging | Events table with filtered queries |
| SA-06 | Hardcoded configuration | `system_config` runtime updates |
