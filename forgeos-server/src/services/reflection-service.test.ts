/**
 * Unit tests for the ReflectionService.
 *
 * Uses mocked `Pool` and `EmbeddingService` to verify:
 * - Skips tickets that do not exist
 * - Skips tickets with rework_count === 0
 * - Extracts rejection reasons from STAGE_REJECTED events
 * - Extracts fix notes from STAGE_ADVANCED events
 * - Generates embedding via EmbeddingService
 * - Stores lesson + embedding in a transaction
 * - Rolls back on embedding failure
 * - Rolls back on DB insert failure
 *
 * @ticket TASK-INT-BE034
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ReflectionService, type ReflectionLesson } from './reflection-service.js';

// ── Mock Types ───────────────────────────────────────────────────────────────

interface MockClient {
  query: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
}

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
}

interface MockEmbeddingService {
  embedText: ReturnType<typeof vi.fn>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function createMockPool(): MockPool {
  return {
    query: vi.fn(),
    connect: vi.fn(),
  };
}

function createMockClient(): MockClient {
  return {
    query: vi.fn(),
    release: vi.fn(),
  };
}

function createMockEmbeddingService(): MockEmbeddingService {
  return {
    embedText: vi.fn(),
  };
}

/** Build a ticket row with given overrides. */
function ticketRow(overrides: Partial<{
  ticket_id: string;
  current_stage: string;
  claimed_by: string | null;
  rework_count: number;
}> = {}): {
  ticket_id: string;
  current_stage: string;
  claimed_by: string | null;
  rework_count: number;
} {
  return {
    ticket_id: 'TASK-001',
    current_stage: 'QA',
    claimed_by: 'Backend',
    rework_count: 1,
    ...overrides,
  };
}

/** Build a STAGE_REJECTED event row. */
function rejectionEvent(reason: string, createdAt = '2026-03-10T10:00:00Z'): {
  id: string;
  ticket_id: string;
  event_type: string;
  payload: { reason: string };
  created_at: string;
} {
  return {
    id: crypto.randomUUID(),
    ticket_id: 'TASK-001',
    event_type: 'STAGE_REJECTED',
    payload: { reason },
    created_at: createdAt,
  };
}

/** Build a STAGE_ADVANCED event row. */
function completionEvent(notes: string | undefined, createdAt = '2026-03-10T12:00:00Z'): {
  id: string;
  ticket_id: string;
  event_type: string;
  payload: { evidence: { notes?: string } };
  created_at: string;
} {
  return {
    id: crypto.randomUUID(),
    ticket_id: 'TASK-001',
    event_type: 'STAGE_ADVANCED',
    payload: { evidence: { notes } },
    created_at: createdAt,
  };
}

const FAKE_EMBEDDING = [0.1, 0.2, 0.3, 0.4, 0.5];
const FAKE_LESSON_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

// ── Test Setup ───────────────────────────────────────────────────────────────

let pool: MockPool;
let client: MockClient;
let embeddingService: MockEmbeddingService;
let service: ReflectionService;

