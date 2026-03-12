# Phase 3 — Memory Engine: Testing and Security (L3 Tickets)

Source blocks: BLK-INT-12 (Memory MCP Tools), BLK-INT-13 (Memory Integration Tests)

---

# TASK-INT-BE039: Memory Engine Integration Tests

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE036, TASK-INT-BE037, TASK-INT-BE038
**Files:** forgeos-server/src/__tests__/memory-engine.integration.test.ts
**Tags:** intelligence, memory, phase3, testing, BLK-INT-13

## Description

Comprehensive integration tests for the memory engine. Tests cover the full lifecycle: lesson creation, embedding generation, similarity search, context retrieval, and reflection protocol. Uses a test database with pgvector enabled.

## Acceptance Criteria

- [ ] Test: create lesson via MCP tool then retrieve via search
- [ ] Test: reflection protocol auto-triggers on rework-to-DONE and creates lesson
- [ ] Test: search_similar_lessons returns results ordered by cosine similarity
- [ ] Test: get_context returns combined blast radius and lessons
- [ ] Test: duplicate lesson prevention works correctly
- [ ] Test: graceful degradation when embedding service unavailable
- [ ] Coverage at or above 80 percent for memory engine modules
- [ ] All tests pass against test database with pgvector extension

---

# TASK-INT-BE040: Embedding and Similarity Search Unit Tests

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE033, TASK-INT-BE032
**Files:** forgeos-server/src/__tests__/embedding-service.test.ts, forgeos-server/src/__tests__/similarity-search.test.ts
**Tags:** intelligence, memory, phase3, testing, BLK-INT-13

## Description

Unit tests for the embedding service and similarity search. Tests cover API call mocking, retry logic, rate limiting, error handling, and vector similarity calculations. No real API calls.

## Acceptance Criteria

- [ ] Test: embed_text returns 1536-dim array from mocked API
- [ ] Test: embed_batch handles up to 100 texts
- [ ] Test: retry logic triggers on 5xx errors (3 attempts)
- [ ] Test: rate limit (429) triggers exponential backoff
- [ ] Test: API key validation at startup
- [ ] Test: search_similar_lessons stored function returns correct ordering
- [ ] Test: similarity threshold filtering works
- [ ] Test: category filter narrows results correctly
- [ ] Coverage at or above 90 percent for embedding service module

---

# TASK-INT-BE041: Update Agent SDK with Memory Tool Schemas

**Type:** backend
**Priority:** high
**Dependencies:** TASK-INT-BE036, TASK-INT-BE037, TASK-INT-BE038
**Files:** agent-sdk/src/forgeos_sdk/tools/memory_tools.py, agent-sdk/src/forgeos_sdk/models/memory.py
**Tags:** intelligence, memory, phase3, sdk, BLK-INT-12

## Description

Add memory.search_lessons, memory.add_lesson, and memory.get_context tool definitions to the Agent SDK. Update Pydantic models for lesson objects, search parameters, and context responses.

## Acceptance Criteria

- [ ] MemorySearchLessonsInput model with query, optional category, optional max_results
- [ ] MemoryAddLessonInput model with ticket_id, title, content, category (Literal enum)
- [ ] MemoryGetContextInput model with optional file_path, optional ticket_id, optional max_lessons
- [ ] Lesson model with id, title, content, category, confidence, similarity_score
- [ ] ContextResponse model with blast_radius, relevant_lessons, context_score
- [ ] Tool definitions registered in SDK tool catalog
- [ ] Unit tests for all new models (Pydantic validation)

---

# TASK-INT-SEC002: Security Review for Memory Engine

**Type:** security
**Priority:** high
**Dependencies:** TASK-INT-BE035, TASK-INT-BE041
**Files:** .github/agent-output/Security/TASK-INT-SEC002.md
**Tags:** intelligence, memory, phase3, security, BLK-INT-13

## Description

Security review of the memory engine. Focus areas: OpenAI API key handling, embedding data sensitivity, pgvector index exposure, lesson content sanitization, and injection prevention in stored functions.

## Acceptance Criteria

- [ ] Verify API key never logged, serialized, or exposed in error messages
- [ ] Verify embedding inputs sanitized (no injection via search queries)
- [ ] Verify stored function parameters use parameterized queries (no SQL injection)
- [ ] Verify lesson content sanitized before storage (XSS prevention)
- [ ] Verify rate limiting prevents embedding service abuse
- [ ] Verify pgvector HNSW index parameters do not expose data
- [ ] Security assessment report written to agent-output
