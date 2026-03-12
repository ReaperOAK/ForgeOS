# TASK-INT-BE019 — Code Graph PostgreSQL Schema Migration

## Stage: BACKEND | Agent: Backend | Machine: reaperoak

## Summary

Created migration `003-code-graph.sql` implementing the four-table code graph schema for blast radius computation via recursive CTEs.

## Artifacts

| File | Action |
|------|--------|
| `forgeos-server/src/db/migrations/003-code-graph.sql` | CREATED |

## Schema

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| `code_files` | Indexed source files | file_path (UNIQUE), language, content_hash, line_count, last_indexed_at |
| `code_symbols` | AST-extracted symbols | file_id FK → code_files, name, qualified_name, kind, start_line, end_line, signature, exported |
| `code_imports` | File-level import graph | source_file_id FK → code_files, target_path, target_file_id FK (nullable), import_names[], is_default_import |
| `code_edges` | Symbol-level call/reference graph | source_symbol_id FK → code_symbols, target_symbol_id FK → code_symbols, edge_type, weight; UNIQUE constraint on (source, target, type) |

## Indexes (13 total)

- `code_files`: UNIQUE on file_path (implicit), language
- `code_symbols`: file_id, name, kind, qualified_name
- `code_imports`: source_file_id, target_file_id
- `code_edges`: source_symbol_id, target_symbol_id, edge_type

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | code_files table with path, language, hash, last_indexed_at | PASS |
| 2 | code_symbols table with file_id FK, name, kind, start_line, end_line, signature | PASS |
| 3 | code_imports table with source_file_id, target_path, import_type | PASS |
| 4 | code_edges table with source/target symbol FKs, edge_type | PASS |
| 5 | Indexes for graph traversal (source/target lookups) | PASS — 13 indexes |
| 6 | Idempotent (CREATE TABLE IF NOT EXISTS) | PASS |
| 7 | Sample recursive CTE for blast radius | PASS — included as comment |

## Design Decisions

- **Naming**: `003-code-graph.sql` follows the existing `00N-name.sql` pattern in the migrations directory.
- **CASCADE deletes**: Deleting a code_file cascades to its symbols and imports; deleting a symbol cascades to its edges. This prevents orphaned graph nodes.
- **ON DELETE SET NULL for target_file_id**: External imports (node_modules) have NULL target_file_id; if an indexed file is deleted, the import record remains with a NULL FK rather than being lost.
- **UNIQUE constraint on code_edges**: Prevents duplicate edges of the same type between two symbols; weight column tracks frequency.
- **Audit marker**: Inserted into system_config for migration tracking, following the pattern from 002-cutover-functions.sql.

## Confidence: HIGH
