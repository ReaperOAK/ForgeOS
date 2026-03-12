/**
 * memory.add_lesson — Record a lesson learned during agent work.
 *
 * Accepts lesson metadata, inserts into the `lessons` table,
 * generates an embedding via {@link EmbeddingService}, and stores
 * the vector in the `lesson_embeddings` table.
 *
 * @module tools/memory-add-lesson
 * @ticket TASK-INT-BE037
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `memory.add_lesson` MCP tool.
 *
 * - `ticket_id` (required) — Originating ticket identifier.
 * - `stage` (required) — SDLC stage where the lesson was learned.
 * - `agent_role` (required) — Role of the agent recording the lesson.
 * - `lesson_text` (required) — The lesson content (min 10 chars).
 * - `category` (optional) — Broad classification. Defaults to `'general'`.
 * - `tags` (optional) — Fine-grained labels. Defaults to `[]`.
 */
export const memoryAddLessonSchema = z.object({
  ticket_id: z.string().min(1).describe('Originating ticket identifier'),
  stage: z.string().min(1).describe('SDLC stage where the lesson was learned'),
  agent_role: z.string().min(1).describe('Role of the agent recording the lesson'),
  lesson_text: z.string().min(10).describe('The lesson content (min 10 characters)'),
  category: z.string().optional().default('general').describe(
    'Broad classification category (default: "general")',
  ),
  tags: z.array(z.string()).optional().default([]).describe(
    'Fine-grained labels for filtered retrieval',
  ),
});

/** Validated input type derived from the Zod schema. */
type MemoryAddLessonInput = z.infer<typeof memoryAddLessonSchema>;

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Insert a lesson into the `lessons` table, generate an embedding, and
 * store it in `lesson_embeddings`.
 *
 * @param input - Validated lesson input.
 * @returns MCP content response with the created lesson ID.
 */
export async function memoryAddLessonHandler(
  input: MemoryAddLessonInput,
): Promise<CallToolResult> {
  const { ticket_id, stage, agent_role, lesson_text, category, tags } = input;

  logger.info(
    { ticket_id, stage, agent_role, category, tags },
    'memory.add_lesson called',
  );

  try {
    // 1. Insert lesson into database
    const lessonResult = await pool.query<{ id: string }>(
      `INSERT INTO lessons (ticket_id, stage, agent_role, lesson_text, category, tags)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [ticket_id, stage, agent_role, lesson_text, category, tags],
    );
    const row = lessonResult.rows[0];
    if (!row) {
      throw new Error('INSERT INTO lessons returned no rows');
    }
    const lessonId: string = row.id;

    // 2. Generate embedding via EmbeddingService
    const embeddingService = new EmbeddingService();
    const embedding = await embeddingService.embedText(lesson_text);

    // 3. Store embedding in lesson_embeddings
    await pool.query(
      `INSERT INTO lesson_embeddings (lesson_id, embedding)
       VALUES ($1, $2::vector)`,
      [lessonId, JSON.stringify(embedding)],
    );

    logger.info(
      { lesson_id: lessonId, ticket_id, stage },
      'memory.add_lesson created lesson with embedding',
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({ lesson_id: lessonId, status: 'created' }),
      }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      { event: 'memory_add_lesson_error', ticket_id, error: errorMessage },
      'memory.add_lesson failed',
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          error: 'INTERNAL_ERROR',
          message: `Failed to add lesson: ${errorMessage}`,
          timestamp: new Date().toISOString(),
        }),
      }],
      isError: true,
    };
  }
}
