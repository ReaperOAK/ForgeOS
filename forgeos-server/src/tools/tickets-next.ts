/**
 * tickets.next — Find Next Available Ticket (read-only peek).
 *
 * Returns the highest-priority unclaimed ticket for a given SDLC stage
 * without claiming it. Uses the `idx_tickets_claimable` composite
 * partial index for sub-50ms query performance.
 *
 * This tool is read-only — it does not modify ticket state.
 *
 * @module tools/tickets-next
 * @ticket TASK-FOS-03-001
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import {
  TICKET_STAGES,
  TICKET_TYPES,
  TICKET_PRIORITIES,
} from '../types/index.js';
import type { Ticket } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `tickets.next` MCP tool.
 *
 * - `stage` (required) — SDLC stage to search for available tickets.
 * - `type`  (optional) — Filter by ticket classification type.
 * - `priority` (optional) — Filter by minimum priority level (enum ordering).
 */
export const ticketsNextSchema = z.object({
  stage: z.enum(TICKET_STAGES as [string, ...string[]]).describe(
    'SDLC stage to search for available tickets',
  ),
  type: z.enum(TICKET_TYPES as [string, ...string[]]).optional().describe(
    'Optional filter by ticket type',
  ),
  priority: z.enum(TICKET_PRIORITIES as [string, ...string[]]).optional().describe(
    'Optional minimum priority filter (uses enum ordering)',
  ),
});

/** Validated input type derived from the Zod schema. */
type TicketsNextInput = z.infer<typeof ticketsNextSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Successful result payload. */
interface TicketsNextResult {
  ticket: Ticket | null;
  message: string;
}

/** Error result payload. */
interface TicketsNextError {
  ticket: null;
  message: string;
  error: string;
  timestamp: string;
}

/** MCP tool response — uses SDK CallToolResult for type compatibility. */

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Find the next available ticket for a given SDLC stage (peek, not claim).
 *
 * Queries the `tickets` table for the highest-priority unclaimed ticket
 * in READY status at the specified stage. The query leverages:
 *
 * ```sql
 * WHERE stage = $1 AND status = 'READY'
 *   AND (claimed_by IS NULL OR lease_expiry < NOW())
 * ORDER BY priority DESC, created_at ASC
 * LIMIT 1
 * ```
 *
 * Optional filters narrow by `type` and minimum `priority`.
 *
 * @param input - Validated input with stage, optional type and priority filters
 * @returns MCP content response with the ticket object or null with message
 */
export async function ticketsNextHandler(
  input: TicketsNextInput,
): Promise<CallToolResult> {
  const { stage, type, priority } = input;

  // Build parameterized WHERE clause
  const whereClauses: string[] = [
    'stage = $1',
    "status = 'READY'",
    '(claimed_by IS NULL OR lease_expiry < NOW())',
  ];
  const params: string[] = [stage];
  let paramIndex = 2;

  if (type !== undefined) {
    whereClauses.push(`type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }

  if (priority !== undefined) {
    whereClauses.push(`priority >= $${paramIndex}`);
    params.push(priority);
    paramIndex++;
  }

  const query = `
    SELECT * FROM tickets
    WHERE ${whereClauses.join(' AND ')}
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `;

  try {
    const startMs = Date.now();
    const { rows } = await pool.query(query, params);
    const durationMs = Date.now() - startMs;

    logger.debug(
      {
        event: 'tickets_next_query',
        stage,
        type: type ?? null,
        priority: priority ?? null,
        durationMs,
        found: rows.length > 0,
      },
      'tickets.next query executed',
    );

    if (rows.length === 0) {
      const result: TicketsNextResult = {
        ticket: null,
        message: 'No tickets available',
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    }

    const result: TicketsNextResult = {
      ticket: rows[0] as Ticket,
      message: 'OK',
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'tickets_next_error',
        stage,
        error: errorMessage,
      },
      'tickets.next query failed',
    );

    const errorResult: TicketsNextError = {
      ticket: null,
      message: `Query error: ${errorMessage}`,
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(errorResult) }],
    };
  }
}
