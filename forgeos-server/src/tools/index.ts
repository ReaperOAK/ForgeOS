/**
 * MCP Tool Registration — barrel file for all ForgeOS MCP tools.
 *
 * Registers each tool on the McpServer instance via the tool registration API.
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
import { ticketsGraphSchema, ticketsGraphHandler } from './tickets-graph.js';
import { ticketsListSchema, ticketsListHandler } from './tickets-list.js';
import { ticketsGetSchema, ticketsGetHandler } from './tickets-get.js';
import { ticketsPayloadSchema, ticketsPayloadHandler } from './tickets-payload.js';
import { ticketsAttachPromptsSchema, ticketsAttachPromptsHandler } from './tickets-attach-prompts.js';
import { initIndexSchema, initIndexHandler } from './init-index.js';
import { codeSearchSymbolsSchema, codeSearchSymbolsHandler } from './code-search-symbols.js';
import { codeBlastRadiusSchema, codeBlastRadiusHandler } from './code-blast-radius.js';
import { codeGetImportsSchema, codeGetImportsHandler } from './code-get-imports.js';
import { initOrientSchema, initOrientHandler } from './init-orient.js';
import { memorySearchLessonsSchema, memorySearchLessonsHandler } from './memory-search-lessons.js';
import { memoryAddLessonSchema, memoryAddLessonHandler } from './memory-add-lesson.js';
import { memoryGetContextBaseSchema, memoryGetContextSchema, memoryGetContextHandler } from './memory-get-context.js';
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

  // ── tickets.graph ────────────────────────────────────────────────────────
  server.tool(
    'tickets.graph',
    'Return the ticket dependency graph showing parent-child and depends_on relationships.',
    ticketsGraphSchema.shape,
    async (params) => ticketsGraphHandler(params),
  );

  // ── tickets.list ─────────────────────────────────────────────────────────
  server.tool(
    'tickets.list',
    'List tickets with optional filters (stage, status, type, priority, tags), pagination (limit, offset), and sorting (sort_by, sort_order). Returns ticket summaries and total_count.',
    ticketsListSchema.shape,
    async (params) => ticketsListHandler(params),
  );

  // ── tickets.get ──────────────────────────────────────────────────────────
  server.tool(
    'tickets.get',
    'Retrieve full ticket details by ticket_id, including current claim info, stage, dependencies, acceptance criteria, and event history.',
    ticketsGetSchema.shape,
    async (params) => ticketsGetHandler(params),
  );

  // ── tickets.payload ──────────────────────────────────────────────────────
  server.tool(
    'tickets.payload',
    'Return the full delegation context for an agent: ticket JSON, upstream stage summary, file scope, and memory entries.',
    ticketsPayloadSchema.shape,
    async (params) => ticketsPayloadHandler(params),
  );

  // ── tickets.attach_prompts ───────────────────────────────────────────────
  server.tool(
    'tickets.attach_prompts',
    'Generate and attach a descriptive agent-execution prompt to READY tickets using local-first LLM strategy (Ollama by default).',
    ticketsAttachPromptsSchema.shape,
    async (params) => ticketsAttachPromptsHandler(params),
  );

  // ── code.search_symbols ────────────────────────────────────────────────
  server.tool(
    'code.search_symbols',
    'Search for code symbols (functions, classes, methods, interfaces) by name pattern, optionally filtered by kind and file path. Uses ILIKE pattern matching.',
    codeSearchSymbolsSchema.shape,
    async (params) => codeSearchSymbolsHandler(params),
  );

  // ── code.blast_radius ────────────────────────────────────────────────────
  server.tool(
    'code.blast_radius',
    'Compute blast radius for a file — all transitively affected symbols and files via recursive graph traversal',
    codeBlastRadiusSchema.shape,
    async (params) => codeBlastRadiusHandler(params),
  );

  // ── code.get_imports ─────────────────────────────────────────────────────
  server.tool(
    'code.get_imports',
    'Get the import chain for a file — direct and transitive dependencies with depth info',
    codeGetImportsSchema.shape,
    async (params) => codeGetImportsHandler(params),
  );

  // ── init.index ───────────────────────────────────────────────────────────
  server.tool(
    'init.index',
    'Index the codebase — walk directory tree, parse source files with tree-sitter, populate code graph (code_files, code_symbols, code_imports, code_edges)',
    initIndexSchema.shape,
    async (params) => initIndexHandler(params),
  );

  // ── init.orient ──────────────────────────────────────────────────────────
  server.tool(
    'init.orient',
    'Auto-discover project framework, build system, package manager, test framework, languages, entry points, and key directories. Returns a structured orientation summary for first-contact with a new codebase.',
    initOrientSchema.shape,
    async (params) => initOrientHandler(params),
  );

  // ── memory.add_lesson ────────────────────────────────────────────────────
  server.tool(
    'memory.add_lesson',
    'Record a lesson learned during agent work. Generates embedding and stores for semantic search.',
    memoryAddLessonSchema.shape,
    async (params) => memoryAddLessonHandler(params),
  );

  // ── memory.search_lessons ────────────────────────────────────────────────
  server.tool(
    'memory.search_lessons',
    'Search for relevant past lessons by natural language query. Embeds the query, then uses cosine similarity to find matching lessons.',
    memorySearchLessonsSchema.shape,
    async (params) => memorySearchLessonsHandler(params),
  );

  // ── memory.get_context ───────────────────────────────────────────────────
  server.tool(
    'memory.get_context',
    'Get combined code graph + memory context for a file or ticket. Returns blast radius, relevant lessons, and context confidence score.',
    memoryGetContextBaseSchema.shape,
    async (params) => memoryGetContextHandler(memoryGetContextSchema.parse(params)),
  );
}
