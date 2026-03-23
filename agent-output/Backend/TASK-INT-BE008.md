# TASK-INT-BE008 — Rewrite Implementation Agent Files for MCP Operations

## Stage: BACKEND complete

## Summary

Rewrote 3 implementation agent files (Backend, Frontend, UIDesigner) to use MCP tools for context derivation and stage transitions. Replaced filesystem-based ticket state reads with `tickets.payload(ticket_id)`, replaced `Ticketer` with `ForgeOS orchestrator`, replaced manual ticket JSON moves with `tickets.complete`, and added forbidden actions for direct ticket-state directory access.

## Artifacts

| File | Action |
|------|--------|
| `.github/agents/Backend.agent.md` | Modified — MCP boot sequence, claim protocol, work commit, forbidden actions |
| `.github/agents/Frontend.agent.md` | Modified — MCP boot sequence, claim protocol, work commit, forbidden actions |
| `.github/agents/UIDesigner.agent.md` | Modified — MCP boot sequence, claim protocol, work commit, forbidden actions |

## AC Compliance

| AC | Status | Evidence |
|----|--------|----------|
| AC1 — All 3 agent files updated with MCP-based context derivation | PASS | `tickets.payload` in boot sequences of all 3 files |
| AC2 — Boot sequences use `tickets.payload(ticket_id)` | PASS | Step 3 in each boot sequence calls `tickets.payload(ticket_id)` |
| AC3 — All `.github/ticket-state/` references removed from context derivation | PASS | Only appears in PROHIBITED rules and forbidden actions |
| AC4 — `Ticketer` references replaced with `ForgeOS orchestrator` | PASS | Zero matches for "Ticketer" across all 3 files |
| AC5 — Tool loadouts preserved unchanged | PASS | No edits to Assigned Tool Loadout sections |
| AC6 — Stage ownership and scope preserved | PASS | Sections 1, 2, 5 (execution), 7 (scope) unchanged |
| AC7 — Forbidden actions include reading ticket-state directories | PASS | All 3 files add 3 new forbidden actions (ticket-state read, JSON moves, tickets.claim) |

## Changes Per File

### Backend.agent.md
- **Boot Sequence (§3):** Replaced filesystem reads (steps 3, 6) with `tickets.payload(ticket_id)` call. Added RULE and PROHIBITED statements.
- **Pre-Claimed Ticket (§4):** Replaced "Ticketer" → "ForgeOS orchestrator". Replaced filesystem JSON read with payload verification.
- **Work Commit (§6):** Removed ticket JSON update/move steps. Added `tickets.complete` with evidence payload. Removed ticket-state paths from git add. Added transition RULE.
- **Forbidden Actions (§8):** Added 3 new items: ticket-state reads, JSON file moves, calling tickets.claim.

### Frontend.agent.md
- **Boot Sequence (§3):** Same pattern as Backend — `tickets.payload` replaces filesystem reads.
- **Pre-Claimed Ticket (§5):** Same pattern — ForgeOS orchestrator, payload verification.
- **Work Commit (§7):** Removed ticket JSON update/move. Added `tickets.complete` with evidence. Added transition RULE.
- **Forbidden Actions (§9):** Added 3 new items: ticket-state reads, JSON file moves, calling tickets.claim.

### UIDesigner.agent.md
- **Boot Sequence (§3):** `tickets.payload` replaces steps 3 and 6. Stitch project ID read preserved as step 6.
- **Pre-Claimed Ticket (§4):** Same pattern — ForgeOS orchestrator, payload verification.
- **Work Commit (§6):** Removed "Move ticket JSON to next stage" step. Added `tickets.complete` with evidence. Added transition RULE.
- **Forbidden Actions (§8):** Added 3 new items: ticket-state reads, JSON file moves, calling tickets.claim.

## Sections Preserved Unchanged

| Section | All 3 Files |
|---------|-------------|
| Role definition (§1) | ✓ |
| Assigned Tool Loadout (CRITICAL) | ✓ |
| Execution SOP | ✓ |
| Stage ownership (§2) | ✓ |
| Execution Workflow (§5/§6) | ✓ |
| Scope (§7/§8) | ✓ |
| Evidence Requirements (§9/§10) | ✓ |
| References (§10/§11) | ✓ |

## Confidence: HIGH
