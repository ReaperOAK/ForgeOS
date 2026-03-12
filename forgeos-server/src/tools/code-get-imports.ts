/**
 * code.get_imports — Get the import/dependency chain for a file.
 *
 * Given a file path, traverses the code_imports graph via the
 * `get_import_chain()` PostgreSQL stored function to determine all
 * direct and transitive imports (internal and external).
 *
 * @module tools/code-get-imports
 * @ticket TASK-INT-BE026
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `code.get_imports` MCP tool.
 *
 * - `file_path` (required) — Path of the file to analyse imports for.
 * - `max_depth` (optional) — Maximum traversal depth (1–50, default 10).
 */
export const codeGetImportsSchema = z.object({
  file_path: z.string().min(1).describe(
    'Path of the file to retrieve import chain for',
  ),
  max_depth: z.number().int().min(1).max(50).optional().default(10).describe(
    'Maximum traversal depth for import chain (1–50, default 10)',
  ),
});

/** Validated input type derived from the Zod schema. */
type CodeGetImportsInput = z.infer<typeof codeGetImportsSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Shape of an individual import entry returned by get_import_chain(). */
interface ImportEntry {
  target_path: string;
  resolved_path: string | null;
  language: string | null;
  depth: number;
  is_external: boolean;
}

/** Shape returned by the get_import_chain() stored function. */
interface ImportChainResult {
  file_path: string;
  imports: ImportEntry[];
  total: number;
}

/** Empty result returned when the file is not indexed. */
const EMPTY_RESULT: ImportChainResult = {
  file_path: '',
  imports: [],
  total: 0,
};

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Get import chain by calling the `get_import_chain()` stored function.
 *
 * The stored function uses a recursive CTE to traverse `code_imports`
 * and returns a JSONB object with all direct and transitive imports.
 * Results are filtered by `max_depth` at the application level since
 * the stored function uses a fixed depth cap of 20.
 *
 * If the file is not indexed, the function returns zero imports gracefully.
 *
 * @param input - Validated input with file_path and max_depth
 * @returns MCP content response with import chain data
 */
export async function codeGetImportsHandler(
  input: CodeGetImportsInput,
): Promise<CallToolResult> {
  const { file_path, max_depth } = input;

  logger.info({ file_path, max_depth }, 'code.get_imports called');

  try {
    const startMs = Date.now();

    const result = await pool.query<{ result: ImportChainResult }>(
      'SELECT get_import_chain($1) AS result',
      [file_path],
    );

    const durationMs = Date.now() - startMs;

    const raw: ImportChainResult = result.rows[0]?.result ?? {
      ...EMPTY_RESULT,
      file_path,
    };

    // Filter imports by max_depth (stored function has a fixed cap of 20)
    const filteredImports = raw.imports.filter(
      (entry: ImportEntry) => entry.depth < max_depth,
    );

    const importChain: ImportChainResult = {
      file_path: raw.file_path,
      imports: filteredImports,
      total: filteredImports.length,
    };

    logger.debug(
      {
        event: 'code_get_imports_query',
        file_path,
        max_depth,
        durationMs,
        total: importChain.total,
      },
      'code.get_imports query executed',
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(importChain) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'code_get_imports_error',
        file_path,
        max_depth,
        error: errorMessage,
      },
      'code.get_imports query failed',
    );

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          file_path,
          imports: [],
          total: 0,
          error: errorMessage,
        }),
      }],
      isError: true,
    };
  }
}
