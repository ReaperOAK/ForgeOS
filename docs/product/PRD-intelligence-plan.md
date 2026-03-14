---
title: "PRD: ForgeOS Intelligence Plan — From Scheduler to Self-Healing Agency"
id: PRD-INTEL-001
type: prd
author: Product Manager
date: 2026-03-12T00:00:00Z
status: DRAFT
priority: P0
audience: Architect, Backend Engineers, DevOps, Frontend Engineers, QA, Human Operators
upstream: .github/agent-output/Research/CTO-intelligence-research.md, docs/architecture/intelligence-architecture.md
tags: [intelligence, code-graph, memory-engine, cutover, pgvector, tree-sitter, mcp, p0]
---

# PRD: ForgeOS Intelligence Plan — From Scheduler to Self-Healing Agency

> **Author:** Product Manager | **Date:** 2026-03-12  
> **Upstream:** Research Analyst gap analysis (`CTO-intelligence-research.md`), Architect design (`intelligence-architecture.md`)  
> **Confidence:** HIGH (88%)

---

## Table of Contents

| # | Section |
|---|---------|
| 1 | [Vision & Goals](#1-vision--goals) |
| 2 | [Problem Statement](#2-problem-statement) |
| 3 | [User Personas](#3-user-personas) |
| 4 | [Feature Requirements](#4-feature-requirements) |
| 5 | [Acceptance Criteria](#5-acceptance-criteria) |
| 6 | [Non-Functional Requirements](#6-non-functional-requirements) |
| 7 | [User Stories](#7-user-stories) |
| 8 | [Out of Scope](#8-out-of-scope) |
| 9 | [Dependencies](#9-dependencies) |
| 10 | [Success Metrics](#10-success-metrics) |
| 11 | [Risks and Mitigations](#11-risks-and-mitigations) |
| 12 | [Assumptions](#12-assumptions) |
| 13 | [Glossary](#13-glossary) |

---

## 1. Vision & Goals

### 1.1 Vision

Transform ForgeOS from a mechanical distributed ticket scheduler into a **conscious, self-healing, fully autonomous developer agency** that understands code structure, learns from its mistakes, and orients itself in any repository without human assistance.

### 1.2 Strategic Goals

| # | Goal | Measurement |
|---|------|-------------|
| G1 | **Eliminate dual-state** — PostgreSQL is the sole source of truth for all ticket state. No agent reads or writes `.github/ticket-state/` directories. | Zero filesystem ticket references in 22 agent/instruction files |
| G2 | **Architectural awareness** — Every agent knows the blast radius of its changes before making them. No blind modifications. | Blast radius computed for 100% of backend/frontend tickets before dispatch |
| G3 | **Procedural memory** — The system never repeats a fixed bug. Past failures are embedded, indexed, and injected into future dispatches. | 90% of rework-cycle lessons captured and retrievable via similarity search |
| G4 | **Zero-config onboarding** — ForgeOS can orient itself in any new repository without human-written configuration files. | New repo orientation completes in < 120 seconds with accurate tech stack detection |

### 1.3 Business Context

ForgeOS has **166+ completed tickets** and a proven PostgreSQL-backed MCP server with 10 operational tools. The scheduling infrastructure works. The next evolution is intelligence — without it, the system executes bad decisions faster. This PRD defines the WHAT; the Architecture document (`docs/architecture/intelligence-architecture.md`) defines the HOW.

---

## 2. Problem Statement

### 2.1 Current State

| # | Problem | Evidence | Cost of Inaction |
|---|---------|----------|-----------------|
| P1 | **Dual source of truth** — Agents read ticket state from both PostgreSQL (via MCP) and the filesystem (`.github/ticket-state/` directories). 73+ filesystem references exist across 22 files. | Research inventory: 14 agent files, 6 instruction files, 1 root config, 1 tickets.py | Race conditions between machines; stale state from failed git pushes; agents making decisions on outdated data |
| P2 | **No architectural awareness** — Agents modify files without knowing what else will break. They rely on grep and context-window-sized guesses. | No blast radius tooling exists; agents discover breakage only at QA stage | Token waste on irrelevant context; cascade failures caught late; rework cycles that could be prevented |
| P3 | **No procedural memory** — When a bug is fixed after QA rejection, the lesson is lost. The same mistake recurs in the same module weeks later. | No lesson storage; `.github/memory-bank/` is append-only markdown without retrieval | Treadmill effect — system fixes bugs but never learns from them; rework rate stays constant instead of declining |
| P4 | **Manual onboarding** — Dropping ForgeOS into a new repo requires human-written `productContext.md`, manual tech stack documentation, and hand-crafted initial tickets. | No auto-discovery; ForgeOS cannot operate without pre-existing `.github/` scaffolding | Limits adoption; every new repo requires hours of manual setup; ForgeOS is not portable |

### 2.2 Business Goal

Deliver four phases of intelligence capabilities that make ForgeOS a self-aware, self-healing agency capable of operating autonomously in any codebase. Phase 1 (Cutover) and Phase 2 (Code Graph) are **P0** (required for operational integrity). Phase 3 (Memory) and Phase 4 (Drop-In Init) are **P1** (required for full autonomy).

---

## 3. User Personas

### 3.1 ForgeOS Orchestrator (The System Itself)

| Attribute | Detail |
|-----------|--------|
| **Who** | The ForgeOS orchestration loop — a persistent process that polls for READY tickets, dispatches agents, and monitors progress |
| **Goal** | Execute the SDLC pipeline with maximum efficiency, minimum rework, and zero human intervention |
| **Needs** | Sole source of truth for ticket state (no filesystem); blast radius data before dispatch; past failure lessons to inject into agent context; auto-orientation capability for new repos |
| **Pain point** | Currently operates as a stateless dispatcher with no memory and no architectural awareness; dispatches agents blind |
| **Interface** | PostgreSQL (read/write), MCP Server (tool execution), Agent subprocesses (dispatch) |

### 3.2 AI Agents (Backend, Frontend, QA, Security, etc.)

| Attribute | Detail |
|-----------|--------|
| **Who** | 14 autonomous LLM-based coding agents, each specialized for a specific SDLC stage |
| **Goal** | Complete assigned tickets with high-quality code, tests, and documentation |
| **Needs** | Clear ticket payload via MCP (not filesystem); blast radius of files they're modifying; relevant past lessons injected into their context; symbol search across the codebase |
| **Pain point** | Currently read ticket JSON from filesystem (fragile, stale); waste tokens on irrelevant context; repeat past mistakes because no memory exists |
| **Interface** | MCP JSON-RPC over Streamable HTTP (`POST /mcp`); Agent SDK (Python) |

### 3.3 Human Operators (Developers Using the System)

| Attribute | Detail |
|-----------|--------|
| **Who** | Software engineers who configure, monitor, and occasionally intervene in ForgeOS operations |
| **Goal** | Monitor system health; understand agent decisions; override when needed; onboard new repositories |
| **Needs** | Dashboard visibility into code graph and memory engine; ability to trigger manual indexing; view blast radius for planned changes; review and curate lessons |
| **Pain point** | No visibility into agent reasoning; manual repo onboarding is tedious; cannot predict what files an agent will touch |
| **Interface** | Next.js Dashboard (`dashboard/`); REST API (`/api/*`); SSE event stream (`/events`); CLI |

---

## 4. Feature Requirements

### 4.1 P0: Phase 1 — MCP-Only Cutover (Burn the Boats)

**Summary:** Permanently sever all agent dependencies on the filesystem for ticket state. Agents interact exclusively with the MCP server for ticket lifecycle operations. The ForgeOS orchestrator replaces the stateless ForgeOS dispatcher.

| Feature ID | Feature | Description |
|-----------|---------|-------------|
| F1.1 | `tickets.get` MCP tool | Read a specific ticket by its human-readable ID. Returns the full ticket object with all metadata. Replaces reading `.github/tickets/{id}.json`. |
| F1.2 | `tickets.list` MCP tool | List tickets with filters (stage, status, type, project). Paginated results. Replaces scanning `.github/ticket-state/STAGE/` directories. |
| F1.3 | `tickets.payload` MCP tool | Get the full dispatch payload for an agent: ticket + upstream summary + injected memory lessons + blast radius. Replaces reading `.github/agent-output/{Agent}/{id}.md`. |
| F1.4 | Agent file rewrite (14 files) | Rewrite all 14 `.github/agents/*.agent.md` files to remove filesystem ticket references. Boot sequence uses MCP tool calls exclusively. |
| F1.5 | Instruction file rewrite (6 files) | Rewrite 6 `.github/instructions/*.instructions.md` files. Remove "state = directory location" rules. Replace with "state = PostgreSQL `status` + `stage` columns". |
| F1.6 | Root config rewrite | Update `agents.md` to remove filesystem references from boot sequence and dispatcher scan logic. |
| F1.7 | ForgeOS orchestrator loop | Persistent orchestration process: poll READY tickets every 10s, determine target agent, check agent availability, inject context, dispatch agent subprocess. |
| F1.8 | `tickets.py` deprecation | Remove `tickets.py` from agent toolchain. Retain as CLI diagnostic tool for human operators only. |

**Complexity:** Simple — pure documentation rewrite for F1.4–F1.6; 3 new MCP tools for F1.1–F1.3; orchestrator loop for F1.7.  
**Confidence:** HIGH (95%)

### 4.2 P0: Phase 2 — Code Graph Engine (The Cognition Engine)

**Summary:** Build an AST-based code graph that maps every file, symbol, import, and dependency in the codebase. Expose blast radius computation and symbol search as MCP tools. Agents gain instant architectural awareness.

| Feature ID | Feature | Description |
|-----------|---------|-------------|
| F2.1 | Code graph PostgreSQL schema | New tables: `code_files`, `code_symbols`, `code_imports`, `code_dependencies`. Multi-repo support via `project_id` FK. Enums: `symbol_kind`, `dependency_type`. |
| F2.2 | tree-sitter WASM integration | Integrate `web-tree-sitter` (WASM bindings) for AST parsing. Support TypeScript, JavaScript, Python, SQL, Markdown. |
| F2.3 | Indexer Agent | New specialized agent (#15) that walks the file tree, computes SHA-256 hashes for incremental indexing, parses ASTs, extracts symbols/imports/dependencies, stores in PostgreSQL via batch INSERT. |
| F2.4 | Incremental indexing | Skip unchanged files (hash comparison). Only re-parse files whose `content_hash` differs. Target: < 5s for 10 changed files. |
| F2.5 | `code.blast_radius` MCP tool | Compute the blast radius of changes to a file. Recursive CTE traversal of `code_dependencies`. Returns affected files, symbols, test files, ordered by dependency depth. |
| F2.6 | `code.search_symbols` MCP tool | Search for code symbols (functions, classes, methods) by name across the project. Filter by kind, language. |
| F2.7 | `code.get_imports` MCP tool | Get the import/dependency chain for a file. Shows what the file imports, recursively. |
| F2.8 | Stored functions | PostgreSQL stored functions: `blast_radius()`, `search_symbols()`, `get_import_chain()`. Wrapped as atomic SQL operations. |

**Complexity:** Medium — tree-sitter integration, per-language import resolution (~500 LOC/language), recursive CTE design.  
**Confidence:** HIGH (88%)

### 4.3 P1: Phase 3 — Memory Engine (Self-Healing)

**Summary:** Build a procedural memory system using pgvector. Extract lessons from QA rejection→fix cycles, embed them as vectors, and inject relevant past lessons into future agent dispatches. The system becomes permanently immune to past mistakes.

| Feature ID | Feature | Description |
|-----------|---------|-------------|
| F3.1 | pgvector extension setup | Enable `pgvector` extension in PostgreSQL. Add `vector(1536)` column support. |
| F3.2 | Memory engine PostgreSQL schema | New tables: `lessons`, `lesson_embeddings`. HNSW index for approximate nearest neighbor search. Stored function: `search_similar_lessons()`. |
| F3.3 | Reflection Protocol | Automatic trigger when `rework_count > 0` ticket reaches DONE. Pipeline: extract rejection events → diff failed vs fixed code → LLM-summarize lesson → embed → store. |
| F3.4 | Embedding service integration | Integrate embedding API (default: OpenAI `text-embedding-3-small` 1536d; recommended upgrade: `voyage-code-3` 1024d). Configurable fallback to local model (Nomic Embed Code). |
| F3.5 | `memory.search_lessons` MCP tool | Semantic similarity search over past lessons. Filter by project, file paths, agent role. Minimum similarity threshold. |
| F3.6 | `memory.add_lesson` MCP tool | Manually add a lesson to the memory engine. Lesson text is embedded and stored. |
| F3.7 | `memory.get_context` MCP tool | Get contextual memory for a ticket dispatch. Combines semantic search + file path matching + role filtering. Returns formatted lessons ready for prompt injection. |
| F3.8 | Memory injection in dispatch | ForgeOS orchestrator queries relevant lessons before dispatching each agent. Top 5 lessons injected as `## Past Lessons (auto-injected)` section in agent prompt. |

**Complexity:** Complex — pgvector setup, embedding API integration, LLM lesson extraction, prompt injection framework.  
**Confidence:** MEDIUM (75%)

### 4.4 P1: Phase 4 — Drop-In Initialization (Zero-Config Onboarding)

**Summary:** Enable ForgeOS to orient itself in any new repository without manual configuration. Auto-discover tech stack, generate project context, and create initial tickets — all autonomously.

| Feature ID | Feature | Description |
|-----------|---------|-------------|
| F4.1 | `init.index` MCP tool | Trigger full or incremental code index for a project. Returns files indexed, symbols found, imports resolved, duration. |
| F4.2 | `init.orient` MCP tool | Auto-discover project tech stack, frameworks, entry points, test frameworks, CI/CD config from the code graph. Store as `productContext` in the lessons table. |
| F4.3 | Auto-discovery heuristics | Detect: `package.json` (Node.js), `tsconfig.json` (TypeScript), `pyproject.toml` (Python), `go.mod` (Go), `Cargo.toml` (Rust), `Dockerfile` (containers), `.github/workflows/` (CI/CD). |
| F4.4 | Auto-ticket generation | TODO Agent reads the auto-generated `productContext`, identifies gaps (missing tests, missing docs, security issues), and generates L3 tickets in READY status with auto-resolved dependencies. |
| F4.5 | Orientation progress API | REST endpoint and SSE events for indexing/orientation progress tracking. |

**Complexity:** Medium — composition of Phase 2 (indexing) + Phase 3 (context storage). No new fundamental technology.  
**Confidence:** HIGH (85%)

---

## 5. Acceptance Criteria

### 5.1 Phase 1 — MCP-Only Cutover

| AC ID | Criterion | Verification |
|-------|-----------|-------------|
| AC-1.1 | **Given** a ticket ID, **when** an agent calls `tickets.get`, **then** the MCP server returns the full ticket object with title, description, acceptance criteria, file_paths, and metadata — no filesystem read required. | Integration test: call `tickets.get` → validate all fields present |
| AC-1.2 | **Given** a stage filter, **when** an agent calls `tickets.list(stage='READY')`, **then** the server returns all READY tickets ordered by priority DESC, created_at ASC — matching what `tickets.py --status --json` returns. | Integration test: seed 5 tickets across stages → verify filtered list matches expected |
| AC-1.3 | **Given** a ticket ID and agent role, **when** an agent calls `tickets.payload`, **then** the server returns the ticket + upstream agent summary + relevant memory lessons (if Phase 3 is active) + blast radius (if Phase 2 is active). | Integration test: verify payload composition |
| AC-1.4 | **Given** all 14 agent files after rewrite, **when** `grep -r "ticket-state" .github/agents/` is run, **then** zero matches are found. | CI check: grep returns exit code 1 (no matches) |
| AC-1.5 | **Given** all 6 instruction files after rewrite, **when** `grep -r "ticket-state" .github/instructions/` is run, **then** zero matches are found. | CI check: grep returns exit code 1 (no matches) |
| AC-1.6 | **Given** the updated `agents.md`, **when** `grep "ticket-state" agents.md` is run, **then** zero matches are found. | CI check |
| AC-1.7 | **Given** the ForgeOS orchestrator loop is running, **when** a ticket's dependencies are all DONE, **then** the orchestrator detects it as READY within 10 seconds and dispatches the correct agent type. | Integration test: create ticket with met deps → verify dispatch within 10s |
| AC-1.8 | **Given** an agent completes a ticket via `tickets.complete`, **then** the agent's git commit contains ONLY code artifacts — no `.github/ticket-state/` files are staged. | CI check: verify commit diff |

### 5.2 Phase 2 — Code Graph Engine

| AC ID | Criterion | Verification |
|-------|-----------|-------------|
| AC-2.1 | **Given** a TypeScript file with 3 exported functions, **when** the Indexer Agent processes it, **then** `code_files` contains one row and `code_symbols` contains 3 rows with correct `name`, `kind`, `start_line`, `end_line`. | Unit test: parse known fixture → verify DB rows |
| AC-2.2 | **Given** file A imports symbol X from file B, **when** both files are indexed, **then** `code_imports` contains a row linking A→B and `code_dependencies` contains a row with `dep_type = 'imports'`. | Unit test: index two-file fixture → verify import resolution |
| AC-2.3 | **Given** a 10K-file repository, **when** full indexing is triggered, **then** indexing completes in < 60 seconds. | Performance test: benchmark against a synthetic 10K-file repo |
| AC-2.4 | **Given** 10 changed files in a previously indexed repo, **when** incremental indexing is triggered, **then** only the 10 changed files are re-parsed (hash-based skip) and indexing completes in < 5 seconds. | Performance test: modify 10 files → verify only 10 re-parsed |
| AC-2.5 | **Given** file `src/auth/login.ts` is modified and it is imported by 5 other files, **when** `code.blast_radius("src/auth/login.ts")` is called, **then** those 5 files appear in the result with correct depth values. Query completes in < 500ms. | Integration test: seed known dependency graph → verify blast radius output + timing |
| AC-2.6 | **Given** a project with 500 functions, **when** `code.search_symbols(query="handle")` is called, **then** all symbols containing "handle" are returned, exact matches first, exported symbols prioritized. | Integration test: seed symbols → verify ordering |
| AC-2.7 | **Given** a file with 3 direct imports, **when** `code.get_imports` is called with `max_depth=2`, **then** the response includes direct imports (depth 1) and transitive imports (depth 2). | Unit test |

### 5.3 Phase 3 — Memory Engine

| AC ID | Criterion | Verification |
|-------|-----------|-------------|
| AC-3.1 | **Given** pgvector is installed, **when** `SELECT vector_version()` is run, **then** it returns a version >= 0.7.0. | Migration test |
| AC-3.2 | **Given** a ticket transitions from QA (with rework_count > 0) to DONE, **when** the Reflection Protocol fires, **then** a new row is inserted into `lessons` with `failure_pattern`, `solution_pattern`, and `principle` fields populated. | Integration test: simulate rejection→fix→complete cycle → verify lesson row |
| AC-3.3 | **Given** a lesson is created, **when** its embedding is stored, **then** `lesson_embeddings` contains a row with a non-null `vector(1536)` embedding and the correct `model` identifier. | Integration test: verify embedding row |
| AC-3.4 | **Given** 100 stored lessons, **when** `memory.search_lessons` is called with a query about "JWT validation", **then** lessons related to authentication and token handling rank highest by cosine similarity, and the query completes in < 200ms. | Integration test + performance test |
| AC-3.5 | **Given** a ticket for modifying `src/auth/login.ts`, **when** `memory.get_context` is called, **then** lessons tagged with `src/auth/login.ts` in their `file_paths` array are included in results. | Integration test: seed lessons with file_paths → verify filtering |
| AC-3.6 | **Given** the ForgeOS orchestrator dispatches an agent, **when** relevant lessons exist for the ticket's file scope, **then** the agent's context includes a `## Past Lessons (auto-injected)` section with up to 5 lessons. | Integration test: verify prompt injection format |

### 5.4 Phase 4 — Drop-In Initialization

| AC ID | Criterion | Verification |
|-------|-----------|-------------|
| AC-4.1 | **Given** a fresh repository with `package.json`, `tsconfig.json`, and `src/` directory, **when** `init.index` is called, **then** all source files are indexed and the return includes `files_indexed`, `symbols_found`, `imports_resolved`, `duration_ms`. | Integration test |
| AC-4.2 | **Given** a fully indexed repository, **when** `init.orient` is called, **then** the response correctly identifies the tech stack (Node.js + TypeScript), frameworks (Express/Next.js), test framework (Jest/Vitest), and CI/CD presence. | Integration test against known repos |
| AC-4.3 | **Given** orientation is complete, **when** the TODO Agent reads the generated `productContext`, **then** it generates at least one L3 ticket identifying a real gap (missing test, missing doc, or security issue). | Integration test: verify generated tickets exist in READY state |
| AC-4.4 | **Given** a 10K-file repository, **when** the full orientation sequence runs (index → analyze → generate), **then** total elapsed time is < 120 seconds. | Performance test |

---

## 6. Non-Functional Requirements

### 6.1 Performance

| NFR ID | Requirement | Target | Measurement |
|--------|-------------|--------|-------------|
| NFR-P1 | AST indexing throughput | Full index of 10K files < 60 seconds | End-to-end benchmark: trigger `init.index` → measure duration_ms |
| NFR-P2 | Incremental indexing throughput | Re-index 10 changed files < 5 seconds | Benchmark: modify 10 files → measure delta index time |
| NFR-P3 | Blast radius query latency | < 500ms p99 | PostgreSQL `EXPLAIN ANALYZE` on recursive CTE with 10K files / 50K edges |
| NFR-P4 | Symbol search latency | < 100ms p99 | `EXPLAIN ANALYZE` on ILIKE query against indexed `code_symbols` table |
| NFR-P5 | Vector similarity search latency | < 200ms p99 for ≤ 100K embeddings | pgvector HNSW index scan with `ef_search = 40` |
| NFR-P6 | Ticket claim MCP latency | < 50ms p99 | MCP tool response time measurement |
| NFR-P7 | Memory injection latency | Top-5 lesson retrieval + format < 500ms | End-to-end: embed query → HNSW search → format response |
| NFR-P8 | Orientation total time | < 120 seconds for new repo | End-to-end: `init.index` + `init.orient` combined |

### 6.2 Reliability

| NFR ID | Requirement | Target | Mechanism |
|--------|-------------|--------|-----------|
| NFR-R1 | No data loss on crash | Zero ticket state loss on MCP server restart | PostgreSQL ACID transactions; WAL-based recovery |
| NFR-R2 | Indexing fault tolerance | Partial index is valid; can resume from any file | Per-file transaction boundaries; hash-based skip on restart |
| NFR-R3 | Embedding API failure | Graceful degradation — lesson stored without embedding; retry on next cycle | Try/catch on embedding call; `embedded: false` flag in DB |
| NFR-R4 | MCP server availability | Agents retry on connection failure; exponential backoff | Agent SDK heartbeat + fallback (already implemented) |

### 6.3 Security

| NFR ID | Requirement | Target | Mechanism |
|--------|-------------|--------|-----------|
| NFR-S1 | No secrets in code graph | Code graph stores structure only, not source content | `code_symbols` stores names/signatures only — no function bodies |
| NFR-S2 | Embedding access control | Lessons are scoped to project_id; cross-project queries blocked | Row-level filtering via `WHERE project_id = $1` in all queries |
| NFR-S3 | Embedding API key protection | API keys (OpenAI / Voyage) stored as environment variables, never in code or DB | `.env` + Docker secrets; CI check for hardcoded keys |
| NFR-S4 | Agent authentication | All MCP tool calls require valid API key | Existing auth middleware (already implemented) |

### 6.4 Scalability

| NFR ID | Requirement | Target | Mechanism |
|--------|-------------|--------|-----------|
| NFR-SC1 | Multi-repo support | Multiple projects indexed in single PostgreSQL instance | `project_id` foreign key on all new tables; `UNIQUE(project_id, path)` constraint |
| NFR-SC2 | Code graph growth | Support up to 100K files / 1M symbols per project | B-tree indexes on all FKs; EXPLAIN ANALYZE validation |
| NFR-SC3 | Lesson corpus growth | Support up to 100K lessons per project | HNSW index with scalar quantization (pgvector 0.7+) |
| NFR-SC4 | Concurrent indexing | Multiple projects indexed simultaneously | Per-project file-level mutex (existing pattern in ForgeOS) |

### 6.5 Observability

| NFR ID | Requirement | Target | Mechanism |
|--------|-------------|--------|-----------|
| NFR-O1 | Index events | Dashboard shows indexing status in real-time | SSE events: `INDEX_STARTED`, `INDEX_COMPLETED` |
| NFR-O2 | Lesson events | Dashboard shows new lessons as they are created | SSE event: `LESSON_CREATED` |
| NFR-O3 | Blast radius visibility | Dashboard shows blast radius for any file on demand | REST API: `GET /api/code/blast-radius?path=...` |

---

## 7. User Stories

### 7.1 Phase 1 Stories

**US-1.1: Agent reads ticket via MCP**
> **As an** AI Agent, **I want** to retrieve my assigned ticket's full payload via a single MCP tool call, **so that** I don't need to read JSON files from the filesystem.

Acceptance criteria:
- **Given** an agent is dispatched with `ticket_id=FORGEOS-BE100`, **when** it calls `tickets.get("FORGEOS-BE100")`, **then** the response contains `title`, `description`, `acceptance_criteria`, `file_paths`, `metadata`, and `stage`.
- **Given** an agent calls `tickets.get` with a non-existent ID, **then** the response contains error code `NOT_FOUND`.

**US-1.2: Agent lists available tickets**
> **As an** AI Agent, **I want** to list all READY tickets filtered by stage, **so that** I can find work relevant to my role.

Acceptance criteria:
- **Given** 3 tickets in READY and 2 in BACKEND, **when** an agent calls `tickets.list(stage='READY')`, **then** exactly 3 tickets are returned.
- **Given** `limit=2, offset=0`, **then** the response includes `total: 3` and returns 2 results with correct pagination.

**US-1.3: Orchestrator dispatches agents**
> **As the** ForgeOS Orchestrator, **I want** a persistent loop that polls READY tickets and dispatches the correct agent type, **so that** no human intervention is required for ticket routing.

Acceptance criteria:
- **Given** a `BACKEND` ticket enters READY, **when** the orchestrator polls, **then** it dispatches the Backend Agent within 10 seconds.
- **Given** no READY tickets exist, **then** the orchestrator waits and re-polls without error.

**US-1.4: Human operator verifies cutover**
> **As a** Human Operator, **I want** to verify that no agent file references `.github/ticket-state/`, **so that** I can confirm the filesystem severance is complete.

Acceptance criteria:
- **Given** the cutover is complete, **when** `grep -r "ticket-state" .github/agents/ .github/instructions/ agents.md` is run, **then** the exit code is 1 (no matches).

### 7.2 Phase 2 Stories

**US-2.1: Agent checks blast radius before editing**
> **As an** AI Agent, **I want** to know every file and test that will be affected by my changes, **so that** I can proactively update dependents and avoid cascade failures.

Acceptance criteria:
- **Given** `src/auth/login.ts` is imported by `src/api/routes.ts` and tested by `src/__tests__/auth.test.ts`, **when** the agent calls `code.blast_radius("src/auth/login.ts")`, **then** the response includes both files with `depth: 1`.
- **Given** transitive dependency A→B→C, **when** blast radius is called on A with `max_depth=2`, **then** C appears with `depth: 2`.

**US-2.2: Agent searches for symbols**
> **As an** AI Agent, **I want** to search for functions and classes by name across the entire project, **so that** I can navigate the codebase without wasting tokens on grep.

Acceptance criteria:
- **Given** 3 functions named `handleAuth`, `handleLogin`, `handleLogout`, **when** the agent calls `code.search_symbols(query="handle")`, **then** all 3 appear in results.

**US-2.3: Human operator triggers indexing**
> **As a** Human Operator, **I want** to trigger a full codebase re-index from the dashboard, **so that** I can refresh the code graph after major refactors.

Acceptance criteria:
- **Given** the dashboard has an "Index" button, **when** clicked, **then** `init.index` is called and a progress indicator shows until completion.

### 7.3 Phase 3 Stories

**US-3.1: System learns from QA rejections**
> **As the** ForgeOS Orchestrator, **I want** to automatically extract a lesson when a rejected ticket is eventually fixed, **so that** the system builds procedural memory from failures.

Acceptance criteria:
- **Given** ticket FORGEOS-BE090 was rejected by QA for missing input validation, then fixed and completed, **when** the ticket reaches DONE with `rework_count=1`, **then** a lesson is created with `failure_pattern` describing the missing validation and `principle` stating the corrective rule.

**US-3.2: Agent receives injected lessons**
> **As an** AI Agent, **I want** relevant past lessons automatically injected into my context when I'm dispatched, **so that** I avoid repeating known mistakes.

Acceptance criteria:
- **Given** a lesson exists about JWT validation in `src/auth/`, **when** a new ticket assigns the agent to modify `src/auth/login.ts`, **then** the agent's context includes `## Past Lessons (auto-injected)` with the JWT lesson.

**US-3.3: Human operator browses lessons**
> **As a** Human Operator, **I want** to view, search, and curate lessons from the dashboard, **so that** I can ensure the memory engine contains high-quality knowledge.

Acceptance criteria:
- **Given** the dashboard has a "Memory" tab, **when** the operator searches for "authentication", **then** all lessons related to auth are displayed with similarity scores.

### 7.4 Phase 4 Stories

**US-4.1: Zero-config repo onboarding**
> **As the** ForgeOS Orchestrator, **I want** to orient myself in a brand-new repository without any pre-written configuration, **so that** I can start generating tickets autonomously.

Acceptance criteria:
- **Given** a fresh Next.js repository with no `.github/` directory, **when** `init.orient` is called, **then** the system correctly identifies: TypeScript, Next.js, React, Jest, and Dockerfile.
- **Given** orientation is complete, **then** the TODO Agent generates at least 3 actionable L3 tickets.

---

## 8. Out of Scope

The following are explicitly **excluded** from this PRD:

| # | Item | Reason |
|---|------|--------|
| OS-1 | **Real-time collaborative editing** (multiplayer code editing) | Not related to intelligence; separate product concern |
| OS-2 | **Custom LLM hosting** (self-hosted language models) | Use API-based models; self-hosting is an infrastructure decision outside this scope |
| OS-3 | **Source code storage in code graph** | Code graph stores structure (names, signatures, line numbers) only — not function bodies or source content. Security and storage constraint. |
| OS-4 | **Cross-project lesson sharing** | Lessons are scoped to `project_id`. Cross-project knowledge transfer is a future enhancement. |
| OS-5 | **GUI-based ticket management** | Dashboard shows ticket state read-only. Ticket creation/modification remains MCP/CLI-only. |
| OS-6 | **Support for compiled languages** (Java, C++, Rust) | Initial support covers TypeScript, JavaScript, Python, SQL, Markdown. Additional languages are future extensions. |
| OS-7 | **Agent-to-agent direct communication** | Agents communicate exclusively through ticket state transitions and summary handoff files, not peer-to-peer messaging. |
| OS-8 | **Automated deployment** | ForgeOS manages development lifecycle only. Deployment to production environments is excluded. |
| OS-9 | **Fine-grained code graph diffing** (AST-level diffs between commits) | Blast radius uses import/dependency graph, not AST comparison. AST diffing (e.g., GumTree) is a future enhancement. |
| OS-10 | **`tickets.py` removal** | `tickets.py` is deprecated from agent toolchain but retained as a CLI diagnostic tool. Full removal is a future cleanup task. |

---

## 9. Dependencies

### 9.1 Phase Dependencies (Internal)

```
Phase 1 (Cutover) ─────────┬──────────────────────────────────────────────────►
                            │
Phase 2 (Code Graph) ──────┼──► Requires Phase 1 (MCP-only workflow for clean agent boot)
                            │
Phase 3 (Memory Engine) ────┼──► Requires Phase 1 (MCP event triggers for reflection)
                            │    Phase 2 optional (blast radius enhances lesson context)
                            │
Phase 4 (Drop-In Init) ─────┴──► Requires Phase 2 (indexing) + Phase 3 (context storage)
```

| Dependency | From | To | Type | Notes |
|-----------|------|-----|------|-------|
| MCP-only workflow | Phase 1 | Phase 2 | Hard | Code graph tools assume agents use MCP exclusively |
| MCP-only workflow | Phase 1 | Phase 3 | Hard | Reflection Protocol triggers from MCP event table |
| Indexing capability | Phase 2 | Phase 4 | Hard | `init.index` is a Phase 2 tool |
| Memory capability | Phase 3 | Phase 4 | Hard | `init.orient` stores context as a lesson |
| Code graph schema | Phase 2 | Phase 3 | Soft | Blast radius data enriches lesson context (optional) |

### 9.2 External Dependencies

| Dependency | Phase | Required | Fallback |
|-----------|-------|----------|----------|
| PostgreSQL 14+ | All | Yes | Already deployed; part of existing infrastructure |
| `web-tree-sitter` (npm) | Phase 2 | Yes | `node-tree-sitter` (native C, higher performance but segfault risk) |
| tree-sitter language grammars (TS, Python, SQL) | Phase 2 | Yes | Official upstream grammars; community grammar for SQL |
| pgvector extension (0.7+) | Phase 3 | Yes | Run `CREATE EXTENSION IF NOT EXISTS vector;` in existing PostgreSQL |
| Embedding API (OpenAI / Voyage / local) | Phase 3 | Yes | `text-embedding-3-small` (default); `voyage-code-3` (recommended); Nomic Embed Code (self-hosted fallback) |
| LLM API (for lesson extraction) | Phase 3 | Yes | Any OpenAI-compatible API; used for summarizing diffs into first-principle lessons |

### 9.3 Infrastructure Dependencies

| Component | Current State | Required Change |
|-----------|--------------|-----------------|
| ForgeOS MCP Server (`forgeos-server/`) | Running, 10 tools operational | Add 3 tools (Phase 1), 3 tools (Phase 2), 3 tools (Phase 3), 2 tools (Phase 4) |
| PostgreSQL | Running, migration 001 applied | Apply migration 002 (code graph), 003 (memory engine), 004 (stored functions) |
| Agent SDK (`agent-sdk/`) | Running, wraps 10 MCP tools | Add wrappers for 11 new tools |
| Dashboard (`dashboard/`) | Running, Kanban board | Add Code Graph panel, Memory panel, Orientation panel |
| Docker Compose | Running | Add pgvector to PostgreSQL image; update env vars for embedding API |

---

## 10. Success Metrics

### 10.1 Phase 1 — Cutover KPIs

| Metric | Baseline (Before) | Target (After) | Measurement Method |
|--------|-------------------|----------------|-------------------|
| Filesystem ticket references | 73+ across 22 files | **0** | `grep -r "ticket-state" .github/agents/ .github/instructions/ agents.md \| wc -l` |
| Agent boot reliability | Variable (stale JSON, race conditions) | **100%** (all agents boot via MCP) | MCP server logs: successful `tickets.get` calls / total dispatch |
| Ticket state consistency | Dual (filesystem + DB can diverge) | **Single** (PostgreSQL only) | Architectural audit: zero filesystem state paths |
| Orchestrator dispatch latency | N/A (manual dispatcher) | **< 10s** from READY to dispatched | Timer from `resolve_dependencies()` to agent launch |

### 10.2 Phase 2 — Code Graph KPIs

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Agent architectural awareness | None (grep-based guessing) | **100%** of backend/frontend tickets have blast radius computed | MCP log: `code.blast_radius` calls before `tickets.complete` |
| Rework due to cascade failures | ~15% of rework cycles (estimated) | **< 5%** | Compare rework reasons: "broke dependent file" before/after |
| Token efficiency | Agents read entire files for context | **50% reduction** in context tokens per ticket | Measure prompt token count before/after blast radius integration |
| Full index time (10K files) | N/A | **< 60s** | Benchmark test |
| Blast radius query time | N/A | **< 500ms p99** | `EXPLAIN ANALYZE` |

### 10.3 Phase 3 — Memory Engine KPIs

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Lesson capture rate | 0% (no memory system) | **≥ 90%** of rework→fix cycles produce a lesson | COUNT(lessons) / COUNT(tickets WHERE rework_count > 0 AND status = 'DONE') |
| Lesson relevance | N/A | **≥ 75%** average cosine similarity for top-5 results | Sample 50 queries → measure average similarity of top results |
| Repeat-bug reduction | Unknown baseline | **≥ 30%** reduction in same-module rework within 90 days | Track rework_count by file_path intersection over time |
| Similarity search latency | N/A | **< 200ms p99** | pgvector HNSW query timing |

### 10.4 Phase 4 — Drop-In Initialization KPIs

| Metric | Baseline | Target | Measurement |
|--------|----------|--------|-------------|
| Time to first ticket (new repo) | Hours (manual setup) | **< 3 minutes** (index + orient + generate) | End to end: clone repo → first L3 ticket in READY |
| Tech stack detection accuracy | N/A | **≥ 95%** for supported languages/frameworks | Test against 20 known open-source repos |
| Orientation total time | N/A | **< 120s** for 10K-file repo | Benchmark |

---

## 11. Risks and Mitigations

| # | Risk | Phase | Likelihood | Impact | Mitigation |
|---|------|-------|-----------|--------|-----------|
| R1 | **Agent prompt confusion** — Agents retain muscle memory for filesystem operations despite rewrite | 1 | HIGH | MEDIUM | Atomic rewrite of all 22 files. CI grep check blocks merge if any `ticket-state` reference remains. Test with one agent first (Backend). |
| R2 | **MCP server as single point of failure** — All agents depend on MCP server uptime | 1 | MEDIUM | HIGH | Agent SDK already has heartbeat + retry with exponential backoff. Add health check endpoint monitoring. Implement read replicas for query-heavy tools. |
| R3 | **Language-specific AST traversers** — tree-sitter provides parse trees, not dependency graphs. ForgeOS must write import/call resolution per language. | 2 | HIGH | MEDIUM | Start with TypeScript only (most critical). Budget ~500 LOC per additional language. Use `web-tree-sitter` WASM for stability. |
| R4 | **tree-sitter WASM performance at scale** — WASM is 3x slower than native; may hit limits on very large files. | 2 | LOW | LOW | Research shows WASM handles ~9K lines reliably. Average file is ~200 lines. Risk is negligible for ForgeOS's codebase sizes. |
| R5 | **Embedding model lock-in** — Changing embedding models requires re-embedding all lessons. | 3 | MEDIUM | MEDIUM | Store raw lesson text alongside vectors. Re-embedding is a batch operation: `SELECT id, text FROM lessons` → re-embed → `UPDATE lesson_embeddings`. |
| R6 | **LLM lesson extraction quality** — Bad lessons contaminate future agent prompts. | 3 | MEDIUM | HIGH | Human review of first 50 lessons to calibrate quality. Implement lesson quality scoring. Add "confirm lesson" flag for human-validated lessons. |
| R7 | **External embedding API dependency** — `voyage-code-3` or OpenAI API outage blocks lesson creation. | 3 | LOW | MEDIUM | Fallback to self-hosted Nomic Embed Code (MIT license). Store lessons without embeddings on API failure; retry asynchronously. |
| R8 | **Cold start performance** — Full AST index of a large repo may take > 60 seconds. First-time users expect faster orientation. | 4 | MEDIUM | LOW | Show indexing progress in real-time (SSE events). Index high-value files first (package.json, entry points). Parallelize file parsing. |
| R9 | **SQL grammar maturity** — SQL tree-sitter grammar is community-maintained, not upstream. | 2 | LOW | LOW | ForgeOS SQL files are structurally simple (migrations). DerekStride/tree-sitter-sql is the most active community grammar. |

---

## 12. Assumptions

| # | Assumption | Validation Status | Risk if Wrong |
|---|-----------|-------------------|---------------|
| A1 | PostgreSQL 14+ is deployed and operational | **VALIDATED** — PostgreSQL is running with migration 001 applied | Blocker for all phases |
| A2 | All 10 existing MCP tools are functional and backward-compatible | **VALIDATED** — 166+ tickets completed through MCP pipeline | New tools must not break existing ones |
| A3 | `web-tree-sitter` (WASM) is stable enough for batch indexing | **PARTIALLY VALIDATED** — Research confirms stability for files up to 9K lines; production use in Pulsar editor | PoC needed for ForgeOS-specific workload |
| A4 | pgvector 0.7+ can be added to existing PostgreSQL without schema conflicts | **VALIDATED** — Research confirms additive-only installation; no conflicts with uuid-ossp or pgcrypto | Migration test needed |
| A5 | OpenAI `text-embedding-3-small` provides adequate quality for code lessons | **ASSUMED** — General-purpose model; code-specific models (voyage-code-3) are better but require separate API | Measure retrieval quality on first 50 lessons; switch to voyage-code-3 if quality < 75% recall |
| A6 | LLM summarization produces usable first-principle lessons from code diffs | **ASSUMED** — Common pattern in reflection architectures, but quality depends on prompt engineering | Manual review of first 50 lessons; iterate on extraction prompt |
| A7 | Agent SDK Python wrapper will be extended for new tools | **VALIDATED** — SDK architecture supports adding new tool wrappers | Straightforward implementation |
| A8 | Dashboard team can add new panels for Code Graph and Memory | **VALIDATED** — Next.js dashboard architecture supports new routes/components | Standard frontend work |

---

## 13. Glossary

| Term | Definition |
|------|-----------|
| **AST** | Abstract Syntax Tree — a tree representation of the syntactic structure of source code, produced by tree-sitter |
| **Blast radius** | The set of all files, symbols, and tests that would be affected by changes to a given file |
| **Code graph** | A directed graph of files, symbols, imports, and dependencies stored in PostgreSQL |
| **Cutover** | The one-time migration from filesystem-based ticket state to MCP-only ticket state |
| **HNSW** | Hierarchical Navigable Small World — a graph-based algorithm for approximate nearest neighbor search, used by pgvector |
| **Incremental indexing** | Re-indexing only files whose content hash has changed since the last index run |
| **Lesson** | A distilled first-principle insight extracted from a QA rejection→fix cycle, stored as text + vector embedding |
| **MCP** | Model Context Protocol — the JSON-RPC protocol used for agent↔server communication |
| **Orchestrator** | The ForgeOS orchestration loop that polls for READY tickets and dispatches agents (replaces the stateless dispatcher) |
| **pgvector** | PostgreSQL extension for vector similarity search using HNSW and IVFFlat indexes |
| **Reflection Protocol** | The automatic pipeline that fires when a reworked ticket reaches DONE, extracting and embedding a lesson |
| **tree-sitter** | An incremental parsing system that builds concrete syntax trees for source files |
| **voyage-code-3** | A code-specialized embedding model from Voyage AI, recommended for code similarity search |

---

## Appendix A: Feature Priority Matrix

| Feature ID | Feature | Priority | Phase | Complexity | Confidence | Dependencies |
|-----------|---------|----------|-------|-----------|-----------|-------------|
| F1.1 | `tickets.get` tool | P0 | 1 | Simple | 95% | None |
| F1.2 | `tickets.list` tool | P0 | 1 | Simple | 95% | None |
| F1.3 | `tickets.payload` tool | P0 | 1 | Simple | 95% | None |
| F1.4 | Agent file rewrite | P0 | 1 | Simple | 95% | F1.1, F1.2, F1.3 |
| F1.5 | Instruction file rewrite | P0 | 1 | Simple | 95% | F1.1 |
| F1.6 | Root config rewrite | P0 | 1 | Simple | 95% | F1.5 |
| F1.7 | Orchestrator loop | P0 | 1 | Medium | 85% | F1.1, F1.4, F1.5 |
| F1.8 | `tickets.py` deprecation | P0 | 1 | Simple | 95% | F1.4, F1.5, F1.7 |
| F2.1 | Code graph schema | P0 | 2 | Simple | 95% | Phase 1 |
| F2.2 | tree-sitter WASM | P0 | 2 | Medium | 88% | None |
| F2.3 | Indexer Agent | P0 | 2 | Medium | 85% | F2.1, F2.2 |
| F2.4 | Incremental indexing | P0 | 2 | Medium | 85% | F2.3 |
| F2.5 | `code.blast_radius` tool | P0 | 2 | Medium | 88% | F2.1, F2.8 |
| F2.6 | `code.search_symbols` tool | P0 | 2 | Simple | 90% | F2.1, F2.8 |
| F2.7 | `code.get_imports` tool | P0 | 2 | Simple | 90% | F2.1, F2.8 |
| F2.8 | Stored functions | P0 | 2 | Medium | 88% | F2.1 |
| F3.1 | pgvector setup | P1 | 3 | Simple | 96% | Phase 1 |
| F3.2 | Memory engine schema | P1 | 3 | Simple | 90% | F3.1 |
| F3.3 | Reflection Protocol | P1 | 3 | Complex | 75% | F3.2, F3.4 |
| F3.4 | Embedding service | P1 | 3 | Medium | 80% | F3.1 |
| F3.5 | `memory.search_lessons` | P1 | 3 | Medium | 85% | F3.2 |
| F3.6 | `memory.add_lesson` | P1 | 3 | Simple | 90% | F3.2, F3.4 |
| F3.7 | `memory.get_context` | P1 | 3 | Medium | 80% | F3.5 |
| F3.8 | Memory injection | P1 | 3 | Medium | 75% | F3.7, F1.7 |
| F4.1 | `init.index` tool | P1 | 4 | Simple | 90% | F2.3 |
| F4.2 | `init.orient` tool | P1 | 4 | Medium | 85% | F4.1, F3.2 |
| F4.3 | Auto-discovery | P1 | 4 | Medium | 85% | F4.2 |
| F4.4 | Auto-ticket generation | P1 | 4 | Medium | 80% | F4.2, F4.3 |
| F4.5 | Orientation progress API | P1 | 4 | Simple | 90% | F4.1 |

## Appendix B: MCP Tool Inventory

### Existing Tools (10) — No Changes Required

| Tool | Purpose |
|------|---------|
| `tickets.next` | Peek at next available ticket for a stage |
| `tickets.claim` | Atomically claim a ticket with file locks |
| `tickets.complete` | Complete stage and advance to next |
| `tickets.reject` | Reject and rework |
| `tickets.spawn` | Create child ticket |
| `tickets.extend` | Extend lease |
| `tickets.update` | Update ticket metadata |
| `tickets.release` | Release claim |
| `tickets.stats` | Dashboard statistics |
| `tickets.graph` | Dependency graph |

### New Tools (11) — Across Phases 1–4

| Tool | Phase | Purpose |
|------|-------|---------|
| `tickets.get` | 1 | Read ticket by ID |
| `tickets.list` | 1 | List/filter tickets |
| `tickets.payload` | 1 | Full dispatch payload |
| `code.blast_radius` | 2 | Affected files for a change |
| `code.search_symbols` | 2 | Symbol search across project |
| `code.get_imports` | 2 | Import/dependency chain |
| `memory.search_lessons` | 3 | Semantic lesson search |
| `memory.add_lesson` | 3 | Record a new lesson |
| `memory.get_context` | 3 | Dispatch context with lessons |
| `init.index` | 4 | Trigger code indexing |
| `init.orient` | 4 | Auto-discover tech stack |

### Total Post-Intelligence: 21 MCP tools
