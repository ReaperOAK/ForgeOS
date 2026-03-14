---
title: "PRD: Prompt Compiler Deterministic Execution Packets"
id: PRD-PROMPT-COMPILER-001
type: prd
author: Product Manager
date: 2026-03-14T00:00:00Z
status: DRAFT
priority: P0
audience: Ticketer maintainers, Architect, Backend, QA, Security, CI, Documentation, Validator
upstream:
  - prompt_plan.md
  - .github/agent-output/Research/CTO-prompt-compiler-research.md
tags: [prompt-compiler, deterministic-execution, ticketing, mcp, intelligence]
---

# PRD: Prompt Compiler Deterministic Execution Packets

## 1. Vision, Goals, and Non-Goals

### 1.1 Vision

Upgrade ForgeOS from context-discovery execution to deterministic execution packets so executor agents run tickets from precompiled, authoritative instructions without repository crawling.

### 1.2 Goals

| Goal ID | Goal | Why it matters | Measure |
|---|---|---|---|
| G1 | Deterministic execution packets are delivered on claim | Reduces output variance and agent drift | 100% packet schema compliance on sampled claims |
| G2 | Freshness enforcement for every delivered packet | Prevents stale instructions after repo/graph/memory changes | 0 stale packet deliveries without stale/fresh status flag |
| G3 | Zero discovery overhead for executor agents | Cuts token waste and time-to-first-edit | 95% of executor runs complete without repository-wide search |
| G4 | Portable IDE execution | Allows stateless IDE agents to run immediately | New IDE client can claim and execute with no repo-specific setup |
| G5 | SDLC-compatible rollout | Ensures controlled delivery through current ownership model | 100% rollout tasks mapped to stage owner and acceptance criteria |

### 1.3 Non-Goals

- Replacing SDLC ticket lifecycle ownership and stage transitions.
- Changing agent governance in `.github/instructions/`.
- Defining model vendor lock-in (model choices remain configurable).
- Replatforming current summary-handoff process in this initiative (Phase 8 may prepare migration path only).
- Implementing execution-time coding behavior changes beyond packet authority rules.

## 2. Problem Statement and Gap Analysis

Current state from research indicates partial implementation exists (`compiled_prompt` generation and claim delivery), but deterministic packet guarantees are incomplete.

### 2.1 Current Capability vs Required Capability

| Area | Existing capability | Required gap closure |
|---|---|---|
| Prompt compilation service | JIT compiler service exists and stores compiled prompt | Enforce strict execution packet schema sections and validation |
| Storage | `compiled_prompt` and generation metadata exist | Add canonical `context_hash` and freshness metadata contract |
| Claim delivery | `tickets.claim` returns `compiled_prompt`/`system_directive` | Return explicit packet freshness state and standardized `raw_payload` |
| Freshness | Presence check only | Deterministic hash-based freshness gate before delivery |
| Background compilation | Fire-and-forget behavior exists | Durable retryable queue, visibility, and SLOs |
| Memory/cognition injection | Partial memory and cognition retrieval exists | Deterministic snapshot versioning and reproducible packet composition |

### 2.2 Cost of Inaction

- Agents can execute stale directives after repository or knowledge updates.
- Prompt quality drifts across tool paths without strict schema validation.
- Queue instability can increase claim latency and reduce reliability.
- Stateless IDE promise remains incomplete without deterministic freshness and packet contract.

## 3. Personas

### 3.1 Ticketer (Orchestrator)

- Objective: Deliver fresh, deterministic execution packets at claim time.
- Primary need: Compile and freshness lifecycle observability with bounded latency.
- Failure pain: Claims that return stale or missing packet context.

### 3.2 Executor Agent

- Objective: Implement ticket scope using authoritative packet instructions.
- Primary need: Complete, relevant context and deterministic plan without discovery.
- Failure pain: Missing constraints, outdated context, ambiguous execution path.

### 3.3 Operator

- Objective: Monitor health, troubleshoot failures, and enforce rollout quality.
- Primary need: Freshness metrics, queue metrics, and packet conformance status.
- Failure pain: Invisible stale-prompt risk and unclear retry/failure behavior.

