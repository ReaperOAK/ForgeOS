---
id: active-context
version: "1.0"
owner: Shared
write_access: [ALL]
append_only: true
compaction_threshold: 50
---

# Active Context

> **Schema Version:** 1.0
> **Owner:** Shared
> **Write Access:** All subagents may APPEND entries. ReaperOAK may also edit.
> **Lock Rules:** Subagents may only append timestamped entries. They may NOT
> delete, modify, or overwrite existing entries. Only ReaperOAK may archive or
> compact old entries.
> **Update Protocol:** Append new entry with timestamp, agent name, and content.
> Entries older than 50 items may be archived by ReaperOAK to
> `activeContext.archive.md`.

---

## Current Focus

<!-- What is the system currently working on? Updated per-session. -->

### [2026-02-28T00:00:00Z] ReaperOAK — Session 14

- **Focus:** Worker-Pool Adaptive Engine v8.0.0 — complete architecture upgrade
- **Status:** COMPLETE — all core files rewritten/updated
- **Next Steps:** CAP-02 through CAP-06 BUILD (worker pool data model, continuous scheduling, two-layer enforcement, SDR orchestration, UI/UX hardening)

### [2026-02-23T00:00:00Z] Claude Code

- **Focus:** Claude Code integration — dual-agent vibecoding support
- **Status:** Claude Code fully configured alongside GitHub Copilot
- **Next Steps:** Test hooks and slash commands, begin project work

### [2026-02-21T00:00:00Z] ReaperOAK

- **Focus:** Initial vibecoding system setup
- **Status:** Building multi-agent infrastructure
- **Next Steps:** Generate subagent files, create orchestration rules

### [2025-07-26T00:00:00Z] ReaperOAK

- **Focus:** TODO Agent & Execution Governance — fix two architectural flaws
- **Status:** Complete — all changes validated, fix loop resolved
- **Next Steps:** Smoke test with real feature request to validate DECOMPOSE phase

---

## Recent Changes

<!-- Reverse chronological log of significant changes -->

### [2026-02-28T00:00:00Z] Worker-Pool Adaptive Engine v8.0.0

- **ReaperOAK.agent.md** — COMPLETE REWRITE (811→1077 lines). 20 sections. Worker pool model, two-layer orchestration, continuous scheduling, SDR protocol, updated 9-state machine (READY→LOCKED→IMPLEMENTING→QA_REVIEW→VALIDATION→DOCUMENTATION→CI_REVIEW→COMMIT→DONE), event-driven loop, conflict detection (5 types), two worked examples.
- **ARCHITECTURE.instructions.md** — COMPLETE REWRITE (1194→1728 lines, 32 sections). Version v8.0.0. Added §30 Two-Layer Orchestration Model, §31 Strategic Layer & SDR Protocol. All sections updated with worker pool model, continuous scheduling, SDR references.
- **agents.md** — Updated (191→233 lines). Worker Pool Model, Two-Layer Orchestration, Strategy Evolution paragraphs added. TODO Agent SDR restriction noted.
- **_cross-cutting-protocols.md** — Updated (209→241 lines). §8.1 Worker Pool Events (4 types), §10 Strategic Event Types (6 types) added.
- **TODO.agent.md** — Updated (175→203 lines). Forbidden Actions 17-18 (SDR restrictions). Strategy Boundary section added.
- **Validator.agent.md** — Updated (256 lines). v8 state names in validation matrix.
- **Chunk files** — chunk-01.yaml, chunk-02.yaml (TODO.agent), chunk-01.yaml (Validator) updated with v8 states.
- **Infrastructure** — delegation-packet-schema.json, loop-detection-rules.md, tool-acl.yaml, definition-of-done-template.md all updated with v8 vocabulary.
- **TODO directory** — Recreated with vision.md (7 capabilities), 7 block files, 2 task files.

### [2026-02-23T00:00:00Z] Claude Code

