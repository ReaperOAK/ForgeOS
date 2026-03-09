/**
 * tickets.extend — Extend Lease Duration on a Claimed Ticket.
 *
 * Calls the `extend_lease` PostgreSQL function which verifies claim
 * ownership via `SELECT FOR UPDATE`, checks the requested duration
 * against `max_lease_minutes` from `system_config`, and updates
 * `lease_expiry` to `NOW() + duration_minutes`. A `LEASE_EXTENDED`
 * event is recorded with `new_expiry` and `extension_minutes` in the
 * payload.
 *
 * Error codes returned on failure:
 * - `NOT_CLAIM_OWNER` — caller does not hold the claim on the ticket.
 * - `LEASE_TOO_LONG` — duration_minutes exceeds max_lease_minutes.
 * - `INTERNAL_ERROR` — unexpected database or runtime error.
 *
 * @module tools/tickets-extend
 * @ticket TASK-FOS-03-009
 * @see {@link ticketsExtendSchema} for input validation
 * @see {@link ticketsExtendHandler} for the request handler
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { Ticket } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Zod schema for `tickets.extend` input parameters.
 *
 * Validates and coerces incoming MCP tool arguments before the handler
 * executes. `duration_minutes` defaults to 30 and is clamped to 5–120.
 */
export const ticketsExtendSchema = z.object({
  ticket_id: z.string().describe('Ticket ID whose lease to extend'),
  agent_name: z.string().describe('Agent name that holds the claim'),
  duration_minutes: z.number().int().min(5).max(120).default(30)
    .describe('Lease extension duration in minutes (5–120, default 30)'),
});

/**
 * Successful output from `tickets.extend`.
 *
 * Contains the updated ticket row and the new ISO 8601 lease expiry
 * timestamp.
 */
interface TicketsExtendOutput {
  /** The ticket with updated lease metadata. */
  ticket: Ticket;
  /** The new ISO 8601 lease expiry timestamp. */
  new_lease_expiry: string;
}

/**
 * Handler for the `tickets.extend` MCP tool.
 *
 * Extends the lease on a claimed ticket by calling the `extend_lease`
 * SQL function. The function uses `SELECT FOR UPDATE` to verify
 * ownership and enforces the `max_lease_minutes` system config limit.
 *
 * On success the handler returns a {@link TicketsExtendOutput} with the
 * updated ticket and new lease expiry.
 *
 * @param params - Validated input conforming to {@link ticketsExtendSchema}.
 * @returns A {@link CallToolResult} with JSON-serialised output or error.
 *
 * @example
 * ```jsonc
 * // MCP request
 * { "method": "tools/call",
 *   "params": { "name": "tickets.extend",
 *     "arguments": { "ticket_id": "TASK-001", "agent_name": "Backend",
 *       "duration_minutes": 45 } } }
 * ```
 */
export async function ticketsExtendHandler(
  params: z.infer<typeof ticketsExtendSchema>,
): Promise<CallToolResult> {
  const { ticket_id, agent_name, duration_minutes } = params;

  logger.info({ ticket_id, agent_name, duration_minutes }, 'tickets.extend called');

  try {
    // Look up agent by name to get UUID
    const agentResult = await pool.query<{ id: string }>(
      'SELECT id FROM agents WHERE name = $1 LIMIT 1',
      [agent_name],
    );

    if (agentResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'NOT_CLAIM_OWNER',
            message: `Agent '${agent_name}' not found — cannot verify claim ownership`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    const agentId = agentResult.rows[0]!.id;

    const result = await pool.query<Ticket>(
      'SELECT * FROM extend_lease($1, $2, $3, $4)',
      [ticket_id, agentId, agent_name, duration_minutes],
    );

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'NOT_CLAIM_OWNER',
            message: `Cannot extend lease: you do not hold the claim on ticket ${ticket_id}`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    const ticket = result.rows[0]!;

    const output: TicketsExtendOutput = {
      ticket,
      new_lease_expiry: ticket.lease_expiry ?? '',
    };

    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, ticket_id }, 'tickets.extend failed');

    if (message.includes('NOT_CLAIM_OWNER')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'NOT_CLAIM_OWNER',
            message: 'You do not hold the claim on this ticket',
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    if (message.includes('LEASE_TOO_LONG')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'LEASE_TOO_LONG',
            message: `Requested duration exceeds max_lease_minutes`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'INTERNAL_ERROR',
          message,
          ticket_id,
          timestamp: new Date().toISOString(),
        }),
      }],
    };
  }
}
