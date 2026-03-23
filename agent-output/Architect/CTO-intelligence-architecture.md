# Architect Summary: Intelligence Plan Architecture

> **Ticket:** CTO-intelligence-architecture  
> **Agent:** Architect  
> **Date:** 2026-03-12  
> **Confidence:** HIGH (90%)

---

## What Was Done

Designed the complete system architecture for ForgeOS's evolution from a mechanical scheduler to a cognitive, self-healing autonomous development platform across 4 phases.

## Artifacts Produced

| Artifact | Path | Purpose |
|----------|------|---------|
| System Architecture Document | `docs/architecture/intelligence-architecture.md` | Complete architecture spec with diagrams, DDL, tool specs, data flows, DAG |
| ADR-004 | `docs/architecture/adr/adr-004-tree-sitter-code-parsing.md` | tree-sitter selection for multi-language AST parsing |
| ADR-005 | `docs/architecture/adr/adr-005-pgvector-embedding-model.md` | pgvector + OpenAI text-embedding-3-small for memory engine |
| ADR-006 | `docs/architecture/adr/adr-006-blast-radius-computation.md` | PostgreSQL recursive CTE for blast radius queries |
| ADR-007 | `docs/architecture/adr/adr-007-agent-mcp-migration.md` | Big Bang cutover strategy for filesystem → MCP migration |

## Key Architectural Decisions

1. **Phase 1 — Cutover:** Big Bang migration from filesystem ticket state to MCP-only. 3 new MCP tools needed (`tickets.get`, `tickets.list`, `tickets.payload`). All 14 agent files + 6 instruction files require rewrite. ForgeOS orchestrator loop replaces stateless Ticketer.

2. **Phase 2 — Code Graph:** tree-sitter (WASM) parses ASTs across 5 languages. 4 new PostgreSQL tables (`code_files`, `code_symbols`, `code_imports`, `code_dependencies`). Blast radius via recursive CTE with depth cap. 3 new MCP tools (`code.blast_radius`, `code.search_symbols`, `code.get_imports`).

3. **Phase 3 — Memory:** pgvector extension with HNSW index. OpenAI `text-embedding-3-small` (1536 dims) with local fallback. Reflection Protocol auto-extracts lessons from rejection→fix cycles. 3 new MCP tools (`memory.search_lessons`, `memory.add_lesson`, `memory.get_context`). Memory injection into dispatch prompts.

4. **Phase 4 — Drop-In:** Zero-config orientation: Index → Analyze → Generate. Auto-discovery heuristics for tech stack, frameworks, entry points. 2 new MCP tools (`init.index`, `init.orient`).

## Schema Extensions

| Migration | Tables | Phase |
|-----------|--------|-------|
| 002_code_graph.sql | `code_files`, `code_symbols`, `code_imports`, `code_dependencies` | 2 |
| 003_memory_engine.sql | `lessons`, `lesson_embeddings` (pgvector) | 3 |
| 004_code_graph_functions.sql | `blast_radius()`, `search_symbols()`, `get_import_chain()` | 2 |

## New MCP Tools Summary

| Tool | Phase | Description |
|------|-------|-------------|
| `tickets.get` | 1 | Read ticket by ID |
| `tickets.list` | 1 | List tickets with filters |
| `tickets.payload` | 1 | Full dispatch payload with context injection |
| `code.blast_radius` | 2 | Compute affected files from code changes |
| `code.search_symbols` | 2 | Search symbols across project |
| `code.get_imports` | 2 | Import/dependency chain analysis |
| `memory.search_lessons` | 3 | Semantic similarity search for lessons |
| `memory.add_lesson` | 3 | Store new lessons with embeddings |
| `memory.get_context` | 3 | Get formatted lessons for prompt injection |
| `init.index` | 4 | Trigger full/incremental repo indexing |
| `init.orient` | 4 | Auto-discover tech stack and project context |

## Critical Path

P1 (Cutover) → P2 (Code Graph) + P3 (Memory) → P4 (Drop-In)

Phase 2 and Phase 3 schema creation can run in parallel after Phase 1 completes.

## Fitness Functions

| Metric | Target |
|--------|--------|
| Ticket claim via MCP | < 50ms p99 |
| Blast radius query | < 200ms p99 |
| Lesson similarity search | < 10ms p99 (100K embeddings) |
| Full index (10K files) | < 60s |
| Filesystem ticket-state refs | 0 (post-cutover) |

## Next Agents in Pipeline

This architecture feeds into:
- **Backend Engineer** — Implement migrations 002–004, new MCP tools, orchestrator
- **DevOps Engineer** — Docker image updates (pgvector, tree-sitter WASM)
- **Frontend Engineer** — Dashboard panels for code graph + memory
- **Documentation Specialist** — Update all agent/instruction files per cutover spec

## Evidence

- Primary files analyzed: `001_initial.sql`, `tools/index.ts`, `tools/tickets-*.ts`, `agent-sdk/src/forgeos_sdk/`, all 14 agent files, all 6 instruction files
- Patterns established: Zod schema → handler → stored function → event trail
- Well-Architected assessment: all 6 pillars addressed in architecture doc
