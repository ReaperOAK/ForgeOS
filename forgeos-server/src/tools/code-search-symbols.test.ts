/**
 * Unit tests for the `code.search_symbols` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates name_pattern (required, non-empty string)
 * - Optional kind enum validation
 * - Optional file_path validation
 * - Calls search_symbols() stored function with correct parameters
 * - Returns JSONB result with symbols array and total
 * - Handles empty results gracefully
 * - Handles DB errors gracefully
 *
 * @ticket TASK-INT-BE025
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { codeSearchSymbolsSchema, codeSearchSymbolsHandler } from './code-search-symbols.js';

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseContent(result: { content: Array<{ type: string; [k: string]: unknown }> }): Record<string, any> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

function makeSymbol(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sym-uuid-001',
    name: 'ticketsGetHandler',
    qualified_name: 'tools/tickets-get.ticketsGetHandler',
    kind: 'function',
    file_path: 'src/tools/tickets-get.ts',
    start_line: 70,
    end_line: 130,
    signature: 'async function ticketsGetHandler(input: TicketsGetInput): Promise<CallToolResult>',
    exported: true,
    ...overrides,
  };
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('codeSearchSymbolsSchema', () => {
  it('should require name_pattern', () => {
    expect(() => codeSearchSymbolsSchema.parse({})).toThrow();
  });

  it('should accept valid name_pattern only', () => {
    const result = codeSearchSymbolsSchema.parse({ name_pattern: '%Handler%' });
    expect(result.name_pattern).toBe('%Handler%');
    expect(result.kind).toBeUndefined();
    expect(result.file_path).toBeUndefined();
  });

  it('should reject empty name_pattern', () => {
    expect(() => codeSearchSymbolsSchema.parse({ name_pattern: '' })).toThrow();
  });

  it('should reject non-string name_pattern', () => {
    expect(() => codeSearchSymbolsSchema.parse({ name_pattern: 123 })).toThrow();
  });

  it('should accept valid kind enum values', () => {
    const kinds = ['function', 'class', 'method', 'interface', 'type', 'variable'] as const;
    for (const kind of kinds) {
      const result = codeSearchSymbolsSchema.parse({ name_pattern: '%test%', kind });
      expect(result.kind).toBe(kind);
    }
  });

  it('should reject invalid kind value', () => {
    expect(() => codeSearchSymbolsSchema.parse({ name_pattern: '%test%', kind: 'module' })).toThrow();
  });

  it('should accept optional file_path', () => {
    const result = codeSearchSymbolsSchema.parse({
      name_pattern: '%Handler%',
      file_path: 'src/tools/tickets-get.ts',
    });
    expect(result.file_path).toBe('src/tools/tickets-get.ts');
  });

  it('should accept all parameters together', () => {
    const result = codeSearchSymbolsSchema.parse({
      name_pattern: '%Handler%',
      kind: 'function',
      file_path: 'src/tools/tickets-get.ts',
    });
    expect(result.name_pattern).toBe('%Handler%');
    expect(result.kind).toBe('function');
    expect(result.file_path).toBe('src/tools/tickets-get.ts');
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('codeSearchSymbolsHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return matching symbols from search_symbols()', async () => {
    const sym1 = makeSymbol();
    const sym2 = makeSymbol({
      id: 'sym-uuid-002',
      name: 'ticketsListHandler',
      qualified_name: 'tools/tickets-list.ticketsListHandler',
      file_path: 'src/tools/tickets-list.ts',
    });

    mockQuery.mockResolvedValueOnce({
      rows: [{
        result: {
          pattern: '%Handler%',
          kind: null,
          file_path: null,
          symbols: [sym1, sym2],
          total: 2,
        },
      }],
    });

    const result = await codeSearchSymbolsHandler({ name_pattern: '%Handler%' });
    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.pattern).toBe('%Handler%');
    expect(data.symbols).toHaveLength(2);
    expect(data.total).toBe(2);
    expect(data.symbols[0].name).toBe('ticketsGetHandler');
    expect(data.symbols[1].name).toBe('ticketsListHandler');
  });

  it('should pass kind filter to stored function', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        result: {
          pattern: '%Handler%',
          kind: 'function',
          file_path: null,
          symbols: [makeSymbol()],
          total: 1,
        },
      }],
    });

    await codeSearchSymbolsHandler({ name_pattern: '%Handler%', kind: 'function' });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT search_symbols($1, $2, $3) AS result',
      ['%Handler%', 'function', null],
    );
  });

  it('should pass file_path filter to stored function', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        result: {
          pattern: '%Handler%',
          kind: null,
          file_path: 'src/tools/tickets-get.ts',
          symbols: [makeSymbol()],
          total: 1,
        },
      }],
    });

    await codeSearchSymbolsHandler({
      name_pattern: '%Handler%',
      file_path: 'src/tools/tickets-get.ts',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT search_symbols($1, $2, $3) AS result',
      ['%Handler%', null, 'src/tools/tickets-get.ts'],
    );
  });

  it('should pass all filters to stored function', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        result: {
          pattern: '%Handler%',
          kind: 'function',
          file_path: 'src/tools/tickets-get.ts',
          symbols: [makeSymbol()],
          total: 1,
        },
      }],
    });

    await codeSearchSymbolsHandler({
      name_pattern: '%Handler%',
      kind: 'function',
      file_path: 'src/tools/tickets-get.ts',
    });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT search_symbols($1, $2, $3) AS result',
      ['%Handler%', 'function', 'src/tools/tickets-get.ts'],
    );
  });

  it('should return empty results when no symbols match', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [{
        result: {
          pattern: '%nonexistent%',
          kind: null,
          file_path: null,
          symbols: [],
          total: 0,
        },
      }],
    });

    const result = await codeSearchSymbolsHandler({ name_pattern: '%nonexistent%' });
    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.symbols).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  it('should fallback when result row is missing', async () => {
    mockQuery.mockResolvedValueOnce({
      rows: [],
    });

    const result = await codeSearchSymbolsHandler({ name_pattern: '%missing%' });
    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.symbols).toHaveLength(0);
    expect(data.total).toBe(0);
    expect(data.pattern).toBe('%missing%');
  });

  it('should return isError on database failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await codeSearchSymbolsHandler({ name_pattern: '%test%' });
    const data = parseContent(result);

    expect(result.isError).toBe(true);
    expect(data.error).toBe('INTERNAL_ERROR');
    expect(data.message).toContain('connection refused');
    expect(data.symbols).toHaveLength(0);
    expect(data.total).toBe(0);
  });

  it('should handle non-Error thrown objects', async () => {
    mockQuery.mockRejectedValueOnce('string error');

    const result = await codeSearchSymbolsHandler({ name_pattern: '%test%' });
    const data = parseContent(result);

    expect(result.isError).toBe(true);
    expect(data.message).toContain('string error');
  });

  it('should return symbol details with correct shape', async () => {
    const sym = makeSymbol();
    mockQuery.mockResolvedValueOnce({
      rows: [{
        result: {
          pattern: '%Handler%',
          kind: null,
          file_path: null,
          symbols: [sym],
          total: 1,
        },
      }],
    });

    const result = await codeSearchSymbolsHandler({ name_pattern: '%Handler%' });
    const data = parseContent(result);

    const symbol = data.symbols[0];
    expect(symbol.id).toBe('sym-uuid-001');
    expect(symbol.name).toBe('ticketsGetHandler');
    expect(symbol.qualified_name).toBe('tools/tickets-get.ticketsGetHandler');
    expect(symbol.kind).toBe('function');
    expect(symbol.file_path).toBe('src/tools/tickets-get.ts');
    expect(symbol.start_line).toBe(70);
    expect(symbol.end_line).toBe(130);
    expect(symbol.signature).toContain('ticketsGetHandler');
    expect(symbol.exported).toBe(true);
  });
});
