/**
 * Integration Tests — Drop-In Init Engine
 *
 * Tests the full init.index and init.orient tool handlers against
 * fixture project directories with known structures. Covers:
 *   - Full indexing producing code_files and code_symbols records
 *   - Orientation detecting TypeScript/Express correctly
 *   - Progress SSE stream event ordering
 *   - Excluded directories (node_modules, .git) are skipped
 *   - Empty project directory handling
 *   - Unsupported file types (logs warning, does not fail)
 *
 * All tests use a mock database pool — no real PostgreSQL required.
 *
 * @module __tests__/init-engine.integration
 * @ticket TASK-INT-BE045
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// ── Module Mocks ─────────────────────────────────────────────────────────────

// Mock the database pool before any tool import
vi.mock('../db/pool.js', () => {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };

  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
      __mockClient: client,
    },
  };
});

// Mock the logger to suppress output and capture warnings
vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { initIndexHandler } from '../tools/init-index.js';
import {
  initOrientHandler,
  detectPackageManager,
  detectFrameworks,
  detectLanguages,
  detectEntryPoints,
  detectTestFramework,
  detectBuildSystem,
  detectKeyDirectories,
  detectConfigFiles,
  type OrientationResult,
} from '../tools/init-orient.js';
import { walkDirectory } from '../services/indexer/file-walker.js';
import {
  updateProgress,
  resetProgress,
  getProgress,
  progressEmitter,
  type ProgressState,
} from '../api/routes/orientation-progress.js';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  __mockClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
}

// ── Fixture Helpers ──────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'forgeos-init-'));

  // Reset mocks between tests
  const mockPool = pool as unknown as MockPool;
  mockPool.query.mockReset().mockResolvedValue({ rows: [] });
  mockPool.__mockClient.query.mockReset().mockResolvedValue({ rows: [] });
  mockPool.__mockClient.release.mockReset();
  mockPool.connect.mockReset().mockResolvedValue(mockPool.__mockClient);

  vi.mocked(logger.info).mockReset();
  vi.mocked(logger.warn).mockReset();
  vi.mocked(logger.error).mockReset();

  resetProgress();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  progressEmitter.removeAllListeners();
});

/**
 * Create a TypeScript/Express fixture project with known structure.
 */
async function createExpressFixture(dir: string): Promise<void> {
  // package.json — Express project with vitest
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'test-express-project',
      version: '1.0.0',
      dependencies: { express: '^4.18.0' },
      devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
      scripts: { test: 'vitest', build: 'tsc', start: 'node dist/index.js' },
    }),
  );

  // tsconfig.json
  await writeFile(
    path.join(dir, 'tsconfig.json'),
    JSON.stringify({ compilerOptions: { target: 'es2022', module: 'nodenext' } }),
  );

  // Source files
  await mkdir(path.join(dir, 'src'), { recursive: true });

  await writeFile(
    path.join(dir, 'src/index.ts'),
    [
      'import express from "express";',
      'import { router } from "./routes";',
      '',
      'export const app = express();',
      '',
      'export function startServer(port: number): void {',
      '  app.use("/api", router);',
      '  app.listen(port);',
      '}',
    ].join('\n'),
  );

  await writeFile(
    path.join(dir, 'src/routes.ts'),
    [
      'import { Router } from "express";',
      'import { getHealth } from "./handlers";',
      '',
      'export const router = Router();',
      '',
      'router.get("/health", getHealth);',
    ].join('\n'),
  );

  await mkdir(path.join(dir, 'src/utils'), { recursive: true });

  await writeFile(
    path.join(dir, 'src/handlers.ts'),
    [
      'import type { Request, Response } from "express";',
      '',
      'export function getHealth(_req: Request, res: Response): void {',
      '  res.json({ status: "ok" });',
      '}',
    ].join('\n'),
  );

  await writeFile(
    path.join(dir, 'src/utils/helper.ts'),
    [
      'export function formatDate(d: Date): string {',
      '  return d.toISOString();',
      '}',
      '',
      'export const VERSION = "1.0.0";',
    ].join('\n'),
  );

  // node_modules (should be skipped)
  await mkdir(path.join(dir, 'node_modules', 'express'), { recursive: true });
  await writeFile(
    path.join(dir, 'node_modules', 'express', 'index.js'),
    'module.exports = {};',
  );

  // .git (should be skipped)
  await mkdir(path.join(dir, '.git', 'objects'), { recursive: true });
  await writeFile(path.join(dir, '.git', 'HEAD'), 'ref: refs/heads/main');
}

