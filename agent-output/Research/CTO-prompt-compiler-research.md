# Prompt Compiler Deterministic Execution Packet Research

**Ticket:** CTO-prompt-compiler-research  
**Stage:** RESEARCH  
**Date:** 2026-03-14  
**Author:** Research Analyst  
**Prior belief:** "Prompt Compiler phases 1-8 are mostly greenfield" (55%)  
**Posterior belief:** 84% (repo evidence shows substantial partial implementation already exists)

## Executive Summary

The Prompt Compiler architecture in `prompt_plan.md` is feasible with the current ForgeOS codebase, but it is not net-new. Phases 1, 2, 4, 5, 6, and 7 already have partial implementations in `forgeos-server/`; the largest missing pieces are deterministic freshness controls (`context_hash`) and a durable compile queue contract.

Most critical recommendation:
- Move from "compiled prompt exists" checks to "compiled prompt is fresh for this exact context" checks using a deterministic `context_hash` derived from repo commit, cognition graph version, and memory snapshot version.

## Current Repo Baseline (Ground Truth)

Implemented or partially implemented now:
- JIT Prompt Compiler service with Gemini-first + fallback: `forgeos-server/src/services/compiler.ts`
- Prompt columns on ticket record: `forgeos-server/src/db/migrations/007-compiled-prompt.sql`
- Claim delivery already returns `compiled_prompt` and `system_directive`: `forgeos-server/src/tools/tickets-claim.ts`
- Fire-and-forget precompile trigger exists on READY transitions: `forgeos-server/src/webhooks/reconciliation.ts`
- Additional prompt generation path via metadata (`agent_prompt`) exists: `forgeos-server/src/tools/tickets-attach-prompts.ts`
- Cognition tables/functions exist: `forgeos-server/src/db/migrations/003-code-graph.sql`
- Memory engine tables/functions exist: `forgeos-server/src/db/migrations/005-memory-engine.sql`

Not implemented now (key gaps):
- No `context_hash` field in schema/runtime
- No deterministic freshness gate before returning compiled prompt
- No durable retryable compile job queue (current queue is in-process fire-and-forget)
- No unified packet contract explicitly returning both `compiled_prompt` and canonical `raw_payload`

## Feasibility Assessment by Phase (1-8)

| Phase | Feasibility | Current State | Key Gaps | Risks | Confidence |
|---|---|---|---|---|---|
| 1. Prompt Compiler Service | High | `compiler.ts` already compiles + stores prompts | Packet schema not yet strict to `prompt_plan.md` sections | Prompt shape drift across models/fallbacks | HIGH |
| 2. Execution Packet Storage | High | compiled prompt columns exist in migration 007 | Missing `context_hash`, `compiled_at` alias consistency, version fields | Backward compatibility with existing consumers | HIGH |
| 3. Prompt Freshness Validation | Medium-High | Claim returns compiled prompt if present | No hash compare, no stale invalidation policy | Stale directives after repo/memory/index updates | MEDIUM |
| 4. Background Compilation | Medium-High | Trigger exists on READY and claim fallback compile | No durable queue/retry/visibility, trigger scope mismatch vs plan | Lost jobs on process restarts, silent lag | MEDIUM |
| 5. IDE Delivery Model | High | `tickets.claim` already returns `compiled_prompt` + `system_directive` | Explicit `raw_payload` contract not standardized in same response shape | Client divergence between SDKs | HIGH |
| 6. Memory Injection | High | Compiler calls memory lesson tools; memory engine is implemented | Need deterministic snapshot versioning for freshness | Prompt drift from memory churn | HIGH |
| 7. Cognition Injection | High | Compiler calls blast radius + symbol search | Need deterministic graph version derivation | Prompt drift from re-indexing | HIGH |
| 8. Repository Decoupling | Medium | MCP-first architecture exists; some context still file-backed (`agent-output`) | Full decoupling from markdown handoff not complete by design | Breaking existing stage handoff process too early | MEDIUM |

## Recommended Low-Cost Synthesis Models

### Primary Recommendation
- **Gemini Flash as default synthesis model**, with strict deterministic prompt-template post-processing (normalize section order, headings, and boilerplate) to reduce model variance.

### Candidate Options and Trade-Offs

