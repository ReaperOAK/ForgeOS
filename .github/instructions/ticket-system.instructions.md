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
    READY/           — Unblocked, available for claim
    ARCHITECT/       — Being processed by Architect
    RESEARCH/        — Being processed by Research Analyst
    PRODUCT_MANAGER/ — Being processed by Product Manager
    UI_DESIGN/       — Being processed by UIDesigner
    BACKEND/         — Being processed by Backend Engineer
    FRONTEND/        — Being processed by Frontend Engineer
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
| product | READY -> PRODUCT_MANAGER -> DOCS -> VALIDATION -> DONE |
| design | READY -> UI_DESIGN -> DOCS -> VALIDATION -> DONE |

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

## 8. MCP-Based Ticket Operations (Primary)

RULE: The ForgeOS MCP Server is the primary interface for ticket lifecycle operations.
RULE: Agents interact with tickets via MCP tool calls over Streamable HTTP.
RULE: The MCP server is backed by PostgreSQL and provides ACID-guaranteed state management.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `FORGEOS_MCP_URL` | MCP server endpoint | `http://localhost:3000/mcp` |
| `FORGEOS_API_KEY` | Agent authentication key | (required) |

### Available MCP Tools

| Tool | Category | Description |
|------|----------|-------------|
| `tickets.next` | Discovery | Find next claimable ticket for a stage (read-only peek) |
| `tickets.claim` | Lifecycle | Acquire distributed lock on a ticket |
| `tickets.complete` | Lifecycle | Mark stage done, advance ticket to next stage |
| `tickets.reject` | Lifecycle | Reject ticket, send to REWORK |
| `tickets.release` | Lifecycle | Release a claim without completing |
| `tickets.update` | Metadata | Update ticket metadata fields |
| `tickets.spawn` | Creation | Create new tickets (TODO agent) |
| `tickets.graph` | Visualization | Query dependency graph |
| `tickets.extend` | Lease | Extend lease on a claimed ticket |
| `tickets.stats` | Dashboard | Aggregate pipeline statistics |
| `tickets.sync` | System | Resolve dependencies and release expired claims |

### MCP Workflow

```
1. tickets.next({stage: "BACKEND"})  → discover available ticket
2. tickets.claim({ticket_id, agent_name, machine_id}) → acquire lock
3. Execute work (code changes via Git two-commit protocol)
4. tickets.complete({ticket_id, evidence: {...}}) → advance to next stage
```

RULE: MCP claim replaces filesystem claim for ticket locking.
RULE: Git two-commit protocol still applies for code delivery.
RULE: Each MCP tool call maps to a single PostgreSQL stored function inside a transaction.

## 9. Dual-Mode Operation

RULE: The system operates in dual mode — MCP primary, filesystem fallback.
RULE: On boot, agents verify MCP server reachability via `tools/list` request.
RULE: If MCP server responds, agents use MCP tools for all ticket operations.
RULE: If MCP server is unreachable, agents fall back to filesystem-based `tickets.py` CLI.

### Feature Flags for Gradual Cutover

RULE: Dual-mode operation supports gradual migration from filesystem to MCP.
RULE: Agents check MCP availability at boot and cache the result for the session.
RULE: No feature flag configuration file is required — availability-based fallback is automatic.

### Fallback Behavior

| Operation | MCP (Primary) | Filesystem (Fallback) |
|-----------|--------------|----------------------|
| Discover ticket | `tickets.next({stage})` | `ls .github/ticket-state/READY/` |
| Claim ticket | `tickets.claim({...})` | `tickets.py --claim <id> <agent> <machine> <operator>` |
| Complete stage | `tickets.complete({...})` | `tickets.py --advance <id> <agent>` |
| Reject ticket | `tickets.reject({...})` | `tickets.py --rework <id> <agent> <reason>` |
| Release claim | `tickets.release({...})` | `tickets.py --release <id>` |
| Sync state | `tickets.sync({})` | `tickets.py --sync` |

RULE: Filesystem state machine remains fully functional as fallback.
RULE: tickets.py is the backward-compatibility bridge during migration.
PROHIBITED: Removing filesystem support while MCP is not proven stable.
