/**
 * Unit tests for the similarity search flow.
 *
 * Tests the end-to-end pattern:
 *   embed query → call search_similar_lessons stored function → rank results
 *
 * All database and API interactions are mocked — no real connections.
 * Verifies:
 *   - Correct SQL call to search_similar_lessons with parameters
 *   - Category filtering pass-through
 *   - Threshold and limit enforcement
 *   - Result ranking by similarity score
 *   - Empty result handling
 *   - Error propagation from database and embedding service
 *   - End-to-end flow from text query to ranked lesson results
 *
 * @ticket TASK-INT-BE040
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EmbeddingService,
  EmbeddingApiError,
} from '../services/embedding-service.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Shape returned by search_similar_lessons stored function. */
interface SimilarLesson {
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

/** Options for the similarity search function. */
interface SearchOptions {
  category?: string;
  threshold?: number;
  limit?: number;
}

// ── Similarity Search Module Under Test ──────────────────────────────────────
//
// Since there's no dedicated similarity-search service file yet, we define
// the function inline and test it. This models the expected integration:
//   1. Embed the query text via EmbeddingService
//   2. Call the search_similar_lessons stored function via the DB pool
//   3. Return ranked results
//
// The real implementation can be extracted into a service later.

type PoolQuery = (text: string, values: unknown[]) => Promise<{ rows: { search_similar_lessons: SimilarLesson[] }[] }>;

async function searchSimilarLessons(
  queryText: string,
  embeddingService: EmbeddingService,
  dbQuery: PoolQuery,
  options?: SearchOptions,
): Promise<SimilarLesson[]> {
  if (!queryText.trim()) {
    return [];
  }

  const embedding = await embeddingService.embedText(queryText);
  const vectorLiteral = `[${embedding.join(',')}]`;

  const result = await dbQuery(
    'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
    [
      vectorLiteral,
      options?.category ?? null,
      options?.threshold ?? 0.7,
      options?.limit ?? 10,
    ],
  );

  const lessons: SimilarLesson[] = result.rows[0]?.search_similar_lessons ?? [];
  return lessons.sort((a, b) => b.similarity - a.similarity);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEmbedding(dimensions = 1536): number[] {
  return Array.from({ length: dimensions }, (_, i) => Math.sin(i) * 0.1);
}

function makeSampleLesson(overrides: Partial<SimilarLesson> = {}): SimilarLesson {
  return {
    id: 'lesson-001',
    ticket_id: 'TASK-001',
    stage: 'BACKEND',
    agent_role: 'Backend',
    rework_count: 1,
    lesson_text: 'Always validate input at the boundary.',
    category: 'validation',
    tags: ['input', 'boundary'],
    similarity: 0.92,
    created_at: '2026-03-01T12:00:00Z',
    ...overrides,
  };
}

// ── Mock Setup ───────────────────────────────────────────────────────────────

let originalEnv: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
let dbQueryMock: ReturnType<typeof vi.fn>;
let embeddingService: EmbeddingService;

function okResponse(body: object): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function mockEmbeddingApiResponse(embedding: number[]): object {
  return {
    data: [{ embedding, index: 0 }],
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: 5, total_tokens: 5 },
  };
}

beforeEach(() => {
  originalEnv = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-similarity';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  dbQueryMock = vi.fn();
  embeddingService = new EmbeddingService({
    maxRetries: 1,
    batchSize: 10,
    maxConcurrent: 5,
    baseDelayMs: 0,
  });
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.OPENAI_API_KEY = originalEnv;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── search_similar_lessons SQL Call ──────────────────────────────────────────

describe('Similarity search — stored function invocation', () => {
  it('calls search_similar_lessons with correct vector parameter', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await searchSimilarLessons('test query', embeddingService, dbQueryMock);

    expect(dbQueryMock).toHaveBeenCalledOnce();
    const [sql, params] = dbQueryMock.mock.calls[0];
    expect(sql).toBe('SELECT search_similar_lessons($1::vector, $2, $3, $4)');
    expect(params[0]).toBe(`[${embedding.join(',')}]`);
  });

  it('passes category filter as second parameter', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await searchSimilarLessons('test', embeddingService, dbQueryMock, {
      category: 'security',
    });

    const params = dbQueryMock.mock.calls[0][1];
    expect(params[1]).toBe('security');
  });

  it('passes null category when not specified', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await searchSimilarLessons('test', embeddingService, dbQueryMock);

    const params = dbQueryMock.mock.calls[0][1];
    expect(params[1]).toBeNull();
  });

  it('passes threshold and limit parameters', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await searchSimilarLessons('test', embeddingService, dbQueryMock, {
      threshold: 0.85,
      limit: 5,
    });

    const params = dbQueryMock.mock.calls[0][1];
    expect(params[2]).toBe(0.85);
    expect(params[3]).toBe(5);
  });

