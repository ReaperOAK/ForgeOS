# TASK-INT-BE031 — Memory Engine Schema Migration

## Stage: BACKEND | Agent: Backend | Machine: Ticketer

## Summary

Created migration `005-memory-engine.sql` implementing the memory engine schema for Phase 3 of the Intelligence Plan.

## Artifacts

- `forgeos-server/src/db/migrations/005-memory-engine.sql` (NEW)

## Acceptance Criteria Verification

| # | Criterion | Status |
|---|-----------|--------|
| 1 | `lessons` table with id, ticket_id, stage, agent_role, rework_count, lesson_text, category, tags, created_at | PASS |
| 2 | `lesson_embeddings` table with id, lesson_id FK, embedding vector(1536), model_name, created_at | PASS |
| 3 | HNSW index on lesson_embeddings.embedding with cosine distance operator | PASS |
| 4 | Index on lessons.category and lessons.tags for filtered search | PASS |
| 5 | Foreign key from lesson_embeddings to lessons with CASCADE delete | PASS |
| 6 | Migration file follows naming convention (005-memory-engine.sql) | PASS |
| 7 | GIN index on lessons.tags for array containment queries | PASS |

## Implementation Details

- **Tables:** `lessons` (11 columns), `lesson_embeddings` (5 columns)
- **Indexes on lessons:** ticket_id, category, tags (GIN), stage, agent_role, created_at DESC
- **Indexes on lesson_embeddings:** HNSW cosine on embedding (m=16, ef_construction=200), lesson_id
- **Permissions:** GRANT SELECT/INSERT/UPDATE/DELETE to forgeos_user on both tables
- **Idempotency:** All statements use IF NOT EXISTS guards
- **Convention alignment:** Matches 003-code-graph.sql and 004-pgvector.sql patterns (UUID PKs, TIMESTAMPTZ, CASCADE deletes, section headers)

## Confidence: HIGH
