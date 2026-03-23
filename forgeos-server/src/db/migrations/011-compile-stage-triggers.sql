-- 011-compile-stage-triggers.sql
-- Auto-enqueue prompt compilation when tickets advance to executable stages.
-- This ensures agents at BACKEND, FRONTEND stages get pre-compiled execution packets.
-- Previously only READY stage triggered compilation.

-- Trigger function: fires on ticket stage updates to insert into compile queue
CREATE OR REPLACE FUNCTION trigger_compile_on_stage_change()
RETURNS TRIGGER AS $$
DECLARE
  trigger_stages ticket_stage[] := ARRAY['READY', 'BACKEND', 'FRONTEND']::ticket_stage[];
  idem_key TEXT;
BEGIN
  -- Only fire when stage changes to one of the trigger stages
  IF NEW.stage = ANY(trigger_stages)
     AND (OLD.stage IS NULL OR OLD.stage != NEW.stage)
  THEN
    idem_key := NEW.ticket_id || ':stage:' || NEW.stage || ':' || extract(epoch from NOW())::TEXT;

    INSERT INTO prompt_compile_queue
      (ticket_id, idempotency_key, status, attempts, max_attempts,
       next_attempt_at, created_at, updated_at)
    VALUES
      (NEW.ticket_id, idem_key, 'pending', 0, 3, NOW(), NOW(), NOW())
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to tickets table (replace if exists)
DROP TRIGGER IF EXISTS trg_compile_on_stage_change ON tickets;
CREATE TRIGGER trg_compile_on_stage_change
  AFTER UPDATE OF stage ON tickets
  FOR EACH ROW
  EXECUTE FUNCTION trigger_compile_on_stage_change();
