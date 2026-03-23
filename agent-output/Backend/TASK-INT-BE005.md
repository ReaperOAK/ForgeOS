# TASK-INT-BE005 — Backend Summary

## Result: COMPLETE

**Agent:** Backend  
**Machine:** Ticketer  
**Timestamp:** 2026-03-12T22:00:00Z  
**Confidence:** HIGH

## Changes

### `.github/instructions/agent-behavior.instructions.md`

| Section | Change |
|---------|--------|
| §2 Context Derivation | Replaced filesystem-derived context with MCP `tickets.get(ticket_id)` and `tickets.payload(ticket_id, agent_role)`. Added rules: context is MCP-delivered, ForgeOS provides `ticket_id` at dispatch. Prohibited reading `.github/ticket-state/` or `.github/tickets/` directly. |
| §3 Dispatcher Contract | Renamed from "Ticketer Dispatcher Contract" to "ForgeOS Dispatcher Contract". Replaced `Scan ticket-state/READY/` with `Query MCP tickets.list(stage='READY')`. Replaced "Ticketer" with "ForgeOS" throughout. Updated safety mechanism from "Git + tickets.py" to "MCP server + PostgreSQL". Removed "Injecting context" and "Reading/modifying files" from prohibited list (not applicable to ForgeOS). |
| §6 Forbidden Actions | Replaced "Ticketer" with "ForgeOS dispatcher" in systemPatterns.md/decisionLog.md exceptions. Added new prohibition: reading `.github/ticket-state/` directories for workflow state. |
| §10 Operator Workflow | Removed `python3 .github/tickets.py --sync` from pre-work commands (sync is now automatic via MCP). |

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Context derivation updated to MCP `tickets.get` | PASS |
| 2 | Dispatcher identity updated: ForgeOS replaces Ticketer | PASS |
| 3 | Worker model preserved (§1 unchanged) | PASS |
| 4 | Stage ownership table preserved (§4 unchanged) | PASS |
| 5 | Scope enforcement preserved (§5 unchanged) | PASS |
| 6 | Forbidden actions updated with `.github/ticket-state/` prohibition | PASS |
| 7 | Evidence requirements preserved (§7 unchanged) | PASS |

## Artifacts

- `.github/instructions/agent-behavior.instructions.md` (modified)
- `.github/agent-output/Backend/TASK-INT-BE005.md` (created)

## Tests

N/A — this ticket modifies a markdown instruction file, not application code. Validation is structural (AC verification above).
