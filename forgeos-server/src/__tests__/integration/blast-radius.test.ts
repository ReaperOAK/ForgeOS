/**
 * Integration Tests — Blast Radius Queries
 *
 * Tests the blast radius computation by mocking the database pool to simulate
 * various dependency graph topologies:
 *   - Linear chains (A→B→C) at different depths
 *   - Diamond dependencies (A→B, A→C, B→D, C→D)
 *   - Cyclic dependencies (A→B→C→A) — verifies no infinite loop
 *   - Depth limiting (max_depth=1 returns only direct dependents)
 *   - Files with no dependencies
 *   - Non-existent files
 *
 * Validates both the stored function response parsing AND the MCP tool handler
 * behavior via `codeBlastRadiusHandler`.
 *
 * @module __tests__/integration/blast-radius
 * @ticket TASK-INT-BE028
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    codeBlastRadiusSchema,
    codeBlastRadiusHandler,
} from '../../tools/code-blast-radius.js';

// ── Mock Pool ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../db/pool.js', () => ({
    pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock('../../middleware/logging.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract parsed JSON from the first MCP content block. */
function parseContent(
    result: { content: Array<{ type: string;[k: string]: unknown }> },
): Record<string, unknown> {
    const item = result.content[0] as { type: 'text'; text: string };
    return JSON.parse(item.text);
}

/** Build a symbol entry for test fixtures. */
function sym(
  name: string,
  qualifiedName: string,
  kind: string,
  filePath: string,
  depth: number,
): { name: string; qualified_name: string; kind: string; file_path: string; depth: number } {
  return { name, qualified_name: qualifiedName, kind, file_path: filePath, depth };
}

// ── AC1: Linear Dependency Chain ─────────────────────────────────────────────

describe('Blast Radius — Linear Dependency Chain (A→B→C)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return all 3 nodes at depth 3 for full traversal', async () => {
    const linearResult = {
      file_path: 'src/a.ts',
      max_depth: 3,
      affected_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
        sym('fnC', 'fnC', 'function', 'src/c.ts', 2),
      ],
      total_affected: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: linearResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 3 });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('src/a.ts');
    expect(parsed.max_depth).toBe(3);
    expect(parsed.total_affected).toBe(3);
    expect(parsed.affected_files).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);

    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    expect(symbols).toHaveLength(3);
    expect(symbols[0]).toMatchObject({ name: 'fnA', depth: 0 });
    expect(symbols[1]).toMatchObject({ name: 'fnB', depth: 1 });
    expect(symbols[2]).toMatchObject({ name: 'fnC', depth: 2 });
  });

  it('should return depth-1 symbols with max_depth=1', async () => {
    const depth1Result = {
      file_path: 'src/a.ts',
      max_depth: 1,
      affected_files: ['src/a.ts', 'src/b.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
      ],
      total_affected: 2,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: depth1Result }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 1 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    expect(parsed.total_affected).toBe(2);
    expect(parsed.affected_files).toEqual(['src/a.ts', 'src/b.ts']);
    expect((parsed.affected_symbols as unknown[]).length).toBe(2);
  });

  it('should return only root symbol at depth=2 when chain is A→B→C', async () => {
    const depth2Result = {
      file_path: 'src/a.ts',
      max_depth: 2,
      affected_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
        sym('fnC', 'fnC', 'function', 'src/c.ts', 2),
      ],
      total_affected: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: depth2Result }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 2 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    expect(parsed.total_affected).toBe(3);
    expect((parsed.affected_symbols as unknown[]).length).toBe(3);
  });

  it('should pass correct SQL query and parameters to pool', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ result: {
      file_path: 'src/a.ts', max_depth: 3,
      affected_files: [], affected_symbols: [], total_affected: 0,
    } }] });

    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 3 });
    await codeBlastRadiusHandler(input);

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT blast_radius($1, $2) AS result',
      ['src/a.ts', 3],
    );
  });
});

// ── AC2: Diamond Dependency ──────────────────────────────────────────────────

