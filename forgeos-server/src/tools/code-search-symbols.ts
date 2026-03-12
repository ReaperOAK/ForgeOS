/**
 * code.search_symbols — Search for code symbols by name pattern.
 *
 * Finds functions, classes, methods, interfaces, types, and variables
 * matching an ILIKE name pattern. Optionally filtered by kind and file path.
 * Delegates to the `search_symbols()` PostgreSQL stored function created
 * in migration 003-code-graph.sql.
 *
 * @module tools/code-search-symbols
 * @ticket TASK-INT-BE025
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `code.search_symbols` MCP tool.
 *
 * - `name_pattern` (required) — ILIKE pattern for symbol name (e.g., '%Handler%').
 * - `kind` (optional) — Exact symbol kind filter.
 * - `file_path` (optional) — Exact file path filter.
 */
export const codeSearchSymbolsSchema = z.object({
    name_pattern: z.string().min(1).describe(
        'ILIKE pattern for symbol name (e.g., "%Handler%")',
    ),
    kind: z.enum(['function', 'class', 'method', 'interface', 'type', 'variable']).optional().describe(
        'Optional symbol kind filter',
    ),
    file_path: z.string().optional().describe(
        'Optional exact file path filter',
    ),
});

/** Validated input type derived from the Zod schema. */
type CodeSearchSymbolsInput = z.infer<typeof codeSearchSymbolsSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Symbol entry returned by the stored function. */
interface SymbolMatch {
    id: string;
    name: string;
    qualified_name: string;
    kind: string;
    file_path: string;
    start_line: number;
    end_line: number;
    signature: string | null;
    exported: boolean;
}

/** Successful result payload from search_symbols(). */
interface SearchSymbolsResult {
  pattern: string;
  kind: string | null;
  file_path: string | null;
  symbols: SymbolMatch[];
  total: number;
}

/** Error result payload. */
interface SearchSymbolsError {
  symbols: [];
  total: 0;
  message: string;
  error: string;
  timestamp: string;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Search for code symbols by name pattern, optionally filtered by kind and file path.
 *
 * Calls the `search_symbols()` PostgreSQL stored function which returns a JSONB
 * object containing the matched symbols array and total count.
 *
 * @param input - Validated input with name_pattern, optional kind and file_path
 * @returns MCP content response with search results or error
 */
export async function codeSearchSymbolsHandler(
  input: CodeSearchSymbolsInput,
): Promise<CallToolResult> {
  const { name_pattern, kind, file_path } = input;

  logger.info({ name_pattern, kind, file_path }, 'code.search_symbols called');

  try {
    const startMs = Date.now();

    const queryResult = await pool.query<{ result: SearchSymbolsResult }>(
      'SELECT search_symbols($1, $2, $3) AS result',
      [name_pattern, kind ?? null, file_path ?? null],
    );

    const result = queryResult.rows[0]?.result ?? {
      pattern: name_pattern,
      kind: kind ?? null,
      file_path: file_path ?? null,
      symbols: [],
      total: 0,
    };

    const durationMs = Date.now() - startMs;

    logger.debug(
      {
        event: 'code_search_symbols_query',
        name_pattern,
        kind,
        file_path,
        total: result.total,
        durationMs,
      },
      'code.search_symbols query executed',
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'code_search_symbols_error',
        name_pattern,
        kind,
        file_path,
        error: errorMessage,
      },
      'code.search_symbols query failed',
    );

    const errorResult: SearchSymbolsError = {
      symbols: [],
      total: 0,
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
