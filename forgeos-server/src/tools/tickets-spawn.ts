/**
 * tickets.spawn — Create Child Ticket.
 *
 * Creates a child ticket linked to an existing parent ticket, enabling
 * self-expanding workflows. The child ticket receives a generated
 * `ticket_id` following the pattern `{parent_id}-SUB-{sequential_number}`,
 * inherits the parent's `project_id`, and has `parent_id` set to the
 * parent `ticket_id`. The child starts in `BLOCKED` status if it has
 * dependencies, or `READY` if not. A `SPAWNED` event is recorded on the
 * parent ticket with the child `ticket_id` in the payload.
 *
 * Error codes returned on failure:
 * - `INVALID_SUBTASK` — title, type, or acceptance_criteria are missing/empty.
 * - `TICKET_NOT_FOUND` — parent ticket does not exist.
 * - `INTERNAL_ERROR` — unexpected database or runtime error.
 *
 * @module tools/tickets-spawn
 * @ticket TASK-FOS-03-006
 * @see {@link ticketsSpawnSchema} for input validation
 * @see {@link ticketsSpawnHandler} for the request handler
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import { handleTicketTransition } from '../webhooks/reconciliation.js';
import {
  SDLC_FLOWS,
  TICKET_TYPES,
  TICKET_PRIORITIES,
} from '../types/index.js';
import type {
  Ticket,
  TicketsSpawnOutput,
  TicketType,
} from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod schema for `tickets.spawn` input parameters.
 *
 * Validates and coerces incoming MCP tool arguments before the handler
 * executes. Required fields: `parent_id`, `title`, `type`,
 * `acceptance_criteria`, `file_paths`. Optional: `priority` (default
 * `medium`), `description`, `depends_on`.
 */
export const ticketsSpawnSchema = z.object({
  parent_id: z.string().min(1).describe('ticket_id of the parent ticket'),
  title: z.string().min(1).max(200).describe('Title for the child ticket (max 200 chars)'),
  type: z.enum(TICKET_TYPES as [string, ...string[]]).describe(
    'Classification type for the child ticket (determines SDLC flow)',
  ),
  priority: z.enum(TICKET_PRIORITIES as [string, ...string[]]).default('medium').describe(
    'Priority for the child ticket (defaults to medium)',
  ),
  acceptance_criteria: z.array(z.string().min(1)).min(1).describe(
    'Acceptance criteria the child ticket must satisfy (at least one required)',
  ),
  file_paths: z.array(z.string()).describe(
    'Workspace-relative file paths within the child ticket write scope',
  ),
  description: z.string().optional().describe(
    'Detailed description of the child ticket',
  ),
  depends_on: z.array(z.string()).optional().describe(
    'Array of ticket_id values the child depends on',
  ),
});

/** Validated input type derived from the Zod schema. */
export type TicketsSpawnInput = z.infer<typeof ticketsSpawnSchema>;

// ── Error Response Builder ───────────────────────────────────────────────────

/**
 * Build a standardized error {@link CallToolResult}.
 *
 * @param error - Machine-readable error code.
 * @param message - Human-readable error description.
 * @param parentId - The parent ticket id involved, if applicable.
 * @returns A {@link CallToolResult} with JSON-serialised error payload.
 */
function errorResult(
  error: string,
  message: string,
  parentId: string,
): CallToolResult {
  return {
    content: [{
      type: 'text',
      text: JSON.stringify({
        error,
        message,
        parent_id: parentId,
        timestamp: new Date().toISOString(),
      }),
    }],
  };
}

// ── Child Ticket ID Generator ────────────────────────────────────────────────

/**
 * Generate the next sequential child ticket ID for a parent.
 *
 * Queries the `tickets` table to count existing children of the parent
 * (tickets whose `parent_id` equals the given `parentTicketId`) and
 * returns `{parentTicketId}-SUB-{nextNumber}`.
 *
 * @param parentTicketId - The `ticket_id` of the parent.
 * @returns The generated child `ticket_id` string.
 */
