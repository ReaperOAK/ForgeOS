## TASK-INT-BE027 — Backend Complete

### Summary
Integration tests for the code graph indexer pipeline. Tests the full end-to-end
flow: file walker discovers files → parsers extract symbols and imports → indexer
service upserts into database. Covers TypeScript and Python fixture projects,
incremental indexing, change detection, and file removal.

### Artifacts
- `forgeos-server/src/__tests__/integration/indexer.test.ts` (NEW — 21 tests)

### Test Results
- **21 tests passed, 0 failed** (92ms)
- Vitest v3.2.4

### Acceptance Criteria Verification
| AC | Description | Status |
|----|-------------|--------|
| 1 | Full indexing of fixture TypeScript project (3 files with imports/exports) | ✅ PASS |
| 2 | Full indexing of fixture Python project (3 files with imports) | ✅ PASS |
| 3 | code_files table populated correctly (path, hash, language, line count) | ✅ PASS |
| 4 | code_symbols table populated (functions, classes, methods extracted) | ✅ PASS |
| 5 | code_imports table populated (import relationships) | ✅ PASS |
| 6 | Incremental indexing: modify one file, verify only it is re-indexed | ✅ PASS |
| 7 | Uses mocked database pool (not real DB) | ✅ PASS |

### TDD Evidence
- **RED:** Fixtures defined with known structures → pipeline helper orchestrates walk → index → parse
- **GREEN:** Assertions verify walker discovers correct files, indexer detects changes, parsers extract symbols/imports
- **REFACTOR:** Extracted `runFullPipeline` helper, `createMockPool` factory, `getClientQueries` utility

### Test Coverage
- TypeScript project: 3-file fixture (index.ts, helper.ts, calculator.ts) with cross-file imports
- Python project: 3-file fixture (main.py, user.py, user_service.py) with cross-module imports
- Incremental scenarios: unchanged (0 changes), single-file modify, file removal, file addition
- Mixed-language workspace: 6 files (3 TS + 3 PY) indexed and parsed correctly
- DB mock verification: transaction wrapping, no real connections

### Confidence: HIGH
