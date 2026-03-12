# L1 — ForgeOS Intelligence Evolution

> **L0 Vision:** Transform ForgeOS from a mechanical distributed scheduler into a conscious, self-healing, fully autonomous developer agency.

**Date:** 2026-03-12  
**Source:** Intelligence_plan.md, PRD-intelligence-plan.md, intelligence-architecture.md  
**Confidence:** HIGH (88%)

---

## Capability 1: MCP-Only Cutover (Phase 1 — P0)

**Priority:** CRITICAL — unblocks all subsequent phases  
**Summary:** Permanently sever all agent dependencies on the filesystem for ticket state. Agents interact exclusively with the MCP server. The ForgeOS orchestrator replaces the stateless Ticketer dispatcher.  
**Key Deliverables:**
- Rewrite 6 instruction files to remove 73+ filesystem ticket-state references
- Rewrite 14 agent files for MCP-only boot sequences
- Implement 3 new MCP tools: `tickets.get`, `tickets.list`, `tickets.payload`
- Build ForgeOS orchestrator loop (persistent poll-dispatch process)
- Update root `agents.md` for MCP-only references
- Migration script from filesystem to PostgreSQL
- Integration tests validating zero filesystem references

**Validation:** `grep -r "ticket-state" .github/agents/ .github/instructions/ agents.md` returns 0 matches.

---

## Capability 2: Code Graph Engine (Phase 2 — P0)

**Priority:** CRITICAL — enables architectural awareness and blast radius  
**Summary:** Build an AST-based code graph that maps every file, symbol, import, and dependency in the codebase. Expose blast radius computation and symbol search as MCP tools.  
**Key Deliverables:**
- PostgreSQL migration: `code_files`, `code_symbols`, `code_imports`, `code_dependencies` tables + stored functions
- tree-sitter WASM integration with TS, JS, Python, SQL grammar support
- Indexer service with incremental indexing (SHA-256 hash skip)
- 3 MCP tools: `code.blast_radius`, `code.search_symbols`, `code.get_imports`
- Code graph stored functions for recursive CTE blast radius
- Agent SDK wrappers for code graph tools
- Integration + performance tests (10K files < 60s, blast radius < 500ms)

**Dependencies:** Phase 1 must be complete (agents use MCP exclusively).

---

## Capability 3: Memory Engine (Phase 3 — P1)

**Priority:** HIGH — enables self-healing procedural memory  
**Summary:** Build a procedural memory system using pgvector. Extract lessons from QA rejection→fix cycles, embed as vectors, inject relevant past lessons into future agent dispatches.  
**Key Deliverables:**
- PostgreSQL migration: enable pgvector, create `lessons` + `lesson_embeddings` tables with HNSW index
- Embedding pipeline (OpenAI text-embedding-3-small default, local fallback)
- Reflection Protocol automation (triggered on rework→DONE transition)
- 3 MCP tools: `memory.search_lessons`, `memory.add_lesson`, `memory.get_context`
- Memory injection in orchestrator dispatch (top-5 lessons)
- Agent SDK wrappers for memory tools
- Integration tests + quality validation

**Dependencies:** Phase 1 (MCP events trigger reflection). Phase 2 optional (blast radius enriches lesson context).

---

## Capability 4: Drop-In Initialization (Phase 4 — P1)

**Priority:** HIGH — enables zero-config repo onboarding  
**Summary:** Enable ForgeOS to orient itself in any new repository without manual configuration. Auto-discover tech stack, generate project context, create initial tickets autonomously.  
**Key Deliverables:**
- 2 MCP tools: `init.index`, `init.orient`
- Auto-discovery heuristics (package.json, tsconfig.json, pyproject.toml, etc.)
- Orientation loop: index → analyze → generate productContext → auto-generate tickets
- REST endpoint + SSE events for orientation progress
- Integration + performance tests (orientation < 120s for 10K-file repo)
- Documentation for drop-in usage

**Dependencies:** Phase 2 (indexing) + Phase 3 (context storage in lessons table).
