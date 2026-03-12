# TASK-INT-BE026 — Backend Complete

## Summary
Implemented the `code.get_imports` MCP tool that returns the import/dependency chain for a given file path, calling the `get_import_chain()` PostgreSQL stored function.

## Artifacts
- `forgeos-server/src/tools/code-get-imports.ts` — NEW: Tool implementation
- `forgeos-server/src/tools/code-get-imports.test.ts` — NEW: 20 unit tests
- `forgeos-server/src/tools/index.ts` — MODIFIED: Registered `code.get_imports` tool

## Acceptance Criteria Verification
| # | Criterion | Status |
|---|-----------|--------|
| 1 | Tool accepts `file_path` (required) and `max_depth` (optional, default 10) | PASS |
| 2 | Calls `get_import_chain()` PostgreSQL stored function | PASS |
| 3 | Returns direct and transitive imports with depth info | PASS |
| 4 | Distinguishes internal vs external imports | PASS |
| 5 | Zod input validation | PASS |
| 6 | Registered in tools/index.ts | PASS |
| 7 | Unit tests with mocked pool | PASS — 20 tests |

## TDD Evidence
- **RED:** Wrote 20 tests covering schema validation (8), handler happy path (5), depth filtering (2), graceful degradation (4), error handling (2).
- **GREEN:** Implemented `codeGetImportsSchema` + `codeGetImportsHandler` — all 20 tests pass.
- **REFACTOR:** Aligned structure with `code-blast-radius.ts` pattern. Application-level `max_depth` filtering since stored function uses fixed cap of 20.

## Design Decisions
- **Stored function signature:** `get_import_chain(p_file_path TEXT)` takes only one parameter (no `max_depth`). The SQL has a hardcoded depth cap of 20. `max_depth` filtering is applied at the application level by filtering `depth < max_depth`.
- **Pattern:** Follows the established `code-blast-radius.ts` pattern: Zod schema, typed handler, structured logging, graceful nullability, `CallToolResult` return.

## Test Results
```
20 passed, 0 failed
Duration: 292ms
```

## Confidence: HIGH
