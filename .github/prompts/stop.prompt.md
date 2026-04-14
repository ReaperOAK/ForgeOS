---
name: stop
description: Structured shutdown protocol. Drains active tickets, consolidates memory, and produces resume artifacts for continue.prompt.md.
agent: 'Ticketer'
argument-hint: 'No arguments needed — just invoke /stop to cleanly pause development'
---

We are entering SYSTEMATIC SHUTDOWN MODE.

Goal: Cleanly pause all development while preserving full state for resumption.

No new feature work. No new tickets. No architectural changes.

---

# STEP 1 — HALT NEW SPAWNS

Immediate actions:

1. Do NOT call `runSubagent` for any new ticket implementation.
2. Do NOT invoke the TODO Agent for decomposition.
3. Allow currently active workers to complete their current SDLC stage only.

---

# STEP 2 — DRAIN ACTIVE TICKETS

Run `python3 tickets.py --status --json` to see full ticket landscape.

For each ticket past READY, complete its remaining SDLC chain.
Do NOT skip any stage. Use the correct post-implementation chain order:

**If in BACKEND/FRONTEND/ARCHITECT/RESEARCH (implementing stage):**

1. Let implementing worker finish (or roll back to READY if lease expired >30min).
2. Then run the full post-implementation chain (strict order):

```
runSubagent("QA Engineer", prompt="Review ticket {TICKET-ID}. Run tests, verify coverage ≥80%...")
runSubagent("Security Engineer", prompt="Security review for ticket {TICKET-ID}. STRIDE + OWASP scan...")
runSubagent("CI Reviewer", prompt="Check lint, types, complexity for ticket {TICKET-ID}...")
runSubagent("Documentation Specialist", prompt="Update docs for ticket {TICKET-ID}...")
runSubagent("Validator", prompt="Verify DoD compliance for ticket {TICKET-ID}. Check all 10 items...")
```

**Resume from current stage:**

| Current Stage | Run from |
|---------------|----------|
| QA | Security → CI → Docs → Validator |
| SECURITY | CI → Docs → Validator |
| CI | Docs → Validator |
| DOCS | Validator |
| VALIDATION | Already at final review — complete Validator |

Each ticket must end in DONE or be explicitly set to READY/BLOCKED.
No ticket may remain in an intermediate state.

---

# STEP 3 — RECONCILE TICKET STATES

1. Run `python3 tickets.py --sync` to release expired claims and fix state.
2. Any ticket stuck in an intermediate stage that was NOT drained in Step 2:
   - Set to READY (if safe to re-process) or BLOCKED (if invalid state).
3. Update ticket state copies under `ticket-state/<STAGE>/` and master metadata under `tickets/`.
4. Run `python3 tickets.py --validate` to check integrity.

---

# STEP 4 — LEASE CLEANUP

1. Run `python3 tickets.py --release-expired` to clear all stale claims.
2. Run `git status` to confirm no unexpected staged/unstaged changes.

---

# STEP 5 — MEMORY CONSOLIDATION

Update memory bank files (append-only, per ownership rules in `core.instructions.md`):

| File | Action |
|------|--------|
| `.github/memory-bank/activeContext.md` | Append session summary: what was worked on, current state |
| `.github/memory-bank/progress.md` | Append: tickets completed this session, completion percentage |
| `.github/memory-bank/decisionLog.md` | Append: session decisions and trade-offs (Ticketer only) |
| `.github/memory-bank/riskRegister.md` | Append: new risks identified, resolved risks |
| `.github/memory-bank/feedback-log.md` | Append: QA/Validator/CI feedback from this session |

Then generate:

**`.github/memory-bank/SESSION_SUMMARY.md`**

```markdown
# Session Summary — {date}

## Tickets Completed
- {TICKET-ID}: {description}

## Tickets Remaining (READY)
- {TICKET-ID}: {description} (priority: P{n})

## Tickets Blocked
- {TICKET-ID}: {reason}

## Tickets In Rework/Escalated
- {TICKET-ID}: {reason}, rework_count: {n}

## Architecture Changes
- {description}

## Security Updates
- {description}

## Tech Debt Delta
- Introduced: {items}
- Reduced: {items}
```

---

