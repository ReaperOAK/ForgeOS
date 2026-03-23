# Backend Summary — TASK-PC-BE-012 (Rework)

## Verdict
COMPLETE — coverage gate cleared, all 40 tests pass.

## Rework Target
QA rejected the original implementation because:
- `compiler.ts` line coverage was 74.09% (below 80% threshold)
- `memory-provider.ts` line coverage was 78.52% (below 80% threshold)

## Coverage After Rework
| File | Lines Before | Lines After | Gate |
|------|-------------|------------|------|
| `src/services/compiler.ts` | 74.09% | **86.44%** | ✅ PASS |
| `src/services/memory-provider.ts` | 78.52% | **88.59%** | ✅ PASS |
| `src/services/context-hash.ts` | 97.95% | 97.95% | ✅ PASS |

## What Changed

**Only `src/__tests__/memory-snapshot-versioning.test.ts` was modified.**

Additions:
1. `mockPoolQuery` controlled mock replacing the inline `vi.fn()` in the pool mock factory.
2. 16 new test cases grouped into 4 categories:

### memory-provider normalization edge cases
- Filters empty/whitespace/non-string `lesson_text`
- Normalises null/empty/whitespace `category` to `"lesson"`
- Generates fallback `id` (`lesson-N-category`) for missing/empty ids
- Defaults `similarity` to 0 for null/non-numeric/non-finite values
- `sortEntries` category tiebreaker
- `sortEntries` lessonText tiebreaker
- `sortEntries` id final tiebreaker
- `safeSearchLessons` general malformed → `lessons-search-malformed` warning
- `safeSearchLessons` instruction malformed → `instruction-search-malformed` warning

### loadMemorySnapshotForTicket
- Builds query from ticket title + description + acceptance criteria
- Falls back to `ticketId` when all ticket text fields are blank

### compiler queue and cache
- `queueCompileTicketPrompt` idempotent key deduplication + `waitForCompileQueueToDrain`
- `processCompileJob` error path (catch + log, no crash)
- `invalidatePromptCache` SQL: NULL hash, 'missing' freshness status
- `compileIfStale` CACHED path: stored hash matches current hash → returns `provider: 'cached'`
- `compileIfStale` STALE path: mismatched hash → recompiles, 2× pool.query calls

## Test Results
- **40/40 tests pass** across all 4 test files in the QA suite
- Lint: exit 0 (0 errors, 0 new warnings)
- TypeScript: exit 0

## Acceptance Criteria
1. ✅ Same memory snapshot inputs → deterministic lesson selection and ordering
2. ✅ Memory snapshot version change → context hash changes
3. ✅ LEARNINGS and BEST PRACTICES remain semantically separated
4. ✅ Partial memory source degradation → reduced completeness without crashing
5. ✅ ≥80% line coverage for all scoped implementation files

## Artifacts
- `forgeos-server/src/__tests__/memory-snapshot-versioning.test.ts` — modified