| Option | Cost Posture | Strengths | Trade-Offs | Recommended Use |
|---|---|---|---|---|
| Gemini Flash (current default in repo) | Very low hosted cost | Fast, low-cost, large-context capable, already integrated path in `compiler.ts` | Latency can vary by region/load; hosted dependency | Default online synthesis path |
| GPT-4o mini | Low-mid hosted cost | Strong instruction adherence and broad tooling ecosystem | Higher cost vs Flash in many workloads | Fallback for quality-sensitive packet synthesis |
| Claude Haiku class | Mid hosted cost | Good summarization quality, long context class options | Usually higher cost than Flash/4o-mini; pricing volatility | Selective use for long-context narrative packets |
| Llama 3.1 8B Instruct (self-host) | Low variable infra cost | Cheap at scale, local control, data residency | Ops burden, quality variance, tool-call formatting drift | Offline/local fallback or privacy-constrained deployments |
| Qwen 2.5 7B/14B (self/hosted variants) | Low-mid | Good price/perf in some providers | Integration and consistency vary by host/runtime | Secondary self-host alternative |

### Model Strategy
- Tier 1 (default): Gemini Flash
- Tier 2 (quality fallback): GPT-4o mini
- Tier 3 (offline/local): Llama 3.1 8B

### External Pricing/Capability References
- Google Gemini API pricing: https://ai.google.dev/gemini-api/docs/pricing
- Gemini Flash update note: https://developers.googleblog.com/gemini-15-flash-updates-google-ai-studio-gemini-api/
- OpenAI GPT-4o mini: https://openai.com/index/gpt-4o-mini-advancing-cost-efficient-intelligence/
- Anthropic pricing: https://platform.claude.com/docs/en/about-claude/pricing

## Deterministic `context_hash` Design

### Required Inputs
`context_hash` MUST hash these three components exactly:
1. `repo_commit`
2. `cognition_graph_version`
3. `memory_snapshot_version`

### Canonical Construction

```text
repo_commit = exact VCS SHA associated with ticket context
cognition_graph_version = SHA256(canonical list of code_files as "file_path:content_hash" sorted lexicographically)
memory_snapshot_version = SHA256(canonical list of lessons as "id:updated_at:model_name" sorted lexicographically)

context_material = "repo=" + repo_commit + "|graph=" + cognition_graph_version + "|memory=" + memory_snapshot_version
context_hash = SHA256(context_material)
```

### Why this fits current schema
- Graph source material already exists in `code_files.file_path/content_hash`: `forgeos-server/src/db/migrations/003-code-graph.sql`
- Memory source material already exists in `lessons.updated_at` and `lesson_embeddings.model_name`: `forgeos-server/src/db/migrations/005-memory-engine.sql`
- Prompt columns already exist and can be extended with `context_hash`: `forgeos-server/src/db/migrations/007-compiled-prompt.sql`

## Freshness Validation Algorithm (Recommended)

### Algorithm

```text
on ticket_claim(ticket_id):
  row = load ticket
  current_context_hash = compute_context_hash(ticket_id)

  if row.compiled_prompt is null:
      enqueue_compile(ticket_id, reason="missing")
      return raw_payload + "compile_pending"

  if row.context_hash != current_context_hash:
      mark_stale(ticket_id)
      enqueue_compile(ticket_id, reason="stale")
      return raw_payload + stale_prompt_policy(row.compiled_prompt)

  return compiled_prompt + raw_payload + freshness="fresh"
```

### Recommended stale policy
- Default policy: allow stale prompt only when diff impact is below threshold (for example memory-only drift with high similarity)
- Strict mode policy: block claim until refresh completed for backend/security/infra ticket types

### Failure Modes and Mitigations

| Failure Mode | Cause | Impact | Mitigation |
|---|---|---|---|
| False fresh | Non-canonical hash input ordering | Stale prompt served | Canonical sort + deterministic serializer |
| False stale | Hash includes non-semantic volatile fields | Unnecessary recompiles | Limit hash inputs to semantic version fields only |
| Missing repo SHA | Webhook/commit context unavailable | Cannot compute deterministic hash | Fallback to last known commit + `LOW_CONFIDENCE` marker |
| Queue backlog | Burst of READY transitions | Compile latency spikes | Priority queue + bounded retries + worker autoscaling |
| Compiler outage | LLM provider/network failure | No fresh prompts | Multi-provider fallback + degraded deterministic template mode |

## Background Compilation Queue Design Options

### Option A: DB-Backed Job Table (Recommended)
- Add `prompt_compile_jobs` table with status (`PENDING`, `RUNNING`, `DONE`, `FAILED`), retry counters, next_attempt_at, last_error
- Worker claims jobs using `FOR UPDATE SKIP LOCKED`
- Pros: durable, auditable, restart-safe, easy ops dashboarding
- Cons: slightly more schema and worker logic

