/**
 * File-level mutex system for concurrent file lock management.
 *
 * Provides atomic file locking primitives that prevent two agents from
 * modifying the same workspace file concurrently. Backed by the
 * `file_locks` PostgreSQL table with a partial unique index on
 * `(file_path) WHERE released_at IS NULL` to guarantee mutual exclusion
 * at the database level.
 *
 * Core operations:
 * - {@link acquireFileLocks} — Lock files for a ticket (INSERT ON CONFLICT DO NOTHING)
 * - {@link checkFileConflicts} — Detect which files are held by other tickets
 * - {@link releaseFileLocks} — Release all active locks for a ticket
 *
 * All mutations are wrapped in transactions and emit audit events
 * (`FILE_LOCKED` / `FILE_UNLOCKED`) to the `events` table.
 *
 * @module db/file-mutex
 * @ticket TASK-FOS-04-003
 */

import { getPool } from './pool.js';
import { logger } from '../middleware/logging.js';
import type { FileLock } from '../types/index.js';

// ── Domain Error Types ───────────────────────────────────────────────────────

/**
 * Describes a single file conflict: the file path and the ticket holding it.
 */
export interface FileConflictDetail {
  /** Workspace-relative path of the conflicting file. */
  file_path: string;
  /** `ticket_id` of the ticket that holds the active lock. */
  locked_by_ticket: string;
  /** UUID of the agent holding the lock. `null` if unknown. */
  locked_by_agent: string | null;
  /** Hostname of the machine holding the lock. `null` if unknown. */
  locked_by_machine: string | null;
  /** ISO 8601 timestamp when the lock was acquired. */
  locked_at: string;
}

/**
 * Error thrown when file lock acquisition fails due to conflicts.
 *
 * Contains structured details of every conflicting file so callers can
 * report which files are locked by which tickets.
 */
export class FileConflictError extends Error {
  readonly code = 'FILE_CONFLICT' as const;
  readonly statusCode = 409;

  constructor(
    public readonly ticketId: string,
    public readonly conflicts: FileConflictDetail[],
  ) {
    const paths = conflicts.map((c) => c.file_path).join(', ');
    super(`File conflict for ticket ${ticketId}: files locked by other tickets — ${paths}`);
    this.name = 'FileConflictError';
  }
}

// ── Result Types ─────────────────────────────────────────────────────────────

/**
 * Result of a successful {@link acquireFileLocks} operation.
 */
export interface AcquireFileLocksResult {
  /** The `ticket_id` that acquired the locks. */
  ticket_id: string;
  /** Array of file paths that were successfully locked. */
  locked_files: string[];
  /** Number of files that were locked. */
  lock_count: number;
}

/**
 * Result of a successful {@link releaseFileLocks} operation.
 */
export interface ReleaseFileLocksResult {
  /** The `ticket_id` whose locks were released. */
  ticket_id: string;
  /** Array of file paths that were unlocked. */
  released_files: string[];
  /** Number of locks that were released. */
  release_count: number;
}

// ── Core Operations ──────────────────────────────────────────────────────────

/**
 * Check for file conflicts before attempting to acquire locks.
 *
 * Queries the `file_locks` table for active locks (released_at IS NULL)
 * on the given file paths that belong to a **different** ticket.
 *
 * @param ticketId - The ticket attempting to lock the files
 * @param filePaths - Workspace-relative file paths to check
 * @returns Array of conflict details; empty if no conflicts
 *
 * @example
 * ```ts
 * const conflicts = await checkFileConflicts('TASK-FOS-04-003', ['src/db/pool.ts']);
 * if (conflicts.length > 0) {
 *   throw new FileConflictError('TASK-FOS-04-003', conflicts);
 * }
 * ```
 */
