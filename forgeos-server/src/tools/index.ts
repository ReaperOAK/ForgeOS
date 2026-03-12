/**
 * MCP Tool Registration — barrel file for all ForgeOS MCP tools.
 *
 * Registers each tool on the McpServer instance via `server.tool()`.
 * Each tool module exports a Zod schema and an async handler.
 *
 * @module tools
 * @ticket TASK-FOS-03-001
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ticketsNextSchema, ticketsNextHandler } from './tickets-next.js';
import { ticketsClaimSchema, ticketsClaimHandler } from './tickets-claim.js';
import { ticketsRejectSchema, ticketsRejectHandler } from './tickets-reject.js';
import { ticketsSpawnSchema, ticketsSpawnHandler } from './tickets-spawn.js';
import { ticketsCompleteSchema, ticketsCompleteHandler } from './tickets-complete.js';
import { ticketsExtendSchema, ticketsExtendHandler } from './tickets-extend.js';
import { ticketsUpdateSchema, ticketsUpdateHandler } from './tickets-update.js';
import { ticketsReleaseSchema, ticketsReleaseHandler } from './tickets-release.js';
import { ticketsStatsSchema, ticketsStatsHandler } from './tickets-stats.js';

/**
 * Register all MCP tools on the server.
 *
 * @param server - McpServer instance to register tools on
 */
export function registerTools(server: McpServer): void {
  // ── tickets.next ─────────────────────────────────────────────────────────
  server.tool(
    'tickets.next',
    'Find the next available ticket for a given SDLC stage (peek, not claim)',
    ticketsNextSchema.shape,
    async (params) => ticketsNextHandler(params),
  );

  // ── tickets.claim ────────────────────────────────────────────────────────
  server.tool(
    'tickets.claim',
    'Atomically claim a specific ticket by ID with file lock acquisition',
    ticketsClaimSchema.shape,
    async (params) => ticketsClaimHandler(params),
  );

  // ── tickets.reject ───────────────────────────────────────────────────────
  server.tool(
    'tickets.reject',
    'Reject a ticket and send it back to its implementation stage for rework. Requires a rejection reason. If rework count reaches max_reworks, the ticket is automatically escalated.',
    ticketsRejectSchema.shape,
    async (params) => ticketsRejectHandler(params),
  );


  // ── tickets.spawn ────────────────────────────────────────────────────────
  server.tool(
    'tickets.spawn',
    'Create a child ticket under an existing parent ticket with generated ticket_id, inherited project context, and parent_id linkage',
    ticketsSpawnSchema.shape,
    async (params) => ticketsSpawnHandler(params),
  );

  // -- tickets.complete -----------------------------------------------
  server.tool(
    'tickets.complete',
    'Complete the current SDLC stage and advance the ticket to the next stage in its flow. Requires completion evidence including artifacts, test results, and confidence level.',
    ticketsCompleteSchema.shape,
    async (params) => ticketsCompleteHandler(params),
  );

  // ── tickets.extend ───────────────────────────────────────────────────────
  server.tool(
    'tickets.extend',
    'Extend the lease on a claimed ticket to prevent expiry during long operations',
    ticketsExtendSchema.shape,
    async (params) => ticketsExtendHandler(params),
  );

  // ── tickets.update ───────────────────────────────────────────────────────
  server.tool(
    'tickets.update',
    'Update metadata on a claimed ticket. Only the current claim owner can update. Merges metadata using jsonb || operator.',
    ticketsUpdateSchema.shape,
    async (params) => ticketsUpdateHandler(params),
  );

  // ── tickets.release ──────────────────────────────────────────────────────
  server.tool(
    'tickets.release',
    'Release a claim on a ticket. Normal release requires claim ownership. Force release (admin) can release any claim.',
    ticketsReleaseSchema.shape,
    async (params) => ticketsReleaseHandler(params),
  );

  // ── tickets.stats ────────────────────────────────────────────────────────
  server.tool(
    'tickets.stats',
    'Get aggregate system statistics: per-stage counts, per-status counts, claim health, average time-in-stage, rework distribution.',
    ticketsStatsSchema.shape,
    async (params) => ticketsStatsHandler(params),
  );
}
