/**
 * tickets.stats — Dashboard Statistics.
 *
 * Returns aggregate system statistics for dispatcher decision-making and
 * dashboard display. Computes per-stage ticket counts, per-status ticket
 * counts, claim health breakdown (healthy/expiring_soon/expired), average
 * time-in-stage per stage, rework count distribution, total tickets, and
 * total done tickets.
 *
 * All statistics queries execute in parallel for sub-200ms response time.
 *
 * @module tools/tickets-stats
 * @ticket TASK-FOS-03-010
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { TicketStage, TicketStatus } from '../types/index.js';
import { TICKET_STAGES, TICKET_STATUSES } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `tickets.stats` MCP tool.
 *
 * - `time_range_hours` (optional) — Restrict statistics to tickets created
 *   within the last N hours. Omit for all-time statistics.
 */
export const ticketsStatsSchema = z.object({
  time_range_hours: z
    .number()
    .positive()
    .optional()
    .describe('Optional: restrict stats to tickets created within last N hours'),
});

/** Validated input type derived from the Zod schema. */
type TicketsStatsInput = z.infer<typeof ticketsStatsSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Claim health breakdown. */
interface ClaimHealth {
  /** Claims with >5 minutes remaining on lease. */
  healthy: number;
  /** Claims with <5 minutes remaining on lease. */
  expiring_soon: number;
  /** Claims with expired leases. */
  expired: number;
}

/** Successful result payload. */
interface TicketsStatsResult {
  /** Ticket count per SDLC stage. */
  stages: Record<string, number>;
  /** Ticket count per operational status. */
  statuses: Record<string, number>;
  /** Claim health breakdown. */
  claims: ClaimHealth;
  /** Average seconds spent in each stage (from events). */
  avg_stage_duration: Record<string, number>;
  /** Distribution of rework_count values to number of tickets. */
  rework_distribution: Record<string, number>;
  /** Total number of tickets. */
  total_tickets: number;
  /** Total number of tickets in DONE status. */
  total_done: number;
}

/** Error result payload. */
interface TicketsStatsError {
  message: string;
  error: string;
  timestamp: string;
}

// ── Row types for query results ──────────────────────────────────────────────

interface CountRow {
  key: string;
  count: string;
}

interface ClaimRow {
  healthy: string;
  expiring_soon: string;
  expired: string;
}

interface DurationRow {
  stage: string;
  avg_seconds: string;
}

interface ReworkRow {
  rework_count: string;
  ticket_count: string;
}

interface TotalsRow {
  total_tickets: string;
  total_done: string;
}

// ── Cache ────────────────────────────────────────────────────────────────────

interface CacheEntry {
  result: TicketsStatsResult;
  expiresAt: number;
}

const CACHE_TTL_MS = 5_000;
let cache: CacheEntry | null = null;

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Build the WHERE clause and params array for the optional time range filter.
 *
 * @param timeRangeHours - Optional hours filter
 * @returns Tuple of [whereClause, params] for parameterized queries
 */
function buildTimeFilter(
  timeRangeHours: number | undefined,
): [string, Array<string | number>] {
  if (timeRangeHours === undefined) {
    return ['', []];
  }
  return [
    'WHERE created_at >= NOW() - ($1 || \' hours\')::interval',
    [timeRangeHours],
  ];
}

/**
 * Initialize a record with all enum values set to zero.
 */
