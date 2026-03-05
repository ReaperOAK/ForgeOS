/**
 * Migration Runner Tests — TASK-FOS-01-002
 *
 * Unit tests for the SQL migration runner: schema_migrations table creation,
 * lexicographic ordering, checksum computation, idempotent re-runs, and
 * checksum mismatch detection.
 *
 * Uses Vitest mocks to isolate from real PostgreSQL and filesystem.
 * No live database required.
 *
 * @module __tests__/db/migrate
 * @ticket TASK-FOS-01-002
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';

// ── Mock dependencies before imports ─────────────────────────────────────────

const mockQuery = vi.fn();
const mockConnect = vi.fn();
const mockEnd = vi.fn();
const mockOn = vi.fn();
const mockRelease = vi.fn();

const mockClient = {
  query: vi.fn(),
  release: mockRelease,
};

const mockPoolInstance = {
  query: mockQuery,
  connect: mockConnect,
  end: mockEnd,
  on: mockOn,
  totalCount: 5,
  idleCount: 3,
  waitingCount: 0,
};

vi.mock('pg', () => {
  const MockPool = vi.fn(() => mockPoolInstance);
  return { default: { Pool: MockPool }, Pool: MockPool };
});

vi.mock('../../config.js', () => ({
  config: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
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

// Mock node:fs at module level for ESM compatibility
const mockExistsSync = vi.fn();
const mockReaddirSync = vi.fn();
const mockReadFileSync = vi.fn();

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: (...args: Parameters<typeof actual.existsSync>) => mockExistsSync(...args),
      readdirSync: (...args: Parameters<typeof actual.readdirSync>) => mockReaddirSync(...args),
      readFileSync: (...args: Parameters<typeof actual.readFileSync>) => mockReadFileSync(...args),
    },
    existsSync: (...args: Parameters<typeof actual.existsSync>) => mockExistsSync(...args),
    readdirSync: (...args: Parameters<typeof actual.readdirSync>) => mockReaddirSync(...args),
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => mockReadFileSync(...args),
  };
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function sha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex');
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Migration Runner — migrate.ts', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockClient.query.mockResolvedValue({ rows: [] });
    mockEnd.mockResolvedValue(undefined);
    mockExistsSync.mockReturnValue(true);
    mockReaddirSync.mockReturnValue([]);
    mockReadFileSync.mockReturnValue('');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function importMigrate() {
    // Reset pool singleton first
    const poolMod = await import('../../db/pool.js');
    poolMod._resetPool();
    const mod = await import('../../db/migrate.js');
    return mod;
  }

  // ── 1. schema_migrations table creation ────────────────────────────────

  describe('schema_migrations table', () => {
    it('creates schema_migrations table with name, checksum, and applied_at columns', async () => {
      const { runMigrations } = await importMigrate();

      // Mock: no applied migrations, no migration files
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE IF NOT EXISTS
        .mockResolvedValueOnce({ rows: [] }); // SELECT from schema_migrations

      mockReaddirSync.mockReturnValue([]);

      await runMigrations();

      // Verify CREATE TABLE was called
      const createTableCall = mockQuery.mock.calls[0];
      expect(createTableCall).toBeDefined();
      const createTableSQL = (createTableCall[0] as string).toLowerCase();
      expect(createTableSQL).toContain('create table if not exists schema_migrations');
      expect(createTableSQL).toContain('name text not null unique');
      expect(createTableSQL).toContain('checksum text not null');
      expect(createTableSQL).toContain('applied_at timestamptz');
    });
  });

  // ── 2. Lexicographic ordering ──────────────────────────────────────────

  describe('migration file ordering', () => {
    it('reads .sql files in lexicographic order', async () => {
      const { runMigrations } = await importMigrate();

      const migrationContent = '-- test migration';
      const checksum = sha256(migrationContent);

      // Mock pool.query for table creation and applied migrations
      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied migrations

      mockReaddirSync.mockReturnValue([
        '003_third.sql',
        '001_first.sql',
        '002_second.sql',
        'not_sql.txt',
      ]);
      mockReadFileSync.mockReturnValue(migrationContent);

      // Mock client queries for transaction
      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      // Verify migrations were applied in sorted order
      const insertCalls = mockClient.query.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO schema_migrations'),
      );
      expect(insertCalls).toHaveLength(3);
      expect(insertCalls[0][1]).toEqual(['001_first.sql', checksum]);
      expect(insertCalls[1][1]).toEqual(['002_second.sql', checksum]);
      expect(insertCalls[2][1]).toEqual(['003_third.sql', checksum]);
    });

    it('filters out non-.sql files', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied

      mockReaddirSync.mockReturnValue([
        '001_migration.sql',
        'README.md',
        '.gitkeep',
      ]);
      mockReadFileSync.mockReturnValue('-- sql');

      mockClient.query.mockResolvedValue({ rows: [] });

      const count = await runMigrations();
      expect(count).toBe(1);
    });
  });

  // ── 3. Checksum tracking ───────────────────────────────────────────────

  describe('checksum tracking', () => {
    it('computes SHA-256 checksum and records it in schema_migrations', async () => {
      const { runMigrations } = await importMigrate();
      const sqlContent = 'CREATE TABLE test (id INT);';
      const expectedChecksum = sha256(sqlContent);

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      mockReadFileSync.mockReturnValue(sqlContent);

      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      const insertCall = mockClient.query.mock.calls.find(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO schema_migrations'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1]).toEqual(['001_test.sql', expectedChecksum]);
    });

    it('throws on checksum mismatch for already-applied migration', async () => {
      const { runMigrations } = await importMigrate();
      const originalContent = 'CREATE TABLE test (id INT);';
      const modifiedContent = 'CREATE TABLE test (id BIGINT);';
      const originalChecksum = sha256(originalContent);

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({
          rows: [{ name: '001_test.sql', checksum: originalChecksum }],
        }); // SELECT applied

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      // File has been modified since it was applied
      mockReadFileSync.mockReturnValue(modifiedContent);

      await expect(runMigrations()).rejects.toThrow('checksum mismatch');
    });
  });

  // ── 4. Idempotent re-runs ──────────────────────────────────────────────

  describe('idempotent re-runs', () => {
    it('skips already-applied migrations', async () => {
      const { runMigrations } = await importMigrate();
      const sqlContent = '-- migration sql';
      const checksum = sha256(sqlContent);

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({
          rows: [
            { name: '001_initial.sql', checksum },
            { name: '002_second.sql', checksum },
          ],
        }); // SELECT applied

      mockReaddirSync.mockReturnValue([
        '001_initial.sql',
        '002_second.sql',
      ]);
      mockReadFileSync.mockReturnValue(sqlContent);

      const count = await runMigrations();

      expect(count).toBe(0);
      // No client.connect() should be called for executing migrations
      expect(mockConnect).not.toHaveBeenCalled();
    });

    it('applies only new migrations when some are already applied', async () => {
      const { runMigrations } = await importMigrate();
      const sql1 = '-- migration 1';
      const sql2 = '-- migration 2';
      const checksum1 = sha256(sql1);

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({
          rows: [{ name: '001_first.sql', checksum: checksum1 }],
        }); // SELECT applied

      mockReaddirSync.mockReturnValue([
        '001_first.sql',
        '002_second.sql',
      ]);
      mockReadFileSync.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('001_first.sql')) return sql1;
        return sql2;
      });

      mockClient.query.mockResolvedValue({ rows: [] });

      const count = await runMigrations();

      expect(count).toBe(1);
      // Verify only 002_second.sql was applied
      const insertCalls = mockClient.query.mock.calls.filter(
        (c: unknown[]) => typeof c[0] === 'string' && (c[0] as string).includes('INSERT INTO schema_migrations'),
      );
      expect(insertCalls).toHaveLength(1);
      expect(insertCalls[0][1][0]).toBe('002_second.sql');
    });
  });

  // ── 5. Transaction handling ────────────────────────────────────────────

  describe('transaction handling', () => {
    it('wraps each migration in a transaction', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      mockReadFileSync.mockReturnValue('CREATE TABLE t (id INT);');

      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('COMMIT');
    });

    it('rolls back on migration failure and re-throws', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied

      mockReaddirSync.mockReturnValue(['001_bad.sql']);
      mockReadFileSync.mockReturnValue('INVALID SQL;');

      mockClient.query.mockImplementation((text: string) => {
        if (text === 'INVALID SQL;') {
          return Promise.reject(new Error('syntax error'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(runMigrations()).rejects.toThrow('syntax error');
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // ── 6. Missing migrations directory ────────────────────────────────────

  describe('missing migrations directory', () => {
    it('returns 0 and logs warning when directory does not exist', async () => {
      const { runMigrations } = await importMigrate();
      const { logger } = await import('../../middleware/logging.js');

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied

      mockExistsSync.mockReturnValue(false);

      const count = await runMigrations();

      expect(count).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'migrations_dir_missing' }),
        expect.any(String),
      );
    });
  });

  // ── 7. Structured logging ─────────────────────────────────────────────

  describe('structured logging', () => {
    it('logs migration_applied event for each applied migration', async () => {
      const { runMigrations } = await importMigrate();
      const { logger } = await import('../../middleware/logging.js');

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      mockReadFileSync.mockReturnValue('-- test');

      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'migration_applied',
          migration: '001_test.sql',
          checksum: expect.any(String),
        }),
        expect.any(String),
      );
    });

    it('logs migration_failed event on failure', async () => {
      const { runMigrations } = await importMigrate();
      const { logger } = await import('../../middleware/logging.js');

      mockQuery
        .mockResolvedValueOnce({ rows: [] }) // CREATE TABLE
        .mockResolvedValueOnce({ rows: [] }); // SELECT applied

      mockReaddirSync.mockReturnValue(['001_fail.sql']);
      mockReadFileSync.mockReturnValue('BAD SQL;');

      mockClient.query.mockImplementation((text: string) => {
        if (text === 'BAD SQL;') {
          return Promise.reject(new Error('syntax error'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(runMigrations()).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'migration_failed',
          migration: '001_fail.sql',
        }),
        expect.any(String),
      );
    });
  });
});
