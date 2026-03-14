-- 008-prompt-compiler-foundation.sql
-- Additive foundation for deterministic prompt packets and freshness metadata.
-- Backward compatible with legacy compiled_prompt fields introduced in 007.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS compiled_prompt_compiled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compiled_prompt_context_hash TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_packet_schema_version INTEGER,
  ADD COLUMN IF NOT EXISTS compiled_prompt_packet_version TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_template_version TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_freshness_status TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_stale_reason TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_freshness_checked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compiled_prompt_context_repo_commit TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_context_graph_version TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_context_memory_snapshot TEXT;

ALTER TABLE tickets
  ALTER COLUMN compiled_prompt_packet_schema_version SET DEFAULT 1,
  ALTER COLUMN compiled_prompt_packet_version SET DEFAULT 'v1';

-- Normalize timestamp fields for existing compiled rows without changing prompt text.
UPDATE tickets
SET
  compiled_prompt_compiled_at = COALESCE(compiled_prompt_compiled_at, compiled_prompt_generated_at),
  compiled_prompt_freshness_checked_at = COALESCE(compiled_prompt_freshness_checked_at, compiled_prompt_generated_at),
  compiled_prompt_packet_schema_version = COALESCE(compiled_prompt_packet_schema_version, 1),
  compiled_prompt_packet_version = COALESCE(compiled_prompt_packet_version, 'v1')
WHERE compiled_prompt IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_compiled_prompt_freshness_status_check'
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_compiled_prompt_freshness_status_check
      CHECK (
        compiled_prompt_freshness_status IS NULL
        OR compiled_prompt_freshness_status IN ('fresh', 'stale', 'missing')
      );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'tickets_compiled_prompt_packet_schema_version_check'
  ) THEN
    ALTER TABLE tickets
      ADD CONSTRAINT tickets_compiled_prompt_packet_schema_version_check
      CHECK (
        compiled_prompt_packet_schema_version IS NULL
        OR compiled_prompt_packet_schema_version >= 1
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tickets_compiled_prompt_context_hash
  ON tickets (compiled_prompt_context_hash)
  WHERE compiled_prompt_context_hash IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tickets_compiled_prompt_freshness_status
  ON tickets (compiled_prompt_freshness_status)
  WHERE compiled_prompt_freshness_status IS NOT NULL;

-- Down migration (manual test environments only):
-- ALTER TABLE tickets
--   DROP COLUMN IF EXISTS compiled_prompt_context_memory_snapshot,
--   DROP COLUMN IF EXISTS compiled_prompt_context_graph_version,
--   DROP COLUMN IF EXISTS compiled_prompt_context_repo_commit,
--   DROP COLUMN IF EXISTS compiled_prompt_freshness_checked_at,
--   DROP COLUMN IF EXISTS compiled_prompt_stale_reason,
--   DROP COLUMN IF EXISTS compiled_prompt_freshness_status,
--   DROP COLUMN IF EXISTS compiled_prompt_template_version,
--   DROP COLUMN IF EXISTS compiled_prompt_packet_version,
--   DROP COLUMN IF EXISTS compiled_prompt_packet_schema_version,
--   DROP COLUMN IF EXISTS compiled_prompt_context_hash,
--   DROP COLUMN IF EXISTS compiled_prompt_compiled_at;
