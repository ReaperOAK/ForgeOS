-- =============================================================================
-- Migration 010-agent-definitions.sql — Agent Definition Storage
-- =============================================================================
--
-- Ticket:   TASK-PC-BE-010
-- Purpose:  Decouple agent execution intelligence from repository markdown
--           files by storing agent definitions in a centralized database table.
--           This enables the Prompt Compiler to load agent context without
--           filesystem access.
--
-- Design:   Agent definitions are stored as structured JSONB with metadata
--           for versioning, tool loadouts, and role-specific constraints.
--           The table supports semantic search via embeddings for the
--           Prompt Compiler to retrieve relevant agent definitions.
--
-- Note:     Core governance rules in .github/instructions/ remain version
--           controlled as specified in the architecture.
--
-- Idempotency: Safe to re-run. Uses IF NOT EXISTS guards.
-- =============================================================================

-- =============================================================================
-- 1. TABLE: agent_definitions
-- =============================================================================
-- Stores agent profiles with tool loadouts, constraints, and metadata.
-- Each agent has a unique name and role mapping to SDLC stages.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_definitions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_name      TEXT NOT NULL UNIQUE,
  agent_role      TEXT NOT NULL,
  description     TEXT NOT NULL,
  stage           TEXT NOT NULL,
  model           TEXT,
  tools           JSONB NOT NULL DEFAULT '[]'::jsonb,
  constraints     JSONB NOT NULL DEFAULT '{}'::jsonb,
  forbidden_actions TEXT[] NOT NULL DEFAULT '{}',
  scope_included  TEXT[] NOT NULL DEFAULT '{}',
  scope_excluded  TEXT[] NOT NULL DEFAULT '{}',
  evidence_requirements TEXT[] NOT NULL DEFAULT '{}',
  boot_sequence   TEXT[] NOT NULL DEFAULT '{}',
  execution_workflow JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  source_file     TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 2. TABLE: agent_definition_embeddings
-- =============================================================================
-- Stores vector embeddings for semantic search over agent definitions.
-- Enables the Prompt Compiler to find relevant agents by context.
-- =============================================================================

CREATE TABLE IF NOT EXISTS agent_definition_embeddings (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_definition_id UUID NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  embedding       vector(1024) NOT NULL,
  model_name      TEXT NOT NULL DEFAULT 'mxbai-embed-large',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================================
-- 3. INDEXES: agent_definitions
-- =============================================================================

-- Lookup by agent name
CREATE INDEX IF NOT EXISTS idx_agent_definitions_agent_name
  ON agent_definitions (agent_name);

-- Filter by SDLC stage
CREATE INDEX IF NOT EXISTS idx_agent_definitions_stage
  ON agent_definitions (stage);

-- Filter by role
CREATE INDEX IF NOT EXISTS idx_agent_definitions_agent_role
  ON agent_definitions (agent_role);

-- Active agents only
CREATE INDEX IF NOT EXISTS idx_agent_definitions_is_active
  ON agent_definitions (is_active)
  WHERE is_active = TRUE;

-- Source file lookup
CREATE INDEX IF NOT EXISTS idx_agent_definitions_source_file
  ON agent_definitions (source_file)
  WHERE source_file IS NOT NULL;

-- =============================================================================
-- 4. INDEXES: agent_definition_embeddings
-- =============================================================================

-- HNSW index for cosine similarity search
CREATE INDEX IF NOT EXISTS idx_agent_definition_embeddings_hnsw
  ON agent_definition_embeddings USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 200);

-- Fast lookup by agent definition
CREATE INDEX IF NOT EXISTS idx_agent_definition_embeddings_agent_def_id
  ON agent_definition_embeddings (agent_definition_id);

-- =============================================================================
-- 5. PERMISSIONS
-- =============================================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON agent_definitions TO forgeos_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON agent_definition_embeddings TO forgeos_user;

