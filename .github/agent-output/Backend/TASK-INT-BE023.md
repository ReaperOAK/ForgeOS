# TASK-INT-BE023 — Python and SQL AST Parsers

## Stage: BACKEND | Agent: Backend | Status: COMPLETE

## Summary

Implemented Python and SQL AST parsers using web-tree-sitter, following the grammar loader API from `wasm-loader.ts` (TASK-INT-DO001). Both parsers output `{ symbols: CodeSymbol[], imports: CodeImport[] }` format matching the `code_symbols` and `code_imports` database schemas.

## Artifacts

| File | Action | Purpose |
|------|--------|---------|
| `forgeos-server/src/services/parsers/python-parser.ts` | NEW | Python AST parser using tree-sitter |
| `forgeos-server/src/services/parsers/python-parser.test.ts` | NEW | 18 unit tests for Python parser |
| `forgeos-server/src/services/parsers/sql-parser.ts` | NEW | SQL AST parser with regex fallback |
| `forgeos-server/src/services/parsers/sql-parser.test.ts` | NEW | 15 unit tests for SQL parser |

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Python parser extracts function definitions (def) with name, start_line, end_line | PASS |
| 2 | Python parser extracts class definitions with methods as child symbols | PASS |
| 3 | Python parser extracts import and from-import statements | PASS |
| 4 | Python parser handles decorators without errors | PASS |
| 5 | SQL parser extracts CREATE TABLE statements as symbols (kind: table) | PASS |
| 6 | SQL parser extracts CREATE FUNCTION statements as symbols (kind: function) | PASS |
| 7 | SQL parser extracts CREATE INDEX statements as symbols (kind: index) | PASS |
| 8 | Unit tests: parse Python and SQL fixtures, verify all symbols extracted | PASS |

## Implementation Details

### Python Parser (`python-parser.ts`)
- Uses `getParser('python')` from wasm-loader
- Extracts: `function_definition`, `class_definition`, `decorated_definition`, `import_statement`, `import_from_statement`
- Methods inside classes use `kind: 'method'` with `qualified_name: 'ClassName.methodName'`
- Decorators are captured in the function/class signature
- Handles nested classes with recursive qualified names
- Import extraction covers: `import X`, `import X as Y`, `from X import Y`, `from X import Y as Z`, `from X import *`

### SQL Parser (`sql-parser.ts`)
- SQL grammar WASM is not available (confirmed: only typescript, javascript, python WASMs exist)
- Implements regex fallback that extracts CREATE TABLE, FUNCTION, INDEX, VIEW statements
- Column definitions extracted as child symbols of CREATE TABLE
- Returns `warning` field when using regex fallback path
- If SQL grammar WASM becomes available later, tree-sitter path is fully implemented and will activate automatically
- Handles: `IF NOT EXISTS`, `OR REPLACE`, `UNIQUE INDEX`, schema-qualified names, `MATERIALIZED VIEW`

### Shared Types
- `CodeSymbol`: `name`, `qualified_name`, `kind`, `start_line`, `end_line`, `signature`, `exported`, `children`
- `CodeImport`: `source_path`, `imported_name`, `alias`, `is_default`, `is_namespace`, `is_type_only`
- `ParseResult`: `{ symbols: CodeSymbol[], imports: CodeImport[] }`
- `SqlParseResult`: extends ParseResult with optional `warning`

## Test Results

```
Test Files  2 passed (2)
Tests  33 passed (33)
Duration  336ms
```

- Python parser: 18 tests (functions, classes, decorators, imports, mixed, edge cases)
- SQL parser: 15 tests (CREATE TABLE/FUNCTION/INDEX/VIEW, columns, mixed, fallback, edge cases)

## TDD Evidence

1. **RED**: Wrote failing tests for function extraction, class extraction, decorator handling, import parsing
2. **GREEN**: Implemented `parsePython()` with tree-sitter AST walking; fixed module_name deduplication in from-import parsing
3. **REFACTOR**: Extracted helpers (`nodeText`, `childByField`, `extractDecorators`, `buildFunctionSignature`)

## Confidence: HIGH

## Timestamp: 2026-03-12T21:53:00Z