- Created `CLAUDE.md` — primary Claude Code instruction file (equivalent to
  ReaperOAK.agent.md for Claude Code)
- Created `.claude/settings.json` — hooks configuration for governance audit,
  prompt logging, and session tracking
- Created `.claude/hooks/` — 3 hook scripts adapted from Copilot hooks:
  governance-audit-prompt.sh, log-prompt.sh, log-session-end.sh
- Created `.claude/commands/` — 5 slash commands: memory-bank-read,
  memory-bank-update, review, plan, security-audit, debug
- System now supports both GitHub Copilot and Claude Code as vibecoding agents

### [2026-02-21T00:00:00Z] ReaperOAK

- Created `.github/instructions/ARCHITECTURE.instructions.md` — full system architecture
- Created `.github/memory-bank/` — persistent state system
- Performed full repository intelligence sweep (170+ instructions, 150+ agents,
  55+ skills catalogued)

---

## Active Decisions

<!-- Decisions currently under consideration -->

- _None pending_

---

## Blockers

<!-- Current blockers preventing progress -->

- _None_

---

## Session Notes

<!-- Per-session working notes. Append only. -->

### [2026-02-21] Session 1

- Initialized vibecoding multi-agent system
- Completed Phase 1 (intelligence sweep), Phase 2 (architecture design),
  Phase 3 (memory bank)

### [2026-02-23] Session 2

- Integrated Claude Code as a vibecoding agent alongside GitHub Copilot
- Created CLAUDE.md, .claude/settings.json, hooks, and slash commands
- Full dual-agent support now operational
### [2026-02-24] Sessions 3-5 — Context Bloat Fix

- Completed all 11 hardening phases (A-K): subagent files, orchestration rules,
  security guardrails, chunk system, catalog, cross-cutting protocols,
  guardian, locks, sandbox, observability, hooks, workflows
- Created boot files: `.github/copilot-instructions.md` (45 lines) +
  `agents.md` at repo root (80 lines) — auto-load chain for all sessions
- User deleted `.github/instructions/` folder — chunks are sole source of truth
- Cleaned `catalog.yml` of stale references to deleted instruction files
- **Context bloat diagnosed:** agent files were 585-1,052 lines each, consuming
  too much context window, preventing delegation behavior
- **All 12 agent files slimmed** (total: 7,787 → 826 lines, ~89% reduction):
  - ReaperOAK: 1,052 → 84 lines
  - Architect: 666 → 61 | Backend: 711 → 68 | Frontend: 716 → 64
  - QA: 774 → 66 | Security: 769 → 65 | DevOps: 780 → 69
  - Documentation: 807 → 68 | Research: 704 → 68 | ProductManager: 585 → 67
  - CIReviewer: 614 → 65 | _cross-cutting-protocols: 493 → 81
- Each slim file preserves: YAML frontmatter, identity, scope, ALL forbidden
  actions (safety-critical), key protocols as summary table, chunk pointer
- Backups of all originals at `.bak` files in `.github/agents/`

### [2026-02-25] Session 6 — Force Delegation

- ReaperOAK still self-implementing instead of delegating — root cause: agent
  file said "Self-execute quick tasks (< 5 min)" which the model used as escape
  hatch to do everything itself
- Rewrote ReaperOAK.agent.md (84 → 102 lines) with CARDINAL RULE section:
  "YOU DO NOT IMPLEMENT" — zero self-implementation, mandatory parallel
  delegation via `runSubagent`
- Explicit whitelist of what ReaperOAK MAY do (read files, memory bank, git
  status) vs what it MUST delegate (all code, tests, docs, architecture, etc.)
- Added delegation workflow: Read → Plan → Delegate (parallel) → Validate →
  Report
- Reinforced in `agents.md` boot file: "ReaperOAK is a PURE ORCHESTRATOR"

### [2026-02-26] Session 7 — Cross-Agent Communication

