/**
 * tickets.list — Paginated Ticket Listing with Filters.
 *
 * Returns a paginated list of ticket summaries filtered by stage, status,
 * type, priority, or tags. Supports sorting by priority, created_at, or
 * updated_at. Replaces filesystem directory listings with database queries.
 *
 * @module tools/tickets-list
 * @ticket TASK-INT-BE012
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import {
  TICKET_STAGES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TICKET_PRIORITIES,
} from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;

const SORT_COLUMNS = ['priority', 'created_at', 'updated_at'] as const;
const SORT_ORDERS = ['asc', 'desc'] as const;

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `tickets.list` MCP tool.
 *
 * All filter parameters are optional. When omitted, no filter is applied
 * for that dimension (i.e. all values are returned).
 */
export const ticketsListSchema = z.object({
  stage: z
    .enum(TICKET_STAGES as [string, ...string[]])
    .optional()
    .describe('Filter by SDLC stage'),
  status: z
    .enum(TICKET_STATUSES as [string, ...string[]])
    .optional()
    .describe('Filter by operational status'),
  type: z
    .enum(TICKET_TYPES as [string, ...string[]])
    .optional()
    .describe('Filter by ticket type'),
  priority: z
    .enum(TICKET_PRIORITIES as [string, ...string[]])
    .optional()
    .describe('Filter by priority level'),
  tags: z
    .array(z.string().min(1))
    .optional()
    .describe('Filter by tags (tickets must contain ALL specified tags)'),
  sort_by: z
    .enum(SORT_COLUMNS as unknown as [string, ...string[]])
    .optional()
    .default('created_at')
    .describe('Sort field (default: created_at)'),
  sort_order: z
    .enum(SORT_ORDERS as unknown as [string, ...string[]])
    .optional()
    .default('desc')
    .describe('Sort direction (default: desc)'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(MAX_LIMIT)
    .optional()
    .default(DEFAULT_LIMIT)
    .describe(`Max results per page (1-${MAX_LIMIT}, default: ${DEFAULT_LIMIT})`),
  offset: z
    .number()
    .int()
    .min(0)
    .optional()
    .default(DEFAULT_OFFSET)
    .describe('Pagination offset (default: 0)'),
});

/** Validated input type derived from the Zod schema. */
type TicketsListInput = z.infer<typeof ticketsListSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Summary-level ticket data returned in list results. */
interface TicketSummary {
  ticket_id: string;
  title: string;
  type: string;
  priority: string;
  status: string;
  stage: string;
  claimed_by_name: string | null;
  tags: string[];
  rework_count: number;
  created_at: string;
  updated_at: string;
}

/** Successful list result payload. */
interface TicketsListResult {
  tickets: TicketSummary[];
  total_count: number;
  limit: number;
  offset: number;
}

/** Error result payload. */
interface TicketsListError {
  message: string;
  error: string;
  timestamp: string;
}

// ── Sort Column Allowlist ────────────────────────────────────────────────────

/** Map of allowed sort_by values to actual SQL column names (prevents injection). */
const SORT_COLUMN_MAP: Record<string, string> = {
  priority: 'priority',
  created_at: 'created_at',
  updated_at: 'updated_at',
};

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * List tickets with optional filters, pagination, and sorting.
 *
 * Builds a parameterized query with dynamic WHERE clauses based on
 * provided filters. Uses a parallel COUNT query for total_count.
 *
 * @param input - Validated input with optional filters and pagination params
 * @returns MCP content response with ticket summaries and pagination metadata
 */
export async function ticketsListHandler(
  input: TicketsListInput,
): Promise<CallToolResult> {
  const {
    stage,
    status,
    type,
    priority,
    tags,
    sort_by,
    sort_order,
    limit,
    offset,
  } = input;

  try {
    // Build dynamic WHERE clauses with parameterized values
    const whereClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (stage !== undefined) {
      whereClauses.push(`stage = $${paramIndex}::ticket_stage`);
      params.push(stage);
      paramIndex++;
    }

    if (status !== undefined) {
      whereClauses.push(`status = $${paramIndex}::ticket_status`);
      params.push(status);
      paramIndex++;
    }

    if (type !== undefined) {
      whereClauses.push(`type = $${paramIndex}::ticket_type`);
      params.push(type);
      paramIndex++;
    }

    if (priority !== undefined) {
      whereClauses.push(`priority = $${paramIndex}::ticket_priority`);
      params.push(priority);
      paramIndex++;
    }

    if (tags !== undefined && tags.length > 0) {
      whereClauses.push(`tags @> $${paramIndex}::text[]`);
      params.push(tags);
      paramIndex++;
    }

    const whereSQL =
      whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    // Resolve sort column from allowlist (prevents SQL injection)
    const sortColumn = SORT_COLUMN_MAP[sort_by] ?? 'created_at';
    const sortDir = sort_order === 'asc' ? 'ASC' : 'DESC';

    // Data query — summary fields only
    const dataQuery = `
      SELECT ticket_id, title, type, priority, status, stage,
             claimed_by_name, tags, rework_count, created_at, updated_at
      FROM tickets
      ${whereSQL}
      ORDER BY ${sortColumn} ${sortDir}
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    // Count query — same WHERE, no pagination
    const countQuery = `
      SELECT COUNT(*)::int AS total_count
      FROM tickets
      ${whereSQL}
    `;

    const dataParams = [...params, limit, offset];
    const countParams = [...params];

    const startMs = Date.now();

    // Execute data and count queries in parallel
    const [dataResult, countResult] = await Promise.all([
      pool.query(dataQuery, dataParams),
      pool.query(countQuery, countParams),
    ]);

    const durationMs = Date.now() - startMs;

    const totalCount: number =
      countResult.rows.length > 0
        ? (countResult.rows[0] as { total_count: number }).total_count
        : 0;

    logger.debug(
      {
        event: 'tickets_list_query',
        filters: { stage, status, type, priority, tags },
        sort: { sort_by, sort_order },
        pagination: { limit, offset },
        resultCount: dataResult.rows.length,
        totalCount,
        durationMs,
      },
      'tickets.list query executed',
    );

    const result: TicketsListResult = {
      tickets: dataResult.rows as TicketSummary[],
      total_count: totalCount,
      limit,
      offset,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'tickets_list_error',
        error: message,
        filters: { stage, status, type, priority, tags },
      },
      'tickets.list query failed',
    );

    const errorResult: TicketsListError = {
      message: 'Failed to list tickets',
      error: message,
      timestamp: new Date().toISOString(),
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(errorResult) }],
      isError: true,
    };
  }
}