# STEP 6 — SYSTEM SNAPSHOT

Generate:

**`.github/memory-bank/SYSTEM_SNAPSHOT.json`**

```json
{
  "timestamp": "{ISO8601}",
  "tickets": {
    "total": 0,
    "done": 0,
    "ready": 0,
    "blocked": 0,
    "implementing": 0,
    "in_review": 0
  },
  "session_metrics": {
    "tickets_completed_this_session": 0,
    "rework_count": 0
  }
}
```

---

# STEP 7 — INTEGRITY VERIFICATION

Before final stop, verify:

```bash
# Check for uncommitted changes
git status --porcelain

# Check recent commits for scoped staging
git log --oneline -20

# Verify no TODO/FIXME in recently changed files
git diff --name-only HEAD~5 | xargs grep -l 'TODO\|FIXME\|HACK\|XXX' 2>/dev/null || echo "Clean"
```

Checklist:
- [ ] No ticket skipped commit (cross-check `ticket-state/DONE/` tickets vs git log)
- [ ] No ticket skipped Validator (check feedback-log.md for Validator entries per DONE ticket)
- [ ] No ticket skipped documentation (check feedback-log.md for Doc entries per DONE ticket)
- [ ] No `git add .` in recent commits
- [ ] No uncommitted changes (`git status --porcelain` is empty)
- [ ] All agents operated within their Assigned Tool Loadout (no out-of-scope tool usage in agent summaries)

If any violation found, spawn the appropriate agent to fix it:
- Missing QA → `runSubagent("QA Engineer", ...)`
- Missing Security → `runSubagent("Security Engineer", ...)`
- Missing CI → `runSubagent("CI Reviewer", ...)`
- Missing docs → `runSubagent("Documentation Specialist", ...)`
- Missing validation → `runSubagent("Validator", ...)`

Then re-verify.

---

# STEP 8 — RESUME MARKER

Run: `python3 tickets.py --status --json` to get current state.
Read `.github/memory-bank/riskRegister.md` for open risks.

Generate:

**`.github/memory-bank/RESUME_POINT.md`**

```markdown
# Resume Point — {date}

## Last Completed Ticket
{TICKET-ID}

## Branch
{current branch from `git branch --show-current`}

## Ticket Statistics
- Total: {n}
- DONE: {n}
- READY: {n}
- BLOCKED: {n}

## Next READY Tickets (Priority Order)
1. {TICKET-ID}: {title} (P{n}, owner: {role})
2. {TICKET-ID}: {title} (P{n}, owner: {role})
3. {TICKET-ID}: {title} (P{n}, owner: {role})

## Known Risks
- {risk from riskRegister.md}

## Session Artifacts
- `.github/memory-bank/SESSION_SUMMARY.md`
- `.github/memory-bank/SYSTEM_SNAPSHOT.json`
- `.github/memory-bank/RESUME_POINT.md` (this file)

## Cross-Reference
This file is consumed by `continue.prompt.md` Step 1.
```

---

# STEP 9 — FINAL STATUS

Verify final state:
- No active workers (no pending `runSubagent` calls)
- No partial SDLC tickets (all DONE, READY, or BLOCKED)
- No expired leases (run `--release-expired`)
- Clean git state (`git status --porcelain` empty)
- Memory bank updated (Step 5 complete)
- System snapshot written (Step 6 complete)
- Resume point created (Step 8 complete)

Then report to user:

```
SYSTEM_STATUS: SAFE_TO_RESUME

Session complete.
- Tickets completed: {n}
- Tickets remaining: {n}
- Resume point: .github/memory-bank/RESUME_POINT.md
- Next continuation: invoke continue.prompt.md
```

**Operating constraints (same as continue.prompt.md):**

- Ticketer is a dumb dispatcher — it NEVER reads/writes codebase files. Its toolset is restricted to `memory/*`, `execute/*`, `github/*`, and `sequentialthinking/*`
- All agents follow their Assigned Tool Loadout from `.github/agents/{Agent}.agent.md`
- Scoped git only — no `git add .` / `git add -A` / `git add --all`
- Agents use `oraios/serena/*` for code navigation and atomic edits
- Each agent invokes `sequentialthinking` to plan before touching files

Stop. No further execution.