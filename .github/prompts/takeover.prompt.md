---
name: Takeover
agent: Ticketer
model: Claude Opus 4.6 (copilot)
description: Initializes legacy repository takeover. Guides structured reconstruction before resuming normal autonomous ticket-driven execution.
---

We are entering LEGACY REPOSITORY TAKEOVER MODE.

This repository was not built under the autonomous orchestration system.
It may contain:
- Incomplete features
- No tickets or roadmap
- Partial or outdated docs
- Architectural drift
- Inconsistent patterns
- Broken tests
- Missing validation
- Technical debt

You must NOT begin implementing features immediately.
You must perform structured reconstruction.

---

# PHASE 0 — BOOT SEQUENCE

Before any work, execute the full 11-step boot sequence:
1. Read `.github/guardian/STOP_ALL` — if contains `STOP`: halt, zero edits.
2. Read all `.github/instructions/*.instructions.md` (6 files).
3. Read your agent file: `.github/agents/{YourAgent}.agent.md` — internalize the Assigned Tool Loadout.
4. Run `python3 .github/tickets.py --sync`
5. Run `python3 .github/tickets.py --status --json`
6. Read `.github/vibecoding/chunks/{YourAgent}.agent/` (all files).
7. Read `.github/vibecoding/catalog.yml`; load task-relevant chunks.
8. Invoke `sequentialthinking` to plan execution before touching any files.

All agents operate under strict Tool Loadouts per `agents.md` §0.1. No tool browsing or hallucination outside assigned loadout.

---

# PHASE 1 — CHAOS DIAGNOSIS (Parallel Discovery)

Spawn agents in parallel for read-only analysis:

**Research Analyst:**
- Analyze folder structure, main modules, entry points.
- Identify frameworks, languages, build system.
- Detect dependency graph and unused dependencies.
- Summarize current capabilities.

**Architect:**
- Reverse-engineer system architecture.
- Identify architectural style and violations of clean boundaries.
- Detect circular dependencies and missing abstraction layers.
- Detect scaling risks and missing infra components.

**QA Engineer:**
- Detect test presence and coverage gaps.
- Detect missing test harness.
- Identify critical untested flows.
- Detect failing tests (if runnable).

**Security Engineer:**
- Scan for OWASP Top 10 vulnerabilities.
- Detect exposed secrets and unsafe patterns.
- Detect missing auth flows and insecure configs.

**Documentation Specialist:**
- Scan README, compare docs vs code.
- Detect outdated docs and missing setup steps.

**DevOps Engineer:**
- Detect CI/CD, Docker, deployment configs.
- Detect environment variable usage.
- Detect missing staging config.

No implementation allowed in this phase.

Deliverables:
- `CHAOS_REPORT.md`
- `ARCHITECTURE_RECONSTRUCTION.md`
- `GAP_ANALYSIS.md`
- `TECH_DEBT_REPORT.md`
- `SECURITY_AUDIT_SUMMARY.md`

---

# PHASE 2 — RECONSTRUCT INTENT

If no PRD exists:

**Product Manager** must:
- Infer product intent from code.
- Identify user flows and implemented features.
- Identify half-built and missing features implied by code.
- Generate `RECONSTRUCTED_PRD.md`.

**Research Analyst** must:
- Compare inferred product to market alternatives.
- Identify missing features and improvement opportunities.

**Architect** must:
- Draft `TARGET_ARCHITECTURE.md`.
- Compare current vs target architecture.
- Identify refactor zones.

Do NOT modify code yet.

---

# PHASE 3 — TICKET GENERATION

**TODO agent** must:

1. Convert gap analysis into tickets:
   - Stabilization, refactor, missing feature, infra, security, documentation tickets
2. Create dependency graph and mark blockers.
3. Estimate impact and prioritize stabilization over new features.
4. Create structured task files in `TODO/tasks/`.
5. Parse L3 tasks into ticket JSON:
   ```bash
   python3 .github/tickets.py --parse TODO/tasks/
   ```
6. Run sync to evaluate dependencies:
   ```bash
   python3 .github/tickets.py --sync
   ```
7. Verify ticket state:
   ```bash
   python3 .github/tickets.py --status
   ```

Tickets must be granular — one change per ticket.
Each ticket must conform to `.github/tickets/ticket-schema.json`.
Tickets enter the file-based state machine at `.github/ticket-state/READY/`.

