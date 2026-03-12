# Phase 2 — Code Graph Engine: MCP Tools and Testing (L3 Tickets)

Source blocks: BLK-INT-08 (Code Graph MCP Tools), BLK-INT-09 (Testing and Agent SDK)

---

# TASK-INT-BE024: Implement code.blast_radius MCP Tool

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-BE020, TASK-INT-BE021
**Files:** forgeos-server/src/tools/code-blast-radius.ts
**Tags:** intelligence, codegraph, phase2, mcp-tool, BLK-INT-08

## Description

Implement the code.blast_radius MCP tool. Given a file path, compute the blast radius by traversing the code_dependencies graph via the blast_radius() stored function. Return affected files, symbols, test files, ordered by dependency depth. Agents call this before modifying files to understand impact.

## Acceptance Criteria

- [ ] MCP tool code.blast_radius accepts file_path and optional max_depth (default 5)
- [ ] Returns affected_files array with path, language, depth, affected_symbols count
- [ ] Returns test_files array (files matching test patterns)
- [ ] Returns total_affected count
- [ ] Query completes in less than 500ms for projects with 10K files
- [ ] Zod schemas validate input (file_path required, max_depth 1-10)
- [ ] Returns empty result for files with no dependents (not an error)

---

# TASK-INT-BE025: Implement code.search_symbols MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE020, TASK-INT-BE021
**Files:** forgeos-server/src/tools/code-search-symbols.ts
**Tags:** intelligence, codegraph, phase2, mcp-tool, BLK-INT-08

## Description

Implement the code.search_symbols MCP tool. Search for code symbols (functions, classes, methods, interfaces) by name across the project. Filter by kind and language. Return matches ordered by exact match first, then exported symbols, then by name.

## Acceptance Criteria

- [ ] MCP tool code.search_symbols accepts query (string), optional kind, optional language
- [ ] Returns array of symbol objects with name, qualified_name, kind, file_path, start_line, end_line, is_exported
- [ ] Exact name matches ranked first, then prefix matches, then substring matches
- [ ] Exported symbols prioritized over non-exported
- [ ] Supports pagination with limit (default 20) and offset
- [ ] Query completes in less than 100ms for 500K symbols
- [ ] Unit test: seed 10 symbols then verify ordering rules

---

# TASK-INT-BE026: Implement code.get_imports MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE020, TASK-INT-BE021
**Files:** forgeos-server/src/tools/code-get-imports.ts
**Tags:** intelligence, codegraph, phase2, mcp-tool, BLK-INT-08

## Description

Implement the code.get_imports MCP tool. Given a file path, return the import/dependency chain showing what the file imports (direct and transitive up to max_depth). Include import names, source paths, and whether imports are resolved to internal files or external packages.

## Acceptance Criteria

- [ ] MCP tool code.get_imports accepts file_path and optional max_depth (default 2)
- [ ] Returns direct_imports array with source_path, imported_names, is_resolved, resolved_file_path
- [ ] Returns transitive_imports array with depth annotations (if max_depth greater than 1)
- [ ] Distinguishes internal imports (resolved to code_files) from external packages
- [ ] Returns empty result for files with no imports (not an error)
- [ ] Zod schemas validate input parameters
- [ ] Unit test: fixture with 3-level import chain verifies depth annotations

---

# TASK-INT-BE027: Integration Tests for Code Graph Indexer

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE021, TASK-INT-BE022, TASK-INT-BE023
**Files:** forgeos-server/src/__tests__/integration/indexer.test.ts
**Tags:** intelligence, codegraph, phase2, testing, BLK-INT-09

## Description

Write integration tests for the code graph indexer. Use fixture repositories with known file structures. Verify full indexing populates all tables correctly. Verify incremental indexing skips unchanged files. Verify deleted files are cleaned up.

## Acceptance Criteria

- [ ] Test full index of a 10-file TypeScript fixture verifies code_files, code_symbols, code_imports rows
- [ ] Test full index of a 5-file Python fixture verifies symbols and imports
- [ ] Test incremental index after modifying 2 files verifies only 2 re-parsed
- [ ] Test incremental index after deleting 1 file verifies file and symbols removed
- [ ] Test import resolution verifies resolved_file_id links correct files
- [ ] Test nested symbols (method inside class) verifies parent_symbol_id
- [ ] All tests use isolated test database with cleanup

---

# TASK-INT-BE028: Integration Tests for Blast Radius Queries

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE024, TASK-INT-BE027
**Files:** forgeos-server/src/__tests__/integration/blast-radius.test.ts
**Tags:** intelligence, codegraph, phase2, testing, BLK-INT-09

## Description

Write integration tests for blast radius computation. Seed a known dependency graph into code_files/code_symbols/code_dependencies tables. Verify recursive CTE returns correct affected files at correct depths. Verify test file identification.

## Acceptance Criteria

- [ ] Test A imports B, B imports C then blast_radius(A) returns B (depth 1) and C (depth 2)
- [ ] Test file with no dependents returns empty blast radius
- [ ] Test circular dependency causes no infinite loop, bounded by max_depth
- [ ] Test files matching test patterns are flagged as test files
- [ ] Test max_depth=1 returns only direct dependents
- [ ] Performance test 1000-node graph blast radius completes in less than 500ms
- [ ] Tests use seeded graph data in isolated test database

---

# TASK-INT-BE029: Performance Benchmarks for Code Graph

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-INT-BE027, TASK-INT-BE028
**Files:** forgeos-server/src/__tests__/benchmarks/codegraph-benchmark.test.ts
**Tags:** intelligence, codegraph, phase2, performance, BLK-INT-09

## Description

Write performance benchmarks for the code graph system. Generate synthetic repositories of varying sizes (100, 1K, 10K files). Measure full index time, incremental index time, blast radius query latency, symbol search latency. Validate against NFR targets from the PRD.

## Acceptance Criteria

- [ ] Benchmark full index of 10K synthetic files completes in less than 60 seconds
- [ ] Benchmark incremental index of 10 changed files completes in less than 5 seconds
- [ ] Benchmark blast radius query on 10K-file graph completes in less than 500ms p99
- [ ] Benchmark symbol search on 50K symbols completes in less than 100ms p99
- [ ] Results logged in machine-readable JSON format
- [ ] Benchmarks can run in CI and be optionally marked as slow

---

# TASK-INT-BE030: Update Agent SDK for Code Graph Tools

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE024, TASK-INT-BE025, TASK-INT-BE026
**Files:** agent-sdk/src/forgeos_sdk/client.py, agent-sdk/src/forgeos_sdk/models.py
**Tags:** intelligence, codegraph, phase2, agent-sdk, BLK-INT-09

## Description

Update the ForgeOS Agent SDK (Python) to add client wrappers for the 3 code graph MCP tools: code.blast_radius, code.search_symbols, code.get_imports. Add corresponding Pydantic models for response types.

## Acceptance Criteria

- [ ] client.code_blast_radius(file_path, max_depth) wraps code.blast_radius
- [ ] client.code_search_symbols(query, kind, language) wraps code.search_symbols
- [ ] client.code_get_imports(file_path, max_depth) wraps code.get_imports
- [ ] Pydantic response models match MCP tool output schemas
- [ ] Error handling follows existing SDK patterns
- [ ] Unit tests for each new method with mocked MCP responses
- [ ] README updated with usage examples
