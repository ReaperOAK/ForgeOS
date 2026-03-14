/**
 * memory.search_lessons — Search for relevant past lessons by natural language query.
 *
 * Embeds the query text via {@link EmbeddingService}, then calls the
 * `search_similar_lessons()` PostgreSQL stored function to find lessons
 * ranked by cosine similarity. Supports optional category filtering,
 * similarity threshold, and result limit.
 *
 * @module tools/memory-search-lessons
 * @ticket TASK-INT-BE036
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `memory.search_lessons` MCP tool.
 *
 * - `query` (required) — Natural language search query.
 * - `category` (optional) — Filter lessons by category.
 * - `threshold` (optional) — Minimum similarity score (0–1, default 0.7).
 * - `limit` (optional) — Maximum results to return (1–100, default 10).
 */
export const memorySearchLessonsSchema = z.object({
  query: z.string().min(1).describe(
    'Natural language search query for finding relevant past lessons',
  ),
  category: z.string().optional().describe(
    'Optional category filter to narrow lesson results',
  ),
  threshold: z.number().min(0).max(1).optional().default(0.7).describe(
    'Minimum similarity score (0–1). Defaults to 0.7',
  ),
  limit: z.number().int().min(1).max(100).optional().default(10).describe(
    'Maximum number of results to return (1–100). Defaults to 10',
  ),
});

/** Validated input type derived from the Zod schema. */
export type MemorySearchLessonsInput = z.infer<typeof memorySearchLessonsSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** A single lesson match returned by the stored function. */
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
interface SearchLessonsResult {
  query: string;
  category: string | null;
  threshold: number;
  limit: number;
  lessons: LessonMatch[];
  total: number;
}

/** Error result payload. */
interface SearchLessonsError {
  lessons: [];
  total: 0;
  message: string;
  error: string;
  timestamp: string;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Search for relevant past lessons by embedding a natural language query.
 *
 * 1. Embeds the query text via {@link EmbeddingService.embedText}.
 * 2. Calls `search_similar_lessons()` stored function with the embedding vector.
 * 3. Returns ranked lessons with similarity scores.
 *
 * @param input - Validated input with query, optional category/threshold/limit
 * @returns MCP content response with search results or error
 */
export async function memorySearchLessonsHandler(
  input: MemorySearchLessonsInput,
): Promise<CallToolResult> {
  const { query, category, threshold, limit } = input;

  logger.info({ query, category, threshold, limit }, 'memory.search_lessons called');

  try {
    const startMs = Date.now();

    let lessons: LessonMatch[] = [];

    try {
      // 1. Embed the query text
      const embeddingService = new EmbeddingService();
      const queryEmbedding = await embeddingService.embedText(query);

      // 2. Call stored function with the embedding
      const queryResult = await pool.query<{ search_similar_lessons: LessonMatch[] }>(
        'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
        [
          JSON.stringify(queryEmbedding),
          category ?? null,
          threshold,
          limit,
        ],
      );

      lessons = queryResult.rows[0]?.search_similar_lessons ?? [];
    } catch (embedErr: unknown) {
      // Fallback: lexical search on lesson_text when embedding infra is unavailable.
      logger.warn(
        {
          query,
          category,
          error: embedErr instanceof Error ? embedErr.message : String(embedErr),
        },
        'memory.search_lessons embedding failed, using lexical fallback',
      );

      const lexical = await pool.query<LessonMatch>(
        `SELECT
          id,
          ticket_id,
          stage,
          agent_role,
          rework_count,
          lesson_text,
          category,
          tags,
          0.5::float AS similarity,
          created_at
         FROM lessons
         WHERE ($1::text IS NULL OR category = $1)
           AND lesson_text ILIKE $2
         ORDER BY created_at DESC
         LIMIT $3`,
        [category ?? null, `%${query}%`, limit],
      );

      lessons = lexical.rows;
    }

    const durationMs = Date.now() - startMs;

    logger.debug(
      {
        event: 'memory_search_lessons_query',
        query,
        category,
        threshold,
        limit,
        total: lessons.length,
        durationMs,
      },
      'memory.search_lessons query executed',
    );

    const result: SearchLessonsResult = {
      query,
      category: category ?? null,
      threshold,
      limit,
      lessons,
      total: lessons.length,
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'memory_search_lessons_error',
        query,
        category,
        error: errorMessage,
      },
      'memory.search_lessons failed',
    );

    const errorResult: SearchLessonsError = {
      lessons: [],
      total: 0,
      message: `Search error: ${errorMessage}`,
      error: 'INTERNAL_ERROR',
      timestamp: new Date().toISOString(),
    };

    return {
      content: [{ type: 'text', text: JSON.stringify(errorResult) }],
      isError: true,
    };
  }
}
