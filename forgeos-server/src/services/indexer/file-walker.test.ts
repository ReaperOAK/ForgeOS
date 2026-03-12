/**
 * Unit tests for the file-walker module.
 *
 * Uses a real temporary directory on disk to exercise the walker
 * against known file structures. Cleans up after each test.
 *
 * @ticket TASK-INT-BE021
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { walkDirectory, _internals } from './file-walker.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'fw-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Helper ───────────────────────────────────────────────────────────────────

async function createFile(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(tempDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

function expectedHash(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('file-walker', () => {
  describe('_internals.sha256', () => {
    it('computes correct SHA-256 hex digest', () => {
      const buf = Buffer.from('hello world', 'utf-8');
      const hash = _internals.sha256(buf);
      expect(hash).toBe(
        createHash('sha256').update(buf).digest('hex'),
      );
    });
  });

  describe('_internals.countLines', () => {
    it('returns 0 for empty buffer', () => {
      expect(_internals.countLines(Buffer.alloc(0))).toBe(0);
    });

    it('returns 1 for single line without trailing newline', () => {
      expect(_internals.countLines(Buffer.from('hello'))).toBe(1);
    });

    it('returns 2 for single newline', () => {
      expect(_internals.countLines(Buffer.from('a\nb'))).toBe(2);
    });

    it('counts trailing newline as extra line', () => {
      expect(_internals.countLines(Buffer.from('a\n'))).toBe(2);
    });

    it('handles multiple lines', () => {
      expect(_internals.countLines(Buffer.from('a\nb\nc\n'))).toBe(4);
    });
  });

  describe('walkDirectory', () => {
    it('discovers supported files in flat directory', async () => {
      await createFile('index.ts', 'const a = 1;');
      await createFile('utils.js', 'module.exports = {};');
      await createFile('README.md', '# Readme');

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(2);
      const paths = results.map((r) => r.path).sort();
      expect(paths).toEqual(['index.ts', 'utils.js']);
    });

    it('traverses nested directories', async () => {
      await createFile('src/services/foo.ts', 'export {};');
      await createFile('src/db/schema.sql', 'CREATE TABLE t (id INT);');
      await createFile('src/app.py', 'print("hi")');

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(3);
      const paths = results.map((r) => r.path).sort();
      expect(paths).toEqual([
        'src/app.py',
        'src/db/schema.sql',
        'src/services/foo.ts',
      ]);
    });

    it('skips node_modules directory', async () => {
      await createFile('src/index.ts', 'export {};');
      await createFile('node_modules/pkg/index.js', 'module.exports = {};');

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('src/index.ts');
    });

    it('skips .git directory', async () => {
      await createFile('app.ts', 'export {};');
      await createFile('.git/objects/ab', 'blob');

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('app.ts');
    });

    it('skips dist and build directories', async () => {
      await createFile('src/main.ts', 'console.log("ok");');
      await createFile('dist/main.js', 'console.log("ok");');
      await createFile('build/output.js', '...');

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('src/main.ts');
    });

    it('skips __pycache__ directory', async () => {
      await createFile('app.py', 'x = 1');
      await createFile('__pycache__/app.cpython-311.pyc', 'bytes');

      const results = await walkDirectory(tempDir);

      // .pyc is not a supported extension anyway, but __pycache__ is also skipped
      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('app.py');
    });

    it('respects custom ignoreDirs option', async () => {
      await createFile('src/index.ts', 'export {};');
      await createFile('vendor/lib.ts', 'export {};');

      const results = await walkDirectory(tempDir, { ignoreDirs: ['vendor'] });

      expect(results).toHaveLength(1);
      expect(results[0]!.path).toBe('src/index.ts');
    });

    it('filters by supported extensions only', async () => {
      await createFile('code.ts', 'export {};');
      await createFile('code.tsx', 'export {};');
      await createFile('code.js', 'module.exports = {};');
      await createFile('code.jsx', '<div />');
      await createFile('code.py', 'x = 1');
      await createFile('code.sql', 'SELECT 1;');
      await createFile('code.rs', 'fn main() {}');
      await createFile('code.go', 'package main');
      await createFile('code.json', '{}');
      await createFile('code.css', 'body {}');

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(6);
      const exts = results.map((r) => path.extname(r.path)).sort();
      expect(exts).toEqual(['.js', '.jsx', '.py', '.sql', '.ts', '.tsx']);
    });

    it('maps extensions to correct language identifiers', async () => {
      await createFile('a.ts', 'x');
      await createFile('b.tsx', 'x');
      await createFile('c.js', 'x');
      await createFile('d.jsx', 'x');
      await createFile('e.py', 'x');
      await createFile('f.sql', 'x');

      const results = await walkDirectory(tempDir);
      const langMap = new Map(results.map((r) => [path.extname(r.path), r.language]));

      expect(langMap.get('.ts')).toBe('typescript');
      expect(langMap.get('.tsx')).toBe('typescript');
      expect(langMap.get('.js')).toBe('javascript');
      expect(langMap.get('.jsx')).toBe('javascript');
      expect(langMap.get('.py')).toBe('python');
      expect(langMap.get('.sql')).toBe('sql');
    });

    it('computes correct SHA-256 hash', async () => {
      const content = 'export const greeting = "hello";';
      await createFile('hello.ts', content);

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(1);
      expect(results[0]!.hash).toBe(expectedHash(content));
    });

    it('computes correct line count', async () => {
      const content = 'line1\nline2\nline3';
      await createFile('lines.ts', content);

      const results = await walkDirectory(tempDir);

      expect(results).toHaveLength(1);
      expect(results[0]!.lineCount).toBe(3);
    });

    it('uses forward slashes in returned paths', async () => {
      await createFile('src/nested/deep/file.ts', 'x');

      const results = await walkDirectory(tempDir);

      expect(results[0]!.path).toBe('src/nested/deep/file.ts');
      expect(results[0]!.path).not.toContain('\\');
    });

    it('returns empty array for empty directory', async () => {
      const results = await walkDirectory(tempDir);
      expect(results).toEqual([]);
    });

    it('returns empty array for directory with only unsupported files', async () => {
      await createFile('readme.md', '# hi');
      await createFile('config.yaml', 'key: val');

      const results = await walkDirectory(tempDir);
      expect(results).toEqual([]);
    });

    it('handles extraExtensions option', async () => {
      await createFile('main.rs', 'fn main() {}');
      await createFile('app.ts', 'export {};');

      const results = await walkDirectory(tempDir, {
        extraExtensions: ['.rs'],
      });

      expect(results).toHaveLength(2);
      const paths = results.map((r) => r.path).sort();
      expect(paths).toEqual(['app.ts', 'main.rs']);
    });
  });
});
