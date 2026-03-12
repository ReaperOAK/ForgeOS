# Phase 3 — Memory Engine: Schema, Pipeline and MCP Tools (L3 Tickets)

Source blocks: BLK-INT-10 (Memory Schema and pgvector), BLK-INT-11 (Embedding Pipeline), BLK-INT-12 (Memory MCP Tools)

---

# TASK-INT-DO002: Install and Configure pgvector Extension

**Type:** infra
**Priority:** high
**Dependencies:** TASK-INT-BE017
**Files:** infra/docker/Dockerfile.postgres, infra/docker-compose.yml, forgeos-server/docker-compose.yml
**Tags:** intelligence, memory, phase3, infra, BLK-INT-10

## Description

Install pgvector 0.7+ in the PostgreSQL Docker image. Update all docker-compose files to use the pgvector-enabled image. Configure HNSW index parameters (m=16, ef_construction=200). Verify CREATE EXTENSION vector works in fresh database setup.

## Acceptance Criteria

- [ ] PostgreSQL Docker image includes pgvector 0.7+ extension
- [ ] CREATE EXTENSION IF NOT EXISTS vector succeeds on fresh database
- [ ] vector(1536) column type available for text-embedding-3-small dimensions
- [ ] HNSW index creation with cosine operator class works
- [ ] All docker-compose files reference the updated image
- [ ] Setup scripts enable pgvector automatically
- [ ] Seed script handles pgvector extension check

---

# TASK-INT-BE031: Memory Engine Schema Migration

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-DO002
**Files:** forgeos-server/src/db/migrations/003-memory-engine.sql
**Tags:** intelligence, memory, phase3, database, BLK-INT-10

## Description

Create database migration 003 for the memory engine. Tables: lessons (extracted wisdom from rework cycles), lesson_embeddings (vector representations for semantic search). Include HNSW index on embeddings column. Match DDL from architecture doc migration 003.

## Acceptance Criteria

- [ ] lessons table created with id, ticket_id (FK), category (ENUM: pattern, anti-pattern, convention, decision), title, content, confidence (0.0-1.0), context JSONB, created_at
- [ ] lesson_embeddings table created with id, lesson_id (FK), model_name, embedding vector(1536), created_at
- [ ] HNSW index created on lesson_embeddings with m=16, ef_construction=200, vector_cosine_ops
- [ ] GIN index on lessons.context JSONB column
- [ ] Index on lessons.category
- [ ] Migration is idempotent (IF NOT EXISTS guards)
- [ ] Rollback drops tables and indexes cleanly

---

# TASK-INT-BE032: search_similar_lessons Stored Function

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE031
**Files:** forgeos-server/src/db/migrations/003-memory-engine.sql
**Tags:** intelligence, memory, phase3, database, BLK-INT-10

## Description

Implement the search_similar_lessons() PostgreSQL stored function. Takes an embedding vector, category filter, and similarity threshold. Returns top-K lessons ordered by cosine similarity. Match the function signature from the architecture doc.

## Acceptance Criteria

- [ ] Function search_similar_lessons accepts query_embedding vector(1536), category_filter TEXT, similarity_threshold FLOAT, max_results INT
- [ ] Returns lesson_id, title, content, category, confidence, similarity_score, context
- [ ] Filters by category when category_filter is not NULL
- [ ] Only returns lessons with similarity at or above similarity_threshold
- [ ] Results ordered by similarity descending, limited to max_results
- [ ] Unit test: seed 5 lessons with embeddings then verify ordering by similarity
- [ ] Performance: less than 50ms for 100K embeddings with HNSW index

---

# TASK-INT-BE033: Embedding Service Integration

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE031
**Files:** forgeos-server/src/services/embedding-service.ts
**Tags:** intelligence, memory, phase3, service, BLK-INT-11

## Description

Implement the embedding service that interfaces with OpenAI text-embedding-3-small API. Provides embed_text() and embed_batch() methods. Handles rate limiting, retry with exponential backoff, and API key configuration via environment variables. API key must never be logged.

## Acceptance Criteria

- [ ] EmbeddingService.embed_text(text) returns 1536-dim float array
- [ ] EmbeddingService.embed_batch(texts) returns array of embeddings (max 100 per batch)
- [ ] Uses text-embedding-3-small model (configurable via env)
- [ ] API key from OPENAI_API_KEY environment variable (validated at startup)
- [ ] Retry with exponential backoff (3 attempts, base 1s)
- [ ] Rate limit handling (429 triggers exponential backoff)
- [ ] API key never logged or exposed in error messages
- [ ] Unit tests with mocked OpenAI API responses

---

# TASK-INT-BE034: Reflection Protocol Service

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE033, TASK-INT-BE032
**Files:** forgeos-server/src/services/reflection-service.ts
**Tags:** intelligence, memory, phase3, service, BLK-INT-11

## Description

Implement the Reflection Protocol service. Auto-triggers on rework-to-DONE ticket transitions. Extracts lessons from QA rejection cycles: what failed, what fixed it, and the pattern learned. Generates embeddings and stores as lessons.

