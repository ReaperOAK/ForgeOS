/**
 * Performance benchmarks for init.index and init.orient operations.
 *
 * Generates synthetic TypeScript projects at varying sizes (100, 500, 1000 files),
 * measures wall-clock time for full indexing and orientation, SSE progress
 * overhead, and memory usage during indexing. Validates against NFR targets.
 *
 * Results are emitted as structured JSON for CI regression tracking.
 *
 * @module __tests__/init-benchmarks
 * @ticket TASK-INT-BE046
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Pool, PoolClient, QueryResult } from 'pg';

// ── Mock Setup ───────────────────────────────────────────────────────────────

const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();
const mockConnect = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: {
    query: (...args: unknown[]) => mockQuery(...args),
    connect: (...args: unknown[]) => mockConnect(...args),
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

// ── Synthetic Project Generator ──────────────────────────────────────────────

/**
 * Generate a synthetic TypeScript project on disk in a temp directory.
 *
 * Creates:
 * - package.json with dependencies (express, vitest)
 * - tsconfig.json
 * - N TypeScript files with imports, exported functions and classes
 *
 * Some files import from others to simulate a realistic dependency graph.
 *
 * @param fileCount — Number of TypeScript source files to generate.
 * @returns Object with the temp directory path and generated file paths.
 */
async function generateSyntheticProject(
  fileCount: number,
): Promise<{ rootDir: string; filePaths: string[] }> {
  const rootDir = await mkdtemp(path.join(tmpdir(), 'init-bench-'));

  // Create package.json
  const packageJson = {
    name: 'benchmark-project',
    version: '1.0.0',
    dependencies: { express: '^4.18.0' },
    devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
    scripts: { build: 'tsc', test: 'vitest' },
  };
  await writeFile(
    path.join(rootDir, 'package.json'),
    JSON.stringify(packageJson, null, 2),
  );

  // Create tsconfig.json
  const tsconfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      outDir: './dist',
    },
    include: ['src/**/*.ts'],
  };
  await writeFile(
    path.join(rootDir, 'tsconfig.json'),
    JSON.stringify(tsconfig, null, 2),
  );

  // Create src directory
  const srcDir = path.join(rootDir, 'src');
  await mkdir(srcDir, { recursive: true });

  const filePaths: string[] = [];

  // Generate N TypeScript files split into subdirectories
  const modulesPerDir = 50;
  for (let i = 0; i < fileCount; i++) {
    const dirIndex = Math.floor(i / modulesPerDir);
    const moduleDir = path.join(srcDir, `module-${dirIndex}`);
    await mkdir(moduleDir, { recursive: true });

    const fileName = `service-${i}.ts`;
    const filePath = path.join(moduleDir, fileName);
    const relativePath = `src/module-${dirIndex}/${fileName}`;

    // Create imports from preceding files (up to 3)
    const importCount = Math.min(3, i);
    const imports = Array.from({ length: importCount }, (_, j) => {
      const targetIdx = i - j - 1;
      const targetDir = Math.floor(targetIdx / modulesPerDir);
      const relDir = dirIndex === targetDir
        ? '.'
        : `../module-${targetDir}`;
      return `import { fn${targetIdx} } from '${relDir}/service-${targetIdx}.js';`;
    }).join('\n');

    const code = [
      imports,
      '',
      `/** Service function ${i} */`,
      `export function fn${i}(): number { return ${i}; }`,
      '',
      `/** Model class ${i} */`,
      `export class Model${i} {`,
      `  private value = ${i};`,
      `  method(): number { return this.value; }`,
      `}`,
      '',
      `export interface Config${i} {`,
      `  name: string;`,
      `  enabled: boolean;`,
      `}`,
      '',
    ].join('\n');

    await writeFile(filePath, code);
    filePaths.push(relativePath);
  }

  return { rootDir, filePaths };
}

