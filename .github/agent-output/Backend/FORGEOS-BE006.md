# FORGEOS-BE006 — Backend Stage Summary

**Ticket:** FORGEOS-BE006 — Implement Ticket Claim Queue with SKIP LOCKED
**Agent:** Backend
**Machine:** pop-os
**Operator:** ReaperOAK
**Timestamp:** 2026-03-10T20:30:00Z
**Confidence:** HIGH (95%)

## Implementation Summary

Implemented the ticket claim queue module at `mcp-server/src/mcp_server/locking/`
using PostgreSQL `SELECT FOR UPDATE SKIP LOCKED` for fair, non-blocking claim
semantics. The module wraps the existing `claim_ticket` and `claim_ticket_by_id`
stored functions (defined in `001_initial.sql`) with a typed async Python API.

## Files Created

| File | Purpose |
|------|---------|
| `mcp-server/src/mcp_server/locking/__init__.py` | Package init with re-exports |
| `mcp-server/src/mcp_server/locking/claim_queue.py` | Core claim queue implementation |
| `mcp-server/tests/test_claim_queue.py` | 40 tests, 100% coverage |

## Architecture

### ClaimQueue Class
- `claim_next(stage, agent_id, ...)` — atomically claims the next READY ticket
  for a given SDLC stage using the `claim_ticket` stored function
- `claim_by_id(ticket_id, agent_id, ...)` — claims a specific ticket by its
  human-readable ID, with file lock conflict detection
- `claim_for_role(role, agent_id, ...)` — resolves role → stage via AgentRoleMap,
  then delegates to `claim_next`

### AgentRoleMap
Static utility mapping agent roles to:
- SDLC stages (e.g., `"backend"` → `"BACKEND"`)
- Compatible ticket types (e.g., `"backend"` → `["backend", "fullstack", "infra"]`)
- Compatibility check (`is_compatible(role, ticket_type)`)

### Error Hierarchy
- `ClaimError(ForgeOSError)` — base (409)
- `NoEligibleTicketError(ClaimError)` — no ticket found (404)
- `LeaseExpiredError(ClaimError)` — lease expired (410)

### ClaimResult
Frozen dataclass containing all claimed ticket data including file_paths,
acceptance_criteria, depends_on, and metadata.

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Claim function atomically selects and locks using SKIP LOCKED | ✅ | Delegates to `claim_ticket` stored function which uses `SELECT FOR UPDATE SKIP LOCKED` |
| 2 | Claim filters by ticket type and agent role compatibility | ✅ | `AgentRoleMap` maps roles to stages/types; `claim_for_role()` resolves role → stage |
| 3 | Claims respect ticket dependencies (only READY tickets claimable) | ✅ | Stored function filters `WHERE status = 'READY'`; dependency resolution happens upstream via `resolve_dependencies()` |
| 4 | Concurrent claims result in exactly one winner, others skip | ✅ | `SKIP LOCKED` ensures non-blocking contention; tested in `TestConcurrencySemantics` |
| 5 | Claim creates a record with agent_id, machine_id, lease_expiry | ✅ | Stored function updates tickets table + inserts CLAIMED event; Python wrapper passes all fields |
| 6 | Function returns claimed ticket data or None | ✅ | Returns `ClaimResult` on success, `None` when no ticket; tested in 40 test cases |

## TDD Evidence

- **RED:** Wrote 40 failing test cases covering all public methods, error paths,
  edge cases (None arrays, None strings), concurrency simulation, and package imports.
- **GREEN:** Implemented `ClaimQueue`, `AgentRoleMap`, `ClaimResult`, error classes,
  and `_row_to_claim_result` to make all tests pass.
- **REFACTOR:** Applied frozen dataclasses with slots, Protocol-based DI for pool,
  clean error hierarchy inheriting from ForgeOSError.

## Test Coverage

```
Name                                    Stmts   Miss  Cover
src/mcp_server/locking/__init__.py          2      0   100%
src/mcp_server/locking/claim_queue.py      88      0   100%
TOTAL                                      90      0   100%
```

## Design Decisions

1. **Thin wrapper over stored functions** — all locking logic stays in PL/pgSQL
   for atomicity guarantees. Python layer handles input validation and type mapping.
2. **Protocol-based DI** — `PoolLike` protocol allows injecting any pool-like
   object (asyncpg.Pool, mock, etc.) without hard coupling.
3. **No retry loops** — callers control retry/backoff policy. The queue returns
   None immediately if no ticket is available.
4. **Structured logging** — all operations log structured JSON with correlation
   context (agent_id, machine_id, ticket_id, stage).
