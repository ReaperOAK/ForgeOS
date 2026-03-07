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
}