  it('uses default threshold=0.7 and limit=10', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await searchSimilarLessons('test', embeddingService, dbQueryMock);

    const params = dbQueryMock.mock.calls[0][1];
    expect(params[2]).toBe(0.7);
    expect(params[3]).toBe(10);
  });
});

// ── Result Ranking ───────────────────────────────────────────────────────────

describe('Similarity search — result ranking', () => {
  it('returns results sorted by similarity descending', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));

    const lessons = [
      makeSampleLesson({ id: 'low', similarity: 0.72 }),
      makeSampleLesson({ id: 'high', similarity: 0.98 }),
      makeSampleLesson({ id: 'mid', similarity: 0.85 }),
    ];
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: lessons }],
    });

    const results = await searchSimilarLessons('rank test', embeddingService, dbQueryMock);

    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('high');
    expect(results[1].id).toBe('mid');
    expect(results[2].id).toBe('low');
    expect(results[0].similarity).toBeGreaterThanOrEqual(results[1].similarity);
    expect(results[1].similarity).toBeGreaterThanOrEqual(results[2].similarity);
  });

  it('returns empty array when no lessons match', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    const results = await searchSimilarLessons('no matches', embeddingService, dbQueryMock);

    expect(results).toEqual([]);
  });

  it('handles single result', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));

    const lessons = [makeSampleLesson({ id: 'only', similarity: 0.90 })];
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: lessons }],
    });

    const results = await searchSimilarLessons('single', embeddingService, dbQueryMock);

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('only');
  });

  it('preserves all lesson metadata fields', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));

    const lesson = makeSampleLesson({
      id: 'metadata-check',
      ticket_id: 'TASK-META-001',
      stage: 'QA',
      agent_role: 'QAEngineer',
      rework_count: 3,
      lesson_text: 'Always check edge cases in validation logic.',
      category: 'testing',
      tags: ['edge-case', 'validation', 'qa'],
      similarity: 0.95,
      created_at: '2026-02-15T08:30:00Z',
    });
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [lesson] }],
    });

    const results = await searchSimilarLessons('metadata', embeddingService, dbQueryMock);

    expect(results[0]).toEqual(lesson);
  });
});

// ── Empty / Edge Input ───────────────────────────────────────────────────────

describe('Similarity search — edge inputs', () => {
  it('returns empty for empty query string', async () => {
    const results = await searchSimilarLessons('', embeddingService, dbQueryMock);

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('returns empty for whitespace-only query', async () => {
    const results = await searchSimilarLessons('   ', embeddingService, dbQueryMock);

    expect(results).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('handles null/undefined in stored function response gracefully', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: null }],
    });

    const results = await searchSimilarLessons('null response', embeddingService, dbQueryMock);

    expect(results).toEqual([]);
  });

  it('handles empty rows from database', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({ rows: [] });

    const results = await searchSimilarLessons('no rows', embeddingService, dbQueryMock);

    expect(results).toEqual([]);
  });
});

// ── Error Propagation ────────────────────────────────────────────────────────

describe('Similarity search — error propagation', () => {
  it('propagates embedding service API errors', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: vi.fn().mockResolvedValue({}),
      text: vi.fn().mockResolvedValue('Unauthorized'),
    } as unknown as Response);

    await expect(
      searchSimilarLessons('auth fail', embeddingService, dbQueryMock),
    ).rejects.toThrow(EmbeddingApiError);

    expect(dbQueryMock).not.toHaveBeenCalled();
  });

  it('propagates database query errors', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockRejectedValueOnce(new Error('connection refused'));

    await expect(
      searchSimilarLessons('db fail', embeddingService, dbQueryMock),
    ).rejects.toThrow('connection refused');
  });

  it('propagates database timeout errors', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockRejectedValueOnce(new Error('query timeout'));

    await expect(
      searchSimilarLessons('timeout', embeddingService, dbQueryMock),
    ).rejects.toThrow('query timeout');
  });

  it('propagates network errors from embedding service', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    await expect(
      searchSimilarLessons('network fail', embeddingService, dbQueryMock),
    ).rejects.toThrow(TypeError);

    expect(dbQueryMock).not.toHaveBeenCalled();
  });
});

