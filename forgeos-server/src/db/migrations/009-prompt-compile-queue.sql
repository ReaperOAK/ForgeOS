-- 009-prompt-compile-queue.sql
-- Durable prompt compile queue for reliable async compilation with retry logic
-- and idempotency protection (TASK-PC-BE-008).
-- All statements are idempotent and safe to re-run.

-- ── Table ────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS prompt_compile_queue (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id       TEXT        NOT NULL,
  idempotency_key TEXT        NOT NULL,
  status          TEXT        NOT NULL DEFAULT 'pending',
  attempts        INTEGER     NOT NULL DEFAULT 0,
  max_attempts    INTEGER     NOT NULL DEFAULT 3,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_error      TEXT,
  input_hash      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Unique constraint (idempotency) ──────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_compile_queue_idempotency_key_unique'
      AND conrelid = 'prompt_compile_queue'::regclass
  ) THEN
    ALTER TABLE prompt_compile_queue
      ADD CONSTRAINT prompt_compile_queue_idempotency_key_unique
      UNIQUE (idempotency_key);
  END IF;
END $$;

-- ── Status check constraint ───────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'prompt_compile_queue_status_check'
      AND conrelid = 'prompt_compile_queue'::regclass
  ) THEN
    ALTER TABLE prompt_compile_queue
      ADD CONSTRAINT prompt_compile_queue_status_check
      CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'));
  END IF;
END $$;

-- ── Indexes ───────────────────────────────────────────────────────────────────

-- Fan-out: fetch all jobs for a specific ticket
CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_ticket_id
  ON prompt_compile_queue (ticket_id);

-- Worker poll: active jobs ready for processing ordered by schedule
CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_pending
  ON prompt_compile_queue (next_attempt_at)
  WHERE status IN ('pending', 'running');

-- Metrics: filter by status for monitoring queries
CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_status
  ON prompt_compile_queue (status);

-- ── Down migration (manual test environments only) ────────────────────────────
-- DROP TABLE IF EXISTS prompt_compile_queue;