No implementation yet.

---

# PHASE 4 — STABILIZATION FIRST

Before feature work, execute in parallel:
- Critical bug fixes
- Broken build fixes
- Security patches
- Failing tests repair
- CI setup
- Missing lint rules

Each ticket must:
- Follow full SDLC through file-based state machine (`.github/ticket-state/`)
- Use dispatcher-claim protocol per stage: Ticketer performs Commit 1 (CLAIM) before dispatch, subagent performs Commit 2 (WORK) only
- Traverse per ticket type (e.g., backend): READY → BACKEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE
- Write agent summary to `.github/agent-output/{AgentName}/{ticket-id}.md`
- Read upstream summary from previous stage agent before starting

Post-implementation chain for every ticket (strict order):
1. **QA Engineer** — test coverage, functional verification
2. **Security Engineer** — vulnerability scan, security review
3. **CI Reviewer** — lint, types, complexity checks
4. **Documentation Specialist** — JSDoc/TSDoc, README updates
5. **Validator** — Definition of Done verification

Sync ticket state between stages:
```bash
python3 .github/tickets.py --sync
python3 .github/tickets.py --status
```

Parallel execution allowed — Ticketer claims via push-based distributed lock before dispatching (push failure = another operator claimed first).
Ticketer dispatches one subagent per READY ticket. No grouping, no batching.
For N READY tickets, N workers run in parallel (using N `runSubagent` calls). No grouping or batching logic. No dependency reasoning.

---

# PHASE 5 — CONTROLLED DEVELOPMENT RESUMPTION

Only after:
- Build passes
- Critical tests exist
- CI exists
- Architecture doc exists
- PRD reconstructed
- `.github/ticket-state/` directories populated
- `python3 .github/tickets.py --validate` passes integrity check

Then continue normal autonomous execution:
- Ticket by ticket via `python3 .github/tickets.py --sync` + `--status --json`
- Dispatcher-claim protocol enforced: Ticketer performs CLAIM commit (ticket JSON only) → subagent performs WORK commit (code + summary + advance)
- Ticketer is a dumb dispatcher — it NEVER reads/writes codebase files. Its toolset is restricted to `memory/*`, `execute/*`, `github/*`, and `sequentialthinking/*`
- All agents follow their Assigned Tool Loadout from `.github/agents/{Agent}.agent.md` — no out-of-scope tool usage
- Parallelized across operators/machines with push-based distributed locking
- Full SDLC loop through stage directories
- Agent summary handoff via `.github/agent-output/{AgentName}/{ticket-id}.md`
- Strict scoped git rules (explicit staging only, no `git add .`)
- Agents use `oraios/serena/*` for code navigation and atomic edits
- Each agent invokes `sequentialthinking` to plan before touching files
- Memory bank updates per `.github/instructions/core.instructions.md`

---

# SPECIAL RULES FOR LEGACY MODE

1. Do NOT mass-refactor blindly.
2. Do NOT rewrite entire modules without architectural justification.
3. Do NOT delete files without dependency analysis.
4. Do NOT auto-format entire codebase.
5. Prefer incremental stabilization.
6. Maintain compatibility unless explicitly approved.
7. Generate migration tickets instead of silent rewrites.
8. All agents must operate within their Assigned Tool Loadout — no tool browsing or hallucination.
9. Ticketer is a dumb dispatcher — it NEVER reads/writes codebase files, only dispatches and advances.

---

# CONFLICT HANDLING

If major architectural inconsistency found:
- Emit `ARCHITECTURE_REWRITE_REQUIRED`.
- Pause affected tickets only.
- Produce refactor roadmap.
- Resume after plan approved by human.

---

# DELIVERABLES

1. Chaos report
2. Reconstructed PRD
3. Target architecture
4. Gap analysis
5. Ticket tree (ticket JSON in `.github/tickets/`, state in `.github/ticket-state/`)
6. Stabilization completion
7. Updated README
8. Clean CI pipeline
9. Security baseline
10. Resume normal distributed orchestration

System must transition from unstructured vibecoded chaos to governed, ticket-driven, distributed engineering.

Verify system health:
```bash
python3 .github/tickets.py --status
python3 .github/tickets.py --validate
```

Do not skip reconstruction. Do not jump to coding.
Stabilize first. Then build.