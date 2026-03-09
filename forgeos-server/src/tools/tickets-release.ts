/**
 * tickets.release — Release a claim on a ticket.
 *
 * Calls the `release_ticket` PostgreSQL function which clears the claim
 * fields (claimed_by, machine_id, operator, lease_expiry), releases all
 * file locks, and records a RELEASED or FORCE_RELEASED event.
 *
 * Normal release requires the calling agent to be the current claim
 * owner. Forced release (admin only) can release any agent's claim.
 *
 * Error codes returned on failure:
 * - `TICKET_NOT_FOUND` — no ticket with the given ID exists.
 * - `NOT_CLAIM_OWNER` — caller is not the claim owner and force=false.
 * - `FORBIDDEN` — force=true but caller lacks admin permission.
 * - `INTERNAL_ERROR` — unexpected database or runtime error.
 *
 * @module tools/tickets-release
 * @ticket TASK-FOS-03-008
 * @see {@link ticketsReleaseSchema} for input validation
 * @see {@link ticketsReleaseHandler} for the request handler
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { Ticket } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod schema for `tickets.release` input parameters.
 *
 * Validates and coerces incoming MCP tool arguments before the handler
 * executes.
 *
 * - `ticket_id` (required) — Human-readable ticket ID to release.
 * - `agent_name` (required) — Name of the agent requesting the release.
 *   Used to look up the agent's UUID and verify claim ownership.
 * - `reason` (optional) — Free-text reason for releasing.
 * - `force` (boolean, default false) — Force-release (admin only).
 */
export const ticketsReleaseSchema = z.object({
  ticket_id: z.string().min(1).describe('Human-readable ticket ID to release'),
  agent_name: z.string().min(1).describe('Name of the agent releasing the claim'),
  reason: z.string().optional().describe('Optional reason for releasing the claim'),
  force: z.boolean().default(false).describe('Force-release even if not claim owner (admin only)'),
});

/** Validated input type derived from the Zod schema. */
type TicketsReleaseInput = z.infer<typeof ticketsReleaseSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Successful result payload. */
interface TicketsReleaseResult {
  /** The ticket with cleared claim fields. */
  ticket: Ticket;
  /** List of file paths whose locks were released. */
  released_file_locks: string[];
}

/** Error result payload. */
interface TicketsReleaseError {
  /** Machine-readable error code. */
  error: string;
  /** Human-readable error message. */
  message: string;
  /** The ticket_id that was targeted. */
  ticket_id: string;
  /** ISO 8601 timestamp of the error. */
  timestamp: string;
}

// ── Helper ───────────────────────────────────────────────────────────────────

/**
 * Check whether an agent has admin permissions.
 *
 * An agent is considered admin if their permissions array contains
 * the wildcard `"*"` or the explicit `"admin_all"` permission.
 *
 * @param permissions - Array of permission strings from the agent record.
 * @returns `true` if the agent has admin-level access.
 */
function hasAdminPermission(permissions: string[]): boolean {
  return permissions.includes('*') || permissions.includes('admin_all');
}

/**
 * Build an error response in MCP CallToolResult format.
 *
 * @param error - Machine-readable error code.
 * @param message - Human-readable description.
 * @param ticketId - The ticket_id that was targeted.
 * @returns A CallToolResult with JSON-serialised error payload.
 */
