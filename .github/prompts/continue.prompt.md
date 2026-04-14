---
name: continue
description: Resume development after a stop. Loads resume state, repairs incomplete SDLC chains, then resumes ticket processing with full governance enforcement.
agent: 'Ticketer'
argument-hint: 'No arguments needed — just invoke /continue to resume'
---

We are resuming structured development.

Do NOT reinitialize the project.
Do NOT re-run the takeover prompt.
Do NOT regenerate PRD unless explicitly required.

This is controlled continuation mode.

---

# STEP 1 — STATE REALIGNMENT

Before calling `runSubagent` for ANY work, load full system state.

**1a.** Check for resume artifacts (produced by `stop.prompt.md`):

```
read_file(".github/memory-bank/RESUME_POINT.md")
read_file(".github/memory-bank/SESSION_SUMMARY.md")
read_file(".github/memory-bank/SYSTEM_SNAPSHOT.json")
```

If `RESUME_POINT.md` exists → use it as primary resume anchor (skip 1b).
If missing → fall through to 1b for full state scan.

**1b.** Full state scan (only if no RESUME_POINT.md):

```
read_file(".github/memory-bank/activeContext.md")
read_file(".github/memory-bank/progress.md")
read_file(".github/memory-bank/decisionLog.md")
read_file(".github/memory-bank/riskRegister.md")
run_in_terminal("python3 tickets.py --status --json")
```

**1c.** Get current ticket landscape:

```bash
python3 tickets.py --sync
python3 tickets.py --status --json
```

**1d.** Verify boot sequence compliance — ensure agents follow the 11-step boot from `AGENTS.md`:
- STOP_ALL check → instructions → agent file (with Tool Loadout) → upstream summary → chunks → catalog → sequentialthinking plan

**1e.** Detect anomalies — scan `ticket-state/*` for:

- Tickets stuck in: BACKEND, FRONTEND, QA, SECURITY, CI, DOCS, VALIDATION
  (need SDLC chain completion in Step 2)
- Tickets with expired leases (run `--release-expired`)
- Tickets in REWORK with `rework_count >= 3` (need escalation to human)
- Tickets marked DONE but missing:
  - Validator entry in `feedback-log.md` → needs Validator pass
  - Documentation entry → needs Documentation pass

**1f.** Archive consumed resume artifacts:

```bash
mkdir -p .github/memory-bank/archive
mv .github/memory-bank/RESUME_POINT.md .github/memory-bank/archive/RESUME_POINT-{date}.md
mv .github/memory-bank/SESSION_SUMMARY.md .github/memory-bank/archive/SESSION_SUMMARY-{date}.md
mv .github/memory-bank/SYSTEM_SNAPSHOT.json .github/memory-bank/archive/SYSTEM_SNAPSHOT-{date}.json
```

Do NOT write code yet. State alignment must complete first.

---

# STEP 2 — BACKLOG CLEANUP

For every ticket found in Step 1d with incomplete SDLC, dispatch the
appropriate agents to complete the chain. Use EXACT agent names.

**Tickets stuck mid-SDLC (resume chain from current stage):**

| Current Stage | Agent Calls Needed |
|---------------|-------------------|
| BACKEND / FRONTEND / ARCHITECT / RESEARCH (stalled) | Roll back to READY — reassign in Step 3 |
| QA | Security → CI → Docs → Validator |
| SECURITY | CI → Docs → Validator |
| CI | Docs → Validator |
| DOCS | Validator |
| VALIDATION | Complete Validator review |

**Example: Ticket stuck at QA (Security not yet run):**

```
runSubagent("Security Engineer", prompt="
  Ticket ID: {TICKET-ID}
  Objective: Security review for ticket {TICKET-ID}.
  Run STRIDE threat analysis + OWASP Top 10 scan.
  Read implementation at: {file_paths}
  Verdict: PASS or REJECT with specific findings.
")
```

```
runSubagent("CI Reviewer", prompt="
  Ticket ID: {TICKET-ID}
  Objective: Verify lint, type-check, and complexity for ticket {TICKET-ID}.
  Report: PASS or REJECT with specific findings.
")
```

```
runSubagent("Documentation Specialist", prompt="
  Ticket ID: {TICKET-ID}
  Objective: Update documentation artifacts for ticket {TICKET-ID}.
  Read implementation at: {file_paths}
  Update: CHANGELOG.md, README.md (if interface changed), JSDoc/TSDoc.
  Confirm completion with artifact list.
")
```

```
runSubagent("Validator", prompt="
  Ticket ID: {TICKET-ID}
  Objective: Verify Definition of Done compliance for ticket {TICKET-ID}.
  Check all 10 DoD items.
  Verdict: APPROVED or REJECTED with specific failures.
")
```

Run independent cleanup calls in parallel — tickets that don't
share file paths can be processed simultaneously.

---

# STEP 3 — SELECT NEXT EXECUTABLE TICKETS

**3a.** Get READY tickets:

```bash
python3 tickets.py --sync
python3 tickets.py --status --json
```

**3b.** Filter and sort:

1. Exclude BLOCKED tickets.
2. Exclude tickets already in review stages (being handled by Step 2).
3. Sort by priority: P0 first, then P1, P2, etc.

**3c.** Dispatch workers — one `runSubagent` per READY ticket:

