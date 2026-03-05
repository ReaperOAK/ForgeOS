/**
 * Database module barrel exports.
 *
 * Re-exports pool management, migration runner, and types from submodules.
 *
 * @module db
 * @ticket TASK-FOS-01-002
 */

export {
  getPool,
  pool,
  healthCheck,
  setSessionContext,
  queryWithRLS,
  transactionWithRLS,
  closePool,
  _resetPool,
  type PoolHealthStats,
} from './pool.js';

export { runMigrations } from './migrate.js';
