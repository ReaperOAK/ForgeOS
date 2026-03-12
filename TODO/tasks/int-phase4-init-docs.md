# Phase 4 — Drop-In Init: Initialization, Benchmarks and Documentation (L3 Tickets)

Source blocks: BLK-INT-14 (Drop-In Init MCP Tools), BLK-INT-15 (Init Integration Tests and Documentation)

---

# TASK-INT-BE042: Implement init.index MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE021, TASK-INT-BE019
**Files:** forgeos-server/src/tools/init-index.ts
**Tags:** intelligence, init, phase4, mcp-tool, BLK-INT-14

## Description

Implement the init.index MCP tool. Triggers a full codebase indexing. Walks the project directory tree, identifies source files by extension, parses each file with the appropriate tree-sitter parser, and stores symbols in the code graph. Reports progress via SSE.

## Acceptance Criteria

- [ ] MCP tool init.index accepts project_root (string), optional file_patterns (array of globs, default common extensions)
- [ ] Uses the file walker from TASK-INT-BE021 to discover source files
- [ ] Parses each file with matching tree-sitter parser (TS/JS or Python)
- [ ] Stores file records in code_files, symbols in code_symbols
- [ ] Extracts and stores imports in code_imports
- [ ] Reports progress via SSE: files_found, files_processed, symbols_extracted
- [ ] Returns summary with total_files, total_symbols, total_imports, duration_ms
- [ ] Skips node_modules, __pycache__, .git, dist directories by default
- [ ] Handles parse errors gracefully (logs warning then continues to next file)

---

# TASK-INT-BE043: Implement init.orient MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE042
**Files:** forgeos-server/src/tools/init-orient.ts
**Tags:** intelligence, init, phase4, mcp-tool, BLK-INT-14

## Description

Implement the init.orient MCP tool. Auto-discovers project framework, build system, and key entry points. Generates an orientation summary that agents use for first-contact with a new codebase. Detects: package managers (npm/pnpm/yarn/pip), frameworks (Next.js/React/Express/Django/FastAPI), test frameworks, and configuration files.

## Acceptance Criteria

- [ ] MCP tool init.orient accepts project_root (string)
- [ ] Detects package manager from lockfiles (package-lock.json, pnpm-lock.yaml, yarn.lock, Pipfile.lock, poetry.lock)
- [ ] Detects frameworks from package.json dependencies or Python imports
- [ ] Identifies entry points (src/index.ts, main.py, app.py, manage.py)
- [ ] Identifies test directory and test framework
- [ ] Identifies build configuration (tsconfig.json, webpack.config, vite.config)
- [ ] Returns orientation object with detected_stack, entry_points, build_config, test_config
- [ ] Reports progress via SSE
- [ ] Handles monorepo structures (scans top-level subpackages)

---

# TASK-INT-BE044: Orientation Progress API and SSE Stream

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE043
**Files:** forgeos-server/src/api/orientation-progress.ts
**Tags:** intelligence, init, phase4, api, BLK-INT-14

## Description

Implement the orientation progress REST API and SSE stream. Provides real-time progress updates during init.index and init.orient operations. Dashboard can subscribe to progress events for visual feedback.

## Acceptance Criteria

- [ ] GET /api/orientation/:jobId returns current progress JSON
- [ ] GET /api/orientation/:jobId/stream returns SSE stream with progress events
- [ ] Progress events include: phase (indexing or orientation), files_total, files_processed, current_file, status
- [ ] SSE stream emits event per file processed (throttled to max 10 per second)
- [ ] Final event includes complete summary
- [ ] Job status persisted (in-progress, completed, failed)
- [ ] Job results queryable after completion
- [ ] Zod schemas validate all request and response types

---

# TASK-INT-BE045: Drop-In Init Integration Tests

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE042, TASK-INT-BE043, TASK-INT-BE044
**Files:** forgeos-server/src/__tests__/init-engine.integration.test.ts
**Tags:** intelligence, init, phase4, testing, BLK-INT-15