- Tested Kanban build: ReaperOAK successfully delegated to 4 agents in parallel
  but (a) did all the thinking itself (architecture, API contracts, DB schema)
  instead of letting Architect do it, (b) agents couldn't see each other's
  output — Backend didn't read Architect's contracts, QA didn't read Backend's code
- **Root cause:** No dependency model — all agents launched flat in parallel with
  specs baked into the prompt by ReaperOAK, bypassing domain expertise
- **Fix: Phased Delegation with File-Based Handoff**
  - ReaperOAK now uses dependency phases (SPEC → BUILD → VALIDATE → DOCUMENT)
  - Within each phase: all agents run in parallel (no cap)
  - Between phases: ReaperOAK validates, then launches next phase
  - Each phase's files on disk become the next phase's input
  - Delegation prompt template now includes "Upstream artifacts" field
- All 10 subagent MANDATORY FIRST STEPS updated: step 3 = "Read upstream
  artifacts listed in delegation prompt BEFORE starting"
- Cross-cutting protocols: added §6 "Cross-Agent Communication (File-Based
  Handoff)" — agents must read upstream, align with prior contracts, write
  clean deliverables, and stop+report if upstream is missing
- **Next:** Fresh ReaperOAK session, re-test with Kanban prompt — expect phased
  execution with Architect/PM first, then Backend/Frontend/DevOps, then QA/Security

## Session 8 — Self-Improving System Migration (2025-07-25)

### Current Focus
- Completed full migration to self-improving multi-agent architecture
- All 6 subsystems designed and implemented

### Changes Made
1. **Shared Context Layer** — Created workflow-state.json, artifacts-manifest.json, feedback-log.md in memory bank
2. **UIDesigner Agent** — New agent with Google Stitch integration, Playwright visual validation, component specs
3. **Self-Improvement System** — Proposals directory, RETROSPECTIVE phase, auto-reject rules
4. **ReaperOAK Upgrade** — 6-phase SDLC (added RETROSPECTIVE), state management obligations, proposal handling
5. **Schema Extensions** — Delegation packet: phase, upstream_artifacts, mcp_grants, fix_loop_context, output_contract fields
6. **Architecture Update** — ARCHITECTURE.instructions.md v4.0.0 with UIDesigner, shared context layer, §18 self-improvement
7. **Catalog + ACL** — UIDesigner entries in catalog.yml, tool-acl.yaml, design: tag

### Validation Results
- QA: PASS (1 MEDIUM fixed, 2 LOW noted)
- Security: CONDITIONAL PASS (5 MEDIUM — 2 fixed, 3 accepted as design-level, 3 LOW — 1 fixed)
- CI: PASS (2 warnings fixed, 1 suggestion noted)
- Fix loop: 1 iteration — all actionable findings resolved

### Files Created (7)
- `.github/agents/UIDesigner.agent.md`
- `.github/vibecoding/chunks/UIDesigner.agent/chunk-01.yaml`
- `.github/vibecoding/chunks/UIDesigner.agent/chunk-02.yaml`
- `.github/proposals/.gitkeep`
- `.github/memory-bank/workflow-state.json`
- `.github/memory-bank/artifacts-manifest.json`
- `.github/memory-bank/feedback-log.md`

### Files Modified (7)
- `.github/agents/ReaperOAK.agent.md` — RETROSPECTIVE, UIDesigner, state mgmt, proposals
- `.github/vibecoding/catalog.yml` — UIDesigner + design tag
- `.github/sandbox/tool-acl.yaml` — UIDesigner section
- `.github/tasks/delegation-packet-schema.json` — UIDesigner + 5 new fields
- `.github/memory-bank/schema.md` — 3 new file schemas + riskRegister writers fix
- `.github/instructions/ARCHITECTURE.instructions.md` — v4.0.0, UIDesigner, shared context, self-improvement
- `.github/copilot-instructions.md` — updated repo structure

### Architecture Document
- Full design at `docs/architecture/self-improving-system.md` (1,466 lines)