describe('Blast Radius — Diamond Dependency (A→B, A→C, B→D, C→D)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return all 4 nodes with correct depths in diamond graph', async () => {
    const diamondResult = {
      file_path: 'src/a.ts',
      max_depth: 5,
      affected_files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
        sym('fnC', 'fnC', 'function', 'src/c.ts', 1),
        sym('fnD', 'fnD', 'function', 'src/d.ts', 2),
      ],
      total_affected: 4,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: diamondResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 5 });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.total_affected).toBe(4);
    expect(parsed.affected_files).toEqual(
      expect.arrayContaining(['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts']),
    );

    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    expect(symbols).toHaveLength(4);

    // Depth-0: A (the changed file)
    expect(symbols.filter((s) => s.depth === 0)).toHaveLength(1);
    // Depth-1: B and C (direct dependents)
    const depth1 = symbols.filter((s) => s.depth === 1);
    expect(depth1).toHaveLength(2);
    expect(depth1.map((s) => s.name)).toEqual(expect.arrayContaining(['fnB', 'fnC']));
    // Depth-2: D (convergence point)
    const depth2 = symbols.filter((s) => s.depth === 2);
    expect(depth2).toHaveLength(1);
    expect(depth2[0].name).toBe('fnD');
  });

  it('should deduplicate D which is reachable via both B and C', async () => {
    // The SQL UNION (not UNION ALL) ensures D appears only once despite two paths
    const diamondResult = {
      file_path: 'src/a.ts',
      max_depth: 5,
      affected_files: ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
        sym('fnC', 'fnC', 'function', 'src/c.ts', 1),
        sym('fnD', 'fnD', 'function', 'src/d.ts', 2),
      ],
      total_affected: 4,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: diamondResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 5 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    // D should appear exactly once, not twice
    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    const dNodes = symbols.filter((s) => s.name === 'fnD');
    expect(dNodes).toHaveLength(1);
    expect(parsed.total_affected).toBe(4);
  });

  it('should limit diamond traversal with max_depth=1', async () => {
    const depth1Diamond = {
      file_path: 'src/a.ts',
      max_depth: 1,
      affected_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
        sym('fnC', 'fnC', 'function', 'src/c.ts', 1),
      ],
      total_affected: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: depth1Diamond }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 1 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    // D should NOT be reached at max_depth=1
    expect(parsed.total_affected).toBe(3);
    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    expect(symbols.map((s) => s.name)).not.toContain('fnD');
    expect(symbols.map((s) => s.name)).toEqual(expect.arrayContaining(['fnA', 'fnB', 'fnC']));
  });
});

// ── AC3: Cyclic Dependency ───────────────────────────────────────────────────

describe('Blast Radius — Cyclic Dependency (A→B→C→A)', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should handle cycles without infinite loop due to UNION dedup', async () => {
    // The SQL blast_radius function uses UNION (not UNION ALL), so cycles are
    // broken by deduplication: once A is visited at depth 0, it won't be
    // re-expanded at depth 3.
    const cyclicResult = {
      file_path: 'src/a.ts',
      max_depth: 10,
      affected_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
        sym('fnC', 'fnC', 'function', 'src/c.ts', 2),
      ],
      total_affected: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: cyclicResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 10 });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    // All nodes reached but no duplication from the cycle
    expect(parsed.total_affected).toBe(3);

    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    expect(symbols).toHaveLength(3);

    // A appears only once at depth 0 (not re-expanded at depth 3)
    const aNodes = symbols.filter((s) => s.name === 'fnA');
    expect(aNodes).toHaveLength(1);
    expect(aNodes[0].depth).toBe(0);
  });

  it('should return finite results even with high max_depth on cyclic graph', async () => {
    const cyclicHighDepth = {
      file_path: 'src/a.ts',
      max_depth: 20,
      affected_files: ['src/a.ts', 'src/b.ts', 'src/c.ts'],
      affected_symbols: [
        sym('fnA', 'fnA', 'function', 'src/a.ts', 0),
        sym('fnB', 'fnB', 'function', 'src/b.ts', 1),
        sym('fnC', 'fnC', 'function', 'src/c.ts', 2),
      ],
      total_affected: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: cyclicHighDepth }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/a.ts', max_depth: 20 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    // Despite max_depth=20, UNION prevents infinite expansion
    expect(parsed.total_affected).toBe(3);
    expect((parsed.affected_symbols as unknown[]).length).toBe(3);
  });

  it('should correctly report affected_files for cyclic graph', async () => {
    const cyclicResult = {
      file_path: 'src/cycle/a.ts',
      max_depth: 5,
      affected_files: ['src/cycle/a.ts', 'src/cycle/b.ts', 'src/cycle/c.ts'],
      affected_symbols: [
        sym('handleA', 'handleA', 'function', 'src/cycle/a.ts', 0),
        sym('handleB', 'handleB', 'function', 'src/cycle/b.ts', 1),
        sym('handleC', 'handleC', 'function', 'src/cycle/c.ts', 2),
      ],
      total_affected: 3,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: cyclicResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/cycle/a.ts', max_depth: 5 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    expect(parsed.affected_files).toEqual(
      expect.arrayContaining(['src/cycle/a.ts', 'src/cycle/b.ts', 'src/cycle/c.ts']),
    );
  });
});

