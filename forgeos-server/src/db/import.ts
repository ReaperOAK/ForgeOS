/**
 * Filesystem ticket import tool for ForgeOS.
 *
 * Reads `.github/tickets/*.json` files and the `.github/ticket-state/`
 * directory tree, then upserts tickets and their history events into the
 * PostgreSQL database. The import is idempotent — uses ON CONFLICT DO
 * UPDATE to avoid duplicates.
 *
 * @module db/import
 * @ticket TASK-FOS-01-003
 */

import fs from 'node:fs';
import path from 'node:path';
import { getPool } from './pool.js';
import { logger } from '../middleware/logging.js';
import type { TicketStage, TicketType, TicketPriority, EventType } from '../types/index.js';
import { SDLC_FLOWS } from '../types/index.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Import summary printed to stdout after completion. */
export interface ImportSummary {
  success: number;
  errors: number;
  skipped: number;
}

/** Raw ticket JSON structure from `.github/tickets/*.json`. */
interface RawTicketJson {
  ticket_id: string;
  title: string;
  description?: string;
  type: string;
  priority: string;
  stage: string;
  sdlc_flow: string[];
  created_at: string;
  dependencies: string[];
  blocked_by?: string[];
  file_paths: string[];
  acceptance_criteria: string[];
  rework_count: number;
  claimed_by: string | null;
  machine_id: string | null;
  operator: string | null;
  lease_expiry: string | null;
  lease_duration_minutes: number;
  history: RawHistoryEntry[];
  source_task_file: string | null;
  tags: string[];
  parent_id?: string | null;
  metadata?: Record<string, unknown>;
}

