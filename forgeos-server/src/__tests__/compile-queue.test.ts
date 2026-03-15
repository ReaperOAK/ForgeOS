/**
 * Tests — compile-queue.ts (TASK-PC-BE-008)
 *
 * Unit tests for `enqueueCompileJob` and `getCompileJob` database helpers.
 * Covers all acceptance criteria:
 *
 * AC1 — Table fields: enqueue returns a job with status, retry, and metrics fields.
 * AC2 — Idempotency: repeated enqueue with same key returns existing row via upsert.
 * AC3 — Metrics fields: attempts, next_attempt_at, last_error are available on the job.
 * AC4 — Migration idempotency: tested via SQL schema (separate integration concern here
 *         we validate happy path SQL parameters are correct).
 *
 * No live database required — pool.query is fully mocked.
 *
 * @module __tests__/compile-queue
 * @ticket TASK-PC-BE-008
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const { mockQuery, mockLogger } = vi.hoisted(() => {
  const mLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return {
    mockQuery: vi.fn(),
    mockLogger: mLogger,
  };
});

vi.mock('../db/pool.js', () => ({
  pool: { query: mockQuery },
}));

vi.mock('../middleware/logging.js', () => ({
  logger: mockLogger,
}));

// ── Import SUT after mocks ────────────────────────────────────────────────────

import { enqueueCompileJob, getCompileJob } from '../db/compile-queue.js';
import type { PromptCompileJob } from '../types/index.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TICKET_ID = 'TASK-PC-BE-008';
const INPUT_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';
const IDEMPOTENCY_KEY = `${TICKET_ID}:${INPUT_HASH}`;

function makeJobRow(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'uuid-test-001',
    ticket_id: TICKET_ID,
    idempotency_key: IDEMPOTENCY_KEY,
    status: 'pending',
    attempts: 0,
    max_attempts: 3,
    next_attempt_at: new Date('2026-03-15T10:00:00Z'),
    last_error: null,
    input_hash: INPUT_HASH,
    created_at: new Date('2026-03-15T10:00:00Z'),
    updated_at: new Date('2026-03-15T10:00:00Z'),
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// enqueueCompileJob
// ═════════════════════════════════════════════════════════════════════════════

describe('enqueueCompileJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC1 — inserts a new job and returns typed PromptCompileJob with required fields', async () => {
    const row = makeJobRow();
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const job = await enqueueCompileJob(TICKET_ID, INPUT_HASH);

    expect(job.id).toBe('uuid-test-001');
    expect(job.ticket_id).toBe(TICKET_ID);
    expect(job.idempotency_key).toBe(IDEMPOTENCY_KEY);
    expect(job.status).toBe('pending');
    expect(job.attempts).toBe(0);
    expect(job.max_attempts).toBe(3);
    expect(job.input_hash).toBe(INPUT_HASH);
    expect(job.last_error).toBeNull();
    // ISO 8601 string shape
    expect(job.next_attempt_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(job.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(job.updated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('AC2 — uses ON CONFLICT idempotency key in the SQL', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeJobRow()] });

    await enqueueCompileJob(TICKET_ID, INPUT_HASH);

    const calledSql: string = mockQuery.mock.calls[0][0] as string;
    expect(calledSql).toContain('ON CONFLICT (idempotency_key) DO UPDATE');
    expect(calledSql).toContain('RETURNING *');
  });

  it('AC2 — idempotency key is composed as ticketId:inputHash', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeJobRow()] });

    await enqueueCompileJob(TICKET_ID, INPUT_HASH);

    const params: unknown[] = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(TICKET_ID);
    expect(params[1]).toBe(IDEMPOTENCY_KEY);
    expect(params[2]).toBe(INPUT_HASH);
  });

  it('AC3 — operational metrics fields (attempts, next_attempt_at, last_error) present', async () => {
    const row = makeJobRow({ attempts: 2, last_error: 'compile timeout' });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const job: PromptCompileJob = await enqueueCompileJob(TICKET_ID, INPUT_HASH);

    expect(job.attempts).toBe(2);
    expect(job.last_error).toBe('compile timeout');
    expect(typeof job.next_attempt_at).toBe('string');
  });

  it('emits structured log on successful enqueue', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeJobRow()] });

    await enqueueCompileJob(TICKET_ID, INPUT_HASH);

    expect(mockLogger.info).toHaveBeenCalledOnce();
    const logArg = mockLogger.info.mock.calls[0][0] as Record<string, unknown>;
    expect(logArg['event']).toBe('compile_job_enqueued');
    expect(logArg['ticket_id']).toBe(TICKET_ID);
    expect(logArg['idempotency_key']).toBe(IDEMPOTENCY_KEY);
  });

  it('propagates pool errors without swallowing', async () => {
    const dbErr = new Error('connection refused');
    mockQuery.mockRejectedValueOnce(dbErr);

    await expect(enqueueCompileJob(TICKET_ID, INPUT_HASH)).rejects.toThrow('connection refused');
  });

  it('handles string timestamps (not Date objects)', async () => {
    const row = makeJobRow({
      next_attempt_at: '2026-03-15T10:00:00.000Z',
      created_at: '2026-03-15T10:00:00.000Z',
      updated_at: '2026-03-15T10:00:00.000Z',
    });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const job = await enqueueCompileJob(TICKET_ID, INPUT_HASH);

    expect(job.next_attempt_at).toBe('2026-03-15T10:00:00.000Z');
    expect(job.created_at).toBe('2026-03-15T10:00:00.000Z');
    expect(job.updated_at).toBe('2026-03-15T10:00:00.000Z');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getCompileJob
// ═════════════════════════════════════════════════════════════════════════════

describe('getCompileJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns typed PromptCompileJob when row exists', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeJobRow()] });

    const job = await getCompileJob(IDEMPOTENCY_KEY);

    expect(job).not.toBeNull();
    expect(job!.idempotency_key).toBe(IDEMPOTENCY_KEY);
    expect(job!.status).toBe('pending');
  });

  it('returns null when no matching row', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const job = await getCompileJob('ticket:nonexistent');

    expect(job).toBeNull();
  });

  it('queries by idempotency_key parameter', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeJobRow()] });

    await getCompileJob(IDEMPOTENCY_KEY);

    const params: unknown[] = mockQuery.mock.calls[0][1] as unknown[];
    expect(params[0]).toBe(IDEMPOTENCY_KEY);
  });

  it('AC3 — returns operational metrics fields on the job', async () => {
    const row = makeJobRow({ attempts: 1, last_error: 'hash mismatch', status: 'running' });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const job = await getCompileJob(IDEMPOTENCY_KEY);

    expect(job!.attempts).toBe(1);
    expect(job!.last_error).toBe('hash mismatch');
    expect(job!.status).toBe('running');
    expect(typeof job!.next_attempt_at).toBe('string');
  });

  it('propagates pool errors without swallowing', async () => {
    mockQuery.mockRejectedValueOnce(new Error('db unavailable'));

    await expect(getCompileJob(IDEMPOTENCY_KEY)).rejects.toThrow('db unavailable');
  });

  it('returns null input_hash when column is null', async () => {
    const row = makeJobRow({ input_hash: null });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const job = await getCompileJob(IDEMPOTENCY_KEY);

    expect(job!.input_hash).toBeNull();
  });

  it('coerces numeric attempts from database string representation', async () => {
    const row = makeJobRow({ attempts: '2' as unknown as number, max_attempts: '5' as unknown as number });
    mockQuery.mockResolvedValueOnce({ rows: [row] });

    const job = await getCompileJob(IDEMPOTENCY_KEY);

    expect(job!.attempts).toBe(2);
    expect(job!.max_attempts).toBe(5);
  });
});
