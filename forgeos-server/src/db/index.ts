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

export { seed, type SeedResult } from './seed.js';

export { importTickets, type ImportSummary } from './import.js';

export {
  acquireFileLocks,
  checkFileConflicts,
  releaseFileLocks,
  getActiveLocksForTicket,
  getActiveLockForFile,
  FileConflictError,
  type FileConflictDetail,
  type AcquireFileLocksResult,
  type ReleaseFileLocksResult,
} from './file-mutex.js';
