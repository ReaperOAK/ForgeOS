/**
 * QA Supplementary Tests — pool.ts
 *
 * Additional tests written by QA Engineer to cover critical paths
 * not exercised by the Backend-authored tests: slow query detection,
 * slow transaction detection, edge cases, and boundary conditions.
 *
 * @module __tests__/db/pool-qa
 * @ticket TASK-FOS-01-002 (QA stage)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock pg before any imports ───────────────────────────────────────────────

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

// ═════════════════════════════════════════════════════════════════════════════

describe('QA — pool.ts supplementary tests', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockConnect.mockResolvedValue(mockClient);
    mockEnd.mockResolvedValue(undefined);
    mockPoolInstance.totalCount = 5;
    mockPoolInstance.idleCount = 3;
    mockPoolInstance.waitingCount = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function importPool() {
    const mod = await import('../../db/pool.js');
    mod._resetPool();
    return mod;
  }

  // ── Slow Query Detection ───────────────────────────────────────────────

  describe('slow query detection (queryWithRLS)', () => {
    it('logs slow_query warning when query exceeds threshold', async () => {
      const { queryWithRLS } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      // Simulate a slow query by delaying the COMMIT response
      let callCount = 0;
      mockClient.query.mockImplementation((text: string) => {
        callCount++;
        if (text === 'COMMIT') {
          // Artificially delay to simulate slow query
          return new Promise((resolve) => {
            // Use Date.now manipulation - mock the slow execution
            setTimeout(() => resolve({ rows: [] }), 1100);
          });
        }
        return Promise.resolve({ rows: [{ id: 1 }], rowCount: 1 });
      });

      await queryWithRLS('Backend', 'Agent', 'SELECT * FROM tickets', []);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'slow_query',
          queryText: expect.stringContaining('SELECT * FROM tickets'),
          thresholdMs: expect.any(Number),
        }),
        'Slow query detected',
      );
    });

    it('does not log slow_query when query is fast', async () => {
      const { queryWithRLS } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      mockClient.query.mockResolvedValue({ rows: [{ id: 1 }], rowCount: 1 });

      await queryWithRLS('Backend', 'Agent', 'SELECT 1', []);

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'slow_query' }),
        expect.any(String),
      );
    });

    it('truncates long query text in slow_query log to 200 chars', async () => {
      const { queryWithRLS } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      const longQuery = 'SELECT ' + 'a'.repeat(300) + ' FROM tickets';

      mockClient.query.mockImplementation((text: string) => {
        if (text === 'COMMIT') {
          return new Promise((resolve) => {
            setTimeout(() => resolve({ rows: [] }), 1100);
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      });

      await queryWithRLS('Backend', 'Agent', longQuery, []);

      const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const slowQueryCall = warnCalls.find(
        (c: unknown[]) =>
          typeof c[0] === 'object' &&
          c[0] !== null &&
          (c[0] as Record<string, unknown>).event === 'slow_query',
      );
      expect(slowQueryCall).toBeDefined();
      expect(
        (slowQueryCall![0] as Record<string, unknown>).queryText as string,
      ).toHaveLength(200);
    });
  });

  // ── Slow Transaction Detection ─────────────────────────────────────────

  describe('slow transaction detection (transactionWithRLS)', () => {
    it('logs slow_transaction warning when fn exceeds threshold', async () => {
      const { transactionWithRLS } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      mockClient.query.mockImplementation((text: string) => {
        if (text === 'COMMIT') {
          return new Promise((resolve) => {
            setTimeout(() => resolve({ rows: [] }), 1100);
          });
        }
        return Promise.resolve({ rows: [] });
      });

      await transactionWithRLS('QA', 'QAAgent', async (client) => {
        await client.query('INSERT INTO t (v) VALUES (1)');
        return 'done';
      });

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'slow_transaction',
          thresholdMs: expect.any(Number),
        }),
        'Slow transaction detected',
      );
    });

    it('does not log slow_transaction when fn is fast', async () => {
      const { transactionWithRLS } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      mockClient.query.mockResolvedValue({ rows: [] });

      await transactionWithRLS('QA', 'Agent', async () => 'fast');

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'slow_transaction' }),
        expect.any(String),
      );
    });
  });

  // ── queryWithRLS edge cases ────────────────────────────────────────────

  describe('queryWithRLS edge cases', () => {
    it('passes params array to the query', async () => {
      const { queryWithRLS } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [{ id: 42 }] });

      await queryWithRLS('Backend', 'Agent', 'SELECT * FROM t WHERE id = $1', [
        42,
      ]);

      expect(mockClient.query).toHaveBeenCalledWith(
        'SELECT * FROM t WHERE id = $1',
        [42],
      );
    });

    it('defaults params to empty array when not provided', async () => {
      const { queryWithRLS } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      await queryWithRLS('Backend', 'Agent', 'SELECT 1');

      // The query call with the SQL text should use [] as default params
      const selectCall = mockClient.query.mock.calls.find(
        (c: unknown[]) => c[0] === 'SELECT 1',
      );
      expect(selectCall).toBeDefined();
      expect(selectCall![1]).toEqual([]);
    });

    it('releases client even when ROLLBACK itself fails', async () => {
      const { queryWithRLS } = await importPool();

      mockClient.query.mockImplementation((text: string) => {
        if (text === 'SELECT * FROM t') {
          return Promise.reject(new Error('query failed'));
        }
        if (text === 'ROLLBACK') {
          return Promise.reject(new Error('rollback failed too'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        queryWithRLS('Backend', 'Agent', 'SELECT * FROM t'),
      ).rejects.toThrow('query failed');

      expect(mockRelease).toHaveBeenCalled();
    });
  });

  // ── transactionWithRLS edge cases ──────────────────────────────────────

  describe('transactionWithRLS edge cases', () => {
    it('releases client even when ROLLBACK fails during error', async () => {
      const { transactionWithRLS } = await importPool();

      mockClient.query.mockImplementation((text: string) => {
        if (text === 'ROLLBACK') {
          return Promise.reject(new Error('rollback failed'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        transactionWithRLS('Backend', 'Agent', async () => {
          throw new Error('fn error');
        }),
      ).rejects.toThrow('fn error');

      expect(mockRelease).toHaveBeenCalled();
    });

    it('returns the value from the transaction function', async () => {
      const { transactionWithRLS } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await transactionWithRLS(
        'Backend',
        'Agent',
        async () => ({ status: 'ok', count: 42 }),
      );

      expect(result).toEqual({ status: 'ok', count: 42 });
    });
  });

  // ── setSessionContext boundary tests ───────────────────────────────────

  describe('setSessionContext boundary conditions', () => {
    it('handles empty string values for role, name, and id', async () => {
      const { setSessionContext } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      await setSessionContext(
        mockClient as unknown as import('pg').PoolClient,
        '',
        '',
        '',
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.agent_role = $1',
        [''],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.agent_name = $1',
        [''],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.agent_id = $1',
        [''],
      );
    });

    it('handles special characters in session values', async () => {
      const { setSessionContext } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      await setSessionContext(
        mockClient as unknown as import('pg').PoolClient,
        "Admin'; DROP TABLE agents; --",
        'O\'Brien',
        'uuid-with-dashes-1234',
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.agent_role = $1',
        ["Admin'; DROP TABLE agents; --"],
      );
    });
  });

  // ── healthCheck edge cases ─────────────────────────────────────────────

  describe('healthCheck edge cases', () => {
    it('returns latencyMs as a non-negative number', async () => {
      const { healthCheck } = await importPool();
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await healthCheck();

      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
      expect(typeof result.latencyMs).toBe('number');
    });

    it('reports pool stats accurately on failure', async () => {
      const { healthCheck } = await importPool();
      mockPoolInstance.totalCount = 20;
      mockPoolInstance.idleCount = 0;
      mockPoolInstance.waitingCount = 5;
      mockQuery.mockRejectedValueOnce(new Error('connection timed out'));

      const result = await healthCheck();

      expect(result.connected).toBe(false);
      expect(result.pool.total).toBe(20);
      expect(result.pool.idle).toBe(0);
      expect(result.pool.waiting).toBe(5);
    });
  });

  // ── Pool initialization logging ────────────────────────────────────────

  describe('pool initialization logging', () => {
    it('logs pool_initialized event with config details', async () => {
      const { getPool } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      getPool();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'pool_initialized',
          max: 20,
          idleTimeoutMs: 30_000,
          connectionTimeoutMs: 10_000,
        }),
        'PostgreSQL connection pool initialized',
      );
    });

    it('logs pool_closed event on close', async () => {
      const mod = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      mod.getPool();
      await mod.closePool();

      expect(logger.info).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'pool_closed' }),
        'PostgreSQL connection pool closed',
      );
    });
  });

  // ── Connect/Remove event handlers ─────────────────────────────────────

  describe('pool connect/remove event handlers', () => {
    it('logs connect event with pool stats', async () => {
      const { getPool } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      getPool();

      const connectCall = mockOn.mock.calls.find(
        (c: unknown[]) => c[0] === 'connect',
      );
      expect(connectCall).toBeDefined();
      const connectHandler = connectCall![1] as () => void;

      connectHandler();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'pool_client_connected',
          total: expect.any(Number),
          idle: expect.any(Number),
        }),
        expect.any(String),
      );
    });

    it('logs remove event with pool stats', async () => {
      const { getPool } = await importPool();
      const { logger } = await import('../../middleware/logging.js');

      getPool();

      const removeCall = mockOn.mock.calls.find(
        (c: unknown[]) => c[0] === 'remove',
      );
      expect(removeCall).toBeDefined();
      const removeHandler = removeCall![1] as () => void;

      removeHandler();

      expect(logger.debug).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'pool_client_removed',
          total: expect.any(Number),
          idle: expect.any(Number),
        }),
        expect.any(String),
      );
    });
  });
});
