/**
 * Integration Tests — Code Graph Indexer Pipeline
 *
 * Tests the full indexing pipeline end-to-end:
 *   file walker discovers files → parsers extract symbols and imports →
 *   indexer service upserts into database.
 *
 * Uses temporary fixture directories with known structures and a mocked
 * database pool to verify that all three pipeline stages integrate
 * correctly. Covers TypeScript projects, Python projects, incremental
 * indexing, and change detection.
 *
 * @module __tests__/integration/indexer
 * @ticket TASK-INT-BE027
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IndexerService, type IndexResult } from '../../services/indexer/indexer-service.js';
import { walkDirectory, type FileEntry } from '../../services/indexer/file-walker.js';
import { parseTypeScript } from '../../services/parsers/typescript-parser.js';
import { parsePython } from '../../services/parsers/python-parser.js';
import type {
  CodeSymbol as TsCodeSymbol,
  CodeImport as TsCodeImport,
  ParseResult as TsParseResult,
} from '../../services/parsers/typescript-parser.js';
import type {
  CodeSymbol as PyCodeSymbol,
  CodeImport as PyCodeImport,
  ParseResult as PyParseResult,
} from '../../services/parsers/python-parser.js';

// ── Fixture Data ─────────────────────────────────────────────────────────────

/**
 * Fixture: multi-file TypeScript project with cross-file imports.
 */
const TS_FIXTURES: Record<string, string> = {
  'src/index.ts': [
    "import { helper } from './utils/helper';",
    "import { Calculator } from './math/calculator';",
    '',
    'export function main(): void {',
    '  const result = helper();',
    '  const calc = new Calculator();',
    '  console.log(result, calc.add(1, 2));',
    '}',
  ].join('\n'),

  'src/utils/helper.ts': [
    'export function helper(): number {',
    '  return 42;',
    '}',
    '',
    'export function format(value: number): string {',
    '  return String(value);',
    '}',
  ].join('\n'),

  'src/math/calculator.ts': [
    "import { format } from '../utils/helper';",
    '',
    'export class Calculator {',
    '  add(a: number, b: number): number {',
    '    return a + b;',
    '  }',
    '',
    '  subtract(a: number, b: number): number {',
    '    return a - b;',
    '  }',
    '',
    '  display(value: number): string {',
    '    return format(value);',
    '  }',
    '}',
  ].join('\n'),
};

/**
 * Fixture: multi-file Python project with cross-file imports.
 */
const PY_FIXTURES: Record<string, string> = {
  'app/main.py': [
    'from app.services.user_service import UserService',
    'from app.models.user import User',
    '',
    'def create_app():',
    '    service = UserService()',
    '    return service',
    '',
    'def run():',
    '    app = create_app()',
    '    app.get_user("admin")',
  ].join('\n'),

  'app/models/user.py': [
    'class User:',
    '    def __init__(self, name: str, email: str):',
    '        self.name = name',
    '        self.email = email',
    '',
    '    def display_name(self) -> str:',
    '        return f"{self.name} <{self.email}>"',
  ].join('\n'),

  'app/services/user_service.py': [
    'from app.models.user import User',
    '',
    'class UserService:',
    '    def __init__(self):',
    '        self._users: list = []',
    '',
    '    def add_user(self, name: str, email: str) -> User:',
    '        user = User(name, email)',
    '        self._users.append(user)',
    '        return user',
    '',
    '    def get_user(self, name: str) -> User:',
    '        for u in self._users:',
    '            if u.name == name:',
    '                return u',
    '        raise ValueError(f"User {name} not found")',
  ].join('\n'),
};

// ── Test Helpers ─────────────────────────────────────────────────────────────

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'idx-integ-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

/** Write all entries from a fixture map into the temp directory. */
async function writeFixtures(fixtures: Record<string, string>): Promise<void> {
  for (const [relativePath, content] of Object.entries(fixtures)) {
    const fullPath = path.join(tempDir, relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, content, 'utf-8');
  }
}

/** Compute SHA-256 hex digest for a string. */
function sha256(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
}

