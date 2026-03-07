#!/usr/bin/env tsx
/**
 * CLI entry point: seed database and import tickets from filesystem.
 *
 * Runs the seed (default project + admin agent) and then imports all
 * ticket JSON files from `.github/tickets/` into the database.
 *
 * Usage:
 *   npx tsx scripts/import-tickets.ts [workspace-path]
 *
 * If `workspace-path` is omitted, defaults to the repository root
 * (two levels above this script: `forgeos-server/scripts/` → repo root).
 *
 * @module scripts/import-tickets
 * @ticket TASK-FOS-01-003
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { seed } from '../src/db/seed.js';
import { importTickets } from '../src/db/import.js';
import { runMigrations } from '../src/db/migrate.js';
import { closePool } from '../src/db/pool.js';
import { logger } from '../src/middleware/logging.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve the workspace root path.
 *
 * Priority:
 * 1. CLI argument (`process.argv[2]`)
 * 2. `WORKSPACE_PATH` environment variable
 * 3. Default: two levels up from this script (`forgeos-server/scripts/` → repo root)
 */
function resolveWorkspacePath(): string {
  if (process.argv[2]) {
    return path.resolve(process.argv[2]);
  }
  if (process.env['WORKSPACE_PATH']) {
    return path.resolve(process.env['WORKSPACE_PATH']);
  }
  // Default: repo root is two directories up from scripts/
  return path.resolve(__dirname, '..', '..');
}

/**
 * Main entry point. Runs migrations, seed, and import in sequence.
 */
async function main(): Promise<void> {
  const workspacePath = resolveWorkspacePath();

  logger.info(
    { event: 'import_cli_start', workspacePath },
    `Starting seed + import (workspace: ${workspacePath})`,
  );

  try {
    // Step 1: Run pending migrations (idempotent)
    process.stdout.write('Step 1/3: Running migrations...\n');
    const migrationsApplied = await runMigrations();
    process.stdout.write(`  Applied ${migrationsApplied} migration(s)\n`);

    // Step 2: Seed default project and admin agent
    process.stdout.write('Step 2/3: Seeding database...\n');
    const seedResult = await seed();
    process.stdout.write(
      `  Project ID: ${seedResult.projectId}\n` +
      `  Agent ID:   ${seedResult.agentId}\n` +
      `  Key generated: ${seedResult.keyGenerated}\n`,
    );

    // Step 3: Import tickets from filesystem
    process.stdout.write('Step 3/3: Importing tickets...\n');
    const summary = await importTickets(workspacePath, seedResult.projectId);

    // Final exit code: 0 if no errors, 1 if any errors
    const exitCode = summary.errors > 0 ? 1 : 0;

    if (exitCode === 0) {
      process.stdout.write('All steps completed successfully.\n');
    } else {
      process.stderr.write(`Completed with ${summary.errors} error(s).\n`);
    }

    await closePool();
    process.exit(exitCode);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error(
      { event: 'import_cli_fatal', error: errorMessage },
      `Fatal error: ${errorMessage}`,
    );
    process.stderr.write(`Fatal error: ${errorMessage}\n`);
    await closePool();
    process.exit(1);
  }
}

main();