beforeEach(() => {
  pool = createMockPool();
  client = createMockClient();
  embeddingService = createMockEmbeddingService();

  pool.connect.mockResolvedValue(client);
  embeddingService.embedText.mockResolvedValue(FAKE_EMBEDDING);

  // Default client.query: BEGIN, INSERT lessons, INSERT embeddings, COMMIT
  client.query.mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.includes('RETURNING id')) {
      return { rows: [{ id: FAKE_LESSON_ID }] };
    }
    return { rows: [] };
  });

  service = new ReflectionService(
    pool as unknown as import('pg').Pool,
    embeddingService as unknown as import('./embedding-service.js').EmbeddingService,
  );
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ReflectionService', () => {
  describe('reflectOnTicket — skip conditions', () => {
    it('returns null when ticket does not exist', async () => {
      pool.query.mockResolvedValueOnce({ rows: [] });

      const result = await service.reflectOnTicket('NONEXISTENT');

      expect(result).toBeNull();
      expect(pool.connect).not.toHaveBeenCalled();
    });

    it('returns null when rework_count is 0', async () => {
      pool.query.mockResolvedValueOnce({
        rows: [ticketRow({ rework_count: 0 })],
      });

      const result = await service.reflectOnTicket('TASK-001');

      expect(result).toBeNull();
      expect(pool.connect).not.toHaveBeenCalled();
    });
  });

  describe('reflectOnTicket — happy path', () => {
    function setupHappyPath(
      rejections: ReturnType<typeof rejectionEvent>[] = [rejectionEvent('Coverage below 80%')],
      completions: ReturnType<typeof completionEvent>[] = [completionEvent('Added 15 new tests')],
      ticket = ticketRow(),
    ): void {
      // 1st query: ticket
      pool.query.mockResolvedValueOnce({ rows: [ticket] });
      // 2nd query: rejection events
      pool.query.mockResolvedValueOnce({ rows: rejections });
      // 3rd query: completion events
      pool.query.mockResolvedValueOnce({ rows: completions });
    }

    it('extracts lesson from single rejection cycle', async () => {
      setupHappyPath();

      const result = await service.reflectOnTicket('TASK-001');

      expect(result).not.toBeNull();
      const lesson = result as ReflectionLesson;
      expect(lesson.ticketId).toBe('TASK-001');
      expect(lesson.stage).toBe('QA');
      expect(lesson.agentRole).toBe('Backend');
      expect(lesson.whatFailed).toBe('Coverage below 80%');
      expect(lesson.whatFixedIt).toBe('Added 15 new tests');
      expect(lesson.patternLearned).toContain('Coverage below 80%');
      expect(lesson.patternLearned).toContain('Added 15 new tests');
      expect(lesson.reworkCount).toBe(1);
    });

    it('extracts lesson from multiple rejection cycles', async () => {
      setupHappyPath(
        [
          rejectionEvent('Missing error handling', '2026-03-10T10:00:00Z'),
          rejectionEvent('No input validation', '2026-03-10T14:00:00Z'),
        ],
        [
          completionEvent('Added try-catch blocks', '2026-03-10T12:00:00Z'),
          completionEvent('Added Zod schema validation', '2026-03-10T16:00:00Z'),
        ],
        ticketRow({ rework_count: 2 }),
      );

      const result = await service.reflectOnTicket('TASK-001');

      expect(result).not.toBeNull();
      const lesson = result as ReflectionLesson;
      expect(lesson.whatFailed).toBe('Missing error handling; No input validation');
      expect(lesson.whatFixedIt).toBe('Added Zod schema validation');
      expect(lesson.reworkCount).toBe(2);
    });

    it('uses default fix message when completion has no notes', async () => {
      setupHappyPath(
        [rejectionEvent('Lint errors')],
        [completionEvent(undefined)],
      );

      const result = await service.reflectOnTicket('TASK-001');

      expect(result).not.toBeNull();
      expect((result as ReflectionLesson).whatFixedIt).toBe('Fixed via rework');
    });

    it('uses default fix message when no completion events exist', async () => {
      setupHappyPath(
        [rejectionEvent('Type errors')],
        [], // no completion events
      );

      const result = await service.reflectOnTicket('TASK-001');

      expect(result).not.toBeNull();
      expect((result as ReflectionLesson).whatFixedIt).toBe('Fixed via rework');
    });

    it('uses "unknown" agent when claimed_by is null', async () => {
      setupHappyPath(
        [rejectionEvent('Coverage below 80%')],
        [completionEvent('Added tests')],
        ticketRow({ claimed_by: null }),
      );

      const result = await service.reflectOnTicket('TASK-001');

      expect(result).not.toBeNull();
      expect((result as ReflectionLesson).agentRole).toBe('unknown');
    });

    it('uses "unknown rejection" when event payload has no reason', async () => {
      const evt = rejectionEvent('');
      evt.payload = { reason: undefined as unknown as string };
      // Simulate missing reason by clearing it
      pool.query.mockResolvedValueOnce({ rows: [ticketRow()] });
      pool.query.mockResolvedValueOnce({
        rows: [{
          ...evt,
          payload: {},
        }],
      });
      pool.query.mockResolvedValueOnce({ rows: [completionEvent('Fixed it')] });

      const result = await service.reflectOnTicket('TASK-001');

      expect(result).not.toBeNull();
      expect((result as ReflectionLesson).whatFailed).toBe('unknown rejection');
    });
  });

  describe('reflectOnTicket — embedding integration', () => {
    function setupHappyPath(): void {
      pool.query.mockResolvedValueOnce({ rows: [ticketRow()] });
      pool.query.mockResolvedValueOnce({ rows: [rejectionEvent('Test failure')] });
      pool.query.mockResolvedValueOnce({ rows: [completionEvent('Fixed tests')] });
    }

    it('calls embedText with lesson text', async () => {
      setupHappyPath();

      await service.reflectOnTicket('TASK-001');

      expect(embeddingService.embedText).toHaveBeenCalledOnce();
      const callArg = embeddingService.embedText.mock.calls[0][0] as string;
      expect(callArg).toContain('Test failure');
      expect(callArg).toContain('Fixed tests');
    });

    it('propagates embedding service errors', async () => {
      setupHappyPath();
      embeddingService.embedText.mockRejectedValueOnce(new Error('API timeout'));

      await expect(service.reflectOnTicket('TASK-001')).rejects.toThrow('API timeout');
    });
  });

  describe('reflectOnTicket — database transaction', () => {
    function setupHappyPath(): void {
      pool.query.mockResolvedValueOnce({ rows: [ticketRow()] });
      pool.query.mockResolvedValueOnce({ rows: [rejectionEvent('Coverage issue')] });
      pool.query.mockResolvedValueOnce({ rows: [completionEvent('Added tests')] });
    }

    it('uses a transaction (BEGIN / COMMIT)', async () => {
      setupHappyPath();

      await service.reflectOnTicket('TASK-001');

      const clientCalls = client.query.mock.calls.map(
        (c: [string, ...unknown[]]) => (typeof c[0] === 'string' ? c[0] : ''),
      );
      expect(clientCalls[0]).toBe('BEGIN');
      expect(clientCalls[clientCalls.length - 1]).toBe('COMMIT');
    });

    it('inserts lesson with correct parameters', async () => {
      setupHappyPath();

      await service.reflectOnTicket('TASK-001');

      // Find the INSERT INTO lessons call
      const insertCall = client.query.mock.calls.find(
        (c: [string, unknown[]?]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO lessons'),
      );
      expect(insertCall).toBeDefined();
      const params = insertCall![1] as unknown[];
      expect(params[0]).toBe('TASK-001');       // ticket_id
      expect(params[1]).toBe('QA');             // stage
      expect(params[2]).toBe('Backend');        // agent_role
      expect(typeof params[3]).toBe('string');  // lesson_text
      expect(params[4]).toBe('rework');         // category
      expect(params[5]).toEqual(['auto-reflected']); // tags
      expect(params[6]).toBe(1);                // rework_count
    });

    it('inserts embedding with lesson_id and model_name', async () => {
      setupHappyPath();

      await service.reflectOnTicket('TASK-001');

      const embedCall = client.query.mock.calls.find(
        (c: [string, unknown[]?]) => typeof c[0] === 'string' && c[0].includes('INSERT INTO lesson_embeddings'),
      );
      expect(embedCall).toBeDefined();
      const params = embedCall![1] as unknown[];
      expect(params[0]).toBe(FAKE_LESSON_ID);
      expect(params[1]).toBe(JSON.stringify(FAKE_EMBEDDING));
      expect(params[2]).toBe('mxbai-embed-large');
    });

    it('releases client after successful transaction', async () => {
      setupHappyPath();

      await service.reflectOnTicket('TASK-001');

      expect(client.release).toHaveBeenCalledOnce();
    });

    it('rolls back and releases client on lesson insert failure', async () => {
      setupHappyPath();

      client.query.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO lessons')) {
          throw new Error('constraint violation');
        }
        return { rows: [] };
      });

      await expect(service.reflectOnTicket('TASK-001')).rejects.toThrow('constraint violation');

      const callArgs = client.query.mock.calls.map(
        (c: [string, ...unknown[]]) => c[0],
      );
      expect(callArgs).toContain('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });

    it('rolls back and releases client on embedding insert failure', async () => {
      setupHappyPath();

      let insertCount = 0;
      client.query.mockImplementation((sql: string) => {
        if (typeof sql === 'string' && sql.includes('INSERT INTO lesson_embeddings')) {
          throw new Error('vector dimension mismatch');
        }
        if (typeof sql === 'string' && sql.includes('RETURNING id')) {
          insertCount++;
          return { rows: [{ id: FAKE_LESSON_ID }] };
        }
        return { rows: [] };
      });

      await expect(service.reflectOnTicket('TASK-001')).rejects.toThrow('vector dimension mismatch');

      const callArgs = client.query.mock.calls.map(
        (c: [string, ...unknown[]]) => c[0],
      );
      expect(callArgs).toContain('ROLLBACK');
      expect(client.release).toHaveBeenCalledOnce();
    });
  });
});
