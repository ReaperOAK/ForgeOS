/**
 * tickets.payload — Return full delegation context for an agent.
 *
 * Assembles the complete context packet an agent needs to begin work on
 * a ticket: ticket JSON, upstream stage summary, file scope, and relevant
 * memory entries from the events table.
 *
 * @module tools/tickets-payload
 * @ticket TASK-INT-BE013
 */

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { Ticket, TicketEvent, TicketStage } from '../types/index.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Constants ────────────────────────────────────────────────────────────────

/**
 * Maps each SDLC stage to the agent-output folder name of the agent
 * that owns that stage. Used to locate upstream summary files.
 */
const STAGE_TO_AGENT_FOLDER: Record<TicketStage, string> = {
  READY: '',
  RESEARCH: 'Research',
  ARCHITECT: 'Architect',
  PRODUCT_MANAGER: 'ProductManager',
  UI_DESIGN: 'UIDesigner',
  BACKEND: 'Backend',
  FRONTEND: 'Frontend',
  QA: 'QA',
  SECURITY: 'Security',
  CI: 'CIReviewer',
  DOCUMENTATION: 'Documentation',
  VALIDATOR: 'Validator',
  DONE: '',
};

/**
 * Root of the agent-output directory relative to the repository root.
 */
const AGENT_OUTPUT_ROOT = '.github/agent-output';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `tickets.payload` MCP tool.
 *
 * - `ticket_id` (required) — Human-readable ticket identifier.
 * - `agent_role` (required) — The SDLC stage / role of the requesting agent.
 */
export const ticketsPayloadSchema = z.object({
  ticket_id: z.string().min(1).describe(
    'Human-readable ticket identifier (e.g., TASK-INT-BE013)',
  ),
  agent_role: z.string().min(1).describe(
    'The SDLC stage or role of the requesting agent (e.g., BACKEND, QA)',
  ),
});

/** Validated input type derived from the Zod schema. */
type TicketsPayloadInput = z.infer<typeof ticketsPayloadSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Successful payload result. */
interface TicketsPayloadResult {
  ticket: Ticket;
  upstream_summary: string | null;
  file_scope: string[];
  memory_entries: TicketEvent[];
  message: string;
}

/** Error result payload. */
interface TicketsPayloadError {
  ticket: null;
  upstream_summary: null;
  file_scope: [];
  memory_entries: [];
  message: string;
  error: string;
  timestamp: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Determine the upstream stage for a given ticket and its current stage.
 *
 * Walks the ticket's `sdlc_flow` array and returns the stage immediately
 * before the current one, or `null` if the current stage is the first.
 */
function getUpstreamStage(
  sdlcFlow: TicketStage[],
  currentStage: TicketStage,
): TicketStage | null {
  const idx = sdlcFlow.indexOf(currentStage);
  if (idx <= 0) return null;
  return sdlcFlow[idx - 1] ?? null;
}

/**
 * Read the upstream agent summary from the filesystem.
 *
 * @returns The file contents as a string, or `null` if the file does not exist.
 */
async function readUpstreamSummary(
  upstreamStage: TicketStage | null,
  ticketId: string,
): Promise<string | null> {
  if (!upstreamStage) return null;

  const agentFolder = STAGE_TO_AGENT_FOLDER[upstreamStage];
  if (!agentFolder) return null;

  const filePath = join(AGENT_OUTPUT_ROOT, agentFolder, `${ticketId}.md`);

  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    logger.debug(
      { filePath, ticketId, upstreamStage },
      'tickets.payload: upstream summary file not found',
    );
    return null;
  }
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Assemble and return the full delegation context for an agent.
 *
 * Steps:
 * 1. Fetch the ticket from the database.
 * 2. Determine the upstream stage from the ticket's SDLC flow.
 * 3. Read the upstream summary file from `.github/agent-output/`.
 * 4. Query memory entries (events) for the ticket.
 * 5. Return the combined payload.
 *
 * @param input - Validated input with ticket_id and agent_role
 * @returns MCP content response with delegation payload or error
 */
export async function ticketsPayloadHandler(
  input: TicketsPayloadInput,
): Promise<CallToolResult> {
  const { ticket_id, agent_role } = input;

  logger.info({ ticket_id, agent_role }, 'tickets.payload called');

  try {
    const startMs = Date.now();

    // 1. Fetch the ticket
    const ticketResult = await pool.query<Ticket>(
      'SELECT * FROM tickets WHERE ticket_id = $1',
      [ticket_id],
    );

    if (ticketResult.rows.length === 0) {
      logger.warn({ ticket_id }, 'tickets.payload: ticket not found');

      const errorResult: TicketsPayloadError = {
        ticket: null,
        upstream_summary: null,
        file_scope: [],
        memory_entries: [],
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

    // 2. Determine upstream stage
    const upstreamStage = getUpstreamStage(ticket.sdlc_flow, ticket.stage);

    // 3. Read upstream summary
    const upstreamSummary = await readUpstreamSummary(upstreamStage, ticket_id);

    // 4. Query memory entries (events for this ticket)
    const eventsResult = await pool.query<TicketEvent>(
      'SELECT * FROM events WHERE ticket_id = $1 ORDER BY created_at DESC',
      [ticket_id],
    );

    // 5. File scope from ticket
    const fileScope = ticket.file_paths ?? [];

    const durationMs = Date.now() - startMs;

    logger.debug(
      {
        event: 'tickets_payload_query',
        ticket_id,
        agent_role,
        upstreamStage,
        hasUpstreamSummary: upstreamSummary !== null,
        memoryEntryCount: eventsResult.rows.length,
        durationMs,
      },
      'tickets.payload assembled',
    );

    const result: TicketsPayloadResult = {
      ticket,
      upstream_summary: upstreamSummary,
      file_scope: fileScope,
      memory_entries: eventsResult.rows,
      message: 'OK',
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'tickets_payload_error',
        ticket_id,
        agent_role,
        error: errorMessage,
      },
      'tickets.payload failed',
    );

    const errorResult: TicketsPayloadError = {
      ticket: null,
      upstream_summary: null,
      file_scope: [],
      memory_entries: [],
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
