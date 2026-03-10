# FORGEOS-BE010 — BACKEND Stage Summary

## Ticket
- **ID:** FORGEOS-BE010
- **Title:** Configure Transaction Isolation per Operation
- **Stage:** BACKEND → QA (advancing)
- **Agent:** Backend
- **Machine:** pop-os
- **Operator:** ReaperOAK

## Implementation Summary

Implemented per-operation transaction isolation configuration for the ForgeOS
MCP Server locking subsystem. The module maps each ForgeOS operation type
(claim, advance, rework, release, spawn, read) to its appropriate PostgreSQL
transaction isolation level with documented justifications.

### Files Created/Modified

| File | Action |
|------|--------|
| `mcp-server/src/mcp_server/locking/transaction_config.py` | **Created** — Core module |
| `mcp-server/tests/test_transaction_config.py` | **Created** — 49 tests |
| `mcp-server/src/mcp_server/locking/__init__.py` | **Modified** — Re-exported new public API |

### Architecture

- **IsolationLevel** enum: READ_COMMITTED, REPEATABLE_READ, SERIALIZABLE
- **OperationType** enum: CLAIM, ADVANCE, REWORK, RELEASE, SPAWN, READ
- **OperationIsolation** frozen dataclass: pairs operation → isolation + justification
- **OPERATION_ISOLATION_MAP**: Canonical mapping (single source of truth)
- **isolation_for()**: Lookup function for operation → isolation level
- **transactional()**: Async context manager with pool integration + serialization retry
- **SerializationError / TransactionError**: Domain exceptions

### Isolation Level Mapping

| Operation | Isolation Level | Justification |
|-----------|----------------|---------------|
| CLAIM | READ COMMITTED | Uses SKIP LOCKED for non-blocking; SERIALIZABLE unnecessary |
| ADVANCE | SERIALIZABLE | Prevents concurrent state corruption |
| REWORK | SERIALIZABLE | Same consistency as advance |
| RELEASE | READ COMMITTED | Idempotent, no conflict risk |
| SPAWN | READ COMMITTED | Insert-only, no conflicting state |
| READ | READ COMMITTED | Read-only queries |

### Key Design Decisions

1. **PoolLike protocol** — dependency injection for testability (matches existing ConnectionLike pattern in file_mutex.py)
2. **Exponential back-off** — serialization retries delay 50ms × 2^(attempt-1)
3. **asyncpg-compatible isolation strings** — enum values are exact strings asyncpg expects
4. **Frozen dataclasses** — all value objects are immutable (per project convention)

## TDD Evidence

- **RED:** 49 tests written targeting all 6 acceptance criteria
- **GREEN:** `transaction_config.py` implemented to pass all tests
- **REFACTOR:** Clean enum/dataclass design, PoolLike protocol extraction

## Test Results

```
49 passed in 2.55s
Coverage: 100% (66 stmts, 0 miss)
```

## Acceptance Criteria Status

- [x] AC1: Transaction context manager accepts an isolation level parameter
- [x] AC2: Claim operations run under READ COMMITTED isolation
- [x] AC3: State transition operations (advance, rework) run under SERIALIZABLE isolation
- [x] AC4: Serialization failures trigger automatic retry with configurable retry count (default: 3)
- [x] AC5: Each transaction type is documented with justification for its isolation level
- [x] AC6: Transaction wrapper integrates with the asyncpg connection pool

## Confidence: HIGH
