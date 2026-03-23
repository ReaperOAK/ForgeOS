-- 012-agent-embedding-unique.sql
-- Add unique constraint on agent_definition_id for upsert support in embedding generation.
-- This allows ON CONFLICT DO UPDATE when re-seeding agent embeddings.

CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_definition_embeddings_unique_agent
  ON agent_definition_embeddings (agent_definition_id);