/** Raw history entry from ticket JSON. */
interface RawHistoryEntry {
  timestamp: string;
  event: string;
  agent: string;
  machine_id: string;
  details: string;
  from_stage?: string;
  to_stage?: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Files to exclude from import. */
const EXCLUDED_FILES = new Set(['ticket-schema.json']);

/** Stage directory names in `.github/ticket-state/`. */
const STAGE_DIRECTORIES = [
  'READY', 'ARCHITECT', 'RESEARCH', 'BACKEND', 'FRONTEND',
  'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE',
] as const;

/**
 * Map from filesystem directory names to database `ticket_stage` enum values.
 *
 * Most directory names match the enum exactly, except:
 * - `DOCS` → `DOCUMENTATION`
 * - `VALIDATION` → `VALIDATOR`
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
 * Handles the naming mismatch between the ticket JSON and the DB schema.
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
 *
 * Events that don't map to a valid DB enum are stored as UPDATED
 * with the original event name in the payload.
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
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Discover the current stage for a ticket by scanning `.github/ticket-state/`
 * directories. Returns the database-compatible stage enum value.
 *
 * Falls back to mapping the JSON `stage` field if the ticket is not found
 * in any state directory.
 *
 * @param ticketId - The ticket_id to look up
 * @param workspacePath - Root workspace path containing `.github/`
 * @param jsonStage - Stage value from the ticket JSON (fallback)
 * @returns Database TicketStage enum value
 */
function deriveStageFromFilesystem(
  ticketId: string,
  workspacePath: string,
  jsonStage: string,
): TicketStage {
  const ticketStateDir = path.join(workspacePath, '.github', 'ticket-state');

  for (const dirName of STAGE_DIRECTORIES) {
    const stateFile = path.join(ticketStateDir, dirName, `${ticketId}.json`);
    if (fs.existsSync(stateFile)) {
      const dbStage = DIR_TO_DB_STAGE[dirName];
      if (dbStage) {
        return dbStage;
      }
    }
  }

  // Fallback: map from JSON stage value
  const mapped = JSON_STAGE_TO_DB_STAGE[jsonStage];
  if (mapped) {
    return mapped;
  }

  logger.warn(
    { event: 'import_stage_fallback', ticketId, jsonStage },
    'Could not derive stage from filesystem, using READY as default',
  );
  return 'READY';
}

/**
 * Map a JSON sdlc_flow array to database-compatible TicketStage values.
 *
 * If the JSON flow uses directory-style names (DOCS, VALIDATION), they
 * are translated to the DB enum equivalents (DOCUMENTATION, VALIDATOR).
 *
 * Falls back to the canonical SDLC_FLOWS mapping if the ticket type is
 * recognized.
 *
 * @param jsonFlow - Array of stage names from ticket JSON
 * @param ticketType - The ticket's type for fallback lookup
 * @returns Array of database TicketStage values
 */
function mapSdlcFlow(jsonFlow: string[], ticketType: string): TicketStage[] {
  // Try mapping each stage in the JSON flow
  const mapped = jsonFlow
    .map((s) => JSON_STAGE_TO_DB_STAGE[s])
    .filter((s): s is TicketStage => s !== undefined);

  if (mapped.length === jsonFlow.length) {
    return mapped;
  }

  // Fallback to canonical flow for this type
  const canonicalFlow = SDLC_FLOWS[ticketType as TicketType];
  if (canonicalFlow) {
    return canonicalFlow;
  }

  return mapped.length > 0 ? mapped : ['READY', 'DONE'];
}

/**
 * Map a raw history event to a database event_type enum value.
 *
 * @param rawEvent - Event name from the ticket JSON history
 * @returns Database EventType
 */
function mapHistoryEvent(rawEvent: string): EventType {
  return HISTORY_EVENT_TO_DB_EVENT[rawEvent] ?? 'UPDATED';
}

/**
 * Derive the ticket status from its stage.
 *
 * @param stage - Database TicketStage
 * @param hasClaim - Whether the ticket has an active claim
 * @returns Appropriate ticket_status value
 */
function deriveStatus(stage: TicketStage, hasClaim: boolean): string {
  if (stage === 'DONE') return 'DONE';
  if (hasClaim) return 'CLAIMED';
  return 'READY';
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Import tickets from the filesystem into the database.
 *
 * Reads all `.github/tickets/*.json` files (excluding ticket-schema.json),
 * derives each ticket's current stage from `.github/ticket-state/` directory
 * location, inserts/updates tickets in the `tickets` table, and preserves
 * history as events in the `events` table.
 *
 * @param workspacePath - Root workspace path (e.g., `/home/user/ForgeOS`)
 * @param projectId - UUID of the project to associate tickets with
 * @returns Import summary with success, error, and skipped counts
 * @throws Error if the tickets directory doesn't exist
 */
export async function importTickets(
  workspacePath: string,
  projectId: string,
): Promise<ImportSummary> {
  const ticketsDir = path.join(workspacePath, '.github', 'tickets');
  const summary: ImportSummary = { success: 0, errors: 0, skipped: 0 };

  logger.info(
    { event: 'import_start', ticketsDir },
    'Starting ticket import from filesystem',
  );

  if (!fs.existsSync(ticketsDir)) {
    const message = `Tickets directory not found: ${ticketsDir}`;
    logger.error({ event: 'import_dir_missing', ticketsDir }, message);
    throw new Error(message);
  }

  // Discover all JSON ticket files
  const files = fs
    .readdirSync(ticketsDir)
    .filter((f) => f.endsWith('.json') && !EXCLUDED_FILES.has(f))
    .sort();

  logger.info(
    { event: 'import_files_discovered', count: files.length },
    `Found ${files.length} ticket files to import`,
  );

  const pool = getPool();

  for (const file of files) {
    const filePath = path.join(ticketsDir, file);
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const ticket: RawTicketJson = JSON.parse(raw);

      // Validate required fields
      if (!ticket.ticket_id || !ticket.title || !ticket.type) {
        logger.warn(
          { event: 'import_skip_invalid', file },
          'Skipping file with missing required fields',
        );
        summary.skipped++;
        continue;
      }

      // Derive stage from filesystem
      const dbStage = deriveStageFromFilesystem(
        ticket.ticket_id,
        workspacePath,
        ticket.stage,
      );

      // Map SDLC flow to DB values
      const sdlcFlow = mapSdlcFlow(ticket.sdlc_flow ?? [], ticket.type);

      // Derive status from stage
      const status = deriveStatus(dbStage, ticket.claimed_by !== null);

      // Validate type against DB enum
      const validTypes = [
        'backend', 'frontend', 'fullstack', 'infra', 'security',
        'docs', 'research', 'architecture', 'product', 'design',
      ];
      if (!validTypes.includes(ticket.type)) {
        logger.warn(
          { event: 'import_skip_invalid_type', file, type: ticket.type },
          `Skipping file with invalid ticket type: ${ticket.type}`,
        );
        summary.skipped++;
        continue;
      }

      // Validate priority
      const validPriorities = ['critical', 'high', 'medium', 'low'];
      const priority = validPriorities.includes(ticket.priority)
        ? ticket.priority
        : 'medium';

      // Upsert ticket — ON CONFLICT (ticket_id) DO UPDATE
      await pool.query(
        `INSERT INTO tickets (
           ticket_id, project_id, title, description, type, priority,
           status, stage, sdlc_flow,
           claimed_by_name, machine_id, operator, lease_expiry,
           lease_duration_minutes,
           depends_on, file_paths, acceptance_criteria, tags,
           rework_count, metadata,
           parent_id, source_task_file,
           created_at
         ) VALUES (
           $1, $2, $3, $4, $5::ticket_type, $6::ticket_priority,
           $7::ticket_status, $8::ticket_stage, $9::ticket_stage[],
           $10, $11, $12, $13,
           $14,
           $15, $16, $17, $18,
           $19, $20::jsonb,
           $21, $22,
           $23
         )
         ON CONFLICT (ticket_id) DO UPDATE SET
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           type = EXCLUDED.type,
           priority = EXCLUDED.priority,
           status = EXCLUDED.status,
           stage = EXCLUDED.stage,
           sdlc_flow = EXCLUDED.sdlc_flow,
           depends_on = EXCLUDED.depends_on,
           file_paths = EXCLUDED.file_paths,
           acceptance_criteria = EXCLUDED.acceptance_criteria,
           tags = EXCLUDED.tags,
           rework_count = EXCLUDED.rework_count,
           metadata = EXCLUDED.metadata,
           source_task_file = EXCLUDED.source_task_file,
           updated_at = NOW()`,
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
          ticket.claimed_by,        // stored as name string, not UUID
          ticket.machine_id,
          ticket.operator,
          ticket.lease_expiry,
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
        ],
      );

      // Import history entries as events
      if (Array.isArray(ticket.history) && ticket.history.length > 0) {
        await importHistoryEvents(pool, ticket.ticket_id, ticket.history);
      }

      summary.success++;
      logger.debug(
        { event: 'import_ticket_success', ticketId: ticket.ticket_id, stage: dbStage },
        `Imported ticket ${ticket.ticket_id}`,
      );
    } catch (err) {
      summary.errors++;
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(
        { event: 'import_ticket_error', file, error: errorMessage },
        `Failed to import ${file}: ${errorMessage}`,
      );
    }
  }

