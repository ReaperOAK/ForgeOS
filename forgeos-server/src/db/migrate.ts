/**
 * Database migration runner with checksum verification.
 *
 * Reads SQL migration files from the migrations directory, computes SHA-256
 * checksums, and executes them in lexicographic order. Tracks applied
 * migrations in a `schema_migrations` table for idempotent re-runs.
 *
 * @module db/migrate
 * @ticket TASK-FOS-01-002
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { getPool } from './pool.js';
import { logger } from '../middleware/logging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 checksum of a migration file's contents.
 */
function computeChecksum(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

/** Record of an applied migration from the `schema_migrations` table. */
interface AppliedMigration {
  name: string;
  checksum: string;
}

// ── Internal Functions ───────────────────────────────────────────────────────

/**
 * Ensure the `schema_migrations` tracking table exists.
 *
 * Columns:
 * - `name` — migration filename (unique)
 * - `checksum` — SHA-256 hex digest of the file contents at apply time
 * - `applied_at` — timestamp of when the migration was executed
 */
async function ensureMigrationsTable(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      checksum TEXT NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * Get list of already-applied migrations with their checksums.
 */
async function getAppliedMigrations(): Promise<AppliedMigration[]> {
  const pool = getPool();
  const result = await pool.query<AppliedMigration>(
    'SELECT name, checksum FROM schema_migrations ORDER BY id ASC',
  );
  return result.rows;
}

/**
 * Get list of SQL migration files sorted lexicographically.
 */
function getMigrationFiles(): string[] {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    logger.warn(
      { dir: MIGRATIONS_DIR, event: 'migrations_dir_missing' },
      'Migrations directory not found',
    );
    return [];
  }
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run all pending migrations in lexicographic order.
 *
 * 1. Creates `schema_migrations` table if it doesn't exist.
 * 2. Reads all `.sql` files from the migrations directory.
 * 3. Verifies checksums of previously-applied migrations — throws on mismatch.
 * 4. Applies pending migrations inside individual transactions.
 * 5. Records name, checksum, and timestamp for each applied migration.
 *
 * Idempotent: safe to call multiple times; already-applied migrations
 * are skipped.
 *
 * @returns Number of migrations applied
 * @throws Error if an applied migration's file has been modified (checksum mismatch)
 */
export async function runMigrations(): Promise<number> {
  await ensureMigrationsTable();

  const applied = await getAppliedMigrations();
  const appliedMap = new Map(applied.map((m) => [m.name, m.checksum]));
  const files = getMigrationFiles();

  // Verify checksums of already-applied migrations
  for (const file of files) {
    const existingChecksum = appliedMap.get(file);
    if (existingChecksum !== undefined) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const content = fs.readFileSync(filePath, 'utf-8');
      const currentChecksum = computeChecksum(content);
      if (existingChecksum !== currentChecksum) {
        const message =
          `Migration checksum mismatch for ${file}: ` +
          `expected ${existingChecksum}, got ${currentChecksum}. ` +
          'Applied migrations must not be modified.';
        logger.error(
          {
            event: 'migration_checksum_mismatch',
            migration: file,
            expected: existingChecksum,
            actual: currentChecksum,
          },
          message,
        );
        throw new Error(message);
      }
    }
  }

  const pending = files.filter((f) => !appliedMap.has(f));

  if (pending.length === 0) {
    logger.info({ event: 'migrations_none_pending' }, 'No pending migrations');
    return 0;
  }

  logger.info(
    { count: pending.length, event: 'migrations_pending' },
    'Running pending migrations',
  );

  const pool = getPool();

  for (const file of pending) {
    const filePath = path.join(MIGRATIONS_DIR, file);
    const sql = fs.readFileSync(filePath, 'utf-8');
    const checksum = computeChecksum(sql);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)',
        [file, checksum],
      );
      await client.query('COMMIT');
      logger.info(
        { event: 'migration_applied', migration: file, checksum },
        'Migration applied',
      );
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {
        /* ignore rollback errors on already-failed connection */
      });
      logger.error(
        { event: 'migration_failed', migration: file, err },
        'Migration failed',
      );
      throw err;
    } finally {
      client.release();
    }
  }

  return pending.length;
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

const isDirectRun = process.argv[1]?.includes('migrate');
if (isDirectRun) {
  runMigrations()
    .then((count) => {
      logger.info({ count }, 'Migrations complete');
      process.exit(0);
    })
    .catch((err) => {
      logger.error({ err }, 'Migration runner failed');
      process.exit(1);
    });
}