## Session 9 — TODO Agent & Execution Governance (2025-07-26)

### Current Focus
- Fixed two architectural flaws: (1) UIDesigner not invoked when required, (2) subagents attempted monolithic execution instead of granular tasks
- New TODO Agent created for task decomposition
- SDLC upgraded from 6-phase to 7-phase (DECOMPOSE added as Phase 0)
- UI/UX Gate enforces UIDesigner invocation for all UI-touching work

### Changes Made
1. **TODO Agent** — New agent (13th) for granular task decomposition, L2 autonomy, constrained terminal access
2. **DECOMPOSE Phase** — New Phase 0 in SDLC: ReaperOAK delegates to TODO Agent before SPEC
3. **UI/UX Gate** — Mandatory check between DECOMPOSE and SPEC, keyword detection, requires UIDesigner tasks for UI work
4. **TODO-Driven Delegation** — Max 3 tasks/cycle (5 for SPEC), task-driven delegation with specific IDs
5. **Loop Detection** — 4 new signals: TODO stall, zero-progress cycle, blocked dependency chain, max-task-per-cycle violation
6. **Architecture Update** — ARCHITECTURE.instructions.md v4.1.0 with §10.1 UI/UX Enforcement Gate
7. **Security Hardening** — runInTerminal constrained to `python todo_visual.py`, allowlist write scope, memory bank write access removed

### Validation Results
- QA: CONDITIONAL PASS → 2 MEDIUM + 1 LOW findings
- Security: CONDITIONAL PASS → 1 HIGH + 3 MEDIUM + 3 LOW findings
- Fix loop 1: All HIGH + MEDIUM findings resolved (5 fixes applied)
- Post-fix verification: All fixes confirmed

### Files Created (5)
- `.github/agents/TODO.agent.md` (71 lines)
- `.github/vibecoding/chunks/TODO.agent/chunk-01.yaml` — decomposition protocol
- `.github/vibecoding/chunks/TODO.agent/chunk-02.yaml` — governance rules
- `TODO/.gitkeep` — task files directory
- `docs/architecture/todo-execution-governance.md` (1,374 lines) — design spec

### Files Modified (7)
- `.github/agents/ReaperOAK.agent.md` — DECOMPOSE, UI/UX Gate, TODO-Driven Delegation
- `.github/tasks/delegation-packet-schema.json` — TODO agent, DECOMPOSE phase, todo_task_id
- `.github/guardian/loop-detection-rules.md` — 4 new signals
- `.github/vibecoding/catalog.yml` — TODO chunks under agent: and general: tags
- `.github/sandbox/tool-acl.yaml` — TODO section with allowlist, terminal constraint
- `.github/instructions/ARCHITECTURE.instructions.md` — v4.1.0
- `.github/copilot-instructions.md` — 13 agents, TODO directory

### Reports Generated (2)
- `docs/reviews/qa-report.md`
- `docs/reviews/security-report.md`

---

### [2026-02-26T00:00:00Z] ReaperOAK — Session 10

- **Focus:** SDLC Enforcement Upgrade — production-grade task lifecycle
- **Status:** COMPLETE
- **Pipeline:** DECOMPOSE → SPEC → BUILD (4 cycles) → VALIDATE → GATE → FIX LOOP (1 iter) → RE-VALIDATE → DOCUMENT
- **Agents Used:** TODO, Architect, Backend (×5), QA Engineer, Security Engineer, Documentation Specialist

### Problem Statement
6 identified weaknesses: no strict test→validate loop, bugs caught late, no initialization enforcement, Frontend bypassing UIDesigner, no Definition of Done, no mandatory validation gates.