  logger.info(
    { event: 'import_complete', ...summary },
    `Import complete: ${summary.success} success, ${summary.errors} errors, ${summary.skipped} skipped`,
  );

  // Print summary to stdout
  process.stdout.write(
    `\nImport Summary:\n` +
    `  Success: ${summary.success}\n` +
    `  Errors:  ${summary.errors}\n` +
    `  Skipped: ${summary.skipped}\n\n`,
  );

  return summary;
}

/**
 * Import history entries from a ticket JSON into the events table.
 *
 * Uses ON CONFLICT DO NOTHING on (ticket_id, created_at, event_type)
 * to ensure idempotency. Since the events table doesn't have that
 * unique constraint, we check for existing events by ticket_id and
 * timestamp to avoid duplicates.
 *
 * @param pool - Database connection pool
 * @param ticketId - The ticket_id these events belong to
 * @param history - Array of raw history entries from ticket JSON
 */
async function importHistoryEvents(
  pool: ReturnType<typeof getPool>,
  ticketId: string,
  history: RawHistoryEntry[],
): Promise<void> {
  for (const entry of history) {
    try {
      const eventType = mapHistoryEvent(entry.event);
      const previousStage = entry.from_stage
        ? (JSON_STAGE_TO_DB_STAGE[entry.from_stage] ?? null)
        : null;
      const newStage = entry.to_stage
        ? (JSON_STAGE_TO_DB_STAGE[entry.to_stage] ?? null)
        : null;

      // Idempotency: skip if an event with same ticket_id, timestamp, and type exists
      const existing = await pool.query(
        `SELECT id FROM events
         WHERE ticket_id = $1
           AND created_at = $2
           AND event_type = $3::event_type
         LIMIT 1`,
        [ticketId, entry.timestamp, eventType],
      );

      if (existing.rows.length > 0) {
        continue; // Already imported
      }

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
          JSON.stringify({ details: entry.details, original_event: entry.event }),
          entry.timestamp,
        ],
      );
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.warn(
        { event: 'import_event_error', ticketId, historyEvent: entry.event, error: errorMessage },
        `Failed to import history event for ${ticketId}: ${errorMessage}`,
      );
      // Continue with remaining events — don't fail the whole ticket
    }
  }
}