export async function checkFileConflicts(
  ticketId: string,
  filePaths: string[],
): Promise<FileConflictDetail[]> {
  if (filePaths.length === 0) {
    return [];
  }

  const pool = getPool();

  const result = await pool.query<{
    file_path: string;
    ticket_id: string;
    locked_by: string | null;
    machine_id: string | null;
    locked_at: string;
  }>(
    `SELECT file_path, ticket_id, locked_by, machine_id, locked_at
     FROM file_locks
     WHERE file_path = ANY($1)
       AND released_at IS NULL
       AND ticket_id <> $2`,
    [filePaths, ticketId],
  );

  const conflicts: FileConflictDetail[] = result.rows.map((row) => ({
    file_path: row.file_path,
    locked_by_ticket: row.ticket_id,
    locked_by_agent: row.locked_by,
    locked_by_machine: row.machine_id,
    locked_at: new Date(row.locked_at).toISOString(),
  }));

  if (conflicts.length > 0) {
    logger.warn(
      {
        event: 'file_conflict_detected',
        ticketId,
        conflictCount: conflicts.length,
        conflictingFiles: conflicts.map((c) => c.file_path),
      },
      'File conflicts detected during lock check',
    );
  }

  return conflicts;
}

/**
 * Acquire file locks for a ticket's file paths.
 *
 * Uses `INSERT ... ON CONFLICT (file_path) WHERE released_at IS NULL DO NOTHING`
 * to atomically attempt to lock all files. If any file is already locked by a
 * different ticket, the conflicting INSERT is silently skipped.
 *
 * After the INSERT, the function compares the number of actually inserted rows
 * against the requested count. If any were skipped (conflict), it queries for
 * the conflicting locks and throws a {@link FileConflictError}.
 *
 * All operations run within a single transaction for atomicity: either all
 * locks are acquired or none are (on conflict, the transaction rolls back
 * the partial inserts).
 *
 * @param ticketId - The ticket acquiring the locks
 * @param filePaths - Workspace-relative file paths to lock
 * @param agentId - UUID of the agent acquiring the locks (nullable)
 * @param machineId - Hostname of the machine acquiring the locks (nullable)
 * @returns Result with the list of locked files
 * @throws {@link FileConflictError} if any file is already locked by another ticket
 *
 * @example
 * ```ts
 * const result = await acquireFileLocks(
 *   'TASK-FOS-04-003',
 *   ['src/db/file-mutex.ts'],
 *   'agent-uuid-123',
 *   'pop-os',
 * );
 * // result.locked_files === ['src/db/file-mutex.ts']
 * ```
 */
