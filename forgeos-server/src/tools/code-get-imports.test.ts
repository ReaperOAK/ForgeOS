/**
 * Unit tests for the `code.get_imports` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates file_path (required, non-empty string)
 * - Zod schema validates max_depth (optional, int 1–50, default 10)
 * - Calls get_import_chain() stored function with correct params
 * - Returns import chain with depth info
 * - Distinguishes internal vs external imports
 * - Filters results by max_depth at application level
 * - Handles missing/unindexed files gracefully (empty results, not error)
 * - Handles DB errors gracefully
 *
 * @ticket TASK-INT-BE026
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { codeGetImportsSchema, codeGetImportsHandler } from './code-get-imports.js';

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
function parseContent(result: { content: Array<{ type: string;[k: string]: unknown }> }): Record<string, unknown> {
    const item = result.content[0] as { type: 'text'; text: string };
    return JSON.parse(item.text);
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('codeGetImportsSchema', () => {
    it('should require file_path', () => {
        expect(() => codeGetImportsSchema.parse({})).toThrow();
    });

    it('should accept valid file_path with default max_depth', () => {
        const result = codeGetImportsSchema.parse({ file_path: 'src/tools/index.ts' });
        expect(result.file_path).toBe('src/tools/index.ts');
    expect(result.max_depth).toBe(10);
  });

  it('should accept custom max_depth', () => {
    const result = codeGetImportsSchema.parse({ file_path: 'src/app.ts', max_depth: 25 });
    expect(result.max_depth).toBe(25);
  });

  it('should reject empty file_path', () => {
    expect(() => codeGetImportsSchema.parse({ file_path: '' })).toThrow();
  });

  it('should reject non-string file_path', () => {
    expect(() => codeGetImportsSchema.parse({ file_path: 123 })).toThrow();
  });

  it('should reject max_depth below 1', () => {
    expect(() => codeGetImportsSchema.parse({ file_path: 'a.ts', max_depth: 0 })).toThrow();
  });

  it('should reject max_depth above 50', () => {
    expect(() => codeGetImportsSchema.parse({ file_path: 'a.ts', max_depth: 51 })).toThrow();
  });

  it('should reject non-integer max_depth', () => {
    expect(() => codeGetImportsSchema.parse({ file_path: 'a.ts', max_depth: 3.5 })).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('codeGetImportsHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should call get_import_chain stored function with file_path only', async () => {
    const importResult = {
      file_path: 'src/tools/index.ts',
      imports: [
        { target_path: './tickets-get.js', resolved_path: 'src/tools/tickets-get.ts', language: 'typescript', depth: 0, is_external: false },
      ],
      total: 1,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: importResult }] });

    await codeGetImportsHandler({ file_path: 'src/tools/index.ts', max_depth: 10 });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT get_import_chain($1) AS result',
      ['src/tools/index.ts'],
    );
  });

  it('should return direct and transitive imports with depth info', async () => {
    const importResult = {
      file_path: 'src/server.ts',
      imports: [
        { target_path: './tools/index.js', resolved_path: 'src/tools/index.ts', language: 'typescript', depth: 0, is_external: false },
        { target_path: './db/pool.js', resolved_path: 'src/db/pool.ts', language: 'typescript', depth: 0, is_external: false },
        { target_path: './tickets-get.js', resolved_path: 'src/tools/tickets-get.ts', language: 'typescript', depth: 1, is_external: false },
      ],
      total: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: importResult }] });

    const result = await codeGetImportsHandler({ file_path: 'src/server.ts', max_depth: 10 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('src/server.ts');
    expect(parsed.total).toBe(3);
    expect(parsed.imports).toHaveLength(3);

    const imports = parsed.imports as Array<Record<string, unknown>>;
    expect(imports[0].depth).toBe(0);
    expect(imports[2].depth).toBe(1);
  });

  it('should distinguish internal vs external imports', async () => {
    const importResult = {
      file_path: 'src/app.ts',
      imports: [
        { target_path: './db/pool.js', resolved_path: 'src/db/pool.ts', language: 'typescript', depth: 0, is_external: false },
        { target_path: 'express', resolved_path: null, language: null, depth: 0, is_external: true },
        { target_path: 'zod', resolved_path: null, language: null, depth: 0, is_external: true },
      ],
      total: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: importResult }] });

    const result = await codeGetImportsHandler({ file_path: 'src/app.ts', max_depth: 10 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    const imports = parsed.imports as Array<Record<string, unknown>>;
    expect(imports).toHaveLength(3);

    // Internal import
    expect(imports[0].is_external).toBe(false);
    expect(imports[0].resolved_path).toBe('src/db/pool.ts');
    expect(imports[0].language).toBe('typescript');

    // External imports
    expect(imports[1].is_external).toBe(true);
    expect(imports[1].resolved_path).toBeNull();
    expect(imports[2].is_external).toBe(true);
  });

  it('should filter imports by max_depth', async () => {
    const importResult = {
      file_path: 'src/server.ts',
      imports: [
        { target_path: './tools/index.js', resolved_path: 'src/tools/index.ts', language: 'typescript', depth: 0, is_external: false },
        { target_path: './tickets-get.js', resolved_path: 'src/tools/tickets-get.ts', language: 'typescript', depth: 1, is_external: false },
        { target_path: '../db/pool.js', resolved_path: 'src/db/pool.ts', language: 'typescript', depth: 2, is_external: false },
        { target_path: 'pg', resolved_path: null, language: null, depth: 3, is_external: true },
      ],
      total: 4,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: importResult }] });

    // max_depth=2 should exclude depth >= 2
    const result = await codeGetImportsHandler({ file_path: 'src/server.ts', max_depth: 2 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    // Only depth 0 and 1 should be included
    expect(parsed.total).toBe(2);
    const imports = parsed.imports as Array<Record<string, unknown>>;
    expect(imports).toHaveLength(2);
    expect(imports[0].depth).toBe(0);
    expect(imports[1].depth).toBe(1);
  });

  it('should handle missing/unindexed file gracefully with empty results', async () => {
    const emptyResult = {
      file_path: 'non/existent/file.ts',
      imports: [],
      total: 0,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: emptyResult }] });

    const result = await codeGetImportsHandler({ file_path: 'non/existent/file.ts', max_depth: 10 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.imports).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it('should use default max_depth of 10 when not provided', () => {
    const parsed = codeGetImportsSchema.parse({ file_path: 'src/app.ts' });
    expect(parsed.max_depth).toBe(10);
  });

  it('should handle null result row gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await codeGetImportsHandler({ file_path: 'missing.ts', max_depth: 10 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('missing.ts');
    expect(parsed.imports).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it('should handle null result value gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ result: null }] });

    const result = await codeGetImportsHandler({ file_path: 'null-result.ts', max_depth: 10 });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('null-result.ts');
    expect(parsed.imports).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await codeGetImportsHandler({ file_path: 'src/app.ts', max_depth: 10 });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);

    expect(parsed.error).toBe('connection refused');
    expect(parsed.imports).toEqual([]);
    expect(parsed.total).toBe(0);
  });

  it('should handle non-Error thrown objects', async () => {
    mockQuery.mockRejectedValueOnce('string error');

    const result = await codeGetImportsHandler({ file_path: 'src/app.ts', max_depth: 10 });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);

    expect(parsed.error).toBe('string error');
  });

  it('should accept custom max_depth in handler', async () => {
    const importResult = {
      file_path: 'src/deep.ts',
      imports: [
        { target_path: './a.js', resolved_path: 'src/a.ts', language: 'typescript', depth: 0, is_external: false },
      ],
      total: 1,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: importResult }] });

    await codeGetImportsHandler({ file_path: 'src/deep.ts', max_depth: 40 });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT get_import_chain($1) AS result',
      ['src/deep.ts'],
    );
  });

  it('should include all imports when max_depth is large', async () => {
    const importResult = {
      file_path: 'src/entry.ts',
      imports: [
        { target_path: './a.js', resolved_path: 'src/a.ts', language: 'typescript', depth: 0, is_external: false },
        { target_path: './b.js', resolved_path: 'src/b.ts', language: 'typescript', depth: 5, is_external: false },
        { target_path: './c.js', resolved_path: 'src/c.ts', language: 'typescript', depth: 9, is_external: false },
      ],
      total: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: importResult }] });

    const result = await codeGetImportsHandler({ file_path: 'src/entry.ts', max_depth: 10 });

    const parsed = parseContent(result);
    expect(parsed.total).toBe(3);
    expect(parsed.imports).toHaveLength(3);
  });
});