## Description

Integration tests for the drop-in init engine. Tests cover full indexing of a sample project, orientation detection, progress reporting, and error handling. Uses a fixture project directory with known structure.

## Acceptance Criteria

- [ ] Test: init.index on fixture project creates expected code_files and code_symbols records
- [ ] Test: init.orient correctly identifies fixture project as TypeScript/Express
- [ ] Test: progress SSE stream emits events in correct order
- [ ] Test: skips excluded directories (node_modules, .git)
- [ ] Test: handles empty project directory gracefully
- [ ] Test: handles project with unsupported file types (logs warning, does not fail)
- [ ] Coverage at or above 80 percent for init engine modules
- [ ] All tests use isolated test database

---

# TASK-INT-BE046: Performance Benchmarks for Init Operations

**Type:** backend
**Priority:** medium
**Dependencies:** TASK-INT-BE045
**Files:** forgeos-server/src/__tests__/init-benchmarks.test.ts
**Tags:** intelligence, init, phase4, performance, BLK-INT-15

## Description

Performance benchmark tests for init.index and init.orient. Verifies that full project indexing completes within the target time budget. Tests against synthetic codebases of varying sizes.

## Acceptance Criteria

- [ ] Benchmark: init.index on 1000-file synthetic project completes in under 120 seconds
- [ ] Benchmark: init.orient on typical project completes in under 10 seconds
- [ ] Benchmark: SSE progress stream does not degrade indexing performance by more than 10 percent
- [ ] Benchmark: memory usage stays under 512MB during indexing
- [ ] Results logged with mean, p95, and max durations
- [ ] Benchmark results stored for regression tracking

---

# TASK-INT-BE047: Update Agent SDK with Init Tool Schemas

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE042, TASK-INT-BE043
**Files:** agent-sdk/src/forgeos_sdk/tools/init_tools.py, agent-sdk/src/forgeos_sdk/models/init.py
**Tags:** intelligence, init, phase4, sdk, BLK-INT-14

## Description

Add init.index and init.orient tool definitions to the Agent SDK. Update Pydantic models for indexing parameters, orientation results, and progress events.

## Acceptance Criteria

- [ ] InitIndexInput model with project_root, optional file_patterns
- [ ] InitIndexResult model with total_files, total_symbols, total_imports, duration_ms
- [ ] InitOrientInput model with project_root
- [ ] OrientationResult model with detected_stack, entry_points, build_config, test_config
- [ ] ProgressEvent model with phase, files_total, files_processed, current_file, status
- [ ] Tool definitions registered in SDK tool catalog
- [ ] Unit tests for all new models (Pydantic validation)

---

# TASK-INT-DOC002: Intelligence Evolution Documentation

**Type:** docs
**Priority:** medium
**Dependencies:** TASK-INT-BE035, TASK-INT-BE041, TASK-INT-BE047
**Files:** docs/architecture/intelligence-architecture.md, docs/operations/intelligence-setup.md, README.md
**Tags:** intelligence, docs, phase4, BLK-INT-15

## Description

Update all documentation for the intelligence evolution features. Update the architecture doc with final schema, API contracts, and configuration. Create an operations guide for setting up pgvector, configuring the OpenAI API key, and running init.index. Update README with intelligence feature summary.

## Acceptance Criteria

- [ ] docs/architecture/intelligence-architecture.md updated with final schema DDL
- [ ] docs/architecture/intelligence-architecture.md updated with all MCP tool contracts
- [ ] docs/operations/intelligence-setup.md created with setup instructions for pgvector, OpenAI API key, and initial indexing
- [ ] README.md updated with intelligence features section
- [ ] All code examples in documentation are accurate and tested
- [ ] JSDoc and TSDoc updated for all new public APIs
- [ ] No TODO comments remaining in documentation
