-- =============================================================================
-- Migration 004-pgvector.sql — pgvector Extension & Embedding Tables
-- =============================================================================
--
-- Ticket:   TASK-INT-DO002
-- Purpose:  Enable the pgvector extension and create the code_embeddings table
--           for vector similarity search over code symbols and files.
--
-- Prerequisites:
--   - pgvector 0.7+ installed in the PostgreSQL image (pgvector/pgvector:pg17)
--   - 003-code-graph.sql (code_symbols, code_files tables)
--
-- HNSW Index Parameters:
--   m = 16              — Max bi-directional links per node (higher = more
--                         accurate but slower build, more memory)
--   ef_construction = 200 — Size of dynamic candidate list during build
--                           (higher = better recall at build-time cost)
--
-- Embedding Dimension:
--   1536 — Default for OpenAI text-embedding-3-small. Change if using a
--          different model (e.g., 768 for text-embedding-3-small with
--          dimensions parameter, 3072 for text-embedding-3-large).
--
-- Idempotency: Safe to re-run. Uses IF NOT EXISTS guards.
-- =============================================================================

-- =============================================================================
-- 1. ENABLE pgvector EXTENSION
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================================
-- 2. TABLE: code_embeddings
-- =============================================================================
-- Stores vector embeddings for code symbols and files.
-- Either symbol_id or file_id should be set (not both NULL).
-- The model_name column tracks which embedding model produced the vector,
-- enabling mixed-model storage and future model upgrades.
-- =============================================================================

CREATE TABLE IF NOT EXISTS code_embeddings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  symbol_id   UUID REFERENCES code_symbols(id) ON DELETE CASCADE,
  file_id     UUID REFERENCES code_files(id) ON DELETE CASCADE,
  embedding   vector(1536) NOT NULL,
  model_name  TEXT NOT NULL DEFAULT 'text-embedding-3-small',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- At least one of symbol_id or file_id must be set
  CONSTRAINT chk_embedding_target CHECK (symbol_id IS NOT NULL OR file_id IS NOT NULL)
);

-- =============================================================================
-- 3. HNSW INDEX — Cosine Similarity
-- =============================================================================
-- HNSW (Hierarchical Navigable Small World) provides sub-linear ANN search.
--
-- Parameters:
--   m = 16:              Good balance of recall vs memory for < 1M vectors.
--   ef_construction = 200: Higher than default (64) for better recall.
--                          Increases build time but improves query quality.
--
-- Operator class: vector_cosine_ops
--   Supports <=> (cosine distance) operator.
--   Use: ORDER BY embedding <=> '[...]' LIMIT k
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_code_embeddings_hnsw
  ON code_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- =============================================================================
-- 4. SUPPORTING INDEXES
-- =============================================================================

-- Fast lookup by symbol
CREATE INDEX IF NOT EXISTS idx_code_embeddings_symbol_id
  ON code_embeddings (symbol_id)
  WHERE symbol_id IS NOT NULL;

-- Fast lookup by file
CREATE INDEX IF NOT EXISTS idx_code_embeddings_file_id
  ON code_embeddings (file_id)
  WHERE file_id IS NOT NULL;

-- Model-based filtering (useful for re-embedding with a new model)
CREATE INDEX IF NOT EXISTS idx_code_embeddings_model
  ON code_embeddings (model_name);

-- =============================================================================
-- 5. PERMISSIONS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON code_embeddings TO forgeos_user;

-- =============================================================================
-- 6. VERIFICATION
-- =============================================================================

DO $$
DECLARE
  v_version TEXT;
BEGIN
  SELECT extversion INTO v_version
    FROM pg_extension WHERE extname = 'vector';

  IF v_version IS NOT NULL THEN
    RAISE NOTICE 'pgvector extension loaded — version %', v_version;
  ELSE
    RAISE WARNING 'pgvector extension NOT found — install pgvector and re-run';
  END IF;
END
$$;
