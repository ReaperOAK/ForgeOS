-- Add missing event_type enum values.
-- This migration runs OUTSIDE a transaction because ALTER TYPE ... ADD VALUE
-- cannot execute inside a transaction block in PostgreSQL.
-- The .notx. marker in the filename tells migrate.ts to skip BEGIN/COMMIT.

ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'HEARTBEAT';
ALTER TYPE event_type ADD VALUE IF NOT EXISTS 'COMPLETED';