## 4. User Flows

### 4.1 Ticketer Flow (Compile and Deliver)

1. Ticket enters executable state.
2. Ticketer schedules background compilation.
3. Compiler gathers ticket, memory, cognition, and constraints.
4. Compiler synthesizes strict execution packet and stores it with context metadata.
5. On claim, Ticketer validates freshness from current context hash.
6. Ticketer returns claim payload with packet, freshness status, and raw payload.

### 4.2 Executor Agent Flow (Deterministic Run)

1. Agent calls claim and receives compiled packet plus raw payload.
2. Agent uses packet as authoritative system directive.
3. Agent executes within declared scope and constraints.
4. Agent completes stage with evidence and post-completion requirements.

### 4.3 Operator Flow (Supervision)

1. Operator views queue depth, compile success, and freshness metrics.
2. Operator inspects failed compile jobs and stale packet incidents.
3. Operator triggers remediation workflow per runbook thresholds.

## 5. Feature Requirements by Phase (1-8)

Requirement format: implementation-neutral behavior requirements with explicit phase mapping.

### 5.1 Phase 1: Prompt Compiler Service

| Req ID | Requirement |
|---|---|
| PC-P1-001 | System SHALL compile an execution packet containing mandatory sections defined in Section 6. |
| PC-P1-002 | Compiler SHALL gather ticket specification, historical attempts, memory learnings, cognition context, and system constraints before synthesis. |
| PC-P1-003 | Compiler SHALL never execute code changes; it is generation-only. |
| PC-P1-004 | Compiler SHALL support low-latency synthesis model configuration with deterministic template normalization. |

### 5.2 Phase 2: Execution Packet Storage

| Req ID | Requirement |
|---|---|
| PC-P2-001 | Ticket record SHALL store `compiled_prompt`, `compiled_at`, and `context_hash`. |
| PC-P2-002 | Stored context metadata SHALL be sufficient to recompute freshness deterministically. |
| PC-P2-003 | Packet storage SHALL preserve provider/model metadata for auditability. |

### 5.3 Phase 3: Prompt Freshness Validation

| Req ID | Requirement |
|---|---|
| PC-P3-001 | Claim path SHALL compute current context hash from repository commit, cognition graph version, and memory snapshot version. |
| PC-P3-002 | If stored `context_hash` differs from current hash, packet SHALL be marked stale and recompile SHALL be triggered. |
| PC-P3-003 | Claim response SHALL include freshness state (`fresh`, `stale`, `missing`) for packet consumers. |
| PC-P3-004 | Stale handling policy SHALL be configurable by ticket criticality profile (strict or permissive). |

### 5.4 Phase 4: Background Compilation

| Req ID | Requirement |
|---|---|
| PC-P4-001 | System SHALL enqueue compilation when tickets enter executable states defined by product policy. |
| PC-P4-002 | Compile queue SHALL support retry, backoff, and idempotent execution. |
| PC-P4-003 | Queue health metrics SHALL expose depth, age, success rate, and failure reasons. |

### 5.5 Phase 5: IDE Delivery Model

| Req ID | Requirement |
|---|---|
| PC-P5-001 | Claim response SHALL include `ticket_id`, `compiled_prompt`, and canonical `raw_payload`. |
| PC-P5-002 | `compiled_prompt` SHALL be explicit as authoritative system directive for executor agents. |
| PC-P5-003 | Contract SHALL remain backward-compatible for clients currently consuming `system_directive` alias. |

### 5.6 Phase 6: Memory Injection

| Req ID | Requirement |
|---|---|
| PC-P6-001 | Compiler SHALL inject relevant learnings based on ticket domain, affected modules, and similar historical tickets. |
| PC-P6-002 | Packet SHALL separate `LEARNINGS` from `BEST PRACTICES` to avoid instruction ambiguity. |
| PC-P6-003 | Memory snapshot version SHALL be included in context hash inputs. |

### 5.7 Phase 7: Cognition Injection

