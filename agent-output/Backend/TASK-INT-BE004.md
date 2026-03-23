# TASK-INT-BE004 — BACKEND Complete

## Summary
Rewrote `.github/instructions/git-protocol.instructions.md` to replace git-based distributed locking with MCP-based atomic claims. The two-commit protocol (CLAIM git commit + WORK git commit) is simplified to one git commit (WORK only). Ticket state management moves entirely to PostgreSQL via MCP server.

## Changes Made
- **`.github/instructions/git-protocol.instructions.md`** — Full rewrite

## Key Decisions
1. **Claim is MCP, not git**: `tickets.claim` MCP tool call replaces the CLAIM git commit. PostgreSQL row-level locking provides atomicity — no git push race conditions.
2. **Work commit carries code only**: No ticket JSON staged in git. Ticket state transitions use `tickets.advance` MCP tool.
3. **Lease management in PostgreSQL**: Leases tracked in DB with background expiry — replaces `tickets.py --release-expired` filesystem approach.
4. **Summary handoff preserved**: `.github/agent-output/{Agent}/{ticket-id}.md` pattern unchanged; context still flows via filesystem for code artifacts.
5. **Scoped git rules unchanged**: `git add .` remains prohibited; explicit file staging enforced.
6. **Commit message format unchanged**: `[TICKET-ID] STAGE complete by AGENT on MACHINE`.

## Acceptance Criteria Verification
| # | Criterion | Status |
|---|-----------|--------|
| 1 | Two-commit protocol simplified: claim is MCP-based, work commit carries code only | PASS |
| 2 | Scoped git rules preserved (no `git add .`) | PASS |
| 3 | Commit message format preserved (begins with [TICKET-ID]) | PASS |
| 4 | Lease mechanism described as MCP-managed | PASS |
| 5 | Summary handoff protocol preserved (.github/agent-output/) | PASS |
| 6 | Failure recovery updated for MCP-based recovery | PASS |
| 7 | Push-based distributed locking removed (MCP provides atomicity) | PASS |

## Artifacts
- `.github/instructions/git-protocol.instructions.md`

## Confidence: HIGH

## Timestamp
2026-03-12T22:00:00Z
