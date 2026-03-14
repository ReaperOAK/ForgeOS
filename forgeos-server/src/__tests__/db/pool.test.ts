/**
 * Connection Pool Tests — TASK-FOS-01-002
 *
 * Unit tests for the PostgreSQL connection pool singleton, health check,
 * RLS session context, slow-query logging, and pool event listeners.
 *
 * Uses Vitest mocks to isolate from real PostgreSQL. No live database required.
 *
 * @module __tests__/db/pool
 * @ticket TASK-FOS-01-002
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
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Connection Pool — pool.ts', () => {
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

  // Helper to get a fresh module instance with reset singleton
  async function importPool() {
    const mod = await import('../../db/pool.js');
    mod._resetPool();
    return mod;
  }

  // ── 1. Singleton Behavior ──────────────────────────────────────────────

  describe('getPool()', () => {
    it('returns a pg.Pool instance', async () => {
      const { getPool } = await importPool();
      const pool = getPool();
      expect(pool).toBeDefined();
      expect(pool).toBe(mockPoolInstance);
    });

    it('returns the same instance on subsequent calls (singleton)', async () => {
      const { getPool } = await importPool();
      const pool1 = getPool();
      const pool2 = getPool();
      expect(pool1).toBe(pool2);
    });

    it('creates pool with max=20, idleTimeout=30110, connectionTimeout=10000', async () => {
      const { getPool } = await importPool();
      getPool();
      const pg = await import('pg');
      const PoolConstructor = pg.default.Pool;
      expect(PoolConstructor).toHaveBeenCalledWith(
        expect.objectContaining({
          connectionString: 'postgresql://test:test@localhost:5432/testdb',
          max: 20,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 10_000,
        }),
      );
    });

    it('attaches error event listener', async () => {
      const { getPool } = await importPool();
      getPool();
      expect(mockOn).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('attaches connect event listener', async () => {
      const { getPool } = await importPool();
      getPool();
      expect(mockOn).toHaveBeenCalledWith('connect', expect.any(Function));
    });

    it('attaches acquire event listener for exhaustion detection', async () => {
      const { getPool } = await importPool();
      getPool();
      expect(mockOn).toHaveBeenCalledWith('acquire', expect.any(Function));
    });

    it('attaches remove event listener', async () => {
      const { getPool } = await importPool();
      getPool();
      expect(mockOn).toHaveBeenCalledWith('remove', expect.any(Function));
    });
  });

  // ── 2. Pool Event Logging ─────────────────────────────────────────────

  describe('pool event handlers', () => {
    it('logs error events with structured data', async () => {
      const { getPool } = await importPool();
      getPool();
      const { logger } = await import('../../middleware/logging.js');

      // Find the error handler
      const errorCall = mockOn.mock.calls.find(
        (c: unknown[]) => c[0] === 'error',
      );
      expect(errorCall).toBeDefined();
      const errorHandler = errorCall![1] as (err: Error) => void;

      const testError = new Error('connection refused');
      errorHandler(testError);

      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'pool_connection_error' }),
        expect.any(String),
      );
    });

    it('logs pool exhaustion warning when waitingCount > 0', async () => {
      const { getPool } = await importPool();
      getPool();
      const { logger } = await import('../../middleware/logging.js');

      // Find the acquire handler
      const acquireCall = mockOn.mock.calls.find(
        (c: unknown[]) => c[0] === 'acquire',
      );
      expect(acquireCall).toBeDefined();
      const acquireHandler = acquireCall![1] as () => void;

      // Simulate exhaustion
      mockPoolInstance.waitingCount = 3;
      acquireHandler();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'pool_exhaustion', waiting: 3 }),
        expect.any(String),
      );
    });

    it('does not log exhaustion when waitingCount is 0', async () => {
      const { getPool } = await importPool();
      getPool();
      const { logger } = await import('../../middleware/logging.js');

      const acquireCall = mockOn.mock.calls.find(
        (c: unknown[]) => c[0] === 'acquire',
      );
      const acquireHandler = acquireCall![1] as () => void;

      mockPoolInstance.waitingCount = 0;
      acquireHandler();

      expect(logger.warn).not.toHaveBeenCalledWith(
        expect.objectContaining({ event: 'pool_exhaustion' }),
        expect.any(String),
      );
    });
  });

  // ── 3. healthCheck() ──────────────────────────────────────────────────

  describe('healthCheck()', () => {
    it('returns connected=true and pool stats on successful query', async () => {
      const { healthCheck } = await importPool();
      mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

      const result = await healthCheck();

      expect(result.connected).toBe(true);
      expect(result.pool).toEqual({
        total: 5,
        idle: 3,
        waiting: 0,
      });
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('returns connected=false on query failure', async () => {
      const { healthCheck } = await importPool();
      mockQuery.mockRejectedValueOnce(new Error('connection refused'));

      const result = await healthCheck();

      expect(result.connected).toBe(false);
      expect(result.pool).toBeDefined();
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it('executes SELECT 1 as the health check query', async () => {
      const { healthCheck } = await importPool();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await healthCheck();

      expect(mockQuery).toHaveBeenCalledWith('SELECT 1');
    });
  });

  // ── 4. setSessionContext() ────────────────────────────────────────────

  describe('setSessionContext()', () => {
    it('sets app.agent_role, app.agent_name, and app.agent_id via SET LOCAL', async () => {
      const { setSessionContext } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      await setSessionContext(
        mockClient as unknown as import('pg').PoolClient,
        'Backend',
        'Backend Engineer',
        'uuid-123',
      );

      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.agent_role = $1',
        ['Backend'],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.agent_name = $1',
        ['Backend Engineer'],
      );
      expect(mockClient.query).toHaveBeenCalledWith(
        'SET LOCAL app.agent_id = $1',
        ['uuid-123'],
      );
    });

    it('sets exactly 3 session variables', async () => {
      const { setSessionContext } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      await setSessionContext(
        mockClient as unknown as import('pg').PoolClient,
        'QA',
        'QA Engineer',
        'uuid-456',
      );

      expect(mockClient.query).toHaveBeenCalledTimes(3);
    });
  });

  // ── 5. queryWithRLS() ─────────────────────────────────────────────────

  describe('queryWithRLS()', () => {
    it('wraps query in a transaction with session context', async () => {
      const { queryWithRLS } = await importPool();
      const expectedResult = { rows: [{ id: 1 }], rowCount: 1 };
      mockClient.query.mockResolvedValue(expectedResult);

      const result = await queryWithRLS('Backend', 'Agent', 'SELECT * FROM tickets', []);

      // Verify transaction lifecycle: BEGIN → SET LOCAL ×3 → query → COMMIT
      const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls).toContain('SET LOCAL app.agent_role = $1');
      expect(calls).toContain('SET LOCAL app.agent_name = $1');
      expect(calls).toContain('SET LOCAL app.agent_id = $1');
      expect(calls).toContain('SELECT * FROM tickets');
      expect(calls[calls.length - 1]).toBe('COMMIT');
      expect(result).toBe(expectedResult);
    });

    it('rolls back on query error', async () => {
      const { queryWithRLS } = await importPool();
      mockClient.query.mockImplementation((text: string) => {
        if (text === 'SELECT * FROM bad_table') {
          return Promise.reject(new Error('relation does not exist'));
        }
        return Promise.resolve({ rows: [] });
      });

      await expect(
        queryWithRLS('Backend', 'Agent', 'SELECT * FROM bad_table'),
      ).rejects.toThrow('relation does not exist');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // ── 6. transactionWithRLS() ───────────────────────────────────────────

  describe('transactionWithRLS()', () => {
    it('executes function within transaction with session context', async () => {
      const { transactionWithRLS } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      const result = await transactionWithRLS(
        'Security',
        'SecurityAgent',
        async (client) => {
          await client.query('INSERT INTO events (type) VALUES ($1)', ['TEST']);
          return 42;
        },
      );

      expect(result).toBe(42);
      const calls = mockClient.query.mock.calls.map((c: unknown[]) => c[0]);
      expect(calls[0]).toBe('BEGIN');
      expect(calls[calls.length - 1]).toBe('COMMIT');
    });

    it('rolls back on error in transaction function', async () => {
      const { transactionWithRLS } = await importPool();
      mockClient.query.mockResolvedValue({ rows: [] });

      await expect(
        transactionWithRLS('Backend', 'Agent', async () => {
          throw new Error('business logic failure');
        }),
      ).rejects.toThrow('business logic failure');

      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClient.release).toHaveBeenCalled();
    });
  });

  // ── 7. closePool() ────────────────────────────────────────────────────

  describe('closePool()', () => {
    it('calls pool.end() and resets singleton', async () => {
      const mod = await importPool();
      // Initialize the pool
      mod.getPool();
      await mod.closePool();

      expect(mockEnd).toHaveBeenCalled();
    });

    it('is a no-op when pool was never initialized', async () => {
      const mod = await importPool();
      // Don't call getPool() — pool is null
      await mod.closePool();
      expect(mockEnd).not.toHaveBeenCalled();
    });

    it('allows re-initialization after close', async () => {
      const mod = await importPool();
      mod.getPool();
      await mod.closePool();

      // Re-initialize
      const pool2 = mod.getPool();
      expect(pool2).toBeDefined();
    });
  });

  // ── 8. Backward-compatible pool export ────────────────────────────────

  describe('backward-compatible pool export', () => {
    it('exports pool as a pg.Pool instance', async () => {
      const mod = await import('../../db/pool.js');
      expect(mod.pool).toBeDefined();
      expect(mod.pool).toBe(mockPoolInstance);
    });
  });

  // ── 9. PoolHealthStats type export ────────────────────────────────────

  describe('PoolHealthStats type', () => {
    it('healthCheck return value matches PoolHealthStats shape', async () => {
      const { healthCheck } = await importPool();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await healthCheck();

      expect(result).toHaveProperty('connected');
      expect(result).toHaveProperty('pool');
      expect(result).toHaveProperty('latencyMs');
      expect(result.pool).toHaveProperty('total');
      expect(result.pool).toHaveProperty('idle');
      expect(result.pool).toHaveProperty('waiting');
    });
  });
});
