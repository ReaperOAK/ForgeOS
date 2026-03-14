-- =============================================================================
-- Migration 005-memory-engine.sql — Memory Engine Schema
-- =============================================================================
--
-- Ticket:   TASK-INT-BE031
-- Purpose:  Create the memory engine schema for storing extracted wisdom from
--           rework cycles and enabling semantic search over lessons learned.
--           Two tables:
--             lessons           — extracted wisdom entries with metadata
--             lesson_embeddings — vector representations for semantic search
--
-- Design:   Lessons capture insights from agent rework cycles, categorized
--           and tagged for filtered retrieval. Embeddings enable cosine
--           similarity search via pgvector HNSW index.
--
-- Prerequisites:
--   - 001_initial.sql (base schema, uuid-ossp extension)
--   - 004-pgvector.sql (pgvector extension enabled)
--
-- HNSW Index Parameters:
--   m = 16              — Max bi-directional links per node
--   ef_construction = 200 — Size of dynamic candidate list during build
--
-- Embedding Dimension:
--   1024 — Default for Ollama mxbai-embed-large.
--
-- Idempotency: Safe to re-run. Uses IF NOT EXISTS guards.
-- =============================================================================

-- =============================================================================
-- 1. TABLE: lessons
-- =============================================================================
-- Stores extracted wisdom from agent rework cycles and operational insights.
-- category enables broad classification; tags (TEXT[]) enable fine-grained
-- filtering via GIN index. context stores arbitrary structured metadata.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lessons (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id     TEXT NOT NULL,
  stage         TEXT NOT NULL,
  agent_role    TEXT NOT NULL,
  rework_count  INTEGER NOT NULL DEFAULT 0,
  lesson_text   TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general',
  tags          TEXT[] NOT NULL DEFAULT '{}',
  context       JSONB DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. TABLE: lesson_embeddings
-- =============================================================================
-- Stores vector embeddings for semantic search over lessons.
-- Foreign key to lessons with CASCADE delete ensures cleanup.
-- model_name tracks embedding provenance for mixed-model storage.
-- =============================================================================

CREATE TABLE IF NOT EXISTS lesson_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lesson_id   UUID NOT NULL REFERENCES lessons(id) ON DELETE CASCADE,
  embedding   vector(1024) NOT NULL,
  model_name  TEXT NOT NULL DEFAULT 'mxbai-embed-large',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 3. INDEXES: lessons
-- =============================================================================

-- Lookup by originating ticket
CREATE INDEX IF NOT EXISTS idx_lessons_ticket_id
  ON lessons (ticket_id);

-- Filtered search by category
CREATE INDEX IF NOT EXISTS idx_lessons_category
  ON lessons (category);

-- Array containment queries on tags (supports @> operator)
CREATE INDEX IF NOT EXISTS idx_lessons_tags
  ON lessons USING GIN (tags);

-- Filter by SDLC stage
CREATE INDEX IF NOT EXISTS idx_lessons_stage
  ON lessons (stage);

-- Filter by agent role
CREATE INDEX IF NOT EXISTS idx_lessons_agent_role
  ON lessons (agent_role);

-- Chronological ordering
CREATE INDEX IF NOT EXISTS idx_lessons_created_at
  ON lessons (created_at DESC);

-- =============================================================================
-- 4. HNSW INDEX — Cosine Similarity on lesson_embeddings
-- =============================================================================
-- HNSW (Hierarchical Navigable Small World) provides sub-linear ANN search.
--
-- Parameters:
--   m = 16:              Good balance of recall vs memory for < 1M vectors.
--   ef_construction = 200: Higher than default (64) for better recall.
--
-- Operator class: vector_cosine_ops
--   Supports <=> (cosine distance) operator.
--   Use: ORDER BY embedding <=> '[...]' LIMIT k
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_lesson_embeddings_hnsw
  ON lesson_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- =============================================================================
-- 5. SUPPORTING INDEXES: lesson_embeddings
-- =============================================================================

-- Fast lookup by lesson
CREATE INDEX IF NOT EXISTS idx_lesson_embeddings_lesson_id
  ON lesson_embeddings (lesson_id);

-- =============================================================================
-- 6. PERMISSIONS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON lessons TO forgeos_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON lesson_embeddings TO forgeos_user;

-- =============================================================================
-- 7. FUNCTION: search_similar_lessons
-- =============================================================================
-- Ticket:   TASK-INT-BE032
-- Purpose:  Semantic search over lesson embeddings using pgvector cosine
--           distance. Returns top-K lessons ordered by similarity, with
--           optional category filtering and configurable threshold.
--
-- Parameters:
--   query_embedding — 1024-dim vector to search against
--   p_category      — optional category filter (NULL = no filter)
--   p_threshold     — minimum similarity score (default 0.7)
--   p_limit         — max results to return (default 10)
--
-- Returns:  JSONB array of matching lessons with similarity scores.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_similar_lessons(
  query_embedding vector(1024),
  p_category TEXT DEFAULT NULL,
  p_threshold FLOAT DEFAULT 0.7,
  p_limit INTEGER DEFAULT 10
) RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(lesson_data), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', l.id,
      'ticket_id', l.ticket_id,
      'stage', l.stage,
      'agent_role', l.agent_role,
      'rework_count', l.rework_count,
      'lesson_text', l.lesson_text,
      'category', l.category,
      'tags', l.tags,
      'similarity', 1.0 - (le.embedding <=> query_embedding),
      'created_at', l.created_at
    ) as lesson_data
    FROM lesson_embeddings le
    JOIN lessons l ON le.lesson_id = l.id
    WHERE (1.0 - (le.embedding <=> query_embedding)) >= p_threshold
      AND (p_category IS NULL OR l.category = p_category)
    ORDER BY le.embedding <=> query_embedding ASC
    LIMIT p_limit
  ) sub;
$$ LANGUAGE SQL STABLE;
