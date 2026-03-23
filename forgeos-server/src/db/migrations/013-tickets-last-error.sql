-- 013-tickets-last-error.sql
-- Adds last_error column to tickets for compiler error tracking.
-- The compiler writes compile failures to this column for debugging.

ALTER TABLE tickets
  ADD COLUMN IF NOT EXISTS last_error TEXT;
