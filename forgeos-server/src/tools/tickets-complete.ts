/**
 * tickets.complete — Complete Stage and Advance.
 *
 * Marks the current SDLC stage as complete and advances the ticket to the
 * next stage in its flow. Calls the `advance_ticket` PostgreSQL function
 * which validates claim ownership, enforces SDLC flow ordering, releases
 * file locks, merges evidence into metadata, and resolves downstream
 * dependencies when a ticket reaches DONE.
 *
 * Error codes returned on failure:
 * - `MISSING_EVIDENCE` — evidence object is missing required fields.
 * - `INVALID_TRANSITION` — ticket is at the final stage or flow violation.
 * - `NOT_CLAIM_OWNER` — caller does not hold the claim.
 * - `INTERNAL_ERROR` — unexpected database or runtime error.
 *
 * @module tools/tickets-complete
 * @ticket TASK-FOS-03-004
 * @see {@link ticketsCompleteSchema} for input validation
 * @see {@link ticketsCompleteHandler} for the request handler
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { ReflectionService } from '../services/reflection-service.js';
import type { Ticket, TicketsCompleteOutput } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

/**
 * Zod schema for `tickets.complete` input parameters.
 *
 * Validates incoming MCP tool arguments. `ticket_id` is required.
 * `evidence` is a required object containing `artifacts` (non-empty string
 * array), `test_results` (non-empty string), `confidence` (enum), and
 * optional `notes`.
 */
export const ticketsCompleteSchema = z.object({
  ticket_id: z.string().min(1).describe('Human-readable ticket ID to complete'),
  evidence: z.object({
    artifacts: z.array(z.string()).min(1)
      .describe('Workspace-relative paths of files created or modified'),
    test_results: z.string().min(1)
      .describe("Summary of test results or 'N/A' with justification"),
    confidence: z.enum(['HIGH', 'MEDIUM', 'LOW'])
      .describe("Agent's self-assessed confidence in the deliverable"),
    notes: z.string().optional()
      .describe('Optional free-text notes'),
  }).describe('Structured evidence proving the stage work is done'),
});

/** Validated input type derived from the Zod schema. */
type TicketsCompleteInput = z.infer<typeof ticketsCompleteSchema>;

/**
 * Handler for the `tickets.complete` MCP tool.
 *
 * Advances the specified ticket to its next SDLC stage by calling the
 * `advance_ticket()` PostgreSQL stored function. The function uses
 * `SELECT FOR UPDATE` to atomically validate claim ownership, compute
 * the next stage from `sdlc_flow[]`, release file locks, and merge
 * evidence JSONB into ticket metadata.
 *
 * When a ticket reaches DONE, `advance_ticket()` internally calls
 * `resolve_dependencies()` to unblock any BLOCKED tickets whose last
 * dependency has just been satisfied.
 *
 * @param params - Validated input conforming to {@link ticketsCompleteSchema}.
 * @returns A {@link CallToolResult} with JSON-serialised output or error.
 *
 * @example
 * ```jsonc
 * // MCP request
 * { "method": "tools/call",
 *   "params": { "name": "tickets.complete",
 *     "arguments": {
 *       "ticket_id": "TASK-001",
 *       "evidence": {
 *         "artifacts": ["src/feature.ts"],
 *         "test_results": "12 tests passed, 0 failed",
 *         "confidence": "HIGH"
 *       }
 *     }
 *   }
 * }
 * ```
 */
