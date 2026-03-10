# FORGEOS-BE008 — BACKEND Stage Summary

**Agent:** Backend  
**Machine:** pop-os  
**Operator:** ReaperOAK  
**Completed:** 2026-03-10T18:30:00+00:00  
**Confidence:** HIGH

## Artifacts Created

- `mcp-server/src/mcp_server/locking/lease_heartbeat.py` — Core lease heartbeat implementation (~430 lines)
- `mcp-server/tests/test_lease_heartbeat.py` — Comprehensive test suite (38 tests, 99% coverage)
- `mcp-server/src/mcp_server/locking/__init__.py` — Updated package exports (9 new symbols)

## Acceptance Criteria Coverage

| AC | Status | Evidence |
|----|--------|----------|
| Heartbeat extends lease_expiry for active claim | PASS | `extend_lease()` uses SELECT FOR UPDATE + UPDATE tickets; `TestExtendLease::test_happy_path` |
| Heartbeat interval configurable (default: 60s) | PASS | `HeartbeatConfig.interval_seconds=60.0`; `TestHeartbeatConfig::test_defaults` |
| Max lease duration configurable (default: 2h) | PASS | `HeartbeatConfig.max_lease_seconds=7200.0`; `TestHeartbeatConfig::test_defaults` |
| Rejects extension if claim released/reassigned | PASS | `LeaseNotActiveError` raised; `TestExtendLease::test_lease_not_active_raises` |
| Writes record to lease_heartbeats table | PASS | INSERT INTO lease_heartbeats; `TestExtendLease::test_happy_path` (asserts 2 execute calls) |
| Missing heartbeats mark lease as stale | PASS | `find_stale_claims()` detects claims with expired lease + no recent heartbeats; `TestFindStaleClaims::test_returns_stale_claims` |

## TDD Evidence

- **Red:** Wrote 38 tests covering all public API: config validation, data immutability, extend_lease happy/error paths, find_stale_claims, LeaseHeartbeat context manager lifecycle, error hierarchy.
- **Green:** Implemented minimum code to pass each test class.
- **Refactor:** Extracted PoolLike protocol for DI, froze all dataclasses, added `_now` parameter for testability.

## Coverage

- **99%** (158/160 statements covered)
- Missed lines: double-start RuntimeError path (517), task cancel timeout (569)

## Architecture Decisions

- **Dependency Injection via `_now` parameter:** Added optional `_now: datetime | None = None` to `extend_lease()` for deterministic testing without mocking. Production callers use the default (`datetime.now(timezone.utc)`).
- **PoolLike Protocol:** Reused the same Protocol pattern from `claim_queue.py` for consistency.
- **Frozen dataclasses with `slots=True`:** All value objects (HeartbeatConfig, HeartbeatRecord, StaleClaim) follow existing codebase convention.
- **Error hierarchy:** HeartbeatError → LeaseNotActiveError (410) / MaxLeaseDurationExceededError (409), inheriting from ForgeOSError.
- **Background task pattern:** LeaseHeartbeat uses `asyncio.create_task` with named tasks for observability. Terminal errors (lease expired, max duration) stop the loop; transient errors (DB connectivity) continue retrying.

## Key Implementation Details

- `extend_lease()` uses `SELECT ... FOR UPDATE` for row-level locking during extension
- `find_stale_claims()` uses subquery to find MAX(heartbeat_at) with 2× interval threshold
- `LeaseHeartbeat` context manager is idempotent on stop() and handles exceptions in `__aexit__`
- Parameterized queries ($1, $2::uuid) prevent SQL injection
- structlog logging via `get_logger("locking.lease_heartbeat")`
