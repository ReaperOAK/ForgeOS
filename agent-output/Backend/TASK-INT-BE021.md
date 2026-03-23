# TASK-INT-BE021 — Core Indexer Service with File Walker

**Stage:** BACKEND  
**Agent:** Backend  
**Status:** COMPLETE  
**Timestamp:** 2026-03-12T21:52:00Z

## Artifacts

| File | Action |
|------|--------|
| `forgeos-server/src/services/indexer/file-walker.ts` | Created |
| `forgeos-server/src/services/indexer/indexer-service.ts` | Created |
| `forgeos-server/src/services/indexer/file-walker.test.ts` | Created |
| `forgeos-server/src/services/indexer/indexer-service.test.ts` | Created |

## Implementation Summary

### file-walker.ts
- `walkDirectory(rootPath, options?)` — async recursive directory walker
- Filters to supported extensions: `.ts`, `.tsx`, `.js`, `.jsx`, `.py`, `.sql`
- Skips default ignore dirs: `node_modules`, `.git`, `dist`, `build`, `coverage`, `__pycache__`, `.next`, `.turbo`
- Configurable via `WalkOptions`: `ignoreDirs`, `extraExtensions`
- Computes SHA-256 hex digest per file
- Counts lines per file
- Returns `FileEntry[]` with relative forward-slash paths
- Resilient to unreadable directories/files (logs warning, continues)

### indexer-service.ts
- `IndexerService.indexWorkspace(rootPath, walkOptions?)` — main entry point
- Walks the filesystem then fetches existing `code_files` rows
- Compares SHA-256 hashes to detect new/modified files
- Detects removed files (in DB but no longer on disk)
- Performs upsert + delete in a single database transaction (BEGIN/COMMIT/ROLLBACK)
- Returns `IndexResult` with `changedFiles` array for downstream parser consumption
- No transaction opened when nothing changed (optimisation)

## TDD Evidence

| Cycle | Red | Green | Refactor |
|-------|-----|-------|----------|
| 1 | sha256/countLines helper tests | Implemented helpers | Extracted to `_internals` |
| 2 | walkDirectory flat discovery | Directory traversal with readdir | Normalised path separator |
| 3 | ignore dirs (.git, node_modules, dist, build) | Ignore set filtering | Merged DEFAULT_IGNORE + custom |
| 4 | Extension filtering + language mapping | Added EXTENSION_TO_LANGUAGE map | — |
| 5 | IndexerService new-file upsert | INSERT ON CONFLICT | Wrapped in transaction |
| 6 | Hash comparison (skip unchanged) | existingMap check | Skip transaction when nothing changed |
| 7 | Removed file detection | DELETE query | — |
| 8 | Rollback on DB error | try/catch/finally | — |

## Test Results

```
 ✓ src/services/indexer/file-walker.test.ts (21 tests) 21ms
 ✓ src/services/indexer/indexer-service.test.ts (12 tests) 27ms

 Test Files  2 passed (2)
      Tests  33 passed (33)
```

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | File walker traverses from configurable root path | ✅ `walkDirectory(rootPath)` |
| 2 | Respects .gitignore patterns (node_modules, dist, .git) | ✅ DEFAULT_IGNORE_DIRS set |
| 3 | Filters by supported language extensions | ✅ SUPPORTED_EXTENSIONS set |
| 4 | Computes SHA-256 hash for each file | ✅ `sha256()` helper |
| 5 | Compares hashes against code_files table | ✅ existingMap comparison |
| 6 | Only re-indexes changed files | ✅ hash diff check |
| 7 | Returns list of changed files for parser processing | ✅ `IndexResult.changedFiles` |
| 8 | Unit tests with mock filesystem and database | ✅ 33 tests, real tmpdir + mock Pool |

## Confidence

**HIGH** — All 8 acceptance criteria met, 33/33 tests passing, zero type errors in new files, transaction safety verified.
