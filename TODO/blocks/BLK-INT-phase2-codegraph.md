# L2 Execution Blocks — Phase 2: Code Graph Engine

> **L1 Capability:** Code Graph Engine  
> **Priority:** CRITICAL (P0)  
> **Phase Dependency:** Phase 1 (MCP-Only Cutover)

---

## BLK-INT-06: Code Graph Schema & Infrastructure

**Scope:** PostgreSQL migration for code graph tables (`code_files`, `code_symbols`, `code_imports`, `code_dependencies`). Enums, indexes, stored functions for blast radius and symbol search. tree-sitter WASM grammar setup in build system.  
**Files:** `forgeos-server/src/db/migrations/`, `forgeos-server/package.json`, Docker config  
**Estimated Effort:** M  
**Tickets:** 3 (schema migration, stored functions, tree-sitter infra)

---

## BLK-INT-07: tree-sitter Indexer Service

**Scope:** Build the Indexer service using `web-tree-sitter` WASM. Parse TS/JS/Python/SQL. Extract symbols, imports, dependencies. Implement SHA-256 incremental indexing. Batch INSERT with per-file transaction boundaries.  
**Files:** `forgeos-server/src/indexer/`  
**Estimated Effort:** L  
**Tickets:** 3 (core indexer, TypeScript parser, Python/SQL parsers)

---

## BLK-INT-08: Code Graph MCP Tools

**Scope:** Implement 3 MCP tools: `code.blast_radius`, `code.search_symbols`, `code.get_imports`. Zod schemas, handlers, REST API endpoints.  
**Files:** `forgeos-server/src/tools/`, `forgeos-server/src/api/`  
**Estimated Effort:** M  
**Tickets:** 3 (one per tool)

---

## BLK-INT-09: Code Graph Testing & Agent SDK

**Scope:** Integration tests for indexer (fixture-based), blast radius queries, symbol search. Performance benchmarks. Agent SDK wrappers for code graph tools.  
**Files:** `forgeos-server/src/__tests__/`, `agent-sdk/src/`  
**Estimated Effort:** M  
**Tickets:** 4 (indexer tests, blast radius tests, performance benchmarks, SDK update)