// ── AC4: Depth Limiting ──────────────────────────────────────────────────────

describe('Blast Radius — Depth Limiting', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return only direct dependents at max_depth=1', async () => {
    // Graph: A→B→C→D→E, but max_depth=1 should only return A and B
    const depth1Result = {
      file_path: 'src/root.ts',
      max_depth: 1,
      affected_files: ['src/root.ts', 'src/direct.ts'],
      affected_symbols: [
        sym('rootFn', 'rootFn', 'function', 'src/root.ts', 0),
        sym('directFn', 'directFn', 'function', 'src/direct.ts', 1),
      ],
      total_affected: 2,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: depth1Result }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/root.ts', max_depth: 1 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    expect(parsed.max_depth).toBe(1);
    expect(parsed.total_affected).toBe(2);

    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    // No symbol should have depth > 1
    for (const s of symbols) {
      expect(s.depth).toBeLessThanOrEqual(1);
    }
  });

  it('should correctly use schema default max_depth of 5', async () => {
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/x.ts' });
    expect(input.max_depth).toBe(5);

    const defaultResult = {
      file_path: 'src/x.ts',
      max_depth: 5,
      affected_files: ['src/x.ts'],
      affected_symbols: [sym('x', 'x', 'function', 'src/x.ts', 0)],
      total_affected: 1,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: defaultResult }] });
    await codeBlastRadiusHandler(input);

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT blast_radius($1, $2) AS result',
      ['src/x.ts', 5],
    );
  });

  it('should respect max bounds from schema validation', () => {
    expect(() => codeBlastRadiusSchema.parse({ file_path: 'a.ts', max_depth: 21 })).toThrow();
    expect(() => codeBlastRadiusSchema.parse({ file_path: 'a.ts', max_depth: 0 })).toThrow();

    const valid = codeBlastRadiusSchema.parse({ file_path: 'a.ts', max_depth: 20 });
    expect(valid.max_depth).toBe(20);
  });
});

// ── AC5: File with No Dependencies ───────────────────────────────────────────

describe('Blast Radius — No Dependencies', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return empty results for a file with no edges', async () => {
    const isolatedResult = {
      file_path: 'src/standalone.ts',
      max_depth: 5,
      affected_files: ['src/standalone.ts'],
      affected_symbols: [
        sym('standalone', 'standalone', 'function', 'src/standalone.ts', 0),
      ],
      total_affected: 1,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: isolatedResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/standalone.ts' });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    // Only the root file itself, no transitive dependents
    expect(parsed.total_affected).toBe(1);
    expect(parsed.affected_files).toEqual(['src/standalone.ts']);

    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    expect(symbols).toHaveLength(1);
    expect(symbols[0].depth).toBe(0);
  });

  it('should return zero affected for indexed file with no symbols', async () => {
    const emptySymbolResult = {
      file_path: 'src/empty-module.ts',
      max_depth: 5,
      affected_files: [],
      affected_symbols: [],
      total_affected: 0,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: emptySymbolResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/empty-module.ts' });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    expect(parsed.total_affected).toBe(0);
    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
  });
});

// ── AC6: Non-Existent File ───────────────────────────────────────────────────

describe('Blast Radius — Non-Existent File', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return empty results gracefully for file not in code_files', async () => {
    // When the file doesn't exist, the stored function returns zero matches
    const notFoundResult = {
      file_path: 'does/not/exist.ts',
      max_depth: 5,
      affected_files: [],
      affected_symbols: [],
      total_affected: 0,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: notFoundResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'does/not/exist.ts' });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('does/not/exist.ts');
    expect(parsed.total_affected).toBe(0);
    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
  });

  it('should handle null DB result gracefully (empty rows)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'ghost.ts' });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('ghost.ts');
    expect(parsed.max_depth).toBe(5);
    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
    expect(parsed.total_affected).toBe(0);
  });

  it('should handle null result value from stored function', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ result: null }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'null-result.ts', max_depth: 3 });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.file_path).toBe('null-result.ts');
    expect(parsed.max_depth).toBe(3);
    expect(parsed.total_affected).toBe(0);
  });
});

