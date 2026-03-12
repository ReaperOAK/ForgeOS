# TASK-INT-BE007 — BACKEND Complete

## Summary
Rewrote 5 infrastructure agent files to use MCP `tickets.payload(ticket_id)` for ticket context derivation, replacing all filesystem-based reads from `.github/ticket-state/` and `.github/tickets/`. Updated `Ticketer` references to `ForgeOS orchestrator`. Added forbidden actions for direct ticket-state filesystem reads.

## Files Modified
1. `.github/agents/Architect.agent.md`
2. `.github/agents/DevOps.agent.md`
3. `.github/agents/Research.agent.md`
4. `.github/agents/ProductManager.agent.md`
5. `.github/agents/TODO.agent.md`

## Changes Per File

### All 5 Files (Common Changes)
- **Boot sequence step 6**: Replaced filesystem ticket JSON reads with `tickets.payload(ticket_id)` MCP call
- **Forbidden actions**: Added `Reading .github/ticket-state/ or .github/tickets/ directly for ticket context — use tickets.payload via MCP`

### Architect.agent.md
- Section 4 (Pre-Claimed Ticket): Replaced `Ticketer` → `ForgeOS orchestrator`, filesystem reads → `tickets.payload`, claim metadata verification → delegation context verification
- Boot step 6: `Read ticket JSON from .github/ticket-state/ or .github/tickets/` → `Call tickets.payload(ticket_id)`

### DevOps.agent.md
- Section 4 (Pre-Claimed Ticket): Same pattern as Architect — MCP-based context derivation
- Boot step 6: Same pattern

### Research.agent.md
- Section 4 (Pre-Claimed Ticket): Same pattern as Architect — MCP-based context derivation
- Boot step 6: `Read ticket JSON from .github/ticket-state/RESEARCH/{ticket-id}.json` → `Call tickets.payload(ticket_id)`

### ProductManager.agent.md
- Section 4 (Ticket Handling): `Receives requirements from human operators or Ticketer` → `ForgeOS orchestrator`
- Boot step 6: `Read assignment / delegation packet` → `Call tickets.payload(ticket_id)`

### TODO.agent.md
- Section 1 (Role): `Only invoked by Ticketer` → `Only invoked by ForgeOS orchestrator`, `delegation packet` → `delegation context`
- Section 4 (Invocation Rules): `Only Ticketer may invoke TODO agent` → `Only ForgeOS orchestrator may invoke TODO agent`
- Boot step 6: `Read delegation packet / assignment from Ticketer` → `Call tickets.payload(ticket_id)`

## Acceptance Criteria Verification
- [x] AC1: All 5 agent files updated with MCP-based context derivation
- [x] AC2: Boot sequences reference `tickets.payload(ticket_id)` instead of filesystem reads
- [x] AC3: All references to `.github/ticket-state/` removed from agent context derivation
- [x] AC4: `Ticketer` references replaced with `ForgeOS` or `ForgeOS orchestrator`
- [x] AC5: Agent tool loadouts preserved (no changes to role-specific tools)
- [x] AC6: Each file maintains YAML frontmatter and existing role/scope structure
- [x] AC7: Forbidden actions updated to include reading ticket-state directories

## Evidence
- **Artifacts:** 5 agent markdown files modified
- **Test results:** N/A (markdown documentation files, no executable code)
- **Confidence:** HIGH — all changes are mechanical text replacements following a consistent pattern
- **Timestamp:** 2026-03-12T21:30:00Z
