/**
 * PostgreSQL connection pool with health check, RLS helpers, and monitoring.
 *
 * Provides a lazily-initialized singleton connection pool using the `pg`
 * library, health check function, session context setter for RLS, and
 * query helpers with slow-query detection.
 *
 * @module db/pool
 * @ticket TASK-FOS-01-002
 */

import pg from 'pg';
import { config } from '../config.js';
import { logger } from '../middleware/logging.js';

const { Pool } = pg;

// ── Pool Configuration Defaults ──────────────────────────────────────────────

/** Default maximum number of clients in the pool. */
const POOL_MAX_CONNECTIONS = 20;

/** Default idle timeout in milliseconds (30 s). */
const POOL_IDLE_TIMEOUT_MS = 30_000;

/** Default connection timeout in milliseconds (10 s). */
const POOL_CONNECTION_TIMEOUT_MS = 10_000;

/** Queries exceeding this threshold (ms) are logged as slow. */
const SLOW_QUERY_THRESHOLD_MS = 1_000;

// ── Singleton ────────────────────────────────────────────────────────────────

let _pool: pg.Pool | null = null;

/**
 * Create and configure a new pg.Pool with structured-log event listeners.
 */
function createPool(): pg.Pool {
  const p = new Pool({
    connectionString: config.DATABASE_URL,
    max: POOL_MAX_CONNECTIONS,
    idleTimeoutMillis: POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: POOL_CONNECTION_TIMEOUT_MS,
  });

  // Structured log: connection errors
  p.on('error', (err: Error) => {
    logger.error(
      { err, event: 'pool_connection_error' },
      'Unexpected PostgreSQL pool error',
    );
  });

  // Structured log: new connections
  p.on('connect', () => {
    logger.debug(
      { event: 'pool_client_connected', total: p.totalCount, idle: p.idleCount },
      'New PostgreSQL client connected',
    );
  });

  // Structured log: pool exhaustion detection
  p.on('acquire', () => {
    if (p.waitingCount > 0) {
      logger.warn(
        {
          event: 'pool_exhaustion',
          total: p.totalCount,
          idle: p.idleCount,
          waiting: p.waitingCount,
          max: POOL_MAX_CONNECTIONS,
        },
        'Pool exhaustion detected: clients waiting for available connection',
      );
    }
  });

  // Structured log: client removed
  p.on('remove', () => {
    logger.debug(
      { event: 'pool_client_removed', total: p.totalCount, idle: p.idleCount },
      'PostgreSQL client removed from pool',
    );
  });

  return p;
}

/**
 * Return the singleton pg.Pool instance, lazily initialized on first call.
 *
 * The pool is configured with:
 * - max connections: 20
 * - idle timeout: 30 s
 * - connection timeout: 10 s
 *
 * @returns The singleton pg.Pool instance
 */
export function getPool(): pg.Pool {
  if (_pool === null) {
    _pool = createPool();
    logger.info(
      {
        event: 'pool_initialized',
        max: POOL_MAX_CONNECTIONS,
        idleTimeoutMs: POOL_IDLE_TIMEOUT_MS,
        connectionTimeoutMs: POOL_CONNECTION_TIMEOUT_MS,
      },
      'PostgreSQL connection pool initialized',
    );
  }
  return _pool;
}

/**
 * Backward-compatible pool export.
 *
 * Existing code imports `{ pool }` directly. This triggers lazy
 * initialization on first module import. New code should prefer
 * {@link getPool} for explicit lifecycle control.
 *
 * @deprecated Prefer {@link getPool} for explicit lazy initialization.
 */
export const pool: pg.Pool = getPool();

// ── Health Check ─────────────────────────────────────────────────────────────

/** Pool health stats returned by {@link healthCheck}. */
export interface PoolHealthStats {
  connected: boolean;
  pool: { total: number; idle: number; waiting: number };
  latencyMs: number;
}

/**
 * Health check — verifies database connectivity and returns pool statistics.
 *
 * Executes `SELECT 1` and measures round-trip latency.
 *
 * @returns Pool health status object
 */
export async function healthCheck(): Promise<PoolHealthStats> {
  const p = getPool();
  const start = Date.now();
  try {
    await p.query('SELECT 1');
    return {
      connected: true,
      pool: {
        total: p.totalCount,
        idle: p.idleCount,
        waiting: p.waitingCount,
      },
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      connected: false,
      pool: {
        total: p.totalCount,
        idle: p.idleCount,
        waiting: p.waitingCount,
      },
      latencyMs: Date.now() - start,
    };
  }
}

