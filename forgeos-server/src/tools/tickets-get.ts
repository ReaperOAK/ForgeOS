/**
 * tickets.get — Retrieve full ticket details by ID.
 *
 * Returns the complete ticket JSON for a given ticket_id, including
 * current claim information, stage, dependencies, acceptance criteria,
 * and event history. This is the primary read tool, replacing filesystem
 * reads of `.github/tickets/{id}.json`.
 *
 * @module tools/tickets-get
 * @ticket TASK-INT-BE011
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { Ticket, TicketEvent } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `tickets.get` MCP tool.
 *
 * - `ticket_id` (required) — Human-readable ticket identifier (e.g., `TASK-FOS-03-001`).
 */
export const ticketsGetSchema = z.object({
  ticket_id: z.string().min(1).describe(
    'Human-readable ticket identifier (e.g., TASK-FOS-03-001)',
  ),
});

/** Validated input type derived from the Zod schema. */
type TicketsGetInput = z.infer<typeof ticketsGetSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Successful result payload — ticket with history. */
interface TicketsGetResult {
  ticket: Ticket & { history: TicketEvent[] };
  message: string;
}

/** Error result payload. */
interface TicketsGetError {
  ticket: null;
  message: string;
  error: string;
  timestamp: string;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Retrieve full ticket details by ticket_id, including event history.
 *
 * Executes two queries in sequence:
 * 1. Select the ticket row by `ticket_id`.
 * 2. Select all events for that ticket, ordered newest-first.
 *
 * Returns a 404-equivalent error if the ticket does not exist.
 *
 * @param input - Validated input with ticket_id
 * @returns MCP content response with ticket data or error
 */
export async function ticketsGetHandler(
  input: TicketsGetInput,
): Promise<CallToolResult> {
  const { ticket_id } = input;

  logger.info({ ticket_id }, 'tickets.get called');

  try {
    const startMs = Date.now();

    // Query ticket
    const ticketResult = await pool.query<Ticket>(
      'SELECT * FROM tickets WHERE ticket_id = $1',
      [ticket_id],
    );

    if (ticketResult.rows.length === 0) {
      logger.warn({ ticket_id }, 'tickets.get: ticket not found');

      const errorResult: TicketsGetError = {
        ticket: null,
        message: `Ticket '${ticket_id}' not found`,
        error: 'NOT_FOUND',
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(errorResult) }],
        isError: true,
      };
    }

    const ticket = ticketResult.rows[0] as Ticket;

    // Query event history
    const eventsResult = await pool.query<TicketEvent>(
      'SELECT * FROM events WHERE ticket_id = $1 ORDER BY created_at DESC',
      [ticket_id],
    );

    const durationMs = Date.now() - startMs;

    logger.debug(
      {
        event: 'tickets_get_query',
        ticket_id,
        durationMs,
        eventCount: eventsResult.rows.length,
      },
      'tickets.get query executed',
    );

    const result: TicketsGetResult = {
      ticket: {
        ...ticket,
        history: eventsResult.rows,
      },
      message: 'OK',
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'tickets_get_error',
        ticket_id,
        error: errorMessage,
      },
      'tickets.get query failed',
    );

    const errorResult: TicketsGetError = {
      ticket: null,
      message: `Query error: ${errorMessage}`,
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(errorResult) }],
      isError: true,
    };
  }
}
