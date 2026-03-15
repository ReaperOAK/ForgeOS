/**
 * QA regression tests for the prompt compile queue migration and public exports.
 *
 * These tests validate the migration artifact directly so schema expectations
 * and idempotency guards stay enforced even without a live database in unit
 * test runs.
 *
 * @module __tests__/compile-queue-migration
 * @ticket TASK-PC-BE-008
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'src/db/migrations/009-prompt-compile-queue.sql',
);
const migrationSql = readFileSync(migrationPath, 'utf8');
const dbIndexPath = resolve(process.cwd(), 'src/db/index.ts');
const dbIndexSource = readFileSync(dbIndexPath, 'utf8');

describe('prompt compile queue migration', () => {
  it('AC1 — defines the durable queue table with status and retry fields', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS prompt_compile_queue');
    expect(migrationSql).toContain('status          TEXT        NOT NULL DEFAULT \'pending\'');
    expect(migrationSql).toContain('attempts        INTEGER     NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('max_attempts    INTEGER     NOT NULL DEFAULT 3');
    expect(migrationSql).toContain('next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(migrationSql).toContain('last_error      TEXT');
    expect(migrationSql).toContain('created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(migrationSql).toContain('updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()');
  });

  it('AC2 — enforces idempotency with a unique constraint on idempotency_key', () => {
    expect(migrationSql).toContain('ADD CONSTRAINT prompt_compile_queue_idempotency_key_unique');
    expect(migrationSql).toContain('UNIQUE (idempotency_key);');
  });

  it('AC3 — provisions operational query support for attempts, scheduling, and errors', () => {
    expect(migrationSql).toContain('attempts        INTEGER     NOT NULL DEFAULT 0');
    expect(migrationSql).toContain('next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW()');
    expect(migrationSql).toContain('last_error      TEXT');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_pending');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_status');
  });

  it('AC4 — uses idempotent DDL guards so reruns do not create duplicate artifacts', () => {
    expect(migrationSql).toContain('CREATE TABLE IF NOT EXISTS prompt_compile_queue');
    expect(migrationSql).toContain("WHERE conname = 'prompt_compile_queue_idempotency_key_unique'");
    expect(migrationSql).toContain("WHERE conname = 'prompt_compile_queue_status_check'");
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_ticket_id');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_pending');
    expect(migrationSql).toContain('CREATE INDEX IF NOT EXISTS idx_prompt_compile_queue_status');
  });

  it('restricts status to the expected lifecycle values', () => {
    expect(migrationSql).toContain("CHECK (status IN ('pending', 'running', 'done', 'failed', 'cancelled'))");
  });
});

describe('db barrel exports for queue helpers', () => {
  it('re-exports enqueueCompileJob and getCompileJob from db/index.ts', () => {
    expect(dbIndexSource).toContain('enqueueCompileJob');
    expect(dbIndexSource).toContain('getCompileJob');
    expect(dbIndexSource).toContain("} from './compile-queue.js';");
  });
});