export async function ticketsCompleteHandler(
  params: TicketsCompleteInput,
): Promise<CallToolResult> {
  const { ticket_id, evidence } = params;

  logger.info({ ticket_id, confidence: evidence.confidence }, 'tickets.complete called');

  // ── Step 1: Look up the ticket to get current stage ────────────────────
  let currentTicket: Ticket | undefined;
  try {
    const ticketResult = await pool.query<Ticket>(
      'SELECT * FROM tickets WHERE ticket_id = $1',
      [ticket_id],
    );

    if (ticketResult.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'TICKET_NOT_FOUND',
            message: `Ticket ${ticket_id} does not exist`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    currentTicket = ticketResult.rows[0]!;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, ticket_id }, 'tickets.complete lookup failed');
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

  const previousStage = currentTicket.stage;

  // ── Step 2: Resolve agent UUID from claimed_by ─────────────────────────
  const agentId = currentTicket.claimed_by;
  const agentName = currentTicket.claimed_by_name ?? 'Unknown';

  if (!agentId) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'NOT_CLAIM_OWNER',
          message: `Ticket ${ticket_id} is not currently claimed`,
          ticket_id,
          timestamp: new Date().toISOString(),
        }),
      }],
    };
  }

  // ── Step 3: Build evidence JSONB ───────────────────────────────────────
  const evidencePayload = {
    stage: previousStage,
    completed_at: new Date().toISOString(),
    artifacts: evidence.artifacts,
    test_results: evidence.test_results,
    confidence: evidence.confidence,
    ...(evidence.notes !== undefined ? { notes: evidence.notes } : {}),
  };

  // ── Step 4: Call advance_ticket SQL function ───────────────────────────
  try {
    const result = await pool.query<Ticket>(
      'SELECT * FROM advance_ticket($1, $2, $3, $4)',
      [ticket_id, agentId, agentName, JSON.stringify(evidencePayload)],
    );

    if (result.rows.length === 0) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'INVALID_TRANSITION',
            message: `Cannot advance ticket ${ticket_id} — advance_ticket returned no rows`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    const advancedTicket = result.rows[0]!;
    const newStage = advancedTicket.stage;

    // ── Step 4b: Auto-reflection on rework completion ─────────────────────
    if (newStage === 'DONE' && advancedTicket.rework_count > 0) {
      try {
        const reflectionService = new ReflectionService(pool, new EmbeddingService());
        const lesson = await reflectionService.reflectOnTicket(ticket_id);
        if (lesson) {
          logger.info(
            { ticket_id, rework_count: lesson.reworkCount, stage: lesson.stage },
            'tickets.complete: reflection lesson captured',
          );
        }
      } catch (reflectionErr: unknown) {
        // Reflection should never block ticket progression.
        logger.warn(
          {
            ticket_id,
            error: reflectionErr instanceof Error ? reflectionErr.message : String(reflectionErr),
          },
          'tickets.complete: reflection capture failed (non-fatal)',
        );
      }
    }

    // ── Step 5: Query unblocked dependencies ─────────────────────────────
    let dependenciesUnblocked: string[] = [];
    if (newStage === 'DONE') {
      try {
        const unblockedResult = await pool.query<{ ticket_id: string }>(
          `SELECT e.ticket_id FROM events e
           WHERE e.event_type = 'UPDATED'
             AND e.payload->>'action' = 'dependency_resolved'
             AND e.payload->>'resolved_by' = $1
             AND e.created_at >= NOW() - INTERVAL '5 seconds'`,
          [ticket_id],
        );
        dependenciesUnblocked = unblockedResult.rows.map((r) => r.ticket_id);
      } catch (depErr) {
        logger.warn(
          { err: depErr, ticket_id },
          'Failed to query unblocked dependencies (non-fatal)',
        );
      }
    }

    const output: TicketsCompleteOutput = {
      ticket: advancedTicket,
      previous_stage: previousStage,
      new_stage: newStage,
      dependencies_unblocked: dependenciesUnblocked,
    };

    logger.info(
      {
        ticket_id,
        previous_stage: previousStage,
        new_stage: newStage,
        dependencies_unblocked: dependenciesUnblocked.length,
      },
      'tickets.complete succeeded',
    );

    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error({ err, ticket_id }, 'tickets.complete advance failed');

    if (message.includes('NOT_CLAIM_OWNER')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'NOT_CLAIM_OWNER',
            message: `You do not hold the claim on ticket ${ticket_id}`,
            ticket_id,
            timestamp: new Date().toISOString(),
          }),
        }],
      };
    }

    if (message.includes('INVALID_TRANSITION')) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'INVALID_TRANSITION',
            message: `Cannot advance ticket ${ticket_id} beyond the final stage`,
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