function buildErrorResult(
  error: string,
  message: string,
  ticketId: string,
): CallToolResult {
  const payload: TicketsReleaseError = {
    error,
    message,
    ticket_id: ticketId,
    timestamp: new Date().toISOString(),
  };
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handler for the `tickets.release` MCP tool.
 *
 * Releases a claim on the specified ticket by calling the `release_ticket`
 * SQL function. The function uses `SELECT FOR UPDATE` to guarantee
 * serialised access to the ticket row.
 *
 * When `force` is `false` (default), the SQL function verifies that the
 * calling agent holds the current claim. When `force` is `true`, admin
 * permissions are verified at the application layer before invoking the
 * SQL function.
 *
 * On success the handler returns the updated ticket with cleared claim
 * fields and a list of file paths whose locks were released.
 *
 * @param params - Validated input conforming to {@link ticketsReleaseSchema}.
 * @returns A {@link CallToolResult} with JSON-serialised output or error.
 *
 * @example
 * ```jsonc
 * // MCP request — normal release
 * { "method": "tools/call",
 *   "params": { "name": "tickets.release",
 *     "arguments": { "ticket_id": "TASK-001", "agent_name": "Backend",
 *       "reason": "Work complete" } } }
 *
 * // MCP request — forced admin release
 * { "method": "tools/call",
 *   "params": { "name": "tickets.release",
 *     "arguments": { "ticket_id": "TASK-001", "agent_name": "Admin",
 *       "force": true, "reason": "Lease recovery" } } }
 * ```
 */
export async function ticketsReleaseHandler(
  params: TicketsReleaseInput,
): Promise<CallToolResult> {
  const { ticket_id, agent_name, reason, force } = params;

  logger.info(
    { ticket_id, agent_name, force },
    'tickets.release called',
  );

  try {
    // ── 1. Resolve agent identity ──────────────────────────────────────────
    const agentResult = await pool.query<{
      id: string;
      permissions: string[];
    }>(
      'SELECT id, permissions FROM agents WHERE name = $1 LIMIT 1',
      [agent_name],
    );

    let agentId: string;
    let permissions: string[];

    if (agentResult.rows.length === 0) {
      // Auto-register agent with default (non-admin) permissions
      const insertResult = await pool.query<{
        id: string;
        permissions: string[];
      }>(
        `INSERT INTO agents (name, role, permissions)
         VALUES ($1, $1, '["agent_update"]'::JSONB)
         ON CONFLICT (name, role) DO UPDATE SET updated_at = NOW()
         RETURNING id, permissions`,
        [agent_name],
      );
      agentId = insertResult.rows[0]!.id;
      permissions = insertResult.rows[0]!.permissions;
    } else {
      agentId = agentResult.rows[0]!.id;
      permissions = agentResult.rows[0]!.permissions;
    }

    // ── 2. Admin gate for forced release ───────────────────────────────────
    if (force && !hasAdminPermission(permissions)) {
      logger.warn(
        { ticket_id, agent_name, permissions },
        'tickets.release FORBIDDEN: non-admin attempted force release',
      );
      return buildErrorResult(
        'FORBIDDEN',
        'Force release requires admin permissions',
        ticket_id,
      );
    }

    // ── 3. Snapshot file locks before release ──────────────────────────────
    const locksBeforeResult = await pool.query<{ file_path: string }>(
      'SELECT file_path FROM file_locks WHERE ticket_id = $1 AND released_at IS NULL',
      [ticket_id],
    );
    const releasedFileLocks = locksBeforeResult.rows.map((r) => r.file_path);

    // ── 4. Call release_ticket SQL function ─────────────────────────────────
    const result = await pool.query<Ticket>(
      'SELECT * FROM release_ticket($1, $2, $3, $4, $5)',
      [ticket_id, agentId, agent_name, reason ?? null, force],
    );

    if (result.rows.length === 0) {
      logger.warn(
        { ticket_id, agent_name },
        'tickets.release: release_ticket returned no rows',
      );
      return buildErrorResult(
        'INTERNAL_ERROR',
        'release_ticket returned no rows unexpectedly',
        ticket_id,
      );
    }

    const ticket = result.rows[0]!;

    logger.info(
      {
        ticket_id,
        agent_name,
        force,
        released_file_locks: releasedFileLocks,
        event_type: force ? 'FORCE_RELEASED' : 'RELEASED',
      },
      'tickets.release succeeded',
    );

    // ── 5. Build success response ──────────────────────────────────────────
    const output: TicketsReleaseResult = {
      ticket,
      released_file_locks: releasedFileLocks,
    };

    return { content: [{ type: 'text', text: JSON.stringify(output) }] };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, ticket_id, agent_name }, 'tickets.release failed');

    // ── Map known SQL exceptions to error codes ────────────────────────────
    if (message.includes('TICKET_NOT_FOUND')) {
      return buildErrorResult(
        'TICKET_NOT_FOUND',
        `Ticket ${ticket_id} does not exist`,
        ticket_id,
      );
    }

    if (message.includes('NOT_CLAIM_OWNER')) {
      return buildErrorResult(
        'NOT_CLAIM_OWNER',
        'You do not hold the claim on this ticket',
        ticket_id,
      );
    }

    return buildErrorResult(
      'INTERNAL_ERROR',
      message,
      ticket_id,
    );
  }
}
