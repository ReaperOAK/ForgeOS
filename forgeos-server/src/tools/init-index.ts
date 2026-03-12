/**
 * init.index — Full codebase indexing MCP tool.
 *
 * Walks the project directory tree, identifies source files by extension,
 * parses each changed file with the appropriate tree-sitter parser
 * (TypeScript, Python, SQL), and stores results in the code graph tables
 * (code_files, code_symbols, code_imports, code_edges).
 *
 * @module tools/init-index
 * @ticket TASK-INT-BE042
 */

import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import { pool } from '../db/pool.js';
import { IndexerService } from '../services/indexer/indexer-service.js';
import { parseTypeScript } from '../services/parsers/typescript-parser.js';
import { parsePython } from '../services/parsers/python-parser.js';
import { parseSql } from '../services/parsers/sql-parser.js';
import { logger } from '../middleware/logging.js';
import type { FileEntry } from '../services/indexer/file-walker.js';
import type { PoolClient } from 'pg';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `init.index` MCP tool.
 *
 * - `root_path` (required) — Absolute path to the workspace root to index.
 * - `force` (optional) — When true, re-indexes all files regardless of hash.
 */
export const initIndexSchema = z.object({
  root_path: z.string().min(1).describe(
    'Absolute path to the workspace root directory to index',
  ),
  force: z.boolean().optional().default(false).describe(
    'Force re-index all files, ignoring content hash comparison',
  ),
});

/** Validated input type derived from the Zod schema. */
type InitIndexInput = z.infer<typeof initIndexSchema>;

// ── Response Types ───────────────────────────────────────────────────────────

/** Summary returned after indexing completes. */
interface InitIndexResult {
  total_files: number;
  indexed: number;
  skipped: number;
  symbols_found: number;
  imports_found: number;
  edges_computed: number;
}

// ── Normalisation Helpers ────────────────────────────────────────────────────

/**
 * Normalise a TypeScript parser symbol to DB-compatible snake_case shape.
 */
interface NormalisedSymbol {
  name: string;
  qualified_name: string;
  kind: string;
  start_line: number;
  end_line: number;
  signature: string | null;
  exported: boolean;
}

/**
 * Normalise a TypeScript parser import to DB-compatible shape.
 */
interface NormalisedImport {
  target_path: string;
  import_names: string[];
  is_default_import: boolean;
}

/**
 * Convert TypeScript parser output to normalised form.
 * TS parser uses camelCase; DB uses snake_case.
 */
function normaliseTsSymbols(
  symbols: Array<{
    name: string;
    qualifiedName: string;
    kind: string;
    startLine: number;
    endLine: number;
    signature: string;
    exported: boolean;
  }>,
): NormalisedSymbol[] {
  return symbols.map((s) => ({
    name: s.name,
    qualified_name: s.qualifiedName,
    kind: s.kind,
    start_line: s.startLine,
    end_line: s.endLine,
    signature: s.signature || null,
    exported: s.exported,
  }));
}

function normaliseTsImports(
  imports: Array<{
    targetPath: string;
    importNames: string[];
    isDefaultImport: boolean;
  }>,
): NormalisedImport[] {
  return imports.map((i) => ({
    target_path: i.targetPath,
    import_names: i.importNames,
    is_default_import: i.isDefaultImport,
  }));
}

/**
 * Convert Python/SQL parser output to normalised import form.
 * Python parser uses a different import shape.
 */
function normalisePyImports(
  imports: Array<{
    source_path: string;
    imported_name: string | null;
    alias: string | null;
    is_default: boolean;
  }>,
): NormalisedImport[] {
  return imports.map((i) => ({
    target_path: i.source_path,
    import_names: i.imported_name ? [i.imported_name] : [],
    is_default_import: i.is_default,
  }));
}

/**
 * Flatten Python/SQL parser symbols (which have children) to a flat list.
 */
function flattenPySymbols(
  symbols: Array<{
    name: string;
    qualified_name: string;
    kind: string;
    start_line: number;
    end_line: number;
    signature: string | null;
    exported: boolean;
    children: Array<{
      name: string;
      qualified_name: string;
      kind: string;
      start_line: number;
      end_line: number;
      signature: string | null;
      exported: boolean;
      children: unknown[];
    }>;
  }>,
): NormalisedSymbol[] {
  const result: NormalisedSymbol[] = [];
  for (const s of symbols) {
    result.push({
      name: s.name,
      qualified_name: s.qualified_name,
      kind: s.kind,
      start_line: s.start_line,
      end_line: s.end_line,
      signature: s.signature,
      exported: s.exported,
    });
    if (s.children) {
      for (const child of s.children) {
        result.push({
          name: child.name,
          qualified_name: child.qualified_name,
          kind: child.kind,
          start_line: child.start_line,
          end_line: child.end_line,
          signature: child.signature,
          exported: child.exported,
        });
      }
    }
  }
  return result;
}

