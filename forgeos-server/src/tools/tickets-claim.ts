/**
 * tickets.claim — Atomically claim a specific ticket by ID.
 *
 * Calls the `claim_ticket_by_id` PostgreSQL function which uses
 * `SELECT FOR UPDATE SKIP LOCKED` with file-lock conflict detection.
 * On success the ticket transitions to CLAIMED status, file locks are
 * acquired for all paths in the ticket's `file_paths` array, and a
 * CLAIMED event is recorded in the events table.
 *
 * Identity is sourced from the authenticated request context
 * (`req.agent`) — caller-supplied agent metadata is NOT a trust anchor.
 *
 * Error codes returned on failure:
 * - `ALREADY_CLAIMED` — ticket is locked by another agent or does not exist.
 * - `FILE_CONFLICT` — one or more file paths are locked by another ticket.
 * - `INTERNAL_ERROR` — unexpected database or runtime error.
 *
 * @module tools/tickets-claim
 * @ticket TASK-FOS-03-002, TASK-COP-MCP003
 * @see {@link ticketsClaimSchema} for input validation
 * @see {@link ticketsClaimHandler} for the request handler
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import { getRequestAgent } from './request-context.js';
import type { Ticket, TicketsClaimOutput } from '../types/index.js';
import { queueCompileTicketPrompt } from '../services/compiler.js';
import {
  buildContextHashInputsFromEnv,
  computeContextHash,
  evaluatePromptFreshness,
} from '../services/context-hash.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Zod schema for `tickets.claim` input parameters.
 *
 * Validates and coerces incoming MCP tool arguments before the handler
 * executes.  Identity is obtained from the authenticated request context
 * (`req.agent` set by `authMiddleware`) — caller-supplied agent metadata
 * is NOT a trust anchor.
 *
 * `lease_minutes` defaults to 30 and is clamped to the range 5–120.
 */
export const ticketsClaimSchema = z.object({
  ticket_id: z.string().describe('Ticket ID to claim'),
  lease_minutes: z.number().int().min(5).max(120).default(30)
    .describe('Lease duration in minutes'),
  freshness_policy: z.enum(['strict', 'permissive']).default('permissive')
    .describe(
      "Freshness gate mode — 'strict' surfaces a warning in the response when the compiled "
      + "prompt is stale or missing; 'permissive' (default) triggers a background recompile silently",
    ),
});

/**
 * Handler for the `tickets.claim` MCP tool.
 *
 * Atomically claims the specified ticket by calling the
 * `claim_ticket_by_id` SQL function inside a transaction.  The function
 * uses `SELECT FOR UPDATE SKIP LOCKED` to guarantee that concurrent
 * claims from different machines never produce a double-assignment.
 *
 * On success the handler returns a {@link TicketsClaimOutput} containing
 * the updated ticket, the ISO 8601 lease expiry timestamp, and the list
 * of file paths that were locked.
 *
 * The caller's identity is sourced from the authenticated request context
 * (`req.agent`) — caller-supplied agent metadata is NOT accepted.  The
 * agent identified by the bearer token is used for all claim operations.
 *
 * @param params - Validated input conforming to {@link ticketsClaimSchema}.
 * @returns A {@link CallToolResult} with JSON-serialised output or error.
 *
 * @example
 * ```jsonc
 * // MCP request
 * { "method": "tools/call",
 *   "params": { "name": "tickets.claim",
 *     "arguments": { "ticket_id": "TASK-001",
 *       "lease_minutes": 30 } } }
 * ```
 */
export async function ticketsClaimHandler(
  params: z.infer<typeof ticketsClaimSchema>,
): Promise<CallToolResult> {
  const { ticket_id, lease_minutes, freshness_policy } = params;
  const agent = getRequestAgent();

  logger.info(
    { ticket_id, agent_name: agent.name, agent_id: agent.id },
    'tickets.claim called',
  );

  try {
    const result = await pool.query<Ticket>(
      'SELECT * FROM claim_ticket_by_id($1, $2, $3, $4, $5, $6)',
      [ticket_id, agent.id, agent.name, agent.machine_id ?? null, null, lease_minutes],
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
      compiled_prompt: ticket.compiled_prompt,
      system_directive: ticket.compiled_prompt
        ?? ((ticket.metadata?.agent_prompt as { prompt?: string } | undefined)?.prompt ?? null),
    };

    const packetVersion = ticket.compiled_prompt_packet_version ?? 'v1';
    const templateVersion = ticket.compiled_prompt_template_version ?? 'prompt-architect-v1';
    const currentContextHash = computeContextHash(
      buildContextHashInputsFromEnv(process.env, packetVersion, templateVersion),
    );

    const freshness = evaluatePromptFreshness({
      compiledPrompt: ticket.compiled_prompt,
      storedContextHash: ticket.compiled_prompt_context_hash,
      currentContextHash,
    });

    output.prompt_packet = {
      version: packetVersion,
      compiled_at: ticket.compiled_prompt_compiled_at ?? null,
      context_hash: ticket.compiled_prompt_context_hash ?? null,
      freshness_status: freshness.freshnessStatus,
      stale_reason: freshness.staleReason,
    };

    if (freshness.shouldInvalidateCache) {
      const trigger = freshness.freshnessStatus === 'stale'
        ? 'claim-stale-compiled-prompt'
        : 'claim-missing-compiled-prompt';
      queueCompileTicketPrompt(ticket_id, trigger);

      if (freshness_policy === 'strict') {
        logger.warn(
          { ticket_id, freshness_status: freshness.freshnessStatus, stale_reason: freshness.staleReason },
          'tickets.claim: strict freshness gate — compiled prompt requires recompile before use',
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              ...output,
              freshness_warning: `Compiled prompt is ${freshness.freshnessStatus}`
                + ` (${freshness.staleReason ?? 'not_compiled'}); recompile has been queued.`,
            }),
          }],
        };
      }
    }

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