### Changes Made
1. **7-Stage Task-Level SDLC** — Inner loop within BUILD phase: PLAN → INITIALIZE → IMPLEMENT → TEST → VALIDATE → DOCUMENT → MARK COMPLETE. Hard gates between every stage.
2. **Validator Agent** — 14th agent (L2 autonomy), independent SDLC compliance reviewer. Can reject task completion. Read-heavy, write only to docs/reviews/. 14 forbidden actions.
3. **Definition of Done Template** — 10 items (DOD-01 to DOD-10) with evidence requirements, machine-parseable format, Validator-enforced.
4. **Initialization Checklist** — 9 items (INIT-01 to INIT-09) with frontend/backend/fullstack conditional applicability. Blocks IMPLEMENT if incomplete.
5. **8-Layer Bug-Catching Strategy** — G1-G3 at IMPLEMENT, G4-G5 at TEST, G6-G8 at VALIDATE. Pass/fail criteria per gate.
6. **Governance Architecture** — State machine, blocking rules, rework loops (max 3 → user escalation).
7. **5 New Loop Detection Signals** — SDLC Stage Skip, DoD Non-Compliance, Initialization Skip, UI/UX Gate Bypass, Validator Rejection Loop.
8. **STOP_ALL Keyword Fix** — Standardized on `STOP` keyword across agents.md and Validator.agent.md.
9. **Documentation Agent Write Scope** — Denied writes to docs/reviews/** to prevent Validator report tampering.

### Validation Results
- QA: FAIL → Fix Loop 1 (3 CRITICAL + 2 HIGH fixed) → Re-VALIDATE: PASS
- Security: PASS_WITH_FINDINGS (3 MEDIUM, 4 LOW — no CRITICAL/HIGH)
- Fixes applied: C1 (init field alignment), C2 (design doc INIT items), C3 (template paths), H1 (autonomy L2), H2 (model name), M1 (STOP keyword), M2 (doc agent scope), L1 (schema hardening)

### Files Created (8)
- `.github/agents/Validator.agent.md` (150 lines)
- `.github/vibecoding/chunks/Validator.agent/chunk-01.yaml` (~2017 tokens)
- `.github/vibecoding/chunks/Validator.agent/chunk-02.yaml` (~2377 tokens)
- `.github/tasks/definition-of-done-template.md` (10 DoD items)
- `.github/tasks/initialization-checklist-template.md` (9 init items)
- `docs/architecture/sdlc-enforcement-design.md` (1,193 lines)
- `docs/reviews/qa-report.md`
- `docs/reviews/security-report.md`

### Files Modified (9)
- `.github/instructions/ARCHITECTURE.instructions.md` — v4.1.0 → v5.0.0 (Validator, SDLC, DoD, init, gates, governance)
- `.github/agents/ReaperOAK.agent.md` — Task-Level SDLC Loop, Validator in tables
- `.github/tasks/delegation-packet-schema.json` — Validator enum, sdlc_stage, dod_checklist, initialization_checklist
- `.github/guardian/loop-detection-rules.md` — 5 new detection signals
- `.github/vibecoding/catalog.yml` — validation: and sdlc-enforcement: tags
- `.github/sandbox/tool-acl.yaml` — Validator section + Documentation agent deny
- `.github/copilot-instructions.md` — 14 agents, Validator added
- `agents.md` — Validator definition + Task-Level SDLC Compliance section + STOP keyword fix
- `TODO/SDLC_TODO.md` — 13 tasks (all complete)

---

### [2026-02-27T00:00:00Z] Ticket-Driven Event-Based Engine (Session 13)

- **Focus:** Complete orchestration model replacement — phase-based → ticket-driven
- **Agent:** ReaperOAK
- **Scope:** TDSA-BE001 through TDSA-DOC001 (7 tasks, all DONE)

### Key Changes
- **ReaperOAK.agent.md** — COMPLETE REWRITE (833→810 lines). 20 sections. Ticket-driven event loop replaces phased model. 9-state machine: BACKLOG → READY → LOCKED → IMPLEMENTING → REVIEW → VALIDATED → DOCUMENTED → COMMITTED → DONE. Mandatory per-ticket post-execution chain: QA → Validator → Doc → CI Reviewer → Commit. Event emission protocol (9 types). Anti-one-shot guardrails. Commit enforcement per ticket.
- **TODO.agent.md** — Updated (133→175 lines). Ticket Compatibility section added. L3 tasks = tickets entering BACKLOG. 9-state backward compat mapping.
- **_cross-cutting-protocols.md** — Updated (102→209 lines). Section 8: Event Emission Protocol (9 event types, structured payloads). Section 9: Anti-One-Shot Guardrails (scope enforcement, 2-pass minimum, anti-batch detection).
- **agents.md** — Updated (200→191 lines). Boot protocol references ticket-driven event loop, 9-state machine, post-execution chain, event emission §8, anti-one-shot §9.
- **chunk-01.yaml** — Updated (315→324 lines). Format A default BACKLOG, 9-state values, ticket model notes. Hash: PENDING_RECOMPUTE.
- **chunk-02.yaml** — Updated (297→306 lines). 9-state model replaces 8-state. Post-execution chain aligned. Governance rules updated. Hash: PENDING_RECOMPUTE.
- **ARCHITECTURE.instructions.md** — Updated v6.0.0→v7.0.0 (1044→1194 lines). Full ticket-driven architecture documented.

### Validator Review
- All 7 checks PASSED at 95% confidence (V1-V7)
- Advisory: 8+ out-of-scope files still reference old model (Validator.agent.md, loop-detection-rules.md, delegation-packet-schema.json, etc.) — technical debt for future ticket

### What to Do Next
- Create remediation ticket for out-of-scope files referencing old model
- Recompute chunk hashes for chunk-01.yaml and chunk-02.yaml
- Update workflow-state.json and artifacts-manifest.json

---

### [2026-02-28T12:00:00Z] Elastic Multi-Worker Parallel Execution Engine v8.1.0 (Session 14 continued)

- **Focus:** Elastic auto-scaling pools, dynamic worker IDs, parallel dispatch
- **Agent:** ReaperOAK (orchestrator), Backend workers (implementers)
- **Scope:** EWPE-BE001 through EWPE-BE003 (3 tasks, all DONE)
- **DAG:** BE001 → (BE002 || BE003) — parallel execution after critical path

### Key Changes
- **ReaperOAK.agent.md** — Updated (1077→1453 lines, v8.0.0→v8.1.0). §7 elastic pool registry with minSize/maxSize/scalingPolicy, dynamic worker IDs `{Role}Worker-{shortUuid}`, Worker Instance Schema, 5-state Worker Lifecycle, One-Ticket-One-Worker Rule. §9 auto-scaling + parallel dispatch. §10 6th conflict type (mutual exclusion). §13 4 new scaling events. §15 worker termination on multi-ticket violation. §20-§22 elastic examples.
- **ARCHITECTURE.instructions.md** — Updated (1728→1960 lines, v8.0.0→v8.1.0). §2 elastic pool table. §5 3-phase scheduling. §6.8 dynamic lock IDs. §8 4 new elastic events (16 total routing entries). §11 full elastic pool rewrite. §32 dynamic worker ID examples.
- **agents.md** — Updated (233→238 lines). Worker Pool Model paragraph rewritten with elastic pools, dynamic worker IDs, parallel dispatch.
- **_cross-cutting-protocols.md** — Updated (241→245 lines). §8.1 now 6 events including WORKER_SPAWNED, WORKER_TERMINATED, POOL_SCALED_UP, POOL_SCALED_DOWN.

### Verification Results
- 0 static worker IDs across all 4 files
- Dynamic worker ID refs: ReaperOAK=93, ARCHITECTURE=54, agents=2, _cross-cutting=1
- Elastic event refs: ReaperOAK=42, ARCHITECTURE=30, _cross-cutting=4
- Both canonical files confirmed at v8.1.0

### What to Do Next
- Update chunk files (chunk-01.yaml, chunk-02.yaml) with elastic pool content
- Update workflow-state.json and artifacts-manifest.json for EWPE tickets
- Test elastic pool dispatch in real multi-ticket scenario

---

## Session 15 — Operational Integrity Protocol (OIP) v1.0.0

**Date:** 2026-03-01
**Objective:** Implement self-healing governance layer for Light Supervision Mode (Model B)

### Current Focus
Implementing OIP v1.0.0 — 7-part protocol upgrade from v8.1.0 to v8.2.0:
1. Core Invariants (9 non-negotiable rules)
2. Automatic Drift Detection (7 violation types: DRIFT-001 to DRIFT-007)
3. Auto-Repair Workflow (ComplianceWorker pool, targeted single-action repair)
4. Scoped Git Enforcement (no git add . / -A / --all, explicit file staging)
5. Parallel Backfill Stream (Stream A execution + Stream B retroactive repair)
6. Memory Enforcement Gate (5 required fields, blocks COMMIT without entry)
7. Continuous Health Sweep (5 checks per scheduling interval)
8. Light Supervision Mode (auto-correct drift, human only for strategy)

### Changes Made

**ReaperOAK.agent.md** — v8.1.0→v8.2.0 (1454→1863 lines, +409). Added §19-§26 (OIP core). Renumbered §19-§22→§27-§30. ComplianceWorker pool in §7. PROTOCOL_VIOLATION + REPAIR_COMPLETED events in §13. Health Sweep in §9 scheduling loop.

**ARCHITECTURE.instructions.md** — v8.1.0→v8.2.0 (1961→2092 lines, +131). §33 OIP overview (6 subsections). §5.1 health sweep in scheduling loop. §8.1 two new events. §8.3 two routing entries. §10.4 scoped git. §15.2 memory gate.

**_cross-cutting-protocols.md** — (245→339 lines, +94). §11 OIP cross-cutting rules (7 subsections: events, scoped git, memory, evidence, single-ticket, ComplianceWorker, health sweep awareness).

**agents.md** — (238→292 lines, +54). §6 OIP memory enforcement. §9 OIP reference section (scoped git, memory gate, single-ticket, evidence, ComplianceWorker, health sweep).

### OIP-ARCH-001 — ReaperOAK.agent.md OIP Core
- **Artifacts:** .github/agents/ReaperOAK.agent.md
- **Decisions:** OIP sections §19-§26 placed before worked examples; ComplianceWorker added as new pool role
- **Timestamp:** 2026-03-01T00:00:00Z

### OIP-ARCH-002 — ARCHITECTURE.instructions.md OIP Documentation
- **Artifacts:** .github/instructions/ARCHITECTURE.instructions.md
- **Decisions:** New §33 for OIP overview; existing §5, §8, §10, §15 augmented with subsections
- **Timestamp:** 2026-03-01T00:10:00Z

### OIP-ARCH-003 — Cross-Cutting Protocols OIP Rules
- **Artifacts:** .github/agents/_cross-cutting-protocols.md
- **Decisions:** §11 covers all agent-facing OIP rules; agents need to know events, scoped git, memory
- **Timestamp:** 2026-03-01T00:20:00Z

### OIP-ARCH-004 — Boot Protocol OIP References
- **Artifacts:** agents.md
- **Decisions:** §9 provides concise OIP reference; §6 adds memory gate format template
- **Timestamp:** 2026-03-01T00:30:00Z

### What to Do Next
- Update chunk files with OIP content (chunks/{Agent}.agent/ files)
- Update README.md with OIP governance section
- Test OIP drift detection in real ticket execution scenario

---

## Session 16 — Structural Hardening v9.0.0

### Current Focus
Completed 7-part structural hardening upgrade: unlimited elastic workers, governance hierarchy, modular context injection.

### SH-001 — Governance Policy Files
- **Artifacts:** .github/governance/lifecycle.md, worker_policy.md, commit_policy.md, memory_policy.md, ui_policy.md, security_policy.md, event_protocol.md, context_injection.md, performance_monitoring.md
- **Decisions:** 9 policy files extracted from ReaperOAK §§, each under 250-line limit
- **Timestamp:** 2026-03-01T02:00:00Z

### SH-002 — Core Governance Authority
- **Artifacts:** .github/instructions/core_governance.instructions.md
- **Decisions:** Canonical authority file indexes all governance policies; version tracking in governance files only (NOT agent frontmatter)
- **Timestamp:** 2026-03-01T02:10:00Z

### SH-003 — ReaperOAK Transformation
- **Artifacts:** .github/agents/ReaperOAK.agent.md
- **Decisions:** Rewritten from scratch: 1864→723 lines (61% reduction), 24 sections, zero maxSize/minSize, governance references replace inline policy
- **Timestamp:** 2026-03-01T02:20:00Z

### SH-004 — Agent Normalization
- **Artifacts:** (no file changes — reverted per user constraint)
- **Decisions:** Agent .agent.md YAML frontmatter is OFF-LIMITS for custom fields; governance version tracked exclusively in governance files
- **Timestamp:** 2026-03-01T02:30:00Z

### SH-005 — Boot Protocol Update
- **Artifacts:** agents.md
- **Decisions:** Added governance authority subsection (§3), unbounded pool language (§4), updated OIP references (§9)
- **Timestamp:** 2026-03-01T02:40:00Z

### SH-006 — Cross-Cutting + Architecture
- **Artifacts:** .github/agents/_cross-cutting-protocols.md, .github/instructions/ARCHITECTURE.instructions.md
- **Decisions:** ARCHITECTURE.instructions.md v9.0.0 with unbounded pools, governance hierarchy in §19, DRIFT-008/009 in §33. Cross-cutting §8.1+§11 updated.
- **Timestamp:** 2026-03-01T02:50:00Z

### SH-007 — Catalog Update
- **Artifacts:** .github/vibecoding/catalog.yml
- **Decisions:** Added governance: tag with all 10 governance file paths
- **Timestamp:** 2026-03-01T03:00:00Z

### What to Do Next
- Rechunk ReaperOAK.agent.md (was 3 chunks for 1864 lines, now 821 lines — may need 2)
- Update ARCHITECTURE.instructions.md chunks if stale
- Verify all agent chunk files still align with new governance references
- Run full system test with real ticket execution
- Consider adding OIP worked example (§31) to ReaperOAK.agent.md

---

## Session 17 — Operational Concurrency Floor (OCF) v9.1.0

### OCF-001 — ReaperOAK Scheduler OCF
- **Artifacts:** .github/agents/ReaperOAK.agent.md
- **Decisions:** Added §25 OCF specification (background ticket taxonomy, preemption, throttle, anti-recursion). Updated §6 scheduling loop with CONCURRENCY FLOOR PHASE between AUTO-SCALE and ASSIGNMENT. MIN_ACTIVE_WORKERS=10. Two work classes: Class A (primary) and Class B (background). 10 background ticket types. Version bumped to v9.1.0.
- **Timestamp:** 2026-03-01T04:00:00Z

### OCF-002 — ARCHITECTURE.instructions.md OCF
- **Artifacts:** .github/instructions/ARCHITECTURE.instructions.md
- **Decisions:** Added §34 OCF architecture documentation (work classes, 10 BG types, preemption rules, context injection limits, commit policy, throttle safeguards, continuous improvement loop, anti-recursion guard, example scenario). Updated §5.1 scheduling loop pseudocode with concurrency floor phase. Added OCF properties to §5.2. Version header bumped to v9.1.0.
- **Timestamp:** 2026-03-01T04:00:00Z

### What to Do Next
- Rechunk ReaperOAK.agent.md (now 821 lines with §25 OCF)
- Update ARCHITECTURE.instructions.md chunks (now 2227 lines with §34 OCF)
- Test OCF scheduling loop with mixed Class A/B ticket scenarios
- Verify preemption behavior under load