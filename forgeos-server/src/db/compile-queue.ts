/**
 * Prompt Compile Queue — database helpers.
 *
 * Provides idempotent enqueue and lookup operations for the
 * `prompt_compile_queue` table introduced in migration 009.
 *
 * All helpers use the shared connection pool and emit structured logs.
 * No `console.log` — use `logger` only.
 *
 * @module db/compile-queue
 * @ticket TASK-PC-BE-008
 */

import { pool } from './pool.js';
import { logger } from '../middleware/logging.js';
import type { PromptCompileJob } from '../types/index.js';

// ── Row mapper ────────────────────────────────────────────────────────────────

/**
 * Map a raw PostgreSQL row to a typed `PromptCompileJob`.
 *
 * pg returns all columns as strings or native JS types depending on the OID.
 * We normalise timestamps to ISO 8601 strings and coerce numerics explicitly.
 */
function rowToJob(row: Record<string, unknown>): PromptCompileJob {
  return {
    id: row['id'] as string,
    ticket_id: row['ticket_id'] as string,
    idempotency_key: row['idempotency_key'] as string,
    status: row['status'] as PromptCompileJob['status'],
    attempts: Number(row['attempts']),
    max_attempts: Number(row['max_attempts']),
    next_attempt_at:
      row['next_attempt_at'] instanceof Date
        ? (row['next_attempt_at'] as Date).toISOString()
        : (row['next_attempt_at'] as string),
    last_error: (row['last_error'] as string | null) ?? null,
    input_hash: (row['input_hash'] as string | null) ?? null,
    created_at:
      row['created_at'] instanceof Date
        ? (row['created_at'] as Date).toISOString()
        : (row['created_at'] as string),
    updated_at:
      row['updated_at'] instanceof Date
        ? (row['updated_at'] as Date).toISOString()
        : (row['updated_at'] as string),
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Enqueue a prompt compile job for the given ticket and input hash.
 *
 * The idempotency key is derived as `{ticketId}:{inputHash}`.  If a job
 * with the same key already exists the function returns the existing row
 * without creating a duplicate (ON CONFLICT DO UPDATE SET updated_at only).
 *
 * @param ticketId  - The `ticket_id` of the ticket to compile.
 * @param inputHash - sha256-hex context hash computed from the compile inputs.
 * @returns The newly created or pre-existing `PromptCompileJob`.
 */
export async function enqueueCompileJob(
  ticketId: string,
  inputHash: string,
): Promise<PromptCompileJob> {
  const idempotencyKey = `${ticketId}:${inputHash}`;

  const sql = `
    INSERT INTO prompt_compile_queue
      (ticket_id, idempotency_key, status, attempts, max_attempts,
       next_attempt_at, input_hash, created_at, updated_at)
    VALUES
      ($1, $2, 'pending', 0, 3, NOW(), $3, NOW(), NOW())
    ON CONFLICT (idempotency_key) DO UPDATE
      SET updated_at = NOW()
    RETURNING *
  `;

  const result = await pool.query(sql, [ticketId, idempotencyKey, inputHash]);

  const job = rowToJob(result.rows[0] as Record<string, unknown>);

  logger.info(
    {
      event: 'compile_job_enqueued',
      ticket_id: ticketId,
      idempotency_key: idempotencyKey,
      job_id: job.id,
      status: job.status,
    },
    'Prompt compile job enqueued',
  );

  return job;
}

/**
 * Fetch a compile job by its idempotency key.
 *
 * Returns `null` if no matching job exists.
 *
 * @param idempotencyKey - The exact key used during {@link enqueueCompileJob}.
 * @returns The `PromptCompileJob` or `null`.
 */
export async function getCompileJob(
  idempotencyKey: string,
): Promise<PromptCompileJob | null> {
  const sql = `
    SELECT * FROM prompt_compile_queue
    WHERE idempotency_key = $1
    LIMIT 1
  `;

  const result = await pool.query(sql, [idempotencyKey]);

  if (result.rows.length === 0) {
    return null;
  }

  return rowToJob(result.rows[0] as Record<string, unknown>);
}
