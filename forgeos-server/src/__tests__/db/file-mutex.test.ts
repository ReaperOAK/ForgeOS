/**
 * File-Level Mutex Tests — TASK-FOS-04-003
 *
 * Unit tests for the file-level mutex system: acquireFileLocks,
 * checkFileConflicts, releaseFileLocks, getActiveLocksForTicket,
 * and getActiveLockForFile.
 *
 * Uses Vitest mocks to isolate from real PostgreSQL. No live database required.
 *
 * TDD Evidence:
 * - RED: Tests written describing desired behavior before implementation.
 * - GREEN: Implementation written to pass all tests.
 * - REFACTOR: Code cleaned up with domain error types and result types.
 *
 * @module __tests__/db/file-mutex
 * @ticket TASK-FOS-04-003
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock pg before any imports ───────────────────────────────────────────────

const mockPoolQuery = vi.fn();
const mockPoolConnect = vi.fn();

const mockClientQuery = vi.fn();
const mockClientRelease = vi.fn();

const mockClient = {
  query: mockClientQuery,
  release: mockClientRelease,
};

const mockPoolInstance = {
  query: mockPoolQuery,
  connect: mockPoolConnect,
  on: vi.fn(),
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

describe('File-Level Mutex — file-mutex.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPoolConnect.mockResolvedValue(mockClient);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── checkFileConflicts ───────────────────────────────────────────────────

  describe('checkFileConflicts', () => {
    it('should return empty array when no file paths are provided', async () => {
      const { checkFileConflicts } = await import('../../db/file-mutex.js');
      const result = await checkFileConflicts('TASK-FOS-04-003', []);
      expect(result).toEqual([]);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('should return empty array when no conflicts exist', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const { checkFileConflicts } = await import('../../db/file-mutex.js');
      const result = await checkFileConflicts('TASK-FOS-04-003', ['src/db/pool.ts']);

      expect(result).toEqual([]);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT file_path, ticket_id'),
        [['src/db/pool.ts'], 'TASK-FOS-04-003'],
      );
    });

    it('should return conflict details when files are locked by other tickets', async () => {
      const lockedAt = new Date('2026-03-07T12:00:00Z');
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/db/pool.ts',
            ticket_id: 'TASK-FOS-01-002',
            locked_by: 'agent-uuid-001',
            machine_id: 'other-machine',
            locked_at: lockedAt.toISOString(),
          },
        ],
      });

      const { checkFileConflicts } = await import('../../db/file-mutex.js');
      const result = await checkFileConflicts('TASK-FOS-04-003', ['src/db/pool.ts']);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        file_path: 'src/db/pool.ts',
        locked_by_ticket: 'TASK-FOS-01-002',
        locked_by_agent: 'agent-uuid-001',
        locked_by_machine: 'other-machine',
        locked_at: lockedAt.toISOString(),
      });
    });

    it('should return multiple conflict details for multiple locked files', async () => {
      const lockedAt = new Date('2026-03-07T12:00:00Z');
      mockPoolQuery.mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/db/pool.ts',
            ticket_id: 'TASK-FOS-01-002',
            locked_by: 'agent-1',
            machine_id: 'machine-1',
            locked_at: lockedAt.toISOString(),
          },
          {
            file_path: 'src/config.ts',
            ticket_id: 'TASK-FOS-01-003',
            locked_by: 'agent-2',
            machine_id: 'machine-2',
            locked_at: lockedAt.toISOString(),
          },
        ],
      });

      const { checkFileConflicts } = await import('../../db/file-mutex.js');
      const result = await checkFileConflicts('TASK-FOS-04-003', [
        'src/db/pool.ts',
        'src/config.ts',
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]?.locked_by_ticket).toBe('TASK-FOS-01-002');
      expect(result[1]?.locked_by_ticket).toBe('TASK-FOS-01-003');
    });
  });

  // ── acquireFileLocks ─────────────────────────────────────────────────────

  describe('acquireFileLocks', () => {
    it('should return empty result when no file paths are provided', async () => {
      const { acquireFileLocks } = await import('../../db/file-mutex.js');
      const result = await acquireFileLocks('TASK-FOS-04-003', [], null, null);

      expect(result).toEqual({
        ticket_id: 'TASK-FOS-04-003',
        locked_files: [],
        lock_count: 0,
      });
      expect(mockPoolConnect).not.toHaveBeenCalled();
    });

    it('should acquire locks for all files when no conflicts exist', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT ... ON CONFLICT DO NOTHING RETURNING
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          { file_path: 'src/db/file-mutex.ts' },
          { file_path: 'src/db/pool.ts' },
        ],
      });
      // Event inserts (one per locked file)
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { acquireFileLocks } = await import('../../db/file-mutex.js');
      const result = await acquireFileLocks(
        'TASK-FOS-04-003',
        ['src/db/file-mutex.ts', 'src/db/pool.ts'],
        'agent-uuid-123',
        'pop-os',
      );

      expect(result.ticket_id).toBe('TASK-FOS-04-003');
      expect(result.locked_files).toEqual(['src/db/file-mutex.ts', 'src/db/pool.ts']);
      expect(result.lock_count).toBe(2);

      // Verify BEGIN was called
      expect(mockClientQuery).toHaveBeenCalledWith('BEGIN');
      // Verify COMMIT was called
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      // Verify client was released
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it('should throw FileConflictError when files are locked by other tickets', async () => {
      const lockedAt = new Date('2026-03-07T12:00:00Z');

      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT returns only 1 of 2 files (one was skipped due to conflict)
      mockClientQuery.mockResolvedValueOnce({
        rows: [{ file_path: 'src/db/file-mutex.ts' }],
      });
      // Conflict query returns the conflicting lock detail
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/db/pool.ts',
            ticket_id: 'TASK-FOS-01-002',
            locked_by: 'other-agent',
            machine_id: 'other-machine',
            locked_at: lockedAt.toISOString(),
          },
        ],
      });
      // ROLLBACK
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { acquireFileLocks, FileConflictError } = await import('../../db/file-mutex.js');

      await expect(
        acquireFileLocks(
          'TASK-FOS-04-003',
          ['src/db/file-mutex.ts', 'src/db/pool.ts'],
          'agent-uuid-123',
          'pop-os',
        ),
      ).rejects.toThrow(FileConflictError);

      // Verify the ROLLBACK was called (4th call: BEGIN, INSERT, conflict query, ROLLBACK)
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it('should include conflict details in FileConflictError', async () => {
      const lockedAt = new Date('2026-03-07T12:00:00Z');

      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT returns 0 files (all conflicted)
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // Conflict query
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          {
            file_path: 'src/db/pool.ts',
            ticket_id: 'TASK-FOS-01-002',
            locked_by: 'other-agent',
            machine_id: 'other-machine',
            locked_at: lockedAt.toISOString(),
          },
        ],
      });
      // ROLLBACK
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { acquireFileLocks, FileConflictError } = await import('../../db/file-mutex.js');

      try {
        await acquireFileLocks(
          'TASK-FOS-04-003',
          ['src/db/pool.ts'],
          'agent-uuid-123',
          'pop-os',
        );
        expect.fail('Should have thrown FileConflictError');
      } catch (err) {
        expect(err).toBeInstanceOf(FileConflictError);
        const error = err as InstanceType<typeof FileConflictError>;
        expect(error.code).toBe('FILE_CONFLICT');
        expect(error.statusCode).toBe(409);
        expect(error.ticketId).toBe('TASK-FOS-04-003');
        expect(error.conflicts).toHaveLength(1);
        expect(error.conflicts[0]?.file_path).toBe('src/db/pool.ts');
        expect(error.conflicts[0]?.locked_by_ticket).toBe('TASK-FOS-01-002');
      }
    });

    it('should record FILE_LOCKED events for each acquired lock', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT returns 1 file
      mockClientQuery.mockResolvedValueOnce({
        rows: [{ file_path: 'src/db/file-mutex.ts' }],
      });
      // Event insert
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { acquireFileLocks } = await import('../../db/file-mutex.js');
      await acquireFileLocks(
        'TASK-FOS-04-003',
        ['src/db/file-mutex.ts'],
        'agent-uuid-123',
        'pop-os',
      );

      // Verify the event INSERT was called with FILE_LOCKED
      const eventInsertCall = mockClientQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO events') &&
          call[0].includes('FILE_LOCKED'),
      );
      expect(eventInsertCall).toBeDefined();
      expect(eventInsertCall?.[1]).toContain('TASK-FOS-04-003');
    });

    it('should use INSERT ... ON CONFLICT DO NOTHING for concurrent safety', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT
      mockClientQuery.mockResolvedValueOnce({
        rows: [{ file_path: 'src/db/file-mutex.ts' }],
      });
      // Event insert
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { acquireFileLocks } = await import('../../db/file-mutex.js');
      await acquireFileLocks(
        'TASK-FOS-04-003',
        ['src/db/file-mutex.ts'],
        'agent-uuid-123',
        'pop-os',
      );

      // Verify the INSERT uses ON CONFLICT ... DO NOTHING
      const insertCall = mockClientQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('ON CONFLICT') &&
          call[0].includes('DO NOTHING'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall?.[0]).toContain('WHERE released_at IS NULL');
    });

    it('should rollback on unexpected errors and release client', async () => {
      const dbError = new Error('connection lost');

      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // INSERT throws
      mockClientQuery.mockRejectedValueOnce(dbError);
      // ROLLBACK
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { acquireFileLocks } = await import('../../db/file-mutex.js');

      await expect(
        acquireFileLocks(
          'TASK-FOS-04-003',
          ['src/db/file-mutex.ts'],
          'agent-uuid-123',
          'pop-os',
        ),
      ).rejects.toThrow('connection lost');

      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });
  });

  // ── releaseFileLocks ─────────────────────────────────────────────────────

  describe('releaseFileLocks', () => {
    it('should release all active locks for a ticket', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE RETURNING
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          { file_path: 'src/db/file-mutex.ts', locked_by: 'agent-1', machine_id: 'pop-os' },
          { file_path: 'src/db/pool.ts', locked_by: 'agent-1', machine_id: 'pop-os' },
        ],
      });
      // Event inserts (one per released file)
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { releaseFileLocks } = await import('../../db/file-mutex.js');
      const result = await releaseFileLocks('TASK-FOS-04-003');

      expect(result.ticket_id).toBe('TASK-FOS-04-003');
      expect(result.released_files).toEqual(['src/db/file-mutex.ts', 'src/db/pool.ts']);
      expect(result.release_count).toBe(2);
      expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
      expect(mockClientRelease).toHaveBeenCalled();
    });

    it('should return empty result when no active locks exist', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE returns no rows
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { releaseFileLocks } = await import('../../db/file-mutex.js');
      const result = await releaseFileLocks('TASK-FOS-04-003');

      expect(result.ticket_id).toBe('TASK-FOS-04-003');
      expect(result.released_files).toEqual([]);
      expect(result.release_count).toBe(0);
    });

    it('should record FILE_UNLOCKED events for each released lock', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE RETURNING
      mockClientQuery.mockResolvedValueOnce({
        rows: [
          { file_path: 'src/db/file-mutex.ts', locked_by: 'agent-1', machine_id: 'pop-os' },
        ],
      });
      // Event insert
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { releaseFileLocks } = await import('../../db/file-mutex.js');
      await releaseFileLocks('TASK-FOS-04-003');

      const eventInsertCall = mockClientQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO events') &&
          call[0].includes('FILE_UNLOCKED'),
      );
      expect(eventInsertCall).toBeDefined();
      expect(eventInsertCall?.[1]).toContain('TASK-FOS-04-003');
    });

    it('should set released_at = NOW() via UPDATE query', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE RETURNING
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // COMMIT
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { releaseFileLocks } = await import('../../db/file-mutex.js');
      await releaseFileLocks('TASK-FOS-04-003');

      const updateCall = mockClientQuery.mock.calls.find(
        (call) =>
          typeof call[0] === 'string' &&
          call[0].includes('UPDATE file_locks') &&
          call[0].includes('released_at = NOW()'),
      );
      expect(updateCall).toBeDefined();
      expect(updateCall?.[0]).toContain('AND released_at IS NULL');
    });

    it('should rollback on errors and release client', async () => {
      // BEGIN
      mockClientQuery.mockResolvedValueOnce({ rows: [] });
      // UPDATE throws
      mockClientQuery.mockRejectedValueOnce(new Error('db error'));
      // ROLLBACK
      mockClientQuery.mockResolvedValueOnce({ rows: [] });

      const { releaseFileLocks } = await import('../../db/file-mutex.js');

      await expect(releaseFileLocks('TASK-FOS-04-003')).rejects.toThrow('db error');
      expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
      expect(mockClientRelease).toHaveBeenCalled();
    });
  });

  // ── getActiveLocksForTicket ──────────────────────────────────────────────

  describe('getActiveLocksForTicket', () => {
    it('should return active locks for the given ticket', async () => {
      const locks = [
        {
          id: 'lock-uuid-1',
          file_path: 'src/db/file-mutex.ts',
          ticket_id: 'TASK-FOS-04-003',
          locked_by: 'agent-1',
          machine_id: 'pop-os',
          locked_at: '2026-03-07T12:00:00Z',
          released_at: null,
        },
      ];
      mockPoolQuery.mockResolvedValueOnce({ rows: locks });

      const { getActiveLocksForTicket } = await import('../../db/file-mutex.js');
      const result = await getActiveLocksForTicket('TASK-FOS-04-003');

      expect(result).toEqual(locks);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE ticket_id = $1'),
        ['TASK-FOS-04-003'],
      );
    });

    it('should return empty array when no active locks exist', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const { getActiveLocksForTicket } = await import('../../db/file-mutex.js');
      const result = await getActiveLocksForTicket('TASK-FOS-04-003');

      expect(result).toEqual([]);
    });
  });

  // ── getActiveLockForFile ─────────────────────────────────────────────────

  describe('getActiveLockForFile', () => {
    it('should return the active lock for a file', async () => {
      const lock = {
        id: 'lock-uuid-1',
        file_path: 'src/db/file-mutex.ts',
        ticket_id: 'TASK-FOS-04-003',
        locked_by: 'agent-1',
        machine_id: 'pop-os',
        locked_at: '2026-03-07T12:00:00Z',
        released_at: null,
      };
      mockPoolQuery.mockResolvedValueOnce({ rows: [lock] });

      const { getActiveLockForFile } = await import('../../db/file-mutex.js');
      const result = await getActiveLockForFile('src/db/file-mutex.ts');

      expect(result).toEqual(lock);
      expect(mockPoolQuery).toHaveBeenCalledWith(
        expect.stringContaining('WHERE file_path = $1'),
        ['src/db/file-mutex.ts'],
      );
    });

    it('should return null when the file has no active lock', async () => {
      mockPoolQuery.mockResolvedValueOnce({ rows: [] });

      const { getActiveLockForFile } = await import('../../db/file-mutex.js');
      const result = await getActiveLockForFile('src/db/file-mutex.ts');

      expect(result).toBeNull();
    });
  });

  // ── FileConflictError ────────────────────────────────────────────────────

  describe('FileConflictError', () => {
    it('should have correct properties', async () => {
      const { FileConflictError } = await import('../../db/file-mutex.js');

      const error = new FileConflictError('TASK-FOS-04-003', [
        {
          file_path: 'src/db/pool.ts',
          locked_by_ticket: 'TASK-FOS-01-002',
          locked_by_agent: 'agent-1',
          locked_by_machine: 'machine-1',
          locked_at: '2026-03-07T12:00:00Z',
        },
      ]);

      expect(error.code).toBe('FILE_CONFLICT');
      expect(error.statusCode).toBe(409);
      expect(error.ticketId).toBe('TASK-FOS-04-003');
      expect(error.conflicts).toHaveLength(1);
      expect(error.name).toBe('FileConflictError');
      expect(error.message).toContain('src/db/pool.ts');
      expect(error).toBeInstanceOf(Error);
    });
  });
});
