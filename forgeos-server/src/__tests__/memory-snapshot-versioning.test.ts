import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const mockTicketsGetHandler = vi.fn();
const mockTicketsPayloadHandler = vi.fn();
const mockMemorySearchLessonsHandler = vi.fn();
const mockCodeBlastRadiusHandler = vi.fn();
const mockCodeSearchSymbolsHandler = vi.fn();
const mockGeneratePrompt = vi.fn();

vi.mock('../middleware/logging.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
    },
}));

vi.mock('../db/pool.js', () => ({
    pool: {
        query: vi.fn(),
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
});