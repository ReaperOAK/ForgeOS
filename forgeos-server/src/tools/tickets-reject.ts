/**
 * tickets.reject — Reject a ticket and trigger rework or escalation.
 *
 * Calls the `reject_ticket` PostgreSQL stored function which:
 * - If rework_count < max_reworks: resets ticket to its first implementation
 *   stage with status READY, increments rework_count.
 * - If rework_count >= max_reworks: sets status to ESCALATED, clears claim.
 * - In both cases: releases file locks, records STAGE_REJECTED or ESCALATED event.
 *
 * SQL signature: `reject_ticket(p_ticket_id TEXT, p_agent_id UUID,
 * p_agent_name TEXT, p_reason TEXT, p_evidence JSONB)`
 *
 * Error codes returned on failure:
 * - `NOT_CLAIM_OWNER` — caller does not hold the claim on the ticket.
 * - `INTERNAL_ERROR` — unexpected database or runtime error.
 *
 * @module tools/tickets-reject
 * @ticket TASK-FOS-03-005
 * @see {@link ticketsRejectSchema} for input validation
 * @see {@link ticketsRejectHandler} for the request handler
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { Ticket, TicketsRejectOutput } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Zod schema for `tickets.reject` input parameters.
 *
 * Validates and coerces incoming MCP tool arguments before the handler
 * executes. `ticket_id` and `reason` are required; `evidence` is optional.
 * `reason` must be at least 10 characters to ensure meaningful feedback.
 */
export const ticketsRejectSchema = z.object({
  ticket_id: z.string().min(1).describe('Human-readable ticket ID to reject'),
  reason: z.string().min(10).describe('Why the ticket was rejected (min 10 chars)'),
  evidence: z.record(z.unknown()).optional()
    .describe('Optional structured evidence supporting the rejection'),
});

/**
 * Handler for the `tickets.reject` MCP tool.
 *
 * Atomically rejects the specified ticket by calling the
 * `reject_ticket` SQL function. The function uses `SELECT FOR UPDATE`
 * to guarantee that concurrent rejections never produce inconsistent
 * state.
 *
 * On rework (rework_count < max_reworks), the ticket is returned to its
 * first implementation stage with status `READY`. On escalation
 * (rework_count >= max_reworks), the ticket status becomes `ESCALATED`
 * and all claim fields are cleared.
 *
 * Internally the handler resolves the agent name to a UUID via the
 * `agents` table (auto-registering if absent) before calling the SQL
 * function.
 *
 * The SQL function `reject_ticket(p_ticket_id, p_agent_id,
 * p_agent_name, p_reason, p_evidence)` handles:
 * - Claim ownership validation (`SELECT FOR UPDATE`, raises NOT_CLAIM_OWNER)
 * - Rework count increment
 * - File lock release (`released_at = NOW()`)
 * - Event recording (STAGE_REJECTED or ESCALATED)
 *
 * If the agent name does not exist in the `agents` table it is
 * auto-registered with wildcard permissions.
 *
 * @param params - Validated input conforming to {@link ticketsRejectSchema}.
 * @returns A {@link CallToolResult} with JSON-serialised output or error.
 *
 * @example
 * ```jsonc
 * // MCP request
 * { "method": "tools/call",
 *   "params": { "name": "tickets.reject",
 *     "arguments": { "ticket_id": "FORGEOS-BE003",
 *       "reason": "Coverage is 62%, below the 80% minimum",
 *       "evidence": { "coverage": 62 } } } }
 * ```
 */
export async function ticketsRejectHandler(
  params: z.infer<typeof ticketsRejectSchema>,
): Promise<CallToolResult> {
  const { ticket_id, reason, evidence } = params;
  const agentName = 'system';

  logger.info({ ticket_id, agent_name: agentName, reason }, 'tickets.reject called');

  try {
    const agentResult = await pool.query<{ id: string }>(
      'SELECT id FROM agents WHERE name = $1 LIMIT 1',
      [agentName],
    );

    let agentId: string;
    if (agentResult.rows.length === 0) {
      // Auto-register agent if not found
      const insertResult = await pool.query<{ id: string }>(
        `INSERT INTO agents (name, role, permissions)
         VALUES ($1, $1, '["*"]'::JSONB)
         ON CONFLICT (name, role) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [agentName],
      );
      agentId = insertResult.rows[0]!.id;
    } else {
      agentId = agentResult.rows[0]!.id;
    }

    const result = await pool.query<Ticket>(
      'SELECT * FROM reject_ticket($1, $2, $3, $4, $5::JSONB)',
      [
        ticket_id,
        agentId,
        agentName,
        reason,
        JSON.stringify(evidence ?? {}),
      ],
    );

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'NOT_CLAIM_OWNER',
            message: `Ticket ${ticket_id} is not available (not claimed by you or does not exist)`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    const ticket = result.rows[0]!;
    const isEscalated = ticket.status === 'ESCALATED';

    const output: TicketsRejectOutput = {
      ticket,
      rework_count: ticket.rework_count,
      escalated: isEscalated,
      returned_to_stage: ticket.stage,
    };

    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, ticket_id }, 'tickets.reject failed');

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