// ── File Parsing ─────────────────────────────────────────────────────────────

/**
 * Parse a single file using the appropriate tree-sitter parser and return
 * normalised symbols and imports.
 */
async function parseFile(
  rootPath: string,
  file: FileEntry,
): Promise<{ symbols: NormalisedSymbol[]; imports: NormalisedImport[] } | null> {
  const absolutePath = `${rootPath}/${file.path}`;
  const content = await readFile(absolutePath, 'utf-8');

  switch (file.language) {
    case 'typescript':
    case 'javascript': {
      const result = await parseTypeScript(content, file.path);
      return {
        symbols: normaliseTsSymbols(result.symbols),
        imports: normaliseTsImports(result.imports),
      };
    }
    case 'python': {
      const result = await parsePython(content);
      return {
        symbols: flattenPySymbols(result.symbols),
        imports: normalisePyImports(result.imports),
      };
    }
    case 'sql': {
      const result = await parseSql(content);
      return {
        symbols: flattenPySymbols(result.symbols),
        imports: [], // SQL files have no import relationships
      };
    }
    default:
      return null;
  }
}

// ── Edge Computation ─────────────────────────────────────────────────────────

/**
 * Compute symbol-to-symbol edges via import linkage.
 *
 * For each import in the source file, resolves the target file and matches
 * imported names to exported symbols. Creates an 'imports' edge from each
 * symbol in the source file to each matched exported symbol in the target.
 */