// ── Mock Pool ────────────────────────────────────────────────────────────────

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  _client: MockClient;
}

function createMockPool(
  existingFiles: Array<{ file_path: string; content_hash: string }> = [],
): MockPool {
  const client: MockClient = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };

  const pool: MockPool = {
    query: vi.fn().mockResolvedValue({ rows: existingFiles }),
    connect: vi.fn().mockResolvedValue(client),
    _client: client,
  };

  return pool;
}

/** Extract all INSERT/DELETE SQL calls from the mock client's history. */
function getClientQueries(pool: MockPool): Array<{ sql: string; params: unknown[] }> {
  return pool._client.query.mock.calls
    .filter((c: unknown[]) => typeof c[0] === 'string' && c[0] !== 'BEGIN' && c[0] !== 'COMMIT' && c[0] !== 'ROLLBACK')
    .map((c: unknown[]) => ({ sql: c[0] as string, params: (c[1] ?? []) as unknown[] }));
}

// ── Full Pipeline Helper ─────────────────────────────────────────────────────

interface PipelineResult {
  indexResult: IndexResult;
  walkedFiles: FileEntry[];
  parsedSymbols: Array<{ filePath: string; symbols: Array<TsCodeSymbol | PyCodeSymbol> }>;
  parsedImports: Array<{ filePath: string; imports: Array<TsCodeImport | PyCodeImport> }>;
}

/**
 * Run the full indexing pipeline: walk → index → parse changed files.
 * This simulates the production pipeline that would be assembled by an
 * orchestrating service.
 */
async function runFullPipeline(
  rootPath: string,
  pool: MockPool,
  fileContents: Record<string, string>,
): Promise<PipelineResult> {
  // Stage 1: Walk the file system
  const walkedFiles = await walkDirectory(rootPath);

  // Stage 2: Index changed files via the IndexerService
  const service = new IndexerService(pool as unknown as import('pg').Pool);
  const indexResult = await service.indexWorkspace(rootPath);

  // Stage 3: Parse changed files for symbols and imports
  const parsedSymbols: PipelineResult['parsedSymbols'] = [];
  const parsedImports: PipelineResult['parsedImports'] = [];

  for (const changedFile of indexResult.changedFiles) {
    const content = fileContents[changedFile.path];
    if (!content) continue;

    if (changedFile.language === 'typescript' || changedFile.language === 'javascript') {
      const parseResult: TsParseResult = await parseTypeScript(content, changedFile.path);
      parsedSymbols.push({ filePath: changedFile.path, symbols: parseResult.symbols });
      parsedImports.push({ filePath: changedFile.path, imports: parseResult.imports });
    } else if (changedFile.language === 'python') {
      const parseResult: PyParseResult = await parsePython(content);
      parsedSymbols.push({ filePath: changedFile.path, symbols: parseResult.symbols });
      parsedImports.push({ filePath: changedFile.path, imports: parseResult.imports });
    }
  }

  return { indexResult, walkedFiles, parsedSymbols, parsedImports };
}

// ── Integration Tests ────────────────────────────────────────────────────────

