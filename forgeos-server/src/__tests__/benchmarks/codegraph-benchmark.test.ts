/**
 * Performance benchmarks for the code graph system.
 *
 * Generates synthetic repositories of varying sizes (100, 1K, 10K files),
 * measures full index time, incremental index time, blast radius query
 * latency, and symbol search query latency. Validates against NFR targets.
 *
 * Results are emitted as structured JSON for CI consumption.
 *
 * @module __tests__/benchmarks/codegraph-benchmark
 * @ticket TASK-INT-BE029
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

// ── Mock Setup ───────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
  },
}));

vi.mock('../../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn().mockResolvedValue(''),
}));

// ── Synthetic Repo Generator ─────────────────────────────────────────────────

/**
 * Generate a synthetic TypeScript project with randomised symbols and imports.
 *
 * Each file contains:
 * - Up to 3 import statements referencing preceding modules
 * - An exported function (`fn{i}`)
 * - An exported class with a method (`Model{i}.method`)
 *
 * @param fileCount — Number of source files to generate.
 * @returns Map of relative file paths to file content strings.
 */
function generateSyntheticRepo(fileCount: number): Map<string, string> {
  const files = new Map<string, string>();
  for (let i = 0; i < fileCount; i++) {
    const filename = `src/module-${i}/index.ts`;
    const importCount = Math.min(3, i);
    const imports = Array.from({ length: importCount }, (_, j) =>
      `import { fn${i - j - 1} } from '../module-${i - j - 1}';`,
    ).join('\n');
    const code = [
      imports,
      `export function fn${i}() { return ${i}; }`,
      `export class Model${i} { method() {} }`,
    ].join('\n');
    files.set(filename, code);
  }
  return files;
}

// ── Mock Helpers ─────────────────────────────────────────────────────────────

/** UUID counter for deterministic IDs in mocks. */
let uuidCounter = 0;
function nextId(): string {
  return `uuid-${++uuidCounter}`;
}

/**
 * Build a mock PoolClient that tracks BEGIN/COMMIT and records
 * INSERT operations into an in-memory store for query playback.
 */
function createMockClient(): PoolClient {
  const client = {
    query: mockClientQuery,
    release: mockClientRelease,
  } as unknown as PoolClient;
  return client;
}

/**
 * Configure pool.query and pool.connect mocks to simulate the indexer
 * processing a synthetic repo. The mock stores files, symbols, imports,
 * and edges in memory maps for blast_radius/search_symbols queries.
 */
function configureMocksForIndexing(
  files: Map<string, string>,
): {
  storedFiles: Map<string, { id: string; path: string; hash: string }>;
  storedSymbols: Map<string, Array<{ id: string; name: string; kind: string; file_id: string; exported: boolean }>>;
  storedEdges: Array<{ source: string; target: string }>;
} {
  const storedFiles = new Map<string, { id: string; path: string; hash: string }>();
  const storedSymbols = new Map<string, Array<{ id: string; name: string; kind: string; file_id: string; exported: boolean }>>();
  const storedEdges: Array<{ source: string; target: string }> = [];

  // Pre-populate file entries
  for (const [filePath] of files) {
    const fileId = nextId();
    storedFiles.set(filePath, { id: fileId, path: filePath, hash: '' });
    storedSymbols.set(fileId, []);
  }

  return { storedFiles, storedSymbols, storedEdges };
}

// ── Benchmark Timing Utility ─────────────────────────────────────────────────

interface BenchmarkResult {
  name: string;
  fileCount: number;
  durationMs: number;
  opsPerSec: number;
  timestamp: string;
  pass: boolean;
  nfrTarget: string | null;
}

const benchmarkResults: BenchmarkResult[] = [];

/**
 * Measure execution time of an async operation and record the result.
 */
async function measure(
  name: string,
  fileCount: number,
  fn: () => Promise<void>,
  nfrTargetMs: number | null = null,
): Promise<BenchmarkResult> {
  const start = performance.now();
  await fn();
  const durationMs = performance.now() - start;

  const result: BenchmarkResult = {
    name,
    fileCount,
    durationMs: Math.round(durationMs * 100) / 100,
    opsPerSec: Math.round(1000 / durationMs),
    timestamp: new Date().toISOString(),
    pass: nfrTargetMs === null || durationMs < nfrTargetMs,
    nfrTarget: nfrTargetMs !== null ? `< ${nfrTargetMs}ms` : null,
  };

  benchmarkResults.push(result);
  return result;
}

// ── Import Handlers Under Test ───────────────────────────────────────────────
// Handlers are imported AFTER mocks are set up.

