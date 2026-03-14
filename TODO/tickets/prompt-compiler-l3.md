# Prompt Compiler L3 Tickets

SDLC flow mapping (derived from `type` in `.github/tickets.py`):
- `backend`: READY -> BACKEND -> QA -> SECURITY -> CI -> DOCS -> VALIDATION -> DONE
- `security`: READY -> SECURITY -> QA -> CI -> DOCS -> VALIDATION -> DONE
- `docs`: READY -> DOCS -> VALIDATION -> DONE

# TASK-PC-BE-001: Add Prompt Packet Foundation Schema

**Type:** backend
**Priority:** critical
**Files:** forgeos-server/src/db/migrations/008-prompt-compiler-foundation.sql, forgeos-server/src/types/index.ts, forgeos-server/src/services/compiler.ts
**Tags:** prompt-compiler, schema, foundation, p0

## Description
Add additive schema foundation for deterministic prompt packets: canonical `context_hash`, packet schema/version metadata, template version, freshness metadata fields, and normalized compilation timestamps. Ensure schema and type updates are backward compatible with existing compiled prompt fields.

## Acceptance Criteria
- [ ] Given migration execution, when applying forward migration, then new additive prompt compiler fields exist without dropping existing prompt columns.
- [ ] Given existing rows with `compiled_prompt`, when migration runs, then data is preserved and nullable defaults remain valid.
- [ ] Given TypeScript build, when type contracts are compiled, then ticket types include newly introduced packet metadata fields.
- [ ] Given schema changes, when reviewed, then no direct `.github/ticket-state` or filesystem-based lifecycle logic is introduced.
- [ ] Given rollback run, when migration down is executed in test environment, then rollback completes without orphaning unrelated ticket data.

# TASK-PC-BE-002: Enforce Lifecycle Guardrails in Prompt Paths

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-001
**Files:** forgeos-server/src/services/compiler.ts, forgeos-server/src/tools/tickets-claim.ts, forgeos-server/src/webhooks/reconciliation.ts, forgeos-server/src/__tests__/prompt-lifecycle-guardrails.test.ts
**Tags:** prompt-compiler, lifecycle, guardrail, p0

## Description
Add explicit guardrails ensuring prompt compiler and claim delivery code uses only MCP/DB lifecycle state and never mutates ticket lifecycle through direct filesystem state edits. Include regression tests that fail if forbidden state paths are introduced in prompt lifecycle modules.

## Acceptance Criteria
- [ ] Given prompt compile and claim code paths, when static and unit checks run, then no `.github/ticket-state` read/write paths are referenced.
- [ ] Given lifecycle operations, when prompt compilation is triggered, then ticket stage/state transitions remain delegated to existing lifecycle interfaces only.
- [ ] Given new tests, when run in CI, then a forbidden direct state-path regression fails fast.
- [ ] Given review checklist, when validating guardrails, then all prompt lifecycle modifications remain within `forgeos-server` lifecycle contracts.

# TASK-PC-BE-003: Implement Deterministic Context Hash Engine

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-001
**Files:** forgeos-server/src/services/context-hash.ts, forgeos-server/src/services/compiler.ts, forgeos-server/src/types/index.ts, forgeos-server/src/__tests__/context-hash.test.ts
**Tags:** prompt-compiler, freshness, deterministic-hash, p0

## Description
Implement canonical `context_hash` computation over required context inputs (`repo_commit`, `graph_version`, `memory_snapshot`, `packet_schema`, `template_version`) with deterministic serialization and SHA-256 output.

## Acceptance Criteria
- [ ] Given identical inputs, when hash is computed repeatedly, then output hash is identical across 100 repeated runs.
- [ ] Given any single input mutation, when hash is recomputed, then resulting hash changes.
- [ ] Given unordered input objects, when canonicalizer runs, then hash output remains stable due to canonical ordering.
- [ ] Given unit tests, when executed, then deterministic and sensitivity assertions pass.
- [ ] Given implementation review, when auditing for scope, then no filesystem discovery logic is required by hash computation.

# TASK-PC-BE-004: Enforce Strict 11-Section Packet Schema Validator

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-001
**Files:** forgeos-server/src/services/packet-validator.ts, forgeos-server/src/services/compiler.ts, forgeos-server/src/__tests__/packet-validator.test.ts
**Tags:** prompt-compiler, schema, determinism, p0

## Description
Add validator enforcing strict execution packet section names and ordering from PRD/architecture (ROLE through POST-COMPLETION) and reject malformed packets with structured error details.