async function computeEdges(client: PoolClient): Promise<number> {
  // Find all imports that have a resolved target_file_id
  const importsResult = await client.query<{
    id: string;
    source_file_id: string;
    target_file_id: string;
    import_names: string[];
    is_default_import: boolean;
  }>(
    `SELECT id, source_file_id, target_file_id, import_names, is_default_import
     FROM code_imports
     WHERE target_file_id IS NOT NULL`,
  );

  let edgeCount = 0;

  for (const imp of importsResult.rows) {
    // Get all symbols in the source file
    const sourceSymbols = await client.query<{ id: string }>(
      'SELECT id FROM code_symbols WHERE file_id = $1',
      [imp.source_file_id],
    );

    // Get exported symbols in the target file matching import names
    let targetSymbols: Array<{ id: string }>;
    if (imp.import_names.length > 0) {
      const result = await client.query<{ id: string }>(
        `SELECT id FROM code_symbols
         WHERE file_id = $1 AND exported = TRUE AND name = ANY($2)`,
        [imp.target_file_id, imp.import_names],
      );
      targetSymbols = result.rows;
    } else if (imp.is_default_import) {
      // Default import: link to all exported symbols in target
      const result = await client.query<{ id: string }>(
        'SELECT id FROM code_symbols WHERE file_id = $1 AND exported = TRUE',
        [imp.target_file_id],
      );
      targetSymbols = result.rows;
    } else {
      continue;
    }

    // Create edges: first source symbol → each matched target symbol
    if (sourceSymbols.rows.length > 0 && targetSymbols.length > 0) {
      const sourceId = sourceSymbols.rows[0]!.id;
      for (const target of targetSymbols) {
        await client.query(
          `INSERT INTO code_edges (source_symbol_id, target_symbol_id, edge_type)
           VALUES ($1, $2, $3)
           ON CONFLICT (source_symbol_id, target_symbol_id, edge_type) DO NOTHING`,
          [sourceId, target.id, 'imports'],
        );
        edgeCount++;
      }
    }
  }

  return edgeCount;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Index the codebase: walk files, parse with tree-sitter, populate code graph.
 *
 * Steps:
 * 1. Walk directory and identify changed files via IndexerService
 * 2. Clear stale symbols/imports for changed files
 * 3. Parse each file with the appropriate parser
 * 4. Insert symbols into code_symbols
 * 5. Insert imports into code_imports with target_file_id resolution
 * 6. Compute and insert edges into code_edges
 *
 * @param input - Validated input with root_path and force flag
 * @returns MCP content response with indexing summary
 */
export async function initIndexHandler(
  input: InitIndexInput,
): Promise<CallToolResult> {
  const { root_path, force } = input;

  logger.info({ root_path, force }, 'init.index called');

  try {
    const startMs = Date.now();
    const indexer = new IndexerService(pool);

    // Step 1: Walk and identify changed files
    const indexResult = await indexer.indexWorkspace(root_path);

    // When force=true, treat ALL files as changed
    const filesToProcess = force
      ? await (async () => {
          const allResult = await pool.query<{ file_path: string; language: string }>(
            'SELECT file_path, language FROM code_files',
          );
          return allResult.rows.map((r) => ({
            path: r.file_path,
            language: r.language,
            hash: '',
            lineCount: 0,
          })) as FileEntry[];
        })()
      : indexResult.changedFiles;

    let symbolsCount = 0;
    let importsCount = 0;
    let edgesComputed = 0;

    if (filesToProcess.length > 0) {
      const client: PoolClient = await pool.connect();
      try {
        await client.query('BEGIN');

        // Step 2–5: Parse each changed file and insert symbols + imports
        for (const file of filesToProcess) {
          // Look up the file_id from code_files
          const fileRow = await client.query<{ id: string }>(
            'SELECT id FROM code_files WHERE file_path = $1',
            [file.path],
          );

          if (fileRow.rows.length === 0) {
            logger.warn({ file: file.path }, 'init.index: file not in code_files, skipping');
            continue;
          }

          const fileId = fileRow.rows[0]!.id;

          // Clear stale data for this file
          await client.query(
            'DELETE FROM code_symbols WHERE file_id = $1',
            [fileId],
          );
          await client.query(
            'DELETE FROM code_imports WHERE source_file_id = $1',
            [fileId],
          );

          // Parse the file
          let parseResult: { symbols: NormalisedSymbol[]; imports: NormalisedImport[] } | null;
          try {
            parseResult = await parseFile(root_path, file);
          } catch (parseErr: unknown) {
            const msg = parseErr instanceof Error ? parseErr.message : String(parseErr);
            logger.warn({ file: file.path, error: msg }, 'init.index: parse failed, skipping');
            continue;
          }

          if (!parseResult) {
            continue;
          }

          // Insert symbols
          for (const sym of parseResult.symbols) {
            await client.query(
              `INSERT INTO code_symbols
                 (file_id, name, qualified_name, kind, start_line, end_line, signature, exported)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
              [
                fileId,
                sym.name,
                sym.qualified_name,
                sym.kind,
                sym.start_line,
                sym.end_line,
                sym.signature,
                sym.exported,
              ],
            );
            symbolsCount++;
          }

          // Insert imports with target_file_id resolution
          for (const imp of parseResult.imports) {
            // Attempt to resolve target_file_id
            const targetRow = await client.query<{ id: string }>(
              'SELECT id FROM code_files WHERE file_path = $1',
              [imp.target_path],
            );
            const targetFileId = targetRow.rows[0]?.id ?? null;

            await client.query(
              `INSERT INTO code_imports
                 (source_file_id, target_path, target_file_id, import_names, is_default_import)
               VALUES ($1, $2, $3, $4, $5)`,
              [
                fileId,
                imp.target_path,
                targetFileId,
                imp.import_names,
                imp.is_default_import,
              ],
            );
            importsCount++;
          }
        }

        // Step 6: Compute edges
        edgesComputed = await computeEdges(client);

        await client.query('COMMIT');
      } catch (err: unknown) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }

    const durationMs = Date.now() - startMs;

    const result: InitIndexResult = {
      total_files: indexResult.total,
      indexed: filesToProcess.length,
      skipped: indexResult.unchanged,
      symbols_found: symbolsCount,
      imports_found: importsCount,
      edges_computed: edgesComputed,
    };

    logger.info(
      {
        event: 'init_index_complete',
        ...result,
        durationMs,
      },
      'init.index complete',
    );

    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
    };
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error(
      {
        event: 'init_index_error',
        root_path,
        error: errorMessage,
      },
      'init.index failed',
    );

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            error: 'INDEXING_FAILED',
            message: errorMessage,
            timestamp: new Date().toISOString(),
          }),
        },
      ],
      isError: true,
    };
  }
}
