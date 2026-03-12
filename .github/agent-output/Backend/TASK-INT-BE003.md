# TASK-INT-BE003 — Backend Stage Summary

## Stage: BACKEND
## Agent: Backend
## Timestamp: 2026-03-12T22:00:00Z

## Artifacts
- `.github/instructions/sdlc.instructions.md` (rewritten)

## Changes
Rewrote `.github/instructions/sdlc.instructions.md` to replace all filesystem-based stage transitions with MCP tool-based transitions.

### Key Changes
1. **Section 1** — Replaced directory-based state (`ticket-state/`) with PostgreSQL + MCP Server. Replaced dispatcher-claim commit protocol with `tickets.claim` / `tickets.complete` / `tickets.reject` MCP tools.
2. **Section 2** — Updated READY stage owner from `tickets.py` to `MCP Server / dependency resolver`.
3. **New Section 3** — Added full "Stage Transitions via MCP" section documenting `tickets.complete` (with evidence payload schema), `tickets.reject` (with rejection payload schema), and `tickets.claim` semantics.
4. **Section 4** — Rework rules rewritten to use `tickets.reject` with automatic routing by MCP Server (rework vs escalation based on `rework_count`).
5. **Section 5** — DoD updated: Validator now verifies via MCP queries (`tickets.stats`, `tickets.graph`, event history). Added rules for Validator calling `tickets.complete` on pass or `tickets.reject` on fail.
6. **Section 6** — Transition guards table extended with `MCP Tool` column. All guards now reference specific MCP tools instead of "claim commit" or directory moves.
7. **Section 7** — TODO decomposition preserved; added `tickets.spawn` reference for ticket creation.

## Acceptance Criteria Verification
| # | Criteria | Status |
|---|---------|--------|
| 1 | Stage transitions via `tickets.complete` | PASS |
| 2 | Rework flow uses `tickets.reject` with evidence | PASS |
| 3 | DoD verification references MCP tools | PASS |
| 4 | Stage pipeline order preserved | PASS |
| 5 | TODO agent decomposition rules preserved | PASS |
| 6 | Transition guards updated for MCP | PASS |
| 7 | No filesystem-based transition references remain | PASS (grep verified) |

## Test Results
N/A — documentation-only change. Verified via grep scan: zero matches for `directory`, `ticket-state/`, `tickets.py`, `CLAIM commit`, `WORK commit`, or `file.based` in the rewritten file.

## Confidence: HIGH

## Decisions
- Aligned MCP tool payloads and PostgreSQL function names (`advance_ticket`, `reject_ticket`) with actual implementation in `forgeos-server/src/tools/`.
- Added `tickets.spawn` reference in TODO decomposition to match the registered MCP tool.
- Kept 11 DoD items (including UI design check) consistent with prior version.
- YAML frontmatter description updated to mention "MCP-based stage transitions".
