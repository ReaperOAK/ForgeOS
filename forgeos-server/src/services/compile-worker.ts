/**
 * Durable Compile Queue Worker.
 *
 * Polls the `prompt_compile_queue` PostgreSQL table using `FOR UPDATE SKIP LOCKED`
 * to atomically claim and process pending compile jobs. Replaces the previous
 * in-memory queue with a crash-safe, durable alternative.
 *
 * Features:
 * - SKIP LOCKED polling — safe for multiple concurrent workers
 * - Exponential backoff on retry (2^attempts seconds)
 * - Dead-letter after max_attempts (default 3)
 * - Graceful shutdown via AbortController
 * - Structured Pino logging with job context
 *
 * @module services/compile-worker
 */

import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import { compileAndStoreTicketPrompt } from './compiler.js';
import type { PromptCompileJob } from '../types/index.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CompileWorkerOptions {
  /** Polling interval in milliseconds (default 5000). */
  pollIntervalMs: number;
  /** Whether the worker is enabled (default true). */
  enabled: boolean;
}

export interface CompileWorkerHandle {
  /** Stop the worker gracefully. Resolves when the current job (if any) finishes. */
  stop(): Promise<void>;
  /** Whether the worker is currently running. */
  isRunning(): boolean;
}

// ── Worker Implementation ─────────────────────────────────────────────────────

/**
 * Start the durable compile queue worker.
 *
 * The worker polls `prompt_compile_queue` at the configured interval,
 * claiming one pending job per cycle via `FOR UPDATE SKIP LOCKED`.
 *
 * @param options - Worker configuration
 * @returns A handle to stop the worker gracefully
 */
export function startCompileWorker(options: CompileWorkerOptions): CompileWorkerHandle {
  if (!options.enabled) {
    logger.info('Compile worker disabled via config');
    return { stop: async () => {}, isRunning: () => false };
  }

  const abortController = new AbortController();
  let running = true;
  let processing = false;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;

  const workerLogger = logger.child({ component: 'compile-worker' });

  async function pollOnce(): Promise<void> {
    if (abortController.signal.aborted) return;

    try {
      processing = true;
      const job = await claimNextJob();
      if (!job) {
        processing = false;
        return;
      }

      workerLogger.info(
        { job_id: job.id, ticket_id: job.ticket_id, attempt: job.attempts },
        'Processing compile job',
      );

      const startTime = Date.now();
      try {
        await compileAndStoreTicketPrompt(job.ticket_id);
        await markJobDone(job.id);
        const durationMs = Date.now() - startTime;
        workerLogger.info(
          { job_id: job.id, ticket_id: job.ticket_id, durationMs },
          'Compile job completed',
        );
      } catch (err) {
        const durationMs = Date.now() - startTime;
        const errorMessage = err instanceof Error ? err.message : String(err);

        if (job.attempts >= job.max_attempts) {
          await markJobFailed(job.id, errorMessage);
          workerLogger.error(
            { job_id: job.id, ticket_id: job.ticket_id, attempts: job.attempts, durationMs },
            'Compile job dead-lettered (max attempts exceeded)',
          );
        } else {
          await scheduleRetry(job.id, job.attempts, errorMessage);
          workerLogger.warn(
            { job_id: job.id, ticket_id: job.ticket_id, attempts: job.attempts, durationMs, err: errorMessage },
            'Compile job failed, scheduled retry',
          );
        }
      }
    } catch (err) {
      workerLogger.error({ err }, 'Compile worker poll error');
    } finally {
      processing = false;
    }
  }

  function schedulePoll(): void {
    if (abortController.signal.aborted) return;
    pollTimer = setTimeout(() => {
      void pollOnce().then(schedulePoll);
    }, options.pollIntervalMs);
  }

  // Start polling
  workerLogger.info(
    { pollIntervalMs: options.pollIntervalMs },
    'Compile worker started',
  );
  schedulePoll();

  return {
    async stop(): Promise<void> {
      running = false;
      abortController.abort();
      if (pollTimer) clearTimeout(pollTimer);

      // Wait for current job to finish (up to 30s)
      const deadline = Date.now() + 30_000;
      while (processing && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200));
      }

      workerLogger.info('Compile worker stopped');
    },
    isRunning(): boolean {
      return running && !abortController.signal.aborted;
    },
  };
}

// ── SQL Operations ────────────────────────────────────────────────────────────

/**
 * Atomically claim the next pending job using FOR UPDATE SKIP LOCKED.
 * Returns null if no jobs are available.
 */
async function claimNextJob(): Promise<PromptCompileJob | null> {
  const sql = `
    UPDATE prompt_compile_queue
    SET status = 'running',
        attempts = attempts + 1,
        updated_at = NOW()
    WHERE id = (
      SELECT id FROM prompt_compile_queue
      WHERE status = 'pending'
        AND next_attempt_at <= NOW()
      ORDER BY created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `;

  const result = await pool.query(sql);
  if (result.rows.length === 0) return null;

  const row = result.rows[0] as Record<string, unknown>;
  return {
    id: row['id'] as string,
    ticket_id: row['ticket_id'] as string,
    idempotency_key: row['idempotency_key'] as string,
    status: row['status'] as PromptCompileJob['status'],
    attempts: Number(row['attempts']),
    max_attempts: Number(row['max_attempts']),
    next_attempt_at: String(row['next_attempt_at']),
    last_error: (row['last_error'] as string | null) ?? null,
    input_hash: (row['input_hash'] as string | null) ?? null,
    created_at: String(row['created_at']),
    updated_at: String(row['updated_at']),
  };
}

/** Mark a job as successfully completed. */
async function markJobDone(jobId: string): Promise<void> {
  await pool.query(
    `UPDATE prompt_compile_queue SET status = 'done', updated_at = NOW() WHERE id = $1`,
    [jobId],
  );
}

/** Mark a job as permanently failed (dead letter). */
async function markJobFailed(jobId: string, errorMessage: string): Promise<void> {
  await pool.query(
    `UPDATE prompt_compile_queue SET status = 'failed', last_error = $2, updated_at = NOW() WHERE id = $1`,
    [jobId, errorMessage],
  );
}

/** Schedule a retry with exponential backoff. */
async function scheduleRetry(jobId: string, currentAttempts: number, errorMessage: string): Promise<void> {
  const backoffSeconds = Math.pow(2, currentAttempts);
  await pool.query(
    `UPDATE prompt_compile_queue
     SET status = 'pending',
         next_attempt_at = NOW() + ($2 || ' seconds')::interval,
         last_error = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [jobId, String(backoffSeconds), errorMessage],
  );
}