## Acceptance Criteria
- [ ] Given a compiled packet, when validator runs, then all 11 sections must exist in exact order.
- [ ] Given missing or misordered sections, when validator runs, then compile result is rejected with structured failure reason.
- [ ] Given two packet renders from identical inputs, when normalized, then section ordering and formatting are identical.
- [ ] Given compiler integration, when packet fails validation, then failure is surfaced as non-success compile outcome.

# TASK-PC-BE-005: Integrate Hash + Schema Validation into Compiler Pipeline

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-003, TASK-PC-BE-004
**Files:** forgeos-server/src/services/compiler.ts, forgeos-server/src/services/compile-orchestrator.ts, forgeos-server/src/__tests__/compiler-pipeline-determinism.test.ts
**Tags:** prompt-compiler, compiler-service, p0

## Description
Wire packet validator and context hash engine into compile pipeline so each successful compile stores validated packet, computed hash, and associated metadata atomically.

## Acceptance Criteria
- [ ] Given compile execution, when synthesis succeeds, then packet validator runs before persistence.
- [ ] Given valid packet, when persistence occurs, then `compiled_prompt`, `compiled_at`, and `context_hash` metadata are updated atomically.
- [ ] Given invalid packet, when compile finalizes, then no success metadata is committed and error is recorded.
- [ ] Given identical compile inputs, when pipeline is run twice, then persisted packet structure and context hash are identical.

# TASK-PC-BE-006: Add Freshness Gate to Claim Path

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-005
**Files:** forgeos-server/src/tools/tickets-claim.ts, forgeos-server/src/services/context-hash.ts, forgeos-server/src/__tests__/tickets-claim-freshness.test.ts
**Tags:** prompt-compiler, freshness-gate, claim, p0

## Description
Implement claim-time freshness verification comparing stored `context_hash` to current context hash and returning explicit freshness status (`fresh`, `stale`, `missing`) with stale reason.

## Acceptance Criteria
- [ ] Given claim with matching hash, when response is returned, then freshness status is `fresh`.
- [ ] Given claim with missing compiled prompt, when response is returned, then freshness status is `missing` and compile trigger path is invoked.
- [ ] Given claim with hash mismatch, when response is returned, then freshness status is `stale` with `hash_mismatch` reason and recompile trigger path is invoked.
- [ ] Given strict/permissive policy configuration, when stale prompt is encountered, then behavior follows configured mode.

# TASK-PC-BE-007: Implement Stale Policy Profiles by Ticket Criticality

**Type:** backend
**Priority:** high
**Dependencies:** TASK-PC-BE-006
**Files:** forgeos-server/src/config.ts, forgeos-server/src/tools/tickets-claim.ts, forgeos-server/src/types/index.ts, forgeos-server/src/__tests__/stale-policy-profiles.test.ts
**Tags:** prompt-compiler, stale-policy, security, p0

## Description
Introduce configurable stale-handling policy profiles by ticket type/criticality (`strict` and `permissive`) and ensure policy decisions are transparent in claim metadata.

## Acceptance Criteria
- [ ] Given policy configuration, when claim evaluates stale packet, then response behavior matches profile.
- [ ] Given strict profile ticket, when packet is stale or missing, then claim response clearly indicates non-fresh execution restriction.
- [ ] Given permissive profile ticket, when packet is stale, then response includes stale metadata and background recompile request.
- [ ] Given policy tests, when run, then backend/security/infra defaults align with architecture decision.

# TASK-PC-BE-008: Create Durable Prompt Compile Queue Schema

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-005
**Files:** forgeos-server/src/db/migrations/009-prompt-compile-queue.sql, forgeos-server/src/types/index.ts, forgeos-server/src/db/index.ts
**Tags:** prompt-compiler, queue, durability, p0

## Description
Add durable `prompt_compile_jobs` table and indexes with job status lifecycle, retry metadata, idempotency key uniqueness, and audit timestamps.

## Acceptance Criteria
- [ ] Given migration run, when schema is applied, then durable compile queue table exists with required status and retry fields.
- [ ] Given enqueue attempts with same idempotency key, when insert/upsert occurs, then only one effective active job exists.
- [ ] Given queue table usage, when queried, then operational metrics fields (attempts, next attempt, last error) are available.
- [ ] Given migration idempotency, when rerun, then schema remains consistent with no duplicate artifacts.

# TASK-PC-BE-009: Implement Queue Worker Retry and Idempotency Engine

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-008
**Files:** forgeos-server/src/services/prompt-compile-queue.ts, forgeos-server/src/services/compiler.ts, forgeos-server/src/__tests__/prompt-compile-queue.test.ts
**Tags:** prompt-compiler, queue-worker, retry, p0

## Description
Implement durable queue worker with row locking, idempotent job claiming, exponential backoff retry, dead-letter terminal state, and structured error taxonomy.

