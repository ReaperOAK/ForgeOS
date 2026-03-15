import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const mockTicketsGetHandler = vi.fn();
const mockTicketsPayloadHandler = vi.fn();
const mockMemorySearchLessonsHandler = vi.fn();
const mockCodeBlastRadiusHandler = vi.fn();
const mockCodeSearchSymbolsHandler = vi.fn();
const mockGeneratePrompt = vi.fn();
const mockPoolQuery = vi.fn();

vi.mock('../middleware/logging.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../db/pool.js', () => ({
    pool: {
        query: (...args: unknown[]) => mockPoolQuery(...args),
    },
}));

vi.mock('../tools/tickets-get.js', () => ({
    ticketsGetHandler: (...args: unknown[]) => mockTicketsGetHandler(...args),
}));

vi.mock('../tools/tickets-payload.js', () => ({
    ticketsPayloadHandler: (...args: unknown[]) => mockTicketsPayloadHandler(...args),
}));

vi.mock('../tools/memory-search-lessons.js', () => ({
    memorySearchLessonsHandler: (...args: unknown[]) => mockMemorySearchLessonsHandler(...args),
}));

vi.mock('../tools/code-blast-radius.js', () => ({
    codeBlastRadiusHandler: (...args: unknown[]) => mockCodeBlastRadiusHandler(...args),
}));

vi.mock('../tools/code-search-symbols.js', () => ({
    codeSearchSymbolsHandler: (...args: unknown[]) => mockCodeSearchSymbolsHandler(...args),
}));

vi.mock('../services/packet-validator.js', () => ({
    validatePacketSections: vi.fn(() => ({
        valid: true,
        missingSections: [],
        misordered: [],
        structuredReason: 'ok',
    })),
    PacketValidationError: class PacketValidationError extends Error {
        constructor(result: { structuredReason: string }) {
            super(`Packet validation failed: ${result.structuredReason}`);
            this.name = 'PacketValidationError';
        }

        public toPublicMessage(): string {
            return 'Packet validation failed. Packet structure is invalid.';
        }
    },
}));

vi.mock('../services/prompt-architect-service.js', () => ({
    PromptArchitectService: class {
        async generatePrompt(...args: unknown[]) {
            return mockGeneratePrompt(...args);
        }
    },
}));

vi.mock('@google/genai', () => ({
    GoogleGenAI: class {
        models = {
            generateContent: vi.fn(),
        };
    },
}));

function textResult(value: unknown, isError = false): CallToolResult {
    return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
        isError,
    } as CallToolResult;
}