| Req ID | Requirement |
|---|---|
| PC-P7-001 | Compiler SHALL inject code graph-derived context locations and dependency-aware execution guidance. |
| PC-P7-002 | Packet SHALL include context-location rationale for each referenced file or module. |
| PC-P7-003 | Cognition graph version SHALL be included in context hash inputs. |

### 5.8 Phase 8: Repository Decoupling

| Req ID | Requirement |
|---|---|
| PC-P8-001 | Initiative SHALL define migration criteria for moving non-governance agent context from markdown files to centralized memory/intelligence systems. |
| PC-P8-002 | Governance rules in `.github/instructions/` SHALL remain version controlled and out of decoupling scope. |
| PC-P8-003 | Decoupling SHALL preserve operator traceability and audit requirements. |

## 6. Strict Execution Packet Schema

The execution packet SHALL conform to this strict section order and naming to ensure deterministic parsing and QA validation.

1. `ROLE`
2. `TICKET`
3. `SYSTEM CONSTRAINTS`
4. `HISTORY`
5. `LEARNINGS`
6. `BEST PRACTICES`
7. `CONTEXT LOCATIONS`
8. `YOUR EXACT TASK`
9. `EXECUTION PLAN`
10. `EDGE CASES`
11. `POST-COMPLETION`

### 6.1 Field-Level Requirements

| Section | Required fields |
|---|---|
| ROLE | executor persona, stage intent |
| TICKET | ticket_id, title, priority, goal, acceptance_criteria |
| SYSTEM CONSTRAINTS | file scope, architecture boundaries, validation requirements, commit conventions |
| HISTORY | prior agents, modified files, outcomes, unresolved issues |
| LEARNINGS | memory-derived lessons with applicability rationale |
| BEST PRACTICES | security, performance, testing, architecture conventions |
| CONTEXT LOCATIONS | path, relevance_reason |
| YOUR EXACT TASK | precise behavioral objective, excluded scope |
| EXECUTION PLAN | deterministic ordered steps |
| EDGE CASES | failure modes and required handling |
| POST-COMPLETION | memory update, validation run, ticket update, artifacts/commit references |

### 6.2 Schema Acceptance Criteria (Given/When/Then)

| AC ID | Acceptance Criteria |
|---|---|
| PC-AC-001 | Given a compiled packet, when validated, then all 11 mandatory sections are present in exact order. |
| PC-AC-002 | Given any missing required field in a section, when packet validation runs, then compile result is rejected with structured reason. |
| PC-AC-003 | Given identical synthesis inputs, when packet compiles twice, then normalized packet structure and section ordering are identical. |
| PC-AC-004 | Given claim delivery, when packet is returned, then response includes packet freshness state and raw payload reference. |

## 7. NFRs

### 7.1 Determinism and Freshness

| NFR ID | Requirement | Target |
|---|---|---|
| PC-NFR-001 | Deterministic hash stability | 100/100 identical context input runs produce identical `context_hash` |
| PC-NFR-002 | Freshness invalidation sensitivity | Any change in repo commit, graph version, or memory snapshot changes `context_hash` |
| PC-NFR-003 | Stale packet prevention | 0 unflagged stale packet deliveries |

### 7.2 Latency and Throughput

| NFR ID | Requirement | Target |
|---|---|---|
| PC-NFR-004 | Claim latency with fresh packet | P95 <= 300 ms |
| PC-NFR-005 | Compile queue throughput | >= 95% of 1,000 burst jobs complete within 5 minutes |
| PC-NFR-006 | Compilation lead time for executable tickets | P95 precompiled before first claim attempt |

### 7.3 Reliability

| NFR ID | Requirement | Target |
|---|---|---|
| PC-NFR-007 | Queue durability | 0 job loss across service restarts |
| PC-NFR-008 | Recompile retry behavior | >= 99% eventual success for transient failures within retry budget |
| PC-NFR-009 | Contract availability | Claim response includes deterministic packet contract fields in 100% successful claims |

## 8. SDLC-Compatible Rollout Plan

