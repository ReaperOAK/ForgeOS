/**
 * Unit tests for the `memory.add_lesson` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates required fields (ticket_id, stage, agent_role, lesson_text)
 * - Optional fields default correctly (category → 'general', tags → [])
 * - Inserts lesson into `lessons` table and returns lesson ID
 * - Generates embedding via EmbeddingService.embedText()
 * - Stores embedding in `lesson_embeddings` table
 * - Returns created lesson ID and status 'created'
 * - Handles DB errors gracefully
 * - Handles embedding service errors gracefully
 *
 * @ticket TASK-INT-BE037
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryAddLessonSchema, memoryAddLessonHandler } from './memory-add-lesson.js';

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

function parseContent(
  result: { content: Array<{ type: string; [k: string]: unknown }> },
): Record<string, unknown> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ticket_id: 'TASK-001',
    stage: 'BACKEND',
    agent_role: 'Backend',
    lesson_text: 'Always validate input before DB insertion to prevent SQL injection.',
    ...overrides,
  };
}

const FAKE_LESSON_ID = '550e8400-e29b-41d4-a716-446655440000';
const FAKE_EMBEDDING = Array.from({ length: 1536 }, () => 0.01);

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('memoryAddLessonSchema', () => {
  it('should require ticket_id', () => {
    const input = validInput();
    delete input.ticket_id;
    expect(() => memoryAddLessonSchema.parse(input)).toThrow();
  });

  it('should reject empty ticket_id', () => {
    expect(() => memoryAddLessonSchema.parse(validInput({ ticket_id: '' }))).toThrow();
  });

  it('should require stage', () => {
    const input = validInput();
    delete input.stage;
    expect(() => memoryAddLessonSchema.parse(input)).toThrow();
  });

  it('should reject empty stage', () => {
    expect(() => memoryAddLessonSchema.parse(validInput({ stage: '' }))).toThrow();
  });

  it('should require agent_role', () => {
    const input = validInput();
    delete input.agent_role;
    expect(() => memoryAddLessonSchema.parse(input)).toThrow();
  });

  it('should reject empty agent_role', () => {
    expect(() => memoryAddLessonSchema.parse(validInput({ agent_role: '' }))).toThrow();
  });

  it('should require lesson_text', () => {
    const input = validInput();
    delete input.lesson_text;
    expect(() => memoryAddLessonSchema.parse(input)).toThrow();
  });

  it('should reject lesson_text shorter than 10 characters', () => {
    expect(() => memoryAddLessonSchema.parse(validInput({ lesson_text: 'too short' }))).toThrow();
  });

  it('should accept lesson_text of exactly 10 characters', () => {
    const result = memoryAddLessonSchema.parse(validInput({ lesson_text: 'abcdefghij' }));
    expect(result.lesson_text).toBe('abcdefghij');
  });

  it('should default category to "general"', () => {
    const result = memoryAddLessonSchema.parse(validInput());
    expect(result.category).toBe('general');
  });

  it('should accept custom category', () => {
    const result = memoryAddLessonSchema.parse(validInput({ category: 'testing' }));
    expect(result.category).toBe('testing');
  });

  it('should default tags to empty array', () => {
    const result = memoryAddLessonSchema.parse(validInput());
    expect(result.tags).toEqual([]);
  });

  it('should accept custom tags', () => {
    const result = memoryAddLessonSchema.parse(validInput({ tags: ['tdd', 'validation'] }));
    expect(result.tags).toEqual(['tdd', 'validation']);
  });

  it('should accept all fields together', () => {
    const result = memoryAddLessonSchema.parse(validInput({
      category: 'architecture',
      tags: ['solid', 'patterns'],
    }));
    expect(result.ticket_id).toBe('TASK-001');
    expect(result.stage).toBe('BACKEND');
    expect(result.agent_role).toBe('Backend');
    expect(result.category).toBe('architecture');
    expect(result.tags).toEqual(['solid', 'patterns']);
  });

  it('should reject non-string ticket_id', () => {
    expect(() => memoryAddLessonSchema.parse(validInput({ ticket_id: 123 }))).toThrow();
  });

  it('should reject non-array tags', () => {
    expect(() => memoryAddLessonSchema.parse(validInput({ tags: 'not-array' }))).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('memoryAddLessonHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockEmbedText.mockReset();
  });

  it('should insert lesson, generate embedding, store embedding, and return lesson_id', async () => {
    // Mock lesson INSERT
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: FAKE_LESSON_ID }],
    });

    // Mock embedding generation
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);

    // Mock embedding INSERT
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const parsed = memoryAddLessonSchema.parse(validInput());
    const result = await memoryAddLessonHandler(parsed);
    const data = parseContent(result);

    expect(result.isError).toBeUndefined();
    expect(data.lesson_id).toBe(FAKE_LESSON_ID);
    expect(data.status).toBe('created');
  });

  it('should insert lesson with correct SQL parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_LESSON_ID }] });
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const parsed = memoryAddLessonSchema.parse(validInput({
      category: 'testing',
      tags: ['unit', 'mock'],
    }));
    await memoryAddLessonHandler(parsed);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO lessons'),
      ['TASK-001', 'BACKEND', 'Backend',
       'Always validate input before DB insertion to prevent SQL injection.',
       'testing', ['unit', 'mock']],
    );
  });

  it('should call EmbeddingService.embedText with the lesson text', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_LESSON_ID }] });
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const parsed = memoryAddLessonSchema.parse(validInput());
    await memoryAddLessonHandler(parsed);

    expect(mockEmbedText).toHaveBeenCalledWith(
      'Always validate input before DB insertion to prevent SQL injection.',
    );
  });

  it('should store embedding in lesson_embeddings with correct parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_LESSON_ID }] });
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const parsed = memoryAddLessonSchema.parse(validInput());
    await memoryAddLessonHandler(parsed);

    expect(mockQuery).toHaveBeenCalledTimes(2);
    expect(mockQuery).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO lesson_embeddings'),
      [FAKE_LESSON_ID, JSON.stringify(FAKE_EMBEDDING)],
    );
  });

  it('should handle database error on lesson insert', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const parsed = memoryAddLessonSchema.parse(validInput());
    const result = await memoryAddLessonHandler(parsed);
    const data = parseContent(result);

    expect(result.isError).toBe(true);
    expect(data.error).toBe('INTERNAL_ERROR');
    expect(data.message).toContain('connection refused');
  });

  it('should handle embedding service error gracefully (best-effort)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_LESSON_ID }] });
    mockEmbedText.mockRejectedValueOnce(new Error('API rate limit exceeded'));

    const parsed = memoryAddLessonSchema.parse(validInput());
    const result = await memoryAddLessonHandler(parsed);
    const data = parseContent(result);

    // Lesson should still be created even if embedding fails
    expect(result.isError).toBeUndefined();
    expect(data.lesson_id).toBe(FAKE_LESSON_ID);
    expect(data.status).toBe('created');
  });

  it('should handle database error on embedding insert gracefully (best-effort)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_LESSON_ID }] });
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockRejectedValueOnce(new Error('unique constraint violated'));

    const parsed = memoryAddLessonSchema.parse(validInput());
    const result = await memoryAddLessonHandler(parsed);
    const data = parseContent(result);

    // Lesson should still be created even if embedding insert fails
    expect(result.isError).toBeUndefined();
    expect(data.lesson_id).toBe(FAKE_LESSON_ID);
    expect(data.status).toBe('created');
  });

  it('should use default category and tags when not provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: FAKE_LESSON_ID }] });
    mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const parsed = memoryAddLessonSchema.parse(validInput());
    await memoryAddLessonHandler(parsed);

    expect(mockQuery).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('INSERT INTO lessons'),
      expect.arrayContaining(['general', []]),
    );
  });
});