-- =============================================================================
-- 6. FUNCTION: search_similar_agents
-- =============================================================================
-- Purpose:  Semantic search over agent definition embeddings using pgvector
--           cosine distance. Returns top-K agents ordered by similarity,
--           with optional stage filtering.
--
-- Parameters:
--   query_embedding — 1024-dim vector to search against
--   p_stage         — optional stage filter (NULL = no filter)
--   p_threshold     — minimum similarity score (default 0.7)
--   p_limit         — max results to return (default 5)
--
-- Returns:  JSONB array of matching agent definitions with similarity scores.
-- =============================================================================

CREATE OR REPLACE FUNCTION search_similar_agents(
  query_embedding vector(1024),
  p_stage TEXT DEFAULT NULL,
  p_threshold FLOAT DEFAULT 0.7,
  p_limit INTEGER DEFAULT 5
) RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(agent_data), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', ad.id,
      'agent_name', ad.agent_name,
      'agent_role', ad.agent_role,
      'description', ad.description,
      'stage', ad.stage,
      'model', ad.model,
      'tools', ad.tools,
      'constraints', ad.constraints,
      'forbidden_actions', ad.forbidden_actions,
      'scope_included', ad.scope_included,
      'scope_excluded', ad.scope_excluded,
      'similarity', 1.0 - (ade.embedding <=> query_embedding),
      'created_at', ad.created_at
    ) as agent_data
    FROM agent_definition_embeddings ade
    JOIN agent_definitions ad ON ade.agent_definition_id = ad.id
    WHERE ad.is_active = TRUE
      AND (1.0 - (ade.embedding <=> query_embedding)) >= p_threshold
      AND (p_stage IS NULL OR ad.stage = p_stage)
    ORDER BY ade.embedding <=> query_embedding ASC
    LIMIT p_limit
  ) sub;
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- 7. FUNCTION: get_agent_by_name
-- =============================================================================
-- Purpose:  Retrieve a specific agent definition by name.
--           Used by the Prompt Compiler to load agent context for a ticket.
--
-- Parameters:
--   p_agent_name — Name of the agent to retrieve
--
-- Returns:  JSONB object with agent definition or NULL if not found.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_agent_by_name(
  p_agent_name TEXT
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'id', ad.id,
    'agent_name', ad.agent_name,
    'agent_role', ad.agent_role,
    'description', ad.description,
    'stage', ad.stage,
    'model', ad.model,
    'tools', ad.tools,
    'constraints', ad.constraints,
    'forbidden_actions', ad.forbidden_actions,
    'scope_included', ad.scope_included,
    'scope_excluded', ad.scope_excluded,
    'evidence_requirements', ad.evidence_requirements,
    'boot_sequence', ad.boot_sequence,
    'execution_workflow', ad.execution_workflow,
    'metadata', ad.metadata,
    'version', ad.version,
    'created_at', ad.created_at,
    'updated_at', ad.updated_at
  )
  FROM agent_definitions ad
  WHERE ad.agent_name = p_agent_name
    AND ad.is_active = TRUE
  LIMIT 1;
$$ LANGUAGE SQL STABLE;

-- =============================================================================
-- 8. FUNCTION: get_agent_by_stage
-- =============================================================================
-- Purpose:  Retrieve the agent definition for a specific SDLC stage.
--           Used by the Prompt Compiler to determine which agent handles
--           a ticket at its current stage.
--
-- Parameters:
--   p_stage — SDLC stage name
--
-- Returns:  JSONB object with agent definition or NULL if not found.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_agent_by_stage(
  p_stage TEXT
) RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'id', ad.id,
    'agent_name', ad.agent_name,
    'agent_role', ad.agent_role,
    'description', ad.description,
    'stage', ad.stage,
    'model', ad.model,
    'tools', ad.tools,
    'constraints', ad.constraints,
    'forbidden_actions', ad.forbidden_actions,
    'scope_included', ad.scope_included,
    'scope_excluded', ad.scope_excluded,
    'evidence_requirements', ad.evidence_requirements,
    'boot_sequence', ad.boot_sequence,
    'execution_workflow', ad.execution_workflow,
    'metadata', ad.metadata,
    'version', ad.version,
    'created_at', ad.created_at,
    'updated_at', ad.updated_at
  )
  FROM agent_definitions ad
  WHERE ad.stage = p_stage
    AND ad.is_active = TRUE
  LIMIT 1;
$$ LANGUAGE SQL STABLE;