### 8.1 Ownership by Stage

| Rollout Workstream | Primary Owner Stage | Exit Criteria |
|---|---|---|
| Research and baseline evidence | RESEARCH | Confirm implemented capabilities vs gaps and measurement baselines |
| Contract, schema, and ADRs | ARCHITECT | Approved packet schema, freshness contract, and queue interface |
| Storage/freshness/queue implementation | BACKEND | Required fields and APIs implemented with tests |
| Conformance and regression validation | QA | Packet schema, freshness, and queue tests green |
| Risk and guardrail validation | SECURITY | No policy/regression issues for scope and auditability |
| Lint/type/complexity verification | CI | Zero lint/type failures for changed surfaces |
| Operator/product docs | DOCS | Updated runbook, contract, and onboarding guidance |
| Independent DoD verification | VALIDATION | All acceptance criteria and NFR evidence satisfied |

### 8.2 Rollout Milestones

1. M1: Finalize strict packet schema and context-hash contract.
2. M2: Add storage fields and hash computation readiness.
3. M3: Introduce freshness gate in claim path.
4. M4: Enable durable background compile queue and metrics.
5. M5: Enforce packet conformance and complete stage validation.

## 9. Risks and Mitigations

| Risk ID | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| PC-R1 | False fresh due to non-canonical hash inputs | Medium | High | Canonical sorting and serializer contract tests |
| PC-R2 | False stale due to volatile hash inputs | Medium | Medium | Restrict hash inputs to semantic version components |
| PC-R3 | Queue backlog increases claim-time recompiles | Medium | High | Queue SLOs, priority handling, retry/backoff controls |
| PC-R4 | Packet schema drift across compilation paths | Medium | High | Pre-delivery schema validator and conformance tests |
| PC-R5 | Client contract divergence in IDE integrations | Medium | Medium | Versioned claim response contract + backward compatibility |
| PC-R6 | Premature repository decoupling breaks governance flow | Low | High | Keep governance in `.github/instructions/`; gate Phase 8 behind validator criteria |

## 10. Measurable Success Criteria

These criteria directly reflect `prompt_plan.md` outcomes and research-backed targets.

| Success ID | Criterion | Baseline | Target |
|---|---|---|---|
| PC-S1 | Executors receiving deterministic packets | Partial | 100% of eligible claims |
| PC-S2 | Executor runs requiring repository-wide discovery | High/unknown | <= 5% |
| PC-S3 | Freshness gate coverage on claims | 0% | 100% |
| PC-S4 | Packet schema compliance on sampled claims | Partial | 100% |
| PC-S5 | First-claim wait caused by missing packet | Intermittent | <= 5% |
| PC-S6 | IDE portability (zero repo setup for claim+execute) | Partial | Demonstrated in validation runbook |

## 11. Top P0 Requirements

1. `PC-P3-001`: Deterministic `context_hash` computation on claim from repo commit, cognition version, memory snapshot.
2. `PC-P3-002`: Mandatory stale detection and recompile trigger when stored and current hash differ.
3. `PC-P5-001`: Standard claim response contract with `ticket_id`, `compiled_prompt`, and canonical `raw_payload`.
4. `PC-P1-001`: Strict 11-section execution packet schema enforcement.
5. `PC-P4-002`: Durable compile queue with retry/backoff/idempotency.

## 12. Assumptions and Open Questions

### 12.1 Assumptions

- Existing compiler and claim paths remain the baseline integration points.
- Current memory and cognition systems can expose stable version identifiers.
- Queue observability can be surfaced through existing operational channels.

### 12.2 Open Questions

- Which ticket stages are in final executable-state policy for precompile triggers?
- What strict-mode stale policy applies by ticket type/criticality?
- What is the canonical source for repository commit context in all deployment modes?

## 13. Out of Scope

- Code implementation details for hash algorithm internals beyond behavioral contract.
- Vendor-specific model tuning strategy.
- Full elimination of markdown handoff artifacts in this release window.
- Changes to SDLC stage order or agent ownership model.
