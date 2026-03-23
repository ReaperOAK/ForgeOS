# TASK-INT-BE025 — Backend Stage Summary

## Tool: `code.search_symbols`

### Artifacts
- `forgeos-server/src/tools/code-search-symbols.ts` (NEW) — MCP tool implementation
- `forgeos-server/src/tools/code-search-symbols.test.ts` (NEW) — 17 unit tests
- `forgeos-server/src/tools/index.ts` (MODIFIED) — Tool registration

### Implementation Details

**Handler**: `codeSearchSymbolsHandler` calls the `search_symbols($1, $2, $3)` PostgreSQL stored function (from 003-code-graph.sql migration) with parameterized queries. Returns the JSONB result containing `symbols[]`, `total`, `pattern`, `kind`, and `file_path`.

**Schema**: Zod validation with:
- `name_pattern` (required, non-empty string) — ILIKE pattern
- `kind` (optional enum: function, class, method, interface, type, variable)
- `file_path` (optional string)

**Error handling**: DB errors return `{ isError: true }` with `INTERNAL_ERROR` code, structured error response with timestamp. Both `Error` instances and non-Error thrown values are handled.

**Registration**: Registered as `code.search_symbols` in `tools/index.ts`.

### TDD Evidence
- RED: Tests written first asserting schema validation, query parameterization, response shape, empty results, and error handling.
- GREEN: Implementation written to satisfy all 17 tests.
- REFACTOR: Clean separation of types, consistent patterns with existing `tickets.*` tools.

### Test Results
```
17 tests passed, 0 failed
- 8 schema validation tests
- 9 handler tests (success, filters, empty, fallback, errors, shape)
```

### AC Verification
1. ✅ Tool accepts `name_pattern` (required), `kind` (optional), `file_path` (optional)
2. ✅ Calls `search_symbols()` PostgreSQL stored function with `$1, $2, $3`
3. ✅ Returns JSONB array of symbols with file path, line numbers, signature
4. ✅ ILIKE pattern matching (delegated to stored function)
5. ✅ Zod input validation with enum kind, min(1) name_pattern
6. ✅ Registered in `tools/index.ts`
7. ✅ 17 unit tests with mocked pool

### Confidence: HIGH