// ── RLS Session Context ──────────────────────────────────────────────────────

/**
 * Set PostgreSQL session variables for Row-Level Security enforcement.
 *
 * Sets `app.agent_role`, `app.agent_name`, and `app.agent_id` as
 * session-local variables so RLS policies can access them via
 * `current_setting()`.
 *
 * **Must** be called within a transaction (`BEGIN` … `COMMIT`) for
 * `SET LOCAL` to take effect across subsequent statements.
 *
 * @param client - A checked-out pg.PoolClient (within a transaction)
 * @param agentRole - Role of the calling agent (e.g., `'Backend'`)
 * @param agentName - Name of the calling agent (e.g., `'Backend Engineer'`)
 * @param agentId - UUID of the calling agent
 */
export async function setSessionContext(
  client: pg.PoolClient,
  agentRole: string,
  agentName: string,
  agentId: string,
): Promise<void> {
  await client.query('SET LOCAL app.agent_role = $1', [agentRole]);
  await client.query('SET LOCAL app.agent_name = $1', [agentName]);
  await client.query('SET LOCAL app.agent_id = $1', [agentId]);
}

// ── Query Helpers ────────────────────────────────────────────────────────────

/**
 * Execute a query with RLS session variables set for the calling agent.
 *
 * Acquires a client, begins a transaction, sets session variables via
 * {@link setSessionContext}, executes the query, commits, and releases
 * the client. Logs slow queries exceeding {@link SLOW_QUERY_THRESHOLD_MS}.
 *
 * @param agentRole - Role of the calling agent (for RLS)
 * @param agentName - Name of the calling agent (for RLS)
 * @param queryText - SQL query text with parameterized placeholders
 * @param params - Query parameter values
 * @returns Query result
 */
export async function queryWithRLS<T extends pg.QueryResultRow = pg.QueryResultRow>(
  agentRole: string,
  agentName: string,
  queryText: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  const p = getPool();
  const client = await p.connect();
  const start = Date.now();
  try {
    await client.query('BEGIN');
    await setSessionContext(client, agentRole, agentName, '');
    const result = await client.query<T>(queryText, params);
    await client.query('COMMIT');
    const durationMs = Date.now() - start;
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      logger.warn(
        {
          event: 'slow_query',
          durationMs,
          queryText: queryText.substring(0, 200),
          thresholdMs: SLOW_QUERY_THRESHOLD_MS,
        },
        'Slow query detected',
      );
    }
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* ignore rollback errors on already-failed connection */
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Execute a function within a transaction with RLS session variables.
 *
 * Logs slow transactions exceeding {@link SLOW_QUERY_THRESHOLD_MS}.
 *
 * @param agentRole - Role of the calling agent
 * @param agentName - Name of the calling agent
 * @param fn - Async function receiving the client to execute queries
 * @returns Result of the transaction function
 */
export async function transactionWithRLS<T>(
  agentRole: string,
  agentName: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const p = getPool();
  const client = await p.connect();
  const start = Date.now();
  try {
    await client.query('BEGIN');
    await setSessionContext(client, agentRole, agentName, '');
    const result = await fn(client);
    await client.query('COMMIT');
    const durationMs = Date.now() - start;
    if (durationMs > SLOW_QUERY_THRESHOLD_MS) {
      logger.warn(
        {
          event: 'slow_transaction',
          durationMs,
          thresholdMs: SLOW_QUERY_THRESHOLD_MS,
        },
        'Slow transaction detected',
      );
    }
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {
      /* ignore rollback errors on already-failed connection */
    });
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the connection pool.
 *
 * Resets the singleton so a fresh pool can be created on the next
 * {@link getPool} call (useful for tests and graceful restart).
 */
export async function closePool(): Promise<void> {
  if (_pool !== null) {
    await _pool.end();
    _pool = null;
    logger.info({ event: 'pool_closed' }, 'PostgreSQL connection pool closed');
  }
}

/**
 * Reset the pool singleton without draining connections.
 *
 * **For testing only.** Allows tests to start with a fresh singleton
 * after mocking dependencies.
 *
 * @internal
 */
export function _resetPool(): void {
  _pool = null;
}
