---
title: "ADR-006: Blast Radius Computation Strategy"
ticket: CTO-intelligence-architecture
type: architecture
author: Architect
date: 2026-03-12T00:00:00Z
status: PROPOSED
tags: [architecture, adr, blast-radius, code-graph, phase2]
---

# ADR-006: Blast Radius Computation Strategy

> **Ticket:** CTO-intelligence-architecture | **Agent:** Architect | **Date:** 2026-03-12  
> **Confidence:** HIGH (90%) | **Status:** PROPOSED

---

## 1. Status

**PROPOSED** — 2026-03-12

---

## 2. Context

When an agent modifies a file, it needs to know every other file and symbol that could be affected. This "blast radius" prevents blind changes that break downstream consumers.

**Requirements:**
- Given a file path → return all transitively dependent files and symbols
- Differentiate production files from test files in the output
- Return results ordered by dependency depth (closest dependencies first)
- Must handle circular dependencies gracefully (cap recursion depth)
- Query time < 200ms for repos up to 10K files
- Operate on the pre-computed code graph (not live AST parsing)

---

## 3. Alternatives Evaluated

### 3.1 PostgreSQL Recursive CTE (chosen)

Run a `WITH RECURSIVE` query traversing the `code_dependencies` table from the symbols in the changed file outward.

**Pros:**
- No additional infrastructure — runs inside existing PostgreSQL
- Leverages indexed `code_dependencies` table
- Depth-limited by parameter (`max_depth = 5`)
- Cycle-safe via `UNION` (de-duplicates visited nodes automatically)
- Results are SQL filterable (by language, test pattern, etc.)

**Cons:**
- Performance degrades for highly connected graphs (> 1000 edges from a single file)
- No caching between successive queries on the same graph

### 3.2 Application-Level BFS in TypeScript

Load the dependency graph into memory as an adjacency list and run BFS in the MCP server process.

**Pros:**
- In-memory traversal is extremely fast (~1ms for 10K nodes)
- Full control over traversal heuristics

**Cons:**
- Requires loading the entire graph into memory per query (or maintaining a process-local cache)
- Cache invalidation on every index update
- Memory overhead scales with graph size (~50MB for 100K edges)
- Duplicates graph storage (PostgreSQL + in-memory)

### 3.3 Neo4j or Dedicated Graph Database

Store the code graph in a purpose-built graph database and run Cypher traversal queries.

**Pros:**
- Optimized for graph traversal patterns
- Rich query language for complex traversals

**Cons:**
- New infrastructure component to deploy and operate
- Data synchronization between PostgreSQL (tickets) and Neo4j (graph)
- Team has no Neo4j expertise
- Overkill for the query patterns needed (single-source shortest path)

### 3.4 Materialized View with Pre-Computed Blast Radii

Pre-compute blast radius for every file and store as a materialized view.

**Pros:**
- O(1) query time
- Simple SELECT lookup

**Cons:**
- Materialized view must be refreshed on every index update
- Storage scales as O(n²) — every file stores references to all affected files
- Refresh time grows prohibitively for large repos
- Most blast radii are never queried

---

## 4. Technology Selection Matrix

| Criterion (weight) | Recursive CTE | App-Level BFS | Neo4j | Materialized View |
|----|----|----|----|----|
| Operational simplicity (25%) | 10 | 7 | 3 | 6 |
| Query performance (25%) | 7 | 10 | 9 | 10 |
| Infrastructure cost (20%) | 10 | 8 | 3 | 8 |
| Correctness/cycle safety (15%) | 9 | 8 | 10 | 7 |
| Cache invalidation (15%) | 10 | 4 | 7 | 3 |
| **Weighted Total** | **9.10** | **7.45** | **5.95** | **6.80** |

---

## 5. Decision

**Use PostgreSQL recursive CTE** for blast radius computation.

**Rationale:**
1. Zero additional infrastructure — query runs inside the existing PostgreSQL instance
2. The `UNION` keyword in recursive CTEs inherently handles cycles by de-duplicating visited rows
3. `max_depth` parameter caps worst-case query time
4. Indexes on `code_dependencies(source_symbol_id)` and `code_dependencies(target_symbol_id)` keep traversal efficient
5. Results can be filtered, sorted, and paginated using standard SQL

**Performance mitigation for large graphs:**
- Default `max_depth = 5` limits recursion
- `LIMIT` on the outer query caps result set
- If a file has > 100 direct dependents at depth 1, the tool returns a summary with `truncated: true` flag
- For repos > 50K files, consider the application-level BFS as a future optimization (re-evaluate at that scale)

---

## 6. Consequences

### Positive
- Single query, single database, no new dependencies
- Automatically benefits from PostgreSQL query planner optimizations
- Explainable execution plans via `EXPLAIN ANALYZE`
- Integrates with RLS — agents only see their project's graph

### Negative
- Worst-case query time for pathologically connected graphs could exceed 200ms
- No cross-request caching (each MCP call runs a fresh query)

### Risks
- Graph density in monorepo setups may cause performance degradation (mitigated: depth cap + result truncation)
- PostgreSQL recursive CTE memory usage is proportional to result set size (mitigated: `work_mem` tuning)

---

## 7. Query Implementation

See `docs/architecture/intelligence-architecture.md` Section 7, Migration 004 for the full stored function `blast_radius()`.

Key design choices in the stored function:
- `SELECT FOR UPDATE` is NOT used (read-only operation)
- `DISTINCT ON (file_path)` deduplicates files appearing at multiple depths
- Test file detection via regex pattern matching on file path conventions
- Source file excluded from results (agent already knows what they're changing)