describe('memory snapshot versioning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        mockPoolQuery.mockResolvedValue({ rowCount: 1, rows: [] });

        process.env.FORGEOS_REPO_COMMIT = 'repo-main';
        process.env.FORGEOS_GRAPH_VERSION = 'graph-v1';
        process.env.FORGEOS_MEMORY_SNAPSHOT_VERSION = 'memory-v1';
        delete process.env.GEMINI_API_KEY;

        mockTicketsGetHandler.mockResolvedValue(textResult({
            ticket: {
                ticket_id: 'TASK-PC-BE-012',
                title: 'Deterministic memory snapshot retrieval',
                description: 'Project memory into packet sections',
                type: 'backend',
                priority: 'high',
                acceptance_criteria: ['AC1', 'AC2'],
                history: [],
            },
        }));

        mockTicketsPayloadHandler.mockResolvedValue(textResult({
            file_scope: ['forgeos-server/src/services/compiler.ts'],
            memory_entries: [{ id: 1 }],
        }));

        mockCodeBlastRadiusHandler.mockResolvedValue(textResult({ total_affected: 1, affected_files: [] }));
        mockCodeSearchSymbolsHandler.mockResolvedValue(textResult({ total: 0, symbols: [] }));
        mockGeneratePrompt.mockResolvedValue({
            prompt: [
                '**ROLE**\nBackend',
                '**TICKET**\nTASK-PC-BE-012',
                '**SYSTEM CONSTRAINTS**\nRespect scope',
                '**HISTORY**\nNo prior history',
                '**LEARNINGS**\n- learning',
                '**BEST PRACTICES**\n- best practice',
                '**CONTEXT LOCATIONS**\nforgeos-server/src/services/compiler.ts',
                '**YOUR EXACT TASK**\nImplement snapshot handling',
                '**EXECUTION PLAN**\n1. read 2. implement 3. validate',
                '**EDGE CASES**\nprovider degradation',
                '**POST-COMPLETION**\nrecord evidence',
            ].join('\n\n'),
            provider: 'ollama',
            model: 'qwen2.5',
            usedFallback: true,
        });
    });

    it('selects and orders lesson sections deterministically for identical snapshot inputs', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'b', category: 'backend', lesson_text: 'Refactor after green.', similarity: 0.7, created_at: '2026-03-14T00:00:00Z' },
                    { id: 'a', category: 'backend', lesson_text: 'Write the failing test first.', similarity: 0.9, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'bp-b', category: 'instruction', lesson_text: 'Keep LEARNINGS separate from BEST PRACTICES.', similarity: 0.6, created_at: '2026-03-14T00:00:00Z' },
                    { id: 'bp-a', category: 'instruction', lesson_text: 'Use stable ordering before hashing.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'a', category: 'backend', lesson_text: 'Write the failing test first.', similarity: 0.9, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'b', category: 'backend', lesson_text: 'Refactor after green.', similarity: 0.7, created_at: '2026-03-14T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'bp-a', category: 'instruction', lesson_text: 'Use stable ordering before hashing.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'bp-b', category: 'instruction', lesson_text: 'Keep LEARNINGS separate from BEST PRACTICES.', similarity: 0.6, created_at: '2026-03-14T00:00:00Z' },
                ],
            }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');

        const first = await retrieveMemorySnapshot('deterministic query');
        const second = await retrieveMemorySnapshot('deterministic query');

        expect(first.learnings).toEqual([
            'backend: Write the failing test first.',
            'backend: Refactor after green.',
        ]);
        expect(first.bestPractices).toEqual([
            'instruction: Use stable ordering before hashing.',
            'instruction: Keep LEARNINGS separate from BEST PRACTICES.',
        ]);
        expect(second.learnings).toEqual(first.learnings);
        expect(second.bestPractices).toEqual(first.bestPractices);
        expect(second.version).toBe(first.version);
    });

    it('changes the compiler context hash when the snapshot version changes', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'l1', category: 'backend', lesson_text: 'Original lesson.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' }],
            }))
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'bp1', category: 'instruction', lesson_text: 'Original instruction.', similarity: 0.7, created_at: '2026-03-15T00:00:00Z' }],
            }))
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'l2', category: 'backend', lesson_text: 'Updated lesson.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' }],
            }))
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'bp1', category: 'instruction', lesson_text: 'Original instruction.', similarity: 0.7, created_at: '2026-03-15T00:00:00Z' }],
            }));

        const { compileTicketPrompt } = await import('../services/compiler.js');

        const first = await compileTicketPrompt('TASK-PC-BE-012');
        const second = await compileTicketPrompt('TASK-PC-BE-012');

        expect(first.memorySnapshotVersion).not.toBe(second.memorySnapshotVersion);
        expect(first.contextHash).not.toBe(second.contextHash);
    });

    it('projects learnings and best practices into separate fallback context sections', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'l1', category: 'backend', lesson_text: 'Use deterministic sorting.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' }],
            }))
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'bp1', category: 'instruction', lesson_text: 'Preserve packet section boundaries.', similarity: 0.9, created_at: '2026-03-15T00:00:00Z' }],
            }));

        const { compileTicketPrompt } = await import('../services/compiler.js');
        await compileTicketPrompt('TASK-PC-BE-012');

        const [context] = mockGeneratePrompt.mock.calls[0] as [Record<string, unknown>];

        expect(context.learnings).toEqual(['backend: Use deterministic sorting.']);
        expect(context.bestPractices).toEqual(expect.arrayContaining([
            'instruction: Preserve packet section boundaries.',
        ]));
        expect(context.bestPractices).not.toContain('backend: Use deterministic sorting.');
    });

    it('marks reduced completeness when one memory source is unavailable without crashing compile', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'l1', category: 'backend', lesson_text: 'Use deterministic sorting.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' }],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }, true));

        const { compileTicketPrompt } = await import('../services/compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-012');

        expect(result.memoryCompleteness).toBe('reduced');
        expect(result.memoryWarnings).toContain('instruction-search-unavailable');
        expect(result.packetEnvelope.memoryCompleteness).toBe('reduced');
        expect(result.packetEnvelope.memoryWarnings).toContain('instruction-search-unavailable');
        expect(result.prompt).toContain('**BEST PRACTICES**');
    });

    // ── memory-provider normalization edge cases ─────────────────────────────────

    it('filters out entries with empty, whitespace-only, or non-string lesson_text', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'a', category: 'backend', lesson_text: '', similarity: 0.9, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'b', category: 'backend', lesson_text: '   ', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'c', category: 'backend', lesson_text: null, similarity: 0.7, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'd', category: 'backend', lesson_text: 42, similarity: 0.6, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'e', category: 'backend', lesson_text: 'Valid lesson.', similarity: 0.5, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('edge case query');

        expect(snapshot.learnings).toHaveLength(1);
        expect(snapshot.learnings[0]).toBe('backend: Valid lesson.');
    });

    it('normalizes null, empty, and whitespace-only lesson category to "lesson"', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'a', category: null, lesson_text: 'Null category lesson.', similarity: 0.9, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'b', category: '', lesson_text: 'Empty category lesson.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'c', category: '   ', lesson_text: 'Whitespace category lesson.', similarity: 0.7, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('category edge case');

        expect(snapshot.learnings).toContain('lesson: Null category lesson.');
        expect(snapshot.learnings).toContain('lesson: Empty category lesson.');
        expect(snapshot.learnings).toContain('lesson: Whitespace category lesson.');
    });

    it('generates fallback id for entries with null, empty, or whitespace id', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: null, category: 'backend', lesson_text: 'Null id lesson.', similarity: 0.9, created_at: '2026-03-15T00:00:00Z' },
                    { id: '', category: 'backend', lesson_text: 'Empty id lesson.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: '   ', category: 'backend', lesson_text: 'Whitespace id lesson.', similarity: 0.7, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('id fallback');

        expect(snapshot.learningEntries[0].id).toBe('lesson-0-backend');
        expect(snapshot.learningEntries[1].id).toBe('lesson-1-backend');
        expect(snapshot.learningEntries[2].id).toBe('lesson-2-backend');
    });

    it('defaults similarity to 0 for null, non-numeric, and non-finite values', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'a', category: 'backend', lesson_text: 'Valid similarity.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'b', category: 'backend', lesson_text: 'Null similarity.', similarity: null, created_at: '2026-03-14T00:00:00Z' },
                    { id: 'c', category: 'backend', lesson_text: 'String similarity.', similarity: 'high', created_at: '2026-03-13T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('similarity defaults');

        expect(snapshot.learningEntries[0].similarity).toBe(0.8);
        expect(snapshot.learningEntries[1].similarity).toBe(0);
        expect(snapshot.learningEntries[2].similarity).toBe(0);
    });

    it('uses category as tiebreaker when similarity and createdAt are equal', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'x', category: 'zzz-last', lesson_text: 'Late category.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'y', category: 'aaa-first', lesson_text: 'Early category.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('category sort');

        expect(snapshot.learningEntries[0].category).toBe('aaa-first');
        expect(snapshot.learningEntries[1].category).toBe('zzz-last');
    });

    it('uses lessonText as tiebreaker when similarity, createdAt, and category are all equal', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'x', category: 'backend', lesson_text: 'Z lesson.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'y', category: 'backend', lesson_text: 'A lesson.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('lesson text sort');

        expect(snapshot.learningEntries[0].lessonText).toBe('A lesson.');
        expect(snapshot.learningEntries[1].lessonText).toBe('Z lesson.');
    });

    it('uses id as final tiebreaker when all other sort fields are identical', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [
                    { id: 'z-id', category: 'backend', lesson_text: 'Same text.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                    { id: 'a-id', category: 'backend', lesson_text: 'Same text.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' },
                ],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('id sort');

        expect(snapshot.learningEntries[0].id).toBe('a-id');
        expect(snapshot.learningEntries[1].id).toBe('z-id');
    });

    it('reports lessons-search-malformed when general search response has a non-array lessons field', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({ lessons: 'not-an-array' }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('malformed general');

        expect(snapshot.completeness).toBe('reduced');
        expect(snapshot.warnings).toContain('lessons-search-malformed');
    });

    it('reports instruction-search-malformed when instruction search response has a non-array lessons field', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({ lessons: [] }))
            .mockResolvedValueOnce(textResult({ lessons: 42 }));

        const { retrieveMemorySnapshot } = await import('../services/memory-provider.js');
        const snapshot = await retrieveMemorySnapshot('malformed instruction');

        expect(snapshot.completeness).toBe('reduced');
        expect(snapshot.warnings).toContain('instruction-search-malformed');
    });

    // ── loadMemorySnapshotForTicket ───────────────────────────────────────────────

    it('loadMemorySnapshotForTicket builds query from ticket title, description, and criteria', async () => {
        mockMemorySearchLessonsHandler
            .mockResolvedValueOnce(textResult({
                lessons: [{ id: 'l1', category: 'backend', lesson_text: 'Fetched lesson.', similarity: 0.8, created_at: '2026-03-15T00:00:00Z' }],
            }))
            .mockResolvedValueOnce(textResult({ lessons: [] }));

        const { loadMemorySnapshotForTicket } = await import('../services/memory-provider.js');
        const snapshot = await loadMemorySnapshotForTicket('TASK-PC-BE-012');

        expect(snapshot.query).toContain('Deterministic memory snapshot retrieval');
        expect(snapshot.query).toContain('Project memory into packet sections');
        expect(snapshot.learnings).toHaveLength(1);
        expect(snapshot.learnings[0]).toBe('backend: Fetched lesson.');
    });

    it('loadMemorySnapshotForTicket falls back to ticketId when all ticket text fields are blank', async () => {
        mockTicketsGetHandler.mockResolvedValueOnce(textResult({
            ticket: { ticket_id: 'TASK-PC-BE-012', title: '', description: null, acceptance_criteria: [] },
        }));
        mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [] }));

        const { loadMemorySnapshotForTicket } = await import('../services/memory-provider.js');
        const snapshot = await loadMemorySnapshotForTicket('TASK-PC-BE-012');

        expect(snapshot.query).toBe('TASK-PC-BE-012');
    });

    // ── compiler: queue machinery and cache operations ───────────────────────────

    it('queues compile job, deduplicates by idempotency key, and drains queue to completion', async () => {
        mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [] }));

        const { queueCompileTicketPrompt, waitForCompileQueueToDrain } = await import('../services/compiler.js');

        queueCompileTicketPrompt('TASK-PC-BE-012', 'test-trigger');
        // same key → idempotent no-op
        queueCompileTicketPrompt('TASK-PC-BE-012', 'test-trigger');

        await waitForCompileQueueToDrain();

        // persistCompiledPromptAtomic calls pool.query once
        expect(mockPoolQuery).toHaveBeenCalledTimes(1);
        const [sql] = mockPoolQuery.mock.calls[0] as [string];
        expect(sql).toContain('SET compiled_prompt = $1');
    });

    it('logs error and continues when a queued compile job fails', async () => {
        mockTicketsGetHandler.mockRejectedValueOnce(new Error('ticket unavailable'));

        const { queueCompileTicketPrompt, waitForCompileQueueToDrain } = await import('../services/compiler.js');

        queueCompileTicketPrompt('TASK-PC-BE-012', 'error-trigger');

        await waitForCompileQueueToDrain();

        // Pool was never reached because compile failed before persistence
        expect(mockPoolQuery).not.toHaveBeenCalled();
    });

    it('invalidatePromptCache sets compiled_prompt_context_hash to NULL and freshness to missing', async () => {
        const { invalidatePromptCache } = await import('../services/compiler.js');
        await invalidatePromptCache('TASK-PC-BE-012');

        expect(mockPoolQuery).toHaveBeenCalledOnce();
        const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('compiled_prompt_context_hash = NULL');
        expect(sql).toContain("compiled_prompt_freshness_status = 'missing'");
        expect(params[0]).toBe('TASK-PC-BE-012');
    });

    it('compileIfStale returns a cached result when the stored hash matches the current hash', async () => {
        mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [] }));

        // Compute the hash that compileIfStale will compute (context-hash is not mocked)
        const { buildContextHashInputsFromEnv, computeContextHash } = await import('../services/context-hash.js');
        const freshHash = computeContextHash(
            buildContextHashInputsFromEnv(process.env, 'v1', 'prompt-architect-v1', { memorySnapshotVersion: 'memory-v1' }),
        );

        // Pool SELECT returns a stored prompt with a matching hash
        mockPoolQuery.mockResolvedValueOnce({
            rowCount: 1,
            rows: [{
                compiled_prompt: '**ROLE**\ncached content',
                compiled_prompt_context_hash: freshHash,
                metadata: null,
            }],
        });

        const { compileIfStale } = await import('../services/compiler.js');
        const result = await compileIfStale('TASK-PC-BE-012');

        expect(result.provider).toBe('cached');
        expect(result.freshnessStatus).toBe('fresh');
        expect(result.contextHash).toBe(freshHash);
        // Only SELECT — no UPDATE since cache is fresh
        expect(mockPoolQuery).toHaveBeenCalledOnce();
    });

    it('compileIfStale recompiles and stores when the stored hash is stale', async () => {
        mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [] }));

        // Pool SELECT returns a mismatching hash; Pool UPDATE for persist
        mockPoolQuery
            .mockResolvedValueOnce({
                rowCount: 1,
                rows: [{
                    compiled_prompt: '**ROLE**\nold prompt',
                    compiled_prompt_context_hash: 'completely-wrong-stale-hash',
                    metadata: null,
                }],
            })
            .mockResolvedValueOnce({ rowCount: 1, rows: [] });

        const { compileIfStale } = await import('../services/compiler.js');
        const result = await compileIfStale('TASK-PC-BE-012');

        expect(result.provider).toBe('ollama');
        expect(result.usedFallback).toBe(true);
        // SELECT (load stored) + UPDATE (persist recompiled)
        expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });
});