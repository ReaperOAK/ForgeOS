---
title: ForgeOS Fitness Functions and Verification Plan
ticket: FORGEOS-ARCH012
type: architecture
author: Architect
date: 2026-03-07T00:00:00Z
status: DRAFT
audience: All engineers, DevOps, QA, and operators working on ForgeOS
purpose: Define automated fitness functions, verification tooling, test specifications, and CI/CD integration plan for all quality attributes
last_reviewed: 2026-03-07T00:00:00Z
diataxis_quadrant: reference
tags: [architecture, fitness-functions, testing, verification, phase1, BLK-02-04]
dependencies: [FORGEOS-ARCH011]
---

# ForgeOS Fitness Functions and Verification Plan

> **Ticket:** FORGEOS-ARCH012 | **Agent:** Architect | **Date:** 2026-03-07  
> **Confidence:** HIGH (87%) | **Status:** DRAFT  
> **Upstream:** [Quality Attributes](quality-attributes.md) (FORGEOS-ARCH011)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Context Map](#2-context-map)
3. [Fitness Function Catalog](#3-fitness-function-catalog)
   - 3.1 [FF-01: Claim Latency](#31-ff-01-claim-latency)
   - 3.2 [FF-02: Advance Latency](#32-ff-02-advance-latency)
   - 3.3 [FF-03: Query Latency](#33-ff-03-query-latency)
   - 3.4 [FF-04: Health Check Latency](#34-ff-04-health-check-latency)
   - 3.5 [FF-05: SSE Broadcast Latency](#35-ff-05-sse-broadcast-latency)
   - 3.6 [FF-06: Connection Pool Utilization](#36-ff-06-connection-pool-utilization)
   - 3.7 [FF-07: Zero Deadlocks](#37-ff-07-zero-deadlocks)
   - 3.8 [FF-08: Concurrent Claim Correctness](#38-ff-08-concurrent-claim-correctness)
   - 3.9 [FF-09: State Transition Integrity](#39-ff-09-state-transition-integrity)
   - 3.10 [FF-10: Dependency Resolution Correctness](#310-ff-10-dependency-resolution-correctness)
   - 3.11 [FF-11: Zero-Downtime Migration](#311-ff-11-zero-downtime-migration)
   - 3.12 [FF-12: API Response Time Under Load](#312-ff-12-api-response-time-under-load)
   - 3.13 [FF-13: Database Query Performance](#313-ff-13-database-query-performance)
   - 3.14 [FF-14: Test Coverage](#314-ff-14-test-coverage)
   - 3.15 [FF-15: Type Safety and Lint](#315-ff-15-type-safety-and-lint)
   - 3.16 [FF-16: Memory Stability](#316-ff-16-memory-stability)
   - 3.17 [FF-17: API Availability](#317-ff-17-api-availability)
   - 3.18 [FF-18: Expired Claim Cleanup](#318-ff-18-expired-claim-cleanup)
4. [Verification Tooling](#4-verification-tooling)
5. [CI/CD Integration Plan](#5-cicd-integration-plan)
6. [Automated Test Implementation Guidelines](#6-automated-test-implementation-guidelines)
7. [Regression Detection Strategy](#7-regression-detection-strategy)
8. [ADR-012: Fitness Function Tooling Selection](#8-adr-012-fitness-function-tooling-selection)
9. [DAG Task Graph](#9-dag-task-graph)

---

## 1. Executive Summary

This document defines **18 fitness functions** — automated, measurable thresholds that validate every quality attribute specified in the [Quality Attributes document](quality-attributes.md) (FORGEOS-ARCH011). Each fitness function specifies:

- **What** to measure (metric, source, measurement point)
- **How** to measure it (tooling, benchmark setup, test scenario)
- **When** it passes or fails (threshold, regression detection)
- **Where** it runs (CI pipeline stage, production monitoring, or nightly suite)

The fitness functions are organized into four categories:

| Category | Fitness Functions | CI Frequency |
|----------|-------------------|--------------|
| **Latency** | FF-01 through FF-05 | Every PR (load test) |
| **Correctness** | FF-08 through FF-10 | Every PR (integration test) |
| **Resource** | FF-06, FF-07, FF-12, FF-13, FF-16 | Every PR (synthetic) + Nightly (sustained) |
| **Operations** | FF-11, FF-14, FF-15, FF-17, FF-18 | Every PR (static) + Weekly (soak) |

### Quality Attribute Traceability

Every fitness function traces back to a quality attribute and its associated correctness invariant or performance target from FORGEOS-ARCH011:

| Quality Attribute | Invariants / Targets | Fitness Functions |
|-------------------|---------------------|-------------------|
| Correctness | C-1, C-2, C-3, C-4, S-1, S-2, S-3, D-1, D-2, D-3 | FF-08, FF-09, FF-10 |
| Latency | §3.1 Operation Latency Targets | FF-01, FF-02, FF-03, FF-04, FF-05 |
| Throughput | §4.1 Concurrency Targets | FF-06, FF-12 |
| Availability | §5.1 SLA Definition | FF-17 |
| Resource Efficiency | §8.1–8.3 Budgets | FF-06, FF-13, FF-16 |
| Maintainability | Definition of Done #2, #3, #4 | FF-14, FF-15 |
| Migration Safety | §5.3 Zero-downtime | FF-11 |
| Concurrency Safety | §6.5 Safety Matrix | FF-07, FF-08 |

---

## 2. Context Map

### 2.1 Primary Files Affected

| File | Role | Fitness Function Impact |
|------|------|------------------------|
| `forgeos-server/src/db/pool.ts` | Connection pool singleton | FF-06 (pool utilization), FF-13 (query perf) |
| `forgeos-server/src/db/migrations/001_initial.sql` | Schema + stored functions | FF-08 (claim correctness), FF-09 (state transitions), FF-10 (dependencies) |
| `forgeos-server/src/tools/` | MCP tool handlers | FF-01–FF-03 (latency benchmarks), FF-12 (load) |
| `forgeos-server/src/config.ts` | Runtime configuration | FF-18 (reconciliation interval), thresholds |
| `forgeos-server/src/server.ts` | Express app + SSE | FF-04 (health), FF-05 (SSE), FF-17 (availability) |
| `forgeos-server/vitest.config.ts` | Test runner configuration | FF-14 (coverage), test infrastructure |
| `forgeos-server/docker-compose.yml` | Container definitions | FF-11 (migration), FF-16 (memory limits) |

### 2.2 Secondary Files (Instrumentation Points)

| File | Role |
|------|------|
| `forgeos-server/src/middleware/logging.ts` | Pino logger — metric emission point |
| `forgeos-server/src/hooks/` | MCP lifecycle hooks — latency measurement |
| `.github/workflows/ai-test-validator.yml` | CI pipeline — fitness function execution |

### 2.3 New Files to Create (Implementation Phase)

| File | Purpose |
|------|---------|
| `forgeos-server/src/__tests__/fitness/claim-latency.bench.ts` | FF-01 benchmark |
| `forgeos-server/src/__tests__/fitness/concurrent-claim.test.ts` | FF-08 integration test |
| `forgeos-server/src/__tests__/fitness/state-transitions.test.ts` | FF-09 property-based test |
| `forgeos-server/src/__tests__/fitness/dependency-resolution.test.ts` | FF-10 graph test |
| `forgeos-server/src/__tests__/fitness/query-performance.test.ts` | FF-13 EXPLAIN analysis |
| `forgeos-server/load-tests/k6-claim-latency.js` | FF-01 k6 load test script |
| `forgeos-server/load-tests/k6-mixed-workload.js` | FF-12 k6 sustained load script |
| `forgeos-server/load-tests/k6-migration-soak.js` | FF-11 zero-downtime soak test |
| `.github/workflows/fitness-functions.yml` | CI workflow for fitness function execution |

### 2.4 Established Patterns

| Pattern | Relevance |
|---------|-----------|
| Vitest for unit/integration tests | Fitness functions for correctness (FF-08, FF-09, FF-10) run via Vitest |
| `@vitest/coverage-v8` for coverage | FF-14 uses existing coverage infrastructure |
| `tsc --noEmit` for type checks | FF-15 uses existing typecheck script |
| Pino structured logging | Metrics emission for production-mode fitness functions (FF-06, FF-07, FF-17) |
| Docker Compose for local environment | Load tests run against Docker-composed stack |

---

## 3. Fitness Function Catalog

### 3.1 FF-01: Claim Latency

**Quality Attribute:** Latency (§3.1 — `tickets.claim` p99 ≤ 100ms)  
**Invariant Reference:** QAS-1 — Claim Under Contention  
**Category:** Latency | **CI Tier:** Every PR

#### Benchmark Setup

```
Environment:
  - PostgreSQL 17 in Docker (2 vCPU, 4 GB RAM, SSD-backed volume)
  - MCP server in Docker (Node.js 22, 512 MB memory limit)
  - Connection pool: max 20 connections (default)
  - Seed data: 100 tickets in READY state, 10 agents registered

Pre-conditions:
  - Database migrated with 001_initial.sql
  - No active claims (clean state)
  - Connection pool warmed (5 idle connections established)

Warm-up:
  - 10 sequential claim requests (discarded from measurement)
  - Ensures JIT compilation, prepared statement caching
```

#### Measurement Tool

**Primary:** [k6](https://k6.io/) — open-source load testing tool with histogram support  
**Secondary:** [Vitest bench](https://vitest.dev/guide/features.html#benchmarking) — micro-benchmark for isolated function timing

k6 script outline (`forgeos-server/load-tests/k6-claim-latency.js`):

```javascript
import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

const claimLatency = new Trend('claim_latency_ms', true);

export const options = {
  scenarios: {
    claim_burst: {
      executor: 'constant-vus',
      vus: 10,           // 10 concurrent virtual agents
      duration: '30s',
      gracefulStop: '5s',
    },
  },
  thresholds: {
    'claim_latency_ms{scenario:claim_burst}': [
      'p(50)<15',    // p50 ≤ 15ms
      'p(95)<50',    // p95 ≤ 50ms
      'p(99)<100',   // p99 ≤ 100ms  ← PRIMARY THRESHOLD
    ],
    'http_req_failed': ['rate<0.01'], // < 1% error rate
  },
};

export default function () {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    method: 'tools/call',
    params: { name: 'tickets.claim', arguments: { stage: 'BACKEND' } },
    id: __VU * 1000 + __ITER,
  });
  const res = http.post(`${__ENV.MCP_URL}/mcp`, payload, {
    headers: { 'Content-Type': 'application/json', 'X-API-Key': __ENV.API_KEY },
  });
  claimLatency.add(res.timings.duration);
  check(res, { 'status is 200': (r) => r.status === 200 });
}
```

#### Acceptable Range

| Percentile | Target | Regression Threshold | Action |
|------------|--------|---------------------|--------|
| p50 | ≤ 15ms | > 25ms (+67%) | WARN — investigate |
| p95 | ≤ 50ms | > 75ms (+50%) | FAIL CI — block merge |
| p99 | ≤ 100ms | > 150ms (+50%) | FAIL CI — block merge |

#### Regression Detection

- **Baseline:** Stored in `forgeos-server/load-tests/baselines/claim-latency.json` after each `main` branch merge
- **Comparison:** k6 outputs JSON summary; CI script compares p50/p95/p99 against baseline
- **Tolerance:** 20% degradation triggers WARN; 50% degradation triggers FAIL
- **Trend tracking:** Historical results stored as CI artifacts for trend visualization

---

### 3.2 FF-02: Advance Latency

**Quality Attribute:** Latency (§3.1 — `tickets.complete` p99 ≤ 120ms)  
**Category:** Latency | **CI Tier:** Every PR

#### Benchmark Setup

Same environment as FF-01. Pre-conditions: 50 tickets claimed by test agents (active leases).

#### Measurement Tool

k6 script (`forgeos-server/load-tests/k6-claim-latency.js` — shared with FF-01, separate scenario):

```javascript
export const options = {
  scenarios: {
    advance_burst: {
      executor: 'constant-vus',
      vus: 10,
      duration: '30s',
    },
  },
  thresholds: {
    'advance_latency_ms': ['p(99)<120'],
  },
};
```

#### Acceptable Range

| Percentile | Target | Regression Threshold |
|------------|--------|---------------------|
| p50 | ≤ 20ms | > 35ms |
| p95 | ≤ 60ms | > 90ms |
| p99 | ≤ 120ms | > 180ms |

---

### 3.3 FF-03: Query Latency

**Quality Attribute:** Latency (§3.1 — `tickets.next` p99 ≤ 60ms)  
**Category:** Latency | **CI Tier:** Every PR

#### Benchmark Setup

Same environment as FF-01. Pre-conditions: 500 tickets across all stages; 50 with active claims.

#### Measurement

k6 scenario with 20 VUs issuing `tickets.next` queries for 30 seconds.

#### Acceptable Range

| Percentile | Target | Regression Threshold |
|------------|--------|---------------------|
| p50 | ≤ 10ms | > 18ms |
| p95 | ≤ 30ms | > 45ms |
| p99 | ≤ 60ms | > 90ms |

---

### 3.4 FF-04: Health Check Latency

**Quality Attribute:** Latency (§3.1 — `/health` p99 ≤ 20ms)  
**Category:** Latency | **CI Tier:** Every PR

#### Measurement

k6 scenario: 5 VUs, 60 seconds, `GET /health`.

#### Acceptable Range

| Percentile | Target | Regression Threshold |
|------------|--------|---------------------|
| p50 | ≤ 5ms | > 10ms |
| p99 | ≤ 20ms | > 30ms |

---

### 3.5 FF-05: SSE Broadcast Latency

**Quality Attribute:** Latency (§3.1 — SSE ≤ 500ms from NOTIFY)  
**Category:** Latency | **CI Tier:** Weekly

#### Benchmark Setup

1. Establish 10 SSE client connections
2. Insert a ticket state change via `tickets.claim`
3. Measure time from claim response to SSE event arrival

#### Measurement Tool

Custom Vitest integration test (`forgeos-server/src/__tests__/fitness/sse-broadcast.test.ts`):

```typescript
import { describe, it, expect } from 'vitest';

describe('FF-05: SSE Broadcast Latency', () => {
  it('broadcasts state change within 500ms of NOTIFY', async () => {
    // 1. Open SSE connection via EventSource
    // 2. Perform tickets.claim via HTTP
    // 3. Record timestamp of claim response
    // 4. Record timestamp of SSE event receipt
    // 5. Assert delta ≤ 500ms
    const delta = sseReceiveTimestamp - claimResponseTimestamp;
    expect(delta).toBeLessThanOrEqual(500);
  });
});
```

#### Acceptable Range

| Metric | Target | Regression Threshold |
|--------|--------|---------------------|
| Median broadcast delay | ≤ 100ms | > 250ms |
| p99 broadcast delay | ≤ 500ms | > 750ms |

---

### 3.6 FF-06: Connection Pool Utilization

**Quality Attribute:** Resource (§8.3 — Pool utilization < 80%)  
**Category:** Resource | **CI Tier:** Nightly (sustained load)

#### Measurement

During the FF-12 sustained load test, capture pool metrics every second:

```typescript
// Instrument pool.ts to expose metrics
export function getPoolMetrics() {
  return {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
    utilization: (pool.totalCount - pool.idleCount) / pool.totalCount,
  };
}
```

#### Acceptable Range

| Metric | Target | Regression Threshold |
|--------|--------|---------------------|
| Sustained utilization (5-min avg) | < 80% | ≥ 85% |
| Peak utilization (any 1s window) | < 95% | 100% (waitingCount > 0) |
| `waitingCount` (any sample) | 0 | > 0 for > 10 consecutive seconds |

---

### 3.7 FF-07: Zero Deadlocks

**Quality Attribute:** Correctness (§6.5 — Concurrency Safety Matrix)  
**Category:** Resource | **CI Tier:** Every PR

#### Measurement

Query PostgreSQL after each load test run:

```sql
SELECT deadlocks FROM pg_stat_database WHERE datname = current_database();
```

Record the deadlock count before and after the load test. Delta must be 0.

#### Acceptable Range

| Metric | Target | Regression Threshold |
|--------|--------|---------------------|
| Deadlocks during test run | 0 | ≥ 1 |

#### Action on Failure

FAIL CI. Deadlocks indicate a lock ordering bug in stored functions. Must be investigated before merge.

---

### 3.8 FF-08: Concurrent Claim Correctness

**Quality Attribute:** Correctness (Invariants C-1, C-2 — Exactly-once claim)  
**Category:** Correctness | **CI Tier:** Every PR

#### Test Scenario

```
Scenario: N agents claiming simultaneously
  Given: 1 ticket in READY state (stage = BACKEND)
  When:  N = 20 concurrent agents issue tickets.claim(stage='BACKEND') simultaneously
  Then:  Exactly 1 agent receives the ticket (non-null response)
         AND N-1 agents receive null (no ticket available)
         AND the ticket's claimed_by matches the winning agent's ID
         AND exactly 1 CLAIMED event exists in the events table
         AND 0 partial state changes exist (no orphaned claims)
```

#### Implementation Specification

```typescript
// forgeos-server/src/__tests__/fitness/concurrent-claim.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

describe('FF-08: Concurrent Claim Correctness', () => {
  const CONCURRENCY = 20;
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL, max: CONCURRENCY + 5 });
    // Seed: 1 ticket in READY/BACKEND, 20 registered agents
    await seedTicketAndAgents(pool, { ticketCount: 1, agentCount: CONCURRENCY });
  });

  afterAll(async () => { await pool.end(); });

  it('exactly 1 of N concurrent claims succeeds', async () => {
    // Launch N concurrent claims using Promise.all
    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        pool.query("SELECT * FROM claim_ticket($1, $2, $3, $4, $5)", [
          'BACKEND', `agent-${i}`, `machine-test`, `operator-test`, 30
        ])
      )
    );

    const winners = results.filter(r => r.rows.length > 0 && r.rows[0].ticket_id != null);
    const losers = results.filter(r => r.rows.length === 0 || r.rows[0].ticket_id == null);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(CONCURRENCY - 1);

    // Verify exactly 1 CLAIMED event
    const events = await pool.query(
      "SELECT COUNT(*) FROM events WHERE event_type = 'CLAIMED'"
    );
    expect(Number(events.rows[0].count)).toBe(1);
  });

  it('50 agents claim from queue of 10 tickets — exactly 10 succeed', async () => {
    await seedTicketAndAgents(pool, { ticketCount: 10, agentCount: 50 });

    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        pool.query("SELECT * FROM claim_ticket($1, $2, $3, $4, $5)", [
          'BACKEND', `agent-${i}`, `machine-test`, `operator-test`, 30
        ])
      )
    );

    const winners = results.filter(r => r.rows.length > 0 && r.rows[0].ticket_id != null);
    expect(winners).toHaveLength(10);
  });
});
```

#### Expected Outcome

| Scenario | Input | Expected | Guarantee |
|----------|-------|----------|-----------|
| 20 agents, 1 ticket | 20 concurrent `claim_ticket()` | 1 winner, 19 null | STRONG (DB-enforced via SKIP LOCKED) |
| 50 agents, 10 tickets | 50 concurrent `claim_ticket()` | 10 winners, 40 null | STRONG (SKIP LOCKED) |
| Claim already-claimed ticket | 1 `claim_ticket()` against claimed | null (no double-claim) | STRONG (WHERE claimed_by IS NULL) |

#### Regression Threshold

Any non-deterministic result (e.g., 2 winners for 1 ticket) is an immediate P0 bug.

---

### 3.9 FF-09: State Transition Integrity

**Quality Attribute:** Correctness (Invariants S-1, S-2, S-3, I-3)  
**Category:** Correctness | **CI Tier:** Every PR

#### Property-Based Test Specification

Use **fast-check** (TypeScript property-based testing library) to generate arbitrary state transition sequences and verify invariants.

```typescript
// forgeos-server/src/__tests__/fitness/state-transitions.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fc from 'fast-check';
import { Pool } from 'pg';

// Valid SDLC flows per ticket type (from ticket-system.instructions.md)
const SDLC_FLOWS: Record<string, string[]> = {
  backend:      ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  frontend:     ['READY', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  fullstack:    ['READY', 'BACKEND', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  infra:        ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  security:     ['READY', 'SECURITY', 'QA', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
  docs:         ['READY', 'DOCS', 'VALIDATION', 'DONE'],
  research:     ['READY', 'RESEARCH', 'DOCS', 'VALIDATION', 'DONE'],
  architecture: ['READY', 'ARCHITECT', 'DOCS', 'VALIDATION', 'DONE'],
};

describe('FF-09: State Transition Integrity', () => {
  let pool: Pool;

  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  });
  afterAll(async () => { await pool.end(); });

  it('S-1: rejects transitions that skip stages in the SDLC flow', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...Object.keys(SDLC_FLOWS)),
        fc.integer({ min: 0, max: 7 }),
        fc.integer({ min: 0, max: 7 }),
        async (ticketType, fromIdx, toIdx) => {
          const flow = SDLC_FLOWS[ticketType];
          if (fromIdx >= flow.length || toIdx >= flow.length) return; // skip out-of-bounds
          if (toIdx === fromIdx + 1) return; // valid transition — skip

          // Create ticket at flow[fromIdx], attempt advance to flow[toIdx]
          const ticket = await createTicketAtStage(pool, ticketType, flow[fromIdx]);
          await claimTicket(pool, ticket.id);

          // Attempt invalid transition (skip or backward)
          const result = await pool.query(
            "SELECT * FROM advance_ticket($1, $2, $3, $4)",
            [ticket.id, flow[toIdx], 'test-agent', 'test-machine']
          );

          // Must be rejected (null or error)
          expect(result.rows[0]?.ticket_id).toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('S-2: rejects backward transitions (except REWORK)', async () => {
    // Create ticket at QA stage (index 2 in backend flow)
    const ticket = await createTicketAtStage(pool, 'backend', 'QA');
    const result = await pool.query(
      "SELECT * FROM advance_ticket($1, $2, $3, $4)",
      [ticket.id, 'BACKEND', 'test-agent', 'test-machine']
    );
    expect(result.rows[0]?.ticket_id).toBeNull();
  });

  it('S-3: REWORK is bounded to 3 attempts', async () => {
    const ticket = await createTicketAtStage(pool, 'backend', 'QA');

    // Reject 3 times
    for (let i = 0; i < 3; i++) {
      await pool.query(
        "SELECT * FROM reject_ticket($1, $2, $3, $4)",
        [ticket.id, 'qa-agent', 'test-machine', `rejection-${i}`]
      );
      // Re-claim and re-advance to QA for next iteration
      await reclaimAndAdvanceTo(pool, ticket.id, 'QA');
    }

    // 4th rejection should escalate, not rework
    const result = await pool.query(
      "SELECT stage, rework_count FROM tickets WHERE id = $1",
      [ticket.id]
    );
    expect(result.rows[0].rework_count).toBe(3);
    // Further reject should set ESCALATED or be refused
  });

  it('I-3: rejects invalid stage enum values', async () => {
    await expect(
      pool.query("INSERT INTO tickets (stage) VALUES ('INVALID_STAGE')")
    ).rejects.toThrow(); // CHECK constraint violation
  });
});
```

#### Expected Outcomes

| Property | Generator | Assertion |
|----------|-----------|-----------|
| No stage skipping (S-1) | Random `(ticketType, fromStage, toStage)` where `toStage ≠ fromStage + 1` | `advance_ticket` returns null |
| No backward moves (S-2) | Ticket at stage N, attempt stage M where M < N | `advance_ticket` returns null |
| Rework bounded (S-3) | Reject same ticket 4 times | `rework_count ≤ 3`; 4th → ESCALATED |
| Enum safety (I-3) | INSERT with invalid stage string | PostgreSQL constraint error |

---

### 3.10 FF-10: Dependency Resolution Correctness

**Quality Attribute:** Correctness (Invariants D-1, D-2, D-3)  
**Category:** Correctness | **CI Tier:** Every PR

#### Test Scenario: Complex Dependency Graphs

```
Scenario 1: Linear chain
  A → B → C (A depends on B, B depends on C)
  1. Create C in READY, B depends on C, A depends on B
  2. Assert B and A are BLOCKED (not in READY)
  3. Complete C → DONE
  4. Assert B moves to READY, A remains BLOCKED
  5. Complete B → DONE
  6. Assert A moves to READY

Scenario 2: Diamond dependency
      A
     / \
    B   C
     \ /
      D
  1. Create D in READY. B and C depend on D. A depends on B AND C.
  2. Complete D → DONE
  3. Assert B and C move to READY. A remains BLOCKED.
  4. Complete B → DONE
  5. Assert A remains BLOCKED (C still not DONE)
  6. Complete C → DONE
  7. Assert A moves to READY

Scenario 3: Circular dependency rejection
  A → B → C → A
  1. Attempt to create ticket C with depends_on = [A] where A depends on B and B depends on C
  2. Assert: creation rejected (cycle detected)

Scenario 4: N-wide fan-out
  A depends on [B1, B2, ..., B10]
  1. Complete B1..B9 → A remains BLOCKED
  2. Complete B10 → A moves to READY
```

#### Implementation Specification

```typescript
// forgeos-server/src/__tests__/fitness/dependency-resolution.test.ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { Pool } from 'pg';

describe('FF-10: Dependency Resolution Correctness', () => {
  let pool: Pool;

  beforeEach(async () => {
    await cleanTickets(pool);
  });

  it('D-1: linear chain unblocks sequentially', async () => {
    const c = await createTicket(pool, { type: 'backend', depends_on: [] });
    const b = await createTicket(pool, { type: 'backend', depends_on: [c.id] });
    const a = await createTicket(pool, { type: 'backend', depends_on: [b.id] });

    // B and A should not be in READY
    expect(await getStage(pool, b.id)).not.toBe('READY');
    expect(await getStage(pool, a.id)).not.toBe('READY');

    // Complete C
    await completeTicket(pool, c.id);
    await pool.query("SELECT resolve_dependencies()");

    expect(await getStage(pool, b.id)).toBe('READY');
    expect(await getStage(pool, a.id)).not.toBe('READY');

    // Complete B
    await completeTicket(pool, b.id);
    await pool.query("SELECT resolve_dependencies()");

    expect(await getStage(pool, a.id)).toBe('READY');
  });

  it('D-1: diamond dependency requires all branches', async () => {
    const d = await createTicket(pool, { type: 'backend', depends_on: [] });
    const b = await createTicket(pool, { type: 'backend', depends_on: [d.id] });
    const c = await createTicket(pool, { type: 'backend', depends_on: [d.id] });
    const a = await createTicket(pool, { type: 'backend', depends_on: [b.id, c.id] });

    await completeTicket(pool, d.id);
    await pool.query("SELECT resolve_dependencies()");

    expect(await getStage(pool, b.id)).toBe('READY');
    expect(await getStage(pool, c.id)).toBe('READY');
    expect(await getStage(pool, a.id)).not.toBe('READY');

    await completeTicket(pool, b.id);
    await pool.query("SELECT resolve_dependencies()");
    expect(await getStage(pool, a.id)).not.toBe('READY'); // C still pending

    await completeTicket(pool, c.id);
    await pool.query("SELECT resolve_dependencies()");
    expect(await getStage(pool, a.id)).toBe('READY');
  });

  it('D-2: rejects circular dependencies', async () => {
    // Attempt to create A→B→C→A cycle
    const a = await createTicket(pool, { type: 'backend', depends_on: [] });
    const b = await createTicket(pool, { type: 'backend', depends_on: [a.id] });
    await expect(
      createTicket(pool, { type: 'backend', depends_on: [b.id], forceDepOnFirst: a.id })
    ).rejects.toThrow(/circular|cycle/i);
  });

  it('D-3: N-wide fan-out requires ALL dependencies', async () => {
    const deps = await Promise.all(
      Array.from({ length: 10 }, () => createTicket(pool, { type: 'backend', depends_on: [] }))
    );
    const a = await createTicket(pool, { type: 'backend', depends_on: deps.map(d => d.id) });

    // Complete first 9
    for (let i = 0; i < 9; i++) {
      await completeTicket(pool, deps[i].id);
      await pool.query("SELECT resolve_dependencies()");
      expect(await getStage(pool, a.id)).not.toBe('READY');
    }

    // Complete 10th — now A should be READY
    await completeTicket(pool, deps[9].id);
    await pool.query("SELECT resolve_dependencies()");
    expect(await getStage(pool, a.id)).toBe('READY');
  });
});
```

---

### 3.11 FF-11: Zero-Downtime Migration

**Quality Attribute:** Availability (§5.3 — Zero-downtime cutover)  
**Category:** Operations | **CI Tier:** Weekly (soak test)

#### What to Measure During Cutover

| Metric | Measurement Point | Method |
|--------|-------------------|--------|
| Request success rate during migration | HTTP response codes | k6 continuous load during migration |
| Claim operation availability | `tickets.claim` non-error responses | k6 custom metric |
| Maximum single-request latency during migration | p100 latency | k6 max response time |
| Data consistency after migration | Ticket count, event count, stage distribution | SQL queries before/after |

#### Test Scenario

```
1. Start the MCP server + PostgreSQL with current schema (v1)
2. Begin sustained load: 5 VUs performing mixed claim/query workload
3. While load is running:
   a. Apply schema migration (v2) via `tsx src/db/migrate.ts`
   b. Monitor that migrations use online-compatible DDL:
      - CREATE INDEX CONCURRENTLY (not CREATE INDEX)
      - ALTER TABLE ... ADD COLUMN with DEFAULT (not requiring table rewrite)
      - No DROP COLUMN, no ALTER COLUMN TYPE on active tables
4. Continue load for 60 seconds after migration completes
5. Verify results
```

#### k6 Soak Script Outline (`forgeos-server/load-tests/k6-migration-soak.js`)

```javascript
export const options = {
  scenarios: {
    migration_soak: {
      executor: 'constant-vus',
      vus: 5,
      duration: '5m',  // Covers pre-migration, migration, post-migration
    },
  },
  thresholds: {
    'http_req_failed': ['rate<0.001'],        // < 0.1% error rate
    'http_req_duration': ['p(99)<500'],        // No request > 500ms
    'claim_success_rate': ['rate>0.95'],       // > 95% claims succeed (some null expected)
  },
};
```

#### Acceptable Degradation

| Metric | Normal | Acceptable During Migration | Unacceptable |
|--------|--------|-----------------------------|-------------|
| Error rate | 0% | < 0.1% (transient connection resets) | ≥ 1% |
| p99 latency | ≤ 100ms (claim) | ≤ 500ms (up to 5× normal) | > 2000ms |
| Claim success | 100% (of valid requests) | > 95% (brief queue pause OK) | < 90% |
| Data integrity | Full | Full (zero corruption) | Any inconsistency |

---

### 3.12 FF-12: API Response Time Under Load

**Quality Attribute:** Throughput (§4.1–4.2 — 50 agents, mixed workload)  
**Category:** Resource | **CI Tier:** Nightly

#### Benchmark Setup

```
Environment: Same as FF-01

Load Profile (realistic mixed workload from §4.2):
  - 60% reads (tickets.next, tickets.stats)
  - 30% claims (tickets.claim)
  - 10% advances (tickets.complete)

Duration: 10 minutes sustained
VUs: 50 (one per agent target)
Seed data: 200 tickets across various stages, 50 agents registered
```

#### k6 Script Outline (`forgeos-server/load-tests/k6-mixed-workload.js`)

```javascript
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

const OPERATIONS = [
  ...Array(6).fill('query'),     // 60% reads
  ...Array(3).fill('claim'),     // 30% claims
  ...Array(1).fill('advance'),   // 10% advances
];

export const options = {
  scenarios: {
    sustained_load: {
      executor: 'constant-vus',
      vus: 50,
      duration: '10m',
    },
  },
  thresholds: {
    'http_req_duration{operation:query}':   ['p(99)<60'],
    'http_req_duration{operation:claim}':   ['p(99)<100'],
    'http_req_duration{operation:advance}': ['p(99)<120'],
    'http_req_failed': ['rate<0.01'],
  },
};

export default function () {
  const op = randomItem(OPERATIONS);
  // Execute operation based on type
  // Tag requests with { operation: op } for per-operation metrics
}
```

#### Thresholds

| Operation | p99 Target | Regression Threshold |
|-----------|-----------|---------------------|
| Query (60%) | ≤ 60ms | > 90ms |
| Claim (30%) | ≤ 100ms | > 150ms |
| Advance (10%) | ≤ 120ms | > 180ms |
| Overall error rate | < 1% | ≥ 2% |
| Pool utilization | < 80% | ≥ 85% |

---

### 3.13 FF-13: Database Query Performance

**Quality Attribute:** Latency + Resource (§3.1, §8.2 — query plans must use indexes)  
**Category:** Resource | **CI Tier:** Every PR

#### Measurement

Vitest integration test that runs `EXPLAIN ANALYZE` on every critical query path and asserts:

1. **Index usage** — no sequential scans on tables > 100 rows
2. **Row estimates** — planner estimates within 10× of actual (healthy statistics)
3. **Execution time** — within per-operation CPU budget (§8.2)

```typescript
// forgeos-server/src/__tests__/fitness/query-performance.test.ts
import { describe, it, expect } from 'vitest';
import { Pool } from 'pg';

const CRITICAL_QUERIES = [
  {
    name: 'claim_ticket (SKIP LOCKED)',
    sql: `EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT id FROM tickets
          WHERE stage = 'BACKEND' AND claimed_by IS NULL
          ORDER BY priority DESC, created_at ASC
          FOR UPDATE SKIP LOCKED
          LIMIT 1`,
    maxExecutionMs: 30,
    mustUseIndex: true,
  },
  {
    name: 'tickets_by_stage (next query)',
    sql: `EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT * FROM tickets WHERE stage = 'READY'
          ORDER BY priority DESC, created_at ASC`,
    maxExecutionMs: 20,
    mustUseIndex: true,
  },
  {
    name: 'dependency_check',
    sql: `EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT COUNT(*) FROM tickets
          WHERE id = ANY(ARRAY['dep-1','dep-2']::uuid[])
          AND stage != 'DONE'`,
    maxExecutionMs: 10,
    mustUseIndex: true,
  },
  {
    name: 'events_by_ticket (audit)',
    sql: `EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT * FROM events
          WHERE ticket_id = 'test-ticket-id'::uuid
          ORDER BY created_at DESC`,
    maxExecutionMs: 15,
    mustUseIndex: true,
  },
  {
    name: 'expired_leases (reconciliation)',
    sql: `EXPLAIN (ANALYZE, FORMAT JSON)
          SELECT id FROM tickets
          WHERE claimed_by IS NOT NULL
          AND lease_expiry < NOW()`,
    maxExecutionMs: 20,
    mustUseIndex: true,
  },
];

describe('FF-13: Database Query Performance', () => {
  let pool: Pool;

  // Seed 500 tickets across stages for realistic statistics
  beforeAll(async () => {
    pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await seedRealisticData(pool, { tickets: 500, events: 2000 });
    await pool.query('ANALYZE'); // Update planner statistics
  });

  for (const query of CRITICAL_QUERIES) {
    it(`${query.name}: executes within ${query.maxExecutionMs}ms using indexes`, async () => {
      const result = await pool.query(query.sql);
      const plan = result.rows[0]['QUERY PLAN'][0];

      const executionTime = plan['Execution Time'];
      expect(executionTime).toBeLessThanOrEqual(query.maxExecutionMs);

      if (query.mustUseIndex) {
        const planText = JSON.stringify(plan);
        expect(planText).not.toContain('Seq Scan');
      }
    });
  }
});
```

---

### 3.14 FF-14: Test Coverage

**Quality Attribute:** Maintainability (Definition of Done #2 — ≥ 80% coverage)  
**Category:** Operations | **CI Tier:** Every PR

#### Measurement

```bash
vitest run --coverage --coverage.reporter=json
# Parse coverage-final.json for line coverage percentage
```

#### Threshold

| Metric | Target | Regression Threshold |
|--------|--------|---------------------|
| Line coverage (new code) | ≥ 80% | < 75% |
| Branch coverage (new code) | ≥ 70% | < 65% |

---

### 3.15 FF-15: Type Safety and Lint

**Quality Attribute:** Maintainability (Definition of Done #3, #4)  
**Category:** Operations | **CI Tier:** Every PR

#### Measurement

```bash
tsc --noEmit    # Must exit 0
eslint src/     # Must exit 0 (zero errors, zero warnings)
```

#### Threshold

| Check | Target | Regression Threshold |
|-------|--------|---------------------|
| TypeScript errors | 0 | ≥ 1 |
| ESLint errors | 0 | ≥ 1 |
| ESLint warnings | 0 | ≥ 1 |

---

### 3.16 FF-16: Memory Stability

**Quality Attribute:** Resource (§8.1 — MCP server ≤ 512 MB RSS)  
**Category:** Resource | **CI Tier:** Weekly (soak test)

#### Measurement

During the FF-12 sustained load test (10 minutes), sample RSS every 10 seconds:

```bash
# In parallel with k6 load test
while true; do
  docker stats forgeos-server --no-stream --format "{{.MemUsage}}" >> memory-samples.txt
  sleep 10
done
```

#### Thresholds

| Metric | Target | Regression Threshold |
|--------|--------|---------------------|
| Peak RSS | ≤ 512 MB | > 600 MB |
| RSS growth rate (linear regression) | ≤ 1 MB/min (no leak) | > 5 MB/min |
| RSS stability (std deviation) | ± 10% of mean | > 20% of mean |

---

### 3.17 FF-17: API Availability

**Quality Attribute:** Availability (§5.1 — 99.9% uptime)  
**Category:** Operations | **CI Tier:** Continuous (production only)

#### Measurement

Health endpoint polling every 15 seconds. Availability calculated over 30-day rolling window:

```
availability = (total_checks - failed_checks) / total_checks × 100
```

#### Threshold

| Metric | Target | Alert Threshold |
|--------|--------|----------------|
| 30-day availability | ≥ 99.9% | < 99.85% |
| 7-day health check availability | ≥ 99.95% | < 99.9% |

---

### 3.18 FF-18: Expired Claim Cleanup

**Quality Attribute:** Correctness (Invariant C-3 — Lease expiry releases claim)  
**Category:** Operations | **CI Tier:** Every PR

#### Test Scenario

```
1. Claim a ticket with lease_duration = 1 minute
2. Wait for lease to expire (or mock time)
3. Run release_expired_claims()
4. Assert: ticket is back in READY, claimed_by is NULL, lease_expiry is NULL
5. Assert: LEASE_EXPIRED event recorded in events table
6. Measure cleanup latency (must be < RECONCILIATION_INTERVAL + 60s)
```

#### Implementation

```typescript
// forgeos-server/src/__tests__/fitness/lease-expiry.test.ts
it('expired claims are released by reconciliation', async () => {
  // Claim with very short lease
  await pool.query(
    "SELECT * FROM claim_ticket($1, $2, $3, $4, $5)",
    ['BACKEND', 'agent-1', 'machine-1', 'operator-1', 1] // 1 minute lease
  );

  // Fast-forward time: update lease_expiry to past
  await pool.query(
    "UPDATE tickets SET lease_expiry = NOW() - INTERVAL '1 minute' WHERE claimed_by = 'agent-1'"
  );

  // Run reconciliation
  await pool.query("SELECT release_expired_claims()");

  // Verify
  const ticket = await pool.query(
    "SELECT stage, claimed_by, lease_expiry FROM tickets WHERE claimed_by = 'agent-1'"
  );
  expect(ticket.rows).toHaveLength(0); // No ticket claimed by agent-1

  const events = await pool.query(
    "SELECT event_type FROM events WHERE event_type = 'LEASE_EXPIRED' ORDER BY created_at DESC LIMIT 1"
  );
  expect(events.rows[0].event_type).toBe('LEASE_EXPIRED');
});
```

---

## 4. Verification Tooling

### 4.1 Tooling Recommendations

| Tool | Purpose | Fitness Functions | License | Installation |
|------|---------|-------------------|---------|-------------|
| **[k6](https://k6.io/)** | HTTP load testing with thresholds | FF-01–FF-05, FF-11, FF-12 | AGPL-3.0 | `brew install k6` or Docker `grafana/k6` |
| **[Vitest](https://vitest.dev/)** | Unit/integration testing + benchmarks | FF-08–FF-10, FF-13, FF-14, FF-18 | MIT | Already in `devDependencies` |
| **[fast-check](https://fast-check.dev/)** | Property-based testing (TypeScript) | FF-09 (state transitions) | MIT | `npm install -D fast-check` |
| **[Prometheus](https://prometheus.io/)** | Metrics collection + alerting | FF-06, FF-07, FF-16, FF-17 | Apache-2.0 | Docker `prom/prometheus` |
| **[Grafana](https://grafana.com/)** | Metrics visualization + dashboards | All production metrics | AGPL-3.0 | Docker `grafana/grafana` |
| **[prom-client](https://github.com/siimon/prom-client)** | Node.js Prometheus exporter | FF-06, FF-07, FF-16 | Apache-2.0 | `npm install prom-client` |

### 4.2 Tooling Selection Rationale (ADR-012)

See [§8 ADR-012](#8-adr-012-fitness-function-tooling-selection) for the scored evaluation matrix.

### 4.3 Tooling Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   CI Pipeline                           │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐  │
│  │ Vitest   │  │ tsc/lint │  │ k6 load tests        │  │
│  │ FF-08-10 │  │ FF-14-15 │  │ FF-01-05, FF-11-12   │  │
│  │ FF-13,18 │  │          │  │                       │  │
│  └────┬─────┘  └────┬─────┘  └────┬──────────────────┘  │
│       │              │             │                     │
│       └──────────────┼─────────────┘                     │
│                      ▼                                   │
│            ┌─────────────────┐                           │
│            │ CI Results JSON │                           │
│            │ (artifacts)     │                           │
│            └────────┬────────┘                           │
│                     │                                    │
│            ┌────────▼────────┐                           │
│            │ Baseline Compare│                           │
│            │ (regression)    │                           │
│            └─────────────────┘                           │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│                Production Monitoring                     │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ prom-client  │  │ Prometheus   │  │ Grafana       │  │
│  │ (app metrics)│──│ (scrape/     │──│ (dashboards/  │  │
│  │ FF-06,07,16  │  │  store/alert)│  │  alerting)    │  │
│  └──────────────┘  └──────────────┘  └───────────────┘  │
│                                                          │
│  Metrics: pool_utilization, deadlock_count, rss_bytes,   │
│           request_duration_ms, claim_success_total,      │
│           health_check_status                            │
└─────────────────────────────────────────────────────────┘
```

---

## 5. CI/CD Integration Plan

### 5.1 Pipeline Tiers

| Tier | Trigger | Duration | Fitness Functions |
|------|---------|----------|-------------------|
| **PR Gate** (blocking) | Every PR to `staged` | ~5 min | FF-07, FF-08, FF-09, FF-10, FF-13, FF-14, FF-15, FF-18 |
| **PR Extended** (non-blocking) | Every PR to `staged` | ~8 min | FF-01, FF-02, FF-03, FF-04 |
| **Nightly** | Cron 02:00 UTC | ~20 min | FF-06, FF-12 |
| **Weekly** | Cron Sunday 04:00 UTC | ~30 min | FF-05, FF-11, FF-16 |
| **Continuous** | Production only | Always | FF-17 |

### 5.2 GitHub Actions Workflow

```yaml
# .github/workflows/fitness-functions.yml
name: Fitness Functions

on:
  pull_request:
    branches: [staged]
    paths:
      - 'forgeos-server/src/**'
      - 'forgeos-server/load-tests/**'
      - 'forgeos-server/package.json'
  schedule:
    - cron: '0 2 * * *'     # Nightly at 02:00 UTC
    - cron: '0 4 * * 0'     # Weekly on Sunday at 04:00 UTC

permissions:
  contents: read
  pull-requests: write

concurrency:
  group: fitness-${{ github.event.pull_request.number || github.ref }}
  cancel-in-progress: true

env:
  TEST_DATABASE_URL: postgresql://forgeos:testpass@localhost:5432/forgeos_test

jobs:
  # ── PR Gate (blocking) ──────────────────────────────
  pr-gate:
    name: PR Gate — Correctness & Static
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 10
    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_DB: forgeos_test
          POSTGRES_USER: forgeos
          POSTGRES_PASSWORD: testpass
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U forgeos"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'
          cache: 'npm'
          cache-dependency-path: forgeos-server/package-lock.json

      - name: Install dependencies
        working-directory: forgeos-server
        run: npm ci

      - name: Run migrations
        working-directory: forgeos-server
        run: npx tsx src/db/migrate.ts

      - name: FF-14/15 — Type check & Lint
        working-directory: forgeos-server
        run: |
          npx tsc --noEmit
          npx eslint src/

      - name: FF-08/09/10/13/18 — Correctness tests
        working-directory: forgeos-server
        run: npx vitest run src/__tests__/fitness/ --reporter=json --outputFile=fitness-results.json

      - name: FF-07 — Zero deadlocks check
        working-directory: forgeos-server
        run: |
          DEADLOCKS=$(psql "$TEST_DATABASE_URL" -t -c "SELECT deadlocks FROM pg_stat_database WHERE datname = 'forgeos_test'")
          echo "Deadlocks after tests: $DEADLOCKS"
          if [ "$DEADLOCKS" -gt 0 ]; then echo "::error::FF-07 FAILED: $DEADLOCKS deadlocks detected"; exit 1; fi

      - name: FF-14 — Coverage check
        working-directory: forgeos-server
        run: |
          npx vitest run --coverage --coverage.reporter=json
          node -e "
            const cov = require('./coverage/coverage-final.json');
            const files = Object.values(cov);
            let totalStatements = 0, coveredStatements = 0;
            files.forEach(f => {
              const s = f.statementMap; const sc = f.s;
              totalStatements += Object.keys(s).length;
              coveredStatements += Object.values(sc).filter(v => v > 0).length;
            });
            const pct = (coveredStatements / totalStatements) * 100;
            console.log('Coverage: ' + pct.toFixed(1) + '%');
            if (pct < 80) { console.error('FF-14 FAILED: coverage ' + pct.toFixed(1) + '% < 80%'); process.exit(1); }
          "

      - name: Upload fitness results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: fitness-pr-gate
          path: forgeos-server/fitness-results.json

  # ── PR Extended (non-blocking latency tests) ───────
  pr-extended:
    name: PR Extended — Latency Benchmarks
    if: github.event_name == 'pull_request'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: pr-gate

    services:
      postgres:
        image: postgres:17
        env:
          POSTGRES_DB: forgeos_test
          POSTGRES_USER: forgeos
          POSTGRES_PASSWORD: testpass
        ports: ['5432:5432']
        options: >-
          --health-cmd "pg_isready -U forgeos"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 5

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: forgeos-server/package-lock.json }

      - name: Install dependencies & migrate
        working-directory: forgeos-server
        run: |
          npm ci
          npx tsx src/db/migrate.ts

      - name: Start MCP server
        working-directory: forgeos-server
        run: |
          node dist/index.js &
          sleep 3  # Wait for server startup

      - name: Install k6
        run: |
          sudo gpg -k
          sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D68
          echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
          sudo apt-get update && sudo apt-get install -y k6

      - name: FF-01/02/03/04 — Latency benchmarks
        working-directory: forgeos-server
        run: |
          k6 run load-tests/k6-claim-latency.js \
            --env MCP_URL=http://localhost:3000 \
            --env API_KEY=${{ secrets.TEST_API_KEY || 'forgeos_admin_CHANGE_ME' }} \
            --out json=latency-results.json
        continue-on-error: true  # Non-blocking

      - name: Compare against baseline
        working-directory: forgeos-server
        run: |
          if [ -f load-tests/baselines/claim-latency.json ]; then
            node load-tests/compare-baseline.js latency-results.json load-tests/baselines/claim-latency.json
          else
            echo "No baseline found — skipping comparison (first run)"
          fi
        continue-on-error: true

      - name: Upload latency results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: fitness-pr-latency
          path: forgeos-server/latency-results.json

  # ── Nightly (sustained load) ────────────────────────
  nightly:
    name: Nightly — Sustained Load
    if: github.event.schedule == '0 2 * * *'
    runs-on: ubuntu-latest
    timeout-minutes: 30

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: forgeos-server/package-lock.json }

      - name: Start full Docker stack
        working-directory: forgeos-server
        run: docker compose up -d --build

      - name: Wait for healthy
        run: |
          for i in $(seq 1 30); do
            curl -sf http://localhost:3000/health && break || sleep 2
          done

      - name: Install k6
        run: sudo apt-get update && sudo apt-get install -y k6

      - name: FF-12 — Mixed workload (10 min)
        working-directory: forgeos-server
        run: |
          k6 run load-tests/k6-mixed-workload.js \
            --env MCP_URL=http://localhost:3000 \
            --env API_KEY=forgeos_admin_CHANGE_ME \
            --out json=nightly-results.json

      - name: FF-06 — Pool utilization check
        run: |
          # Extract pool metrics from k6 custom metrics or Pino logs
          docker logs forgeos-server 2>&1 | grep pool_exhaustion && echo "::error::FF-06 FAILED" && exit 1 || echo "FF-06 PASS"

      - name: Update baseline
        working-directory: forgeos-server
        run: |
          mkdir -p load-tests/baselines
          cp nightly-results.json load-tests/baselines/claim-latency.json

      - name: Cleanup
        if: always()
        working-directory: forgeos-server
        run: docker compose down -v

  # ── Weekly (soak + migration) ───────────────────────
  weekly:
    name: Weekly — Soak & Migration Tests
    if: github.event.schedule == '0 4 * * 0'
    runs-on: ubuntu-latest
    timeout-minutes: 45

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm', cache-dependency-path: forgeos-server/package-lock.json }

      - name: Start Docker stack
        working-directory: forgeos-server
        run: docker compose up -d --build

      - name: Install k6
        run: sudo apt-get update && sudo apt-get install -y k6

      - name: FF-11 — Zero-downtime migration soak
        working-directory: forgeos-server
        run: k6 run load-tests/k6-migration-soak.js --env MCP_URL=http://localhost:3000

      - name: FF-16 — Memory stability check
        run: |
          # Collect 30 samples over 5 minutes
          for i in $(seq 1 30); do
            docker stats forgeos-server --no-stream --format "{{.MemUsage}}" >> memory-samples.txt
            sleep 10
          done
          # Check no sample > 600MB and growth rate < 5MB/min
          node -e "
            const fs = require('fs');
            const samples = fs.readFileSync('memory-samples.txt','utf8').trim().split('\n')
              .map(l => parseFloat(l.replace(/[^0-9.]/g,'')));
            const max = Math.max(...samples);
            const growth = (samples[samples.length-1] - samples[0]) / 5; // MB per min
            console.log('Peak RSS:', max, 'MB, Growth:', growth.toFixed(1), 'MB/min');
            if (max > 600) { console.error('FF-16 FAILED: peak RSS', max, '> 600MB'); process.exit(1); }
            if (growth > 5) { console.error('FF-16 FAILED: growth', growth, '> 5MB/min'); process.exit(1); }
          "

      - name: FF-05 — SSE broadcast latency
        working-directory: forgeos-server
        run: npx vitest run src/__tests__/fitness/sse-broadcast.test.ts

      - name: Cleanup
        if: always()
        working-directory: forgeos-server
        run: docker compose down -v
```

### 5.3 Pipeline Decision Matrix

| Fitness Function | Blocks PR Merge? | Requires DB? | Requires Running Server? | Requires k6? |
|------------------|-----------------|-------------|-------------------------|-------------|
| FF-01–04 | No (advisory) | Yes | Yes | Yes |
| FF-05 | No (advisory) | Yes | Yes | No (Vitest) |
| FF-06 | No (nightly) | Yes | Yes | Yes |
| FF-07 | Yes | Yes | No | No |
| FF-08–10 | Yes | Yes | No | No |
| FF-11 | No (weekly) | Yes | Yes | Yes |
| FF-12 | No (nightly) | Yes | Yes | Yes |
| FF-13 | Yes | Yes | No | No |
| FF-14 | Yes | No | No | No |
| FF-15 | Yes | No | No | No |
| FF-16 | No (weekly) | Yes | Yes | Yes |
| FF-17 | N/A (production) | N/A | N/A | N/A |
| FF-18 | Yes | Yes | No | No |

---

## 6. Automated Test Implementation Guidelines

### 6.1 Test File Organization

```
forgeos-server/
├── src/__tests__/
│   └── fitness/
│       ├── concurrent-claim.test.ts      # FF-08
│       ├── state-transitions.test.ts     # FF-09
│       ├── dependency-resolution.test.ts # FF-10
│       ├── query-performance.test.ts     # FF-13
│       ├── lease-expiry.test.ts          # FF-18
│       └── sse-broadcast.test.ts         # FF-05
├── load-tests/
│   ├── k6-claim-latency.js              # FF-01, FF-02, FF-03, FF-04
│   ├── k6-mixed-workload.js             # FF-12
│   ├── k6-migration-soak.js             # FF-11
│   ├── compare-baseline.js              # Regression comparison script
│   └── baselines/
│       └── claim-latency.json           # Baseline metrics from main branch
└── vitest.config.ts                      # Updated to include fitness/ tests
```

### 6.2 Test Database Setup

All correctness fitness functions (FF-08, FF-09, FF-10, FF-13, FF-18) require a real PostgreSQL instance (no mocking — these test DB-enforced invariants).

```typescript
// forgeos-server/src/__tests__/fitness/setup.ts
import { Pool } from 'pg';

export async function createTestPool(): Promise<Pool> {
  const pool = new Pool({
    connectionString: process.env.TEST_DATABASE_URL
      || 'postgresql://forgeos:testpass@localhost:5432/forgeos_test',
    max: 30, // Higher than default to support concurrent claim tests
  });
  return pool;
}

export async function seedTicketAndAgents(
  pool: Pool,
  opts: { ticketCount: number; agentCount: number }
): Promise<void> {
  // Create project
  await pool.query(`
    INSERT INTO projects (id, name, workspace_path)
    VALUES (gen_random_uuid(), 'test-project', '/tmp/test')
    ON CONFLICT DO NOTHING
  `);

  // Create agents
  for (let i = 0; i < opts.agentCount; i++) {
    await pool.query(`
      INSERT INTO agents (id, name, agent_type, capabilities)
      VALUES (gen_random_uuid(), $1, 'backend', '{}')
    `, [`agent-${i}`]);
  }

  // Create tickets in READY stage
  for (let i = 0; i < opts.ticketCount; i++) {
    await pool.query(`
      INSERT INTO tickets (id, title, type, stage, priority, sdlc_flow, project_id)
      VALUES (gen_random_uuid(), $1, 'backend', 'READY', 'medium',
              ARRAY['READY','BACKEND','QA','SECURITY','CI','DOCS','VALIDATION','DONE']::ticket_stage[],
              (SELECT id FROM projects LIMIT 1))
    `, [`test-ticket-${i}`]);
  }
}

export async function cleanTickets(pool: Pool): Promise<void> {
  await pool.query('DELETE FROM events');
  await pool.query('DELETE FROM file_locks');
  await pool.query('DELETE FROM tickets');
}
```

### 6.3 Naming Conventions

| Convention | Example | Rationale |
|-----------|---------|-----------|
| Test file suffix | `*.test.ts` for Vitest | Matches vitest `include` pattern |
| k6 script prefix | `k6-*.js` | Clear identification as load test scripts |
| Describe blocks | `'FF-XX: Fitness Function Name'` | Traceable to catalog |
| Baseline files | `*.json` in `baselines/` | Machine-readable for comparison |

### 6.4 Helper Function Patterns

Tests should use shared helper functions for common operations:

```typescript
// Helper: create ticket at specific stage (bypassing normal flow for testing)
async function createTicketAtStage(pool: Pool, type: string, stage: string): Promise<{ id: string }> { ... }

// Helper: complete ticket through to DONE
async function completeTicket(pool: Pool, ticketId: string): Promise<void> { ... }

// Helper: get current stage of ticket
async function getStage(pool: Pool, ticketId: string): Promise<string> { ... }

// Helper: claim and advance ticket to specific stage
async function reclaimAndAdvanceTo(pool: Pool, ticketId: string, stage: string): Promise<void> { ... }
```

### 6.5 DevDependencies to Add

```json
{
  "devDependencies": {
    "fast-check": "^3.15.0"
  }
}
```

Runtime monitoring dependencies (for production fitness functions):

```json
{
  "dependencies": {
    "prom-client": "^15.1.0"
  }
}
```

---

## 7. Regression Detection Strategy

### 7.1 Baseline Management

```
Lifecycle:
1. First run on main: k6 results become the initial baseline
2. Each nightly run on main: baseline is updated with latest results
3. Each PR run: compared against stored baseline
4. Manual reset: operator runs `npm run fitness:reset-baseline`
```

**Baseline file format** (`forgeos-server/load-tests/baselines/claim-latency.json`):

```json
{
  "version": 1,
  "updated_at": "2026-03-07T02:00:00Z",
  "metrics": {
    "claim_p50_ms": 12,
    "claim_p95_ms": 38,
    "claim_p99_ms": 72,
    "advance_p50_ms": 16,
    "advance_p95_ms": 45,
    "advance_p99_ms": 88,
    "query_p50_ms": 7,
    "query_p95_ms": 22,
    "query_p99_ms": 41,
    "health_p50_ms": 3,
    "health_p99_ms": 12
  }
}
```

### 7.2 Comparison Script

```javascript
// forgeos-server/load-tests/compare-baseline.js
const fs = require('fs');

const WARN_THRESHOLD = 0.20;  // 20% degradation → warn
const FAIL_THRESHOLD = 0.50;  // 50% degradation → fail

const [currentFile, baselineFile] = process.argv.slice(2);
const current = JSON.parse(fs.readFileSync(currentFile, 'utf8'));
const baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));

let hasFailure = false;
for (const [key, baseVal] of Object.entries(baseline.metrics)) {
  const curVal = current.metrics[key];
  if (curVal === undefined) continue;

  const degradation = (curVal - baseVal) / baseVal;
  if (degradation > FAIL_THRESHOLD) {
    console.error(`FAIL: ${key} degraded ${(degradation * 100).toFixed(0)}% (${baseVal} → ${curVal})`);
    hasFailure = true;
  } else if (degradation > WARN_THRESHOLD) {
    console.warn(`WARN: ${key} degraded ${(degradation * 100).toFixed(0)}% (${baseVal} → ${curVal})`);
  } else {
    console.log(`OK: ${key} within tolerance (${baseVal} → ${curVal})`);
  }
}

if (hasFailure) process.exit(1);
```

### 7.3 Trend Tracking

| Mechanism | Frequency | Retention | Purpose |
|-----------|-----------|-----------|---------|
| CI artifacts (k6 JSON) | Every PR + Nightly | 30 days | Historical comparison |
| Baseline file in repo | Updated nightly | Git history | Authoritative reference |
| Grafana dashboard (production) | Continuous | 90 days | Long-term trend visualization |

### 7.4 Alerting Escalation

| Severity | Condition | Channel | Action |
|----------|-----------|---------|--------|
| INFO | Metric within target | CI log | No action |
| WARN | 20–50% degradation | PR comment | Investigate before merge |
| ERROR | > 50% degradation | PR status check FAIL | Block merge, investigate |
| CRITICAL | Correctness failure (FF-08, FF-09) | Immediate | P0 bug, stop all merges |

---

## 8. ADR-012: Fitness Function Tooling Selection

### Status

**PROPOSED** — 2026-03-07

### Context

ForgeOS needs automated fitness functions to validate quality attributes defined in FORGEOS-ARCH011. The system requires load testing, property-based testing, metrics collection, and visualization tooling that integrates with the existing GitHub Actions CI pipeline and Vitest test infrastructure.

### Options Evaluated

#### Load Testing Tool

| Criterion | k6 | Locust | Artillery | autocannon |
|-----------|----|---------|-----------|-----------| 
| **TypeScript/JS support** | 9 (native JS) | 3 (Python) | 8 (YAML + JS) | 9 (Node.js) |
| **Threshold assertions** | 10 (built-in) | 5 (manual) | 7 (built-in) | 3 (manual) |
| **CI integration** | 9 (JSON output) | 6 (CSV) | 8 (JSON) | 6 (stdout) |
| **Histogram metrics** | 10 (native) | 7 (plugin) | 8 (native) | 5 (limited) |
| **Resource efficiency** | 10 (Go binary) | 5 (Python) | 7 (Node.js) | 8 (Node.js) |
| **Community/docs** | 9 | 8 | 7 | 6 |
| **Total** | **57** | **34** | **45** | **37** |

**Decision: k6** — best-in-class threshold support, lightweight Go binary, native JSON output for CI comparison.

#### Property-Based Testing

| Criterion | fast-check | jsverify | hypothesis (Python) |
|-----------|-----------|---------|-------------------|
| **TypeScript support** | 10 (native) | 5 (weak types) | 0 (Python only) |
| **Vitest integration** | 10 (native) | 6 (adapter) | 0 |
| **Generator quality** | 9 | 6 | 10 |
| **Shrinking** | 9 (automatic) | 7 | 10 |
| **Maintenance** | 9 (active) | 2 (unmaintained) | 10 |
| **Total** | **47** | **26** | **30** |

**Decision: fast-check** — native TypeScript, seamless Vitest integration, active maintenance.

#### Metrics Collection

| Criterion | prom-client | StatsD | OpenTelemetry |
|-----------|------------|--------|---------------|
| **Node.js support** | 10 | 7 | 9 |
| **Prometheus compat** | 10 (native) | 5 (adapter) | 8 (exporter) |
| **Complexity** | 9 (simple) | 7 | 4 (heavy SDK) |
| **Overhead** | 9 (minimal) | 8 | 5 (moderate) |
| **Team familiarity** | 8 | 6 | 4 |
| **Total** | **46** | **33** | **30** |

**Decision: prom-client** — minimal overhead, native Prometheus format, simple API.

### Consequences

- **Positive:** All tools are open-source with MIT/Apache-2.0 licenses (except k6 AGPL — acceptable for internal CI use)
- **Positive:** k6 + fast-check + prom-client cover all verification needs with minimal integration overhead
- **Positive:** k6 Docker image available for reproducible CI environments
- **Negative:** k6 scripts are JavaScript (not TypeScript) — limited type safety in load test scripts
- **Risk:** prom-client adds a runtime dependency — mitigated by lazy initialization (only active when `METRICS_ENABLED=true`)

---

## 9. DAG Task Graph

### Implementation Order

```
                ┌──────────────────┐
                │ Install tooling  │
                │ (fast-check, k6, │
                │  prom-client)    │
                └────────┬─────────┘
                         │
              ┌──────────┼──────────┐
              ▼          ▼          ▼
     ┌────────────┐ ┌────────┐ ┌───────────┐
     │ Test setup │ │ k6     │ │ Prometheus│
     │ helpers    │ │ scripts│ │ metrics   │
     │ (setup.ts) │ │        │ │ exporter  │
     └─────┬──────┘ └───┬────┘ └─────┬─────┘
           │             │            │
     ┌─────┼─────────────┼────────────┘
     ▼     ▼             ▼
  ┌──────────────────────────────────┐
  │  Correctness tests (parallel):   │
  │  FF-08 concurrent-claim.test.ts  │
  │  FF-09 state-transitions.test.ts │
  │  FF-10 dependency-resolution.ts  │
  │  FF-13 query-performance.test.ts │
  │  FF-18 lease-expiry.test.ts      │
  └──────────────┬───────────────────┘
                 │
     ┌───────────┼───────────┐
     ▼           ▼           ▼
  ┌────────┐ ┌────────┐ ┌────────────┐
  │ k6     │ │ k6     │ │ k6         │
  │ claim  │ │ mixed  │ │ migration  │
  │ latency│ │ load   │ │ soak       │
  └───┬────┘ └───┬────┘ └─────┬──────┘
      │           │            │
      └───────────┼────────────┘
                  ▼
       ┌──────────────────────┐
       │ CI workflow          │
       │ (fitness-functions   │
       │  .yml)               │
       └──────────┬───────────┘
                  │
       ┌──────────▼───────────┐
       │ Baseline compare     │
       │ script + initial     │
       │ baseline generation  │
       └──────────────────────┘
```

### Critical Path

1. Install tooling (fast-check, k6) → ~1 hour
2. Test setup helpers (setup.ts) → ~2 hours
3. Correctness tests (FF-08, FF-09, FF-10, FF-13, FF-18) → ~8 hours (parallelizable)
4. CI workflow integration → ~2 hours
5. **Critical path total: ~13 hours**

### Parallel Work Groups

| Group | Tasks | Prerequisite |
|-------|-------|-------------|
| A (Correctness) | FF-08, FF-09, FF-10, FF-13, FF-18 tests | Test setup helpers |
| B (Load Tests) | k6 scripts for FF-01–04, FF-12 | k6 installed |
| C (Migration Soak) | k6 script for FF-11 | k6 installed + Docker stack |
| D (Metrics) | prom-client exporter for FF-06, FF-07, FF-16 | prom-client installed |
| E (CI) | GitHub Actions workflow | Groups A + B complete |

---

## Related Documents

| Document | Ticket | Relationship |
|----------|--------|-------------|
| [Quality Attributes & Performance Targets](quality-attributes.md) | FORGEOS-ARCH011 | Upstream — defines all thresholds and invariants verified by these fitness functions |
| [Database Schema Architecture](database-schema.md) | FORGEOS-ARCH005 | Stored functions tested by FF-08, FF-09, FF-10, FF-13 |
| [System Component Architecture](system-components.md) | FORGEOS-ARCH001 | System topology for load test environment setup |
| [Database Indexes](database-indexes.md) | — | Index strategy verified by FF-13 query performance |
| [PG Distributed Locking](../research/pg-distributed-locking.md) | FORGEOS-RES005 | Evidence base for FF-08 concurrent claim design |
| [PG Connection Pooling](../research/pg-connection-pooling.md) | FORGEOS-RES006 | Pool sizing assumptions validated by FF-06 |

---

*Document created: 2026-03-07. Last reviewed: 2026-03-07. Diátaxis quadrant: Reference. Next review due: 2026-06-07.*
