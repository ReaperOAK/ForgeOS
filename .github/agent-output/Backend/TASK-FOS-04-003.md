# TASK-FOS-04-003 — File-Level Mutex Implementation

## Stage: BACKEND

## Summary

Implemented file-level mutex system for concurrent file lock management in
`forgeos-server/src/db/file-mutex.ts`. The module provides atomic file locking
primitives backed by the PostgreSQL `file_locks` table with a partial unique
index `(file_path) WHERE released_at IS NULL` for database-level mutual exclusion.

## Artifacts

### Created
- `forgeos-server/src/db/file-mutex.ts` — Core file mutex module
- `forgeos-server/src/__tests__/db/file-mutex.test.ts` — 21 unit tests

### Modified
- `forgeos-server/src/db/index.ts` — Barrel export of file-mutex functions

## Implementation Details

### Core Functions

1. **`acquireFileLocks(ticketId, filePaths, agentId, machineId)`**
   - Inserts lock records for all file paths in a single transaction
   - Uses `INSERT ... ON CONFLICT (file_path) WHERE released_at IS NULL DO NOTHING`
   - Compares inserted row count vs requested: if mismatch, queries conflicts and throws `FileConflictError`
   - All-or-nothing semantics: on conflict, entire transaction is rolled back
   - Records `FILE_LOCKED` events for each acquired lock

2. **`checkFileConflicts(ticketId, filePaths)`**
   - Queries active locks (released_at IS NULL) on the given paths belonging to different tickets
   - Returns `FileConflictDetail[]` with owning ticket_id, agent, machine, and lock timestamp

3. **`releaseFileLocks(ticketId)`**
   - Sets `released_at = NOW()` for all active locks belonging to the ticket
   - Records `FILE_UNLOCKED` events for each released lock
   - Returns list of released file paths

4. **`getActiveLocksForTicket(ticketId)`** — Query helper for active locks per ticket
5. **`getActiveLockForFile(filePath)`** — Query helper for single file lock status

### Domain Error Types

- `FileConflictError` — Typed domain error with `code: 'FILE_CONFLICT'`, `statusCode: 409`, conflict details array
- `FileConflictDetail` — Structured conflict info (file_path, locked_by_ticket, agent, machine, timestamp)
- `AcquireFileLocksResult` / `ReleaseFileLocksResult` — Typed result objects

### Concurrency Safety

- Database-level mutex via partial unique index: `CREATE UNIQUE INDEX idx_file_locks_active ON file_locks(file_path) WHERE released_at IS NULL`
- `INSERT ... ON CONFLICT DO NOTHING` ensures exactly one ticket succeeds for concurrent lock attempts on the same file
- Transactional atomicity: all-or-nothing lock acquisition with explicit ROLLBACK on conflict

## TDD Evidence

- **RED**: 21 tests written describing all behaviors before implementation
- **GREEN**: Implementation written to satisfy all test assertions
- **REFACTOR**: Extracted domain error types, result types, and helper functions

## Test Results

- **Tests**: 21 passed, 0 failed
- **Coverage**: 100% statements, 100% functions, 100% lines, 94.28% branches
- **Framework**: Vitest with pg mocks (no live database required)

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `acquireFileLocks(ticketId, filePaths, agentId, machineId)` inserts lock records | ✅ |
| 2 | Uses `INSERT ... ON CONFLICT (file_path) WHERE released_at IS NULL DO NOTHING` | ✅ |
| 3 | `checkFileConflicts(ticketId, filePaths)` returns conflicting files with ticket_ids | ✅ |
| 4 | Returns `FILE_CONFLICT` error with details | ✅ |
| 5 | `releaseFileLocks(ticketId)` sets `released_at = NOW()` | ✅ |
| 6 | `FILE_LOCKED` and `FILE_UNLOCKED` events recorded in events table | ✅ |
| 7 | Concurrent file lock attempts: exactly one succeeds | ✅ (via partial unique index + ON CONFLICT DO NOTHING) |

## Decisions

- Used `INSERT ... SELECT unnest($1::text[])` for bulk insert of file lock records in a single query
- Used `ON CONFLICT DO NOTHING` + post-insert row count check instead of pre-check + insert to avoid TOCTOU races
- Domain error `FileConflictError` extends `Error` with structured conflict details for programmatic handling
- All operations use raw pool client transactions (not `transactionWithRLS`) since file locks have permissive RLS policies

## Confidence: HIGH
