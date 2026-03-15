import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { buildContextHashInputsFromEnv, computeContextHash } from '../services/context-hash.js';

const mockTicketsGetHandler = vi.fn();
const mockTicketsPayloadHandler = vi.fn();
const mockMemorySearchLessonsHandler = vi.fn();
const mockCodeBlastRadiusHandler = vi.fn();
const mockCodeSearchSymbolsHandler = vi.fn();
const mockGeneratePrompt = vi.fn();

vi.mock('../db/pool.js', () => ({
    pool: {
        query: vi.fn(),
    },
}));

vi.mock('../middleware/logging.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
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

        toPublicMessage(): string {
            return 'Packet validation failed. Packet structure is invalid.';
        }
    },
}));

function textResult(value: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    } as CallToolResult;
}

describe('cognition snapshot versioning', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();

        delete process.env.GEMINI_API_KEY;
        delete process.env.FORGEOS_COGNITION_TIMEOUT_MS;

        process.env.FORGEOS_REPO_COMMIT = 'repo-main';
        process.env.FORGEOS_GRAPH_VERSION = 'graph-v1';
        process.env.FORGEOS_MEMORY_SNAPSHOT_VERSION = 'memory-v1';

        mockTicketsGetHandler.mockResolvedValue(
            textResult({
                ticket: {
                    ticket_id: 'TASK-PC-BE-013',
                    title: 'Deterministic cognition context retrieval',
                    description: 'Compile execution packets with stable cognition snapshot metadata.',
                    type: 'backend',
                    priority: 'critical',
                    acceptance_criteria: ['AC1', 'AC2', 'AC3', 'AC4'],
                    history: [],
                },
            }),
        );

        mockTicketsPayloadHandler.mockResolvedValue(
            textResult({
                file_scope: ['src/services/zeta.ts', 'src/services/alpha.ts'],
                memory_entries: [{ id: 1 }],
            }),
        );

        mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [] }));
        mockGeneratePrompt.mockResolvedValue({
            prompt: [
                '**ROLE**\nBackend',
                '**TICKET**\nTASK-PC-BE-013',
                '**SYSTEM CONSTRAINTS**\nRespect scope',
                '**HISTORY**\nNone',
                '**LEARNINGS**\nNone',
                '**BEST PRACTICES**\nBe deterministic',
                '**CONTEXT LOCATIONS**\n1. src/services/alpha.ts - Derived from tickets.payload file_scope.',
                '**YOUR EXACT TASK**\nImplement deterministic cognition context retrieval.',
                '**EXECUTION PLAN**\n1. collect 2. order 3. render',
                '**EDGE CASES**\nTimeouts',
                '**POST-COMPLETION**\nRecord evidence',
            ].join('\n\n'),
            provider: 'ollama',
            model: 'qwen2.5',
            usedFallback: true,
        });
    });

    it('produces deterministic context location ordering and rationale for the same snapshot', async () => {
        mockCodeBlastRadiusHandler.mockImplementation(async ({ file_path }: { file_path: string }) => {
            if (file_path === 'src/services/alpha.ts') {
                return textResult({
                    file_path,
                    total_affected: 2,
                    affected_files: ['src/services/mid.ts', 'src/services/beta.ts'],
                });
            }

            return textResult({
                file_path,
                total_affected: 1,
                affected_files: ['src/services/mid.ts'],
            });
        });
        mockCodeSearchSymbolsHandler.mockResolvedValue(
            textResult({
                total: 1,
                symbols: [{ file_path: 'src/services/symbol.ts' }],
            }),
        );

        const { compileTicketPrompt } = await import('../services/compiler.js');

        const first = await compileTicketPrompt('TASK-PC-BE-013');
        const second = await compileTicketPrompt('TASK-PC-BE-013');

        expect(first.packetEnvelope.contextLocations).toEqual(second.packetEnvelope.contextLocations);
        expect(first.packetEnvelope.contextLocations).toEqual([
            { path: 'src/services/alpha.ts', reason: 'Derived from tickets.payload file_scope.' },
            { path: 'src/services/zeta.ts', reason: 'Derived from tickets.payload file_scope.' },
            { path: 'src/services/beta.ts', reason: 'Impacted by blast radius from src/services/alpha.ts.' },
            { path: 'src/services/mid.ts', reason: 'Impacted by blast radius from src/services/alpha.ts. Impacted by blast radius from src/services/zeta.ts.' },
            { path: 'src/services/symbol.ts', reason: 'Relevant symbol search match for "cognition". Relevant symbol search match for "context". Relevant symbol search match for "Deterministic".' },
        ]);
    });

    it('changes context hash material when the cognition graph snapshot version mutates', () => {
        const baseline = computeContextHash(
            buildContextHashInputsFromEnv(
                {
                    FORGEOS_REPO_COMMIT: 'repo-main',
                    FORGEOS_GRAPH_VERSION: 'graph-v1',
                    FORGEOS_MEMORY_SNAPSHOT_VERSION: 'memory-v1',
                },
                'v1',
                'prompt-architect-v1',
                { graphVersion: 'snapshot-v1' },
            ),
        );

        const mutated = computeContextHash(
            buildContextHashInputsFromEnv(
                {
                    FORGEOS_REPO_COMMIT: 'repo-main',
                    FORGEOS_GRAPH_VERSION: 'graph-v1',
                    FORGEOS_MEMORY_SNAPSHOT_VERSION: 'memory-v1',
                },
                'v1',
                'prompt-architect-v1',
                { graphVersion: 'snapshot-v2' },
            ),
        );

        expect(mutated).not.toBe(baseline);
    });

    it('renders path and explicit relevance reason for each packet context location', async () => {
        mockCodeBlastRadiusHandler.mockResolvedValue(textResult({ total_affected: 0, affected_files: [] }));
        mockCodeSearchSymbolsHandler.mockResolvedValue(textResult({ total: 0, symbols: [] }));

        const { compileTicketPrompt } = await import('../services/compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-013');

        expect(result.packetEnvelope.contextLocations).toEqual([
            { path: 'src/services/alpha.ts', reason: 'Derived from tickets.payload file_scope.' },
            { path: 'src/services/zeta.ts', reason: 'Derived from tickets.payload file_scope.' },
        ]);
        expect(result.packetEnvelope.contextLocations.every((location) => location.path.length > 0 && location.reason.length > 0)).toBe(true);
    });

    it('continues compilation on cognition timeout and records partial-context warning metadata', async () => {
        process.env.FORGEOS_COGNITION_TIMEOUT_MS = '5';
        mockCodeBlastRadiusHandler.mockImplementation(() => new Promise(() => undefined));
        mockCodeSearchSymbolsHandler.mockResolvedValue(textResult({ total: 0, symbols: [] }));

        const { compileTicketPrompt } = await import('../services/compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-013');

        expect(result.prompt).toContain('**ROLE**');
        expect(result.packetEnvelope.contextLocations).toEqual([
            { path: 'src/services/alpha.ts', reason: 'Derived from tickets.payload file_scope.' },
            { path: 'src/services/zeta.ts', reason: 'Derived from tickets.payload file_scope.' },
        ]);
        expect(result.packetEnvelope.warnings).toEqual([
            {
                code: 'partial_context',
                message: 'Cognition provider timed out after 5ms; packet includes deterministic base context only.',
                source: 'cognition_provider',
            },
        ]);
    });
});