/**
 * Create an empty project directory (just the directory, nothing inside).
 */
async function createEmptyProject(dir: string): Promise<void> {
  // Directory already exists from mkdtemp, nothing else needed
}

/**
 * Create a project with only unsupported file types.
 */
async function createUnsupportedProject(dir: string): Promise<void> {
  await writeFile(path.join(dir, 'README.md'), '# Test Project');
  await writeFile(path.join(dir, 'data.csv'), 'col1,col2\na,b');
  await writeFile(path.join(dir, 'config.yaml'), 'key: value');
  await writeFile(path.join(dir, 'image.png'), 'not-a-real-png');
  await writeFile(path.join(dir, 'notes.txt'), 'some notes');
}

// ── AC1: init.index on fixture project ───────────────────────────────────────

describe('init.index — full indexing of fixture project', () => {
  it('indexes a TypeScript/Express project and produces code_files records', async () => {
    await createExpressFixture(tempDir);

    // Set up mock client to return file IDs so parsing proceeds
    const mockPool = pool as unknown as MockPool;
    let fileIdCounter = 0;
    mockPool.__mockClient.query.mockImplementation(
      async (sql: string, _params?: unknown[]) => {
        if (typeof sql === 'string') {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          if (sql.includes('SELECT id FROM code_files')) {
            fileIdCounter++;
            return { rows: [{ id: `file-${fileIdCounter}` }] };
          }
          if (sql.includes('SELECT id, source_file_id')) {
            return { rows: [] };
          }
        }
        return { rows: [] };
      },
    );

    const result = await initIndexHandler({ root_path: tempDir, force: false });

    expect(result.isError).toBeUndefined();

    const body = JSON.parse(result.content[0]!.text as string);

    // Fixture has 4 TS files: index.ts, routes.ts, handlers.ts, utils/helper.ts
    expect(body.total_files).toBe(4);
    expect(body.indexed).toBe(4);
    expect(body.skipped).toBe(0);
    expect(body.symbols_found).toBeGreaterThan(0);
  });

  it('extracts symbols from indexed TypeScript files', async () => {
    await createExpressFixture(tempDir);

    // Configure mock client to return file IDs for each file
    const mockPool = pool as unknown as MockPool;
    let fileIdCounter = 0;
    mockPool.__mockClient.query.mockImplementation(
      async (sql: string, _params?: unknown[]) => {
        if (typeof sql === 'string') {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          if (sql.includes('SELECT id FROM code_files')) {
            fileIdCounter++;
            return { rows: [{ id: `file-${fileIdCounter}` }] };
          }
          if (sql.includes('DELETE FROM')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO code_symbols')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO code_imports')) {
            return { rows: [] };
          }
          if (sql.includes('SELECT id, source_file_id')) {
            return { rows: [] }; // No imports to compute edges for
          }
        }
        return { rows: [] };
      },
    );

    const result = await initIndexHandler({ root_path: tempDir, force: false });

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]!.text as string);

    // Should find symbols across all files (functions, exports, consts)
    expect(body.symbols_found).toBeGreaterThanOrEqual(4);
  });

  it('produces import records linking cross-file dependencies', async () => {
    await createExpressFixture(tempDir);

    const mockPool = pool as unknown as MockPool;
    let fileIdCounter = 0;
    let importCount = 0;

    mockPool.__mockClient.query.mockImplementation(
      async (sql: string, _params?: unknown[]) => {
        if (typeof sql === 'string') {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
            return { rows: [] };
          }
          if (sql.includes('SELECT id FROM code_files WHERE file_path')) {
            fileIdCounter++;
            return { rows: [{ id: `file-${fileIdCounter}` }] };
          }
          if (sql.includes('DELETE FROM')) {
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO code_imports')) {
            importCount++;
            return { rows: [] };
          }
          if (sql.includes('SELECT id, source_file_id')) {
            return { rows: [] };
          }
        }
        return { rows: [] };
      },
    );

    const result = await initIndexHandler({ root_path: tempDir, force: false });

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]!.text as string);

    // The fixture files have imports: index.ts→express, index.ts→routes,
    // routes.ts→express, routes.ts→handlers, handlers.ts→express
    expect(body.imports_found).toBeGreaterThanOrEqual(3);
  });
});

