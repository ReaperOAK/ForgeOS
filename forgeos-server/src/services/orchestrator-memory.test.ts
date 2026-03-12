/**
 * Unit tests for memory injection in the ForgeOS Orchestrator dispatch loop.
 *
 * Verifies:
 * - Generates embedding for ticket title + description before dispatch
 * - Queries search_similar_lessons() with ticket embedding and category
 * - Top 5 lessons (similarity >= 0.7) appended to delegation payload as prior_lessons
 * - Each lesson includes title, content, category, confidence, similarity_score
 * - Dispatch proceeds normally if no matching lessons found (empty array)
 * - Dispatch proceeds normally if embedding service is unavailable (graceful degradation)
 * - Dispatch proceeds normally if ticket lookup fails (graceful degradation)
 * - Dispatch proceeds normally if search_similar_lessons errors (graceful degradation)
 *
 * @ticket TASK-INT-BE035
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    ForgeOSOrchestrator,
    type OrchestratorConfig,
    type PriorLesson,
} from './orchestrator.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../middleware/logging.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

const mockEmbedText = vi.fn();

vi.mock('./embedding-service.js', () => ({
    EmbeddingService: vi.fn().mockImplementation(() => ({
        embedText: mockEmbedText,
    })),
}));

/** Build a mock pg.Pool with a controllable `query` function. */
function createMockPool(queryFn: ReturnType<typeof vi.fn>) {
    return { query: queryFn } as unknown as import('pg').Pool;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
    pollIntervalMs: 50,
    machineName: 'test-host',
    operatorName: 'test-operator',
    leaseMinutes: 30,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockEmbedding(dimensions = 1536): number[] {
    return Array.from({ length: dimensions }, (_, i) => Math.sin(i) * 0.1);
}

function makeSampleLessons() {
    return [
        {
            ticket_id: 'TASK-001',
            lesson_text: 'Always validate input before processing.',
            category: 'backend',
            similarity: 0.92,
        },
        {
            ticket_id: 'TASK-002',
            lesson_text: 'Use structured logging instead of console.log.',
            category: 'backend',
            similarity: 0.85,
        },
        {
            ticket_id: 'TASK-003',
            lesson_text: 'Add proper error handling for database queries.',
            category: 'backend',
            similarity: 0.78,
        },
    ];
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ForgeOSOrchestrator — Memory Injection', () => {
    let mockQuery: ReturnType<typeof vi.fn>;
    let orchestrator: ForgeOSOrchestrator;

    beforeEach(() => {
        mockQuery = vi.fn();
        mockEmbedText.mockReset();
    });

    afterEach(async () => {
        if (orchestrator?.isRunning) {
            await orchestrator.stop();
        }
    });

    // ── injectMemory method ───────────────────────────────────────────────

    describe('injectMemory', () => {
        it('generates embedding for ticket title+description and queries lessons', async () => {
            const embedding = makeMockEmbedding();
            const lessons = makeSampleLessons();

            mockQuery
                // 1st call: fetch ticket
                .mockResolvedValueOnce({
                    rows: [{ title: 'Fix auth bug', description: 'JWT validation fails on refresh', ticket_type: 'backend' }],
                })
                // 2nd call: search_similar_lessons
                .mockResolvedValueOnce({
                    rows: [{ search_similar_lessons: lessons }],
                });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-100');

            // Verify ticket lookup
            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT title, description, ticket_type FROM tickets WHERE ticket_id = $1',
                ['TASK-100'],
            );

            // Verify embedding was generated for title + description
            expect(mockEmbedText).toHaveBeenCalledWith('Fix auth bug JWT validation fails on refresh');

            // Verify search_similar_lessons call
            const vectorLiteral = `[${embedding.join(',')}]`;
            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
                [vectorLiteral, 'backend', 0.7, 5],
            );

            // Verify result shape
            expect(result).toHaveLength(3);
            expect(result[0]).toEqual({
                title: 'TASK-001',
                content: 'Always validate input before processing.',
                category: 'backend',
                confidence: 'HIGH',
                similarity_score: 0.92,
            });
        });

        it('returns top 5 lessons with correct structure', async () => {
            const embedding = makeMockEmbedding();
            const lessons = Array.from({ length: 5 }, (_, i) => ({
                ticket_id: `TASK-${i + 1}`,
                lesson_text: `Lesson ${i + 1}`,
                category: 'backend',
                similarity: 0.95 - i * 0.05,
            }));

            mockQuery
                .mockResolvedValueOnce({
                    rows: [{ title: 'Feature X', description: 'Implement feature X', ticket_type: 'backend' }],
                })
                .mockResolvedValueOnce({
                    rows: [{ search_similar_lessons: lessons }],
                });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-200');

            expect(result).toHaveLength(5);
            for (const lesson of result) {
                expect(lesson).toHaveProperty('title');
                expect(lesson).toHaveProperty('content');
                expect(lesson).toHaveProperty('category');
                expect(lesson).toHaveProperty('confidence', 'HIGH');
                expect(lesson).toHaveProperty('similarity_score');
                expect(typeof lesson.similarity_score).toBe('number');
            }
        });

        it('returns empty array when no matching lessons found', async () => {
            const embedding = makeMockEmbedding();

            mockQuery
                .mockResolvedValueOnce({
                    rows: [{ title: 'New feature', description: 'Something novel', ticket_type: 'backend' }],
                })
                .mockResolvedValueOnce({
                    rows: [{ search_similar_lessons: [] }],
                });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-300');

            expect(result).toEqual([]);
        });

        it('returns empty array when search_similar_lessons returns no rows', async () => {
            const embedding = makeMockEmbedding();

            mockQuery
                .mockResolvedValueOnce({
                    rows: [{ title: 'Feature Y', description: 'Desc Y', ticket_type: 'frontend' }],
                })
                .mockResolvedValueOnce({ rows: [] });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-400');

            expect(result).toEqual([]);
        });

        it('graceful degradation: returns empty array when embedding service throws', async () => {
            mockQuery.mockResolvedValueOnce({
                rows: [{ title: 'Auth fix', description: 'Fix broken auth', ticket_type: 'backend' }],
            });

            mockEmbedText.mockRejectedValueOnce(new Error('OPENAI_API_KEY not set'));

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-500');

            expect(result).toEqual([]);
        });

        it('graceful degradation: returns empty array when EmbeddingService constructor throws', async () => {
            // Temporarily override the mock to throw on construction
            const { EmbeddingService: EmbeddingMock } = await import('./embedding-service.js');
            const constructorMock = vi.mocked(EmbeddingMock);
            constructorMock.mockImplementationOnce(() => {
                throw new Error('OPENAI_API_KEY environment variable is required');
            });

            mockQuery.mockResolvedValueOnce({
                rows: [{ title: 'Test', description: 'Test desc', ticket_type: 'backend' }],
            });

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-550');

            expect(result).toEqual([]);
        });

        it('graceful degradation: returns empty array when ticket not found', async () => {
            mockQuery.mockResolvedValueOnce({ rows: [] });

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('NONEXISTENT');

            expect(result).toEqual([]);
            // Should not attempt embedding
            expect(mockEmbedText).not.toHaveBeenCalled();
        });

        it('graceful degradation: returns empty array when DB query fails', async () => {
            mockQuery.mockRejectedValueOnce(new Error('connection refused'));

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-600');

            expect(result).toEqual([]);
        });

        it('graceful degradation: returns empty array when search_similar_lessons throws', async () => {
            const embedding = makeMockEmbedding();

            mockQuery
                .mockResolvedValueOnce({
                    rows: [{ title: 'Feature', description: 'Desc', ticket_type: 'backend' }],
                })
                .mockRejectedValueOnce(new Error('function search_similar_lessons does not exist'));

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            const result = await orchestrator.injectMemory('TASK-700');

            expect(result).toEqual([]);
        });

        it('passes null category when ticket has no ticket_type', async () => {
            const embedding = makeMockEmbedding();

            mockQuery
                .mockResolvedValueOnce({
                    rows: [{ title: 'Generic task', description: 'Do something', ticket_type: null }],
                })
                .mockResolvedValueOnce({
                    rows: [{ search_similar_lessons: [] }],
                });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            await orchestrator.injectMemory('TASK-800');

            const vectorLiteral = `[${embedding.join(',')}]`;
            expect(mockQuery).toHaveBeenCalledWith(
                'SELECT search_similar_lessons($1::vector, $2, $3, $4)',
                [vectorLiteral, null, 0.7, 5],
            );
        });

        it('handles ticket with empty description', async () => {
            const embedding = makeMockEmbedding();

            mockQuery
                .mockResolvedValueOnce({
                    rows: [{ title: 'Standalone title', description: null, ticket_type: 'backend' }],
                })
                .mockResolvedValueOnce({
                    rows: [{ search_similar_lessons: [] }],
                });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            await orchestrator.injectMemory('TASK-900');

            // Should embed just the title
            expect(mockEmbedText).toHaveBeenCalledWith('Standalone title');
        });
    });

    // ── Integration with claimAndDispatch ──────────────────────────────────

    describe('claimAndDispatch with memory injection', () => {
        it('includes prior_lessons in the dispatch event payload', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const embedding = makeMockEmbedding();
            const lessons = makeSampleLessons();

            mockQuery
                // 1. poll: READY tickets
                .mockResolvedValueOnce({
                    rows: [{ ticket_id: 'TASK-DISPATCH-1', stage: 'BACKEND', priority: 'high' }],
                })
                // 2. agent upsert
                .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] })
                // 3. claim_ticket_by_id
                .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-DISPATCH-1' }] })
                // 4. injectMemory: ticket lookup
                .mockResolvedValueOnce({
                    rows: [{ title: 'Dispatch test', description: 'Test memory injection', ticket_type: 'backend' }],
                })
                // 5. injectMemory: search_similar_lessons
                .mockResolvedValueOnce({
                    rows: [{ search_similar_lessons: lessons }],
                })
                // 6. event insert
                .mockResolvedValueOnce({ rows: [] });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            await orchestrator.start();
            await vi.advanceTimersByTimeAsync(DEFAULT_CONFIG.pollIntervalMs + 50);
            await orchestrator.stop();

            // Verify the event INSERT call (6th query) contains prior_lessons
            const eventCall = mockQuery.mock.calls.find(
                (call: unknown[]) =>
                    typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO events'),
            );
            expect(eventCall).toBeDefined();

            const payload = JSON.parse(eventCall![1][5] as string);
            expect(payload.prior_lessons).toHaveLength(3);
            expect(payload.prior_lessons[0]).toEqual({
                title: 'TASK-001',
                content: 'Always validate input before processing.',
                category: 'backend',
                confidence: 'HIGH',
                similarity_score: 0.92,
            });

            vi.useRealTimers();
        });

        it('dispatches with empty prior_lessons when no lessons match', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });
            const embedding = makeMockEmbedding();

            mockQuery
                // 1. poll
                .mockResolvedValueOnce({
                    rows: [{ ticket_id: 'TASK-DISPATCH-2', stage: 'BACKEND', priority: 'medium' }],
                })
                // 2. agent upsert
                .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-2' }] })
                // 3. claim
                .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-DISPATCH-2' }] })
                // 4. ticket lookup
                .mockResolvedValueOnce({
                    rows: [{ title: 'No matches', description: 'Novel work', ticket_type: 'frontend' }],
                })
                // 5. search_similar_lessons (empty)
                .mockResolvedValueOnce({ rows: [{ search_similar_lessons: [] }] })
                // 6. event insert
                .mockResolvedValueOnce({ rows: [] });

            mockEmbedText.mockResolvedValueOnce(embedding);

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            await orchestrator.start();
            await vi.advanceTimersByTimeAsync(DEFAULT_CONFIG.pollIntervalMs + 50);
            await orchestrator.stop();

            const eventCall = mockQuery.mock.calls.find(
                (call: unknown[]) =>
                    typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO events'),
            );
            expect(eventCall).toBeDefined();

            const payload = JSON.parse(eventCall![1][5] as string);
            expect(payload.prior_lessons).toEqual([]);

            vi.useRealTimers();
        });

        it('dispatches normally when embedding service fails (graceful degradation)', async () => {
            vi.useFakeTimers({ shouldAdvanceTime: true });

            mockQuery
                // 1. poll
                .mockResolvedValueOnce({
                    rows: [{ ticket_id: 'TASK-DISPATCH-3', stage: 'QA', priority: 'low' }],
                })
                // 2. agent upsert
                .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-3' }] })
                // 3. claim
                .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-DISPATCH-3' }] })
                // 4. ticket lookup
                .mockResolvedValueOnce({
                    rows: [{ title: 'Degradation test', description: 'Test', ticket_type: 'qa' }],
                })
                // 5. event insert (search_similar_lessons skipped due to embedding fail)
                .mockResolvedValueOnce({ rows: [] });

            mockEmbedText.mockRejectedValueOnce(new Error('API rate limited'));

            const pool = createMockPool(mockQuery);
            orchestrator = new ForgeOSOrchestrator(pool, DEFAULT_CONFIG);

            await orchestrator.start();
            await vi.advanceTimersByTimeAsync(DEFAULT_CONFIG.pollIntervalMs + 50);
            await orchestrator.stop();

            // Dispatch should still succeed — event was recorded
            const eventCall = mockQuery.mock.calls.find(
                (call: unknown[]) =>
                    typeof call[0] === 'string' && (call[0] as string).includes('INSERT INTO events'),
            );
            expect(eventCall).toBeDefined();

            const payload = JSON.parse(eventCall![1][5] as string);
            expect(payload.prior_lessons).toEqual([]);
            expect(payload.source).toBe('orchestrator');
            expect(payload.action).toBe('dispatch');

            vi.useRealTimers();
        });
    });
});