### Option B: LISTEN/NOTIFY + in-memory queue
- Trigger enqueue events via PostgreSQL notify, keep queue in process memory
- Pros: simple startup
- Cons: job loss on restarts, weaker replay semantics

### Option C: Inline-on-claim only
- Compile synchronously during claim path
- Pros: simple model
- Cons: directly increases claim latency and failure coupling

Recommendation: **Option A** for production reliability, with Option B only for dev mode.

## SDLC-Compatible Phased Rollout (Ticket-Oriented)

### Rollout Plan
1. **Research/Architect**
- Freeze packet schema and hash specification
- ADR for deterministic freshness protocol

2. **Backend Phase A**
- Add schema fields: `context_hash`, `compiled_at` normalization fields, compile job table
- Add hash computation utility + canonical serializers

3. **Backend Phase B**
- Implement freshness gate in `tickets.claim`
- Implement queue workers and retry/backoff semantics

4. **QA/Security/CI**
- Determinism tests (same inputs => same hash)
- Stale prompt tests (repo/graph/memory mutation invalidates packet)
- Queue resilience tests (restart/retry/idempotency)

5. **Docs/Validation**
- Update operations and architecture docs
- Add runbook for queue health and stale prompt handling

### Acceptance Checks and Success Indicators

| Area | Acceptance Check | Success Indicator |
|---|---|---|
| Determinism | 100 repeated hash computations over same context produce identical hash | 100/100 exact matches |
| Freshness | Changing any one component (repo SHA, graph version, memory snapshot) changes `context_hash` | 100% invalidation sensitivity |
| Claim path latency | P95 `tickets.claim` latency with fresh prompt | <= 300 ms |
| Compile throughput | Queue processes burst of 1,000 jobs | >= 95% completed within 5 min |
| Prompt quality | Packet includes mandatory sections from `prompt_plan.md` | 100% schema compliance in QA corpus |
| Drift prevention | Stale packets served without warning | 0 incidents in validation window |

## Risks, Assumptions, Confidence per Phase

| Phase | Key Assumptions | Primary Risks | Confidence |
|---|---|---|---|
| 1 | Existing `compiler.ts` can be normalized to strict packet schema | Provider output variability | HIGH |
| 2 | Additive migration accepted | Column contract drift between clients | HIGH |
| 3 | Context versions can be computed cheaply | Hash costs or stale/false-stale edge cases | MEDIUM |
| 4 | Worker infra available | Queue backlog and retry storms | MEDIUM |
| 5 | IDE clients can consume expanded response | Contract mismatch in SDK wrappers | HIGH |
| 6 | Memory updates include stable timestamps/model metadata | Memory churn causes frequent invalidation | HIGH |
| 7 | Graph indexing remains incrementally current | Out-of-date index causes false freshness | HIGH |
| 8 | Controlled migration from file-based handoff is acceptable | Premature removal of markdown handoff breaks current flow | MEDIUM |

## Existing Docs/Files to Reuse (Avoid Duplication)

Use these as primary references rather than duplicating design prose:
- Prompt architecture goal/spec: `prompt_plan.md`
- Intelligence architecture baseline: `docs/architecture/intelligence-architecture.md`
- Setup and operations: `docs/operations/intelligence-setup.md`
- Prompt compiler implementation: `forgeos-server/src/services/compiler.ts`
- Claim delivery contract: `forgeos-server/src/tools/tickets-claim.ts`
- READY transition hook: `forgeos-server/src/webhooks/reconciliation.ts`
- Prompt storage migration: `forgeos-server/src/db/migrations/007-compiled-prompt.sql`
- Cognition schema: `forgeos-server/src/db/migrations/003-code-graph.sql`
- Memory schema: `forgeos-server/src/db/migrations/005-memory-engine.sql`
- Existing roadmap decomposition: `TODO/L1-intelligence-evolution.md`, `TODO/blocks/BLK-INT-phase4-dropin.md`

## Blockers / Missing Prerequisites

1. No canonical repo commit source in prompt compiler context path today (needs explicit source of truth per ticket context).
2. No graph/memory snapshot version endpoints or helper functions yet (must be added for deterministic hashing).
3. No durable compile queue table/worker metrics currently (required for production-grade Phase 4).
4. Prompt packet schema from `prompt_plan.md` is not yet enforced by validator in compile pipeline.

## Recommendation

Proceed with phased implementation, but prioritize this order:
1. `context_hash` schema + deterministic versioning helpers
2. Freshness gate in claim path
3. Durable compile queue
4. Packet schema validator and quality conformance tests

This sequence gives immediate risk reduction (stale prompt prevention) with low blast radius and aligns with existing SDLC/ticket execution patterns.
