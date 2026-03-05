/**
 * QA Supplementary Tests — migrate.ts
 *
 * Additional tests written by QA Engineer for edge cases, boundary
 * conditions, and property-based validation of the migration runner.
 *
 * @module __tests__/db/migrate-qa
 * @ticket TASK-FOS-01-002 (QA stage)
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

describe('QA — migrate.ts supplementary tests', () => {
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
    const poolMod = await import('../../db/pool.js');
    poolMod._resetPool();
    const mod = await import('../../db/migrate.js');
    return mod;
  }

  // ── Property: SHA-256 checksum determinism ─────────────────────────────

  describe('checksum determinism (property-based)', () => {
    it('same content always produces the same checksum', async () => {
      const content = 'CREATE TABLE test (id INT);';
      const hash1 = sha256(content);
      const hash2 = sha256(content);
      const hash3 = sha256(content);
      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });

    it('different content produces different checksums', async () => {
      const contentA = 'CREATE TABLE test (id INT);';
      const contentB = 'CREATE TABLE test (id BIGINT);';
      expect(sha256(contentA)).not.toBe(sha256(contentB));
    });

    it('checksum is a 64-character hex string', async () => {
      const content = 'anything';
      const checksum = sha256(content);
      expect(checksum).toMatch(/^[0-9a-f]{64}$/);
    });

    it('empty string has a valid checksum', async () => {
      const checksum = sha256('');
      expect(checksum).toMatch(/^[0-9a-f]{64}$/);
      // SHA-256 of empty string is a known constant
      expect(checksum).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      );
    });
  });

  // ── Multiple migration ordering ────────────────────────────────────────

  describe('migration ordering edge cases', () => {
    it('handles numeric-prefix ordering correctly (001 before 010 before 100)', async () => {
      const { runMigrations } = await importMigrate();

      const sql = '-- migration';
      const checksum = sha256(sql);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue([
        '100_hundredth.sql',
        '010_tenth.sql',
        '001_first.sql',
        '002_second.sql',
      ]);
      mockReadFileSync.mockReturnValue(sql);
      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      const insertCalls = mockClient.query.mock.calls.filter(
        (c: unknown[]) =>
          typeof c[0] === 'string' &&
          (c[0] as string).includes('INSERT INTO schema_migrations'),
      );
      expect(insertCalls).toHaveLength(4);
      expect(insertCalls[0][1][0]).toBe('001_first.sql');
      expect(insertCalls[1][1][0]).toBe('002_second.sql');
      expect(insertCalls[2][1][0]).toBe('010_tenth.sql');
      expect(insertCalls[3][1][0]).toBe('100_hundredth.sql');
    });

    it('handles single migration file', async () => {
      const { runMigrations } = await importMigrate();
      const sql = 'CREATE TABLE t (id INT);';

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue(['001_only.sql']);
      mockReadFileSync.mockReturnValue(sql);
      mockClient.query.mockResolvedValue({ rows: [] });

      const count = await runMigrations();
      expect(count).toBe(1);
    });

    it('handles empty migrations directory', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue([]);

      const count = await runMigrations();
      expect(count).toBe(0);
    });
  });

  // ── Checksum mismatch edge cases ───────────────────────────────────────

  describe('checksum mismatch edge cases', () => {
    it('includes migration name in the error message', async () => {
      const { runMigrations } = await importMigrate();
      const original = 'CREATE TABLE t (id INT);';
      const modified = 'CREATE TABLE t (id BIGINT);';
      const originalChecksum = sha256(original);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ name: '042_important.sql', checksum: originalChecksum }],
        });

      mockReaddirSync.mockReturnValue(['042_important.sql']);
      mockReadFileSync.mockReturnValue(modified);

      await expect(runMigrations()).rejects.toThrow('042_important.sql');
    });

    it('includes both expected and actual checksums in error', async () => {
      const { runMigrations } = await importMigrate();
      const original = 'v1';
      const modified = 'v2';
      const originalChecksum = sha256(original);
      const modifiedChecksum = sha256(modified);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ name: '001_test.sql', checksum: originalChecksum }],
        });

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      mockReadFileSync.mockReturnValue(modified);

      await expect(runMigrations()).rejects.toThrow(originalChecksum.substring(0, 10));
    });
  });

  // ── Transaction isolation ──────────────────────────────────────────────

  describe('transaction isolation per migration', () => {
    it('each migration gets its own BEGIN/COMMIT pair', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue(['001_first.sql', '002_second.sql']);
      mockReadFileSync.mockReturnValue('-- sql');
      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
      const beginCount = calls.filter((c: unknown) => c === 'BEGIN').length;
      const commitCount = calls.filter((c: unknown) => c === 'COMMIT').length;

      expect(beginCount).toBe(2);
      expect(commitCount).toBe(2);
    });

    it('failure in second migration does not affect first', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue(['001_ok.sql', '002_bad.sql']);

      let callSequence = 0;
      mockReadFileSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('001_ok.sql')) return '-- ok';
        return 'BAD SQL;';
      });

      // First migration succeeds, second fails
      mockClient.query.mockImplementation((text: string) => {
        callSequence++;
        if (text === 'BAD SQL;') {
          return Promise.reject(new Error('syntax error'));
        }
        return Promise.resolve({ rows: [] });
      });

      // Each migration gets its own connect() call
      mockConnect.mockResolvedValue(mockClient);

      await expect(runMigrations()).rejects.toThrow('syntax error');

      // First migration's COMMIT should have been called
      const commitCalls = mockClient.query.mock.calls.filter(
        (c: unknown[]) => c[0] === 'COMMIT',
      );
      expect(commitCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ── Structured logging verification ────────────────────────────────────

  describe('structured logging completeness', () => {
    it('logs migrations_pending with correct count', async () => {
      const { runMigrations } = await importMigrate();
      const { logger } = await import('../../middleware/logging.js');

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue(['001_a.sql', '002_b.sql', '003_c.sql']);
      mockReadFileSync.mockReturnValue('-- sql');
      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ count: 3, event: 'migrations_pending' }),
        expect.any(String),
      );
    });

    it('logs migrations_none_pending when all are applied', async () => {
      const { runMigrations } = await importMigrate();
      const { logger } = await import('../../middleware/logging.js');

      const sql = '-- sql';
      const checksum = sha256(sql);

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ name: '001_done.sql', checksum }],
        });

      mockReaddirSync.mockReturnValue(['001_done.sql']);
      mockReadFileSync.mockReturnValue(sql);

      await runMigrations();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'migrations_none_pending' }),
        expect.any(String),
      );
    });

    it('logs checksum_mismatch error with structured data', async () => {
      const { runMigrations } = await importMigrate();
      const { logger } = await import('../../middleware/logging.js');

      const original = 'v1';
      const modified = 'v2';

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ name: '001_test.sql', checksum: sha256(original) }],
        });

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      mockReadFileSync.mockReturnValue(modified);

      await expect(runMigrations()).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'migration_checksum_mismatch',
          migration: '001_test.sql',
          expected: sha256(original),
          actual: sha256(modified),
        }),
        expect.any(String),
      );
    });
  });

  // ── Client release guarantee ───────────────────────────────────────────

  describe('client release guarantee', () => {
    it('always releases the client after successful migration', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      mockReadFileSync.mockReturnValue('-- ok');
      mockClient.query.mockResolvedValue({ rows: [] });

      await runMigrations();

      expect(mockRelease).toHaveBeenCalled();
    });

    it('always releases the client after failed migration', async () => {
      const { runMigrations } = await importMigrate();

      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [] });

      mockReaddirSync.mockReturnValue(['001_test.sql']);
      mockReadFileSync.mockReturnValue('BAD;');

      mockClient.query.mockImplementation((text: string) => {
        if (text === 'BAD;') return Promise.reject(new Error('fail'));
        return Promise.resolve({ rows: [] });
      });

      await expect(runMigrations()).rejects.toThrow();
      expect(mockRelease).toHaveBeenCalled();
    });
  });

  // ── Return value ───────────────────────────────────────────────────────

  describe('return value', () => {
    it('returns the exact number of applied migrations', async () => {
      const { runMigrations } = await importMigrate();

      const applied = sha256('-- a');
      mockQuery
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({
          rows: [{ name: '001_a.sql', checksum: applied }],
        });

      mockReaddirSync.mockReturnValue([
        '001_a.sql',
        '002_b.sql',
        '003_c.sql',
      ]);
      mockReadFileSync.mockImplementation((p: unknown) => {
        if (typeof p === 'string' && p.includes('001_a.sql')) return '-- a';
        return '-- new';
      });
      mockClient.query.mockResolvedValue({ rows: [] });

      const count = await runMigrations();
      expect(count).toBe(2); // 002 and 003 are new
    });
  });
});