## Acceptance Criteria

- [ ] ReflectionService.processCompletion(ticketId) triggers automatically on rework-to-DONE transition
- [ ] Extracts rejection reason from QA/Security/Validator agent output
- [ ] Extracts fix description from rework agent output
- [ ] Categorizes lesson as pattern, anti-pattern, convention, or decision
- [ ] Generates embedding via EmbeddingService
- [ ] Stores lesson and embedding in lessons/lesson_embeddings tables
- [ ] Assigns confidence: 1.0 for repeated patterns, 0.5 for first occurrence
- [ ] Skips tickets with no rework history (no-op, not error)
- [ ] Unit tests: mock rework history then verify lesson extraction and storage

---

# TASK-INT-BE035: Memory Injection in Orchestrator Dispatch

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE034, TASK-INT-BE015
**Files:** forgeos-server/src/services/orchestrator.ts
**Tags:** intelligence, memory, phase3, orchestrator, BLK-INT-11

## Description

Integrate memory injection into the orchestrator dispatch loop. Before dispatching a ticket to an agent, query search_similar_lessons() with the ticket context as the embedding query. Inject the top 5 relevant lessons into the agent delegation payload.

## Acceptance Criteria

- [ ] Orchestrator generates embedding for ticket title plus description before dispatch
- [ ] Queries search_similar_lessons() with ticket embedding, category matching ticket type
- [ ] Top 5 lessons (similarity at or above 0.7) appended to delegation payload as prior_lessons
- [ ] Each lesson includes title, content, category, confidence, similarity_score
- [ ] Dispatch proceeds normally if no matching lessons found (empty array)
- [ ] Dispatch proceeds normally if embedding service is unavailable (graceful degradation)
- [ ] Performance: memory injection adds less than 500ms to dispatch latency
- [ ] Unit test: mock lessons then verify injection into payload

---

# TASK-INT-BE036: Implement memory.search_lessons MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE032, TASK-INT-BE033
**Files:** forgeos-server/src/tools/memory-search-lessons.ts
**Tags:** intelligence, memory, phase3, mcp-tool, BLK-INT-12

## Description

Implement the memory.search_lessons MCP tool. Agents call this to search for relevant past lessons by natural language query. The tool embeds the query text, then calls search_similar_lessons() stored function. Returns ranked lessons.

## Acceptance Criteria

- [ ] MCP tool memory.search_lessons accepts query (string), optional category, optional max_results (default 5)
- [ ] Embeds query text via EmbeddingService
- [ ] Calls search_similar_lessons() with the embedding
- [ ] Returns array of lesson objects with title, content, category, confidence, similarity_score
- [ ] Returns empty array if no lessons match threshold (not an error)
- [ ] Graceful error if embedding service unavailable
- [ ] Zod schemas validate input parameters
- [ ] Unit test: mock embedding plus seeded lessons then verify ranked results

---

# TASK-INT-BE037: Implement memory.add_lesson MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE031, TASK-INT-BE033
**Files:** forgeos-server/src/tools/memory-add-lesson.ts
**Tags:** intelligence, memory, phase3, mcp-tool, BLK-INT-12

## Description

Implement the memory.add_lesson MCP tool. Allows agents to manually record lessons learned during their work. Generates embedding and stores in lessons/lesson_embeddings tables.

## Acceptance Criteria

- [ ] MCP tool memory.add_lesson accepts ticket_id, title, content, category
- [ ] Validates category is one of: pattern, anti-pattern, convention, decision
- [ ] Generates embedding for title plus content via EmbeddingService
- [ ] Stores in lessons table with default confidence 0.5
- [ ] Stores embedding in lesson_embeddings table
- [ ] Returns created lesson object with id
- [ ] Prevents duplicate lessons (same ticket_id plus title combination)
- [ ] Zod schemas validate all input parameters
- [ ] Unit test: create lesson then verify in database

---

# TASK-INT-BE038: Implement memory.get_context MCP Tool

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE036, TASK-INT-BE024
**Files:** forgeos-server/src/tools/memory-get-context.ts
**Tags:** intelligence, memory, phase3, mcp-tool, BLK-INT-12

## Description

Implement the memory.get_context MCP tool. Combines code graph and memory data for a given file or ticket. Returns blast radius (if file), relevant lessons, related tickets. Primary tool agents use for context-aware decisions.

## Acceptance Criteria

- [ ] MCP tool memory.get_context accepts file_path OR ticket_id, optional max_lessons (default 5)
- [ ] If file_path provided: returns blast radius plus file-relevant lessons
- [ ] If ticket_id provided: returns ticket description plus ticket-relevant lessons
- [ ] Returns blast_radius object (null if ticket-only query)
- [ ] Returns relevant_lessons array
- [ ] Returns context_score (0.0-1.0) indicating confidence in context quality
- [ ] Graceful degradation if code graph or memory subsystem unavailable
- [ ] Unit test: seed file plus lessons then verify combined response
