/**
 * Unit tests for the `init.index` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates root_path (required, non-empty) and force (optional bool, default false)
 * - Uses IndexerService for file walking and hash comparison
 * - Routes to TypeScript parser for .ts/.js files
 * - Routes to Python parser for .py files
 * - Routes to SQL parser for .sql files
 * - Inserts symbols into code_symbols table
 * - Inserts imports into code_imports table with target_file_id resolution
 * - Computes and inserts edges into code_edges
 * - Returns summary: total_files, indexed, skipped, symbols_found, imports_found, edges_computed
 * - Handles parse errors gracefully (skips file, continues)
 * - Handles DB errors gracefully
 *
 * @ticket TASK-INT-BE042
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initIndexSchema, initIndexHandler } from './init-index.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: () => mockConnect(),
  },
}));

vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockIndexWorkspace = vi.fn();
vi.mock('../services/indexer/indexer-service.js', () => ({
  IndexerService: vi.fn().mockImplementation(() => ({
    indexWorkspace: mockIndexWorkspace,
  })),
}));

const mockParseTypeScript = vi.fn();
vi.mock('../services/parsers/typescript-parser.js', () => ({
  parseTypeScript: (...args: unknown[]) => mockParseTypeScript(...args),
}));

const mockParsePython = vi.fn();
vi.mock('../services/parsers/python-parser.js', () => ({
  parsePython: (...args: unknown[]) => mockParsePython(...args),
}));

const mockParseSql = vi.fn();
vi.mock('../services/parsers/sql-parser.js', () => ({
  parseSql: (...args: unknown[]) => mockParseSql(...args),
}));

const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseContent(result: {
  content: Array<{ type: string; [k: string]: unknown }>;
}): Record<string, unknown> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

function setupMockClient(): void {
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('initIndexSchema', () => {
  it('should require root_path', () => {
    expect(() => initIndexSchema.parse({})).toThrow();
  });

  it('should accept valid root_path with default force', () => {
    const result = initIndexSchema.parse({ root_path: '/workspace' });
    expect(result.root_path).toBe('/workspace');
    expect(result.force).toBe(false);
  });

  it('should accept force=true', () => {
    const result = initIndexSchema.parse({ root_path: '/ws', force: true });
    expect(result.force).toBe(true);
  });

  it('should reject empty root_path', () => {
    expect(() => initIndexSchema.parse({ root_path: '' })).toThrow();
  });

  it('should reject non-string root_path', () => {
    expect(() => initIndexSchema.parse({ root_path: 123 })).toThrow();
  });

  it('should reject non-boolean force', () => {
    expect(() =>
      initIndexSchema.parse({ root_path: '/ws', force: 'yes' }),
    ).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('initIndexHandler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return summary when no files changed', async () => {
    mockIndexWorkspace.mockResolvedValue({
      total: 10,
      changed: 0,
      unchanged: 10,
      removed: 0,
      changedFiles: [],
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(data.total_files).toBe(10);
    expect(data.indexed).toBe(0);
    expect(data.skipped).toBe(10);
    expect(data.symbols_found).toBe(0);
    expect(data.imports_found).toBe(0);
    expect(result.isError).toBeUndefined();
  });

  it('should parse TypeScript files and insert symbols/imports', async () => {
    const changedFiles = [
      { path: 'src/app.ts', language: 'typescript', hash: 'abc', lineCount: 50 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 5,
      changed: 1,
      unchanged: 4,
      removed: 0,
      changedFiles,
    });

    setupMockClient();

    mockReadFile.mockResolvedValue('const x = 1;');

    mockParseTypeScript.mockResolvedValue({
      symbols: [
        {
          name: 'handleRequest',
          qualifiedName: 'handleRequest',
          kind: 'function',
          startLine: 1,
          endLine: 10,
          signature: 'function handleRequest()',
          exported: true,
        },
      ],
      imports: [
        {
          targetPath: './utils.js',
          importNames: ['helper'],
          isDefaultImport: false,
        },
      ],
    });

    // file lookup
    mockClientQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('BEGIN')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('COMMIT')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        return { rows: [{ id: 'file-uuid-1' }] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM code_symbols')) {
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM code_imports')) {
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO code_symbols')) {
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO code_imports')) {
        return { rows: [] };
      }
      // Edge computation: imports with target_file_id
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO code_edges')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(data.total_files).toBe(5);
    expect(data.indexed).toBe(1);
    expect(data.skipped).toBe(4);
    expect(data.symbols_found).toBe(1);
    expect(data.imports_found).toBe(1);
    expect(result.isError).toBeUndefined();

    // Verify parseTypeScript was called
    expect(mockParseTypeScript).toHaveBeenCalledWith('const x = 1;', 'src/app.ts');
    // Verify readFile was called with constructed absolute path
    expect(mockReadFile).toHaveBeenCalledWith('/workspace/src/app.ts', 'utf-8');
  });

  it('should parse Python files and insert symbols/imports', async () => {
    const changedFiles = [
      { path: 'src/main.py', language: 'python', hash: 'def', lineCount: 30 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 3,
      changed: 1,
      unchanged: 2,
      removed: 0,
      changedFiles,
    });

    setupMockClient();
    mockReadFile.mockResolvedValue('def main(): pass');

    mockParsePython.mockResolvedValue({
      symbols: [
        {
          name: 'main',
          qualified_name: 'main',
          kind: 'function',
          start_line: 1,
          end_line: 1,
          signature: 'def main()',
          exported: true,
          children: [],
        },
      ],
      imports: [
        {
          source_path: 'os',
          imported_name: 'path',
          alias: null,
          is_default: false,
          is_namespace: false,
          is_type_only: false,
        },
      ],
    });

    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        return { rows: [{ id: 'file-uuid-2' }] };
      }
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(data.symbols_found).toBe(1);
    expect(data.imports_found).toBe(1);
    expect(mockParsePython).toHaveBeenCalledWith('def main(): pass');
  });

  it('should parse SQL files and insert symbols (no imports)', async () => {
    const changedFiles = [
      { path: 'db/schema.sql', language: 'sql', hash: 'sql1', lineCount: 20 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 2,
      changed: 1,
      unchanged: 1,
      removed: 0,
      changedFiles,
    });

    setupMockClient();
    mockReadFile.mockResolvedValue('CREATE TABLE foo (id INT);');

    mockParseSql.mockResolvedValue({
      symbols: [
        {
          name: 'foo',
          qualified_name: 'foo',
          kind: 'table',
          start_line: 1,
          end_line: 1,
          signature: 'CREATE TABLE foo',
          exported: true,
          children: [],
        },
      ],
      imports: [],
    });

    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        return { rows: [{ id: 'file-uuid-3' }] };
      }
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(data.symbols_found).toBe(1);
    expect(data.imports_found).toBe(0);
    expect(mockParseSql).toHaveBeenCalledWith('CREATE TABLE foo (id INT);');
  });

  it('should skip unsupported languages', async () => {
    const changedFiles = [
      { path: 'notes.md', language: 'markdown', hash: 'md1', lineCount: 5 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 1,
      changed: 1,
      unchanged: 0,
      removed: 0,
      changedFiles,
    });

    setupMockClient();
    mockReadFile.mockResolvedValue('# hello');

    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        return { rows: [{ id: 'file-uuid-4' }] };
      }
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(data.symbols_found).toBe(0);
    expect(data.imports_found).toBe(0);
  });

  it('should skip files not found in code_files table', async () => {
    const changedFiles = [
      { path: 'orphan.ts', language: 'typescript', hash: 'x', lineCount: 1 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 1,
      changed: 1,
      unchanged: 0,
      removed: 0,
      changedFiles,
    });

    setupMockClient();

    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        return { rows: [] }; // Not found
      }
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(data.symbols_found).toBe(0);
    // readFile should not be called since file_id lookup failed
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('should gracefully handle parse errors and continue', async () => {
    const changedFiles = [
      { path: 'bad.ts', language: 'typescript', hash: 'bad', lineCount: 1 },
      { path: 'good.ts', language: 'typescript', hash: 'good', lineCount: 10 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 2,
      changed: 2,
      unchanged: 0,
      removed: 0,
      changedFiles,
    });

    setupMockClient();

    // First file throws, second succeeds
    let readCount = 0;
    mockReadFile.mockImplementation(() => {
      readCount++;
      return Promise.resolve(`file-${readCount}`);
    });

    mockParseTypeScript
      .mockRejectedValueOnce(new Error('Parse error'))
      .mockResolvedValueOnce({
        symbols: [
          {
            name: 'goodFn',
            qualifiedName: 'goodFn',
            kind: 'function',
            startLine: 1,
            endLine: 5,
            signature: 'function goodFn()',
            exported: true,
          },
        ],
        imports: [],
      });

    let fileQueryCount = 0;
    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        fileQueryCount++;
        return { rows: [{ id: `file-uuid-${fileQueryCount}` }] };
      }
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    // Only the good file should have its symbol counted
    expect(data.symbols_found).toBe(1);
    expect(result.isError).toBeUndefined();
  });

  it('should compute edges from resolved imports', async () => {
    const changedFiles = [
      { path: 'src/handler.ts', language: 'typescript', hash: 'h1', lineCount: 20 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 1,
      changed: 1,
      unchanged: 0,
      removed: 0,
      changedFiles,
    });

    setupMockClient();
    mockReadFile.mockResolvedValue('import { helper } from "./utils";');

    mockParseTypeScript.mockResolvedValue({
      symbols: [
        {
          name: 'process',
          qualifiedName: 'process',
          kind: 'function',
          startLine: 3,
          endLine: 10,
          signature: 'function process()',
          exported: true,
        },
      ],
      imports: [
        {
          targetPath: './utils',
          importNames: ['helper'],
          isDefaultImport: false,
        },
      ],
    });

    mockClientQuery.mockImplementation((sql: string, params?: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files') && !sql.includes('code_imports')) {
        return { rows: [{ id: 'handler-file-id' }] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM')) {
        return { rows: [] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO code_symbols')) {
        return { rows: [] };
      }
      // Import target resolution
      if (typeof sql === 'string' && sql.includes('INSERT INTO code_imports')) {
        return { rows: [] };
      }
      // Edge computation queries
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return {
          rows: [
            {
              id: 'import-1',
              source_file_id: 'handler-file-id',
              target_file_id: 'utils-file-id',
              import_names: ['helper'],
              is_default_import: false,
            },
          ],
        };
      }
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_symbols WHERE file_id = $1') && !sql.includes('exported')) {
        return { rows: [{ id: 'source-sym-1' }] };
      }
      if (typeof sql === 'string' && sql.includes('exported = TRUE') && sql.includes('ANY')) {
        return { rows: [{ id: 'target-sym-1' }] };
      }
      if (typeof sql === 'string' && sql.includes('INSERT INTO code_edges')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(data.edges_computed).toBe(1);
    expect(data.symbols_found).toBe(1);
    expect(data.imports_found).toBe(1);
  });

  it('should handle DB errors and return isError', async () => {
    mockIndexWorkspace.mockRejectedValue(new Error('Connection refused'));

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    expect(result.isError).toBe(true);
    expect(data.error).toBe('INDEXING_FAILED');
    expect(data.message).toBe('Connection refused');
  });

  it('should rollback on transaction error', async () => {
    const changedFiles = [
      { path: 'src/app.ts', language: 'typescript', hash: 'abc', lineCount: 10 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 1,
      changed: 1,
      unchanged: 0,
      removed: 0,
      changedFiles,
    });

    setupMockClient();

    // Make the client query fail on symbol insert
    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('BEGIN')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('ROLLBACK')) return { rows: [] };
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        return { rows: [{ id: 'file-1' }] };
      }
      if (typeof sql === 'string' && sql.includes('DELETE FROM')) return { rows: [] };
      throw new Error('Insert failed');
    });

    mockReadFile.mockResolvedValue('code');
    mockParseTypeScript.mockResolvedValue({
      symbols: [
        {
          name: 'x',
          qualifiedName: 'x',
          kind: 'variable',
          startLine: 1,
          endLine: 1,
          signature: 'const x',
          exported: false,
        },
      ],
      imports: [],
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });

    expect(result.isError).toBe(true);
    // Verify rollback was called
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockClientRelease).toHaveBeenCalled();
  });

  it('should flatten Python parser children symbols', async () => {
    const changedFiles = [
      { path: 'src/service.py', language: 'python', hash: 'py1', lineCount: 40 },
    ];

    mockIndexWorkspace.mockResolvedValue({
      total: 1,
      changed: 1,
      unchanged: 0,
      removed: 0,
      changedFiles,
    });

    setupMockClient();
    mockReadFile.mockResolvedValue('class Svc:\n  def run(self): pass');

    mockParsePython.mockResolvedValue({
      symbols: [
        {
          name: 'Svc',
          qualified_name: 'Svc',
          kind: 'class',
          start_line: 1,
          end_line: 2,
          signature: 'class Svc',
          exported: true,
          children: [
            {
              name: 'run',
              qualified_name: 'Svc.run',
              kind: 'method',
              start_line: 2,
              end_line: 2,
              signature: 'def run(self)',
              exported: false,
              children: [],
            },
          ],
        },
      ],
      imports: [],
    });

    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        return { rows: [{ id: 'py-file-id' }] };
      }
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: false });
    const data = parseContent(result);

    // Class + method = 2 symbols
    expect(data.symbols_found).toBe(2);
  });

  it('should handle force=true by re-indexing all files from DB', async () => {
    mockIndexWorkspace.mockResolvedValue({
      total: 3,
      changed: 0,
      unchanged: 3,
      removed: 0,
      changedFiles: [],
    });

    // force=true queries all files from DB
    mockQuery.mockResolvedValue({
      rows: [
        { file_path: 'src/a.ts', language: 'typescript' },
        { file_path: 'src/b.py', language: 'python' },
      ],
    });

    setupMockClient();

    mockReadFile
      .mockResolvedValueOnce('const a = 1;')
      .mockResolvedValueOnce('x = 1');

    mockParseTypeScript.mockResolvedValue({
      symbols: [
        {
          name: 'a',
          qualifiedName: 'a',
          kind: 'variable',
          startLine: 1,
          endLine: 1,
          signature: 'const a',
          exported: false,
        },
      ],
      imports: [],
    });

    mockParsePython.mockResolvedValue({
      symbols: [
        {
          name: 'x',
          qualified_name: 'x',
          kind: 'variable',
          start_line: 1,
          end_line: 1,
          signature: null,
          exported: false,
          children: [],
        },
      ],
      imports: [],
    });

    let fileIdCounter = 0;
    mockClientQuery.mockImplementation((sql: string) => {
      if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files')) {
        fileIdCounter++;
        return { rows: [{ id: `force-file-${fileIdCounter}` }] };
      }
      if (typeof sql === 'string' && sql.includes('FROM code_imports') && sql.includes('target_file_id IS NOT NULL')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const result = await initIndexHandler({ root_path: '/workspace', force: true });
    const data = parseContent(result);

    expect(data.indexed).toBe(2);
    expect(data.symbols_found).toBe(2);
  });
});