Ticketer does NOT compute file conflicts or safe parallel groups.
Ticketer performs the CLAIM commit before dispatching each subagent. Subagents only produce WORK commits.
Git push conflicts on the claim commit are the safety mechanism.

```
# Example: Backend ticket
runSubagent("Backend", prompt="
  Ticket ID: {TICKET-ID}
  Objective: {task description from ticket file}
  Acceptance Criteria:
    - {criterion 1}
    - {criterion 2}
  Upstream Artifacts:
    - {path}: {description}
  Deliverables: {file_paths}
  Boundaries: Do NOT modify files outside declared paths
  Scope: THIS TICKET ONLY
")

# Example: Frontend ticket
runSubagent("Frontend Engineer", prompt="
  Ticket ID: {TICKET-ID}
  Objective: {task description}
  ...same delegation structure...
")
```

**Agent name reference (EXACT, case-sensitive):**

| Role | runSubagent name |
|------|-----------------|
| Backend | `"Backend"` |
| Frontend | `"Frontend Engineer"` |
| QA | `"QA Engineer"` |
| Security | `"Security Engineer"` |
| DevOps | `"DevOps Engineer"` |
| Documentation | `"Documentation Specialist"` |
| Validator | `"Validator"` |
| CI Review | `"CI Reviewer"` |
| Architecture | `"Architect"` |
| Research | `"Research Analyst"` |
| Product | `"Product Manager"` |
| UI Design | `"UIDesigner"` |
| Task Decomposition | `"TODO"` |

Launch all READY tickets. One ticket → one dispatcher CLAIM → one worker → one WORK commit.
For N READY tickets, Ticketer claims each sequentially, then dispatches N workers in parallel (using N `runSubagent` calls). No grouping or batching logic. No dependency reasoning.

---

# STEP 4 — PER-TICKET SDLC CHAIN

For each dispatched ticket, enforce the full SDLC lifecycle per ticket type.

Example for backend: `READY → BACKEND → QA → SECURITY → CI → DOCS → VALIDATION → DONE`

After the implementing worker completes, run the mandatory
post-implementation chain using these exact calls (strict order):

```
# Step 1: QA Review
runSubagent("QA Engineer", prompt="
  Review ticket {TICKET-ID}. Verify test coverage ≥80%.
  Run test suite. Check for console errors, unhandled promises.
  Verdict: PASS or REJECT.
")

# Step 2: Security Review
runSubagent("Security Engineer", prompt="
  Security review for ticket {TICKET-ID}.
  STRIDE + OWASP Top 10 scan.
  Verdict: PASS or REJECT.
")

# Step 3: CI Review
runSubagent("CI Reviewer", prompt="
  Check lint, types, complexity for ticket {TICKET-ID}.
  Verdict: PASS or REJECT.
")

# Step 4: Documentation
runSubagent("Documentation Specialist", prompt="
  Update docs for ticket {TICKET-ID}.
  CHANGELOG, README (if interface changed), JSDoc/TSDoc.
")

# Step 5: Validator (Definition of Done)
runSubagent("Validator", prompt="
  Verify DoD for ticket {TICKET-ID}. All 10 items.
  Verdict: APPROVED or REJECTED with specific failures.
")
```

**On rejection at any step:**
- Increment `rework_count` for the ticket
- If `rework_count < 3`: re-delegate to implementing agent with rejection report
- If `rework_count >= 3`: escalate to human

No skipping stages. No partial execution. Each stage advances via `tickets.py --advance`.

---

# STEP 5 — LOOP

After completing Step 4 for dispatched tickets:

1. Re-run `python3 tickets.py --sync` to evaluate dependencies and move newly unblocked tickets to READY.
2. Re-run `python3 tickets.py --status --json`.
3. If new READY tickets exist → return to Step 3.
4. If no READY tickets remain and no active workers → proceed to Step 6.

---

# STEP 6 — SESSION END

Development continues until:

- All READY tickets processed through full SDLC
- No validation backlog (all DONE tickets have Validator + Doc + CI entries)
- Clean git state (`git status --porcelain` empty)

When ending the session, invoke the stop protocol to preserve state:

> Execute `.github/prompts/stop.prompt.md`

This will produce `RESUME_POINT.md`, `SESSION_SUMMARY.md`, and
`SYSTEM_SNAPSHOT.json` — consumed by this prompt's Step 1 on next run.

---

**Operating constraints:**

- Move forward — do not re-diagnose the entire repository
- Do not rewrite stable components
- Do not generate new roadmap unless explicitly requested
- Maintain velocity and governance
- Ticketer does NOT reason about file conflicts — git push conflicts enforce safety
- Ticketer does NOT implement code — only dispatches and advances. Its toolset is restricted to `memory/*`, `execute/*`, `github/*`, and `sequentialthinking/*`
- All agents read their own chunks from `.github/skills/{Agent}/`
- All agents derive context from filesystem — Ticketer does NOT inject context
- All agents follow their Assigned Tool Loadout defined in `.github/agents/{Agent}.agent.md` — no tool browsing or hallucination outside assigned loadout
- Dispatcher-claim protocol enforced: Ticketer performs CLAIM commit (ticket JSON) → subagent performs WORK commit (deliverables)
- Scoped git only — no `git add .` / `git add -A` / `git add --all`
- Each agent must invoke `sequentialthinking` to plan execution before touching any files
- Agents use `oraios/serena/*` for code navigation and atomic edits — never generic `read_file` for large files