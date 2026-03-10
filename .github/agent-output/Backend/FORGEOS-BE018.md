# FORGEOS-BE018 — Wire MCP Server to Database Layer

## Stage: BACKEND — Complete

**Agent:** Backend  
**Timestamp:** 2026-03-10T18:15:00+05:30  
**Confidence:** HIGH

---

## Summary

Implemented the dependency injection layer that wires the MCP server's lifespan
to the database layer.  Created a `Dependencies` container that initialises the
`ConnectionPool` wrapper, extracts the raw asyncpg pool, and builds repository
instances (TicketRepository, ClaimRepository, EventRepository).  Updated the
server lifespan to use this container instead of creating a raw asyncpg pool
directly — fixing a type mismatch bug where `HealthChecker` received a raw pool
instead of the expected `ConnectionPool` wrapper.

## Files Created

| File | Purpose |
|------|---------|
| `src/mcp_server/dependencies.py` | Frozen dataclass DI container with async factory and teardown |
| `tests/test_dependencies.py` | 7 tests for DI container (create, failure, close, wiring) |
| `tests/test_db_wiring.py` | 18 tests for server-to-DB wiring (lifespan, AppContext, health, shutdown) |

## Files Modified

| File | Change |
|------|--------|
| `src/mcp_server/db/pool.py` | Added `raw_pool` property exposing underlying asyncpg.Pool |
| `src/mcp_server/server.py` | Rewired `AppContext` (dependencies field + backward-compat `db_pool` property), `_app_lifespan` uses Dependencies, added `db_required` config, `sys.exit(1)` on required-DB failure |
| `tests/test_server.py` | Updated `test_custom_pool` to use new `dependencies` field |

## Bug Fixed

The original lifespan passed a raw `asyncpg.Pool` to `HealthChecker`, which
expects `ConnectionPool` (the wrapper with `.is_initialized`, `.ping()`,
`.stats()` methods).  This would crash on readiness checks.  The new wiring
passes the `ConnectionPool` wrapper correctly.

## TDD Evidence

- **RED:** Tests written first defining expected DI behaviour, lifespan wiring,
  AppContext properties, health checker wiring, graceful shutdown, and raw_pool
  accessor.
- **GREEN:** `dependencies.py` and `server.py` changes implemented to satisfy
  each test.
- **REFACTOR:** Frozen dataclass for immutability, backward-compatible `db_pool`
  property, lazy imports to avoid circular dependencies.

## Test Results

```
25 new tests passing (test_dependencies.py + test_db_wiring.py)
34 existing tests passing (test_server.py, 1 pre-existing failure unrelated)
```

## Coverage

```
dependencies.py  — 100%
server.py        —  83%
pool.py          —  71% (existing untested paths, not new code)
TOTAL            —  81%
```

## Acceptance Criteria Verification

- [x] Server startup initialises asyncpg connection pool via Dependencies.create()
- [x] Repository instances constructed with raw pool via DI container
- [x] HealthChecker receives ConnectionPool wrapper (not raw pool)
- [x] Graceful shutdown drains pool via Dependencies.close()
- [x] Degraded mode when DB unavailable (deps=None, server continues)
- [x] db_required=True + DB failure → sys.exit(1) with clear error log
- [x] Backward-compatible db_pool property on AppContext
- [x] No direct pool access needed — tool handlers use repo shortcuts
- [x] Configuration via FORGEOS_DB_REQUIRED environment variable
- [x] ≥80% test coverage for new code