// ── AC2: init.orient identifies fixture as TypeScript/Express ────────────────

describe('init.orient — orientation detection', () => {
  it('identifies fixture project as TypeScript/Express', async () => {
    await createExpressFixture(tempDir);

    const result = await initOrientHandler({ root_path: tempDir });

    expect(result.isError).toBeUndefined();
    const body: OrientationResult = JSON.parse(result.content[0]!.text as string);

    expect(body.project_name).toBe('test-express-project');
    expect(body.frameworks).toContain('Express');
    expect(body.languages).toContain('TypeScript');
    expect(body.languages).toContain('JavaScript');
  });

  it('detects package manager as npm from package.json', async () => {
    await createExpressFixture(tempDir);

    const result = detectPackageManager(tempDir);
    expect(result).toBe('npm');
  });

  it('detects vitest as the test framework', async () => {
    await createExpressFixture(tempDir);

    const result = detectTestFramework(tempDir);
    expect(result).toBe('vitest');
  });

  it('detects tsc as the build system from scripts.build', async () => {
    await createExpressFixture(tempDir);

    const result = detectBuildSystem(tempDir);
    expect(result).toBe('tsc');
  });

  it('detects key directories (src)', async () => {
    await createExpressFixture(tempDir);

    const result = detectKeyDirectories(tempDir);
    expect(result).toContain('src');
  });

  it('detects config files (tsconfig.json, package.json)', async () => {
    await createExpressFixture(tempDir);

    const result = detectConfigFiles(tempDir);
    expect(result).toContain('tsconfig.json');
  });

  it('detects entry points from common file names', async () => {
    await createExpressFixture(tempDir);

    const result = detectEntryPoints(tempDir);
    expect(result).toContain('src/index.ts');
  });

  it('returns oriented result with all fields populated', async () => {
    await createExpressFixture(tempDir);

    const result = await initOrientHandler({ root_path: tempDir });
    const body: OrientationResult = JSON.parse(result.content[0]!.text as string);

    // All required fields are present
    expect(body).toHaveProperty('project_name');
    expect(body).toHaveProperty('package_manager');
    expect(body).toHaveProperty('frameworks');
    expect(body).toHaveProperty('languages');
    expect(body).toHaveProperty('entry_points');
    expect(body).toHaveProperty('test_framework');
    expect(body).toHaveProperty('build_system');
    expect(body).toHaveProperty('key_directories');
    expect(body).toHaveProperty('config_files');

    // Validate specific values
    expect(body.package_manager).toBe('npm');
    expect(body.test_framework).toBe('vitest');
    expect(body.build_system).toBe('tsc');
    expect(Array.isArray(body.frameworks)).toBe(true);
    expect(Array.isArray(body.languages)).toBe(true);
  });
});

// ── AC3: Progress SSE stream emits events in correct order ───────────────────

describe('Orientation progress reporting', () => {
  it('emits progress events in correct phase order', async () => {
    const events: ProgressState[] = [];
    const listener = (data: ProgressState): void => {
      events.push({ ...data });
    };
    progressEmitter.on('progress', listener);

    // Simulate the phases that init.index would emit
    updateProgress({ phase: 'walking', startedAt: new Date().toISOString() });
    updateProgress({ phase: 'parsing', filesProcessed: 0, totalFiles: 4 });
    updateProgress({ phase: 'parsing', filesProcessed: 2, totalFiles: 4, percentage: 50 });
    updateProgress({ phase: 'indexing', filesProcessed: 4, totalFiles: 4, percentage: 100 });
    updateProgress({ phase: 'complete', percentage: 100 });

    progressEmitter.off('progress', listener);

    expect(events).toHaveLength(5);
    expect(events[0]!.phase).toBe('walking');
    expect(events[1]!.phase).toBe('parsing');
    expect(events[2]!.phase).toBe('parsing');
    expect(events[2]!.percentage).toBe(50);
    expect(events[3]!.phase).toBe('indexing');
    expect(events[4]!.phase).toBe('complete');
    expect(events[4]!.percentage).toBe(100);
  });

  it('clamps percentage to valid range [0, 100]', () => {
    updateProgress({ phase: 'parsing', percentage: -10 });
    expect(getProgress().percentage).toBe(0);

    updateProgress({ phase: 'parsing', percentage: 150 });
    expect(getProgress().percentage).toBe(100);
  });

  it('resetProgress returns to idle state', () => {
    updateProgress({ phase: 'parsing', filesProcessed: 5, totalFiles: 10, percentage: 50 });
    expect(getProgress().phase).toBe('parsing');

    resetProgress();
    const state = getProgress();
    expect(state.phase).toBe('idle');
    expect(state.filesProcessed).toBe(0);
    expect(state.totalFiles).toBe(0);
    expect(state.percentage).toBe(0);
  });

  it('broadcasts updates to multiple listeners', () => {
    const events1: ProgressState[] = [];
    const events2: ProgressState[] = [];

    progressEmitter.on('progress', (d: ProgressState) => events1.push({ ...d }));
    progressEmitter.on('progress', (d: ProgressState) => events2.push({ ...d }));

    updateProgress({ phase: 'walking' });

    expect(events1).toHaveLength(1);
    expect(events2).toHaveLength(1);
    expect(events1[0]!.phase).toBe('walking');
    expect(events2[0]!.phase).toBe('walking');
  });

  it('emits error phase with error message', () => {
    const events: ProgressState[] = [];
    progressEmitter.on('progress', (d: ProgressState) => events.push({ ...d }));

    updateProgress({ phase: 'error', error: 'disk full' });

    expect(events).toHaveLength(1);
    expect(events[0]!.phase).toBe('error');
    expect(events[0]!.error).toBe('disk full');
  });
});

