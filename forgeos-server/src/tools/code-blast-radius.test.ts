/**
 * Unit tests for the `code.blast_radius` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates file_path (required, non-empty string)
 * - Zod schema validates max_depth (optional, int 1–20, default 5)
 * - Calls blast_radius() stored function with correct params
 * - Returns blast radius result for indexed files
 * - Handles missing/unindexed files gracefully (empty results, not error)
 * - Handles DB errors gracefully
 *
 * @ticket TASK-INT-BE024
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { codeBlastRadiusSchema, codeBlastRadiusHandler } from './code-blast-radius.js';

// ── Mock pool ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract parsed JSON from the first MCP content block. */
function parseContent(result: { content: Array<{ type: string; [k: string]: unknown }> }): Record<string, unknown> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('codeBlastRadiusSchema', () => {
  it('should require file_path', () => {
    expect(() => codeBlastRadiusSchema.parse({})).toThrow();
  });

  it('should accept valid file_path with default max_depth', () => {
    const result = codeBlastRadiusSchema.parse({ file_path: 'src/tools/index.ts' });
    expect(result.file_path).toBe('src/tools/index.ts');
    expect(result.max_depth).toBe(5);
  });

  it('should accept custom max_depth', () => {
    const result = codeBlastRadiusSchema.parse({ file_path: 'src/app.ts', max_depth: 10 });
    expect(result.max_depth).toBe(10);
  });

  it('should reject empty file_path', () => {
    expect(() => codeBlastRadiusSchema.parse({ file_path: '' })).toThrow();
  });

  it('should reject non-string file_path', () => {
    expect(() => codeBlastRadiusSchema.parse({ file_path: 123 })).toThrow();
  });

  it('should reject max_depth below 1', () => {
    expect(() => codeBlastRadiusSchema.parse({ file_path: 'a.ts', max_depth: 0 })).toThrow();
  });

  it('should reject max_depth above 20', () => {
    expect(() => codeBlastRadiusSchema.parse({ file_path: 'a.ts', max_depth: 21 })).toThrow();
  });

  it('should reject non-integer max_depth', () => {
    expect(() => codeBlastRadiusSchema.parse({ file_path: 'a.ts', max_depth: 3.5 })).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('codeBlastRadiusHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should call blast_radius stored function with correct params', async () => {
    const blastResult = {
      file_path: 'src/tools/index.ts',
      max_depth: 5,
      affected_files: ['src/tools/index.ts', 'src/server.ts'],
      affected_symbols: [
        {
          name: 'registerTools',
          qualified_name: 'registerTools',
          kind: 'function',
          file_path: 'src/tools/index.ts',
          depth: 0,
        },
        {
          name: 'startServer',
          qualified_name: 'startServer',
          kind: 'function',
          file_path: 'src/server.ts',
          depth: 1,
        },
      ],
      total_affected: 2,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: blastResult }] });

    const result = await codeBlastRadiusHandler({ file_path: 'src/tools/index.ts', max_depth: 5 });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT blast_radius($1, $2) AS result',
      ['src/tools/index.ts', 5],
    );

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('src/tools/index.ts');
    expect(parsed.max_depth).toBe(5);
    expect(parsed.total_affected).toBe(2);
    expect(parsed.affected_files).toEqual(['src/tools/index.ts', 'src/server.ts']);
    expect(parsed.affected_symbols).toHaveLength(2);
  });

  it('should return blast radius with affected symbols and depth', async () => {
    const blastResult = {
      file_path: 'src/db/pool.ts',
      max_depth: 3,
      affected_files: ['src/db/pool.ts', 'src/tools/tickets-get.ts', 'src/tools/tickets-list.ts'],
      affected_symbols: [
        { name: 'pool', qualified_name: 'pool', kind: 'variable', file_path: 'src/db/pool.ts', depth: 0 },
        { name: 'ticketsGetHandler', qualified_name: 'ticketsGetHandler', kind: 'function', file_path: 'src/tools/tickets-get.ts', depth: 1 },
        { name: 'ticketsListHandler', qualified_name: 'ticketsListHandler', kind: 'function', file_path: 'src/tools/tickets-list.ts', depth: 1 },
      ],
      total_affected: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: blastResult }] });

    const result = await codeBlastRadiusHandler({ file_path: 'src/db/pool.ts', max_depth: 3 });
    const parsed = parseContent(result);

    expect(parsed.affected_files).toHaveLength(3);
    expect(parsed.affected_symbols).toHaveLength(3);
    const sym = (parsed.affected_symbols as Array<Record<string, unknown>>)[1];
    expect(sym.name).toBe('ticketsGetHandler');
    expect(sym.depth).toBe(1);
  });

  it('should handle missing/unindexed file gracefully with empty results', async () => {
    const emptyResult = {
      file_path: 'non/existent/file.ts',
      max_depth: 5,
      affected_files: [],
      affected_symbols: [],
      total_affected: 0,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: emptyResult }] });

    const result = await codeBlastRadiusHandler({ file_path: 'non/existent/file.ts', max_depth: 5 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
    expect(parsed.total_affected).toBe(0);
  });

  it('should use default max_depth when not provided', async () => {
    const blastResult = {
      file_path: 'src/app.ts',
      max_depth: 5,
      affected_files: ['src/app.ts'],
      affected_symbols: [],
      total_affected: 0,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: blastResult }] });

    await codeBlastRadiusHandler({ file_path: 'src/app.ts', max_depth: 5 });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT blast_radius($1, $2) AS result',
      ['src/app.ts', 5],
    );
  });

  it('should handle null result row gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await codeBlastRadiusHandler({ file_path: 'missing.ts', max_depth: 5 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('missing.ts');
    expect(parsed.max_depth).toBe(5);
    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
    expect(parsed.total_affected).toBe(0);
  });

  it('should handle null result value gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ result: null }] });

    const result = await codeBlastRadiusHandler({ file_path: 'null-result.ts', max_depth: 5 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('null-result.ts');
    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
    expect(parsed.total_affected).toBe(0);
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await codeBlastRadiusHandler({ file_path: 'src/app.ts', max_depth: 5 });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);

    expect(parsed.error).toBe('connection refused');
    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
    expect(parsed.total_affected).toBe(0);
  });

  it('should handle non-Error thrown objects', async () => {
    mockQuery.mockRejectedValueOnce('string error');

    const result = await codeBlastRadiusHandler({ file_path: 'src/app.ts', max_depth: 5 });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);

    expect(parsed.error).toBe('string error');
  });

  it('should accept custom max_depth in handler', async () => {
    const blastResult = {
      file_path: 'src/deep.ts',
      max_depth: 15,
      affected_files: ['src/deep.ts'],
      affected_symbols: [],
      total_affected: 0,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: blastResult }] });

    await codeBlastRadiusHandler({ file_path: 'src/deep.ts', max_depth: 15 });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT blast_radius($1, $2) AS result',
      ['src/deep.ts', 15],
    );
  });
});
