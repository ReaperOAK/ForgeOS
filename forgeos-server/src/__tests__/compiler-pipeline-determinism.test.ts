import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const mockPoolQuery = vi.fn();
const mockTicketsGetHandler = vi.fn();
const mockTicketsPayloadHandler = vi.fn();
const mockMemorySearchLessonsHandler = vi.fn();
const mockCodeBlastRadiusHandler = vi.fn();
const mockCodeSearchSymbolsHandler = vi.fn();
const mockGeneratePrompt = vi.fn();
const mockValidatePacketSections = vi.fn();

vi.mock('../db/pool.js', () => ({
    pool: {
        query: (...args: unknown[]) => mockPoolQuery(...args),
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

vi.mock('./prompt-architect-service.js', () => ({
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
    validatePacketSections: (...args: unknown[]) => mockValidatePacketSections(...args),
    PacketValidationError: class PacketValidationError extends Error {
        public result: unknown;

        constructor(result: { structuredReason: string }) {
            super(`Packet validation failed: ${result.structuredReason}`);
            this.name = 'PacketValidationError';
            this.result = result;
        }

        public toPublicMessage(): string {
            return 'Packet validation failed. Packet structure is invalid.';
        }
    },
}));

function textResult(value: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    } as CallToolResult;
}

describe('compiler pipeline determinism', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        delete process.env.GEMINI_API_KEY;

        process.env.FORGEOS_REPO_COMMIT = 'repo-main';
        process.env.FORGEOS_GRAPH_VERSION = 'graph-v1';
        process.env.FORGEOS_MEMORY_SNAPSHOT_VERSION = 'memory-v1';

        mockValidatePacketSections.mockReturnValue({
            valid: true,
            missingSections: [],
            misordered: [],
            structuredReason: 'All 11 sections present in correct order.',
        });

        mockTicketsGetHandler.mockResolvedValue(
            textResult({
                ticket: {
                    ticket_id: 'TASK-PC-BE-005',
                    title: 'Integrate compiler pipeline',
                    description: 'Wire hash and packet validation into persistence',
                    type: 'backend',
                    priority: 'high',
                    acceptance_criteria: ['AC1', 'AC2', 'AC3', 'AC4'],
                    history: [{ event_type: 'STAGE_COMPLETED', agent_name: 'Architect' }],
                },
            }),
        );

        mockTicketsPayloadHandler.mockResolvedValue(
            textResult({
                file_scope: ['src/services/compiler.ts', 'src/services/compile-orchestrator.ts'],
                memory_entries: [{ id: 1 }],
            }),
        );

        mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [] }));
        mockCodeBlastRadiusHandler.mockResolvedValue(textResult({ total_affected: 1, affected_files: [] }));
        mockCodeSearchSymbolsHandler.mockResolvedValue(textResult({ total: 1, symbols: [] }));

        mockGeneratePrompt.mockResolvedValue({
            prompt: [
                '**ROLE**\nBackend',
                '**TICKET**\nTASK-PC-BE-005',
                '**SYSTEM CONSTRAINTS**\nRespect scope',
                '**HISTORY**\nRecent Architect work',
                '**LEARNINGS**\nPrefer deterministic outputs',
                '**BEST PRACTICES**\nValidate packet schema',
                '**CONTEXT LOCATIONS**\nsrc/services/compiler.ts',
                '**YOUR EXACT TASK**\nCompile and persist packet metadata',
                '**EXECUTION PLAN**\n1) compile 2) validate 3) persist',
                '**EDGE CASES**\ninvalid packet payload',
                '**POST-COMPLETION**\nrecord evidence',
            ].join('\n\n'),
            provider: 'ollama',
            model: 'qwen2.5',
            usedFallback: true,
        });

        mockPoolQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    });

    it('stores valid packet with compiled prompt, compiled_at and context_hash metadata atomically', async () => {
        const { compileAndStoreTicketPrompt } = await import('../services/compiler.js');
        const result = await compileAndStoreTicketPrompt('TASK-PC-BE-005');

        expect(result.contextHash).toHaveLength(64);
        expect(mockPoolQuery).toHaveBeenCalledTimes(1);

        const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('SET compiled_prompt = $1');
        expect(sql).toContain('compiled_prompt_compiled_at = $2::timestamptz');
        expect(sql).toContain('compiled_prompt_context_hash = $5');

        const metadataPayload = JSON.parse(params[13] as string) as {
            compiled_prompt: { compiled_at: string; context_hash: string; packet_envelope: { contextHash: string } };
        };

        expect(metadataPayload.compiled_prompt.compiled_at).toBe(result.compiledAt);
        expect(metadataPayload.compiled_prompt.context_hash).toBe(result.contextHash);
        expect(metadataPayload.compiled_prompt.packet_envelope.contextHash).toBe(result.contextHash);
    });

    it('records packet validation error and does not persist success metadata', async () => {
        mockValidatePacketSections.mockReturnValue({
            valid: false,
            missingSections: ['EXECUTION PLAN'],
            misordered: [],
            structuredReason: 'Missing sections: EXECUTION PLAN',
        });

        const { compileAndStoreTicketPrompt } = await import('../services/compiler.js');

        await expect(compileAndStoreTicketPrompt('TASK-PC-BE-005')).rejects.toThrow('Packet validation failed');
        expect(mockPoolQuery).toHaveBeenCalledTimes(1);

        const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('SET last_error = $1');
        expect(sql).not.toContain('compiled_prompt = $1');
        expect(params[1]).toBe('TASK-PC-BE-005');
    });

    it('produces identical packet structure and context hash for identical compile inputs', async () => {
        const { compileAndStoreTicketPrompt } = await import('../services/compiler.js');

        const first = await compileAndStoreTicketPrompt('TASK-PC-BE-005');
        const firstParams = mockPoolQuery.mock.calls[0]?.[1] as unknown[];
        const firstMetadata = JSON.parse(firstParams[13] as string) as {
            compiled_prompt: { packet_envelope: unknown; context_hash: string };
        };

        const second = await compileAndStoreTicketPrompt('TASK-PC-BE-005');
        const secondParams = mockPoolQuery.mock.calls[1]?.[1] as unknown[];
        const secondMetadata = JSON.parse(secondParams[13] as string) as {
            compiled_prompt: { packet_envelope: unknown; context_hash: string };
        };

        const firstEnvelope = firstMetadata.compiled_prompt.packet_envelope as Record<string, unknown>;
        const secondEnvelope = secondMetadata.compiled_prompt.packet_envelope as Record<string, unknown>;
        const { compiledAt: _firstCompiledAt, ...firstEnvelopeWithoutTimestamp } = firstEnvelope;
        const { compiledAt: _secondCompiledAt, ...secondEnvelopeWithoutTimestamp } = secondEnvelope;

        expect(first.contextHash).toBe(second.contextHash);
        expect(firstMetadata.compiled_prompt.context_hash).toBe(secondMetadata.compiled_prompt.context_hash);
        expect(firstEnvelopeWithoutTimestamp).toEqual(secondEnvelopeWithoutTimestamp);
    });

    it('orchestrator composes compileIfStale with packet validation guard', async () => {
        vi.doMock('../services/compiler.js', () => ({
            compileIfStale: vi.fn().mockResolvedValue({
                prompt: '**ROLE**\nvalid packet',
                provider: 'cached',
                model: 'cached',
                usedFallback: false,
                packetEnvelope: {
                    envelopeVersion: 'v1',
                    packetVersion: 'v1',
                    packetSchemaVersion: 1,
                    templateVersion: 'prompt-architect-v1',
                    compiledAt: '2026-03-14T00:00:00.000Z',
                    contextHash: 'abc',
                    canonicalContext: {
                        repoCommit: 'repo-main',
                        graphVersion: 'graph-v1',
                        memorySnapshot: 'memory-v1',
                    },
                    compiledPrompt: '**ROLE**\nvalid packet',
                },
                compiledAt: '2026-03-14T00:00:00.000Z',
                contextHash: 'abc',
                packetSchemaVersion: 1,
                packetVersion: 'v1',
                templateVersion: 'prompt-architect-v1',
                freshnessStatus: 'fresh',
                staleReason: null,
                canonicalContext: {
                    repoCommit: 'repo-main',
                    graphVersion: 'graph-v1',
                    memorySnapshot: 'memory-v1',
                },
            }),
        }));

        vi.doMock('../services/packet-validator.js', () => ({
            validatePacketSections: vi.fn().mockReturnValue({
                valid: true,
                missingSections: [],
                misordered: [],
                structuredReason: 'ok',
            }),
            PacketValidationError: class PacketValidationError extends Error {
                constructor(result: { structuredReason: string }) {
                    super(`Packet validation failed: ${result.structuredReason}`);
                    this.name = 'PacketValidationError';
                }
            },
        }));

        const { orchestrateCompilePipeline } = await import('../services/compile-orchestrator.js');
        const result = await orchestrateCompilePipeline('TASK-PC-BE-005');

        expect(result.provider).toBe('cached');
        expect(result.packetVersion).toBe('v1');
    });

    it('orchestrator throws PacketValidationError when validation fails', async () => {
        vi.doMock('../services/compiler.js', () => ({
            compileIfStale: vi.fn().mockResolvedValue({
                prompt: '**ROLE**\ninvalid packet',
                provider: 'cached',
                model: 'cached',
                usedFallback: false,
                packetEnvelope: {
                    envelopeVersion: 'v1',
                    packetVersion: 'v1',
                    packetSchemaVersion: 1,
                    templateVersion: 'prompt-architect-v1',
                    compiledAt: '2026-03-14T00:00:00.000Z',
                    contextHash: 'abc',
                    canonicalContext: {
                        repoCommit: 'repo-main',
                        graphVersion: 'graph-v1',
                        memorySnapshot: 'memory-v1',
                    },
                    compiledPrompt: '**ROLE**\ninvalid packet',
                },
                compiledAt: '2026-03-14T00:00:00.000Z',
                contextHash: 'abc',
                packetSchemaVersion: 1,
                packetVersion: 'v1',
                templateVersion: 'prompt-architect-v1',
                freshnessStatus: 'fresh',
                staleReason: null,
                canonicalContext: {
                    repoCommit: 'repo-main',
                    graphVersion: 'graph-v1',
                    memorySnapshot: 'memory-v1',
                },
            }),
        }));

        vi.doMock('../services/packet-validator.js', () => ({
            validatePacketSections: vi.fn().mockReturnValue({
                valid: false,
                missingSections: ['EXECUTION PLAN'],
                misordered: [],
                structuredReason: 'Missing sections: EXECUTION PLAN',
            }),
            PacketValidationError: class PacketValidationError extends Error {
                constructor(result: { structuredReason: string }) {
                    super(`Packet validation failed: ${result.structuredReason}`);
                    this.name = 'PacketValidationError';
                }
            },
        }));

        const { orchestrateCompilePipeline } = await import('../services/compile-orchestrator.js');

        await expect(orchestrateCompilePipeline('TASK-PC-BE-005')).rejects.toThrow('Packet validation failed');
    });
});