export async function acquireFileLocks(
  ticketId: string,
  filePaths: string[],
  agentId: string | null,
  machineId: string | null,
): Promise<AcquireFileLocksResult> {
  if (filePaths.length === 0) {
    return { ticket_id: ticketId, locked_files: [], lock_count: 0 };
  }

  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Attempt to insert lock records for all file paths.
    // ON CONFLICT DO NOTHING silently skips files already locked.
    const insertResult = await client.query<{ file_path: string }>(
      `INSERT INTO file_locks (file_path, ticket_id, locked_by, machine_id)
       SELECT unnest($1::text[]), $2, $3, $4
       ON CONFLICT (file_path) WHERE released_at IS NULL
       DO NOTHING
       RETURNING file_path`,
      [filePaths, ticketId, agentId, machineId],
    );

    const lockedFiles = insertResult.rows.map((row) => row.file_path);
    const skippedCount = filePaths.length - lockedFiles.length;

    // If any inserts were skipped, there are conflicts — rollback and report.
    if (skippedCount > 0) {
      // Query the conflicting locks to provide detailed error information.
      const conflictResult = await client.query<{
        file_path: string;
        ticket_id: string;
        locked_by: string | null;
        machine_id: string | null;
        locked_at: string;
      }>(
        `SELECT file_path, ticket_id, locked_by, machine_id, locked_at
         FROM file_locks
         WHERE file_path = ANY($1)
           AND released_at IS NULL
           AND ticket_id <> $2`,
        [filePaths, ticketId],
      );

      const conflicts: FileConflictDetail[] = conflictResult.rows.map((row) => ({
        file_path: row.file_path,
        locked_by_ticket: row.ticket_id,
        locked_by_agent: row.locked_by,
        locked_by_machine: row.machine_id,
        locked_at: new Date(row.locked_at).toISOString(),
      }));

      await client.query('ROLLBACK');

      logger.warn(
        {
          event: 'file_lock_conflict',
          ticketId,
          requestedFiles: filePaths,
          conflicts: conflicts.map((c) => ({
            file: c.file_path,
            owner: c.locked_by_ticket,
          })),
        },
        'File lock acquisition failed due to conflicts',
      );

      throw new FileConflictError(ticketId, conflicts);
    }

    // Record FILE_LOCKED events for each acquired lock.
    for (const filePath of lockedFiles) {
      await client.query(
        `INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, payload)
         VALUES ($1, 'FILE_LOCKED', $2, $3, $4, $5)`,
        [
          ticketId,
          agentId,
          agentId,
          machineId,
          JSON.stringify({ file_path: filePath }),
        ],
      );
    }

    await client.query('COMMIT');

    logger.info(
      {
        event: 'file_locks_acquired',
        ticketId,
        lockedFiles,
        lockCount: lockedFiles.length,
      },
      'File locks acquired successfully',
    );

    return {
      ticket_id: ticketId,
      locked_files: lockedFiles,
      lock_count: lockedFiles.length,
    };
  } catch (err) {
    // Rollback only if we haven't already (conflict path does its own rollback).
    if (!(err instanceof FileConflictError)) {
      await client.query('ROLLBACK').catch(() => {
        /* ignore rollback errors on already-failed connection */
      });
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Release all active file locks belonging to a ticket.
 *
 * Sets `released_at = NOW()` for every lock record where
 * `ticket_id` matches and `released_at IS NULL`. Records a
 * `FILE_UNLOCKED` audit event for each released lock.
 *
 * @param ticketId - The ticket whose locks should be released
 * @returns Result with the list of released file paths
 *
 * @example
 * ```ts
 * const result = await releaseFileLocks('TASK-FOS-04-003');
 * // result.released_files === ['src/db/file-mutex.ts']
 * ```
 */
export async function releaseFileLocks(
  ticketId: string,
): Promise<ReleaseFileLocksResult> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Release all active locks for the ticket, returning the released paths.
    const releaseResult = await client.query<{ file_path: string; locked_by: string | null; machine_id: string | null }>(
      `UPDATE file_locks
       SET released_at = NOW()
       WHERE ticket_id = $1
         AND released_at IS NULL
       RETURNING file_path, locked_by, machine_id`,
      [ticketId],
    );

    const releasedFiles = releaseResult.rows.map((row) => row.file_path);

    // Record FILE_UNLOCKED events for each released lock.
    for (const row of releaseResult.rows) {
      await client.query(
        `INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, payload)
         VALUES ($1, 'FILE_UNLOCKED', $2, $3, $4, $5)`,
        [
          ticketId,
          row.locked_by,
          row.locked_by,
          row.machine_id,
          JSON.stringify({ file_path: row.file_path }),
        ],
      );
    }

    await client.query('COMMIT');

    if (releasedFiles.length > 0) {
      logger.info(
        {
          event: 'file_locks_released',
          ticketId,
          releasedFiles,
          releaseCount: releasedFiles.length,
        },
        'File locks released successfully',
      );
    } else {
      logger.debug(
        { event: 'file_locks_release_noop', ticketId },
        'No active file locks found for ticket',
      );
    }

    return {
      ticket_id: ticketId,
      released_files: releasedFiles,
      release_count: releasedFiles.length,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* ignore rollback errors on already-failed connection */
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Get all active file locks for a specific ticket.
 *
 * @param ticketId - The ticket to query locks for
 * @returns Array of active FileLock records
 */
export async function getActiveLocksForTicket(
  ticketId: string,
): Promise<FileLock[]> {
  const pool = getPool();

  const result = await pool.query<FileLock>(
    `SELECT id, file_path, ticket_id, locked_by, machine_id, locked_at, released_at
     FROM file_locks
     WHERE ticket_id = $1
       AND released_at IS NULL
     ORDER BY locked_at ASC`,
    [ticketId],
  );

  return result.rows;
}

/**
 * Get the active lock for a specific file path, if any.
 *
 * @param filePath - Workspace-relative file path to check
 * @returns The active FileLock, or `null` if the file is unlocked
 */
export async function getActiveLockForFile(
  filePath: string,
): Promise<FileLock | null> {
  const pool = getPool();

  const result = await pool.query<FileLock>(
    `SELECT id, file_path, ticket_id, locked_by, machine_id, locked_at, released_at
     FROM file_locks
     WHERE file_path = $1
       AND released_at IS NULL`,
    [filePath],
  );

  return result.rows[0] ?? null;
}
