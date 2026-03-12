#!/usr/bin/env tsx
/**
 * One-time filesystem-to-PostgreSQL migration script.
 *
 * Reads existing ticket JSON from `.github/tickets/` and determines
 * current stage from `.github/ticket-state/` directories. Inserts
 * complete ticket records and reconstructed event history into the
 * PostgreSQL database.
 *
 * Features:
 *   - Idempotent: skips tickets that already exist in the database.
 *   - Dry-run mode: `--dry-run` previews changes without writing.
 *   - Graceful error handling: malformed JSON logged and skipped.
 *   - Statistics: reports total, migrated, skipped, and error counts.
 *
 * Usage:
 *   npx tsx scripts/migrate-filesystem.ts [--dry-run] [workspace-path]
 *
 * @module scripts/migrate-filesystem
 * @ticket TASK-INT-BE017
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../src/db/pool.js';
import { seed } from '../src/db/seed.js';
import { runMigrations } from '../src/db/migrate.js';
import { logger } from '../src/middleware/logging.js';
import type { TicketStage, TicketType, TicketPriority, EventType } from '../src/types/index.js';
import { SDLC_FLOWS } from '../src/types/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ── Types ────────────────────────────────────────────────────────────────────

/** Migration result statistics. */
export interface MigrationStats {
  total: number;
  migrated: number;
  skipped: number;
  errors: string[];
}

/** Raw ticket JSON structure from `.github/tickets/*.json`. */
interface RawTicketJson {
  ticket_id: string;
  title: string;
  description?: string;
  type: string;
  priority: string;
  stage: string;
  sdlc_flow?: string[];
  created_at: string;
  dependencies?: string[];
  blocked_by?: string[];
  file_paths?: string[];
  acceptance_criteria?: string[];
  rework_count?: number;
  claimed_by?: string | null;
  machine_id?: string | null;
  operator?: string | null;
  lease_expiry?: string | null;
  lease_duration_minutes?: number;
  completed_at?: string | null;
  history?: RawHistoryEntry[];
  source_task_file?: string | null;
  tags?: string[];
  parent_id?: string | null;
  metadata?: Record<string, unknown>;
}