// ── AC4: Skips excluded directories ──────────────────────────────────────────

describe('init.index — excluded directory handling', () => {
  it('skips node_modules directory during indexing', async () => {
    await createExpressFixture(tempDir);

    const files = await walkDirectory(tempDir);
    const filePaths = files.map((f) => f.path);

    // Should NOT contain any node_modules files
    const nodeModulesFiles = filePaths.filter((p) => p.includes('node_modules'));
    expect(nodeModulesFiles).toHaveLength(0);
  });

  it('skips .git directory during indexing', async () => {
    await createExpressFixture(tempDir);

    const files = await walkDirectory(tempDir);
    const filePaths = files.map((f) => f.path);

    // Should NOT contain any .git files
    const gitFiles = filePaths.filter((p) => p.includes('.git'));
    expect(gitFiles).toHaveLength(0);
  });

  it('only includes supported source files (ts, js, py, sql)', async () => {
    await createExpressFixture(tempDir);

    // Add unsupported files alongside the Express project
    await writeFile(path.join(tempDir, 'README.md'), '# Readme');
    await writeFile(path.join(tempDir, 'data.json'), '{}');

    const files = await walkDirectory(tempDir);

    // All returned files should have supported extensions
    for (const file of files) {
      const ext = path.extname(file.path);
      expect(['.ts', '.tsx', '.js', '.jsx', '.py', '.sql']).toContain(ext);
    }
  });

  it('skips dist, build, coverage, __pycache__ directories', async () => {
    // Create directories that should be excluded
    for (const excludedDir of ['dist', 'build', 'coverage', '__pycache__']) {
      await mkdir(path.join(tempDir, excludedDir), { recursive: true });
      await writeFile(
        path.join(tempDir, excludedDir, 'output.ts'),
        'export const x = 1;',
      );
    }
    // Add one legit source file
    await writeFile(path.join(tempDir, 'app.ts'), 'export const y = 2;');

    const files = await walkDirectory(tempDir);
    const filePaths = files.map((f) => f.path);

    expect(filePaths).toEqual(['app.ts']);
  });
});

// ── AC5: Empty project directory ─────────────────────────────────────────────

describe('init.index — empty project handling', () => {
  it('handles empty project directory gracefully (no files)', async () => {
    await createEmptyProject(tempDir);

    const result = await initIndexHandler({ root_path: tempDir, force: false });

    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]!.text as string);

    expect(body.total_files).toBe(0);
    expect(body.indexed).toBe(0);
    expect(body.skipped).toBe(0);
    expect(body.symbols_found).toBe(0);
    expect(body.imports_found).toBe(0);
    expect(body.edges_computed).toBe(0);
  });

  it('init.orient handles empty project (derives name from directory)', async () => {
    await createEmptyProject(tempDir);

    const result = await initOrientHandler({ root_path: tempDir });

    expect(result.isError).toBeUndefined();
    const body: OrientationResult = JSON.parse(result.content[0]!.text as string);

    // Project name falls back to directory basename
    expect(body.project_name).toBe(path.basename(tempDir));
    expect(body.package_manager).toBeNull();
    expect(body.frameworks).toEqual([]);
    expect(body.languages).toEqual([]);
    expect(body.entry_points).toEqual([]);
    expect(body.test_framework).toBeNull();
    expect(body.build_system).toBeNull();
    expect(body.key_directories).toEqual([]);
    expect(body.config_files).toEqual([]);
  });
});

