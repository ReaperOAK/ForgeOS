---
name: Ticket System
applyTo: '**'
description: Ticket state machine, stage directories, tickets.py rules, dependency resolution, ticket JSON requirements.
---

# Ticket System

## 1. State = Directory Location

RULE: Ticket state is determined by which directory contains the ticket JSON.
RULE: Master copy lives at `.github/tickets/<ticket-id>.json`.
RULE: State copy lives at `.github/ticket-state/<STAGE>/<ticket-id>.json`.
RULE: Both must be kept in sync. Master is source of truth for metadata.
RULE: State directory is source of truth for current stage.

## 2. Stage Directories

```
.github/ticket-state/
    READY/       — Unblocked, available for claim
    ARCHITECT/   — Being processed by Architect
    RESEARCH/    — Being processed by Research Analyst
    BACKEND/     — Being processed by Backend Engineer
    FRONTEND/    — Being processed by Frontend or UIDesigner
    QA/          — Being processed by QA Engineer
    SECURITY/    — Being processed by Security Engineer
    CI/          — Being processed by CI Reviewer
    DOCS/        — Being processed by Documentation Specialist
    VALIDATION/  — Being processed by Validator
    DONE/        — Completed
```

## 3. tickets.py Contract

RULE: Location: `.github/tickets.py`

### Authorized Callers

ALLOWED: TODO agent (after L1->L2->L3 decomposition)
ALLOWED: Validator agent (before final DONE commit, to unblock freed tasks)
ALLOWED: Human operators (via CLI)
PROHIBITED: Any other agent executing tickets.py.

### Operations

| Command | Purpose |
|---------|---------|
| `--sync` | Evaluate deps, move unblocked to READY, release expired claims |
| `--parse <dir>` | Parse L3 markdown into ticket JSON |
| `--status` | Dashboard view of all tickets |
| `--status --json` | Machine-readable ticket state |
| `--claim <id> <agent> <machine> <operator>` | Claim ticket |
| `--release <id>` | Release stale claim |
| `--advance <id> <agent>` | Move to next SDLC stage |
| `--rework <id> <agent> <reason>` | Send back for rework |
| `--validate` | Full integrity check |
| `--release-expired` | Clear all expired claims |

### Sync Behavior

RULE: `--sync` performs in order:
1. Release all expired claims
2. Evaluate dependency graph for all tickets
3. Move newly unblocked tickets to READY
4. Fix duplicates (ticket in multiple state dirs)
5. Validate integrity

## 4. Dependency Resolution

RULE: A ticket enters READY only when all `depends_on` tickets are in DONE.
RULE: tickets.py evaluates dependencies, not agents.
RULE: No agent may manually move tickets to READY.
PROHIBITED: Agents reasoning about dependencies. tickets.py handles this.

## 5. SDLC Flows by Ticket Type

| Type | Flow |
|------|------|
| backend | READY -> BACKEND -> QA -> SECURITY -> CI -> DOCS -> VALIDATION -> DONE |
| frontend | READY -> FRONTEND -> QA -> SECURITY -> CI -> DOCS -> VALIDATION -> DONE |
| fullstack | READY -> BACKEND -> FRONTEND -> QA -> SECURITY -> CI -> DOCS -> VALIDATION -> DONE |
| infra | READY -> BACKEND -> QA -> SECURITY -> CI -> DOCS -> VALIDATION -> DONE |
| security | READY -> SECURITY -> QA -> CI -> DOCS -> VALIDATION -> DONE |
| docs | READY -> DOCS -> VALIDATION -> DONE |
| research | READY -> RESEARCH -> DOCS -> VALIDATION -> DONE |
| architecture | READY -> ARCHITECT -> DOCS -> VALIDATION -> DONE |

RULE: No stage may be skipped. Order is enforced by tickets.py.

## 6. UI Gate

RULE: Frontend tickets require UIDesigner artifacts before implementation.
REQUIRED: Mockup at `docs/uiux/mockups/{ticket-id}.md` with APPROVED status.
RULE: Missing UI artifacts => ticket is BLOCKED.
RULE: Backend-only tickets skip this gate.

## 7. Parallelism

RULE: ReaperOAK dispatches one subagent per READY ticket.
RULE: ReaperOAK does NOT compute safe parallel groups.
RULE: ReaperOAK does NOT reason about file conflicts.
RULE: ReaperOAK dispatches blindly.
RULE: Subagents enforce isolation via claim commit.
RULE: Git push conflicts are the safety mechanism.
PROHIBITED: Grouping logic in the dispatcher.
PROHIBITED: Dependency reasoning in the dispatcher.
PROHIBITED: File conflict analysis in the dispatcher.
