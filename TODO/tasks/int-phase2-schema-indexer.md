# Phase 2 — Code Graph Engine: Schema and Indexer Service (L3 Tickets)

Source blocks: BLK-INT-06 (Schema and Infrastructure), BLK-INT-07 (Indexer Service)

---

# TASK-INT-DO001: Tree-sitter WASM Infrastructure Setup

**Type:** infra
**Priority:** critical
**Files:** forgeos-server/package.json, forgeos-server/src/services/parsers/wasm-loader.ts
**Tags:** intelligence, codegraph, phase2, infra, BLK-INT-06

## Description

Install and configure web-tree-sitter WASM bindings in the forgeos-server project. Set up WASM grammar loading for TypeScript, JavaScript, Python, and SQL. Create a grammar loader service that initializes parsers on demand. Verify parser initialization works in both development and Docker environments.

## Acceptance Criteria

- [ ] web-tree-sitter npm package installed in forgeos-server
- [ ] WASM grammar files downloaded for TypeScript, JavaScript, Python, SQL
- [ ] Grammar loader service initializes parsers lazily (on first use)
- [ ] Parser initialization succeeds in Node.js development environment
- [ ] Parser initialization succeeds inside Docker container
- [ ] Unit test: load TypeScript grammar then parse a simple file then verify AST node count
- [ ] WASM files included in Docker build (not downloaded at runtime)

---

# TASK-INT-BE019: Code Graph PostgreSQL Schema Migration

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-DO001
**Files:** forgeos-server/src/db/migrations/002-code-graph.sql
**Tags:** intelligence, codegraph, phase2, database, BLK-INT-06

## Description

Create database migration 002 for the code graph engine. Tables: code_files (indexed source files), code_symbols (functions, classes, methods extracted from AST), code_imports (import relationships), code_dependencies (file-to-file dependency edges). Match the DDL from the architecture document.

## Acceptance Criteria

- [ ] code_files table: id, repo_id, file_path (unique), language, content_hash (SHA-256), last_indexed_at, size_bytes
- [ ] code_symbols table: id, file_id (FK), name, qualified_name, kind (ENUM: function, class, method, interface, type, variable, constant), start_line, end_line, is_exported, parent_symbol_id (self-FK for nesting)
- [ ] code_imports table: id, file_id (FK), imported_name, source_path, resolved_file_id (nullable FK to code_files), is_default_import, is_namespace_import
- [ ] code_dependencies table: id, source_file_id (FK), target_file_id (FK), dependency_type (ENUM: import, re-export, dynamic), unique constraint on (source_file_id, target_file_id, dependency_type)
- [ ] Indexes on file_path, qualified_name, content_hash
- [ ] Migration is idempotent (IF NOT EXISTS guards)
- [ ] Rollback drops tables cleanly

---

# TASK-INT-BE020: Code Graph Stored Functions

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-BE019
**Files:** forgeos-server/src/db/migrations/002-code-graph.sql
**Tags:** intelligence, codegraph, phase2, database, BLK-INT-06

## Description

Implement PostgreSQL stored functions for code graph queries: blast_radius (recursive CTE traversal of code_dependencies), search_symbols (filtered symbol lookup), get_import_chain (transitive import resolution). These are called by MCP tools.

## Acceptance Criteria

- [ ] blast_radius(file_path, max_depth) returns affected files via recursive CTE on code_dependencies
- [ ] blast_radius results include: file_path, language, depth, affected_symbol_count
- [ ] blast_radius handles circular dependencies (visited set prevents infinite recursion)
- [ ] search_symbols(query, kind_filter, language_filter, limit, offset) returns matching symbols
- [ ] search_symbols supports exact match, prefix match, and substring match with ordering
- [ ] get_import_chain(file_path, max_depth) returns transitive imports with depth
- [ ] All functions have SECURITY DEFINER with restricted search_path
- [ ] Unit tests with seeded graph data verify all functions

---

# TASK-INT-BE021: Core Indexer Service with File Walker

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-DO001, TASK-INT-BE019
**Files:** forgeos-server/src/services/indexer/indexer-service.ts, forgeos-server/src/services/indexer/file-walker.ts
**Tags:** intelligence, codegraph, phase2, service, BLK-INT-07

## Description

Implement the core indexer service. File walker traverses the repository, respects .gitignore, computes SHA-256 hashes. Indexer compares hashes for incremental indexing (only re-parse changed files). Orchestrates parser dispatch based on file extension. Manages database writes for code_files rows.

## Acceptance Criteria

- [ ] File walker traverses directory tree respecting .gitignore patterns
- [ ] SHA-256 content hash computed for each file
- [ ] Incremental indexing: files with unchanged hash are skipped
- [ ] New files are inserted into code_files table
- [ ] Modified files trigger re-parse (old symbols deleted, new symbols inserted)
- [ ] Deleted files are removed from code_files with cascade to symbols/imports
- [ ] Batch database operations (configurable batch size, default 100)
- [ ] Unit test: mock filesystem then verify walker output

---

# TASK-INT-BE022: TypeScript and JavaScript AST Parser

**Type:** backend
**Priority:** critical
**Dependencies:** TASK-INT-DO001, TASK-INT-BE019
**Files:** forgeos-server/src/services/parsers/typescript-parser.ts
**Tags:** intelligence, codegraph, phase2, parser, BLK-INT-07

## Description

Implement the TypeScript/JavaScript AST parser using web-tree-sitter. Extract symbols (functions, classes, methods, interfaces, type aliases, constants) and imports from TypeScript and JavaScript files. Populate code_symbols and code_imports tables.

## Acceptance Criteria

- [ ] Extracts function declarations with name, start_line, end_line, is_exported
- [ ] Extracts class declarations with methods as child symbols (parent_symbol_id)
- [ ] Extracts interface and type alias declarations
- [ ] Extracts const/let/var declarations at module scope
- [ ] Extracts import statements: named imports, default imports, namespace imports
- [ ] Resolves relative import paths to code_files entries (resolved_file_id)
- [ ] Handles JSX/TSX syntax without parser errors
- [ ] Unit test: parse a 50-line TypeScript fixture then verify all symbols extracted

---

# TASK-INT-BE023: Python and SQL AST Parsers

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-DO001, TASK-INT-BE019
**Files:** forgeos-server/src/services/parsers/python-parser.ts, forgeos-server/src/services/parsers/sql-parser.ts
**Tags:** intelligence, codegraph, phase2, parser, BLK-INT-07

## Description

Implement Python and SQL AST parsers using web-tree-sitter. Python parser extracts functions, classes, methods, imports (import/from). SQL parser extracts CREATE TABLE, CREATE FUNCTION, CREATE INDEX statements as symbols.

## Acceptance Criteria

- [ ] Python parser extracts function definitions with name, start_line, end_line
- [ ] Python parser extracts class definitions with methods as child symbols
- [ ] Python parser extracts import and from-import statements
- [ ] Python parser handles decorators without errors
- [ ] SQL parser extracts CREATE TABLE statements as symbols (kind: table)
- [ ] SQL parser extracts CREATE FUNCTION statements as symbols (kind: function)
- [ ] SQL parser extracts CREATE INDEX statements as symbols (kind: index)
- [ ] Unit tests: parse Python and SQL fixtures then verify all symbols extracted
