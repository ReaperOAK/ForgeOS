/**
 * tickets.claim — Atomically claim a specific ticket by ID.
 *
 * Calls claim_ticket_by_id PostgreSQL function which uses
 * SELECT FOR UPDATE SKIP LOCKED with file lock conflict detection.
 *
 * @module tools/tickets-claim
 * @ticket TASK-FOS-03-002
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { Ticket, TicketsClaimOutput } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/** Zod schema for tickets.claim input */
export const ticketsClaimSchema = z.object({
  ticket_id: z.string().describe('Ticket ID to claim'),
  agent_name: z.string().describe('Agent name claiming the ticket'),
  machine_id: z.string().describe('Machine hostname'),
  operator: z.string().optional().describe('Human operator name'),
  lease_minutes: z.number().int().min(5).max(120).default(30)
    .describe('Lease duration in minutes'),
});

/**
 * Handler for tickets.claim MCP tool.
 *
 * Atomically claims the specified ticket, acquiring file locks
 * and preventing other agents from claiming the same ticket.
 */
export async function ticketsClaimHandler(
  params: z.infer<typeof ticketsClaimSchema>,
): Promise<CallToolResult> {
  const { ticket_id, agent_name, machine_id, operator, lease_minutes } = params;

  logger.info({ ticket_id, agent_name, machine_id }, 'tickets.claim called');

  try {
    // Look up agent by name to get UUID
    const agentResult = await pool.query<{ id: string }>(
      'SELECT id FROM agents WHERE name = $1 LIMIT 1',
      [agent_name],
    );

    let agentId: string;
    if (agentResult.rows.length === 0) {
      // Auto-register agent if not found
      const insertResult = await pool.query<{ id: string }>(
        `INSERT INTO agents (name, role, permissions)
         VALUES ($1, $1, '["*"]'::JSONB)
         ON CONFLICT (name, role) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [agent_name],
      );
      agentId = insertResult.rows[0]!.id;
    } else {
      agentId = agentResult.rows[0]!.id;
    }

    const result = await pool.query<Ticket>(
      'SELECT * FROM claim_ticket_by_id($1, $2, $3, $4, $5, $6)',
      [ticket_id, agentId, agent_name, machine_id, operator ?? null, lease_minutes],
    );

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'ALREADY_CLAIMED',
            message: `Ticket ${ticket_id} is not available (already claimed, wrong status, or does not exist)`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    const ticket = result.rows[0]!;

    // Fetch file locks for this ticket
    const locksResult = await pool.query<{ file_path: string }>(
      'SELECT file_path FROM file_locks WHERE ticket_id = $1 AND released_at IS NULL',
      [ticket_id],
    );

    const output: TicketsClaimOutput = {
      ticket,
      lease_expiry: ticket.lease_expiry ?? '',
      file_locks: locksResult.rows.map((r) => r.file_path),
    };

    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, ticket_id }, 'tickets.claim failed');

    if (message.includes('FILE_CONFLICT')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'FILE_CONFLICT',
            message: 'One or more files are locked by another ticket',
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