function initRecord<K extends string>(keys: readonly K[]): Record<K, number> {
  const record = {} as Record<K, number>;
  for (const key of keys) {
    record[key] = 0;
  }
  return record;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Compute aggregate dashboard statistics from the tickets and events tables.
 *
 * Runs six queries in parallel:
 * 1. Ticket count grouped by stage
 * 2. Ticket count grouped by status
 * 3. Claim health breakdown (healthy / expiring_soon / expired)
 * 4. Average time-in-stage from the events table
 * 5. Rework count distribution
 * 6. Total tickets and total done
 *
 * Results are cached for up to 5 seconds to reduce database load.
 *
 * @param input - Validated input with optional time_range_hours
 * @returns MCP content response with TicketsStatsResult
 */
export async function ticketsStatsHandler(
  input: TicketsStatsInput,
): Promise<CallToolResult> {
  const { time_range_hours } = input;

  // Use cache only when no time filter is applied (all-time stats)
  if (time_range_hours === undefined && cache !== null && Date.now() < cache.expiresAt) {
    logger.debug(
      { event: 'tickets_stats_cache_hit' },
      'tickets.stats served from cache',
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(cache.result) }],
    };
  }

  const [whereClause, params] = buildTimeFilter(time_range_hours);

  // Claim health needs a different WHERE — only tickets with active claims
  const claimWhere = time_range_hours !== undefined
    ? 'WHERE claimed_by IS NOT NULL AND created_at >= NOW() - ($1 || \' hours\')::interval'
    : 'WHERE claimed_by IS NOT NULL';

  try {
    const startMs = Date.now();

    const [
      stageRows,
      statusRows,
      claimRows,
      durationRows,
      reworkRows,
      totalsRows,
    ] = await Promise.all([
      // 1. Tickets per stage
      pool.query<CountRow>(
        `SELECT stage::text AS key, COUNT(*)::text AS count
         FROM tickets ${whereClause}
         GROUP BY stage`,
        params,
      ),

      // 2. Tickets per status
      pool.query<CountRow>(
        `SELECT status::text AS key, COUNT(*)::text AS count
         FROM tickets ${whereClause}
         GROUP BY status`,
        params,
      ),

      // 3. Claim health
      pool.query<ClaimRow>(
        `SELECT
           COUNT(*) FILTER (WHERE lease_expiry > NOW() + INTERVAL '5 minutes')::text AS healthy,
           COUNT(*) FILTER (WHERE lease_expiry > NOW() AND lease_expiry <= NOW() + INTERVAL '5 minutes')::text AS expiring_soon,
           COUNT(*) FILTER (WHERE lease_expiry <= NOW())::text AS expired
         FROM tickets
         ${claimWhere}`,
        params,
      ),

      // 4. Average stage duration from events (STAGE_ADVANCED events)
      pool.query<DurationRow>(
        `SELECT
           previous_stage::text AS stage,
           EXTRACT(EPOCH FROM AVG(duration))::text AS avg_seconds
         FROM (
           SELECT
             previous_stage,
             new_stage,
             created_at - LAG(created_at) OVER (
               PARTITION BY ticket_id ORDER BY created_at
             ) AS duration
           FROM events
           WHERE event_type = 'STAGE_ADVANCED'
             AND previous_stage IS NOT NULL
         ) sub
         WHERE duration IS NOT NULL
         GROUP BY previous_stage`,
        [],
      ),

      // 5. Rework distribution
      pool.query<ReworkRow>(
        `SELECT rework_count::text, COUNT(*)::text AS ticket_count
         FROM tickets ${whereClause}
         GROUP BY rework_count
         ORDER BY rework_count`,
        params,
      ),

      // 6. Totals
      pool.query<TotalsRow>(
        `SELECT
           COUNT(*)::text AS total_tickets,
           COUNT(*) FILTER (WHERE status = 'DONE')::text AS total_done
         FROM tickets ${whereClause}`,
        params,
      ),
    ]);

    const durationMs = Date.now() - startMs;

    // Build stages record with all stages initialized to 0
    const stages = initRecord<TicketStage>(TICKET_STAGES);
    for (const row of stageRows.rows) {
      const stage = row.key as TicketStage;
      if (stage in stages) {
        stages[stage] = parseInt(row.count, 10);
      }
    }

    // Build statuses record with all statuses initialized to 0
    const statuses = initRecord<TicketStatus>(TICKET_STATUSES);
    for (const row of statusRows.rows) {
      const status = row.key as TicketStatus;
      if (status in statuses) {
        statuses[status] = parseInt(row.count, 10);
      }
    }

    // Build claims
    const claimRow = claimRows.rows[0];
    const claims: ClaimHealth = {
      healthy: parseInt(claimRow?.healthy ?? '0', 10),
      expiring_soon: parseInt(claimRow?.expiring_soon ?? '0', 10),
      expired: parseInt(claimRow?.expired ?? '0', 10),
    };

    // Build avg_stage_duration with all stages initialized to 0
    const avgStageDuration = initRecord<TicketStage>(TICKET_STAGES);
    for (const row of durationRows.rows) {
      const stage = row.stage as TicketStage;
      if (stage in avgStageDuration) {
        avgStageDuration[stage] = parseFloat(row.avg_seconds) || 0;
      }
    }

    // Build rework distribution
    const reworkDistribution: Record<string, number> = {};
    for (const row of reworkRows.rows) {
      reworkDistribution[row.rework_count] = parseInt(row.ticket_count, 10);
    }

    // Build totals
    const totalsRow = totalsRows.rows[0];
    const totalTickets = parseInt(totalsRow?.total_tickets ?? '0', 10);
    const totalDone = parseInt(totalsRow?.total_done ?? '0', 10);

    const result: TicketsStatsResult = {
      stages,
      statuses,
      claims,
      avg_stage_duration: avgStageDuration,
      rework_distribution: reworkDistribution,
      total_tickets: totalTickets,
      total_done: totalDone,
    };

    // Cache all-time results
    if (time_range_hours === undefined) {
      cache = { result, expiresAt: Date.now() + CACHE_TTL_MS };
    }

    logger.debug(
      {
        event: 'tickets_stats_query',
        durationMs,
        totalTickets,
        timeRangeHours: time_range_hours ?? null,
      },
      'tickets.stats query executed',
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'tickets_stats_error',
        error: errorMessage,
      },
      'tickets.stats query failed',
    );

    const errorResult: TicketsStatsError = {
      message: `Query error: ${errorMessage}`,
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(errorResult) }],
    };
  }
}