## Acceptance Criteria
- [ ] Given pending jobs, when worker polls, then jobs are claimed with safe concurrency semantics.
- [ ] Given transient compile errors, when retry budget remains, then job is retried with exponential backoff and jitter.
- [ ] Given non-retryable validation error, when worker handles failure, then job transitions to terminal non-retryable state.
- [ ] Given duplicate enqueue burst, when worker processes jobs, then only one compile outcome is committed for shared idempotency key.
- [ ] Given service restart, when worker resumes, then pending jobs remain durable and recoverable.

# TASK-PC-BE-010: Integrate Compile Queue Triggers and Metrics

**Type:** backend
**Priority:** high
**Dependencies:** TASK-PC-BE-009
**Files:** forgeos-server/src/webhooks/reconciliation.ts, forgeos-server/src/tools/tickets-claim.ts, forgeos-server/src/services/prompt-compile-queue.ts, forgeos-server/src/monitoring/metrics.ts, forgeos-server/src/__tests__/prompt-compile-triggering.test.ts
**Tags:** prompt-compiler, queue, observability, p0

## Description
Integrate queue triggering on executable-state transitions and stale/missing claim detection. Emit queue depth, age, success/failure, and freshness metrics required by architecture and PRD.

## Acceptance Criteria
- [ ] Given ticket enters executable state, when transition hook fires, then compile job is enqueued with idempotency key.
- [ ] Given stale or missing claim result, when claim path completes, then recompile enqueue is triggered once per effective context target.
- [ ] Given metrics export, when observed, then queue and freshness counters are emitted with defined labels.
- [ ] Given load test harness, when burst enqueue occurs, then queue instrumentation reflects backlog and recovery progression.

# TASK-PC-BE-011: Version Claim Delivery Contract for Prompt Packets

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-006, TASK-PC-BE-010
**Files:** forgeos-server/src/tools/tickets-claim.ts, forgeos-server/src/types/index.ts, agent-sdk/src/forgeos_sdk/client.py, agent-sdk/tests/test_transport.py, agent-sdk/tests/test_models.py
**Tags:** prompt-compiler, claim-contract, sdk, p0

## Description
Deliver additive versioned claim contract exposing canonical `raw_payload` and `prompt_packet` metadata while keeping backward-compatible `system_directive` alias to `compiled_prompt` during migration.

## Acceptance Criteria
- [ ] Given successful claim, when response is serialized, then it includes `ticket_id`, `compiled_prompt`, canonical `raw_payload`, and `prompt_packet` metadata.
- [ ] Given legacy client behavior, when reading `system_directive`, then field remains available as alias to `compiled_prompt`.
- [ ] Given SDK parsing, when claim response includes new fields, then SDK models deserialize without regression.
- [ ] Given compatibility tests, when executed, then both legacy and new contract consumers pass.

# TASK-PC-BE-012: Deterministic Memory Snapshot Injection

**Type:** backend
**Priority:** high
**Dependencies:** TASK-PC-BE-005
**Files:** forgeos-server/src/services/compiler.ts, forgeos-server/src/services/memory-provider.ts, forgeos-server/src/services/context-hash.ts, forgeos-server/src/__tests__/memory-snapshot-versioning.test.ts
**Tags:** prompt-compiler, memory, context-hash, p1

## Description
Implement deterministic memory snapshot retrieval and projection into packet sections (`LEARNINGS`, `BEST PRACTICES`) with stable snapshot version used as a context hash input.

## Acceptance Criteria
- [ ] Given same memory snapshot inputs, when compiler retrieves lessons, then selected and ordered lessons are deterministic.
- [ ] Given memory updates, when snapshot version changes, then context hash input changes accordingly.
- [ ] Given packet generation, when memory is injected, then `LEARNINGS` and `BEST PRACTICES` remain semantically separated.
- [ ] Given provider degradation, when memory source is partially unavailable, then packet marks reduced completeness without crashing compile.

# TASK-PC-BE-013: Deterministic Cognition Context Injection

**Type:** backend
**Priority:** high
**Dependencies:** TASK-PC-BE-005
**Files:** forgeos-server/src/services/compiler.ts, forgeos-server/src/services/cognition-provider.ts, forgeos-server/src/services/context-hash.ts, forgeos-server/src/__tests__/cognition-snapshot-versioning.test.ts
**Tags:** prompt-compiler, cognition, context-locations, p1

## Description
Implement deterministic cognition context retrieval with stable graph snapshot version and explicit relevance rationale for each context location included in execution packets.

