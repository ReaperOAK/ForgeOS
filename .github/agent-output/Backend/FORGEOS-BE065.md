# FORGEOS-BE065 — Backend Rework #2 Complete

## Title
Implement State Change Notification Emitter

## Verdict: PASS (Rework Fix Applied)

## Summary

Fixed the missing `emit_reworked()` integration in `TicketService.rework_ticket()`. The emitter call is now placed after the transaction block, matching the pattern used for claim/release/advance. Added integration test verifying the rework emission path.

## Changes

### 1. `mcp-server/src/mcp_server/services/ticket_service.py`
- Moved `ReworkResult` construction into a local variable inside the transaction block.
- Added `emit_reworked()` call **after** the `async with transactional(...)` block, before return.
- Pattern: `if self._emitter is not None: await self._emitter.emit_reworked(...)` — identical to claim/release/advance.

### 2. `mcp-server/tests/test_notification_emitter.py`
- Added `test_rework_emits_notification` in `TestTicketServiceIntegration`.
- Creates a `TicketService` with a mock emitter, patches `transactional`, calls `rework_ticket()`.
- Asserts `emit_reworked` was called with correct payload: ticket_id, old_stage, new_stage, agent_id, reason.
- Asserts `event_type == "ticket.reworked"`.

## Test Results

- **21 tests collected, 21 passed** (test_notification_emitter.py)
- **129 regression tests passed** (test_rework_tool.py, test_advance_service.py, test_ticket_release_status.py)
- **Ruff lint: All checks passed**

## TDD Evidence

- **RED:** New `test_rework_emits_notification` would fail without the service change (no `emit_reworked` call).
- **GREEN:** Added `emit_reworked()` call in `rework_ticket()` — test passes.
- **REFACTOR:** Restructured return to store result in variable, enabling emitter call outside transaction.

## Acceptance Criteria

| # | Criterion | Status |
|---|-----------|--------|
| 4 | Rework operations enqueue a ticket_reworked notification with rejection reason | PASS |

## Artifacts
- `mcp-server/src/mcp_server/services/ticket_service.py` (modified)
- `mcp-server/tests/test_notification_emitter.py` (modified)

## Confidence: HIGH

## Timestamp: 2026-03-11T02:30:00Z