/** Raw history entry from ticket JSON. */
interface RawHistoryEntry {
  timestamp: string;
  event: string;
  agent?: string;
  machine_id?: string;
  details?: string;
  from_stage?: string;
  to_stage?: string;
  stage?: string;
  action?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Files to exclude from migration. */
const EXCLUDED_FILES = new Set(['ticket-schema.json']);

/** Stage directory names in `.github/ticket-state/`. */
const STAGE_DIRECTORIES = [
  'READY', 'ARCHITECT', 'RESEARCH', 'BACKEND', 'FRONTEND',
  'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE',
] as const;

/**
 * Map from filesystem directory names to database `ticket_stage` enum values.
 */
const DIR_TO_DB_STAGE: Record<string, TicketStage> = {
  READY: 'READY',
  ARCHITECT: 'ARCHITECT',
  RESEARCH: 'RESEARCH',
  BACKEND: 'BACKEND',
  FRONTEND: 'FRONTEND',
  QA: 'QA',
  SECURITY: 'SECURITY',
  CI: 'CI',
  DOCS: 'DOCUMENTATION',
  VALIDATION: 'VALIDATOR',
  DONE: 'DONE',
};

/**
 * Map from JSON sdlc_flow stage names to database `ticket_stage` enum values.
 */
const JSON_STAGE_TO_DB_STAGE: Record<string, TicketStage> = {
  READY: 'READY',
  ARCHITECT: 'ARCHITECT',
  RESEARCH: 'RESEARCH',
  PRODUCT_MANAGER: 'PRODUCT_MANAGER',
  UI_DESIGN: 'UI_DESIGN',
  BACKEND: 'BACKEND',
  FRONTEND: 'FRONTEND',
  QA: 'QA',
  SECURITY: 'SECURITY',
  CI: 'CI',
  DOCS: 'DOCUMENTATION',
  DOCUMENTATION: 'DOCUMENTATION',
  VALIDATION: 'VALIDATOR',
  VALIDATOR: 'VALIDATOR',
  DONE: 'DONE',
};

/**
 * Map from JSON history event names to database `event_type` enum values.
 */
const HISTORY_EVENT_TO_DB_EVENT: Record<string, EventType> = {
  CREATED: 'CREATED',
  CLAIMED: 'CLAIMED',
  RELEASED: 'RELEASED',
  STAGE_COMPLETED: 'STAGE_ADVANCED',
  STAGE_ADVANCED: 'STAGE_ADVANCED',
  STAGE_REJECTED: 'STAGE_REJECTED',
  UPDATED: 'UPDATED',
  SPAWNED: 'SPAWNED',
  ESCALATED: 'ESCALATED',
  LEASE_EXTENDED: 'LEASE_EXTENDED',
  FORCE_RELEASED: 'FORCE_RELEASED',
  RECONCILED: 'RECONCILED',
  FILE_LOCKED: 'FILE_LOCKED',
  FILE_UNLOCKED: 'FILE_UNLOCKED',
  MOVED_TO_READY: 'UPDATED',
  BACKEND_COMPLETE: 'STAGE_ADVANCED',
  DOCS_COMPLETE: 'STAGE_ADVANCED',
};

/** Valid ticket_type enum values in the database. */
const VALID_TYPES: readonly string[] = [
  'backend', 'frontend', 'fullstack', 'infra', 'security',
  'docs', 'research', 'architecture', 'product', 'design',
];

/** Valid ticket_priority enum values in the database. */
const VALID_PRIORITIES: readonly string[] = ['critical', 'high', 'medium', 'low'];

// ── Helpers (exported for testing) ───────────────────────────────────────────

/**
 * Discover the current stage for a ticket by scanning `.github/ticket-state/`
 * directories. Falls back to mapping the JSON `stage` field.
 */
export function deriveStageFromFilesystem(
  ticketId: string,
  workspacePath: string,
  jsonStage: string,
): TicketStage {
  const ticketStateDir = path.join(workspacePath, '.github', 'ticket-state');

  for (const dirName of STAGE_DIRECTORIES) {
    const stateFile = path.join(ticketStateDir, dirName, `${ticketId}.json`);
    if (fs.existsSync(stateFile)) {
      const dbStage = DIR_TO_DB_STAGE[dirName];
      if (dbStage) return dbStage;
    }
  }

  const mapped = JSON_STAGE_TO_DB_STAGE[jsonStage];
  if (mapped) return mapped;

  logger.warn(
    { event: 'migrate_stage_fallback', ticketId, jsonStage },
    `Could not derive stage for ${ticketId}, using READY`,
  );
  return 'READY';
}

/**
 * Map a JSON sdlc_flow array to database-compatible TicketStage values.
 */
export function mapSdlcFlow(jsonFlow: string[], ticketType: string): TicketStage[] {
  const mapped = jsonFlow
    .map((s) => JSON_STAGE_TO_DB_STAGE[s])
    .filter((s): s is TicketStage => s !== undefined);

  if (mapped.length === jsonFlow.length) return mapped;

  const canonicalFlow = SDLC_FLOWS[ticketType as TicketType];
  if (canonicalFlow) return canonicalFlow;

  return mapped.length > 0 ? mapped : ['READY', 'DONE'];
}

/**
 * Map a raw history event name to a database event_type enum value.
 */
export function mapHistoryEvent(rawEvent: string): EventType {
  return HISTORY_EVENT_TO_DB_EVENT[rawEvent] ?? 'UPDATED';
}

/**
 * Derive the ticket status from its stage and claim state.
 */
export function deriveStatus(stage: TicketStage, hasClaim: boolean): string {
  if (stage === 'DONE') return 'DONE';
  if (hasClaim) return 'CLAIMED';
  return 'READY';
}

// ── Core migration logic ─────────────────────────────────────────────────────

/**
 * Migrate a single ticket's history entries into the events table.
 * Skips events that already exist (idempotent).
 */
async function migrateHistoryEvents(
  pool: ReturnType<typeof getPool>,
  ticketId: string,
  history: RawHistoryEntry[],
  dryRun: boolean,
): Promise<number> {
  let inserted = 0;

  for (const entry of history) {
    const eventName = entry.event ?? entry.action ?? 'UPDATED';
    const eventType = mapHistoryEvent(eventName);
    const previousStage = entry.from_stage
      ? (JSON_STAGE_TO_DB_STAGE[entry.from_stage] ?? null)
      : null;
    const newStage = entry.to_stage
      ? (JSON_STAGE_TO_DB_STAGE[entry.to_stage] ?? null)
      : (entry.stage ? (JSON_STAGE_TO_DB_STAGE[entry.stage] ?? null) : null);

    if (dryRun) {
      inserted++;
      continue;
    }

    // Idempotency check: skip if event with same ticket_id, timestamp, and type exists
    const existing = await pool.query(
      `SELECT id FROM events
       WHERE ticket_id = $1
         AND created_at = $2
         AND event_type = $3::event_type
       LIMIT 1`,
      [ticketId, entry.timestamp, eventType],
    );

    if (existing.rows.length > 0) continue;

    await pool.query(
      `INSERT INTO events (
         ticket_id, event_type, agent_name, machine_id,
         previous_stage, new_stage,
         payload, created_at
       ) VALUES (
         $1, $2::event_type, $3, $4,
         $5::ticket_stage, $6::ticket_stage,
         $7::jsonb, $8
       )`,
      [
        ticketId,
        eventType,
        entry.agent ?? null,
        entry.machine_id ?? null,
        previousStage,
        newStage,
        JSON.stringify({
          details: entry.details ?? null,
          original_event: eventName,
        }),
        entry.timestamp,
      ],
    );
    inserted++;
  }

  return inserted;
}

/**
 * Create synthetic CREATED + current-stage events for tickets that have
 * no history entries. Ensures every ticket has at least baseline events.
 */
async function createSyntheticEvents(
  pool: ReturnType<typeof getPool>,
  ticketId: string,
  stage: TicketStage,
  createdAt: string,
  dryRun: boolean,
): Promise<number> {
  if (dryRun) return stage === 'READY' ? 1 : 2;

  let inserted = 0;

  // CREATED event
  const existingCreated = await pool.query(
    `SELECT id FROM events
     WHERE ticket_id = $1 AND event_type = 'CREATED'::event_type
     LIMIT 1`,
    [ticketId],
  );
  if (existingCreated.rows.length === 0) {
    await pool.query(
      `INSERT INTO events (
         ticket_id, event_type, agent_name, machine_id,
         new_stage, payload, created_at
       ) VALUES (
         $1, 'CREATED'::event_type, 'migration', 'migrate-filesystem',
         'READY'::ticket_stage, $2::jsonb, $3
       )`,
      [
        ticketId,
        JSON.stringify({ details: 'Synthetic event from filesystem migration' }),
        createdAt,
      ],
    );
    inserted++;
  }

  // Current-stage event (if not READY, the ticket has advanced)
  if (stage !== 'READY') {
    const existingStage = await pool.query(
      `SELECT id FROM events
       WHERE ticket_id = $1 AND event_type = 'STAGE_ADVANCED'::event_type
         AND new_stage = $2::ticket_stage
       LIMIT 1`,
      [ticketId, stage],
    );
    if (existingStage.rows.length === 0) {
      await pool.query(
        `INSERT INTO events (
           ticket_id, event_type, agent_name, machine_id,
           new_stage, payload, created_at
         ) VALUES (
           $1, 'STAGE_ADVANCED'::event_type, 'migration', 'migrate-filesystem',
           $2::ticket_stage, $3::jsonb, $4
         )`,
        [
          ticketId,
          stage,
          JSON.stringify({ details: `Synthetic stage event: ticket found in ${stage}` }),
          createdAt,
        ],
      );
      inserted++;
    }
  }

  return inserted;
}

/**
 * Migrate all tickets from the filesystem into PostgreSQL.
 *
 * @param workspacePath - Root workspace path containing `.github/`
 * @param projectId - UUID of the project to associate tickets with
 * @param dryRun - If true, preview changes without writing to the database
 * @returns Migration statistics
 */
export async function migrateTickets(
  workspacePath: string,
  projectId: string,
  dryRun: boolean = false,
): Promise<MigrationStats> {
  const stats: MigrationStats = { total: 0, migrated: 0, skipped: 0, errors: [] };
  const ticketsDir = path.join(workspacePath, '.github', 'tickets');

  if (!fs.existsSync(ticketsDir)) {
    throw new Error(`Tickets directory not found: ${ticketsDir}`);
  }

  const files = fs
    .readdirSync(ticketsDir)
    .filter((f) => f.endsWith('.json') && !EXCLUDED_FILES.has(f))
    .sort();

  stats.total = files.length;

  logger.info(
    { event: 'migration_start', total: files.length, dryRun },
    `Starting migration of ${files.length} tickets${dryRun ? ' (dry-run)' : ''}`,
  );

  const pool = getPool();

  for (const file of files) {
    const filePath = path.join(ticketsDir, file);
    const ticketId = file.replace('.json', '');

    // Parse JSON with graceful error handling
    let ticket: RawTicketJson;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      ticket = JSON.parse(raw) as RawTicketJson;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`${ticketId}: Failed to parse JSON — ${msg}`);
      logger.error(
        { event: 'migration_parse_error', file, error: msg },
        `Malformed JSON in ${file}: ${msg}`,
      );
      continue;
    }

