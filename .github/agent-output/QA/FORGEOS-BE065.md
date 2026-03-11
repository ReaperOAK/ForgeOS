# FORGEOS-BE065 — QA Report

## Title
Implement State Change Notification Emitter

## Verdict: FAIL

## Summary

The `StateChangeEmitter` class and `EventType` enum are well-implemented with 100% coverage (33 statements, 2 branches). All 20 existing tests pass. However, **AC #4 is not met**: the `rework_ticket()` method in `TicketService` does not call `self._emitter.emit_reworked()`, despite the method being fully implemented in the emitter module. This means rework operations silently skip notification emission.

## Acceptance Criteria Verification

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Stage transition (advance) enqueues a stage_changed notification | PASS | `emit_advanced` called at `ticket_service.py:785` after transaction |
| 2 | Claim operations enqueue a ticket_claimed notification | PASS | `emit_claimed` called at `ticket_service.py:361` (claim_next) and `ticket_service.py:473` (claim_by_id) |
| 3 | Release operations enqueue a ticket_released notification | PASS | `emit_released` called at `ticket_service.py:539` |
| 4 | Rework operations enqueue a ticket_reworked notification with rejection reason | **FAIL** | `emit_reworked` exists in emitter.py but is NOT called from `TicketService.rework_ticket()` (lines 858–1017). grep confirms zero references to `emit_reworked` in ticket_service.py |
| 5 | Notification payload includes ticket_id, event_type, actor, timestamp, and change details | PASS | `TestPayloadStructure` verifies required fields across all 4 event types |
| 6 | Emitter is called from the ticket service layer (not duplicated across MCP/REST) | PARTIAL | 3 of 4 operations integrated; rework missing |

## Test Results

- **20 tests collected, 20 passed, 0 failed, 0 skipped**
- **129 regression tests passed** (test_ticket_release_status.py, test_advance_service.py, test_rework_tool.py)

## Coverage

```
Name                                      Stmts   Miss Branch BrPart  Cover   Missing
src/mcp_server/notifications/emitter.py      33      0      2      0   100%
```

## Defects Found

| # | File | Location | Description | Severity |
|---|------|----------|-------------|----------|
| 1 | `mcp-server/src/mcp_server/services/ticket_service.py` | `rework_ticket()` method (lines 858–1017) | Missing `self._emitter.emit_reworked()` call after the rework transaction completes. The pattern used for claim/release/advance (check `if self._emitter is not None:` then call emit method) is not replicated for rework. | HIGH |
| 2 | `mcp-server/tests/test_notification_emitter.py` | `TestTicketServiceIntegration` class | No integration test verifying `rework_ticket()` triggers `emit_reworked()`. Tests exist for claim and release integration but not rework. | MEDIUM |

## Required Fix

1. In `TicketService.rework_ticket()`, after the transactional block and logger call (around line 1005), add:
   ```python
   if self._emitter is not None:
       await self._emitter.emit_reworked(
           ticket_id=ticket_id,
           old_stage=current_stage,
           new_stage=new_stage,
           agent_id=agent_id,
           reason=reason,
       )
   ```
2. Add an integration test in `TestTicketServiceIntegration` that:
   - Creates a TicketService with a mock emitter
   - Calls `rework_ticket()`
   - Asserts `emit_reworked` was called with correct payload (ticket_id, old_stage, new_stage, agent_id, reason)

## Confidence: HIGH

Evidence is deterministic (grep search, code review, test execution). The defect is a clear omission.

## Timestamp: 2026-03-11T02:15:00Z
