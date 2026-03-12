# TASK-INT-BE017 — BACKEND Complete

## Summary

Implemented a one-time filesystem-to-PostgreSQL migration script that reads existing ticket JSON from `.github/tickets/` and `.github/ticket-state/` directories and inserts them into the PostgreSQL `tickets` table with full data preservation.

## Artifacts

| File | Action |
|------|--------|
| `forgeos-server/scripts/migrate-filesystem.ts` | Created — Migration script (~650 lines) |
| `forgeos-server/src/__tests__/db/migrate-filesystem.test.ts` | Created — Unit tests with fixture data (33 tests) |

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Script reads all ticket JSON from `.github/tickets/` | ✅ PASS |
| 2 | Script determines current stage from `.github/ticket-state/` directory location | ✅ PASS |
| 3 | Inserts complete ticket records into PostgreSQL `tickets` table | ✅ PASS |
| 4 | Preserves `depends_on` relationships | ✅ PASS |
| 5 | Creates initial events (CREATED + current stage) for tickets without history | ✅ PASS |
| 6 | Handles idempotent re-runs (skip already-migrated tickets) | ✅ PASS |
| 7 | Reports migration statistics (total, migrated, skipped, errors) | ✅ PASS |
| 8 | Unit test with fixture data | ✅ PASS — 33 tests, all passing |

## TDD Evidence

- **RED**: Wrote 33 tests covering helpers (deriveStageFromFilesystem, mapSdlcFlow, mapHistoryEvent, deriveStatus), core migration (9 scenarios), dry-run (3 tests), dependency preservation, and synthetic event creation.
- **GREEN**: Implemented migration script with all edge cases: malformed JSON, missing fields, invalid types, DB errors, schema file exclusion, priority normalization.
- **REFACTOR**: Extracted pure helper functions for testability, guarded CLI entry point with `VITEST` env check.

## Test Results

```
33 passed (33)
0 failed
Duration: 357ms
```

## Decisions

- Used skip-based idempotency (SELECT before INSERT) instead of UPSERT, as migration semantics should not overwrite manually-edited DB rows.
- Followed existing `import.ts` mapping patterns for stage names (DOCS→DOCUMENTATION, VALIDATION→VALIDATOR) and event type mappings.
- Added `--dry-run` flag for safe preview without DB writes.
- Excluded `ticket-schema.json` from migration processing.
- Normalized invalid priorities to `medium` instead of erroring.
- Created synthetic CREATED + STAGE_ADVANCED events only for tickets with no existing history.

## Confidence

**HIGH** — All 33 tests pass, typecheck clean, follows established codebase patterns.