    // Validate required fields
    if (!ticket.ticket_id || !ticket.title || !ticket.type) {
      stats.errors.push(`${ticketId}: Missing required fields (ticket_id, title, or type)`);
      logger.warn(
        { event: 'migration_skip_invalid', file },
        `Skipping ${file}: missing required fields`,
      );
      continue;
    }

    // Validate ticket type
    if (!VALID_TYPES.includes(ticket.type)) {
      stats.errors.push(`${ticketId}: Invalid ticket type '${ticket.type}'`);
      logger.warn(
        { event: 'migration_skip_invalid_type', file, type: ticket.type },
        `Skipping ${file}: invalid type '${ticket.type}'`,
      );
      continue;
    }

    // Check if already migrated (idempotent — skip, don't upsert)
    if (!dryRun) {
      const existing = await pool.query(
        'SELECT 1 FROM tickets WHERE ticket_id = $1',
        [ticket.ticket_id],
      );
      if (existing.rows.length > 0) {
        stats.skipped++;
        logger.debug(
          { event: 'migration_skip_existing', ticketId: ticket.ticket_id },
          `Skipping ${ticket.ticket_id}: already exists in database`,
        );
        continue;
      }
    }

    // Derive stage from filesystem
    const dbStage = deriveStageFromFilesystem(
      ticket.ticket_id,
      workspacePath,
      ticket.stage,
    );

