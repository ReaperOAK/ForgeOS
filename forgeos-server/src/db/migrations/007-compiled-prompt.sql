-- 007-compiled-prompt.sql
-- Adds precompiled execution directive fields for stateless IDE handoff.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS compiled_prompt TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_generated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS compiled_prompt_provider TEXT,
  ADD COLUMN IF NOT EXISTS compiled_prompt_model TEXT;

CREATE INDEX IF NOT EXISTS idx_tickets_compiled_prompt_generated_at
  ON tickets (compiled_prompt_generated_at DESC)
  WHERE compiled_prompt IS NOT NULL;
