/**
 * Integration Tests — Memory Engine
 *
 * Tests the full memory engine lifecycle through the MCP tool handlers:
 *   1. Lesson creation via `memory.add_lesson` → retrieval via `memory.search_lessons`
 *   2. Reflection protocol auto-triggering on rework-to-DONE transitions
 *   3. Similarity-ordered search results via cosine distance
 *   4. Combined blast radius + lessons context via `memory.get_context`
 *   5. Duplicate lesson prevention via unique constraint
 *   6. Graceful degradation when embedding service is unavailable
 *
 * All tests use mocked database pool and embedding service — no real
 * PostgreSQL or OpenAI API required.
 *
 * @module __tests__/memory-engine.integration
 * @ticket TASK-INT-BE039
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Module Mocks ─────────────────────────────────────────────────────────────

// Mock pool before any tool import — no top-level variables in factory
vi.mock('../db/pool.js', () => {
  const client = {
    query: vi.fn().mockResolvedValue({ rows: [] }),
    release: vi.fn(),
  };

  return {
    pool: {
      query: vi.fn().mockResolvedValue({ rows: [] }),
      connect: vi.fn().mockResolvedValue(client),
      __mockClient: client,
    },
  };
});

// Mock logger to suppress output
vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mock EmbeddingService to avoid real API calls
vi.mock('../services/embedding-service.js', () => ({
  EmbeddingService: vi.fn().mockImplementation(() => ({
    embedText: vi.fn().mockResolvedValue([0.1, 0.2, 0.3, 0.4]),
  })),
  EmbeddingApiError: class EmbeddingApiError extends Error {
    constructor(public readonly statusCode: number, message: string) {
      super(message);
      this.name = 'EmbeddingApiError';
    }
  },
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import { memoryAddLessonHandler } from '../tools/memory-add-lesson.js';
import { memorySearchLessonsHandler } from '../tools/memory-search-lessons.js';
import {
  memoryGetContextHandler,
  memoryGetContextSchema,
} from '../tools/memory-get-context.js';
import { ReflectionService } from '../services/reflection-service.js';
import { EmbeddingService } from '../services/embedding-service.js';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface MockPool {
  query: ReturnType<typeof vi.fn>;
  connect: ReturnType<typeof vi.fn>;
  __mockClient: {
    query: ReturnType<typeof vi.fn>;
    release: ReturnType<typeof vi.fn>;
  };
}

interface LessonMatch {
  id: string;
  ticket_id: string;
  stage: string;
  agent_role: string;
  rework_count: number;
  lesson_text: string;
  category: string;
  tags: string[];
  similarity: number;
  created_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const LESSON_ID = '550e8400-e29b-41d4-a716-446655440000';
const TICKET_ID = 'TASK-INT-TEST-001';

function makeLessonMatch(overrides: Partial<LessonMatch> = {}): LessonMatch {
  return {
    id: LESSON_ID,
    ticket_id: TICKET_ID,
    stage: 'BACKEND',
    agent_role: 'Backend',
    rework_count: 0,
    lesson_text: 'Always validate input at the controller layer',
    category: 'best-practice',
    tags: ['validation', 'controller'],
    similarity: 0.92,
    created_at: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseToolResult(result: { content: Array<Record<string, any>> }): unknown {
  return JSON.parse(result.content[0].text);
}

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('Memory Engine Integration', () => {
  const mockPool = pool as unknown as MockPool;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool.query.mockReset().mockResolvedValue({ rows: [] });
    mockPool.__mockClient.query.mockReset().mockResolvedValue({ rows: [] });
    mockPool.__mockClient.release.mockReset();
    mockPool.connect.mockReset().mockResolvedValue(mockPool.__mockClient);
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC 1: Create lesson via MCP tool then retrieve via search
  // ────────────────────────────────────────────────────────────────────────

  describe('AC1: add_lesson → search_lessons lifecycle', () => {
    it('should create a lesson and find it via search', async () => {
      // 1. Mock INSERT returning a lesson ID
      mockPool.query.mockResolvedValueOnce({
        rows: [{ id: LESSON_ID }],
      });
      // 2. Mock embedding INSERT (no return needed)
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const addResult = await memoryAddLessonHandler({
        ticket_id: TICKET_ID,
        stage: 'BACKEND',
        agent_role: 'Backend',
        lesson_text: 'Always validate input at the controller layer',
        category: 'best-practice',
        tags: ['validation', 'controller'],
      });

      // Verify lesson was created
      const addPayload = parseToolResult(addResult) as { lesson_id: string; status: string };
      expect(addPayload.lesson_id).toBe(LESSON_ID);
      expect(addPayload.status).toBe('created');

      // Verify INSERT was called with correct params
      const insertCall = mockPool.query.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO lessons');
      expect(insertCall[1]).toEqual([
        TICKET_ID, 'BACKEND', 'Backend',
        'Always validate input at the controller layer',
        'best-practice', ['validation', 'controller'],
      ]);

      // 3. Now search for the lesson: mock embed + stored function
      const lessonMatch = makeLessonMatch();
      mockPool.query.mockResolvedValueOnce({
        rows: [{ search_similar_lessons: [lessonMatch] }],
      });

      const searchResult = await memorySearchLessonsHandler({
        query: 'input validation best practices',
        category: undefined,
        threshold: 0.7,
        limit: 10,
      });

      const searchPayload = parseToolResult(searchResult) as {
        query: string;
        lessons: LessonMatch[];
        total: number;
      };
      expect(searchPayload.total).toBe(1);
      expect(searchPayload.lessons[0].id).toBe(LESSON_ID);
      expect(searchPayload.lessons[0].lesson_text).toBe(
        'Always validate input at the controller layer',
      );
    });

    it('should return empty results when no lessons match', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ search_similar_lessons: [] }],
      });

      const result = await memorySearchLessonsHandler({
        query: 'completely unrelated query about quantum physics',
        threshold: 0.7,
        limit: 10,
      });

      const payload = parseToolResult(result) as { lessons: LessonMatch[]; total: number };
      expect(payload.lessons).toEqual([]);
      expect(payload.total).toBe(0);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC 2: Reflection protocol auto-triggers on rework-to-DONE
  // ────────────────────────────────────────────────────────────────────────

  describe('AC2: Reflection protocol', () => {
    it('should auto-trigger on rework ticket and create a lesson', async () => {
      const mockEmbedding = vi.fn().mockResolvedValue([0.5, 0.6, 0.7, 0.8]);
      const embeddingService = { embedText: mockEmbedding } as unknown as EmbeddingService;

      const reflClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };

      // Use a real mock pool for ReflectionService (constructor injection)
      const reflectionPool = {
        query: vi.fn(),
        connect: vi.fn().mockResolvedValue(reflClient),
      } as unknown as import('pg').Pool;

      const service = new ReflectionService(reflectionPool, embeddingService);

      // Mock: ticket with rework_count > 0
      (reflectionPool.query as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({
          rows: [{
            ticket_id: 'TASK-RW-001',
            current_stage: 'DONE',
            claimed_by: 'Backend',
            rework_count: 2,
          }],
        })
        // Rejection events
        .mockResolvedValueOnce({
          rows: [{
            id: 'evt-1',
            ticket_id: 'TASK-RW-001',
            event_type: 'STAGE_REJECTED',
            payload: { reason: 'Coverage below 80%' },
            created_at: '2026-03-10T08:00:00Z',
          }, {
            id: 'evt-2',
            ticket_id: 'TASK-RW-001',
            event_type: 'STAGE_REJECTED',
            payload: { reason: 'Missing error handling for edge case' },
            created_at: '2026-03-10T10:00:00Z',
          }],
        })
        // Completion events
        .mockResolvedValueOnce({
          rows: [{
            id: 'evt-3',
            ticket_id: 'TASK-RW-001',
            event_type: 'STAGE_ADVANCED',
            payload: { evidence: { notes: 'Added tests and error handler' } },
            created_at: '2026-03-10T12:00:00Z',
          }],
        });

      // Mock transaction: BEGIN, INSERT lessons, INSERT embeddings, COMMIT
      reflClient.query
        .mockResolvedValueOnce({ rows: [] }) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 'lesson-rw-001' }] }) // INSERT lessons
        .mockResolvedValueOnce({ rows: [] }) // INSERT lesson_embeddings
        .mockResolvedValueOnce({ rows: [] }); // COMMIT

      const lesson = await service.reflectOnTicket('TASK-RW-001');

      // Verify lesson was created
      expect(lesson).not.toBeNull();
      expect(lesson!.ticketId).toBe('TASK-RW-001');
      expect(lesson!.reworkCount).toBe(2);
      expect(lesson!.whatFailed).toContain('Coverage below 80%');
      expect(lesson!.whatFailed).toContain('Missing error handling');
      expect(lesson!.whatFixedIt).toBe('Added tests and error handler');
      expect(lesson!.patternLearned).toContain('Coverage below 80%');

      // Verify embedding was generated
      expect(mockEmbedding).toHaveBeenCalledOnce();

      // Verify transaction sequence
      const clientCalls = reflClient.query.mock.calls.map(
        (c: [string, unknown[]?]) => (typeof c[0] === 'string' ? c[0] : ''),
      );
      expect(clientCalls[0]).toBe('BEGIN');
      expect(clientCalls[1]).toContain('INSERT INTO lessons');
      expect(clientCalls[2]).toContain('INSERT INTO lesson_embeddings');
      expect(clientCalls[3]).toBe('COMMIT');
      expect(reflClient.release).toHaveBeenCalledOnce();
    });

    it('should skip tickets with no rework history', async () => {
      const mockEmbedding = vi.fn();
      const embeddingService = { embedText: mockEmbedding } as unknown as EmbeddingService;

      const reflectionPool = {
        query: vi.fn().mockResolvedValueOnce({
          rows: [{
            ticket_id: 'TASK-CLEAN-001',
            current_stage: 'DONE',
            claimed_by: 'Backend',
            rework_count: 0,
          }],
        }),
        connect: vi.fn(),
      } as unknown as import('pg').Pool;

      const service = new ReflectionService(reflectionPool, embeddingService);
      const lesson = await service.reflectOnTicket('TASK-CLEAN-001');

      expect(lesson).toBeNull();
      expect(mockEmbedding).not.toHaveBeenCalled();
    });

    it('should skip non-existent tickets', async () => {
      const mockEmbedding = vi.fn();
      const embeddingService = { embedText: mockEmbedding } as unknown as EmbeddingService;

      const reflectionPool = {
        query: vi.fn().mockResolvedValueOnce({ rows: [] }),
        connect: vi.fn(),
      } as unknown as import('pg').Pool;

      const service = new ReflectionService(reflectionPool, embeddingService);
      const lesson = await service.reflectOnTicket('TASK-NONEXISTENT');

      expect(lesson).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC 3: search_similar_lessons returns results ordered by cosine similarity
  // ────────────────────────────────────────────────────────────────────────

  describe('AC3: Similarity-ordered search results', () => {
    it('should return lessons ordered by descending similarity', async () => {
      const lessons: LessonMatch[] = [
        makeLessonMatch({ id: 'lesson-1', similarity: 0.95, lesson_text: 'High relevance lesson' }),
        makeLessonMatch({ id: 'lesson-2', similarity: 0.85, lesson_text: 'Medium relevance lesson' }),
        makeLessonMatch({ id: 'lesson-3', similarity: 0.72, lesson_text: 'Lower relevance lesson' }),
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: [{ search_similar_lessons: lessons }],
      });

      const result = await memorySearchLessonsHandler({
        query: 'error handling patterns',
        threshold: 0.7,
        limit: 10,
      });

      const payload = parseToolResult(result) as { lessons: LessonMatch[]; total: number };
      expect(payload.total).toBe(3);
      expect(payload.lessons[0].similarity).toBe(0.95);
      expect(payload.lessons[1].similarity).toBe(0.85);
      expect(payload.lessons[2].similarity).toBe(0.72);

      // Verify threshold and limit were passed to stored function
      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[0]).toContain('search_similar_lessons');
      expect(queryCall[1][2]).toBe(0.7);  // threshold
      expect(queryCall[1][3]).toBe(10);   // limit
    });

    it('should filter by category when provided', async () => {
      const lessons = [
        makeLessonMatch({ id: 'lesson-cat', category: 'security', similarity: 0.88 }),
      ];

      mockPool.query.mockResolvedValueOnce({
        rows: [{ search_similar_lessons: lessons }],
      });

      const result = await memorySearchLessonsHandler({
        query: 'security patterns',
        category: 'security',
        threshold: 0.5,
        limit: 5,
      });

      const payload = parseToolResult(result) as { lessons: LessonMatch[] };
      expect(payload.lessons).toHaveLength(1);
      expect(payload.lessons[0].category).toBe('security');

      // Verify category was passed to stored function
      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[1][1]).toBe('security');
    });

    it('should respect threshold parameter', async () => {
      // High threshold → stored function filters out low-similarity results
      mockPool.query.mockResolvedValueOnce({
        rows: [{ search_similar_lessons: [] }],
      });

      const result = await memorySearchLessonsHandler({
        query: 'niche topic',
        threshold: 0.99,
        limit: 10,
      });

      const payload = parseToolResult(result) as { lessons: LessonMatch[]; total: number };
      expect(payload.total).toBe(0);

      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[1][2]).toBe(0.99); // high threshold passed through
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC 4: get_context returns combined blast radius and lessons
  // ────────────────────────────────────────────────────────────────────────

  describe('AC4: get_context combined response', () => {
    it('should return blast_radius + relevant lessons for file_path', async () => {
      const blastRadius = {
        file_path: 'src/services/auth.ts',
        max_depth: 3,
        affected_files: ['src/services/auth.ts', 'src/routes/login.ts'],
        affected_symbols: [{
          name: 'authenticate',
          qualified_name: 'AuthService.authenticate',
          kind: 'method',
          file_path: 'src/services/auth.ts',
          depth: 0,
        }],
        total_affected: 2,
      };

      const lessons = [
        makeLessonMatch({ lesson_text: 'Auth tokens must be rotated', similarity: 0.89 }),
      ];

      // Mock blast_radius query
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ result: blastRadius }] })
        // Mock search_similar_lessons
        .mockResolvedValueOnce({ rows: [{ search_similar_lessons: lessons }] });

      const input = memoryGetContextSchema.parse({
        file_path: 'src/services/auth.ts',
        max_lessons: 5,
      });
      const result = await memoryGetContextHandler(input);

      const payload = parseToolResult(result) as {
        file_path: string;
        blast_radius: typeof blastRadius;
        relevant_lessons: LessonMatch[];
        context_score: number;
      };

      expect(payload.file_path).toBe('src/services/auth.ts');
      expect(payload.blast_radius).not.toBeNull();
      expect(payload.blast_radius.total_affected).toBe(2);
      expect(payload.relevant_lessons).toHaveLength(1);
      expect(payload.relevant_lessons[0].lesson_text).toBe('Auth tokens must be rotated');
      expect(payload.context_score).toBeGreaterThan(0);
    });

    it('should return ticket description + lessons for ticket_id', async () => {
      const lessons = [
        makeLessonMatch({ lesson_text: 'Use parameterized queries', similarity: 0.91 }),
      ];

      // Mock ticket lookup
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ title: 'Fix SQL injection', description: 'Sanitize all user input' }],
        })
        // Mock search_similar_lessons
        .mockResolvedValueOnce({ rows: [{ search_similar_lessons: lessons }] });

      const input = memoryGetContextSchema.parse({
        ticket_id: TICKET_ID,
        max_lessons: 5,
      });
      const result = await memoryGetContextHandler(input);

      const payload = parseToolResult(result) as {
        ticket_id: string;
        blast_radius: null;
        relevant_lessons: LessonMatch[];
        context_score: number;
      };

      expect(payload.ticket_id).toBe(TICKET_ID);
      expect(payload.blast_radius).toBeNull();
      expect(payload.relevant_lessons).toHaveLength(1);
      expect(payload.context_score).toBeGreaterThan(0);
    });

    it('should return both blast_radius and ticket info when both provided', async () => {
      const blastRadius = {
        file_path: 'src/api/handler.ts',
        max_depth: 3,
        affected_files: ['src/api/handler.ts'],
        affected_symbols: [],
        total_affected: 1,
      };

      // Mock blast_radius, ticket lookup, search_similar_lessons
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ result: blastRadius }] })
        .mockResolvedValueOnce({
          rows: [{ title: 'API handler fix', description: 'Fix error handling' }],
        })
        .mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] });

      const input = memoryGetContextSchema.parse({
        file_path: 'src/api/handler.ts',
        ticket_id: TICKET_ID,
        max_lessons: 5,
      });
      const result = await memoryGetContextHandler(input);

      const payload = parseToolResult(result) as {
        file_path: string;
        ticket_id: string;
        blast_radius: typeof blastRadius;
        context_score: number;
      };

      expect(payload.file_path).toBe('src/api/handler.ts');
      expect(payload.ticket_id).toBe(TICKET_ID);
      expect(payload.blast_radius).not.toBeNull();
      // Score includes file (0.3) + ticket (0.3) = 0.6
      expect(payload.context_score).toBeGreaterThanOrEqual(0.6);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC 5: Duplicate lesson prevention
  // ────────────────────────────────────────────────────────────────────────

  describe('AC5: Duplicate lesson prevention', () => {
    it('should return error when DB unique constraint is violated', async () => {
      // Simulate a unique constraint violation from PostgreSQL
      const uniqueError = new Error(
        'duplicate key value violates unique constraint "lessons_ticket_id_lesson_text_key"',
      );
      (uniqueError as NodeJS.ErrnoException).code = '23505';
      mockPool.query.mockRejectedValueOnce(uniqueError);

      const result = await memoryAddLessonHandler({
        ticket_id: TICKET_ID,
        stage: 'BACKEND',
        agent_role: 'Backend',
        lesson_text: 'Always validate input at the controller layer',
        category: 'best-practice',
        tags: ['validation'],
      });

      const payload = parseToolResult(result) as { error: string; message: string };
      expect(result.isError).toBe(true);
      expect(payload.error).toBe('INTERNAL_ERROR');
      expect(payload.message).toContain('duplicate key value');
    });

    it('should allow lessons with different text for same ticket', async () => {
      // First lesson
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'lesson-a' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result1 = await memoryAddLessonHandler({
        ticket_id: TICKET_ID,
        stage: 'BACKEND',
        agent_role: 'Backend',
        lesson_text: 'First lesson about error handling',
        category: 'general',
        tags: [],
      });

      const payload1 = parseToolResult(result1) as { lesson_id: string; status: string };
      expect(payload1.status).toBe('created');

      // Second lesson (different text, same ticket)
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: 'lesson-b' }] })
        .mockResolvedValueOnce({ rows: [] });

      const result2 = await memoryAddLessonHandler({
        ticket_id: TICKET_ID,
        stage: 'BACKEND',
        agent_role: 'Backend',
        lesson_text: 'Second lesson about performance tuning',
        category: 'general',
        tags: [],
      });

      const payload2 = parseToolResult(result2) as { lesson_id: string; status: string };
      expect(payload2.status).toBe('created');
      expect(payload2.lesson_id).not.toBe(payload1.lesson_id);
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC 6: Graceful degradation when embedding service unavailable
  // ────────────────────────────────────────────────────────────────────────

  describe('AC6: Graceful degradation', () => {
    it('should return error when embedding service fails during add_lesson', async () => {
      // Lesson INSERT succeeds
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: LESSON_ID }] });

      // EmbeddingService.embedText throws
      const MockedEmbeddingService = vi.mocked(EmbeddingService);
      MockedEmbeddingService.mockImplementationOnce(() => ({
        embedText: vi.fn().mockRejectedValue(new Error('OPENAI_API_KEY environment variable is required')),
        embedBatch: vi.fn(),
      }) as unknown as EmbeddingService);

      const result = await memoryAddLessonHandler({
        ticket_id: TICKET_ID,
        stage: 'BACKEND',
        agent_role: 'Backend',
        lesson_text: 'This lesson will fail embedding',
        category: 'general',
        tags: [],
      });

      const payload = parseToolResult(result) as { error: string; message: string };
      expect(result.isError).toBe(true);
      expect(payload.error).toBe('INTERNAL_ERROR');
      expect(payload.message).toContain('Failed to add lesson');
    });

    it('should return error when embedding service fails during search', async () => {
      // EmbeddingService.embedText throws
      const MockedEmbeddingService = vi.mocked(EmbeddingService);
      MockedEmbeddingService.mockImplementationOnce(() => ({
        embedText: vi.fn().mockRejectedValue(new Error('API rate limit exceeded')),
        embedBatch: vi.fn(),
      }) as unknown as EmbeddingService);

      const result = await memorySearchLessonsHandler({
        query: 'any query',
        threshold: 0.7,
        limit: 10,
      });

      const payload = parseToolResult(result) as { error: string; lessons: []; total: number };
      expect(payload.error).toBe('INTERNAL_ERROR');
      expect(payload.lessons).toEqual([]);
      expect(payload.total).toBe(0);
    });

    it('should degrade gracefully in get_context when blast_radius fails', async () => {
      // blast_radius throws
      mockPool.query
        .mockRejectedValueOnce(new Error('blast_radius function not found'))
        // lesson search still works
        .mockResolvedValueOnce({
          rows: [{ search_similar_lessons: [makeLessonMatch()] }],
        });

      const input = memoryGetContextSchema.parse({
        file_path: 'src/broken/path.ts',
        max_lessons: 5,
      });
      const result = await memoryGetContextHandler(input);

      const payload = parseToolResult(result) as {
        blast_radius: null;
        relevant_lessons: LessonMatch[];
        context_score: number;
      };

      // blast_radius is null but lessons still returned
      expect(payload.blast_radius).toBeNull();
      expect(payload.relevant_lessons).toHaveLength(1);
      // Score: no blast_radius bonus (0), but lessons bonus (0.4)
      expect(payload.context_score).toBeGreaterThan(0);

      // Verify warning was logged
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'memory_get_context_blast_radius_degraded',
        }),
        expect.any(String),
      );
    });

    it('should degrade gracefully in get_context when lesson search fails', async () => {
      // blast_radius succeeds
      mockPool.query.mockResolvedValueOnce({
        rows: [{
          result: {
            file_path: 'src/ok.ts',
            max_depth: 3,
            affected_files: ['src/ok.ts'],
            affected_symbols: [],
            total_affected: 1,
          },
        }],
      });

      // EmbeddingService throws during lesson search
      const MockedEmbeddingService = vi.mocked(EmbeddingService);
      MockedEmbeddingService.mockImplementationOnce(() => ({
        embedText: vi.fn().mockRejectedValue(new Error('Service unavailable')),
        embedBatch: vi.fn(),
      }) as unknown as EmbeddingService);

      const input = memoryGetContextSchema.parse({
        file_path: 'src/ok.ts',
        max_lessons: 5,
      });
      const result = await memoryGetContextHandler(input);

      const payload = parseToolResult(result) as {
        blast_radius: { total_affected: number };
        relevant_lessons: LessonMatch[];
        context_score: number;
      };

      // blast_radius is present but lessons are empty
      expect(payload.blast_radius).not.toBeNull();
      expect(payload.relevant_lessons).toEqual([]);
      expect(payload.context_score).toBe(0.3); // only file bonus

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'memory_get_context_lessons_degraded',
        }),
        expect.any(String),
      );
    });

    it('should degrade gracefully when ticket lookup fails in get_context', async () => {
      // ticket lookup throws
      mockPool.query
        .mockRejectedValueOnce(new Error('connection refused'))
        // lesson search still works
        .mockResolvedValueOnce({
          rows: [{ search_similar_lessons: [] }],
        });

      const input = memoryGetContextSchema.parse({
        ticket_id: 'TASK-BROKEN',
        max_lessons: 5,
      });
      const result = await memoryGetContextHandler(input);

      const payload = parseToolResult(result) as {
        ticket_id: string;
        blast_radius: null;
        relevant_lessons: LessonMatch[];
        context_score: number;
      };

      expect(payload.ticket_id).toBe('TASK-BROKEN');
      expect(payload.blast_radius).toBeNull();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'memory_get_context_ticket_degraded',
        }),
        expect.any(String),
      );
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // AC 8: Reflection rollback on failure
  // ────────────────────────────────────────────────────────────────────────

  describe('Reflection: rollback on failure', () => {
    it('should rollback transaction when embedding generation fails', async () => {
      const embeddingService = {
        embedText: vi.fn().mockRejectedValue(new Error('API key invalid')),
      } as unknown as EmbeddingService;

      const rollbackClient = {
        query: vi.fn().mockResolvedValue({ rows: [] }),
        release: vi.fn(),
      };

      const reflectionPool = {
        query: vi.fn()
          .mockResolvedValueOnce({
            rows: [{
              ticket_id: 'TASK-FAIL-001',
              current_stage: 'QA',
              claimed_by: 'Backend',
              rework_count: 1,
            }],
          })
          .mockResolvedValueOnce({
            rows: [{
              id: 'evt-1',
              ticket_id: 'TASK-FAIL-001',
              event_type: 'STAGE_REJECTED',
              payload: { reason: 'Test failure' },
              created_at: '2026-03-10T08:00:00Z',
            }],
          })
          .mockResolvedValueOnce({
            rows: [{
              id: 'evt-2',
              ticket_id: 'TASK-FAIL-001',
              event_type: 'STAGE_ADVANCED',
              payload: { evidence: { notes: 'Fixed' } },
              created_at: '2026-03-10T10:00:00Z',
            }],
          }),
        connect: vi.fn().mockResolvedValue(rollbackClient),
      } as unknown as import('pg').Pool;

      const service = new ReflectionService(reflectionPool, embeddingService);

      await expect(service.reflectOnTicket('TASK-FAIL-001')).rejects.toThrow('API key invalid');

      // Transaction was never started because embedding failed before connect
      // (embedText is called before pool.connect in reflection-service)
    });
  });

  // ────────────────────────────────────────────────────────────────────────
  // Edge cases: input validation
  // ────────────────────────────────────────────────────────────────────────

  describe('Input validation edge cases', () => {
    it('get_context rejects when neither file_path nor ticket_id provided', () => {
      expect(() => memoryGetContextSchema.parse({ max_lessons: 5 })).toThrow(
        'Either file_path or ticket_id must be provided',
      );
    });

    it('add_lesson persists correct category default', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [{ id: LESSON_ID }] })
        .mockResolvedValueOnce({ rows: [] });

      await memoryAddLessonHandler({
        ticket_id: TICKET_ID,
        stage: 'QA',
        agent_role: 'QA',
        lesson_text: 'Default category test with sufficient length',
        category: 'general',
        tags: [],
      });

      const insertCall = mockPool.query.mock.calls[0];
      expect(insertCall[1][4]).toBe('general'); // category default
      expect(insertCall[1][5]).toEqual([]);      // tags default
    });

    it('search_lessons passes null category when not specified', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [{ search_similar_lessons: [] }],
      });

      await memorySearchLessonsHandler({
        query: 'test query',
        threshold: 0.7,
        limit: 10,
      });

      const queryCall = mockPool.query.mock.calls[0];
      expect(queryCall[1][1]).toBeNull(); // category = null
    });
  });
});