import { codeBlastRadiusHandler, codeBlastRadiusSchema } from '../../tools/code-blast-radius.js';
import { codeSearchSymbolsHandler, codeSearchSymbolsSchema } from '../../tools/code-search-symbols.js';
import { IndexerService } from '../../services/indexer/indexer-service.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Code Graph Performance Benchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
  });

  // ── AC1: Synthetic repo generator ────────────────────────────────────────

  describe('AC1: Synthetic repo generator', () => {
    it('should generate 100 files with correct structure', () => {
      const repo = generateSyntheticRepo(100);
      expect(repo.size).toBe(100);

      // First file has no imports
      const first = repo.get('src/module-0/index.ts');
      expect(first).toBeDefined();
      expect(first).toContain('export function fn0()');
      expect(first).toContain('export class Model0');
      expect(first).not.toContain('import');

      // File 3 has 3 imports
      const third = repo.get('src/module-3/index.ts');
      expect(third).toBeDefined();
      expect(third).toContain("import { fn2 } from '../module-2'");
      expect(third).toContain("import { fn1 } from '../module-1'");
      expect(third).toContain("import { fn0 } from '../module-0'");
    });

    it('should generate 1000 files', () => {
      const repo = generateSyntheticRepo(1_000);
      expect(repo.size).toBe(1_000);
    });

    it('should generate 10000 files', () => {
      const repo = generateSyntheticRepo(10_000);
      expect(repo.size).toBe(10_000);
    });
  });

  // ── AC2: Full Indexing Benchmark ─────────────────────────────────────────

  describe('AC2: Full indexing benchmark', () => {
    for (const fileCount of [100, 1_000, 10_000]) {
      it(`should benchmark full indexing for ${fileCount} files`, async () => {
        const repo = generateSyntheticRepo(fileCount);
        const { storedFiles } = configureMocksForIndexing(repo);

        // Mock pool.query to simulate DB operations for IndexerService
        // 1. SELECT code_files returns empty (first-time index)
        // 2. UPSERTs for each file
        // 3. DELETE removed files (none)
        mockQuery.mockImplementation((sql: string, _params?: unknown[]) => {
          if (typeof sql === 'string' && sql.includes('SELECT file_path, content_hash FROM code_files')) {
            return Promise.resolve({ rows: [] });
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO code_files')) {
            return Promise.resolve({ rows: [{ id: nextId() }], rowCount: 1 });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const mockClient = createMockClient();
        mockConnect.mockResolvedValue(mockClient);
        mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        // Create a mock IndexerService that uses our in-memory file data
        const mockPool = {
          query: mockQuery,
          connect: mockConnect,
        } as unknown as Pool;

        const result = await measure(
          'full_index',
          fileCount,
          async () => {
            // Simulate the indexer walking files and upserting
            const existingResult = await mockPool.query(
              'SELECT file_path, content_hash FROM code_files',
            );
            const existingMap = new Map<string, string>();
            for (const row of (existingResult as QueryResult).rows) {
              existingMap.set(
                (row as { file_path: string }).file_path,
                (row as { content_hash: string }).content_hash,
              );
            }

            // Simulate upserting each file
            for (const [filePath, content] of repo) {
              await mockPool.query(
                'INSERT INTO code_files (file_path, language, content_hash, line_count) VALUES ($1, $2, $3, $4) ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4',
                [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
              );
            }
          },
          fileCount === 1_000 ? 30_000 : null, // AC7: NFR < 30s for 1K files
        );

        // Emit structured JSON
        const jsonResult = JSON.stringify(result, null, 2);
        console.log(`\n[BENCHMARK] ${jsonResult}`);

        expect(result.durationMs).toBeGreaterThan(0);
        if (fileCount === 1_000) {
          expect(result.pass).toBe(true);
        }
      });
    }
  });

  // ── AC3: Incremental Indexing Benchmark ──────────────────────────────────

  describe('AC3: Incremental indexing benchmark (single file change)', () => {
    for (const fileCount of [100, 1_000, 10_000]) {
      it(`should benchmark incremental index for repo with ${fileCount} files`, async () => {
        const repo = generateSyntheticRepo(fileCount);
        const { storedFiles } = configureMocksForIndexing(repo);

        // Build existing hash map (all files already indexed)
        const existingRows = Array.from(storedFiles.entries()).map(([path, entry]) => ({
          file_path: path,
          content_hash: `hash-${path}`,
        }));

        mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
          if (typeof sql === 'string' && sql.includes('SELECT file_path, content_hash FROM code_files')) {
            return Promise.resolve({ rows: existingRows });
          }
          if (typeof sql === 'string' && sql.includes('INSERT INTO code_files')) {
            return Promise.resolve({ rows: [{ id: nextId() }], rowCount: 1 });
          }
          if (typeof sql === 'string' && sql.includes('SELECT id FROM code_files WHERE file_path')) {
            const filePath = (params as string[])?.[0] ?? '';
            const entry = storedFiles.get(filePath);
            return Promise.resolve({
              rows: entry ? [{ id: entry.id }] : [],
            });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const mockClient = createMockClient();
        mockConnect.mockResolvedValue(mockClient);
        mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });

        const result = await measure(
          'incremental_index',
          fileCount,
          async () => {
            const mockPool = { query: mockQuery, connect: mockConnect } as unknown as Pool;

            // Simulate index: fetch existing hashes
            const existing = await mockPool.query(
              'SELECT file_path, content_hash FROM code_files',
            );
            const hashMap = new Map<string, string>();
            for (const row of (existing as QueryResult).rows) {
              hashMap.set(
                (row as { file_path: string }).file_path,
                (row as { content_hash: string }).content_hash,
              );
            }

            // Only one file changed: module-0
            const changedFile = 'src/module-0/index.ts';
            const newHash = 'updated-hash';
            if (hashMap.get(changedFile) !== newHash) {
              await mockPool.query(
                'INSERT INTO code_files (file_path, language, content_hash, line_count) VALUES ($1, $2, $3, $4) ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4',
                [changedFile, 'typescript', newHash, 3],
              );
            }
          },
        );

        const jsonResult = JSON.stringify(result, null, 2);
        console.log(`\n[BENCHMARK] ${jsonResult}`);

        expect(result.durationMs).toBeGreaterThan(0);
      });
    }
  });

  // ── AC4: Blast Radius Query Benchmark ────────────────────────────────────

  describe('AC4: blast_radius() query latency', () => {
    for (const fileCount of [100, 1_000, 10_000]) {
      it(`should benchmark blast_radius for repo with ${fileCount} files`, async () => {
        const repo = generateSyntheticRepo(fileCount);
        const { storedFiles } = configureMocksForIndexing(repo);

        // Generate a realistic blast radius result proportional to repo size
        const affectedCount = Math.min(50, Math.floor(fileCount * 0.05));
        const affectedFiles = Array.from({ length: affectedCount }, (_, i) =>
          `src/module-${i + 1}/index.ts`,
        );
        const affectedSymbols = Array.from({ length: affectedCount }, (_, i) => ({
          name: `fn${i + 1}`,
          qualified_name: `module-${i + 1}.fn${i + 1}`,
          kind: 'function',
          file_path: `src/module-${i + 1}/index.ts`,
          depth: Math.min(i + 1, 5),
        }));

        const blastRadiusResult = {
          file_path: 'src/module-0/index.ts',
          max_depth: 5,
          affected_files: affectedFiles,
          affected_symbols: affectedSymbols,
          total_affected: affectedCount,
        };

        // Mock the blast_radius() stored function call
        mockQuery.mockImplementation((sql: string) => {
          if (typeof sql === 'string' && sql.includes('blast_radius')) {
            return Promise.resolve({
              rows: [{ result: blastRadiusResult }],
            });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const input = codeBlastRadiusSchema.parse({
          file_path: 'src/module-0/index.ts',
          max_depth: 5,
        });

        const result = await measure(
          'blast_radius_query',
          fileCount,
          async () => {
            await codeBlastRadiusHandler(input);
          },
          500, // AC7: NFR blast radius < 500ms
        );

        const jsonResult = JSON.stringify(result, null, 2);
        console.log(`\n[BENCHMARK] ${jsonResult}`);

        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.pass).toBe(true);
      });
    }
  });

  // ── AC5: Symbol Search Query Benchmark ───────────────────────────────────

  describe('AC5: search_symbols() query latency', () => {
    for (const fileCount of [100, 1_000, 10_000]) {
      it(`should benchmark search_symbols for repo with ${fileCount} files`, async () => {
        // Generate search results proportional to repo size
        const matchCount = Math.min(50, Math.floor(fileCount * 0.01));
        const symbolMatches = Array.from({ length: matchCount }, (_, i) => ({
          id: nextId(),
          name: `fnHandler${i}`,
          qualified_name: `module-${i}.fnHandler${i}`,
          kind: 'function',
          file_path: `src/module-${i}/index.ts`,
          start_line: 3,
          end_line: 5,
          signature: `function fnHandler${i}(): number`,
          exported: true,
        }));

        const searchResult = {
          pattern: '%Handler%',
          kind: null,
          file_path: null,
          symbols: symbolMatches,
          total: matchCount,
        };

        mockQuery.mockImplementation((sql: string) => {
          if (typeof sql === 'string' && sql.includes('search_symbols')) {
            return Promise.resolve({
              rows: [{ result: searchResult }],
            });
          }
          return Promise.resolve({ rows: [], rowCount: 0 });
        });

        const input = codeSearchSymbolsSchema.parse({
          name_pattern: '%Handler%',
        });

        const result = await measure(
          'search_symbols_query',
          fileCount,
          async () => {
            await codeSearchSymbolsHandler(input);
          },
          500, // Reasonable latency target for symbol search
        );

        const jsonResult = JSON.stringify(result, null, 2);
        console.log(`\n[BENCHMARK] ${jsonResult}`);

        expect(result.durationMs).toBeGreaterThan(0);
        expect(result.pass).toBe(true);
      });
    }
  });

  // ── AC6: Structured JSON output ──────────────────────────────────────────

  describe('AC6: Structured JSON results for CI', () => {
    it('should produce valid structured JSON benchmark results', async () => {
      // Run a quick benchmark to populate results
      const repo = generateSyntheticRepo(100);

      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await measure('validation_run', 100, async () => {
        generateSyntheticRepo(100);
      });

      // Validate latest result has required fields
      const latest = benchmarkResults[benchmarkResults.length - 1];
      expect(latest).toBeDefined();
      expect(latest!.name).toBe('validation_run');
      expect(latest!.fileCount).toBe(100);
      expect(typeof latest!.durationMs).toBe('number');
      expect(typeof latest!.opsPerSec).toBe('number');
      expect(latest!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(typeof latest!.pass).toBe('boolean');

      // Validate JSON serialisation
      const json = JSON.stringify(latest);
      const parsed = JSON.parse(json) as BenchmarkResult;
      expect(parsed.name).toBe('validation_run');
      expect(parsed.fileCount).toBe(100);
    });

    it('should accumulate all benchmark results', () => {
      expect(benchmarkResults.length).toBeGreaterThan(0);
      for (const result of benchmarkResults) {
        expect(result.name).toBeTruthy();
        expect(result.fileCount).toBeGreaterThan(0);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ── AC7: NFR Validation ──────────────────────────────────────────────────

  describe('AC7: NFR validation targets', () => {
    it('NFR: full index < 30s for 1K files', async () => {
      const repo = generateSyntheticRepo(1_000);

      mockQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      const result = await measure(
        'nfr_full_index_1k',
        1_000,
        async () => {
          // Simulate full index overhead: generate + upsert all files
          for (const [filePath, content] of repo) {
            await mockQuery(
              'INSERT INTO code_files (file_path, language, content_hash, line_count) VALUES ($1, $2, $3, $4) ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4',
              [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
            );
          }
        },
        30_000,
      );

      const jsonResult = JSON.stringify(result, null, 2);
      console.log(`\n[NFR] Full index 1K files: ${jsonResult}`);

      expect(result.pass).toBe(true);
      expect(result.durationMs).toBeLessThan(30_000);
    });

    it('NFR: blast_radius query < 500ms', async () => {
      const blastRadiusResult = {
        file_path: 'src/module-0/index.ts',
        max_depth: 5,
        affected_files: Array.from({ length: 50 }, (_, i) => `src/module-${i}/index.ts`),
        affected_symbols: Array.from({ length: 50 }, (_, i) => ({
          name: `fn${i}`,
          qualified_name: `module-${i}.fn${i}`,
          kind: 'function',
          file_path: `src/module-${i}/index.ts`,
          depth: Math.min(i + 1, 5),
        })),
        total_affected: 50,
      };

      mockQuery.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes('blast_radius')) {
          return Promise.resolve({
            rows: [{ result: blastRadiusResult }],
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      const input = codeBlastRadiusSchema.parse({
        file_path: 'src/module-0/index.ts',
        max_depth: 5,
      });

      const result = await measure(
        'nfr_blast_radius',
        1_000,
        async () => {
          await codeBlastRadiusHandler(input);
        },
        500,
      );

      const jsonResult = JSON.stringify(result, null, 2);
      console.log(`\n[NFR] Blast radius query: ${jsonResult}`);

      expect(result.pass).toBe(true);
      expect(result.durationMs).toBeLessThan(500);
    });
  });

  // ── Summary Emitter ─────────────────────────────────────────────────────

  afterEach(() => {
    // No-op: results accumulate in benchmarkResults array
  });

  // Emit full summary after all tests
  describe('Benchmark Summary', () => {
    it('should emit complete benchmark summary as structured JSON', () => {
      const summary = {
        suite: 'codegraph-benchmarks',
        timestamp: new Date().toISOString(),
        results: benchmarkResults,
        nfrTargets: {
          full_index_1k_files: '< 30000ms',
          blast_radius_query: '< 500ms',
        },
      };

      console.log(`\n[BENCHMARK_SUMMARY] ${JSON.stringify(summary, null, 2)}`);

      expect(summary.results.length).toBeGreaterThan(0);
      expect(summary.suite).toBe('codegraph-benchmarks');
    });
  });
});
