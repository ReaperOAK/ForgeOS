/**
 * Unit tests for the `memory.search_lessons` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates query (required, non-empty string)
 * - Optional category, threshold (0–1, default 0.7), limit (1–100, default 10)
 * - Embeds query text via EmbeddingService.embedText()
 * - Calls search_similar_lessons() stored function with correct parameters
 * - Returns array of lessons with similarity scores
 * - Handles empty results gracefully
 * - Handles embedding errors gracefully
 * - Handles DB errors gracefully
 *
 * @ticket TASK-INT-BE036
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memorySearchLessonsSchema, memorySearchLessonsHandler } from './memory-search-lessons.js';

// ── Mock pool ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mock EmbeddingService ────────────────────────────────────────────────────

const mockEmbedText = vi.fn();

vi.mock('../services/embedding-service.js', () => ({
  EmbeddingService: vi.fn().mockImplementation(() => ({
    embedText: mockEmbedText,
  })),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseContent(result: { content: Array<{ type: string; [k: string]: unknown }> }): Record<string, unknown> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

function makeLesson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'lesson-uuid-001',
    ticket_id: 'TASK-001',
    stage: 'BACKEND',
    agent_role: 'Backend',
    rework_count: 0,
    lesson_text: 'Always validate input before database operations',
    category: 'validation',
    tags: ['input', 'safety'],
    similarity: 0.92,
    created_at: '2026-03-10T10:00:00Z',
    ...overrides,
  };
}

const FAKE_EMBEDDING = Array.from({ length: 1536 }, (_, i) => i * 0.001);

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('memorySearchLessonsSchema', () => {
  it('should require query', () => {
    expect(() => memorySearchLessonsSchema.parse({})).toThrow();
  });

  it('should accept valid query only (defaults applied)', () => {
    const result = memorySearchLessonsSchema.parse({ query: 'how to handle errors' });
    expect(result.query).toBe('how to handle errors');
    expect(result.category).toBeUndefined();
    expect(result.threshold).toBe(0.7);
    expect(result.limit).toBe(10);
  });

  it('should reject empty query', () => {
    expect(() => memorySearchLessonsSchema.parse({ query: '' })).toThrow();
  });

  it('should reject non-string query', () => {
    expect(() => memorySearchLessonsSchema.parse({ query: 123 })).toThrow();
  });

  it('should accept optional category', () => {
    const result = memorySearchLessonsSchema.parse({
      query: 'error handling',
      category: 'validation',
    });
    expect(result.category).toBe('validation');
  });

  it('should accept valid threshold within bounds', () => {
    const result = memorySearchLessonsSchema.parse({
      query: 'testing patterns',
      threshold: 0.85,
    });
    expect(result.threshold).toBe(0.85);
  });

  it('should reject threshold below 0', () => {
    expect(() => memorySearchLessonsSchema.parse({
      query: 'test',
      threshold: -0.1,
    })).toThrow();
  });

  it('should reject threshold above 1', () => {
    expect(() => memorySearchLessonsSchema.parse({
      query: 'test',
      threshold: 1.5,
    })).toThrow();
  });

  it('should accept valid limit within bounds', () => {
    const result = memorySearchLessonsSchema.parse({
      query: 'patterns',
      limit: 25,
    });
    expect(result.limit).toBe(25);
  });

  it('should reject limit below 1', () => {
    expect(() => memorySearchLessonsSchema.parse({
      query: 'test',
      limit: 0,
    })).toThrow();
  });

  it('should reject limit above 100', () => {
    expect(() => memorySearchLessonsSchema.parse({
      query: 'test',
      limit: 101,
    })).toThrow();
  });

  it('should reject non-integer limit', () => {
    expect(() => memorySearchLessonsSchema.parse({
      query: 'test',
      limit: 5.5,
    })).toThrow();
  });

  it('should accept all parameters together', () => {
    const result = memorySearchLessonsSchema.parse({
      query: 'database migration patterns',
      category: 'architecture',
      threshold: 0.8,
      limit: 5,
    });
    expect(result.query).toBe('database migration patterns');
    expect(result.category).toBe('architecture');
    expect(result.threshold).toBe(0.8);
    expect(result.limit).toBe(5);
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('memorySearchLessonsHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEmbedText.mockReset();
  });

  it('should embed query and return matching lessons', async () => {
    const lesson1 = makeLesson();
    const lesson2 = makeLesson({
      id: 'lesson-uuid-002',
      ticket_id: 'TASK-002',
      lesson_text: 'Use structured logging for observability',
      category: 'observability',
      similarity: 0.85,
    });

    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [lesson1, lesson2] }],
    });

    const result = await memorySearchLessonsHandler({
      query: 'error handling best practices',
      threshold: 0.7,
      limit: 10,
    });

    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.query).toBe('error handling best practices');
    expect(data.category).toBeNull();
    expect(data.threshold).toBe(0.7);
    expect(data.limit).toBe(10);
    expect(data.lessons).toHaveLength(2);
    expect(data.total).toBe(2);
  });

  it('should call EmbeddingService.embedText with query text', async () => {
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await memorySearchLessonsHandler({
      query: 'TDD patterns',
      threshold: 0.7,
      limit: 10,
    });

    expect(mockEmbedText).toHaveBeenCalledWith('TDD patterns');
  });

  it('should pass embedding, category, threshold, and limit to stored function', async () => {
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await memorySearchLessonsHandler({
      query: 'testing',
      category: 'QA',
      threshold: 0.8,
      limit: 5,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
      [JSON.stringify(FAKE_EMBEDDING), 'QA', 0.8, 5],
    );
  });

  it('should pass null category when not provided', async () => {
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    await memorySearchLessonsHandler({
      query: 'error handling',
      threshold: 0.7,
      limit: 10,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
      [JSON.stringify(FAKE_EMBEDDING), null, 0.7, 10],
    );
  });

  it('should return empty array when no lessons match', async () => {
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [] }],
    });

    const result = await memorySearchLessonsHandler({
      query: 'completely unrelated topic xyz',
      threshold: 0.7,
      limit: 10,
    });

    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.lessons).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should handle null stored function result gracefully', async () => {
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: null }],
    });

    const result = await memorySearchLessonsHandler({
      query: 'edge case test',
      threshold: 0.7,
      limit: 10,
    });

    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.lessons).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should handle empty rows gracefully', async () => {
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await memorySearchLessonsHandler({
      query: 'empty rows test',
      threshold: 0.7,
      limit: 10,
    });

    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.lessons).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should fall back to lexical search on embedding failure', async () => {
    mockEmbedText.mockRejectedValueOnce(new Error('OpenAI API unavailable'));
    // Lexical fallback query
    mockQuery.mockResolvedValueOnce({
      rows: [makeLesson({ similarity: 0.5 })],
    });

    const result = await memorySearchLessonsHandler({
      query: 'test query',
      threshold: 0.7,
      limit: 10,
    });

    const data = parseContent(result);

    // Should succeed with lexical fallback, not return an error
    expect(result.isError).toBeUndefined();
    expect(data.lessons).toHaveLength(1);
    expect(data.total).toBe(1);
  });

  it('should return isError true on complete database failure (both embedding and fallback)', async () => {
    mockEmbedText.mockRejectedValueOnce(new Error('OpenAI API unavailable'));
    // Lexical fallback also fails
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await memorySearchLessonsHandler({
      query: 'db failure test',
      threshold: 0.7,
      limit: 10,
    });

    const data = parseContent(result);

    expect(result.isError).toBe(true);
    expect(data.error).toBe('INTERNAL_ERROR');
    expect(data.message).toContain('connection refused');
    expect(data.lessons).toEqual([]);
    expect(data.total).toBe(0);
  });

  it('should include similarity scores in returned lessons', async () => {
    const lesson = makeLesson({ similarity: 0.95 });
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({
      rows: [{ search_similar_lessons: [lesson] }],
    });

    const result = await memorySearchLessonsHandler({
      query: 'high relevance query',
      threshold: 0.9,
      limit: 1,
    });

    const data = parseContent(result) as { lessons: Array<{ similarity: number }> };

    expect(data.lessons[0].similarity).toBe(0.95);
  });
});