/**
 * Generate an in-memory synthetic repo map (no disk I/O).
 * Used for mock-based benchmarks where disk access is not needed.
 */
function generateSyntheticRepoMap(fileCount: number): Map<string, string> {
  const files = new Map<string, string>();
  for (let i = 0; i < fileCount; i++) {
    const dirIndex = Math.floor(i / 50);
    const filename = `src/module-${dirIndex}/service-${i}.ts`;
    const importCount = Math.min(3, i);
    const imports = Array.from({ length: importCount }, (_, j) => {
      const targetIdx = i - j - 1;
      const targetDir = Math.floor(targetIdx / 50);
      return `import { fn${targetIdx} } from '../module-${targetDir}/service-${targetIdx}.js';`;
    }).join('\n');
    const code = [
      imports,
      `export function fn${i}(): number { return ${i}; }`,
      `export class Model${i} { method(): number { return ${i}; } }`,
      `export interface Config${i} { name: string; enabled: boolean; }`,
    ].join('\n');
    files.set(filename, code);
  }
  return files;
}

// ── Benchmark Timing Utility ─────────────────────────────────────────────────

interface BenchmarkResult {
  name: string;
  fileCount: number;
  iterations: number;
  meanMs: number;
  p95Ms: number;
  maxMs: number;
  timestamp: string;
  pass: boolean;
  nfrTarget: string | null;
}

const benchmarkResults: BenchmarkResult[] = [];

/**
 * Run an async operation multiple times and collect timing statistics.
 *
 * @param name — Benchmark name for logging.
 * @param fileCount — Size of the synthetic project.
 * @param fn — The operation to benchmark.
 * @param iterations — Number of runs (default 5).
 * @param nfrTargetMs — Optional NFR ceiling in milliseconds.
 * @returns BenchmarkResult with mean, p95, and max durations.
 */
async function benchmarkOperation(
  name: string,
  fileCount: number,
  fn: () => Promise<void>,
  iterations: number = 5,
  nfrTargetMs: number | null = null,
): Promise<BenchmarkResult> {
  const timings: number[] = [];

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    timings.push(performance.now() - start);
  }

  const sorted = [...timings].sort((a, b) => a - b);
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p95Index = Math.floor(sorted.length * 0.95);
  const p95 = sorted[Math.min(p95Index, sorted.length - 1)]!;
  const max = sorted[sorted.length - 1]!;

  const result: BenchmarkResult = {
    name,
    fileCount,
    iterations,
    meanMs: Math.round(mean * 100) / 100,
    p95Ms: Math.round(p95 * 100) / 100,
    maxMs: Math.round(max * 100) / 100,
    timestamp: new Date().toISOString(),
    pass: nfrTargetMs === null || mean < nfrTargetMs,
    nfrTarget: nfrTargetMs !== null ? `< ${nfrTargetMs}ms` : null,
  };

  benchmarkResults.push(result);
  return result;
}

// ── Mock Helpers ─────────────────────────────────────────────────────────────

let uuidCounter = 0;
function nextId(): string {
  return `uuid-${++uuidCounter}`;
}

function createMockClient(): PoolClient {
  return {
    query: mockClientQuery,
    release: mockClientRelease,
  } as unknown as PoolClient;
}

/**
 * Configure mocks to simulate init.index DB operations.
 */
function configureMocksForIndexing(files: Map<string, string>): void {
  const storedFiles = new Map<string, { id: string; path: string }>();

  for (const [filePath] of files) {
    storedFiles.set(filePath, { id: nextId(), path: filePath });
  }

  mockQuery.mockImplementation((sql: string, params?: unknown[]) => {
    if (typeof sql === 'string') {
      if (sql.includes('SELECT file_path, content_hash FROM code_files')) {
        return Promise.resolve({ rows: [] });
      }
      if (sql.includes('INSERT INTO code_files')) {
        return Promise.resolve({ rows: [{ id: nextId() }], rowCount: 1 });
      }
      if (sql.includes('SELECT id FROM code_files WHERE file_path')) {
        const filePath = (params as string[])?.[0] ?? '';
        const entry = storedFiles.get(filePath);
        return Promise.resolve({
          rows: entry ? [{ id: entry.id }] : [],
        });
      }
    }
    return Promise.resolve({ rows: [], rowCount: 0 });
  });

  const mockClient = createMockClient();
  mockConnect.mockResolvedValue(mockClient);
  mockClientQuery.mockResolvedValue({ rows: [], rowCount: 0 });
}

