---
name: stop
description: Structured shutdown protocol using ForgeOS MCP tools only. Drains active tickets, consolidates memory, and produces resume artifacts.
agent: 'Ticketer'
argument-hint: 'No arguments needed — just invoke /stop to cleanly pause development'

We are entering SYSTEMATIC SHUTDOWN MODE using MCP tools only.`

Goal: Cleanly pause all development while preserving full state for resumption.`

No new feature work. No new tickets. No architectural changes.`

---

# STEP 1 — DRAIN ACTIVE TICKETS`

Call `tickets.list({stage: "BACKEND"})`, `tickets.list({stage: "FRONTEND"})`, etc.`

For each active ticket, complete its remaining SDLC chain using MCP tools only:`

**If in BACKEND/FRONTEND/ARCHITECT/RESEARCH (implementing stage):**`

1. Let implementing worker finish (or roll back to READY if lease expired >30min).`
2. Then run the full post-implementation chain (strict order):`

```
runSubagent("QA", prompt="Review ticket {TICKET-ID}. Verify test coverage ≥80%.`
  Run test suite. Check for console errors, unhandled promises.`
  Verdict: PASS or REJECT.")
runSubagent("Security", prompt="Security review for ticket {TICKET-ID}.`
  STRIDE + OWASP Top 10 scan.`
  Verdict: PASS or REJECT.")
runSubagent("CIReviewer", prompt="Check lint, types, complexity for ticket {TICKET-ID}.`
  Verdict: PASS or REJECT.")
runSubagent("Documentation", prompt="Update docs for ticket {TICKET-ID}.`
  CHANGELOG, README (if interface changed), JSDoc/TSDoc.")
runSubagent("Validator", prompt="Verify DoD compliance for ticket {TICKET-ID}. All 10 items.`
  Verdict: APPROVED or REJECTED.")
```

**Resume from current stage:**`

| Current Stage | Run from |`
|---------------|----------|`
| QA | Security → CI → Docs → Validator |`
| SECURITY | CI → Docs → Validator |`
| CI | Docs → Validator |`
| DOCS | Validator |`
| VALIDATION | Complete Validator review |`

---

# STEP 2 — CONSOLIDATE MEMORY`

1. **Produce Resume Artifacts using MCP tools:**`

```
tickets.get("RESUME_POINT.md", {create: true, content: "..."})
tickets.get("SESSION_SUMMARY.md", {create: true, content: "..."})
tickets.get("SYSTEM_SNAPSHOT.json", {create: true, content: "..."})
```

**RESUME_POINT.md format:**`
```
### [TASK-FOS-##-###] — {Title} — {Date)`
- **Phase 1:** {Discovery summary}`
- **Phase 2:** {Reconstruction summary}`
- **Phase 3:** {Task summary}`
- **Artifacts:** {File paths}`
- **Decisions:** {Key decisions with rationale}`
- **Confidence:** {HIGH/MEDIUM/LOW} — {Rationale}`
```

2. **Archive old resume artifacts:**`

```
tickets.update("RESUME_POINT.md", {archived: true})
tickets.update("SESSION_SUMMARY.md", {archived: true})
tickets.update("SYSTEM_SNAPSHOT.json", {archived: true})
```

Do NOT write code yet. State alignment must complete first.`

---

# STEP 3 — FINAL STATE CHECK`

1. Verify via MCP tools:`
   - `tickets.list({stage: "READY"})` → should be 0 active workers.`
   - `tickets.list({stage: "VALIDATION"})` → all DONE tickets have Validator + Doc + CI entries.`
   - `tickets.stats()` → clean state.`

2. Check git state: no uncommitted changes.`

---

# STEP 4 — HANDOFF CONFIRMATION`

When ending the session, confirm:`

- All READY tickets processed through full SDLC.`
- No validation backlog (all DONE tickets have Validator + Doc + CI entries).`
- Clean git state (`git status --porcelain` empty).`

This will produce `RESUME_POINT.md`, `SESSION_SUMMARY.md`, and`
`SYSTEM_SNAPSHOT.json` — consumed by `/continue` prompt's Step 1 on next run.`

---

**Operating constraints:**`

- Move forward — do not re-diagnose the entire repository.`
- Do not rewrite stable components.`
- Do not generate new roadmap unless explicitly requested.`
- Maintain velocity and governance.`
- Ticketer does NOT reason about file conflicts — git push conflicts enforce safety.`
- Ticketer does NOT implement code — only dispatches and advances. Its toolset is restricted to `memory/*`, `execute/*`, `github/*`, and `sequentialthinking/*`.`
- All agents read their own chunks from `.github/skills/{Agent}/`.`
- All agents derive context from MCP tools — Ticketer does NOT inject context.`
- All agents follow their Assigned Tool Loadout defined in `.github/agents/{Agent}.agent.md`.`
- Dispatcher-claim protocol enforced: Ticketer performs CLAIM via `tickets.claim()` → subagent performs WORK commit (deliverables).`
- Scoped git only — no `git add .` / `git add -A` / `git add --all`.`
- Each agent must invoke `sequentialthinking` to plan execution before touching any files.`
- Agents use `oraios/serena/*` for code navigation and atomic edits — never generic `read_file` for large files.`