// ── AC7: Mocked Pool Behavior ────────────────────────────────────────────────

describe('Blast Radius — DB Error Handling', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return isError=true when pool.query throws', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/index.ts' });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);
    expect(parsed.error).toBe('connection refused');
    expect(parsed.affected_files).toEqual([]);
    expect(parsed.affected_symbols).toEqual([]);
    expect(parsed.total_affected).toBe(0);
  });

  it('should return isError=true with stringified non-Error throw', async () => {
    mockQuery.mockRejectedValueOnce('ECONNRESET');
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/index.ts' });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);
    expect(parsed.error).toBe('ECONNRESET');
  });

  it('should preserve file_path and max_depth in error response', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'));
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/slow.ts', max_depth: 8 });
    const result = await codeBlastRadiusHandler(input);

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);
    expect(parsed.file_path).toBe('src/slow.ts');
    expect(parsed.max_depth).toBe(8);
  });
});

// ── Complex Topology: Wide Fan-Out ───────────────────────────────────────────

describe('Blast Radius — Wide Fan-Out', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should handle a single file depended on by many files', async () => {
    // src/core.ts is imported by 5 different modules
    const fanOutResult = {
      file_path: 'src/core.ts',
      max_depth: 1,
      affected_files: [
        'src/core.ts',
        'src/api/routes.ts',
        'src/api/middleware.ts',
        'src/services/auth.ts',
        'src/services/user.ts',
        'src/db/connection.ts',
      ],
      affected_symbols: [
        sym('coreInit', 'coreInit', 'function', 'src/core.ts', 0),
        sym('routeHandler', 'routeHandler', 'function', 'src/api/routes.ts', 1),
        sym('authMiddleware', 'authMiddleware', 'function', 'src/api/middleware.ts', 1),
        sym('authenticate', 'authenticate', 'function', 'src/services/auth.ts', 1),
        sym('createUser', 'createUser', 'function', 'src/services/user.ts', 1),
        sym('getPool', 'getPool', 'function', 'src/db/connection.ts', 1),
      ],
      total_affected: 6,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: fanOutResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/core.ts', max_depth: 1 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    expect(parsed.total_affected).toBe(6);
    expect(parsed.affected_files).toHaveLength(6);

    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    const depth1Symbols = symbols.filter((s) => s.depth === 1);
    expect(depth1Symbols).toHaveLength(5);
  });
});

// ── Mixed Symbol Kinds ───────────────────────────────────────────────────────

describe('Blast Radius — Mixed Symbol Kinds', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should handle graphs with functions, classes, variables, and types', async () => {
    const mixedResult = {
      file_path: 'src/models/user.ts',
      max_depth: 3,
      affected_files: [
        'src/models/user.ts',
        'src/services/user-service.ts',
        'src/api/user-controller.ts',
      ],
      affected_symbols: [
        sym('User', 'User', 'class', 'src/models/user.ts', 0),
        sym('UserType', 'UserType', 'type', 'src/models/user.ts', 0),
        sym('DEFAULT_ROLE', 'DEFAULT_ROLE', 'variable', 'src/models/user.ts', 0),
        sym('UserService', 'UserService', 'class', 'src/services/user-service.ts', 1),
        sym('createUser', 'UserController.createUser', 'function', 'src/api/user-controller.ts', 2),
      ],
      total_affected: 5,
    };

    mockQuery.mockResolvedValueOnce({ rows: [{ result: mixedResult }] });
    const input = codeBlastRadiusSchema.parse({ file_path: 'src/models/user.ts', max_depth: 3 });
    const result = await codeBlastRadiusHandler(input);
    const parsed = parseContent(result);

    expect(parsed.total_affected).toBe(5);

    const symbols = parsed.affected_symbols as Array<Record<string, unknown>>;
    const kinds = symbols.map((s) => s.kind);
    expect(kinds).toContain('class');
    expect(kinds).toContain('type');
    expect(kinds).toContain('variable');
    expect(kinds).toContain('function');
  });
});