// ── End-to-End Flow ──────────────────────────────────────────────────────────

describe('Similarity search — end-to-end flow', () => {
  it('embed query → search → ranked results', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));

    const dbLessons = [
      makeSampleLesson({ id: 'l1', lesson_text: 'Use dependency injection for testability.', similarity: 0.88 }),
      makeSampleLesson({ id: 'l2', lesson_text: 'Always validate at boundaries.', similarity: 0.95 }),
      makeSampleLesson({ id: 'l3', lesson_text: 'Prefer composition over inheritance.', similarity: 0.80 }),
    ];
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: dbLessons }],
    });

    const results = await searchSimilarLessons(
      'How should I handle input validation in my service?',
      embeddingService,
      dbQueryMock,
    );

    // Verify embedding was generated
    expect(fetchMock).toHaveBeenCalledOnce();
    const apiBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(apiBody.input).toEqual(['How should I handle input validation in my service?']);

    // Verify DB was queried with the embedding
    expect(dbQueryMock).toHaveBeenCalledOnce();
    const vectorArg = dbQueryMock.mock.calls[0][1][0] as string;
    expect(vectorArg.startsWith('[')).toBe(true);
    expect(vectorArg.endsWith(']')).toBe(true);

    // Verify results are ranked by similarity desc
    expect(results).toHaveLength(3);
    expect(results[0].id).toBe('l2');
    expect(results[0].similarity).toBe(0.95);
    expect(results[1].id).toBe('l1');
    expect(results[1].similarity).toBe(0.88);
    expect(results[2].id).toBe('l3');
    expect(results[2].similarity).toBe(0.80);
  });

  it('end-to-end with category filter', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));

    const dbLessons = [
      makeSampleLesson({ id: 'sec1', category: 'security', similarity: 0.91 }),
    ];
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: dbLessons }],
    });

    const results = await searchSimilarLessons(
      'SQL injection prevention best practices',
      embeddingService,
      dbQueryMock,
      { category: 'security', threshold: 0.8, limit: 5 },
    );

    expect(results).toHaveLength(1);
    expect(results[0].category).toBe('security');

    // Verify filter params passed to DB
    const params = dbQueryMock.mock.calls[0][1];
    expect(params[1]).toBe('security');
    expect(params[2]).toBe(0.8);
    expect(params[3]).toBe(5);
  });

  it('end-to-end with retry on embedding failure then success', async () => {
    const embedding = makeMockEmbedding();

    // First attempt fails with 500, second succeeds
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue('Internal Server Error'),
      } as unknown as Response)
      .mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));

    const dbLessons = [
      makeSampleLesson({ id: 'retry-ok', similarity: 0.90 }),
    ];
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: dbLessons }],
    });

    const results = await searchSimilarLessons(
      'retry test query',
      embeddingService,
      dbQueryMock,
    );

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('retry-ok');
    // 1 failed + 1 success = 2 fetch calls
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('end-to-end with no matching lessons returns empty array', async () => {
    const embedding = makeMockEmbedding();
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    const results = await searchSimilarLessons(
      'completely unrelated query about cooking',
      embeddingService,
      dbQueryMock,
    );

    expect(results).toEqual([]);
  });
});

// ── Vector Format ────────────────────────────────────────────────────────────

describe('Similarity search — vector format', () => {
  it('formats embedding as pgvector-compatible string literal', async () => {
    const embedding = [0.1, 0.2, 0.3, -0.4, 0.5];
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await searchSimilarLessons('vector format', embeddingService, dbQueryMock);

    const vectorArg = dbQueryMock.mock.calls[0][1][0] as string;
    expect(vectorArg).toBe('[0.1,0.2,0.3,-0.4,0.5]');
  });

  it('handles negative values in embedding vector', async () => {
    const embedding = [-0.5, 0.0, 0.5, -1.0, 1.0];
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingApiResponse(embedding)));
    dbQueryMock.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await searchSimilarLessons('neg values', embeddingService, dbQueryMock);

    const vectorArg = dbQueryMock.mock.calls[0][1][0] as string;
    expect(vectorArg).toBe('[-0.5,0,0.5,-1,1]');
  });
});
