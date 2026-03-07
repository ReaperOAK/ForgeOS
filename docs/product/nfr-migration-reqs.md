---
title: Non-Functional and Migration Requirements
ticket: FORGEOS-PM003
type: reference
author: Documentation Specialist
date: 2026-03-07T00:00:00Z
status: APPROVED
audience: Backend engineers, architects, DevOps engineers, and QA engineers building and validating the ForgeOS distributed platform
purpose: Define measurable non-functional requirements (performance, availability, scalability, security) and migration acceptance criteria for the transition from file-based to PostgreSQL-backed orchestration
last_reviewed: 2026-03-07T12:55:00Z
diataxis_quadrant: reference
tags: [product, nfr, migration, phase1, BLK-03-01]
dependencies: [FORGEOS-RES009, FORGEOS-RES010]
evidence_base: [FORGEOS-RES009, FORGEOS-RES010]
---

# Non-Functional and Migration Requirements

> **Ticket:** FORGEOS-PM003 | **Agent:** Documentation Specialist | **Date:** 2026-03-07
> **Confidence:** HIGH (90%)

---

## Table of Contents

1. [Overview](#1-overview)
2. [Performance NFRs](#2-performance-nfrs)
3. [Availability NFRs](#3-availability-nfrs)
4. [Scalability NFRs](#4-scalability-nfrs)
5. [Security NFRs](#5-security-nfrs)
6. [Migration Acceptance Criteria](#6-migration-acceptance-criteria)
7. [Migration Rollback Plan](#7-migration-rollback-plan)
8. [Data Integrity Verification](#8-data-integrity-verification)
9. [NFR Verification Matrix](#9-nfr-verification-matrix)
10. [Glossary](#10-glossary)

---

## 1. Overview

This document defines the non-functional requirements (NFRs) and migration acceptance criteria for the ForgeOS distributed orchestration platform. ForgeOS is migrating from a file-based ticket state machine (Git directories + `tickets.py`) to a PostgreSQL-backed system with MCP protocol communication.

All NFRs include measurable targets, verification methods, and rationale. The migration section defines dual-mode operation criteria, rollback procedures, and data integrity verification steps.

### Scope

| Category | Covered |
|----------|---------|
| Performance | Claim latency, API response time, dashboard load time |
| Availability | Uptime target, RTO, RPO |
| Scalability | Concurrent agents, active tickets, horizontal scaling |
| Security | Authentication, authorization, audit logging, secret management |
| Migration | Dual-mode operation, rollback plan, data integrity verification |

### Evidence Base

| Source | Ticket | Relevance |
|--------|--------|-----------|
| [System Gap Analysis](../research/system-gap-analysis.md) | FORGEOS-RES009 | Capability mapping, migration complexity ratings, risk assessment |
| [Protocol Comparison](../research/protocol-comparison.md) | FORGEOS-RES010 | Latency benchmarks, throughput projections, protocol selection |

---

## 2. Performance NFRs

### 2.1 Claim Latency

| Metric | Target | Rationale |
|--------|--------|-----------|
| P50 claim latency | ≤ 50 ms | Database `SELECT FOR UPDATE SKIP LOCKED` on indexed columns completes in single-digit milliseconds on LAN. 50 ms budget includes network round-trip, JSON-RPC parsing, and MCP tool execution overhead. |
| P95 claim latency | ≤ 200 ms | Accounts for connection pool contention under peak load and occasional network jitter. |
| P99 claim latency | ≤ 500 ms | Hard ceiling. Claims exceeding 500 ms indicate a systemic issue (pool exhaustion, lock contention, network failure). |

**Verification method:** Load test with 50 concurrent simulated agents issuing `tickets.claim` calls against a database pre-loaded with 500 tickets. Measure latency distribution at P50, P95, and P99 percentiles.

**Comparison to current system:** The file-based system uses `git push` as a distributed lock. Claim latency depends on git server round-trip time (typically 500–2000 ms). The PostgreSQL target represents a 10–40x improvement.

### 2.2 API Response Time

| Endpoint Category | P50 Target | P95 Target | P99 Target |
|------------------|------------|------------|------------|
| Read operations (`tickets.next`, `tickets.stats`, `tickets.graph`) | ≤ 30 ms | ≤ 100 ms | ≤ 300 ms |
| Write operations (`tickets.claim`, `tickets.complete`, `tickets.reject`) | ≤ 50 ms | ≤ 200 ms | ≤ 500 ms |
| Batch operations (`tickets.spawn` with multiple tickets) | ≤ 200 ms | ≤ 500 ms | ≤ 1000 ms |

**Verification method:** Automated API benchmarks using a load testing tool. Each endpoint tested individually with 100 sequential requests, then under concurrent load (20 parallel clients for 60 seconds). Results recorded as percentile distributions.

**Baseline:** MCP over Streamable HTTP adds approximately 2–10 ms of JSON-RPC overhead compared to raw REST (see [Protocol Comparison §3](../research/protocol-comparison.md#3-evaluation-dimension-1-latency)). This overhead is within the specified budgets.

### 2.3 Dashboard Load Time

| Metric | Target | Rationale |
|--------|--------|-----------|
| Initial page load (cold cache) | ≤ 2 seconds | Standard web performance target. Dashboard HTML is served as a static file by Express. |
| Initial page load (warm cache) | ≤ 500 ms | Browser cache and HTTP conditional requests reduce payload. |
| SSE event propagation | ≤ 100 ms | Time from `pg_notify('ticket_changes')` trigger fire to dashboard UI update via SSE. |
| Dashboard with 1000 tickets rendered | ≤ 3 seconds | Mermaid.js dependency graph rendering is the bottleneck. Target allows for graph layout computation. |

**Verification method:** Lighthouse performance audit for initial load. Manual stopwatch test for SSE propagation by claiming a ticket and measuring time until dashboard reflects the change.

---

## 3. Availability NFRs

### 3.1 Uptime Target

| Metric | Target | Detail |
|--------|--------|--------|
| Uptime SLA | 99.5% | Allows approximately 3.65 hours of downtime per month (planned and unplanned combined). |
| Planned maintenance window | ≤ 30 minutes per month | Database migrations, server upgrades, and configuration changes. Scheduled during low-activity periods. |

**Rationale:** ForgeOS is a developer productivity tool, not a user-facing production service. 99.5% uptime balances reliability with operational simplicity. Agents can tolerate brief outages because the file-based fallback remains available during Phase 2 (dual-mode operation).

### 3.2 Recovery Time Objective (RTO)

| Scenario | RTO | Recovery Procedure |
|----------|-----|-------------------|
| Application server crash | ≤ 5 minutes | Docker container auto-restart via `restart: unless-stopped` policy. Health check endpoint (`/health`) enables container orchestrator detection. |
| Database connection loss | ≤ 2 minutes | Connection pool (`pg` Pool) retries with exponential backoff. Pool reconnects automatically when PostgreSQL becomes reachable. |
| Full database failure | ≤ 30 minutes | Restore from most recent backup. Replay WAL logs to point-in-time recovery. Verify with integrity check. |
| Complete infrastructure failure | ≤ 60 minutes | Redeploy from `docker-compose.yml`. Restore database from backup. Verify all MCP tools respond. |

### 3.3 Recovery Point Objective (RPO)

| Scenario | RPO | Detail |
|----------|-----|--------|
| Application server crash | 0 (zero data loss) | All state lives in PostgreSQL. Application server is stateless (no in-memory state except connection pool). |
| Database failure (WAL archiving enabled) | ≤ 5 minutes | WAL (Write-Ahead Log) segments archived every 5 minutes. Point-in-time recovery restores to the most recent archived segment. |
| Database failure (no WAL archiving) | ≤ 24 hours | Daily `pg_dump` backup. Maximum data loss is one day of ticket operations. |

**Recommendation:** Enable WAL archiving for production deployments to achieve ≤ 5 minute RPO. Use daily `pg_dump` as a secondary backup mechanism.

---

## 4. Scalability NFRs

### 4.1 Concurrent Agents

| Metric | Target | Rationale |
|--------|--------|-----------|
| Maximum concurrent agents | 100 | ForgeOS supports 14 agent types. With multiple operators on multiple machines, 100 concurrent agent sessions covers 7 operators each running all 14 agents simultaneously. |
| Connection pool size | 20 connections (configurable) | Each MCP tool call acquires one connection from the pool. At 100 agents with an average 50 ms operation time, 20 connections sustain 400 operations/second — well above the projected load. |
| Agent session limit per operator | No hard limit | Operators may run multiple agents. Rate limiting is per-API-key, not per-session. |

**Verification method:** Simulate 100 concurrent MCP clients issuing mixed read/write operations for 5 minutes. Verify no connection pool exhaustion, no request timeouts, and no data corruption.

**Fallback:** If 100 agents saturate the pool, increase `POOL_MAX` environment variable. PostgreSQL supports up to `max_connections` (default 100, configurable to 500+ with adequate memory).

### 4.2 Active Tickets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Maximum active tickets | 10,000 | Current ForgeOS has approximately 100 tickets. 10,000 provides 100x headroom for multi-project, multi-team use. PostgreSQL handles millions of rows without degradation when properly indexed. |
| Query performance at 10,000 tickets | P95 ≤ 100 ms for filtered queries | B-tree indexes on `stage`, `status`, `priority`, `claimed_by`. GIN indexes on `tags`, `depends_on`, `file_paths`. |
| Dashboard rendering at 10,000 tickets | ≤ 5 seconds | Mermaid.js graph becomes impractical beyond ~500 nodes. Dashboard must paginate or filter the dependency graph for large ticket counts. |

**Verification method:** Seed database with 10,000 tickets. Run standard query suite (`tickets.next`, `tickets.stats`, `tickets.graph`). Verify P95 response times remain within target.

### 4.3 Horizontal Scaling

| Scaling Dimension | Strategy | When to Scale |
|-------------------|----------|---------------|
| Application server | Deploy multiple ForgeOS MCP Server instances behind a load balancer. Servers are stateless — any instance can handle any request. | When single-server CPU exceeds 80% sustained utilization or connection pool is consistently exhausted. |
| Database reads | Add PostgreSQL read replicas. Route `tickets.next`, `tickets.stats`, and `tickets.graph` (read-only operations) to replicas. | When read query volume exceeds 1,000 operations/second sustained. |
| Database writes | Vertical scaling (larger instance). PostgreSQL write scaling is limited to a single primary. | When write latency exceeds P95 targets consistently. ForgeOS's write volume (~10 writes/second at 100 agents) is far below PostgreSQL's capacity. |

**Note:** Horizontal scaling is not required for initial deployment. The targets above define thresholds for when to consider scaling, not requirements for day-one architecture.

---

## 5. Security NFRs

### 5.1 Authentication

| Requirement | Detail |
|-------------|--------|
| All MCP tool calls require authentication | Every request must include a valid API key (via `Authorization: Bearer <key>` header) or be rejected with HTTP 401. |
| API keys are per-agent | Each registered agent receives a unique API key. Keys are stored as bcrypt hashes in the `agents` table (`api_key_hash` column). |
| API key rotation | Keys can be regenerated without downtime. Old keys are invalidated immediately on rotation. |
| Dashboard authentication | The web dashboard requires authentication via bearer token or session cookie. Unauthenticated dashboard requests are redirected to a login page. |

**Verification method:** Attempt MCP tool calls without authentication — verify 401 response. Attempt with an invalid key — verify 401. Attempt with a valid key — verify 200. Verify rotated keys are immediately rejected.

### 5.2 Authorization Model

| Layer | Mechanism | Enforcement Point |
|-------|-----------|-------------------|
| Application layer | API key validation middleware (`middleware/auth.ts`) | Express middleware, before route handler |
| Database layer | Row-Level Security (RLS) policies | PostgreSQL, per-query enforcement |
| Function layer | Ownership checks in stored functions | PL/pgSQL function body (`claimed_by = p_agent_id`) |

**Authorization rules:**

| Operation | Required Permission | Ownership Check |
|-----------|-------------------|-----------------|
| `tickets.next` | `tickets.claim` or `tickets.read` | None (query only) |
| `tickets.claim` | `tickets.claim` | None (acquiring ownership) |
| `tickets.complete` | `tickets.advance` | Must be current claimer |
| `tickets.reject` | `tickets.reject` | Must be current claimer |
| `tickets.release` | `tickets.release` | Must be current claimer (or admin for force-release) |
| `tickets.spawn` | `tickets.spawn` | None (creating new ticket) |
| `tickets.stats` | `tickets.read` | None (aggregate data) |
| `tickets.graph` | `tickets.read` | None (aggregate data) |

**Verification method:** For each operation, test with an agent that has the required permission (expect success) and one that does not (expect permission denied error).

### 5.3 Audit Logging

| Requirement | Detail |
|-------------|--------|
| Every ticket state change is recorded | The `events` table stores an append-only log of all operations: CREATED, CLAIMED, RELEASED, STAGE_ADVANCED, STAGE_REJECTED, ESCALATED, SPAWNED, LEASE_EXTENDED, FORCE_RELEASED, RECONCILED, FILE_LOCKED, FILE_UNLOCKED. |
| Events include actor identity | Every event row records `agent_id`, `agent_name`, `machine_id`, and `operator` at the time of the action. |
| Events are immutable | The `events` table has no UPDATE or DELETE operations. RLS policies restrict write access to INSERT only. |
| Events have structured payloads | The `payload` JSONB column stores event-type-specific details (reason for rejection, new lease expiry, evidence metadata). |
| Audit log retention | Events are retained indefinitely. No automatic purge. Archival policy to be defined when event volume exceeds 1 million rows. |

**Verification method:** Perform a complete ticket lifecycle (create → claim → complete → advance through all stages → done). Query the `events` table and verify every state transition is recorded with correct actor and payload.

### 5.4 Secret Management

| Requirement | Detail |
|-------------|--------|
| No secrets in source code | Database passwords, API keys, and tokens must never appear in committed files. Enforced by pre-commit hook (`scripts/validate-commit.sh`). |
| Secrets via environment variables | All sensitive configuration is loaded from environment variables, validated by Zod schema in `config.ts`. |
| Docker secrets for production | Database password is mounted as a Docker secret file (`secrets/db_password`), not passed as an environment variable in `docker-compose.yml`. |
| API key hashing | Agent API keys are stored as bcrypt hashes. Raw keys are never stored or logged. |
| Structured logging excludes secrets | The Pino logger (`middleware/logging.ts`) must never log request bodies containing API keys, passwords, or tokens. Sensitive fields are redacted. |

**Verification method:** Grep the entire codebase for hardcoded secrets (regex patterns for common secret formats). Verify `docker-compose.yml` uses `secrets:` mount, not `environment:` for the database password. Verify logger redaction by inspecting log output during authentication.

---

## 6. Migration Acceptance Criteria

The migration from file-based to PostgreSQL-backed orchestration has three phases (see [System Gap Analysis §8](../research/system-gap-analysis.md#8-recommended-migration-strategy)). Each phase has specific acceptance criteria.

### 6.1 Phase 1: Database and MCP Foundation

| Criterion | Verification Method | Pass Condition |
|-----------|-------------------|----------------|
| PostgreSQL schema deployed | Run `001_initial.sql` migration | All 7 tables, 5 enums, 10 stored functions created without errors |
| MCP server starts | `npm start` or `docker-compose up` | Server binds to configured port, health endpoint returns 200 |
| All 10 MCP tools respond | Issue a tool call for each tool | Each tool returns a valid JSON-RPC response (success or expected error) |
| Existing tickets imported | Run import script against ticket JSON files | All tickets in `.github/tickets/` exist in the `tickets` table with matching fields |

### 6.2 Phase 2: Dual-Mode Operation

| Criterion | Verification Method | Pass Condition |
|-----------|-------------------|----------------|
| Agents can use MCP tools for ticket operations | Agent claims a ticket via `tickets.claim`, completes it via `tickets.complete` | Ticket state updates correctly in the database |
| File-based system remains operational | Run `tickets.py --status` | Dashboard shows correct ticket state from file system |
| Database and files are in sync | Run data integrity check (see [Section 8](#8-data-integrity-verification)) | Zero discrepancies between database and file system for tickets processed via MCP |
| Git commits continue for code delivery | Agent commits code changes via git | Code commits succeed independently of ticket state management |
| Dashboard serves from ForgeOS server | Open dashboard URL in browser | Dashboard loads, displays ticket data from database, SSE events stream |
| Rollback from dual-mode to file-only | Execute rollback procedure (see [Section 7](#7-migration-rollback-plan)) | All ticket state is restored from file system, agents resume file-based workflow |

### 6.3 Phase 3: Full Migration

| Criterion | Verification Method | Pass Condition |
|-----------|-------------------|----------------|
| `ticket-state/` directories no longer used for state | Remove `ticket-state/` directories | Agents continue operating via MCP tools without errors |
| `tickets.py` decommissioned for ticket operations | Disable `tickets.py` CLI | Agents function using MCP tools only |
| Agent definitions updated | Review all 14 `.agent.md` files | No references to two-commit protocol for ticket state |
| Instruction files updated | Review all 6 instruction files | No references to file-based ticket state machine |

---

## 7. Migration Rollback Plan

### 7.1 Rollback Triggers

A rollback is triggered if any of the following conditions occur during Phase 2 (dual-mode operation):

| Trigger | Detection Method | Severity |
|---------|-----------------|----------|
| Data loss: tickets exist in database but not in file system | Integrity check finds database-only tickets with no file counterpart | Critical |
| Claim contention: MCP claim operations fail at > 5% rate | Monitor claim error rate via structured logs | High |
| Agent workflow failure: > 2 agents unable to complete ticket lifecycle via MCP | Agent error reports or stuck tickets | High |
| Performance degradation: API response time exceeds P99 targets for > 10 minutes | Latency monitoring or health check failures | High |
| Database unavailability: PostgreSQL unreachable for > 5 minutes | Health endpoint returns 503, connection pool errors in logs | Critical |

### 7.2 Rollback Procedure

Execute these steps in order. Total estimated time: 15–30 minutes.

1. **Halt all agents.** Write `STOP` to `.github/guardian/STOP_ALL`. Wait for all agents to acknowledge (check for no active claims with lease expiry in the future).

2. **Export database state to JSON.** Run the database export script to dump all ticket rows to JSON files matching the file-based format:
   ```bash
   # Export all tickets from database to .github/tickets/ format
   psql -h localhost -U forgeos -d forgeos -c \
     "SELECT row_to_json(t) FROM tickets t" \
     > /tmp/db-tickets-export.json
   ```

3. **Reconcile file state.** Compare exported JSON against `.github/tickets/` master files. For each ticket:
   - If the database version is newer (based on `updated_at`), update the file version.
   - If the file version is newer, keep the file version (database may have stale data).
   - Place each ticket's JSON in the correct `.github/ticket-state/<STAGE>/` directory based on its `stage` field.

4. **Verify file-based state.** Run `python3 .github/tickets.py --validate` to confirm integrity. Run `python3 .github/tickets.py --sync` to resolve dependencies.

5. **Disable MCP server.** Stop the ForgeOS server (`docker-compose down`). Agents revert to file-based workflow using `agent-runner.py`.

6. **Resume agents.** Remove `STOP` from `.github/guardian/STOP_ALL`. Write `CLEAR <timestamp>`.

7. **Post-rollback verification.** Run `python3 .github/tickets.py --status` to confirm all tickets are visible and in the correct state.

### 7.3 Rollback Window

| Metric | Value | Rationale |
|--------|-------|-----------|
| Maximum rollback window | 7 days from dual-mode activation | After 7 days, file-based state diverges too far from database state for reliable reconciliation. |
| Recommended rollback decision | Within 48 hours | Earlier rollback reduces reconciliation complexity and data divergence. |
| Point of no return | Phase 3 start (file-based state decommissioned) | After `ticket-state/` directories are removed and `tickets.py` is decommissioned, rollback requires full re-creation of file state from database export. |

---

## 8. Data Integrity Verification

### 8.1 Verification Criteria

Data integrity means that the JSON file-based ticket state and the PostgreSQL database contain the same information for every ticket. During dual-mode operation (Phase 2), both systems must agree on:

| Field | Match Requirement |
|-------|-------------------|
| `ticket_id` | Exact match |
| `title` | Exact match |
| `type` | Exact match |
| `priority` | Exact match |
| `stage` | Exact match (file directory location = database `stage` column) |
| `sdlc_flow` | Exact match (array comparison) |
| `dependencies` / `depends_on` | Exact match (field name differs: `dependencies` in files, `depends_on` in database) |
| `file_paths` | Exact match (array comparison) |
| `acceptance_criteria` | Exact match (array comparison) |
| `claimed_by` | Match (database stores UUID; file stores agent name. Match via `agents` table lookup) |
| `rework_count` | Exact match |

### 8.2 Verification Procedure

Run the following integrity check at least once daily during dual-mode operation:

1. **Load all file-based tickets.** Read every JSON file in `.github/tickets/` and all `ticket-state/<STAGE>/` directories.

2. **Load all database tickets.** Query `SELECT * FROM tickets` via MCP `tickets.stats` tool or direct SQL.

3. **Compare ticket counts.** File count must equal database count. A mismatch indicates tickets created in only one system.

4. **Compare each ticket field-by-field.** For every `ticket_id` present in both systems, compare the fields listed in Section 8.1.

5. **Report discrepancies.** Output a summary:
   ```
   INTEGRITY CHECK — 2026-03-15T10:00:00Z
   Total file tickets:     85
   Total database tickets: 85
   Matched:                83
   Discrepancies:          2
     - FORGEOS-BE005: stage mismatch (file=BACKEND, db=QA)
     - FORGEOS-FE002: claimed_by mismatch (file=null, db=agent-uuid)
   Missing from database:  0
   Missing from files:     0
   ```

6. **Resolve discrepancies.** For each discrepancy, determine which system is authoritative:
   - If the ticket was most recently operated via MCP, the database is authoritative.
   - If the ticket was most recently operated via `tickets.py` or `agent-runner.py`, the file is authoritative.
   - Update the non-authoritative system to match.

### 8.3 Automated Integrity Check

Implement an automated integrity check as a scheduled job during Phase 2:

| Setting | Value |
|---------|-------|
| Frequency | Every 6 hours |
| Trigger | Cron job or database scheduler |
| Alert threshold | Any discrepancy count > 0 |
| Alert channel | Structured log at WARN level + optional webhook notification |
| Auto-remediation | None. Discrepancies require human review before correction. |

---

## 9. NFR Verification Matrix

This matrix maps each NFR to its acceptance criterion, verification method, and priority.

| ID | Category | NFR | Target | Verification | Priority |
|----|----------|-----|--------|-------------|----------|
| NFR-P01 | Performance | Claim latency P50 | ≤ 50 ms | Load test, 50 agents | Critical |
| NFR-P02 | Performance | Claim latency P95 | ≤ 200 ms | Load test, 50 agents | Critical |
| NFR-P03 | Performance | Claim latency P99 | ≤ 500 ms | Load test, 50 agents | High |
| NFR-P04 | Performance | Read API P50 | ≤ 30 ms | API benchmark | High |
| NFR-P05 | Performance | Read API P95 | ≤ 100 ms | API benchmark | High |
| NFR-P06 | Performance | Write API P50 | ≤ 50 ms | API benchmark | High |
| NFR-P07 | Performance | Write API P95 | ≤ 200 ms | API benchmark | High |
| NFR-P08 | Performance | Dashboard cold load | ≤ 2 seconds | Lighthouse audit | Medium |
| NFR-P09 | Performance | SSE propagation | ≤ 100 ms | Manual timing test | Medium |
| NFR-A01 | Availability | Uptime SLA | 99.5% | Uptime monitoring | High |
| NFR-A02 | Availability | RTO (server crash) | ≤ 5 minutes | Failure simulation | High |
| NFR-A03 | Availability | RTO (DB failure) | ≤ 30 minutes | Backup restore test | High |
| NFR-A04 | Availability | RPO (WAL enabled) | ≤ 5 minutes | WAL recovery test | High |
| NFR-A05 | Availability | RPO (no WAL) | ≤ 24 hours | Backup restore test | Medium |
| NFR-S01 | Scalability | Concurrent agents | 100 | Load simulation | High |
| NFR-S02 | Scalability | Active tickets | 10,000 | Seeded DB queries | Medium |
| NFR-S03 | Scalability | Connection pool | 20 (configurable) | Pool exhaustion test | High |
| NFR-SEC01 | Security | MCP authentication | All calls authenticated | Auth bypass test | Critical |
| NFR-SEC02 | Security | Authorization model | 3-layer (app + RLS + function) | Permission matrix test | Critical |
| NFR-SEC03 | Security | Audit logging | All state changes logged | Lifecycle audit trail test | High |
| NFR-SEC04 | Security | No hardcoded secrets | Zero secrets in code | Codebase grep scan | Critical |
| NFR-SEC05 | Security | API key hashing | bcrypt stored, never plaintext | DB inspection | Critical |
| MIG-01 | Migration | Dual-mode operation | Both systems operational | End-to-end test in Phase 2 | Critical |
| MIG-02 | Migration | Rollback tested | Rollback completes in ≤ 30 min | Rollback drill | Critical |
| MIG-03 | Migration | Data integrity confirmed | Zero discrepancies | Integrity check script | Critical |
| MIG-04 | Migration | Rollback window | 7 days maximum | Policy enforcement | High |

---

## 10. Glossary

| Term | Definition |
|------|-----------|
| **NFR** | Non-Functional Requirement. A requirement that specifies criteria for judging the quality of the system rather than specific behaviors. |
| **RTO** | Recovery Time Objective. The maximum acceptable duration of a service outage before recovery must be complete. |
| **RPO** | Recovery Point Objective. The maximum acceptable amount of data loss measured in time. |
| **WAL** | Write-Ahead Log. PostgreSQL's mechanism for ensuring data durability by writing changes to a log before applying them to data files. |
| **RLS** | Row-Level Security. PostgreSQL feature that restricts which rows a database user can access based on policies. |
| **MCP** | Model Context Protocol. The JSON-RPC-based protocol used for agent-to-server communication in ForgeOS. |
| **SSE** | Server-Sent Events. A unidirectional HTTP-based protocol for real-time server-to-client event streaming. |
| **Dual-mode operation** | Phase 2 of migration where both the file-based system (`tickets.py`) and the database-backed system (MCP tools) operate simultaneously. |
| **SKIP LOCKED** | A PostgreSQL `SELECT FOR UPDATE` modifier that skips rows already locked by other transactions, enabling non-blocking work-stealing queues. |
| **Lease** | A time-limited claim on a ticket. If the lease expires before the agent completes work, the ticket becomes reclaimable by another agent. |
