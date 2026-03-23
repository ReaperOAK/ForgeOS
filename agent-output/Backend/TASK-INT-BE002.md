# TASK-INT-BE002 — Backend Complete

## Summary

Rewrote `.github/instructions/core.instructions.md` to update the boot sequence, system identity, and memory gate for MCP-based context derivation.

## Changes

### Section 1 — System Identity
- Replaced "Ticketer" with "ForgeOS" as the orchestrator
- Updated context derivation: agents now derive context from the ForgeOS MCP server (not filesystem)
- Added MCP server responsibilities: distributed locking, dependency resolution, stage transitions

### Section 4 — Boot Sequence
- Step 3 now calls `tickets.payload` to receive full delegation context from ForgeOS MCP server
- Delegation context includes: ticket JSON, upstream summary, memory entries, file scope
- Added rule: `tickets.payload` response is the canonical source for ticket context
- Added rule: agents MUST NOT read ticket JSON from `.github/ticket-state/` or `.github/tickets/` directly
- Removed filesystem-based ticket JSON and upstream summary steps (replaced by MCP)
- Preserved vibecoding chunk loading (steps 4-5) as local file reads

### Section 6 — Memory Gate
- Updated to reference MCP-based verification via `tickets.update`
- Added rule: memory entries persisted to ForgeOS MCP server
- Added rule: git-tracked `activeContext.md` serves as secondary append-only store
- Missing MCP-persisted entry blocks DONE transition

### Section 7 — Memory Bank Rules
- Replaced all "Ticketer" references with "ForgeOS" in write access table

### Preserved Unchanged
- Section 2: Rule Precedence
- Section 3: Halt Gate
- Section 5: Human Approval Gates
- Section 8: Anti-Loop Rule
- Section 9: Security Baseline
- Section 10: Evidence Rule
- YAML frontmatter

## Artifacts
- `.github/instructions/core.instructions.md` (modified)

## AC Verification
1. ✅ Boot sequence step added: call `tickets.payload` after reading instruction files
2. ✅ `tickets.payload` response described as the canonical context source
3. ✅ Memory gate updated to reference MCP-persisted memory entries
4. ✅ Halt gate (STOP_ALL) preserved unchanged
5. ✅ Human approval gates preserved unchanged
6. ✅ Anti-loop rule preserved unchanged
7. ✅ Document passes markdown structure review — no lint errors

## Confidence
**HIGH** — All 7 acceptance criteria verified. Changes are scoped to documented sections. No "Ticketer" references remain.

## Timestamp
2026-03-12T22:00:00Z
