---
title: "ADR-009: Durable Prompt Compile Queue with Retry and Idempotency"
ticket: CTO-prompt-compiler-architecture
type: architecture
author: Architect
date: 2026-03-14T00:00:00Z
status: PROPOSED
tags: [architecture, adr, prompt-compiler, queue, reliability]
---

# ADR-009: Durable Prompt Compile Queue with Retry and Idempotency

> **Ticket:** CTO-prompt-compiler-architecture | **Agent:** Architect | **Date:** 2026-03-14  
> **Confidence:** HIGH (87%) | **Status:** PROPOSED

## 1. Status

**PROPOSED** - 2026-03-14

## 2. Context

Current compile triggering is fire-and-forget from transition and claim paths. This is fast but not durable and can lose work across process restarts. Prompt compilation needs reliability guarantees, controlled retries, and deduplication.

Existing anchors:

- `forgeos-server/src/services/compiler.ts` has in-process `queueCompileTicketPrompt`.
- `forgeos-server/src/webhooks/reconciliation.ts` enqueues compile on transitions.
- No durable job table or idempotency keys currently defined.

## 3. Alternatives Evaluated

### 3.1 In-Process Queue Only

- Pros: minimal implementation effort
- Cons: non-durable, weak retry semantics, poor auditability

### 3.2 External Broker (Redis/Kafka)

- Pros: high throughput and mature queue semantics
- Cons: adds operational dependency and complexity not required for current scale

### 3.3 PostgreSQL Durable Job Queue (Chosen)

- Pros: transactionally aligned with ticket state, durable, auditable, MCP-first friendly
- Cons: additional DB table/worker logic required

## 4. Decision

Adopt DB-backed queue table (`prompt_compile_jobs`) with worker pull pattern using row-level locking and retry metadata.

Core semantics:

- Job statuses: `PENDING`, `RUNNING`, `DONE`, `FAILED`, `DEAD`
- Unique idempotency key: `ticket_id:target_context_hash:packet_schema:template_version`
- Retry policy: exponential backoff with jitter
- Dead-letter state (`DEAD`) after max attempts
- Observable queue metrics and error taxonomy

## 5. Consequences

### Positive

- No job loss on restart.
- Replayable and auditable compilation lifecycle.
- Safe deduplication under event bursts.

### Negative

- Extra storage and worker operational overhead.
- Requires careful worker concurrency controls.

### Risks

- Backlog growth under sustained provider outages.
- Retry storms if backoff policy is misconfigured.

Mitigation: bounded concurrency, circuit breakers, alert thresholds.

## 6. Verification

- Restart resilience test: pending jobs survive restart and complete.
- Idempotency test: duplicate enqueue events result in one effective compile.
- Retry test: transient failures eventually succeed within retry budget.
