/**
 * code.blast_radius — Compute blast radius for a file change.
 *
 * Given a file path, traverses the code_dependencies graph via the
 * `blast_radius()` PostgreSQL stored function to determine all
 * transitively affected symbols and files.
 *
 * @module tools/code-blast-radius
 * @ticket TASK-INT-BE024
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `code.blast_radius` MCP tool.
 *
 * - `file_path` (required) — Path of the changed file to analyze.
 * - `max_depth` (optional) — Maximum traversal depth (1–20, default 5).
 */
export const codeBlastRadiusSchema = z.object({
  file_path: z.string().min(1).describe(
    'Path of the changed file to compute blast radius for',
  ),
  max_depth: z.number().int().min(1).max(20).optional().default(5).describe(
    'Maximum traversal depth for dependency graph (1–20, default 5)',
  ),
});

/** Validated input type derived from the Zod schema. */
type CodeBlastRadiusInput = z.infer<typeof codeBlastRadiusSchema>;

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

/** Empty blast radius returned when the file is not indexed. */
const EMPTY_RESULT: BlastRadiusResult = {
  file_path: '',
  max_depth: 5,
  affected_files: [],
  affected_symbols: [],
  total_affected: 0,
};

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Compute blast radius by calling the `blast_radius()` stored function.
 *
 * The stored function uses a recursive CTE to traverse `code_edges`
 * and returns a JSONB object with affected files, symbols, and counts.
 * If the file is not indexed, the function returns zero results gracefully.
 *
 * @param input - Validated input with file_path and max_depth
 * @returns MCP content response with blast radius data
 */
export async function codeBlastRadiusHandler(
  input: CodeBlastRadiusInput,
): Promise<CallToolResult> {
  const { file_path, max_depth } = input;

  logger.info({ file_path, max_depth }, 'code.blast_radius called');

  try {
    const startMs = Date.now();

    const result = await pool.query<{ result: BlastRadiusResult }>(
      'SELECT blast_radius($1, $2) AS result',
      [file_path, max_depth],
    );

    const durationMs = Date.now() - startMs;

    const blastRadius: BlastRadiusResult = result.rows[0]?.result ?? {
      ...EMPTY_RESULT,
      file_path,
      max_depth,
    };

    logger.debug(
      {
        event: 'code_blast_radius_query',
        file_path,
        max_depth,
        durationMs,
        total_affected: blastRadius.total_affected,
      },
      'code.blast_radius query executed',
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(blastRadius) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'code_blast_radius_error',
        file_path,
        max_depth,
        error: errorMessage,
      },
      'code.blast_radius query failed',
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          file_path,
          max_depth,
          affected_files: [],
          affected_symbols: [],
          total_affected: 0,
          error: errorMessage,
        }),
      }],
      isError: true,
    };
  }
}
