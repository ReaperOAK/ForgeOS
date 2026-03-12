/**
 * Unit tests for the `memory.get_context` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Accepts file_path OR ticket_id (at least one required), optional max_lessons
 * - file_path mode: returns blast radius + file-relevant lessons
 * - ticket_id mode: returns ticket description + ticket-relevant lessons
 * - Combined mode: both blast radius and ticket context
 * - Returns blast_radius object (null if ticket-only query)
 * - Returns relevant_lessons array
 * - Returns context_score (0.0–1.0)
 * - Graceful degradation if code graph unavailable
 * - Graceful degradation if ticket lookup fails
 * - Graceful degradation if embedding/lesson search unavailable
 *
 * @ticket TASK-INT-BE038
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { memoryGetContextSchema, memoryGetContextHandler } from './memory-get-context.js';

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

function parseContent(result: { content: Array<{ type: string;[k: string]: unknown }> }): Record<string, unknown> {
    const item = result.content[0] as { type: 'text'; text: string };
    return JSON.parse(item.text);
}

const FAKE_EMBEDDING = Array.from({ length: 1536 }, (_, i) => i * 0.001);

function makeBlastRadius(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        file_path: 'src/services/auth.ts',
        max_depth: 3,
        affected_files: ['src/controllers/login.ts', 'src/middleware/auth-guard.ts'],
        affected_symbols: [
            { name: 'login', qualified_name: 'LoginController.login', kind: 'method', file_path: 'src/controllers/login.ts', depth: 1 },
        ],
        total_affected: 2,
        ...overrides,
    };
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

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('memoryGetContextSchema', () => {
    it('should accept file_path only', () => {
        const result = memoryGetContextSchema.parse({ file_path: 'src/index.ts' });
        expect(result.file_path).toBe('src/index.ts');
        expect(result.ticket_id).toBeUndefined();
        expect(result.max_lessons).toBe(5);
    });

    it('should accept ticket_id only', () => {
        const result = memoryGetContextSchema.parse({ ticket_id: 'TASK-INT-BE038' });
        expect(result.ticket_id).toBe('TASK-INT-BE038');
        expect(result.file_path).toBeUndefined();
        expect(result.max_lessons).toBe(5);
    });

    it('should accept both file_path and ticket_id', () => {
        const result = memoryGetContextSchema.parse({
            file_path: 'src/index.ts',
            ticket_id: 'TASK-001',
        });
        expect(result.file_path).toBe('src/index.ts');
        expect(result.ticket_id).toBe('TASK-001');
    });

    it('should reject when neither file_path nor ticket_id provided', () => {
        expect(() => memoryGetContextSchema.parse({})).toThrow();
    });

    it('should reject empty object with max_lessons only', () => {
        expect(() => memoryGetContextSchema.parse({ max_lessons: 3 })).toThrow();
    });

    it('should apply default max_lessons of 5', () => {
        const result = memoryGetContextSchema.parse({ file_path: 'src/foo.ts' });
        expect(result.max_lessons).toBe(5);
    });

    it('should accept custom max_lessons within bounds', () => {
        const result = memoryGetContextSchema.parse({
            file_path: 'src/foo.ts',
            max_lessons: 20,
        });
        expect(result.max_lessons).toBe(20);
    });

    it('should reject max_lessons below 1', () => {
        expect(() => memoryGetContextSchema.parse({
            file_path: 'src/foo.ts',
            max_lessons: 0,
        })).toThrow();
    });

    it('should reject max_lessons above 50', () => {
        expect(() => memoryGetContextSchema.parse({
            file_path: 'src/foo.ts',
            max_lessons: 51,
        })).toThrow();
    });

    it('should reject non-integer max_lessons', () => {
        expect(() => memoryGetContextSchema.parse({
            file_path: 'src/foo.ts',
            max_lessons: 3.5,
        })).toThrow();
    });

    it('should reject empty file_path', () => {
        expect(() => memoryGetContextSchema.parse({ file_path: '' })).toThrow();
    });

    it('should reject empty ticket_id', () => {
        expect(() => memoryGetContextSchema.parse({ ticket_id: '' })).toThrow();
    });
});

// ── Handler Tests — file_path mode ───────────────────────────────────────────

describe('memoryGetContextHandler — file_path mode', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockEmbedText.mockReset();
    });

    it('should return blast radius and relevant lessons for a file', async () => {
        const br = makeBlastRadius();
        const lesson = makeLesson();

        // blast_radius query
        mockQuery.mockResolvedValueOnce({ rows: [{ result: br }] });
        // lesson search
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({
            rows: [{ search_similar_lessons: [lesson] }],
        });

        const result = await memoryGetContextHandler({
            file_path: 'src/services/auth.ts',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(result.isError).toBeUndefined();
        expect(data.file_path).toBe('src/services/auth.ts');
        expect(data.ticket_id).toBeNull();
        expect(data.blast_radius).toEqual(br);
        expect(data.relevant_lessons).toHaveLength(1);
        expect(data.context_score).toBe(0.7); // 0.3 blast + 0.4 lessons
    });

    it('should return blast_radius with zero affected and no lessons', async () => {
        const br = makeBlastRadius({
            affected_files: [],
            affected_symbols: [],
            total_affected: 0,
        });

        mockQuery.mockResolvedValueOnce({ rows: [{ result: br }] });
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({
            rows: [{ search_similar_lessons: [] }],
        });

        const result = await memoryGetContextHandler({
            file_path: 'src/orphan.ts',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(data.blast_radius).toEqual(br);
        expect(data.relevant_lessons).toHaveLength(0);
        expect(data.context_score).toBe(0.3); // blast only
    });

    it('should pass correct parameters to blast_radius', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ result: null }] });
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] });

        await memoryGetContextHandler({
            file_path: 'src/target.ts',
            max_lessons: 5,
        });

        expect(mockQuery).toHaveBeenCalledWith(
            'SELECT blast_radius($1, $2) AS result',
            ['src/target.ts', 3],
        );
    });

    it('should pass max_lessons to search_similar_lessons', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ result: makeBlastRadius() }] });
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] });

        await memoryGetContextHandler({
            file_path: 'src/target.ts',
            max_lessons: 10,
        });

        // Second query is the lesson search
        const lessonCall = mockQuery.mock.calls[1];
        expect(lessonCall[0]).toContain('search_similar_lessons');
        expect(lessonCall[1][3]).toBe(10); // max_lessons
    });
});

// ── Handler Tests — ticket_id mode ───────────────────────────────────────────

describe('memoryGetContextHandler — ticket_id mode', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockEmbedText.mockReset();
    });

    it('should return ticket context and relevant lessons', async () => {
        const lesson = makeLesson({ lesson_text: 'Use parameterized queries' });

        // ticket lookup
        mockQuery.mockResolvedValueOnce({
            rows: [{ title: 'Add auth middleware', description: 'Implement JWT validation' }],
        });
        // lesson search
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({
            rows: [{ search_similar_lessons: [lesson] }],
        });

        const result = await memoryGetContextHandler({
            ticket_id: 'TASK-001',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(data.ticket_id).toBe('TASK-001');
        expect(data.file_path).toBeNull();
        expect(data.blast_radius).toBeNull();
        expect(data.relevant_lessons).toHaveLength(1);
        expect(data.context_score).toBe(0.7); // 0.3 ticket + 0.4 lessons
    });

    it('should return null blast_radius for ticket-only query', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{ title: 'Fix bug', description: 'Something' }],
        });
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] });

        const result = await memoryGetContextHandler({
            ticket_id: 'TASK-002',
            max_lessons: 5,
        });

        const data = parseContent(result);
        expect(data.blast_radius).toBeNull();
    });

    it('should handle ticket not found gracefully', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] }); // no ticket
        // No embedding call expected since contextParts will be empty
        // Actually: contextParts is empty so no lesson search

        const result = await memoryGetContextHandler({
            ticket_id: 'NONEXISTENT',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(result.isError).toBeUndefined();
        expect(data.blast_radius).toBeNull();
        expect(data.relevant_lessons).toHaveLength(0);
        expect(data.context_score).toBe(0.0);
    });
});

// ── Handler Tests — combined mode ────────────────────────────────────────────

describe('memoryGetContextHandler — combined mode', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockEmbedText.mockReset();
    });

    it('should return both blast radius and ticket context with lessons', async () => {
        const br = makeBlastRadius();
        const lesson1 = makeLesson();
        const lesson2 = makeLesson({ id: 'lesson-002', similarity: 0.88 });

        // blast_radius query
        mockQuery.mockResolvedValueOnce({ rows: [{ result: br }] });
        // ticket lookup
        mockQuery.mockResolvedValueOnce({
            rows: [{ title: 'Auth feature', description: 'Add login' }],
        });
        // lesson search
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({
            rows: [{ search_similar_lessons: [lesson1, lesson2] }],
        });

        const result = await memoryGetContextHandler({
            file_path: 'src/services/auth.ts',
            ticket_id: 'TASK-003',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(data.file_path).toBe('src/services/auth.ts');
        expect(data.ticket_id).toBe('TASK-003');
        expect(data.blast_radius).toEqual(br);
        expect(data.relevant_lessons).toHaveLength(2);
        expect(data.context_score).toBe(1.0); // 0.3 + 0.3 + 0.4 = 1.0
    });
});

// ── Handler Tests — graceful degradation ─────────────────────────────────────

describe('memoryGetContextHandler — graceful degradation', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockEmbedText.mockReset();
    });

    it('should degrade gracefully when blast radius DB call fails', async () => {
        // blast_radius throws
        mockQuery.mockRejectedValueOnce(new Error('blast_radius function not found'));
        // lesson search (still proceeds because contextParts has "File: ...")
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] });

        const result = await memoryGetContextHandler({
            file_path: 'src/services/auth.ts',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(result.isError).toBeUndefined();
        expect(data.blast_radius).toBeNull();
        // context_score is 0 for blast radius (failed) but file_path still in context
        expect(data.relevant_lessons).toHaveLength(0);
    });

    it('should degrade gracefully when ticket lookup fails', async () => {
        // ticket lookup throws
        mockQuery.mockRejectedValueOnce(new Error('connection refused'));

        const result = await memoryGetContextHandler({
            ticket_id: 'TASK-FAIL',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(result.isError).toBeUndefined();
        expect(data.blast_radius).toBeNull();
        expect(data.relevant_lessons).toHaveLength(0);
        expect(data.context_score).toBe(0.0);
    });

    it('should degrade gracefully when embedding service fails', async () => {
        // blast_radius succeeds
        mockQuery.mockResolvedValueOnce({ rows: [{ result: makeBlastRadius() }] });
        // embedding fails
        mockEmbedText.mockRejectedValueOnce(new Error('OpenAI rate limit'));

        const result = await memoryGetContextHandler({
            file_path: 'src/services/auth.ts',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(result.isError).toBeUndefined();
        expect(data.blast_radius).not.toBeNull();
        expect(data.relevant_lessons).toHaveLength(0);
        expect(data.context_score).toBe(0.3); // blast only
    });

    it('should degrade gracefully when lesson search DB call fails', async () => {
        // blast_radius succeeds
        mockQuery.mockResolvedValueOnce({ rows: [{ result: makeBlastRadius() }] });
        // embedding succeeds
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        // lesson search DB fails
        mockQuery.mockRejectedValueOnce(new Error('search_similar_lessons not found'));

        const result = await memoryGetContextHandler({
            file_path: 'src/services/auth.ts',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(result.isError).toBeUndefined();
        expect(data.blast_radius).not.toBeNull();
        expect(data.relevant_lessons).toHaveLength(0);
        expect(data.context_score).toBe(0.3);
    });

    it('should degrade gracefully when ALL subsystems fail', async () => {
        // blast_radius fails
        mockQuery.mockRejectedValueOnce(new Error('pg down'));
        // embedding fails
        mockEmbedText.mockRejectedValueOnce(new Error('openai down'));

        const result = await memoryGetContextHandler({
            file_path: 'src/services/auth.ts',
            max_lessons: 5,
        });

        const data = parseContent(result);

        expect(result.isError).toBeUndefined();
        expect(data.blast_radius).toBeNull();
        expect(data.relevant_lessons).toHaveLength(0);
        expect(data.context_score).toBe(0.0);
    });
});

// ── Handler Tests — context_score calculation ────────────────────────────────

describe('memoryGetContextHandler — context_score', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockEmbedText.mockReset();
    });

    it('should cap context_score at 1.0', async () => {
        const br = makeBlastRadius();
        const lessons = [makeLesson(), makeLesson({ id: 'l2' })];

        mockQuery.mockResolvedValueOnce({ rows: [{ result: br }] });
        mockQuery.mockResolvedValueOnce({
            rows: [{ title: 'T', description: 'D' }],
        });
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({
            rows: [{ search_similar_lessons: lessons }],
        });

        const result = await memoryGetContextHandler({
            file_path: 'src/x.ts',
            ticket_id: 'TASK-CAP',
            max_lessons: 5,
        });

        const data = parseContent(result);
        expect(data.context_score).toBeLessThanOrEqual(1.0);
    });

    it('should score 0.0 when no context is available', async () => {
        // ticket not found
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await memoryGetContextHandler({
            ticket_id: 'NONEXISTENT',
            max_lessons: 5,
        });

        const data = parseContent(result);
        expect(data.context_score).toBe(0.0);
    });

    it('should score 0.3 for blast radius only (no lessons)', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [{ result: makeBlastRadius() }] });
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] });

        const result = await memoryGetContextHandler({
            file_path: 'src/x.ts',
            max_lessons: 5,
        });

        const data = parseContent(result);
        expect(data.context_score).toBe(0.3);
    });

    it('should score 0.3 for ticket only (no lessons)', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [{ title: 'T', description: 'D' }],
        });
        mockEmbedText.mockResolvedValueOnce(FAKE_EMBEDDING);
        mockQuery.mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] });

        const result = await memoryGetContextHandler({
            ticket_id: 'TASK-X',
            max_lessons: 5,
        });

        const data = parseContent(result);
        expect(data.context_score).toBe(0.3);
    });
});
