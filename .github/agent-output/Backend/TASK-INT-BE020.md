# TASK-INT-BE020 — Code Graph Stored Functions

## Stage: BACKEND complete

### Summary
Implemented three PostgreSQL stored functions for code graph queries, appended to the existing `003-code-graph.sql` migration. All functions return JSONB for consistency with the ForgeOS API layer.

### Functions Implemented

| Function | Purpose | Cycle Safety | Depth Limit |
|----------|---------|-------------|-------------|
| `blast_radius(file_path, max_depth)` | Recursive CTE traversal of `code_edges` to compute transitive closure of affected symbols | `UNION` deduplication | Default 5, configurable |
| `search_symbols(name_pattern, kind, file_path)` | Filtered ILIKE symbol lookup with optional kind and file_path filters | N/A | N/A |
| `get_import_chain(file_path)` | Recursive CTE traversal of `code_imports` for transitive import dependencies | `UNION` deduplication | Hard cap 20 |

### Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `blast_radius` returns transitively affected symbols and files | PASS |
| 2 | `search_symbols` returns matching code symbols with filters | PASS |
| 3 | `get_import_chain` returns transitive import dependencies | PASS |
| 4 | All functions return JSONB results | PASS |
| 5 | Recursive CTE depth-limited (default 5) | PASS |
| 6 | Edge cases handled (missing files → empty arrays, cycles → UNION dedup) | PASS |
| 7 | Migration appended to existing `003-code-graph.sql` | PASS |

### Design Decisions

- **UNION vs UNION ALL:** Used `UNION` in both recursive CTEs to implicitly handle cyclic dependencies — PostgreSQL eliminates duplicate rows preventing infinite recursion.
- **COALESCE for empty results:** All aggregated arrays wrapped in `COALESCE(..., '[]'::JSONB)` so missing files or empty graphs return valid empty JSON arrays instead of NULL.
- **LANGUAGE SQL STABLE:** All functions are pure SQL marked `STABLE` (read-only, same results within a single statement for same inputs) enabling query planner optimizations.
- **get_import_chain depth cap:** Set to 20 (higher than blast_radius) since import chains are typically deeper but narrower than call graphs.
- **External imports:** `get_import_chain` includes external imports as leaf entries with `is_external: true` but does not recurse into them (no indexed source for external deps).

### Artifacts
- `forgeos-server/src/db/migrations/003-code-graph.sql` (modified — 3 functions appended)

### Confidence: HIGH
