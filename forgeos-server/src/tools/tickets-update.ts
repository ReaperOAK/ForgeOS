/**
 * tickets.update — Update Ticket Metadata.
 *
 * Merges a provided metadata object into the ticket's existing metadata
 * JSONB field using PostgreSQL's || operator (shallow merge). The caller's
 * identity is sourced from the authenticated request context (`req.agent`)
 * — caller-supplied agent metadata is NOT a trust anchor.
 *
 * On success, records an UPDATED event in the events table with the
 * metadata payload and returns the updated ticket object. The
 * updated_at field is refreshed automatically by the
 * trg_tickets_updated_at database trigger.
 *
 * Error codes returned on failure:
 * - NOT_CLAIM_OWNER — authenticated caller is not the current claim owner.
 * - TICKET_NOT_FOUND — ticket does not exist.
 * - INTERNAL_ERROR — unexpected database or runtime error.
 *
 * @module tools/tickets-update
 * @ticket TASK-FOS-03-003, TASK-COP-MCP003
 * @see {@link ticketsUpdateSchema} for input validation
 * @see {@link ticketsUpdateHandler} for the request handler
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import { getRequestAgent } from './request-context.js';
import type { Ticket } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod schema for tickets.update input parameters.
 *
 * Validates and coerces incoming MCP tool arguments before the handler
 * executes. Both fields are required.
 *
 * - ticket_id — The human-readable ticket identifier to update.
 * - metadata — A record of key-value pairs to shallow-merge into the
 *   ticket's existing metadata JSONB column.
 */
export const ticketsUpdateSchema = z.object({
  ticket_id: z.string().min(1).describe('Ticket ID to update'),
  metadata: z.record(z.unknown()).describe('Metadata key-value pairs to merge'),
});

/** Validated input type derived from the Zod schema. */
type TicketsUpdateInput = z.infer<typeof ticketsUpdateSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Successful result payload. */
interface TicketsUpdateResult {
  /** The updated ticket object. */
  ticket: Ticket;
  /** Human-readable status message. */
  message: string;
}

/** Error result payload. */
interface TicketsUpdateError {
  /** Machine-readable error code. */
  error: string;
  /** Human-readable error description. */
  message: string;
  /** The ticket ID that was targeted. */
  ticket_id: string;
  /** ISO 8601 timestamp of the error. */
  timestamp: string;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handler for the tickets.update MCP tool.
 *
 * Performs the following steps in a single database transaction:
 *
 * 1. Looks up the ticket by ticket_id using SELECT FOR UPDATE to
 *    prevent concurrent modifications.
 * 2. Verifies the ticket exists — returns TICKET_NOT_FOUND if absent.
 * 3. Verifies the caller is the current claim owner by comparing
 *    the authenticated identity from the request context against
 *    `claimed_by` — returns NOT_CLAIM_OWNER on mismatch.
 * 4. Merges the provided metadata into ticket.metadata using the
 *    PostgreSQL || operator (shallow merge).
 * 5. Inserts an UPDATED event into the events table with the metadata
 *    payload.
 * 6. Returns the updated ticket object as JSON text content.
 *
 * The updated_at field is refreshed automatically by the
 * trg_tickets_updated_at trigger — no explicit UPDATE of that column
 * is needed.
 *
 * @param params - Validated input conforming to {@link ticketsUpdateSchema}.
 * @returns A {@link CallToolResult} with JSON-serialised output or error.
 */
export async function ticketsUpdateHandler(
  params: TicketsUpdateInput,
): Promise<CallToolResult> {
  const { ticket_id, metadata } = params;
  const agent = getRequestAgent();

  logger.info({ ticket_id, agent_name: agent.name }, 'tickets.update called');

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock the ticket row for update
    const ticketResult = await client.query<Ticket>(
      'SELECT * FROM tickets WHERE ticket_id = $1 FOR UPDATE',
      [ticket_id],
    );

    if (ticketResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const errorResponse: TicketsUpdateError = {
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${ticket_id} does not exist`,
        ticket_id,
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(errorResponse) }],
      };
    }

    const ticket = ticketResult.rows[0]!;

    // 2. Verify caller is the current claim owner using authenticated identity
    if (ticket.claimed_by === null || ticket.claimed_by_name === null) {
      await client.query('ROLLBACK');
      const errorResponse: TicketsUpdateError = {
        error: 'NOT_CLAIM_OWNER',
        message: `Ticket ${ticket_id} is not currently claimed by any agent`,
        ticket_id,
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(errorResponse) }],
      };
    }

    if (ticket.claimed_by !== agent.id) {
      await client.query('ROLLBACK');
      const errorResponse: TicketsUpdateError = {
        error: 'NOT_CLAIM_OWNER',
        message: `Authenticated agent '${agent.name}' does not hold the claim on ticket ${ticket_id}`,
        ticket_id,
        timestamp: new Date().toISOString(),
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(errorResponse) }],
      };
    }

    // 3. Merge metadata using jsonb || operator (shallow merge)
    const updateResult = await client.query<Ticket>(
      `UPDATE tickets
       SET metadata = metadata || $1::jsonb
       WHERE ticket_id = $2
       RETURNING *`,
      [JSON.stringify(metadata), ticket_id],
    );

    const updatedTicket = updateResult.rows[0]!;

    // 4. Record UPDATED event in the events table using authenticated identity
    await client.query(
      `INSERT INTO events (ticket_id, event_type, agent_id, agent_name, machine_id, operator, payload)
       VALUES ($1, 'UPDATED', $2, $3, $4, $5, $6::jsonb)`,
      [
        ticket_id,
        agent.id,
        agent.name,
        agent.machine_id ?? null,
        null,
        JSON.stringify(metadata),
      ],
    );

    await client.query('COMMIT');

    logger.info(
      { ticket_id, metadata_keys: Object.keys(metadata) },
      'tickets.update completed successfully',
    );

    const result: TicketsUpdateResult = {
      ticket: updatedTicket,
      message: 'OK',
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {
      /* swallow rollback error — original error is more important */
    });

    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, ticket_id }, 'tickets.update failed');

    const errorResponse: TicketsUpdateError = {
      error: 'INTERNAL_ERROR',
      message,
      ticket_id,
      timestamp: new Date().toISOString(),
    };
    return {
      content: [{ type: 'text', text: JSON.stringify(errorResponse) }],
    };
  } finally {
    client.release();
  }
}