describe('Code Graph Indexer — Integration', () => {
  // ── AC1: Full indexing of a fixture TypeScript project ─────────────────

  describe('TypeScript project indexing', () => {
    it('walks, indexes, and parses a multi-file TypeScript project', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, TS_FIXTURES);

      // Walker found all 3 TS files
      expect(result.walkedFiles).toHaveLength(3);
      const walkedPaths = result.walkedFiles.map((f) => f.path).sort();
      expect(walkedPaths).toEqual([
        'src/index.ts',
        'src/math/calculator.ts',
        'src/utils/helper.ts',
      ]);

      // Indexer reports 3 changed files (all new)
      expect(result.indexResult.total).toBe(3);
      expect(result.indexResult.changed).toBe(3);
      expect(result.indexResult.unchanged).toBe(0);

      // All 3 files were parsed
      expect(result.parsedSymbols).toHaveLength(3);
      expect(result.parsedImports).toHaveLength(3);
    });

    it('extracts expected symbols from all TypeScript fixture files', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, TS_FIXTURES);

      // src/index.ts — exported function `main`
      const indexSymbols = result.parsedSymbols.find(
        (p) => p.filePath === 'src/index.ts',
      );
      expect(indexSymbols).toBeDefined();
      const mainFn = (indexSymbols!.symbols as TsCodeSymbol[]).find(
        (s) => s.name === 'main',
      );
      expect(mainFn).toBeDefined();
      expect(mainFn!.kind).toBe('function');
      expect(mainFn!.exported).toBe(true);

      // src/utils/helper.ts — two exported functions
      const helperSymbols = result.parsedSymbols.find(
        (p) => p.filePath === 'src/utils/helper.ts',
      );
      expect(helperSymbols).toBeDefined();
      const helperNames = (helperSymbols!.symbols as TsCodeSymbol[]).map((s) => s.name);
      expect(helperNames).toContain('helper');
      expect(helperNames).toContain('format');

      // src/math/calculator.ts — class with methods
      const calcSymbols = result.parsedSymbols.find(
        (p) => p.filePath === 'src/math/calculator.ts',
      );
      expect(calcSymbols).toBeDefined();
      const calcNames = (calcSymbols!.symbols as TsCodeSymbol[]).map((s) => s.name);
      expect(calcNames).toContain('Calculator');
      expect(calcNames).toContain('add');
      expect(calcNames).toContain('subtract');
      expect(calcNames).toContain('display');

      // Calculator class is exported
      const calcClass = (calcSymbols!.symbols as TsCodeSymbol[]).find(
        (s) => s.name === 'Calculator',
      );
      expect(calcClass!.kind).toBe('class');
      expect(calcClass!.exported).toBe(true);

      // Methods have qualified names
      const addMethod = (calcSymbols!.symbols as TsCodeSymbol[]).find(
        (s) => s.name === 'add',
      );
      expect(addMethod!.qualifiedName).toBe('Calculator.add');
      expect(addMethod!.kind).toBe('method');
    });

    it('extracts expected imports from TypeScript fixture files', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, TS_FIXTURES);

      // src/index.ts imports from ./utils/helper and ./math/calculator
      const indexImports = result.parsedImports.find(
        (p) => p.filePath === 'src/index.ts',
      );
      expect(indexImports).toBeDefined();
      const importPaths = (indexImports!.imports as TsCodeImport[]).map(
        (i) => i.targetPath,
      );
      expect(importPaths).toContain('./utils/helper');
      expect(importPaths).toContain('./math/calculator');

      // Verify named import specifiers
      const helperImport = (indexImports!.imports as TsCodeImport[]).find(
        (i) => i.targetPath === './utils/helper',
      );
      expect(helperImport).toBeDefined();
      expect(helperImport!.importNames).toContain('helper');
      expect(helperImport!.isDefaultImport).toBe(false);

      // src/math/calculator.ts imports from ../utils/helper
      const calcImports = result.parsedImports.find(
        (p) => p.filePath === 'src/math/calculator.ts',
      );
      expect(calcImports).toBeDefined();
      const calcImportPaths = (calcImports!.imports as TsCodeImport[]).map(
        (i) => i.targetPath,
      );
      expect(calcImportPaths).toContain('../utils/helper');

      // src/utils/helper.ts has no imports
      const helperImports = result.parsedImports.find(
        (p) => p.filePath === 'src/utils/helper.ts',
      );
      expect(helperImports).toBeDefined();
      expect(helperImports!.imports).toHaveLength(0);
    });
  });

  // ── AC2: Full indexing of a fixture Python project ─────────────────────

  describe('Python project indexing', () => {
    it('walks, indexes, and parses a multi-file Python project', async () => {
      await writeFixtures(PY_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, PY_FIXTURES);

      // Walker found all 3 Python files
      expect(result.walkedFiles).toHaveLength(3);
      const walkedPaths = result.walkedFiles.map((f) => f.path).sort();
      expect(walkedPaths).toEqual([
        'app/main.py',
        'app/models/user.py',
        'app/services/user_service.py',
      ]);

      // Indexer reports 3 changed files (all new)
      expect(result.indexResult.total).toBe(3);
      expect(result.indexResult.changed).toBe(3);

      // All 3 files were parsed
      expect(result.parsedSymbols).toHaveLength(3);
    });

    it('extracts expected symbols from Python fixture files', async () => {
      await writeFixtures(PY_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, PY_FIXTURES);

      // app/main.py — two top-level functions
      const mainSymbols = result.parsedSymbols.find(
        (p) => p.filePath === 'app/main.py',
      );
      expect(mainSymbols).toBeDefined();
      const mainNames = (mainSymbols!.symbols as PyCodeSymbol[]).map((s) => s.name);
      expect(mainNames).toContain('create_app');
      expect(mainNames).toContain('run');

      // Verify function kind
      const createAppFn = (mainSymbols!.symbols as PyCodeSymbol[]).find(
        (s) => s.name === 'create_app',
      );
      expect(createAppFn!.kind).toBe('function');

      // app/models/user.py — class User with methods
      const userSymbols = result.parsedSymbols.find(
        (p) => p.filePath === 'app/models/user.py',
      );
      expect(userSymbols).toBeDefined();
      const userClass = (userSymbols!.symbols as PyCodeSymbol[]).find(
        (s) => s.name === 'User',
      );
      expect(userClass).toBeDefined();
      expect(userClass!.kind).toBe('class');
      expect(userClass!.children).toBeDefined();
      expect(userClass!.children.length).toBeGreaterThanOrEqual(2);
      const userMethodNames = userClass!.children.map((c) => c.name);
      expect(userMethodNames).toContain('__init__');
      expect(userMethodNames).toContain('display_name');

      // app/services/user_service.py — class UserService with methods
      const svcSymbols = result.parsedSymbols.find(
        (p) => p.filePath === 'app/services/user_service.py',
      );
      expect(svcSymbols).toBeDefined();
      const svcClass = (svcSymbols!.symbols as PyCodeSymbol[]).find(
        (s) => s.name === 'UserService',
      );
      expect(svcClass).toBeDefined();
      expect(svcClass!.kind).toBe('class');
      const svcMethodNames = svcClass!.children.map((c) => c.name);
      expect(svcMethodNames).toContain('__init__');
      expect(svcMethodNames).toContain('add_user');
      expect(svcMethodNames).toContain('get_user');

      // Methods have qualified names
      const addUserMethod = svcClass!.children.find((c) => c.name === 'add_user');
      expect(addUserMethod!.qualified_name).toBe('UserService.add_user');
      expect(addUserMethod!.kind).toBe('method');
    });

    it('extracts expected imports from Python fixture files', async () => {
      await writeFixtures(PY_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, PY_FIXTURES);

      // app/main.py imports from app.services.user_service and app.models.user
      const mainImports = result.parsedImports.find(
        (p) => p.filePath === 'app/main.py',
      );
      expect(mainImports).toBeDefined();
      const mainSources = (mainImports!.imports as PyCodeImport[]).map(
        (i) => i.source_path,
      );
      expect(mainSources).toContain('app.services.user_service');
      expect(mainSources).toContain('app.models.user');

      // Verify named import
      const userServiceImport = (mainImports!.imports as PyCodeImport[]).find(
        (i) => i.source_path === 'app.services.user_service',
      );
      expect(userServiceImport).toBeDefined();
      expect(userServiceImport!.imported_name).toBe('UserService');
      expect(userServiceImport!.is_namespace).toBe(false);

      // app/services/user_service.py imports from app.models.user
      const svcImports = result.parsedImports.find(
        (p) => p.filePath === 'app/services/user_service.py',
      );
      expect(svcImports).toBeDefined();
      const svcImportUser = (svcImports!.imports as PyCodeImport[]).find(
        (i) => i.imported_name === 'User',
      );
      expect(svcImportUser).toBeDefined();
      expect(svcImportUser!.source_path).toBe('app.models.user');

      // app/models/user.py has no imports
      const userImports = result.parsedImports.find(
        (p) => p.filePath === 'app/models/user.py',
      );
      expect(userImports).toBeDefined();
      expect(userImports!.imports).toHaveLength(0);
    });
  });

  // ── AC3: code_files table populated correctly ──────────────────────────

  describe('code_files table verification', () => {
    it('upserts each file with correct path, hash, language, and line count', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      await service.indexWorkspace(tempDir);

      const queries = getClientQueries(pool);
      const inserts = queries.filter((q) => q.sql.includes('INSERT INTO code_files'));

      // All 3 fixture files inserted
      expect(inserts).toHaveLength(3);

      // Verify each file's parameters
      const insertedFiles = inserts.map((q) => ({
        path: q.params[0] as string,
        language: q.params[1] as string,
        hash: q.params[2] as string,
        lineCount: q.params[3] as number,
      }));

      // src/index.ts
      const indexFile = insertedFiles.find((f) => f.path === 'src/index.ts');
      expect(indexFile).toBeDefined();
      expect(indexFile!.language).toBe('typescript');
      expect(indexFile!.hash).toBe(sha256(TS_FIXTURES['src/index.ts']!));
      expect(indexFile!.lineCount).toBeGreaterThan(0);

      // src/utils/helper.ts
      const helperFile = insertedFiles.find((f) => f.path === 'src/utils/helper.ts');
      expect(helperFile).toBeDefined();
      expect(helperFile!.language).toBe('typescript');
      expect(helperFile!.hash).toBe(sha256(TS_FIXTURES['src/utils/helper.ts']!));

      // src/math/calculator.ts
      const calcFile = insertedFiles.find((f) => f.path === 'src/math/calculator.ts');
      expect(calcFile).toBeDefined();
      expect(calcFile!.language).toBe('typescript');
      expect(calcFile!.hash).toBe(sha256(TS_FIXTURES['src/math/calculator.ts']!));
    });

    it('upserts Python files with correct language and metadata', async () => {
      await writeFixtures(PY_FIXTURES);
      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      await service.indexWorkspace(tempDir);

      const queries = getClientQueries(pool);
      const inserts = queries.filter((q) => q.sql.includes('INSERT INTO code_files'));

      expect(inserts).toHaveLength(3);

      const insertedFiles = inserts.map((q) => ({
        path: q.params[0] as string,
        language: q.params[1] as string,
        hash: q.params[2] as string,
        lineCount: q.params[3] as number,
      }));

      // All Python files detected as 'python'
      for (const file of insertedFiles) {
        expect(file.language).toBe('python');
      }

      // Verify hashes match fixture content
      const mainFile = insertedFiles.find((f) => f.path === 'app/main.py');
      expect(mainFile).toBeDefined();
      expect(mainFile!.hash).toBe(sha256(PY_FIXTURES['app/main.py']!));
    });

    it('wraps all upserts in a database transaction', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      await service.indexWorkspace(tempDir);

      expect(pool.connect).toHaveBeenCalledOnce();
      const allCalls = pool._client.query.mock.calls.map(
        (c: unknown[]) => c[0] as string,
      );
      expect(allCalls[0]).toBe('BEGIN');
      expect(allCalls[allCalls.length - 1]).toBe('COMMIT');
      expect(pool._client.release).toHaveBeenCalledOnce();
    });
  });

  // ── AC4: code_symbols table populated ──────────────────────────────────

  describe('code_symbols verification', () => {
    it('parser extracts functions, classes, and methods from changed TS files', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, TS_FIXTURES);

      // Aggregate all TS symbols across files
      const allSymbols = result.parsedSymbols.flatMap(
        (p) => p.symbols as TsCodeSymbol[],
      );

      // Must have functions, classes, and methods
      const kinds = new Set(allSymbols.map((s) => s.kind));
      expect(kinds).toContain('function');
      expect(kinds).toContain('class');
      expect(kinds).toContain('method');

      // Total symbol count: main(1) + helper(2) + Calculator(1) + methods(3) = 7
      expect(allSymbols.length).toBeGreaterThanOrEqual(7);

      // Each symbol has required fields for code_symbols table
      for (const sym of allSymbols) {
        expect(sym.name).toBeTruthy();
        expect(sym.qualifiedName).toBeTruthy();
        expect(sym.kind).toBeTruthy();
        expect(sym.startLine).toBeGreaterThan(0);
        expect(sym.endLine).toBeGreaterThanOrEqual(sym.startLine);
        expect(typeof sym.exported).toBe('boolean');
      }
    });

    it('parser extracts classes with nested methods from Python files', async () => {
      await writeFixtures(PY_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, PY_FIXTURES);

      const allSymbols = result.parsedSymbols.flatMap(
        (p) => p.symbols as PyCodeSymbol[],
      );

      // Top-level: create_app, run, User, UserService = 4
      expect(allSymbols.length).toBeGreaterThanOrEqual(4);

      const classes = allSymbols.filter((s) => s.kind === 'class');
      expect(classes).toHaveLength(2); // User, UserService

      // Verify child methods exist on classes
      const totalMethods = classes.reduce(
        (sum, cls) => sum + cls.children.filter((c) => c.kind === 'method').length,
        0,
      );
      // User: __init__, display_name (2) + UserService: __init__, add_user, get_user (3) = 5
      expect(totalMethods).toBeGreaterThanOrEqual(5);

      // Each symbol has required fields for code_symbols table
      for (const sym of allSymbols) {
        expect(sym.name).toBeTruthy();
        expect(sym.qualified_name).toBeTruthy();
        expect(sym.kind).toBeTruthy();
        expect(sym.start_line).toBeGreaterThan(0);
        expect(sym.end_line).toBeGreaterThanOrEqual(sym.start_line);
      }
    });
  });

  // ── AC5: code_imports table populated ──────────────────────────────────

  describe('code_imports verification', () => {
    it('captures all TypeScript import relationships', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, TS_FIXTURES);

      const allImports = result.parsedImports.flatMap(
        (p) => p.imports as TsCodeImport[],
      );

      // index.ts has 2 imports, calculator.ts has 1, helper.ts has 0 = 3
      expect(allImports).toHaveLength(3);

      // Verify import structure conforms to code_imports schema
      for (const imp of allImports) {
        expect(imp.targetPath).toBeTruthy();
        expect(Array.isArray(imp.importNames)).toBe(true);
        expect(typeof imp.isDefaultImport).toBe('boolean');
      }

      // Verify specific import relationships
      const helperImport = allImports.find(
        (i) => i.targetPath === './utils/helper',
      );
      expect(helperImport).toBeDefined();
      expect(helperImport!.importNames).toContain('helper');

      const calcImport = allImports.find(
        (i) => i.targetPath === './math/calculator',
      );
      expect(calcImport).toBeDefined();
      expect(calcImport!.importNames).toContain('Calculator');
    });

    it('captures all Python import relationships', async () => {
      await writeFixtures(PY_FIXTURES);
      const pool = createMockPool([]);

      const result = await runFullPipeline(tempDir, pool, PY_FIXTURES);

      const allImports = result.parsedImports.flatMap(
        (p) => p.imports as PyCodeImport[],
      );

      // main.py has 2 imports, user_service.py has 1, user.py has 0 = 3
      expect(allImports).toHaveLength(3);

      // Verify import structure conforms to code_imports schema
      for (const imp of allImports) {
        expect(imp.source_path).toBeTruthy();
        expect(typeof imp.is_default).toBe('boolean');
        expect(typeof imp.is_namespace).toBe('boolean');
      }

      // Verify specific import relationships
      const userImport = allImports.find(
        (i) => i.source_path === 'app.models.user' && i.imported_name === 'User',
      );
      expect(userImport).toBeDefined();
    });
  });

  // ── AC6: Incremental indexing ──────────────────────────────────────────

  describe('incremental indexing', () => {
    it('second run with unchanged files reports 0 changes', async () => {
      await writeFixtures(TS_FIXTURES);

      // Build existing file hashes matching the fixture content
      const existingHashes = Object.entries(TS_FIXTURES).map(([filePath, content]) => ({
        file_path: filePath,
        content_hash: sha256(content),
      }));

      const pool = createMockPool(existingHashes);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(3);
      expect(result.changed).toBe(0);
      expect(result.unchanged).toBe(3);
      expect(result.removed).toBe(0);
      expect(result.changedFiles).toHaveLength(0);

      // No transaction opened for zero-change scenario
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('modifying one file results in only that file being re-indexed', async () => {
      const modifiedHelper = [
        'export function helper(): number {',
        '  return 99; // changed value',
        '}',
        '',
        'export function format(value: number): string {',
        '  return String(value);',
        '}',
      ].join('\n');

      // Write with one modified file
      const modifiedFixtures = { ...TS_FIXTURES, 'src/utils/helper.ts': modifiedHelper };
      await writeFixtures(modifiedFixtures);

      // DB has old hashes for all 3 files
      const existingHashes = Object.entries(TS_FIXTURES).map(([filePath, content]) => ({
        file_path: filePath,
        content_hash: sha256(content),
      }));

      const pool = createMockPool(existingHashes);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      // Only helper.ts changed
      expect(result.total).toBe(3);
      expect(result.changed).toBe(1);
      expect(result.unchanged).toBe(2);
      expect(result.removed).toBe(0);
      expect(result.changedFiles).toHaveLength(1);
      expect(result.changedFiles[0]!.path).toBe('src/utils/helper.ts');
      expect(result.changedFiles[0]!.hash).toBe(sha256(modifiedHelper));
    });

    it('only re-parses the modified file', async () => {
      const modifiedCalc = [
        "import { format } from '../utils/helper';",
        '',
        'export class Calculator {',
        '  add(a: number, b: number): number {',
        '    return a + b;',
        '  }',
        '',
        '  multiply(a: number, b: number): number {',
        '    return a * b;',
        '  }',
        '}',
      ].join('\n');

      const modifiedFixtures = { ...TS_FIXTURES, 'src/math/calculator.ts': modifiedCalc };
      await writeFixtures(modifiedFixtures);

      // DB has old hashes (original content)
      const existingHashes = Object.entries(TS_FIXTURES).map(([filePath, content]) => ({
        file_path: filePath,
        content_hash: sha256(content),
      }));

      const pool = createMockPool(existingHashes);

      const result = await runFullPipeline(tempDir, pool, modifiedFixtures);

      // Only calculator.ts was changed and thus parsed
      expect(result.parsedSymbols).toHaveLength(1);
      expect(result.parsedSymbols[0]!.filePath).toBe('src/math/calculator.ts');

      // Verify the new symbols reflect the modified file (multiply instead of subtract/display)
      const symbols = result.parsedSymbols[0]!.symbols as TsCodeSymbol[];
      const symbolNames = symbols.map((s) => s.name);
      expect(symbolNames).toContain('Calculator');
      expect(symbolNames).toContain('add');
      expect(symbolNames).toContain('multiply');
      expect(symbolNames).not.toContain('subtract');
      expect(symbolNames).not.toContain('display');
    });

    it('detects file removal and cleans stale DB entries', async () => {
      // Only write 2 of 3 TS fixture files (simulating deletion of calculator.ts)
      const partialFixtures: Record<string, string> = {
        'src/index.ts': TS_FIXTURES['src/index.ts']!,
        'src/utils/helper.ts': TS_FIXTURES['src/utils/helper.ts']!,
      };
      await writeFixtures(partialFixtures);

      // DB has all 3 original files
      const existingHashes = Object.entries(TS_FIXTURES).map(([filePath, content]) => ({
        file_path: filePath,
        content_hash: sha256(content),
      }));

      const pool = createMockPool(existingHashes);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(2);
      expect(result.changed).toBe(0);
      expect(result.unchanged).toBe(2);
      expect(result.removed).toBe(1);

      // Verify DELETE was issued for the removed file
      const queries = getClientQueries(pool);
      const deletes = queries.filter((q) => q.sql.includes('DELETE FROM code_files'));
      expect(deletes).toHaveLength(1);
      expect(deletes[0]!.params[0]).toBe('src/math/calculator.ts');
    });

    it('adding a new file to an existing project indexes only the new file', async () => {
      const newFixture = "export const VERSION = '1.0.0';";
      const extendedFixtures = { ...TS_FIXTURES, 'src/version.ts': newFixture };
      await writeFixtures(extendedFixtures);

      // DB has the original 3 files
      const existingHashes = Object.entries(TS_FIXTURES).map(([filePath, content]) => ({
        file_path: filePath,
        content_hash: sha256(content),
      }));

      const pool = createMockPool(existingHashes);

      const result = await runFullPipeline(tempDir, pool, extendedFixtures);

      // Only the new file is changed
      expect(result.indexResult.changed).toBe(1);
      expect(result.indexResult.unchanged).toBe(3);
      expect(result.indexResult.removed).toBe(0);
      expect(result.indexResult.changedFiles[0]!.path).toBe('src/version.ts');

      // Only the new file is parsed
      expect(result.parsedSymbols).toHaveLength(1);
      expect(result.parsedSymbols[0]!.filePath).toBe('src/version.ts');
      const symbols = result.parsedSymbols[0]!.symbols as TsCodeSymbol[];
      expect(symbols.some((s) => s.name === 'VERSION')).toBe(true);
    });
  });

  // ── AC7: Mocked database pool ──────────────────────────────────────────

  describe('mock pool verification', () => {
    it('never connects to a real database', async () => {
      await writeFixtures(TS_FIXTURES);
      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      await service.indexWorkspace(tempDir);

      // pool.query was called for SELECT (hash lookup)
      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT file_path, content_hash FROM code_files'),
      );

      // pool.connect was used for the transaction client (mock)
      expect(pool.connect).toHaveBeenCalledOnce();
      expect(pool._client.release).toHaveBeenCalledOnce();
    });

    it('uses mock pool throughout the pipeline without errors', async () => {
      await writeFixtures({ ...TS_FIXTURES, ...PY_FIXTURES });

      const pool = createMockPool([]);
      const allFixtures = { ...TS_FIXTURES, ...PY_FIXTURES };

      const result = await runFullPipeline(tempDir, pool, allFixtures);

      // All 6 files indexed (3 TS + 3 PY)
      expect(result.indexResult.total).toBe(6);
      expect(result.indexResult.changed).toBe(6);

      // All 6 files parsed
      expect(result.parsedSymbols).toHaveLength(6);
      expect(result.parsedImports).toHaveLength(6);
    });
  });

  // ── Cross-language pipeline ────────────────────────────────────────────

  describe('mixed language project', () => {
    it('indexes and parses TS and Python files in the same workspace', async () => {
      await writeFixtures({ ...TS_FIXTURES, ...PY_FIXTURES });
      const pool = createMockPool([]);
      const allFixtures = { ...TS_FIXTURES, ...PY_FIXTURES };

      const result = await runFullPipeline(tempDir, pool, allFixtures);

      // Verify file languages are correct
      const tsFiles = result.walkedFiles.filter((f) => f.language === 'typescript');
      const pyFiles = result.walkedFiles.filter((f) => f.language === 'python');
      expect(tsFiles).toHaveLength(3);
      expect(pyFiles).toHaveLength(3);

      // Verify parser dispatching was correct (TS symbols use camelCase, PY use snake_case)
      const tsSymbolResult = result.parsedSymbols.find(
        (p) => p.filePath === 'src/index.ts',
      );
      expect(tsSymbolResult).toBeDefined();
      const tsSym = tsSymbolResult!.symbols[0] as TsCodeSymbol;
      expect('qualifiedName' in tsSym).toBe(true);

      const pySymbolResult = result.parsedSymbols.find(
        (p) => p.filePath === 'app/main.py',
      );
      expect(pySymbolResult).toBeDefined();
      const pySym = pySymbolResult!.symbols[0] as PyCodeSymbol;
      expect('qualified_name' in pySym).toBe(true);
    });
  });
});
