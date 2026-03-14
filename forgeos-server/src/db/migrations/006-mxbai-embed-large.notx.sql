-- =============================================================================
-- Migration 006-mxbai-embed-large.notx.sql — Convert Embeddings to 1024 (mxbai)
-- =============================================================================
--
-- Ticket:   TASK-INT-BE037
-- Purpose:  Switch embedding storage from 1536-dim OpenAI vectors to
--           1024-dim mxbai-embed-large vectors for local Ollama usage.
--
-- IMPORTANT:
--   Existing vectors are truncated via TRUNCATE before ALTER TYPE because
--   pgvector dimensions are fixed and cannot be cast from 1536 to 1024.
--
-- Idempotency: Safe to re-run.
-- =============================================================================

-- Drop ANN indexes before dimension change.
DROP INDEX IF EXISTS idx_lesson_embeddings_hnsw;
DROP INDEX IF EXISTS idx_code_embeddings_hnsw;

-- Existing vectors must be regenerated for the new model.
TRUNCATE TABLE lesson_embeddings;
TRUNCATE TABLE code_embeddings;

-- Update vector dimensions + model defaults.
ALTER TABLE lesson_embeddings
  ALTER COLUMN embedding TYPE vector(1024),
  ALTER COLUMN model_name SET DEFAULT 'mxbai-embed-large';

ALTER TABLE code_embeddings
  ALTER COLUMN embedding TYPE vector(1024),
  ALTER COLUMN model_name SET DEFAULT 'mxbai-embed-large';

-- Recreate HNSW indexes for cosine search.
CREATE INDEX IF NOT EXISTS idx_lesson_embeddings_hnsw
  ON lesson_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

CREATE INDEX IF NOT EXISTS idx_code_embeddings_hnsw
  ON code_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Update semantic search function signature for 1024-dim vectors.
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
