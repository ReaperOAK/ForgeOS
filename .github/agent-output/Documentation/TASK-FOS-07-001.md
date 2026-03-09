# Documentation Summary — TASK-FOS-07-001

## Ticket

- **ID:** TASK-FOS-07-001
- **Title:** Update Agent Files with MCP Tool References
- **Type:** docs
- **Stage:** DOCS → VALIDATION
- **Agent:** Documentation Specialist
- **Machine:** pop-os
- **Operator:** reaperoak
- **Completed:** 2026-03-09T21:30:00Z

## Objective

Update all 14 `.github/agents/*.agent.md` files to add MCP tool authorization
sections, environment variable documentation, updated workflow steps using MCP
tool calls as primary mechanism, and filesystem fallback when MCP is unavailable.

## Changes Made

### Files Modified (14 agent files)

| File | Section Added | MCP Tools Authorized |
|------|---------------|---------------------|
| `Backend.agent.md` | §10 MCP Tool Integration | next(BACKEND), claim(BACKEND), complete, spawn, release(own), extend(own) |
| `Frontend.agent.md` | §11 MCP Tool Integration | next(FRONTEND), claim(FRONTEND), complete, spawn, release(own), extend(own) |
| `QA.agent.md` | §11 MCP Tool Integration | next(QA), claim(QA), complete, reject, release(own), extend(own) |
| `Security.agent.md` | §11 MCP Tool Integration | next(SECURITY), claim(SECURITY), complete, reject, release(own), extend(own) |
| `Architect.agent.md` | §10 MCP Tool Integration | next(ARCHITECT), claim(ARCHITECT), complete, spawn, release(own), extend(own) |
| `Research.agent.md` | §10 MCP Tool Integration | next(RESEARCH), claim(RESEARCH), complete, release(own), extend(own) |
| `Documentation.agent.md` | §10 MCP Tool Integration | next(DOCS), claim(DOCS), complete, release(own), extend(own) |
| `CIReviewer.agent.md` | §11 MCP Tool Integration | next(CI), claim(CI), complete, reject, release(own), extend(own) |
| `Validator.agent.md` | §11 MCP Tool Integration | next(VALIDATION), claim(VALIDATION), complete, reject, sync(limited), release(own), extend(own) |
| `DevOps.agent.md` | §10 MCP Tool Integration | next(BACKEND), claim(BACKEND), complete, spawn, release(own), extend(own) |
| `UIDesigner.agent.md` | §10 MCP Tool Integration | next(FRONTEND), claim(FRONTEND), complete, release(own), extend(own) |
| `ProductManager.agent.md` | §10 MCP Tool Integration | stats (read-only) |
| `ReaperOAK.agent.md` | §11 MCP Tool Integration | next(all stages), stats, graph, sync (NO claim/complete) |
| `TODO.agent.md` | §11 MCP Tool Integration | spawn, stats |

### Additional Workflow Updates

- **QA.agent.md §6:** Updated verdict decision to use `tickets.complete` (PASS) and `tickets.reject` (FAIL) via MCP, with CLI fallback.
- **Security.agent.md §6:** Updated FAIL verdict to use `tickets.reject` via MCP, with CLI fallback.
- **CIReviewer.agent.md §6:** Updated FAIL verdict to use `tickets.reject` via MCP, with CLI fallback.
- **Validator.agent.md §6:** Updated verdict actions to use MCP as primary with CLI fallback.
- **Validator.agent.md §7:** Updated `tickets.py --sync` reference to note MCP `tickets.sync` tool.
- **ReaperOAK.agent.md §2:** Updated Boot Sequence to show MCP sync + status.
- **ReaperOAK.agent.md §3:** Updated Execution Loop to show MCP advance + sync.
- **TODO.agent.md §4:** Updated invocation rules to show MCP spawn.
- **TODO.agent.md §6:** Updated ticket generation to use MCP primary with CLI fallback.
- **ProductManager.agent.md §4:** Added note about MCP stats tool availability.

### Structure of Each MCP Section

Every MCP Tool Integration section includes:
1. **Environment Variables** — `FORGEOS_MCP_URL` and `FORGEOS_API_KEY` documentation
2. **Authorized MCP Tools** — table with tool name, purpose, and scope constraints
3. **Workflow Integration** — MCP as primary mechanism, CLI as fallback
4. **Fallback Mechanism** — explicit rule: if MCP unreachable, use `tickets.py` CLI

### RBAC Matrix Source

The RBAC matrix was derived from:
- Ticket acceptance criteria (AC 1-4)
- `docs/architecture/api/mcp-tool-definitions.md` tool definitions
- Agent role capabilities (implementation vs. review vs. dispatch)

Key RBAC distinctions:
- **Implementation agents** (Backend, Frontend, Architect, DevOps): get `tickets.spawn`
- **Review agents** (QA, Security, CIReviewer, Validator): get `tickets.reject`
- **Dispatcher** (ReaperOAK): gets `tickets.graph`, `tickets.sync`, `tickets.stats`, but NO `claim`/`complete`
- **Read-only** (ProductManager): `tickets.stats` only
- **Spawner** (TODO): `tickets.spawn` + `tickets.stats` only

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | All 14 agent files updated with MCP tool authorization section listing permitted tools per RBAC matrix | ✅ PASS |
| 2 | Backend agent: authorized for tickets.next(BACKEND), tickets.claim(BACKEND), tickets.complete, tickets.spawn, tickets.release(own), tickets.extend(own) | ✅ PASS |
| 3 | QA agent: authorized for tickets.next(QA), tickets.claim(QA), tickets.complete, tickets.reject, tickets.release(own), tickets.extend(own) | ✅ PASS |
| 4 | ReaperOAK agent: authorized for tickets.next(all stages), tickets.stats, tickets.graph (no claim/complete) | ✅ PASS |
| 5 | Each agent file documents FORGEOS_MCP_URL and FORGEOS_API_KEY environment variables | ✅ PASS |
| 6 | Workflow steps updated: MCP tool calls as primary mechanism | ✅ PASS |
| 7 | Fallback mechanism documented: if MCP unreachable, use tickets.py CLI directly | ✅ PASS |
| 8 | Existing agent file structure (role, stage, scope, forbidden actions, references) preserved | ✅ PASS |

## Evidence

- **Artifact paths:** All 14 files listed in the table above
- **API coverage:** N/A (documentation-only ticket)
- **README:** Not applicable (no user-facing module changes)
- **Readability:** Active voice, structured tables, average sentence length ≤ 20 words
- **Link integrity:** All internal references verified (mcp-tool-definitions.md exists)
- **Freshness:** last_reviewed metadata not applicable to agent definition files
- **Changelog:** Not applicable (internal agent config, not user-facing)
- **Confidence:** HIGH — All 14 files modified successfully, all 8 AC verified

## Verdict

**PASS** — Ready for Validation stage.