    // Map SDLC flow
    const sdlcFlow = mapSdlcFlow(ticket.sdlc_flow ?? [], ticket.type);

    // Derive status
    const status = deriveStatus(dbStage, ticket.claimed_by != null);

    // Normalize priority
    const priority = VALID_PRIORITIES.includes(ticket.priority)
      ? ticket.priority
      : 'medium';

    if (dryRun) {
      stats.migrated++;
      process.stdout.write(`  [DRY-RUN] Would migrate: ${ticket.ticket_id} (stage: ${dbStage})\n`);
      continue;
    }

    // Insert ticket
    try {
      await pool.query(
        `INSERT INTO tickets (
           ticket_id, project_id, title, description, type, priority,
           status, stage, sdlc_flow,
           claimed_by_name, machine_id, operator, lease_expiry,
           lease_duration_minutes,
           depends_on, file_paths, acceptance_criteria, tags,
           rework_count, metadata,
           parent_id, source_task_file,
           created_at, completed_at
         ) VALUES (
           $1, $2, $3, $4, $5::ticket_type, $6::ticket_priority,
           $7::ticket_status, $8::ticket_stage, $9::ticket_stage[],
           $10, $11, $12, $13,
           $14,
           $15, $16, $17, $18,
           $19, $20::jsonb,
           $21, $22,
           $23, $24
         )`,
        [
          ticket.ticket_id,
          projectId,
          ticket.title,
          ticket.description ?? null,
          ticket.type as TicketType,
          priority as TicketPriority,
          status,
          dbStage,
          sdlcFlow,
          ticket.claimed_by ?? null,
          ticket.machine_id ?? null,
          ticket.operator ?? null,
          ticket.lease_expiry ?? null,
          ticket.lease_duration_minutes ?? 30,
          ticket.dependencies ?? [],
          ticket.file_paths ?? [],
          ticket.acceptance_criteria ?? [],
          ticket.tags ?? [],
          ticket.rework_count ?? 0,
          JSON.stringify(ticket.metadata ?? {}),
          ticket.parent_id ?? null,
          ticket.source_task_file ?? null,
          ticket.created_at,
          ticket.completed_at ?? null,
        ],
      );

      // Import history events or create synthetic ones
      const history = ticket.history ?? [];
      if (history.length > 0) {
        await migrateHistoryEvents(pool, ticket.ticket_id, history, false);
      } else {
        await createSyntheticEvents(
          pool, ticket.ticket_id, dbStage, ticket.created_at, false,
        );
      }

      stats.migrated++;
      logger.debug(
        { event: 'migration_ticket_success', ticketId: ticket.ticket_id, stage: dbStage },
        `Migrated ${ticket.ticket_id}`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.errors.push(`${ticket.ticket_id}: ${msg}`);
      logger.error(
        { event: 'migration_ticket_error', ticketId: ticket.ticket_id, error: msg },
        `Failed to migrate ${ticket.ticket_id}: ${msg}`,
      );
    }
  }

