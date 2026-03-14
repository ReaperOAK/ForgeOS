# Prompt Compiler Initiative — L2 Execution Blocks

Source alignment:
- `prompt_plan.md`
- `docs/product/PRD-prompt-compiler.md`
- `docs/architecture/prompt-compiler-architecture.md`
- `docs/architecture/adr/adr-008-deterministic-context-hash-freshness-gate.md`
- `docs/architecture/adr/adr-009-durable-compile-queue-idempotency.md`
- `docs/architecture/adr/adr-010-claim-contract-versioning-compiled-prompt-delivery.md`
- `.github/agent-output/Research/CTO-prompt-compiler-research.md`

## L0 -> L1 Traceability

L0 Vision:
Deterministic execution packets with zero-discovery executor behavior, freshness guarantees, and MCP-compatible delivery.

L1 Capabilities:
1. Prompt packet schema and storage foundation
2. Compiler determinism and freshness gate
3. Durable background compilation with idempotency
4. Claim delivery contract and compatibility
5. Memory/cognition context injection determinism
6. QA/security/validation hardening
7. Operational and developer documentation

## L2 Execution Blocks

## BLK-PC-01: Schema and Lifecycle Foundation
- Goal: establish canonical packet metadata and lifecycle guardrails before behavioral changes.
- Priority: P0
- Effort: M
- Depends on: none
- Primary tickets:
  - `TASK-PC-BE-001`
  - `TASK-PC-BE-002`

## BLK-PC-02: Deterministic Compiler Core
- Goal: enforce strict packet structure and deterministic context hash materialization.
- Priority: P0
- Effort: M
- Depends on: BLK-PC-01
- Primary tickets:
  - `TASK-PC-BE-003`
  - `TASK-PC-BE-004`
  - `TASK-PC-BE-005`

## BLK-PC-03: Freshness Gate and Stale Handling
- Goal: block or flag stale packets based on deterministic hash comparison at claim time.
- Priority: P0
- Effort: M
- Depends on: BLK-PC-02
- Primary tickets:
  - `TASK-PC-BE-006`
  - `TASK-PC-BE-007`

## BLK-PC-04: Durable Background Compilation
- Goal: replace fire-and-forget compile behavior with durable retryable idempotent queue.
- Priority: P0
- Effort: L
- Depends on: BLK-PC-02
- Primary tickets:
  - `TASK-PC-BE-008`
  - `TASK-PC-BE-009`
  - `TASK-PC-BE-010`

## BLK-PC-05: Claim Delivery Contract Versioning
- Goal: provide canonical claim payload (`compiled_prompt`, `raw_payload`, packet metadata) with alias compatibility.
- Priority: P0
- Effort: M
- Depends on: BLK-PC-03, BLK-PC-04
- Primary tickets:
  - `TASK-PC-BE-011`

## BLK-PC-06: Memory/Cognition Injection Determinism
- Goal: deterministic memory and cognition snapshots that feed hash and packet composition.
- Priority: P1
- Effort: M
- Depends on: BLK-PC-02
- Primary tickets:
  - `TASK-PC-BE-012`
  - `TASK-PC-BE-013`

## BLK-PC-07: QA/Security/Validation Hardening
- Goal: comprehensive deterministic, freshness, queue reliability, and policy compliance verification.
- Priority: P0
- Effort: M
- Depends on: BLK-PC-05, BLK-PC-06
- Primary tickets:
  - `TASK-PC-QA-014`
  - `TASK-PC-SEC-015`
  - `TASK-PC-CIR-016`

## BLK-PC-08: Docs and Runbook Closure
- Goal: ship architecture/operations/SDK docs for packet-authoritative execution and stale policy handling.
- Priority: P1
- Effort: S
- Depends on: BLK-PC-07
- Primary tickets:
  - `TASK-PC-DOC-017`

## Dependency Graph Summary
- `BLK-PC-01 -> BLK-PC-02 -> BLK-PC-03`
- `BLK-PC-02 -> BLK-PC-04`
- `BLK-PC-03 + BLK-PC-04 -> BLK-PC-05`
- `BLK-PC-02 -> BLK-PC-06`
- `BLK-PC-05 + BLK-PC-06 -> BLK-PC-07 -> BLK-PC-08`

## Constraint Guardrail
All implementation tickets must preserve MCP-first lifecycle controls and may not add or reintroduce direct ticket state manipulation outside authorized ticket lifecycle operations.