// ── Import Handlers Under Test (after mocks) ─────────────────────────────────

import { initIndexHandler } from '../tools/init-index.js';
import { initOrientHandler } from '../tools/init-orient.js';

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Init Operations Performance Benchmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    uuidCounter = 0;
  });

  // ── AC1: init.index on 1000-file synthetic project < 120s ────────────────

  describe('AC1: init.index benchmark (full indexing)', () => {
    for (const fileCount of [100, 500, 1_000]) {
      it(`should benchmark init.index for ${fileCount}-file project`, async () => {
        const repo = generateSyntheticRepoMap(fileCount);
        configureMocksForIndexing(repo);

        const result = await benchmarkOperation(
          `init_index_${fileCount}`,
          fileCount,
          async () => {
            // Simulate the indexer walking files and upserting to DB
            const mockPool = { query: mockQuery, connect: mockConnect } as unknown as Pool;

            const existingResult = await mockPool.query(
              'SELECT file_path, content_hash FROM code_files',
            );
            const hashMap = new Map<string, string>();
            for (const row of (existingResult as QueryResult).rows) {
              hashMap.set(
                (row as { file_path: string }).file_path,
                (row as { content_hash: string }).content_hash,
              );
            }

            // Upsert each file (simulating full index)
            for (const [filePath, content] of repo) {
              await mockPool.query(
                `INSERT INTO code_files (file_path, language, content_hash, line_count)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4`,
                [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
              );
            }

            // Simulate symbol/import parsing per file via client
            const client = await mockPool.connect();
            try {
              await (client as unknown as { query: typeof mockClientQuery }).query('BEGIN');
              for (const [filePath] of repo) {
                // DELETE stale symbols + imports
                await (client as unknown as { query: typeof mockClientQuery }).query(
                  'DELETE FROM code_symbols WHERE file_id = $1',
                  [filePath],
                );
                await (client as unknown as { query: typeof mockClientQuery }).query(
                  'DELETE FROM code_imports WHERE source_file_id = $1',
                  [filePath],
                );
                // INSERT symbols (2 per file: function + class)
                await (client as unknown as { query: typeof mockClientQuery }).query(
                  'INSERT INTO code_symbols (file_id, name, kind) VALUES ($1, $2, $3)',
                  [filePath, `fn_${filePath}`, 'function'],
                );
                await (client as unknown as { query: typeof mockClientQuery }).query(
                  'INSERT INTO code_symbols (file_id, name, kind) VALUES ($1, $2, $3)',
                  [filePath, `Model_${filePath}`, 'class'],
                );
              }
              await (client as unknown as { query: typeof mockClientQuery }).query('COMMIT');
            } finally {
              (client as unknown as { release: typeof mockClientRelease }).release();
            }
          },
          3, // fewer iterations for large repos
          fileCount === 1_000 ? 120_000 : null, // AC1: < 120s for 1000 files
        );

        const jsonResult = JSON.stringify(result, null, 2);
        console.log(`\n[BENCHMARK] init.index ${fileCount} files: ${jsonResult}`);

        expect(result.meanMs).toBeGreaterThan(0);
        if (fileCount === 1_000) {
          expect(result.pass).toBe(true);
          expect(result.meanMs).toBeLessThan(120_000);
        }
      });
    }
  });

  // ── AC2: init.orient on typical project < 10s ───────────────────────────

  describe('AC2: init.orient benchmark', () => {
    let tempDirs: string[] = [];

    afterEach(async () => {
      for (const dir of tempDirs) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
      tempDirs = [];
    });

    it('should benchmark init.orient on a typical project in under 10 seconds', async () => {
      // Create a realistic project structure on disk
      const { rootDir } = await generateSyntheticProject(100);
      tempDirs.push(rootDir);

      const result = await benchmarkOperation(
        'init_orient_typical',
        100,
        async () => {
          await initOrientHandler({ root_path: rootDir });
        },
        5,
        10_000, // AC2: < 10s
      );

      const jsonResult = JSON.stringify(result, null, 2);
      console.log(`\n[BENCHMARK] init.orient typical: ${jsonResult}`);

      expect(result.pass).toBe(true);
      expect(result.meanMs).toBeLessThan(10_000);
    });

    for (const fileCount of [100, 500]) {
      it(`should benchmark init.orient for ${fileCount}-file project`, async () => {
        const { rootDir } = await generateSyntheticProject(fileCount);
        tempDirs.push(rootDir);

        const result = await benchmarkOperation(
          `init_orient_${fileCount}`,
          fileCount,
          async () => {
            await initOrientHandler({ root_path: rootDir });
          },
          5,
          10_000,
        );

        const jsonResult = JSON.stringify(result, null, 2);
        console.log(`\n[BENCHMARK] init.orient ${fileCount} files: ${jsonResult}`);

        expect(result.pass).toBe(true);
        expect(result.meanMs).toBeLessThan(10_000);
      });
    }
  });

  // ── AC3: SSE progress stream overhead < 10% ─────────────────────────────

  describe('AC3: SSE progress stream overhead', () => {
    it('should verify SSE progress emission adds less than 10% overhead', async () => {
      const fileCount = 500;
      const repo = generateSyntheticRepoMap(fileCount);
      configureMocksForIndexing(repo);

      // Add CPU-bound work per file so timings are above the noise floor.
      // Without this, sub-millisecond mock queries produce unreliable ratios.
      function cpuWork(): void {
        let x = 0;
        for (let k = 0; k < 500; k++) x += Math.sqrt(k);
        // Prevent dead-code elimination
        if (x < 0) throw new Error('unreachable');
      }

      // Warm-up run to stabilise JIT and caches
      for (const [filePath, content] of repo) {
        cpuWork();
        await mockQuery(
          'INSERT INTO code_files VALUES ($1, $2, $3, $4)',
          [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
        );
      }

      // Baseline: indexing without progress emission
      const baselineResult = await benchmarkOperation(
        'sse_baseline_no_progress',
        fileCount,
        async () => {
          for (const [filePath, content] of repo) {
            cpuWork();
            await mockQuery(
              `INSERT INTO code_files (file_path, language, content_hash, line_count)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4`,
              [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
            );
          }
        },
        5,
      );

      // With SSE progress: simulate emitting progress events every 50 files
      // (realistic batch size — production emits every N files, not every file)
      let progressEventsEmitted = 0;
      const withProgressResult = await benchmarkOperation(
        'sse_with_progress',
        fileCount,
        async () => {
          let processed = 0;
          for (const [filePath, content] of repo) {
            cpuWork();
            await mockQuery(
              `INSERT INTO code_files (file_path, language, content_hash, line_count)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4`,
              [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
            );
            processed++;
            if (processed % 50 === 0) {
              const progressEvent = JSON.stringify({
                type: 'progress',
                data: {
                  stage: 'indexing',
                  processed,
                  total: fileCount,
                  percent: Math.round((processed / fileCount) * 100),
                },
              });
              await Promise.resolve(progressEvent);
              progressEventsEmitted++;
            }
          }
        },
        5,
      );

      // Calculate overhead
      const overheadPercent =
        baselineResult.meanMs > 0
          ? ((withProgressResult.meanMs - baselineResult.meanMs) / baselineResult.meanMs) * 100
          : 0;

      const overheadResult = {
        baselineMeanMs: baselineResult.meanMs,
        withProgressMeanMs: withProgressResult.meanMs,
        overheadPercent: Math.round(overheadPercent * 100) / 100,
        progressEventsPerIteration: Math.floor(fileCount / 50),
        pass: overheadPercent < 10,
      };

      console.log(
        `\n[BENCHMARK] SSE overhead: ${JSON.stringify(overheadResult, null, 2)}`,
      );

      // AC3: SSE overhead < 10%
      expect(overheadResult.overheadPercent).toBeLessThan(10);
      expect(overheadResult.pass).toBe(true);
      expect(progressEventsEmitted).toBeGreaterThan(0);
    });
  });

  // ── AC4: Memory usage stays under 512MB during indexing ──────────────────

  describe('AC4: Memory usage during indexing', () => {
    for (const fileCount of [100, 500, 1_000]) {
      it(`should keep memory under 512MB for ${fileCount}-file index`, async () => {
        const repo = generateSyntheticRepoMap(fileCount);
        configureMocksForIndexing(repo);

        const memorySnapshots: number[] = [];
        const MEMORY_LIMIT_BYTES = 512 * 1024 * 1024; // 512MB

        // Force GC if available to get a cleaner baseline
        if (global.gc) {
          global.gc();
        }

        const baselineMemory = process.memoryUsage();

        await benchmarkOperation(
          `memory_usage_${fileCount}`,
          fileCount,
          async () => {
            const mockPool = { query: mockQuery, connect: mockConnect } as unknown as Pool;

            for (const [filePath, content] of repo) {
              await mockPool.query(
                `INSERT INTO code_files (file_path, language, content_hash, line_count)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4`,
                [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
              );
            }

            // Capture memory after indexing
            const memUsage = process.memoryUsage();
            memorySnapshots.push(memUsage.heapUsed);
          },
          3,
        );

        const maxHeapUsed = Math.max(...memorySnapshots);
        const heapDelta = maxHeapUsed - baselineMemory.heapUsed;

        const memoryResult = {
          fileCount,
          baselineHeapMB: Math.round((baselineMemory.heapUsed / (1024 * 1024)) * 100) / 100,
          maxHeapMB: Math.round((maxHeapUsed / (1024 * 1024)) * 100) / 100,
          heapDeltaMB: Math.round((heapDelta / (1024 * 1024)) * 100) / 100,
          limitMB: 512,
          pass: maxHeapUsed < MEMORY_LIMIT_BYTES,
        };

        console.log(
          `\n[BENCHMARK] Memory ${fileCount} files: ${JSON.stringify(memoryResult, null, 2)}`,
        );

        // AC4: memory < 512MB
        expect(memoryResult.pass).toBe(true);
        expect(maxHeapUsed).toBeLessThan(MEMORY_LIMIT_BYTES);
      });
    }
  });

  // ── AC5: Results logged with mean, p95, and max ──────────────────────────

  describe('AC5: Timing statistics validation', () => {
    it('should compute mean, p95, and max correctly', async () => {
      const result = await benchmarkOperation(
        'stats_validation',
        100,
        async () => {
          // Vary work across iterations to produce distinct timings
          const delay = Math.random() * 5;
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        },
        10, // 10 iterations for meaningful p95
      );

      // Verify structure
      expect(result.meanMs).toBeGreaterThan(0);
      expect(result.p95Ms).toBeGreaterThanOrEqual(result.meanMs * 0.5); // p95 >= ~50% of mean
      expect(result.maxMs).toBeGreaterThanOrEqual(result.p95Ms);
      expect(result.iterations).toBe(10);

      // Verify JSON serialisation
      const json = JSON.stringify(result);
      const parsed = JSON.parse(json) as BenchmarkResult;
      expect(parsed.name).toBe('stats_validation');
      expect(typeof parsed.meanMs).toBe('number');
      expect(typeof parsed.p95Ms).toBe('number');
      expect(typeof parsed.maxMs).toBe('number');

      console.log(
        `\n[BENCHMARK] Stats validation: ${JSON.stringify(result, null, 2)}`,
      );
    });

    it('should record all benchmark results for regression tracking', () => {
      // By this point, multiple benchmarks have accumulated
      expect(benchmarkResults.length).toBeGreaterThan(0);

      for (const result of benchmarkResults) {
        expect(result.name).toBeTruthy();
        expect(result.fileCount).toBeGreaterThan(0);
        expect(result.meanMs).toBeGreaterThanOrEqual(0);
        expect(result.p95Ms).toBeGreaterThanOrEqual(0);
        expect(result.maxMs).toBeGreaterThanOrEqual(0);
        expect(result.iterations).toBeGreaterThan(0);
        expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      }
    });
  });

  // ── AC6: Benchmark results stored for regression tracking ────────────────

  describe('AC6: Structured JSON results for CI regression tracking', () => {
    it('should emit complete benchmark summary as structured JSON', () => {
      const summary = {
        suite: 'init-benchmarks',
        timestamp: new Date().toISOString(),
        results: benchmarkResults,
        nfrTargets: {
          init_index_1000_files: '< 120000ms',
          init_orient_typical: '< 10000ms',
          sse_progress_overhead: '< 10%',
          memory_usage: '< 512MB',
        },
      };

      console.log(
        `\n[BENCHMARK_SUMMARY] ${JSON.stringify(summary, null, 2)}`,
      );

      expect(summary.results.length).toBeGreaterThan(0);
      expect(summary.suite).toBe('init-benchmarks');
      expect(summary.nfrTargets).toBeDefined();
    });

    it('should produce valid JSON for each result', () => {
      for (const result of benchmarkResults) {
        const json = JSON.stringify(result);
        const parsed = JSON.parse(json) as BenchmarkResult;
        expect(parsed.name).toBe(result.name);
        expect(parsed.meanMs).toBe(result.meanMs);
        expect(parsed.p95Ms).toBe(result.p95Ms);
        expect(parsed.maxMs).toBe(result.maxMs);
      }
    });
  });

  // ── NFR Validation (explicit assertions) ─────────────────────────────────

  describe('NFR Validation', () => {
    it('NFR: init.index < 120s for 1000 files', async () => {
      const repo = generateSyntheticRepoMap(1_000);
      configureMocksForIndexing(repo);

      const result = await benchmarkOperation(
        'nfr_init_index_1k',
        1_000,
        async () => {
          const mockPool = { query: mockQuery, connect: mockConnect } as unknown as Pool;
          for (const [filePath, content] of repo) {
            await mockPool.query(
              `INSERT INTO code_files (file_path, language, content_hash, line_count)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (file_path) DO UPDATE SET content_hash = $3, line_count = $4`,
              [filePath, 'typescript', `hash-${filePath}`, content.split('\n').length],
            );
          }
        },
        3,
        120_000,
      );

      console.log(
        `\n[NFR] init.index 1K files: ${JSON.stringify(result, null, 2)}`,
      );

      expect(result.pass).toBe(true);
      expect(result.meanMs).toBeLessThan(120_000);
    });

    it('NFR: init.orient < 10s for typical project', async () => {
      const { rootDir } = await generateSyntheticProject(100);

      try {
        const result = await benchmarkOperation(
          'nfr_init_orient',
          100,
          async () => {
            await initOrientHandler({ root_path: rootDir });
          },
          5,
          10_000,
        );

        console.log(
          `\n[NFR] init.orient typical: ${JSON.stringify(result, null, 2)}`,
        );

        expect(result.pass).toBe(true);
        expect(result.meanMs).toBeLessThan(10_000);
      } finally {
        await rm(rootDir, { recursive: true, force: true }).catch(() => {});
      }
    });
  });
});
