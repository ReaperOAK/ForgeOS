/**
 * Unit tests for the IndexerService.
 *
 * Uses a mock pg Pool and a temporary directory to verify
 * change-detection logic, upsert behaviour, and stale-file removal.
 *
 * @ticket TASK-INT-BE021
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { IndexerService, type IndexResult } from './indexer-service.js';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), 'idx-test-'));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

// ── Mock Pool Factory ────────────────────────────────────────────────────────

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  _client: MockClient;
}

function createMockPool(existingFiles: Array<{ file_path: string; content_hash: string }> = []): MockPool {
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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function createFile(relativePath: string, content: string): Promise<void> {
  const fullPath = path.join(tempDir, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content, 'utf-8');
}

function hashOf(content: string): string {
  return createHash('sha256').update(Buffer.from(content, 'utf-8')).digest('hex');
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('IndexerService', () => {
  describe('indexWorkspace', () => {
    it('indexes new files into an empty database', async () => {
      await createFile('src/app.ts', 'const x = 1;');
      await createFile('src/utils.ts', 'export {};');

      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(2);
      expect(result.changed).toBe(2);
      expect(result.unchanged).toBe(0);
      expect(result.removed).toBe(0);
      expect(result.changedFiles).toHaveLength(2);
    });

    it('opens a database transaction for upserts', async () => {
      await createFile('app.ts', 'x');

      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      await service.indexWorkspace(tempDir);

      expect(pool.connect).toHaveBeenCalledOnce();
      const clientCalls = pool._client.query.mock.calls.map((c: unknown[]) => c[0]);
      expect(clientCalls[0]).toBe('BEGIN');
      expect(clientCalls[clientCalls.length - 1]).toBe('COMMIT');
      expect(pool._client.release).toHaveBeenCalledOnce();
    });

    it('performs upsert with correct parameters', async () => {
      const content = 'const greeting = "hello";';
      await createFile('hello.ts', content);

      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      await service.indexWorkspace(tempDir);

      // Find the INSERT call (not BEGIN or COMMIT)
      const insertCall = pool._client.query.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO code_files'),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      expect(params[0]).toBe('hello.ts');          // file_path
      expect(params[1]).toBe('typescript');         // language
      expect(params[2]).toBe(hashOf(content));      // content_hash
      expect(params[3]).toBeGreaterThan(0);         // line_count
    });

    it('skips unchanged files (hash matches)', async () => {
      const content = 'const x = 42;';
      await createFile('same.ts', content);

      const pool = createMockPool([
        { file_path: 'same.ts', content_hash: hashOf(content) },
      ]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(1);
      expect(result.changed).toBe(0);
      expect(result.unchanged).toBe(1);
      expect(result.changedFiles).toHaveLength(0);
      // No transaction should have been started
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('detects modified files (hash differs)', async () => {
      const oldContent = 'const x = 1;';
      const newContent = 'const x = 2;';
      await createFile('modified.ts', newContent);

      const pool = createMockPool([
        { file_path: 'modified.ts', content_hash: hashOf(oldContent) },
      ]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.changed).toBe(1);
      expect(result.unchanged).toBe(0);
      expect(result.changedFiles[0]!.path).toBe('modified.ts');
      expect(result.changedFiles[0]!.hash).toBe(hashOf(newContent));
    });

    it('detects removed files and deletes them from DB', async () => {
      // Only one file on disk, but DB has two
      await createFile('alive.ts', 'export {};');

      const pool = createMockPool([
        { file_path: 'alive.ts', content_hash: hashOf('export {};') },
        { file_path: 'deleted.ts', content_hash: 'abc123' },
      ]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.removed).toBe(1);

      // Check DELETE was called for the removed file
      const deleteCall = pool._client.query.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('DELETE FROM code_files'),
      );
      expect(deleteCall).toBeDefined();
      expect((deleteCall![1] as unknown[])[0]).toBe('deleted.ts');
    });

    it('handles mixed scenario (new + unchanged + modified + removed)', async () => {
      await createFile('new-file.ts', 'new');
      await createFile('unchanged.ts', 'same');
      await createFile('modified.ts', 'updated-content');

      const pool = createMockPool([
        { file_path: 'unchanged.ts', content_hash: hashOf('same') },
        { file_path: 'modified.ts', content_hash: hashOf('old-content') },
        { file_path: 'gone.ts', content_hash: 'xyz' },
      ]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(3);
      expect(result.changed).toBe(2);       // new-file + modified
      expect(result.unchanged).toBe(1);     // unchanged
      expect(result.removed).toBe(1);       // gone.ts
    });

    it('rolls back transaction on error', async () => {
      await createFile('fail.ts', 'boom');

      const pool = createMockPool([]);
      // Make the INSERT call throw
      pool._client.query
        .mockResolvedValueOnce({ rows: [] })  // BEGIN
        .mockRejectedValueOnce(new Error('DB error'));

      const service = new IndexerService(pool as unknown as import('pg').Pool);

      await expect(service.indexWorkspace(tempDir)).rejects.toThrow('DB error');

      // Verify ROLLBACK was called
      const rollbackCall = pool._client.query.mock.calls.find(
        (c: unknown[]) => c[0] === 'ROLLBACK',
      );
      expect(rollbackCall).toBeDefined();
      expect(pool._client.release).toHaveBeenCalledOnce();
    });

    it('returns changedFiles list for downstream consumption', async () => {
      await createFile('a.ts', 'export const a = 1;');
      await createFile('b.py', 'b = 2');

      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.changedFiles).toHaveLength(2);
      const paths = result.changedFiles.map((f) => f.path).sort();
      expect(paths).toEqual(['a.ts', 'b.py']);
    });

    it('skips unsupported file types', async () => {
      await createFile('readme.md', '# readme');
      await createFile('style.css', 'body {}');
      await createFile('real.ts', 'export {};');

      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(1);
      expect(result.changedFiles[0]!.path).toBe('real.ts');
    });

    it('skips node_modules and .git directories', async () => {
      await createFile('src/app.ts', 'app');
      await createFile('node_modules/lodash/index.js', 'module.exports = {};');
      await createFile('.git/HEAD', 'ref: refs/heads/main');

      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(1);
      expect(result.changedFiles[0]!.path).toBe('src/app.ts');
    });

    it('does not open transaction when nothing changed', async () => {
      // Empty directory — nothing to index or remove
      const pool = createMockPool([]);
      const service = new IndexerService(pool as unknown as import('pg').Pool);

      const result = await service.indexWorkspace(tempDir);

      expect(result.total).toBe(0);
      expect(result.changed).toBe(0);
      expect(result.removed).toBe(0);
      expect(pool.connect).not.toHaveBeenCalled();
    });
  });
});