## Acceptance Criteria
- [ ] Given same cognition graph snapshot, when context locations are generated, then ordering and rationale output are deterministic.
- [ ] Given graph version mutation, when context hash input is computed, then hash material changes.
- [ ] Given packet generation, when context is rendered, then each location includes `path` and relevance reason.
- [ ] Given cognition provider timeout, when compile continues, then packet records partial-context warning metadata.

# TASK-PC-QA-014: Validate Determinism, Freshness, and Queue Reliability

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-PC-BE-011, TASK-PC-BE-012, TASK-PC-BE-013
**Files:** forgeos-server/src/__tests__/prompt-compiler-determinism.integration.test.ts, forgeos-server/src/__tests__/claim-freshness.integration.test.ts, forgeos-server/src/__tests__/compile-queue-resilience.integration.test.ts
**Tags:** prompt-compiler, qa, reliability, p0

## Description
Create comprehensive integration test suite validating deterministic hash behavior, freshness gating, stale/missing handling, queue retry/idempotency behavior, and claim contract conformance.

## Acceptance Criteria
- [ ] Given repeated identical compile inputs, when integration tests run, then packets and hashes remain identical.
- [ ] Given repo, memory, or cognition context changes, when claim executes, then freshness status transitions from `fresh` to `stale` as expected.
- [ ] Given transient compiler failures, when queue worker retries, then jobs recover within retry budget.
- [ ] Given duplicate enqueue events, when queue processing completes, then only one effective compile output persists.
- [ ] Given claim contract response, when validated, then required fields and compatibility alias are always present.

# TASK-PC-SEC-015: Security Hardening for Prompt Compiler Paths

**Type:** security
**Priority:** high
**Dependencies:** TASK-PC-QA-014
**Files:** forgeos-server/src/services/compiler.ts, forgeos-server/src/services/prompt-compile-queue.ts, forgeos-server/src/tools/tickets-claim.ts, forgeos-server/src/middleware/error-handler.ts, forgeos-server/src/__tests__/prompt-compiler-security.test.ts
**Tags:** prompt-compiler, security, hardening, p0

## Description
Perform security hardening and guardrail verification for prompt compiler paths, including secret handling, error redaction, stale policy abuse resistance, and payload boundary checks.

## Acceptance Criteria
- [ ] Given logging and error paths, when failures occur, then secrets/tokens are never emitted.
- [ ] Given malformed or oversized payloads, when processed, then boundaries are enforced without service crash.
- [ ] Given stale policy toggles, when unauthorized override is attempted, then guardrails prevent unsafe policy bypass.
- [ ] Given security test suite, when run, then no high-severity findings remain open for prompt compiler scope.

# TASK-PC-CIR-016: CI Gate for Prompt Compiler Quality Thresholds

**Type:** backend
**Priority:** high
**Dependencies:** TASK-PC-SEC-015
**Files:** forgeos-server/vitest.config.ts, forgeos-server/package.json, .github/workflows, forgeos-server/src/__tests__
**Tags:** prompt-compiler, ci, quality-gate, p1

## Description
Add CI checks for prompt compiler determinism/freshness/queue suites and enforce zero-lint, zero-type-error, and required test pass thresholds before merge.

## Acceptance Criteria
- [ ] Given CI run on prompt compiler changes, when checks execute, then deterministic and freshness suites are required and blocking.
- [ ] Given lint and type checks, when run in CI, then prompt compiler surfaces have zero errors.
- [ ] Given flaky retry tests, when CI runs, then test strategy provides deterministic pass/fail outcomes.
- [ ] Given CI report, when pipeline completes, then prompt compiler gate status is explicit and auditable.

# TASK-PC-DOC-017: Update Prompt Compiler Architecture and Operations Docs

**Type:** docs
**Priority:** high
**Dependencies:** TASK-PC-CIR-016
**Files:** docs/architecture/prompt-compiler-architecture.md, docs/product/PRD-prompt-compiler.md, docs/operations/intelligence-setup.md, README.md, .github/agent-output/Documentation/TASK-PC-DOC-017.md
**Tags:** prompt-compiler, docs, runbook, p1

## Description
Document final prompt compiler contract, freshness policy behavior, queue operations, and operator runbooks. Include migration notes for clients moving from `system_directive` to packet metadata contract.

## Acceptance Criteria
- [ ] Given docs review, when comparing against implementation, then claim and packet contracts are accurate and complete.
- [ ] Given operations runbook, when operator follows stale/missing remediation steps, then queue and freshness issues are diagnosable.
- [ ] Given README update, when new contributors onboard, then prompt compiler architecture and constraints are discoverable.
- [ ] Given governance review, when docs are approved, then lifecycle guardrail forbidding direct state modifications is explicitly documented.