async function generateChildTicketId(parentTicketId: string): Promise<string> {
  const result = await pool.query<{ count: string }>(
    'SELECT COUNT(*)::TEXT AS count FROM tickets WHERE parent_id = $1',
    [parentTicketId],
  );
  const existingCount = parseInt(result.rows[0]?.count ?? '0', 10);
  const nextNumber = existingCount + 1;
  return `${parentTicketId}-SUB-${nextNumber}`;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handler for the `tickets.spawn` MCP tool.
 *
 * Creates a child ticket under the specified parent ticket. The child
 * inherits the parent's `project_id`, receives a generated `ticket_id`,
 * and enters the SDLC flow determined by its `type`. A `SPAWNED` event
 * is recorded on the parent ticket.
 *
 * All database mutations (child INSERT, parent event INSERT) execute
 * within a single transaction for atomicity.
 *
 * @param params - Validated input conforming to {@link ticketsSpawnSchema}.
 * @returns A {@link CallToolResult} with JSON-serialised {@link TicketsSpawnOutput} or error.
 *
 * @example
 * ```jsonc
 * // MCP request
 * { "method": "tools/call",
 *   "params": { "name": "tickets.spawn",
 *     "arguments": {
 *       "parent_id": "TASK-001",
 *       "title": "Implement helper function",
 *       "type": "backend",
 *       "acceptance_criteria": ["Helper returns correct value"],
 *       "file_paths": ["src/helpers/util.ts"]
 *     } } }
 * ```
 */
export async function ticketsSpawnHandler(
  params: TicketsSpawnInput,
): Promise<CallToolResult> {
  const {
    parent_id,
    title,
    type,
    priority,
    acceptance_criteria,
    file_paths,
    description,
    depends_on,
  } = params;

  logger.info({ parent_id, title, type }, 'tickets.spawn called');

  // ── Validate required fields ───────────────────────────────────────────
  // Zod already validates these via min(1), but we add explicit checks
  // for the INVALID_SUBTASK error code requirement.
  if (!title || title.trim().length === 0) {
    return errorResult(
      'INVALID_SUBTASK',
      'title is required and must not be empty',
      parent_id,
    );
  }

  if (!type || !TICKET_TYPES.includes(type as TicketType)) {
    return errorResult(
      'INVALID_SUBTASK',
      `type is required and must be one of: ${TICKET_TYPES.join(', ')}`,
      parent_id,
    );
  }

  if (!acceptance_criteria || acceptance_criteria.length === 0) {
    return errorResult(
      'INVALID_SUBTASK',
      'acceptance_criteria is required and must contain at least one entry',
      parent_id,
    );
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // ── Verify parent exists ─────────────────────────────────────────────
    const parentResult = await client.query<Ticket>(
      'SELECT * FROM tickets WHERE ticket_id = $1 LIMIT 1',
      [parent_id],
    );

    if (parentResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return errorResult(
        'TICKET_NOT_FOUND',
        `Parent ticket ${parent_id} does not exist`,
        parent_id,
      );
    }

    const parentTicket = parentResult.rows[0]!;

    // ── Generate child ticket_id ─────────────────────────────────────────
    const childTicketId = await generateChildTicketId(parent_id);

    // ── Determine SDLC flow and initial status ───────────────────────────
    const sdlcFlow = SDLC_FLOWS[type as TicketType];
    const dependsOnArray = depends_on ?? [];
    const initialStatus = dependsOnArray.length === 0 ? 'READY' : 'BLOCKED';
    const initialStage = sdlcFlow[0] ?? 'READY';

    // ── Insert child ticket ──────────────────────────────────────────────
    const insertResult = await client.query<Ticket>(
      `INSERT INTO tickets (
        ticket_id, project_id, title, description, type, priority,
        status, stage, sdlc_flow, depends_on, file_paths,
        acceptance_criteria, parent_id, metadata
      ) VALUES (
        $1, $2, $3, $4, $5::ticket_type, $6::ticket_priority,
        $7::ticket_status, $8::ticket_stage, $9::ticket_stage[],
        $10, $11, $12, $13, $14::JSONB
      ) RETURNING *`,
      [
        childTicketId,
        parentTicket.project_id,
        title,
        description ?? null,
        type,
        priority ?? 'medium',
        initialStatus,
        initialStage,
        sdlcFlow,
        dependsOnArray,
        file_paths,
        acceptance_criteria,
        parent_id,
        JSON.stringify({ spawned_from: parent_id }),
      ],
    );

    const childTicket = insertResult.rows[0]!;

    // ── Record SPAWNED event on parent ───────────────────────────────────
    await client.query(
      `INSERT INTO events (
        ticket_id, event_type, payload
      ) VALUES (
        $1, 'SPAWNED'::event_type,
        $2::JSONB
      )`,
      [
        parent_id,
        JSON.stringify({
          child_ticket_id: childTicketId,
          child_title: title,
          child_type: type,
          child_status: initialStatus,
        }),
      ],
    );

    // ── Record CREATED event on child ────────────────────────────────────
    await client.query(
      `INSERT INTO events (
        ticket_id, event_type, payload
      ) VALUES (
        $1, 'CREATED'::event_type,
        $2::JSONB
      )`,
      [
        childTicketId,
        JSON.stringify({
          parent_ticket_id: parent_id,
          spawned: true,
        }),
      ],
    );

    await client.query('COMMIT');

    logger.info(
      { parent_id, child_ticket_id: childTicketId, status: initialStatus },
      'tickets.spawn completed successfully',
    );

    // ── Return success ───────────────────────────────────────────────────
    const output: TicketsSpawnOutput = {
      ticket: childTicket,
      parent_ticket_id: parent_id,
    };

    if (childTicket.status === 'READY') {
      handleTicketTransition(childTicket.ticket_id, childTicket.stage, childTicket.status);
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(output) }],
    };
  } catch (err: unknown) {
    await client.query('ROLLBACK').catch(() => {
      /* rollback best-effort */
    });

    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, parent_id }, 'tickets.spawn failed');

    return errorResult('INTERNAL_ERROR', message, parent_id);
  } finally {
    client.release();
  }
}
