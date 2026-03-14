# TASK-INT-BE034 — Reflection Protocol Service

## Stage: BACKEND | Agent: Backend | Machine: Ticketer

## Summary

Implemented the `ReflectionService` that automatically extracts lessons from
QA/Security/CI rejection cycles on reworked tickets. The service analyses the
event history (`STAGE_REJECTED` and `STAGE_ADVANCED` events), constructs a
structured lesson (`what_failed`, `what_fixed_it`, `pattern_learned`), generates
an embedding via `EmbeddingService`, and persists both the lesson and its
embedding inside a database transaction.

## Artifacts

| File | Action |
|------|--------|
| `forgeos-server/src/services/reflection-service.ts` | CREATED |
| `forgeos-server/src/services/reflection-service.test.ts` | CREATED |

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `ReflectionService` class that analyzes rework cycles | PASS |
| 2 | Extracts rejection reason from STAGE_REJECTED events | PASS |
| 3 | Extracts completion evidence from STAGE_ADVANCED events | PASS |
| 4 | Generates structured lesson: { what_failed, what_fixed_it, pattern_learned } | PASS |
| 5 | Calls EmbeddingService to generate embedding | PASS |
| 6 | Stores lesson + embedding in lessons/lesson_embeddings tables | PASS |
| 7 | Only triggers for tickets with rework_count > 0 | PASS |
| 8 | Unit tests with mocked pool and embedding service | PASS (16 tests) |

## TDD Evidence

### Cycle 1 — Skip conditions (RED → GREEN)
- RED: Wrote tests for null ticket and rework_count=0 → tests fail (no service)
- GREEN: Implemented early-return path in `reflectOnTicket`

### Cycle 2 — Happy path extraction (RED → GREEN)
- RED: Wrote tests for single/multiple rejection cycles, missing notes, null agent
- GREEN: Implemented event query + lesson extraction logic

### Cycle 3 — Embedding + persistence (RED → GREEN → REFACTOR)
- RED: Wrote tests for embedText call, transaction BEGIN/COMMIT, insert params
- GREEN: Implemented embedding call + transactional insert
- REFACTOR: Added proper TypeScript row types, defensive null check on lessonResult

### Cycle 4 — Error paths (RED → GREEN)
- RED: Wrote tests for embedding failure rollback, DB insert failure rollback
- GREEN: Implemented try/catch/finally with ROLLBACK + client.release

## Test Results

```
16 tests passed, 0 failed
Duration: 291ms
```

## Design Decisions

1. **Transaction wrapping**: Lesson + embedding inserts are wrapped in `BEGIN/COMMIT`
   with `ROLLBACK` on failure to prevent orphaned rows.
2. **Client-based transaction**: Uses `pool.connect()` to get a dedicated client
   for the transaction scope, following PostgreSQL best practices.
3. **STAGE_ADVANCED vs STAGE_COMPLETED**: Used `STAGE_ADVANCED` event type per the
   database schema's `event_type` enum (no `STAGE_COMPLETED` exists).
4. **model_name column**: Includes `model_name` ('text-embedding-3-small') in the
   `lesson_embeddings` insert per the migration schema.

## Confidence: HIGH