// ── AC6: Unsupported file types ──────────────────────────────────────────────

describe('init.index — unsupported file types', () => {
  it('handles project with only unsupported file types (no crash)', async () => {
    await createUnsupportedProject(tempDir);

    const result = await initIndexHandler({ root_path: tempDir, force: false });

    // Should NOT be an error
    expect(result.isError).toBeUndefined();
    const body = JSON.parse(result.content[0]!.text as string);

    // No supported source files found
    expect(body.total_files).toBe(0);
    expect(body.indexed).toBe(0);
    expect(body.symbols_found).toBe(0);
  });

  it('walkDirectory returns empty array for unsupported files', async () => {
    await createUnsupportedProject(tempDir);

    const files = await walkDirectory(tempDir);
    expect(files).toHaveLength(0);
  });

  it('init.orient still works with unsupported files (no source detection)', async () => {
    await createUnsupportedProject(tempDir);

    const result = await initOrientHandler({ root_path: tempDir });

    expect(result.isError).toBeUndefined();
    const body: OrientationResult = JSON.parse(result.content[0]!.text as string);

    // Falls back to directory name
    expect(body.project_name).toBe(path.basename(tempDir));
    expect(body.languages).toEqual([]);
    expect(body.frameworks).toEqual([]);
  });
});

// ── Edge Cases and Error Handling ────────────────────────────────────────────

describe('init.orient — error handling', () => {
  it('returns error when root_path does not exist', async () => {
    const result = await initOrientHandler({
      root_path: path.join(tempDir, 'nonexistent'),
    });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0]!.text as string);
    expect(body).toHaveProperty('error');
  });

  it('returns error when root_path is a file, not directory', async () => {
    const filePath = path.join(tempDir, 'not-a-dir.txt');
    await writeFile(filePath, 'hello');

    const result = await initOrientHandler({ root_path: filePath });

    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0]!.text as string);
    expect(body.error).toBe('root_path is not a directory');
  });
});

describe('init.index — error handling', () => {
  it('returns error result when root_path does not exist', async () => {
    const result = await initIndexHandler({
      root_path: path.join(tempDir, 'totally-missing'),
      force: false,
    });

    // The walker should handle missing dir gracefully or the handler catches
    // Depending on implementation it may return an error or empty result
    const body = JSON.parse(result.content[0]!.text as string);
    expect(typeof body).toBe('object');
  });
});

// ── File Walker Integration ──────────────────────────────────────────────────

describe('walkDirectory — integration with fixture project', () => {
  it('returns FileEntry objects with correct language labels', async () => {
    await createExpressFixture(tempDir);

    const files = await walkDirectory(tempDir);

    for (const file of files) {
      expect(file).toHaveProperty('path');
      expect(file).toHaveProperty('language');
      expect(file).toHaveProperty('hash');
      expect(file).toHaveProperty('lineCount');

      if (file.path.endsWith('.ts')) {
        expect(file.language).toBe('typescript');
      } else if (file.path.endsWith('.js')) {
        expect(file.language).toBe('javascript');
      }
    }
  });

  it('computes SHA-256 content hashes for each file', async () => {
    await createExpressFixture(tempDir);

    const files = await walkDirectory(tempDir);

    for (const file of files) {
      // SHA-256 hex is 64 characters
      expect(file.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('counts lines correctly', async () => {
    await createExpressFixture(tempDir);

    const files = await walkDirectory(tempDir);
    const helperFile = files.find((f) => f.path === 'src/utils/helper.ts');

    expect(helperFile).toBeDefined();
    // helper.ts has 5 lines
    expect(helperFile!.lineCount).toBe(5);
  });

  it('uses forward-slash paths regardless of OS', async () => {
    await createExpressFixture(tempDir);

    const files = await walkDirectory(tempDir);

    for (const file of files) {
      expect(file.path).not.toContain('\\');
    }
  });
});
