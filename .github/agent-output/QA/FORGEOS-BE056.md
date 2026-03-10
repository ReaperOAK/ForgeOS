# FORGEOS-BE056 — QA Stage Summary

## Ticket
**Title:** Implement Operator Machine-Scoped Permissions  
**Stage:** QA (REJECT → rework to BACKEND)  
**Agent:** QA Engineer on pop-os  
**Reviewed:** 2026-03-11T13:00:00Z  

## Verdict: REJECT

**Reason:** 3 lint errors introduced by BE056 code. DoD requires zero lint errors.

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Operator-machine binding table created (operator_id, machine_id, registered_at) | ✅ Migration 006 |
| 2 | REST operations validate that operator is bound to the machine_id in the request | ✅ `require_operator_machine_access()` |
| 3 | Unbound operator-machine pair rejected with 403 Forbidden | ✅ `MachineScopeError(status_code=403)` |
| 4 | Admin operators bypass machine binding checks | ✅ `ADMIN_ROLE` bypass |
| 5 | Operators can register to multiple machines | ✅ Many-to-many with composite UNIQUE |
| 6 | Binding management endpoints (add/remove machine binding) for admin use | ✅ `add_binding()`, `remove_binding()`, `list_bindings()` + service wrappers |

All 6 acceptance criteria are functionally satisfied.

## Test Results

- **41 tests passed**, 0 failed, 0 skipped
- Test file: `mcp-server/tests/test_authorization.py`
- Test file lint: **CLEAN** (0 errors)

### Test Coverage by Function

| Function | Tests | Status |
|----------|-------|--------|
| `OperatorMachineBinding` dataclass | 3 (creation, frozen, slots) | ✅ |
| `MachineScopeError` | 3 (isinstance, status_code, message) | ✅ |
| `check_operator_machine_binding` | 4 (exists, not exists, empty operator, empty machine) | ✅ |
| `require_operator_machine_access` | 4 (admin bypass, bound allowed, unbound 403, viewer 403) | ✅ |
| `add_binding` | 8 (create, idempotent, empty operator, empty machine, whitespace operator, whitespace machine, db error, strip machine_id) | ✅ |
| `remove_binding` | 5 (removes, not found, empty operator, empty machine, db error) | ✅ |
| `list_bindings` | 4 (empty, returns bindings, empty operator, correct types) | ✅ |
| `TestMultipleMachineBindings` | 1 (operator bound to 3 machines) | ✅ |
| `bind_operator_to_machine` (service) | 1 (returns dict) | ✅ |
| `unbind_operator_from_machine` (service) | 2 (removed true, removed false) | ✅ |
| `get_operator_bindings` (service) | 2 (list of dicts, empty) | ✅ |
| `validate_operator_machine_access` (service) | 3 (admin, bound, unbound) | ✅ |
| `ADMIN_ROLE` constant | 1 (value check) | ✅ |

All public functions in `authorization.py` and all service wrappers in `operator_service.py` are exercised.

## Lint Results

### authorization.py — 1 error (BE056-introduced)

```
TC003 Move standard library import `datetime` into a type-checking block
  --> src/mcp_server/auth/authorization.py:27:8
```

**Fix:** With `from __future__ import annotations`, `datetime` is only used in type annotations (the `OperatorMachineBinding.registered_at` field). Move it to `TYPE_CHECKING`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    import datetime

from mcp_server.observability import get_logger
from mcp_server.server import INVALID_PARAMS, ForgeOSError
```

### operator_service.py — 2 errors (BE056-introduced)

```
I001 Import block is un-sorted or un-formatted
  --> src/mcp_server/services/operator_service.py:25:1

F401 `mcp_server.auth.authorization.MachineScopeError` imported but unused
  --> src/mcp_server/services/operator_service.py:38:5
```

**Fix for I001:** Reorder imports so `authorization` comes before `operator_auth` (alphabetical order within `mcp_server.auth`).

**Fix for F401:** Remove the unused `MachineScopeError` import from `operator_service.py`. The service wrappers delegate to `authorization.py` functions which raise `MachineScopeError` directly — the service module doesn't need to import it.

```python
from mcp_server.auth.authorization import (
    add_binding,
    list_bindings,
    remove_binding,
    require_operator_machine_access,
)
from mcp_server.auth.operator_auth import (
    OperatorAuthenticationError,
    OperatorIdentity,
    generate_token,
    hash_password,
    refresh_token,
    verify_password,
)
```

### Pre-existing E501 errors (NOT from BE056, from BE053)

3 E501 line-length errors in `authenticate_operator()` (lines 101, 109, 125) — pre-existing, not attributable to this ticket.

## TDD Evidence Review

- **RED phase confirmed:** Test file defines all expected behaviors before implementation.
- **GREEN phase confirmed:** All 41 tests pass against the implementation.
- **REFACTOR:** Code follows existing project patterns (frozen dataclasses, ForgeOSError hierarchy, asyncpg mock pattern).

## Architecture Review

- Migration 006 correctly creates `operator_machine_bindings` with UUID PK, operator_id FK (CASCADE), machine_id TEXT, registered_at TIMESTAMPTZ, composite UNIQUE, and indexes.
- `UPSERT` via `ON CONFLICT DO UPDATE SET registered_at = registered_at` is idempotent.
- Admin bypass via simple role comparison is consistent with existing patterns.
- Separation of `authorization.py` from `operator_auth.py` is clean.

## Defects Found

| # | Severity | File | Description |
|---|----------|------|-------------|
| 1 | LOW | authorization.py:27 | TC003: `datetime` import should be in TYPE_CHECKING block |
| 2 | LOW | operator_service.py:25 | I001: Import block unsorted after BE056 additions |
| 3 | LOW | operator_service.py:38 | F401: `MachineScopeError` imported but unused |

## Evidence Summary

| Evidence Item | Result |
|---------------|--------|
| Test results | 41 passed, 0 failed |
| Coverage | All public functions exercised (estimated >90% for new code) |
| Mutation testing | N/A — mock-based unit tests, no pure business logic eligible for mutation |
| Defects found | 3 lint errors (all LOW severity, actionable fixes provided) |
| Performance | N/A — no performance-critical paths |
| E2E testing | N/A — no UI changes |
| **Verdict** | **REJECT** — lint must be clean per DoD |
| **Confidence** | **HIGH** — functionality correct, only lint issues remain |