  logger.info(
    { event: 'migration_complete', ...stats, errorCount: stats.errors.length },
    `Migration complete: ${stats.migrated} migrated, ${stats.skipped} skipped, ${stats.errors.length} errors`,
  );

  return stats;
}

// ── CLI Entry Point ──────────────────────────────────────────────────────────

/**
 * Parse CLI arguments for dry-run flag and optional workspace path.
 */
function parseArgs(): { dryRun: boolean; workspacePath: string } {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const positional = args.filter((a) => !a.startsWith('--'));
  const workspacePath = positional[0]
    ? path.resolve(positional[0])
    : (process.env['WORKSPACE_PATH']
      ? path.resolve(process.env['WORKSPACE_PATH'])
      : path.resolve(__dirname, '..', '..'));

  return { dryRun, workspacePath };
}

async function main(): Promise<void> {
  const { dryRun, workspacePath } = parseArgs();

  process.stdout.write(`\nForgeOS Filesystem → PostgreSQL Migration\n`);
  process.stdout.write(`${'─'.repeat(44)}\n`);
  process.stdout.write(`  Workspace: ${workspacePath}\n`);
  process.stdout.write(`  Dry-run:   ${dryRun}\n\n`);

  try {
    if (!dryRun) {
      // Step 1: Run pending migrations
      process.stdout.write('Step 1/3: Running database migrations...\n');
      const migrationsApplied = await runMigrations();
      process.stdout.write(`  Applied ${migrationsApplied} migration(s)\n`);

      // Step 2: Seed default project and admin agent
      process.stdout.write('Step 2/3: Seeding database...\n');
      const seedResult = await seed();
      process.stdout.write(`  Project ID: ${seedResult.projectId}\n`);

      // Step 3: Migrate tickets
      process.stdout.write('Step 3/3: Migrating tickets...\n');
      const stats = await migrateTickets(workspacePath, seedResult.projectId, false);

      printSummary(stats);
      await closePool();
      process.exit(stats.errors.length > 0 ? 1 : 0);
    } else {
      // Dry-run: no DB operations, just parse and preview
      process.stdout.write('Running in dry-run mode (no database writes)\n\n');
      const stats = await migrateTickets(
        workspacePath,
        '00000000-0000-0000-0000-000000000000',
        true,
      );
      printSummary(stats);
      process.exit(0);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ event: 'migration_fatal', error: msg }, `Fatal: ${msg}`);
    process.stderr.write(`Fatal error: ${msg}\n`);
    await closePool();
    process.exit(1);
  }
}

function printSummary(stats: MigrationStats): void {
  process.stdout.write(`\nMigration Summary\n`);
  process.stdout.write(`${'─'.repeat(30)}\n`);
  process.stdout.write(`  Total:    ${stats.total}\n`);
  process.stdout.write(`  Migrated: ${stats.migrated}\n`);
  process.stdout.write(`  Skipped:  ${stats.skipped}\n`);
  process.stdout.write(`  Errors:   ${stats.errors.length}\n`);

  if (stats.errors.length > 0) {
    process.stdout.write(`\nErrors:\n`);
    for (const err of stats.errors) {
      process.stdout.write(`  • ${err}\n`);
    }
  }

  process.stdout.write('\n');
}

/* istanbul ignore next -- CLI entry */
if (process.env['VITEST'] === undefined) {
  main();
}
