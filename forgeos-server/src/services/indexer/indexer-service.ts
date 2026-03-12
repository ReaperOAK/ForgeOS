/**
 * Indexer Service — incremental codebase indexing with change detection.
 *
 * Walks a workspace directory via {@link walkDirectory}, compares SHA-256
 * hashes against the `code_files` table, and upserts only changed files.
 * Returns an {@link IndexResult} summarising what was processed.
 *
 * @module services/indexer/indexer-service
 * @ticket TASK-INT-BE021
 */

import type { Pool, PoolClient } from 'pg';
import { walkDirectory, type FileEntry, type WalkOptions } from './file-walker.js';
import { logger } from '../../middleware/logging.js';

// ── Public Types ─────────────────────────────────────────────────────────────

/** Summary returned after an indexing run. */
export interface IndexResult {
  /** Total files discovered by the walker. */
  total: number;
  /** Files whose hash differed from the database (re-indexed). */
  changed: number;
  /** Files whose hash matched (skipped). */
  unchanged: number;
  /** Files that were removed from disk but still in the database. */
  removed: number;
  /** The changed file entries for downstream parser processing. */
  changedFiles: FileEntry[];
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Core indexer service.
 *
 * Compares the on-disk file tree against the `code_files` table and
 * upserts only those rows whose content hash has changed. Deleted files
 * are also cleaned from the database.
 */
export class IndexerService {
  constructor(private readonly pool: Pool) {}

  /**
   * Index a workspace root and return a change summary.
   *
   * @param rootPath    - Absolute path to the workspace root.
   * @param walkOptions - Forwarded to {@link walkDirectory}.
   * @returns The indexing result with changed-file details.
   */
  async indexWorkspace(
    rootPath: string,
    walkOptions?: WalkOptions,
  ): Promise<IndexResult> {
    logger.info({ rootPath }, 'indexer: starting workspace index');

    // 1. Walk the filesystem
    const files = await walkDirectory(rootPath, walkOptions);
    logger.info({ fileCount: files.length }, 'indexer: walk complete');

    // 2. Fetch existing hashes from the database
    const existingRows = await this.pool.query<{
      file_path: string;
      content_hash: string;
    }>('SELECT file_path, content_hash FROM code_files');

    const existingMap = new Map<string, string>();
    for (const row of existingRows.rows) {
      existingMap.set(row.file_path, row.content_hash);
    }

    // 3. Determine changed files (new or updated hash)
    const changed: FileEntry[] = [];
    const currentPaths = new Set<string>();

    for (const file of files) {
      currentPaths.add(file.path);
      const existingHash = existingMap.get(file.path);
      if (existingHash !== file.hash) {
        changed.push(file);
      }
    }

    // 4. Determine removed files (in DB but no longer on disk)
    const removedPaths: string[] = [];
    for (const dbPath of existingMap.keys()) {
      if (!currentPaths.has(dbPath)) {
        removedPaths.push(dbPath);
      }
    }

    // 5. Persist changes in a transaction
    if (changed.length > 0 || removedPaths.length > 0) {
      const client: PoolClient = await this.pool.connect();
      try {
        await client.query('BEGIN');

        // Upsert changed files
        for (const file of changed) {
          await client.query(
            `INSERT INTO code_files (file_path, language, content_hash, line_count)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (file_path) DO UPDATE SET
               content_hash = EXCLUDED.content_hash,
               line_count = EXCLUDED.line_count,
               language = EXCLUDED.language,
               last_indexed_at = NOW(),
               updated_at = NOW()`,
            [file.path, file.language, file.hash, file.lineCount],
          );
        }

        // Remove stale entries
        for (const removedPath of removedPaths) {
          await client.query(
            'DELETE FROM code_files WHERE file_path = $1',
            [removedPath],
          );
        }

        await client.query('COMMIT');
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        logger.error({ err }, 'indexer: transaction failed, rolled back');
        throw err;
      } finally {
        client.release();
      }
    }

    const result: IndexResult = {
      total: files.length,
      changed: changed.length,
      unchanged: files.length - changed.length,
      removed: removedPaths.length,
      changedFiles: changed,
    };

    logger.info(
      { total: result.total, changed: result.changed, removed: result.removed },
      'indexer: workspace index complete',
    );

    return result;
  }
}
