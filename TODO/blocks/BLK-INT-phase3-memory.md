# L2 Execution Blocks — Phase 3: Memory Engine

> **L1 Capability:** Memory Engine  
> **Priority:** HIGH (P1)  
> **Phase Dependency:** Phase 1 (MCP events), Phase 2 optional (blast radius enrichment)

---

## BLK-INT-10: Memory Engine Schema & pgvector Setup

**Scope:** Enable pgvector extension in PostgreSQL. Create `lessons` and `lesson_embeddings` tables with HNSW index. Stored function `search_similar_lessons()`. Docker/infra updates for pgvector.  
**Files:** `forgeos-server/src/db/migrations/`, Docker config  
**Estimated Effort:** M  
**Tickets:** 3 (pgvector infra, schema migration, stored functions)

---

## BLK-INT-11: Embedding Pipeline & Reflection Protocol

**Scope:** Build embedding service integration (OpenAI text-embedding-3-small default, local Nomic fallback). Implement Reflection Protocol: triggered on rework→DONE transition. Pipeline: extract rejection events → diff → LLM-summarize → embed → store.  
**Files:** `forgeos-server/src/memory/`  
**Estimated Effort:** L  
**Tickets:** 3 (embedding service, reflection protocol, memory injection)

---

## BLK-INT-12: Memory MCP Tools

**Scope:** Implement 3 MCP tools: `memory.search_lessons`, `memory.add_lesson`, `memory.get_context`. Zod schemas, handlers.  
**Files:** `forgeos-server/src/tools/`  
**Estimated Effort:** M  
**Tickets:** 3 (one per tool)

---

## BLK-INT-13: Memory Testing & Agent SDK

**Scope:** Integration tests for embedding pipeline, lesson search, reflection protocol. Agent SDK wrappers for memory tools. Security review for embedding API key handling.  
**Files:** `forgeos-server/src/__tests__/`, `agent-sdk/src/`  
**Estimated Effort:** M  
**Tickets:** 4 (embedding tests, lesson search tests, SDK update, security review)
