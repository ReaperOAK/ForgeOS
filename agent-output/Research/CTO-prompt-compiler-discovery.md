# CTO Discovery Brief — Prompt Compiler Initiative

Date: 2026-03-14
Source plan: `prompt_plan.md`
Owner: CTO

## 1) Project Purpose
ForgeOS should move from context-discovery execution to deterministic execution packets, where executor agents receive precompiled, authoritative instructions and do not perform repository-wide discovery.

## 2) Current State Snapshot
- Existing intelligence platform is substantial and documented in `docs/architecture/intelligence-architecture.md` and `docs/product/PRD-intelligence-plan.md`.
- MCP ticket lifecycle and orchestration already exist under `forgeos-server/src/tools/` and related services.
- TODO decomposition framework and tickets pipeline are active (`TODO/tasks/`, `TODO/tickets/`, `.github/tickets.py`).
- Memory and context artifacts exist in `.github/memory-bank/` and `.github/agent-output/`.

## 3) Prompt Plan Gaps Identified
- No mandatory, strict execution packet schema validator enforcing all sections from `prompt_plan.md`.
- Freshness determination is not uniformly enforced as a deterministic hash comparison gate for claim-time delivery.
- Durable background compile queue requirements need explicit hardening and observability contracts.
- Canonical context hash inputs need consistent versioning sources (repo commit, cognition graph version, memory snapshot version).

## 4) Constraints and Governance
- Must proceed through SDLC tickets only.
- Ticketer orchestrates; executor agents must not perform broad repository discovery.
- Core governance rules remain version controlled in `.github/instructions/`.
- Changes should be additive and backward-compatible during rollout.

## 5) Recommended Execution Strategy
1. Create formal PRD and architecture artifacts specific to Prompt Compiler.
2. Add ADRs for context hash/freshness, durable queue/idempotency, and claim contract evolution.
3. Decompose into granular L3 tickets with strict dependencies.
4. Use backend-first chain for schema/freshness/queue/claim changes, then QA/Security/CI/Docs/Validation.

## 6) Evidence of Completion in This CTO Run
- Research: `.github/agent-output/Research/CTO-prompt-compiler-research.md`
- PRD: `docs/product/PRD-prompt-compiler.md`
- PM Summary: `.github/agent-output/ProductManager/CTO-prompt-compiler-prd.md`
- Architecture: `docs/architecture/prompt-compiler-architecture.md`
- ADRs: `docs/architecture/adr/adr-008-deterministic-context-hash-freshness-gate.md`, `docs/architecture/adr/adr-009-durable-compile-queue-idempotency.md`, `docs/architecture/adr/adr-010-claim-contract-versioning-compiled-prompt-delivery.md`
- Decomposition summary: `.github/agent-output/TODO/CTO-prompt-compiler-decomposition.md`

## 7) Handoff Readiness
- New Prompt Compiler ticket chain has been parsed and synced.
- READY entrypoint ticket exists (`TASK-PC-BE-001`).
- Integrity validation has one pre-existing mismatch not in the new chain (`TASK-INT-BE006` stage mismatch), which should be remediated by ticket-state owner/operator before strict legacy validation gate can pass.
