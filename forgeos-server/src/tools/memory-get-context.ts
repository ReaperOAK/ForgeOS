/**
 * memory.get_context — Combined code graph + memory context for a file or ticket.
 *
 * Aggregates blast radius (if file_path provided), ticket description
 * (if ticket_id provided), and semantically relevant past lessons into
 * a single context response. Designed as the primary tool agents use
 * for context-aware decisions.
 *
 * Graceful degradation: if the code graph, embedding service, or ticket
 * lookup is unavailable, the tool returns partial results instead of
 * failing outright.
 *
 * @module tools/memory-get-context
 * @ticket TASK-INT-BE038
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Base Zod object schema for the `memory.get_context` MCP tool.
 * Used for MCP SDK registration (`.shape` access).
 *
 * - `file_path` (optional) — File path to compute blast radius for.
 * - `ticket_id` (optional) — Ticket ID to fetch description from.
 * - `max_lessons` (optional) — Maximum relevant lessons to return (1–50, default 5).
 */
export const memoryGetContextBaseSchema = z.object({
  file_path: z.string().min(1).optional().describe(
    'File path to compute blast radius and find file-relevant lessons',
  ),
  ticket_id: z.string().min(1).optional().describe(
    'Ticket ID to fetch description and find ticket-relevant lessons',
  ),
  max_lessons: z.number().int().min(1).max(50).optional().default(5).describe(
    'Maximum number of relevant lessons to return (1–50, default 5)',
  ),
});

/**
 * Refined schema that enforces at least one of `file_path` or `ticket_id`.
 * Used for handler-side validation.
 */
export const memoryGetContextSchema = memoryGetContextBaseSchema.refine(
  data => data.file_path !== undefined || data.ticket_id !== undefined,
  { message: 'Either file_path or ticket_id must be provided' },
);

/** Validated input type derived from the Zod schema. */
export type MemoryGetContextInput = z.infer<typeof memoryGetContextSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Shape returned by the blast_radius() stored function. */
interface BlastRadiusResult {
  file_path: string;
  max_depth: number;
  affected_files: string[];
  affected_symbols: Array<{
    name: string;
    qualified_name: string;
    kind: string;
    file_path: string;
    depth: number;
  }>;
  total_affected: number;
}

/** A single lesson match from search_similar_lessons(). */
interface LessonMatch {
  id: string;
  ticket_id: string;
  stage: string;
  agent_role: string;
  rework_count: number;
  lesson_text: string;
  category: string;
  tags: string[];
  similarity: number;
  created_at: string;
}

/** Successful result payload. */
interface GetContextResult {
  file_path: string | null;
  ticket_id: string | null;
  blast_radius: BlastRadiusResult | null;
  relevant_lessons: LessonMatch[];
  context_score: number;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Get combined code graph + memory context for a file or ticket.
 *
 * 1. If `file_path` provided: calls `blast_radius()` stored function.
 * 2. If `ticket_id` provided: fetches ticket title + description.
 * 3. Builds context text from available data, embeds it, and searches
 *    for semantically similar past lessons.
 * 4. Computes a `context_score` (0.0–1.0) reflecting how much context
 *    was successfully gathered.
 *
 * Each subsystem failure is caught independently for graceful degradation.
 *
 * @param input - Validated input with file_path and/or ticket_id
 * @returns MCP content response with combined context
 */
export async function memoryGetContextHandler(
  input: MemoryGetContextInput,
): Promise<CallToolResult> {
  const { file_path, ticket_id, max_lessons } = input;

  logger.info({ file_path, ticket_id, max_lessons }, 'memory.get_context called');

  const startMs = Date.now();
  let blastRadius: BlastRadiusResult | null = null;
  const contextParts: string[] = [];
  let contextScore = 0.0;

  // 1. If file_path: compute blast radius
  if (file_path) {
    try {
      const brResult = await pool.query<{ result: BlastRadiusResult }>(
        'SELECT blast_radius($1, $2) AS result',
        [file_path, 3],
      );
      blastRadius = brResult.rows[0]?.result ?? null;
      contextParts.push(`File: ${file_path}`);
      if (blastRadius && blastRadius.total_affected > 0) {
        contextParts.push(
          `Affected files: ${blastRadius.affected_files.join(', ')}`,
        );
      }
      contextScore += 0.3;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { event: 'memory_get_context_blast_radius_degraded', file_path, error: msg },
        'Blast radius unavailable — degrading gracefully',
      );
      contextParts.push(`File: ${file_path}`);
    }
  }

  // 2. If ticket_id: fetch ticket description
  if (ticket_id) {
    try {
      const ticketResult = await pool.query<{ title: string; description: string }>(
        'SELECT title, description FROM tickets WHERE ticket_id = $1',
        [ticket_id],
      );
      const row = ticketResult.rows[0];
      if (row) {
        contextParts.push(`Ticket ${ticket_id}: ${row.title}`);
        if (row.description) {
          contextParts.push(row.description);
        }
        contextScore += 0.3;
      } else {
        logger.warn(
          { event: 'memory_get_context_ticket_not_found', ticket_id },
          'Ticket not found',
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { event: 'memory_get_context_ticket_degraded', ticket_id, error: msg },
        'Ticket lookup unavailable — degrading gracefully',
      );
    }
  }

  // 3. Search for relevant lessons using embedding
  let relevantLessons: LessonMatch[] = [];

  if (contextParts.length > 0) {
    const contextText = contextParts.join(' ');

    try {
      const embeddingService = new EmbeddingService();
      const embedding = await embeddingService.embedText(contextText);

      const lessonsResult = await pool.query<{ search_similar_lessons: LessonMatch[] }>(
        'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
        [JSON.stringify(embedding), null, 0.5, max_lessons],
      );
      relevantLessons = lessonsResult.rows[0]?.search_similar_lessons ?? [];

      if (relevantLessons.length > 0) {
        contextScore += 0.4;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(
        { event: 'memory_get_context_lessons_degraded', error: msg },
        'Lesson search unavailable — degrading gracefully',
      );
    }
  }

  const durationMs = Date.now() - startMs;

  logger.debug(
    {
      event: 'memory_get_context_complete',
      file_path,
      ticket_id,
      max_lessons,
      blast_radius_available: blastRadius !== null,
      lessons_count: relevantLessons.length,
      context_score: Math.min(contextScore, 1.0),
      durationMs,
    },
    'memory.get_context complete',
  );

  const result: GetContextResult = {
    file_path: file_path ?? null,
    ticket_id: ticket_id ?? null,
    blast_radius: blastRadius,
    relevant_lessons: relevantLessons,
    context_score: Math.min(contextScore, 1.0),
  };

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}
