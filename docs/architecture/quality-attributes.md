---
title: ForgeOS Quality Attributes and Performance Targets
ticket: FORGEOS-ARCH011
type: architecture
author: Architect
date: 2026-03-07T00:00:00Z
status: REVIEWED
audience: All engineers, DevOps, QA, and operators working on ForgeOS
purpose: Define measurable quality attributes, performance targets, correctness invariants, scalability paths, and resource budgets
last_reviewed: 2026-03-07T14:52:00Z
diataxis_quadrant: reference
tags: [architecture, quality-attributes, performance, SLA, phase1]
---

# ForgeOS Quality Attributes and Performance Targets

> **Ticket:** FORGEOS-ARCH011 | **Agent:** Architect | **Date:** 2026-03-07  
> **Confidence:** HIGH (88%) | **Status:** REVIEWED  
> **Upstream:** [System Components](system-components.md) (FORGEOS-ARCH001)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Context Map](#2-context-map)
3. [Latency Targets](#3-latency-targets)
4. [Throughput Targets](#4-throughput-targets)
5. [Availability Targets](#5-availability-targets)
6. [Correctness Invariants](#6-correctness-invariants)
7. [Scalability Targets](#7-scalability-targets)
8. [Resource Utilization Budgets](#8-resource-utilization-budgets)
9. [Quality Attribute Scenarios (QAS)](#9-quality-attribute-scenarios-qas)
10. [Fitness Functions](#10-fitness-functions)
11. [Monitoring and Observability](#11-monitoring-and-observability)
12. [ADR-011: Quality Attribute Prioritization](#12-adr-011-quality-attribute-prioritization)
13. [Review Schedule](#13-review-schedule)
- [Appendix A: Derivation Notes](#appendix-a-derivation-notes)
- [Appendix B: Glossary](#appendix-b-glossary)

---

## 1. Executive Summary

This document defines the **measurable quality attributes** for the ForgeOS distributed multi-agent orchestration platform. All targets are derived from the system architecture defined in [FORGEOS-ARCH001](system-components.md), the connection pooling research ([FORGEOS-RES006](../research/pg-connection-pooling.md)), and the distributed locking research ([FORGEOS-RES005](../research/pg-distributed-locking.md)).

ForgeOS prioritizes **correctness** (exactly-once claim semantics, no phantom state transitions) over raw throughput. The system targets **50+ concurrent agents** operating on **1000+ active tickets** with **sub-100ms p99 latency** on claim operations and **99.9% uptime**.

### Quality Attribute Priority Order

| Priority | Attribute | Rationale |
|----------|-----------|-----------|
| 1 | **Correctness** | Ticket state integrity is the foundation — invalid states cause cascading failures across all agents |
| 2 | **Availability** | Agents are autonomous; downtime halts all orchestrated development work |
| 3 | **Latency** | Agents are LLM-driven; sub-second claim/advance latency avoids wasting expensive LLM context windows |
| 4 | **Throughput** | Must sustain multi-agent concurrency at scale without degradation |
| 5 | **Scalability** | Growth path from single-node to multi-instance deployment |
| 6 | **Resource Efficiency** | Predictable resource consumption enables capacity planning |

---

## 2. Context Map

### 2.1 Primary Files Affected by Quality Targets

| File | Role | Quality Attribute Impact |
|------|------|------------------------|
| `forgeos-server/src/db/pool.ts` | Connection pool singleton | Connection pool sizing, latency, resource budgets |
| `forgeos-server/src/db/migrations/001_initial.sql` | Schema + stored functions | Correctness invariants (SKIP LOCKED, RLS, constraints) |
| `forgeos-server/src/tools/index.ts` | MCP tool registration | Throughput (tool handler latency instrumentation points) |
| `forgeos-server/src/tools/tickets-next.ts` | tickets.next tool handler | Latency target: status/next query |
| `forgeos-server/src/config.ts` | Runtime configuration | Lease duration, rate limits, reconciliation interval |
| `forgeos-server/src/middleware/logging.ts` | Pino structured logger | Observability, slow query detection |
| `forgeos-server/src/server.ts` | Express app + SSE | Availability (health check), latency (SSE broadcast) |
| `forgeos-server/docker-compose.yml` | PostgreSQL + server containers | Resource budgets, availability (restart policy) |

### 2.2 Established Patterns

| Pattern | Relevance to Quality Attributes |
|---------|-------------------------------|
| `SELECT FOR UPDATE SKIP LOCKED` | Correctness: contention-free claiming; Latency: no lock waits |
| `pg_advisory_xact_lock` | Correctness: file-path mutex; Latency: transaction-scoped |
| Stored functions (`claim_ticket()`, `advance_ticket()`) | Correctness: atomic operations; Latency: server-side execution |
| Connection pool (max 20) | Resource budget: bounded connections; Throughput: concurrent capacity |
| `SLOW_QUERY_THRESHOLD_MS = 1000` | Latency: detection threshold for anomalous queries |
| Pino structured logging | Observability: JSON-format, low-overhead telemetry |
| Reconciliation loop (`RECONCILIATION_INTERVAL = 300s`) | Availability: expired lease cleanup; Correctness: no orphaned claims |

### 2.3 Dependencies

| Dependency | Quality Impact |
|-----------|---------------|
| PostgreSQL 17 | Correctness (ACID), Latency (SKIP LOCKED), Availability (WAL replication) |
| `pg` driver (node-postgres v8.x) | Latency (prepared statements), Resource (pool management) |
| Express 4.x | Latency (request handling overhead ~0.1ms), Throughput (event loop) |
| MCP SDK ^1.27.1 | Latency (JSON-RPC parsing), Throughput (Streamable HTTP transport) |
| Docker | Availability (restart policies), Resource (memory/CPU limits) |

---

## 3. Latency Targets

All latency targets are measured at the **application boundary** — from MCP JSON-RPC request arrival at the Express handler to response write completion. Database round-trip is included. Network latency between agent and server is excluded (varies by deployment).

### 3.1 Operation Latency Targets

| Operation | p50 | p95 | p99 | Measurement Point |
|-----------|-----|-----|-----|-------------------|
| **`tickets.claim`** | ≤ 15ms | ≤ 50ms | **≤ 100ms** | MCP tool handler entry → response |
| **`tickets.claim` (by ID)** | ≤ 10ms | ≤ 40ms | ≤ 80ms | MCP tool handler entry → response |
| **`tickets.complete`** (advance) | ≤ 20ms | ≤ 60ms | ≤ 120ms | MCP tool handler entry → response |
| **`tickets.reject`** (rework) | ≤ 15ms | ≤ 50ms | ≤ 100ms | MCP tool handler entry → response |
| **`tickets.next`** (status/query) | ≤ 10ms | ≤ 30ms | ≤ 60ms | MCP tool handler entry → response |
| **`tickets.stats`** (aggregate) | ≤ 20ms | ≤ 80ms | ≤ 150ms | MCP tool handler entry → response |
| **`tickets.graph`** (dependency) | ≤ 30ms | ≤ 100ms | ≤ 200ms | MCP tool handler entry → response |
| **`tickets.sync`** (reconciliation) | ≤ 50ms | ≤ 150ms | ≤ 300ms | Reconciliation loop iteration |
| **`tickets.release`** | ≤ 10ms | ≤ 30ms | ≤ 60ms | MCP tool handler entry → response |
| **`tickets.extend`** (lease) | ≤ 10ms | ≤ 30ms | ≤ 60ms | MCP tool handler entry → response |
| **`tickets.spawn`** | ≤ 15ms | ≤ 50ms | ≤ 100ms | MCP tool handler entry → response |
| **`tickets.update`** | ≤ 15ms | ≤ 50ms | ≤ 100ms | MCP tool handler entry → response |
| **Health check** (`/health`) | ≤ 5ms | ≤ 15ms | ≤ 20ms | HTTP GET → response |
| **SSE broadcast** (NOTIFY → client) | ≤ 100ms | ≤ 300ms | ≤ 500ms | PostgreSQL NOTIFY → SSE write |

### 3.2 Latency Breakdown Budget

For a `tickets.claim` operation at p99 (≤ 100ms budget):

| Phase | Budget | Notes |
|-------|--------|-------|
| Express middleware (auth, logging) | ≤ 5ms | API key validation, request ID assignment |
| Zod input validation | ≤ 2ms | Schema validation of MCP tool arguments |
| Connection pool checkout | ≤ 10ms | Acquire idle connection from `pg` Pool |
| `SET LOCAL` RLS context | ≤ 1ms | Session variable for Row-Level Security |
| `claim_ticket()` stored function | ≤ 30ms | `SELECT FOR UPDATE SKIP LOCKED` + insert events |
| Network round-trip (app ↔ PG) | ≤ 2ms | Loopback or Docker bridge network |
| Response serialization | ≤ 2ms | JSON-RPC response formatting |
| **Headroom** | **48ms** | Buffer for connection pool contention, GC pauses |

### 3.3 Latency Alerting Thresholds

| Severity | Condition | Action |
|----------|-----------|--------|
| **WARN** | p95 > 2× target for 5 minutes | Log alert, investigate |
| **ERROR** | p99 > 3× target for 5 minutes | Page on-call, investigate connection pool |
| **CRITICAL** | p99 > 5× target OR any operation > 5s | Immediate investigation, potential circuit breaker |

---

## 4. Throughput Targets

### 4.1 Concurrency Targets

| Metric | Target | Stretch Goal | Basis |
|--------|--------|-------------|-------|
| **Max concurrent agents** | **50** | 100 | pg Pool max 20 connections, short transactions (~30ms), yields ~600 ops/s capacity |
| **Max active tickets** | **1,000** | 5,000 | PostgreSQL index scan performance on `tickets` table; B-tree on `(stage, priority, created_at)` |
| **Max total tickets** (all stages) | 10,000 | 50,000 | PostgreSQL handles millions of rows; limited by index maintenance cost |
| **Max concurrent MCP sessions** | 50 | 100 | Express connection capacity, memory per session |

### 4.2 Operations Per Second

| Operation | Sustained Target | Burst (10s) | Basis |
|-----------|-----------------|-------------|-------|
| **Claim operations** | 100 ops/s | 200 ops/s | SKIP LOCKED eliminates lock waits; each claim ~30ms DB time |
| **Advance operations** | 100 ops/s | 200 ops/s | Similar to claim, single-row UPDATE + INSERT |
| **Status/query operations** | 500 ops/s | 1,000 ops/s | Read-only, no locking, index-driven |
| **Mixed workload (realistic)** | 200 ops/s | 400 ops/s | 60% reads, 30% claims, 10% advances |
| **SSE broadcasts** | 50 events/s | 200 events/s | NOTIFY fan-out to connected dashboard clients |

### 4.3 Rate Limiting

| Scope | Default Limit | Configurable | Config Key |
|-------|--------------|-------------|------------|
| Per agent (API key) | 100 req/min | Yes | `RATE_LIMIT_PER_MINUTE` |
| Global (all agents) | 3,000 req/min | No (derived from pool capacity) | — |
| SSE connections | 20 concurrent | No | Hardcoded Express limit |

### 4.4 Throughput Degradation Thresholds

| Condition | Expected Impact | Mitigation |
|-----------|----------------|------------|
| Pool utilization > 80% | Latency increase 2-5× | Scale pool size or add PgBouncer |
| Active tickets > 5,000 | Query planning overhead +10-20% | Add partial indexes on hot stages |
| Concurrent agents > 50 | Connection pool contention | PgBouncer in transaction mode |
| Events table > 1M rows | Write amplification on INSERT | Partition by `created_at` monthly |

---

## 5. Availability Targets

### 5.1 SLA Definition

| Metric | Target | Measurement Window | Exclusions |
|--------|--------|-------------------|------------|
| **Uptime SLA** | **99.9%** (8.76h downtime/year) | Rolling 30 days | Scheduled maintenance windows (max 2h/month, announced 24h ahead) |
| **Health check availability** | 99.95% | Rolling 7 days | — |
| **MCP endpoint availability** | 99.9% | Rolling 30 days | Client-side errors (4xx) excluded |

### 5.2 Recovery Objectives

| Metric | Target | Strategy |
|--------|--------|----------|
| **RTO** (Recovery Time Objective) | **< 5 minutes** | Docker restart policy (`unless-stopped`), automated health checks, container orchestrator auto-restart |
| **RPO** (Recovery Point Objective) | **< 1 minute** | PostgreSQL WAL with streaming replication (when configured); synchronous commit enabled |
| **MTTR** (Mean Time to Recovery) | < 3 minutes | Automated container restart + migration auto-run on startup |
| **MTTD** (Mean Time to Detection) | < 30 seconds | `/health` endpoint polled every 15s; SSE heartbeat timeout 30s |

### 5.3 Failure Modes and Recovery

| Failure Mode | Detection | Recovery | RTO | Data Loss |
|--------------|-----------|----------|-----|-----------|
| **MCP server crash** | Health check failure | Docker auto-restart | < 60s | None (stateless server, DB persists) |
| **PostgreSQL crash** | Pool connection error → health check failure | Docker auto-restart + WAL recovery | < 2 min | < 1 min (WAL) |
| **Network partition (server ↔ PG)** | Connection timeout after 10s | Reconnect via pool; queue requests | < 30s | None |
| **Connection pool exhaustion** | `pool_exhaustion` log event, waitingCount > 0 | Reduce concurrent load; scale pool | < 60s | None |
| **Expired claim buildup** | Reconciliation loop (every 5 min) | `release_expired_claims()` auto-releases | < 5 min | None |
| **Corrupted ticket state** | Constraint violation on next operation | Manual intervention + audit trail review | < 30 min | None (events table preserves history) |
| **Full disk** | PG refuses writes; health check fails | Alert → operator clears space or scales volume | < 15 min | None (WAL preserves committed data) |

### 5.4 Graceful Degradation

| Degraded State | Behavior | Agent Impact |
|---------------|----------|--------------|
| Database read-only | Queries succeed, writes fail with clear error | Agents can read status but not claim/advance |
| SSE disconnected | Dashboard stale, agents unaffected | Dashboard shows stale data; agents operate normally via MCP |
| Rate limit exceeded | HTTP 429 with `Retry-After` header | Agent retries after backoff |
| Single agent timeout | Lease expires → ticket auto-released | Other agents can reclaim; no blocking |

---

## 6. Correctness Invariants

These are **non-negotiable system properties** that must hold under all conditions, including concurrent access, partial failures, and network partitions.

### 6.1 Claim Invariants

| ID | Invariant | Mechanism | Verification |
|----|-----------|-----------|-------------|
| **C-1** | **Exactly-once claim guarantee**: A ticket in READY can be claimed by at most one agent per transition | `SELECT FOR UPDATE SKIP LOCKED` in `claim_ticket()` stored function | Concurrent claim test: N agents claim simultaneously → exactly 1 succeeds, N-1 get null |
| **C-2** | **No double-claim**: A ticket already claimed (with valid lease) cannot be claimed by another agent | `WHERE stage = p_stage AND claimed_by IS NULL` filter in stored function | Test: claim ticket → attempt second claim → second returns null |
| **C-3** | **Lease expiry releases claim**: Expired leases are automatically released by the reconciliation loop | `release_expired_claims()` runs every `RECONCILIATION_INTERVAL` (default 300s) | Test: claim ticket → expire lease → reconciliation → ticket is READY again |
| **C-4** | **Claim atomicity**: Claim either fully succeeds (ticket state + events + lease updated) or fully fails (no partial state) | Single `claim_ticket()` stored function executes within one transaction | Test: inject failure mid-function → verify no partial state changes |

### 6.2 State Transition Invariants

| ID | Invariant | Mechanism | Verification |
|----|-----------|-----------|-------------|
| **S-1** | **No phantom state transitions**: A ticket can only transition through its declared `sdlc_flow` sequence | `advance_ticket()` validates `new_stage` against `sdlc_flow` array in stored function | Test: attempt READY → QA (skipping BACKEND) → rejected |
| **S-2** | **No backward transitions** (except REWORK): Stage transitions are monotonically forward along `sdlc_flow` | `advance_ticket()` checks new stage index > current stage index | Test: attempt SECURITY → QA → rejected |
| **S-3** | **REWORK is bounded**: Maximum 3 rework attempts per ticket, then ESCALATED | `rework_count` column with CHECK constraint `rework_count <= 3` | Test: reject 3 times → fourth attempt → auto-escalated |
| **S-4** | **Stage consistency**: Ticket's `stage` column always matches exactly one directory under `ticket-state/` | PostgreSQL is single source of truth; file-based state is derived | Validated by reconciliation; no dual-state possible |

### 6.3 Dependency Invariants

| ID | Invariant | Mechanism | Verification |
|----|-----------|-----------|-------------|
| **D-1** | **Dependency integrity**: A ticket cannot enter READY until all `depends_on` tickets are in DONE | `resolve_dependencies()` stored function checks all dependencies | Test: create A depends-on B → A stays blocked until B is DONE |
| **D-2** | **No circular dependencies**: Dependency graph is a DAG (Directed Acyclic Graph) | Validated at ticket creation time; topological sort check | Test: A→B→C→A → rejected at creation |
| **D-3** | **Cascade-safe deletion**: Completing a ticket triggers dependency re-evaluation for blocked tickets | `resolve_dependencies()` called after `advance_ticket()` to DONE | Test: complete blocker → dependent ticket auto-moves to READY |

### 6.4 Data Integrity Invariants

| ID | Invariant | Mechanism | Verification |
|----|-----------|-----------|-------------|
| **I-1** | **Audit trail immutability**: Events table is append-only; no UPDATE or DELETE | Table-level REVOKE on UPDATE/DELETE; RLS policies | Test: attempt UPDATE on events → permission denied |
| **I-2** | **Referential integrity**: All foreign keys enforced (ticket → project, event → ticket, session → agent) | PostgreSQL FOREIGN KEY constraints with `ON DELETE RESTRICT` | Schema validation test |
| **I-3** | **Stage enum safety**: `stage` column only accepts valid SDLC stage values | CHECK constraint on `stage` column with enum-like validation | Test: INSERT with invalid stage → constraint violation |
| **I-4** | **Idempotent operations**: Repeating the same operation with same inputs produces the same result | Stored functions check preconditions before mutating state | Test: advance already-advanced ticket → no-op with appropriate response |

### 6.5 Concurrency Safety Matrix

| Scenario | Agents | Expected Outcome | Guarantee Level |
|----------|--------|-------------------|----------------|
| 2 agents claim same ticket simultaneously | 2 | Exactly 1 succeeds | **STRONG** (DB-enforced) |
| 50 agents claim from queue of 10 tickets | 50 | Exactly 10 claims succeed, 40 get null | **STRONG** (SKIP LOCKED) |
| Agent claims then crashes before completing | 1 | Lease expires → ticket auto-released | **EVENTUAL** (reconciliation interval) |
| Agent advances while another agent rejects same ticket | 2 | Exactly 1 succeeds (first to acquire row lock) | **STRONG** (FOR UPDATE) |
| Dependency resolved while ticket is being claimed | 2 | Dependency check in claim function prevents premature claim | **STRONG** (transactional) |

---

## 7. Scalability Targets

### 7.1 Vertical Scaling (PostgreSQL)

| Resource | Initial | Mid-Scale | High-Scale | Notes |
|----------|---------|-----------|------------|-------|
| **vCPUs** | 2 | 4 | 8 | PG benefits from parallel query at 4+ cores |
| **RAM** | 4 GB | 8 GB | 16 GB | `shared_buffers` = 25% of RAM; `work_mem` = 64MB |
| **Storage** | 10 GB SSD | 50 GB SSD | 200 GB NVMe | WAL + data + indexes; SSD mandatory for IOPS |
| **Max connections** | 100 (default) | 200 | 300 | Scale with PgBouncer, not raw `max_connections` |
| **Agents supported** | 10 | 50 | 100 | Correlates with connection pool sizing |
| **Active tickets** | 100 | 1,000 | 5,000 | Index performance degrades gracefully |

### 7.2 Horizontal Scaling (MCP Server)

| Topology | Agents | Server Instances | Load Balancer | DB Pool per Instance |
|----------|--------|-----------------|---------------|---------------------|
| **Single node** | ≤ 20 | 1 | None | 20 connections |
| **Dual node** | 21–50 | 2 | Nginx/HAProxy (round-robin) | 15 connections each (30 total) |
| **Multi-node** | 51–100 | 3–5 | Nginx/HAProxy + health checks | 10–15 connections each (via PgBouncer) |

#### Horizontal Scaling Prerequisites

1. **Stateless server**: MCP server is already stateless (no in-memory state beyond connection pool). ✅ Confirmed in `server.ts`.
2. **PgBouncer**: Required at > 50 agents to multiplex connections. Transaction mode confirmed compatible with `pg_advisory_xact_lock` and `SET LOCAL` (per [FORGEOS-RES006](../research/pg-connection-pooling.md)).
3. **Sticky sessions**: NOT required — MCP Streamable HTTP is request-based (no session affinity needed). `sessionIdGenerator: undefined` in `server.ts` confirms stateless transport.
4. **SSE fan-out**: Dashboard SSE connections are per-server-instance. At multi-node scale, use Redis pub/sub or PostgreSQL NOTIFY (current) for event fan-out.

### 7.3 Scaling Decision Matrix

| Agent Count | Action Required | Infrastructure Change |
|------------|-----------------|----------------------|
| 1–20 | None | Single MCP server + single PostgreSQL instance |
| 21–50 | Tune pool size → 25–30 | Increase `POOL_MAX_CONNECTIONS` in `pool.ts` |
| 51–100 | Add PgBouncer + second MCP instance | External connection pooler, load balancer |
| 100–200 | PostgreSQL read replicas for queries | Separate read/write endpoints; query routing |
| 200+ | Evaluate sharding or multi-region | Beyond current architecture scope; requires ADR |

### 7.4 Scaling Constraints

| Constraint | Limit | Mitigation |
|-----------|-------|------------|
| PostgreSQL `max_connections` | 300 (practical limit without PgBouncer) | PgBouncer multiplexes N server connections to M PG connections |
| Node.js event loop | ~10,000 concurrent connections | Cluster mode (PM2) or multiple instances |
| `events` table growth | ~100 bytes/event × 1000 events/day = ~100 KB/day | Partition by month; archive after 90 days |
| `tickets` table index size | Grows linearly with ticket count | Partial indexes on active stages only |

---

## 8. Resource Utilization Budgets

### 8.1 Memory Budgets

| Component | Budget | Basis |
|-----------|--------|-------|
| **MCP server process** (Node.js) | ≤ 512 MB RSS | Express + pg Pool + MCP SDK + Pino logger |
| **Per agent session overhead** | ≤ 5 MB | MCP Streamable HTTP is request-based; no persistent session state |
| **PostgreSQL `shared_buffers`** | 1 GB (25% of 4 GB RAM) | Standard PostgreSQL tuning recommendation |
| **PostgreSQL `work_mem`** | 64 MB | Per-operation sort/hash memory; safe for 20 concurrent queries |
| **PostgreSQL `maintenance_work_mem`** | 256 MB | Vacuum, index creation operations |
| **Connection pool memory** | ≤ 50 MB total (20 connections × ~2.5 MB each) | `pg` Pool client allocation |
| **Docker container limit (MCP server)** | 768 MB | Process + headroom for GC spikes |
| **Docker container limit (PostgreSQL)** | 2 GB | `shared_buffers` + `work_mem` × connections + OS overhead |

### 8.2 CPU Budgets

| Operation | CPU Budget (per op) | Basis |
|-----------|-------------------|-------|
| **Claim ticket** | ≤ 5ms CPU time | Stored function execution + JSON response |
| **Advance ticket** | ≤ 8ms CPU time | Stored function + event insert + dependency resolution |
| **Status query** | ≤ 2ms CPU time | Index scan + JSON serialization |
| **Graph query** | ≤ 15ms CPU time | Recursive CTE for dependency graph traversal |
| **SSE broadcast** | ≤ 1ms CPU time per client | JSON serialization + stream write |
| **Reconciliation loop** | ≤ 50ms CPU time per iteration | Scan expired leases + batch update |
| **Health check** | ≤ 1ms CPU time | Pool status + simple query |

### 8.3 Connection Pool Sizing

| Configuration | Value | Rationale |
|--------------|-------|-----------|
| **`max`** (max pool size) | 20 (default) | Formula: `(2 × CPU cores) + disk_spindles` → `(2 × 2) + 1 = 5` minimum; 20 provides headroom for burst |
| **`idleTimeoutMillis`** | 30,000 (30s) | Release idle connections to reduce PG backend count |
| **`connectionTimeoutMillis`** | 10,000 (10s) | Fail fast if pool exhausted rather than block indefinitely |
| **Target utilization** | ≤ 80% (max 16 of 20 active) | Pool exhaustion warning triggers at `waitingCount > 0` |
| **PgBouncer pool size** (when deployed) | 100 server-side, 300 client-side | Transaction mode; short transactions (~30ms) yield high reuse |

#### Pool Sizing by Deployment Scale

| Agents | pg Pool `max` | PgBouncer | Total PG Connections |
|--------|--------------|-----------|---------------------|
| 1–10 | 10 | Not needed | 10 |
| 11–20 | 20 (default) | Not needed | 20 |
| 21–50 | 25–30 | Recommended | 30–50 |
| 51–100 | 15/instance × 3 instances | Required (transaction mode) | 45 via PgBouncer → 30 PG backends |
| 100+ | 10/instance × 5+ instances | Required | 50+ via PgBouncer → 50 PG backends |

### 8.4 Storage Budgets

| Data Store | Growth Rate | 90-Day Projection | Retention Policy |
|-----------|-------------|-------------------|-----------------|
| `tickets` table | ~50 tickets/week | ~650 rows, ~500 KB | Indefinite (operational data) |
| `events` table | ~500 events/day | ~45,000 rows, ~5 MB | Archive after 90 days; partition by month |
| `sessions` table | ~50 sessions/day (ephemeral) | ~100 active rows, < 1 MB | Auto-expire stale sessions |
| `file_locks` table | ~20 locks/day (ephemeral) | ~10 active rows, < 1 MB | Transaction-scoped; auto-release |
| PostgreSQL WAL | ~10 MB/day | ~900 MB | Retain 1 day for point-in-time recovery |
| Pino log files | ~50 MB/day (info level) | ~4.5 GB | Rotate daily, retain 7 days |

### 8.5 Network Budgets

| Path | Bandwidth Budget | Basis |
|------|-----------------|-------|
| Agent → MCP server | ≤ 10 KB/request (avg) | JSON-RPC payload + headers |
| MCP server → PostgreSQL | ≤ 5 KB/query (avg) | SQL query + result set |
| SSE (server → dashboard) | ≤ 1 KB/event | Compact JSON event payload |
| Total server egress | ≤ 10 MB/hour at 50 agents | (50 agents × 2 req/min × 10 KB) + SSE overhead |

---

## 9. Quality Attribute Scenarios (QAS)

Quality Attribute Scenarios provide concrete, testable descriptions of quality requirements using the SEI/CMU format: **Source → Stimulus → Environment → Artifact → Response → Response Measure**.

### QAS-1: Claim Under Contention

| Element | Description |
|---------|-------------|
| **Source** | 10 concurrent agent clients |
| **Stimulus** | All 10 agents issue `tickets.claim` for the same stage simultaneously |
| **Environment** | Normal operation, 20-connection pool, 50 active tickets |
| **Artifact** | `claim_ticket()` stored function via MCP tool handler |
| **Response** | Exactly 1 agent receives a claimed ticket; 9 agents receive null (no available ticket matching criteria) |
| **Response Measure** | p99 latency ≤ 100ms; zero deadlocks; zero partial state changes |

### QAS-2: Server Recovery After Crash

| Element | Description |
|---------|-------------|
| **Source** | MCP server process |
| **Stimulus** | OOM kill or unhandled exception crashes the Node.js process |
| **Environment** | Docker with `restart: unless-stopped` policy |
| **Artifact** | MCP server container |
| **Response** | Docker auto-restarts container; migrations run on startup; health check passes |
| **Response Measure** | Service restored within 60 seconds; zero data loss; all in-flight requests receive error response before shutdown (graceful shutdown handler) |

### QAS-3: Sustained Load

| Element | Description |
|---------|-------------|
| **Source** | 50 concurrent agent clients |
| **Stimulus** | Mixed workload: 30 claims/min, 20 advances/min, 100 queries/min per agent for 1 hour |
| **Environment** | Production deployment, single MCP server, PostgreSQL with 4 vCPUs |
| **Artifact** | Entire ForgeOS system |
| **Response** | All operations complete successfully; no connection pool exhaustion; no memory leak |
| **Response Measure** | p99 latency within targets (§3.1); RSS memory stable ± 10%; pool utilization < 80% |

### QAS-4: Database Failover

| Element | Description |
|---------|-------------|
| **Source** | PostgreSQL instance |
| **Stimulus** | Primary database becomes unreachable (network or crash) |
| **Environment** | Production with streaming replication configured |
| **Artifact** | Connection pool and all MCP tool handlers |
| **Response** | Pool detects failure; health check returns unhealthy; agents receive clear error messages; failover to replica (if configured) |
| **Response Measure** | Detection within 30 seconds; recovery within 5 minutes; RPO < 1 minute |

### QAS-5: Lease Expiry Under Partition

| Element | Description |
|---------|-------------|
| **Source** | Agent client that claimed a ticket |
| **Stimulus** | Agent becomes unreachable (LLM timeout, network failure, machine crash) |
| **Environment** | Normal operation with default 30-minute lease |
| **Artifact** | Claimed ticket and reconciliation loop |
| **Response** | After lease expires, reconciliation releases claim; ticket returns to READY |
| **Response Measure** | Maximum stale claim duration = `DEFAULT_LEASE_MINUTES` + `RECONCILIATION_INTERVAL` = 35 minutes |

---

## 10. Fitness Functions

Automated, measurable thresholds that validate quality attributes in CI and production monitoring.

| ID | Metric | Threshold | Frequency | Tool |
|----|--------|-----------|-----------|------|
| **FF-01** | `tickets.claim` p99 latency | ≤ 100ms | Every CI run (load test) | k6 or autocannon |
| **FF-02** | `tickets.complete` p99 latency | ≤ 120ms | Every CI run (load test) | k6 or autocannon |
| **FF-03** | `tickets.next` p99 latency | ≤ 60ms | Every CI run (load test) | k6 or autocannon |
| **FF-04** | Health check p99 latency | ≤ 20ms | Continuous (15s interval) | Health check monitor |
| **FF-05** | SSE broadcast latency | ≤ 500ms from NOTIFY | Weekly performance test | Custom instrumentation |
| **FF-06** | Connection pool utilization | < 80% sustained | Continuous | Pino structured logs |
| **FF-07** | Zero claim contention deadlocks | 0 deadlocks/day | Continuous | `pg_stat_activity` monitor |
| **FF-08** | Concurrent claim correctness | Exactly 1 winner per ticket | Every CI run | Concurrent claim integration test |
| **FF-09** | Test coverage (new code) | ≥ 80% | Every CI run | Vitest coverage report |
| **FF-10** | TypeScript strict mode | Zero errors | Every CI run | `tsc --noEmit` |
| **FF-11** | Lint | Zero errors, zero warnings | Every CI run | ESLint |
| **FF-12** | MCP server RSS memory | ≤ 512 MB | Continuous | Docker stats / process monitor |
| **FF-13** | API availability | ≥ 99.9% (30-day rolling) | Continuous | Uptime monitoring |
| **FF-14** | State transition invariant violations | 0 per day | Continuous | Application-level constraint checks + audit log |
| **FF-15** | Expired claim cleanup latency | ≤ `RECONCILIATION_INTERVAL` + 60s | Continuous | Reconciliation loop monitoring |

---

## 11. Monitoring and Observability

### 11.1 Key Metrics to Instrument

| Category | Metrics | Source |
|----------|---------|--------|
| **Latency** | p50/p95/p99 per MCP tool, health check latency | Pino request logs + histogram |
| **Throughput** | Requests/second per tool, events/second (SSE) | Pino request count + rate calculation |
| **Errors** | 4xx rate, 5xx rate, PG error count, pool error count | Pino error logs + PG `on('error')` |
| **Saturation** | Pool utilization (%), Pool waiting count, CPU usage, RSS memory | `pg` Pool stats + process metrics |
| **Correctness** | Claim contention failures, state transition rejections, constraint violations | Application-level counters in Pino logs |

### 11.2 Structured Log Events

| Event Name | Level | Purpose |
|-----------|-------|---------|
| `mcp_tool_call` | info | Every tool invocation with tool name, duration, result status |
| `pool_exhaustion` | warn | Connection pool has waiting clients (saturation indicator) |
| `slow_query` | warn | Query exceeds `SLOW_QUERY_THRESHOLD_MS` (1000ms) |
| `pool_connection_error` | error | Unexpected pool connection failure |
| `claim_contention` | info | Agent attempted claim but received null (expected under load) |
| `state_transition_rejected` | warn | Invalid state transition attempted |
| `lease_expired_released` | info | Reconciliation released expired claim |
| `health_check_failed` | error | Health check endpoint returns unhealthy status |

### 11.3 Dashboard Indicators

| Indicator | Green | Yellow | Red |
|-----------|-------|--------|-----|
| API Latency (p99) | < target | 1-2× target | > 2× target |
| Pool Utilization | < 60% | 60-80% | > 80% |
| Error Rate (5xx) | 0% | < 0.1% | > 0.1% |
| Active Claims | < 80% of active tickets | 80-95% | > 95% (possible deadlock) |
| Memory (RSS) | < 400 MB | 400-512 MB | > 512 MB |

---

## 12. ADR-011: Quality Attribute Prioritization

### Status

**ACCEPTED** — 2026-03-07

### Context

ForgeOS is a distributed orchestration platform where AI agents autonomously claim and execute software development tickets. The system must balance multiple quality attributes:

- **Correctness** is foundational because invalid ticket states (double claims, phantom transitions) cause cascading failures across all agents.
- **Availability** matters because agent downtime wastes expensive LLM compute time and blocks development pipelines.
- **Latency** affects agent efficiency — LLM context windows are time-bounded, and slow operations waste tokens.
- **Throughput** must support the target of 50+ concurrent agents without degradation.

These attributes occasionally conflict. For example, stronger correctness (additional constraint checks) may increase latency. Higher availability (redundant instances) increases operational complexity and cost.

### Options Considered

1. **Correctness-first**: Prioritize ACID guarantees and invariant enforcement over latency optimization.
2. **Latency-first**: Optimize for speed, accept weaker consistency (eventual consistency, optimistic locking).
3. **Availability-first**: Prioritize uptime over strict consistency or latency.

### Decision

**Option 1: Correctness-first**, with the priority ordering:

```
Correctness > Availability > Latency > Throughput > Scalability > Resource Efficiency
```

### Consequences

- **Positive**: PostgreSQL's ACID guarantees and `SKIP LOCKED` deliver both correctness AND excellent latency. No trade-off required at current scale.
- **Positive**: Strong invariants prevent subtle bugs that would be expensive to debug in a multi-agent system.
- **Negative**: If latency targets prove too aggressive under extreme load, correctness constraints cannot be relaxed.
- **Risk**: At very high scale (200+ agents), additional latency from PgBouncer and constraint checks may exceed targets. Mitigated by scaling path defined in §7.

---

## 13. Review Schedule

| Review Item | Frequency | Owner | Trigger |
|------------|-----------|-------|---------|
| Latency targets vs. actuals | Monthly | Backend/DevOps | Production deployment |
| Throughput capacity assessment | Quarterly | Architect | Agent count increase |
| Availability SLA compliance | Monthly | DevOps | Uptime monitoring data |
| Correctness invariant audit | Per release | QA + Security | Any schema or stored function change |
| Resource budget review | Quarterly | DevOps | Infrastructure cost review |
| Scalability readiness | Bi-annually | Architect | Agent count > 30 |
| Fitness function thresholds | Quarterly | Architect + QA | Performance regression in CI |

---

## Appendix A: Derivation Notes

### Latency Target Derivation

Claim latency target of **≤ 100ms p99** is derived from:
- PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` benchmark: ~5-15ms for single-row lock+update on indexed table (per [FORGEOS-RES005](../research/pg-distributed-locking.md))
- `pg` Pool connection checkout: ~1-5ms for idle connection; up to 10ms under moderate load
- Express middleware overhead: ~1-3ms (auth + logging + Zod validation)
- Headroom factor: 2× for GC pauses, connection pool contention, Docker scheduling jitter
- Total: ~30ms typical + 70ms headroom = 100ms p99 budget

### Throughput Target Derivation

50+ concurrent agents target is derived from:
- Connection pool: 20 connections × ~30ms avg transaction = ~660 ops/s theoretical capacity
- At 2 ops/min per agent (conservative), 50 agents = 100 ops/min = 1.7 ops/s (well within capacity)
- Even at 10 ops/min per agent (burst), 50 agents = 500 ops/min = 8.3 ops/s (< 2% pool utilization)
- Bottleneck is connection pool at > 50 agents, mitigated by PgBouncer (per [FORGEOS-RES006](../research/pg-connection-pooling.md))

### Availability Target Derivation

99.9% uptime target (8.76h downtime/year) is derived from:
- Docker restart policy provides < 60s recovery for single-process crashes
- PostgreSQL WAL provides < 1 min RPO for data durability
- No external service dependencies (self-contained system)
- Main risk: coordinated infrastructure failure (host crash + disk failure); mitigated by backup strategy
- 99.99% is achievable with multi-node PostgreSQL (streaming replication) but deferred until agent count > 50

---

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **p50 / p95 / p99** | Percentile latency — the value below which 50% / 95% / 99% of observations fall |
| **RTO** | Recovery Time Objective — maximum acceptable time to restore service after failure |
| **RPO** | Recovery Point Objective — maximum acceptable data loss measured in time |
| **MTTR** | Mean Time to Recovery — average time to restore service after detection |
| **MTTD** | Mean Time to Detection — average time to detect a failure |
| **SLA** | Service Level Agreement — contractual availability commitment |
| **QAS** | Quality Attribute Scenario — structured description of a quality requirement (SEI/CMU format) |
| **SKIP LOCKED** | PostgreSQL feature that skips locked rows instead of waiting — enables contention-free queuing |
| **Fitness Function** | An automated, measurable threshold that validates an architectural property |
| **WAL** | Write-Ahead Log — PostgreSQL's durability mechanism, writes transactions to log before applying |
| **PgBouncer** | Lightweight connection pooler for PostgreSQL that multiplexes client connections |
| **RSS** | Resident Set Size — amount of physical memory used by a process |
| **SSE** | Server-Sent Events — HTTP-based one-way push protocol from server to client |

---

## Related Documents

| Document | Ticket | Relationship |
|----------|--------|-------------|
| [System Component Architecture](system-components.md) | FORGEOS-ARCH001 | Upstream — defines the system components these quality attributes apply to |
| [PG Distributed Locking Patterns](../research/pg-distributed-locking.md) | FORGEOS-RES005 | Evidence for correctness invariants (SKIP LOCKED, advisory locks) |
| [PG Connection Pooling Strategies](../research/pg-connection-pooling.md) | FORGEOS-RES006 | Evidence for connection pool sizing and scaling path |
| [Database Schema Reference](../database/schema-reference.md) | — | Schema details for stored functions referenced in correctness invariants |
| [MCP Tool Definitions](api/mcp-tool-definitions.md) | — | Tool registry for latency target assignment |

---

*Document created: 2026-03-07. Last reviewed: 2026-03-07. Diátaxis quadrant: Reference. Next review due: 2026-06-07.*
