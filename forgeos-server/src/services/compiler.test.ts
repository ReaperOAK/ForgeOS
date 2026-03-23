import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const mockPoolQuery = vi.fn();
const mockTicketsGetHandler = vi.fn();
const mockTicketsPayloadHandler = vi.fn();
const mockMemorySearchLessonsHandler = vi.fn();
const mockCodeBlastRadiusHandler = vi.fn();
const mockCodeSearchSymbolsHandler = vi.fn();
const mockGeneratePrompt = vi.fn();
const mockGenerateContent = vi.fn();
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
            generateContent: (...args: unknown[]) => mockGenerateContent(...args),
        };
    },
}));

vi.mock('./packet-validator.js', () => ({
    validatePacketSections: (...args: unknown[]) => mockValidatePacketSections(...args),
    PacketValidationError: class PacketValidationError extends Error {
        public result: unknown;
        constructor(result: { structuredReason: string }) {
            super(`Packet validation failed: ${result.structuredReason}`);
            this.name = 'PacketValidationError';
            this.result = result;
        }
    },
}));

const mockGetAgentByStage = vi.fn();
vi.mock('./agent-definition-provider.js', () => ({
    getAgentByStage: (...args: unknown[]) => mockGetAgentByStage(...args),
    buildAgentContext: (agent: Record<string, unknown>) => `Agent context for ${agent.agent_name}`,
    formatAgentRole: (agent: Record<string, unknown>) => `You are the **${agent.agent_name}** subagent.`,
}));

function textResult(value: unknown): CallToolResult {
    return {
        content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }],
    } as CallToolResult;
}

describe('compiler service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        delete process.env.GEMINI_API_KEY;
        delete process.env.GEMINI_MODEL;
        process.env.FORGEOS_REPO_COMMIT = 'repo-main';
        process.env.FORGEOS_GRAPH_VERSION = 'graph-v1';
        process.env.FORGEOS_MEMORY_SNAPSHOT_VERSION = 'memory-v1';

        // Default: validation passes so existing tests are unaffected
        mockValidatePacketSections.mockReturnValue({
            valid: true,
            missingSections: [],
            misordered: [],
            structuredReason: 'All 11 sections present in correct order.',
        });

        mockTicketsGetHandler.mockResolvedValue(
            textResult({
                ticket: {
                    ticket_id: 'TASK-PC-BE-001',
                    title: 'Improve compiler context quality',
                    description: 'Refactor compiler prompt prep for deterministic output',
                    type: 'backend',
                    priority: 'high',
                    acceptance_criteria: ['AC1', 'AC2'],
                    history: [{ event_type: 'STAGE_COMPLETED', agent_name: 'Architect' }],
                },
            }),
        );
        mockTicketsPayloadHandler.mockResolvedValue(
            textResult({
                file_scope: ['src/services/compiler.ts', 'src/services/orchestrator.ts'],
                memory_entries: [{ id: 1 }, { id: 2 }],
            }),
        );
        mockMemorySearchLessonsHandler.mockResolvedValue(
            textResult({
                lessons: [{ category: 'backend', lesson_text: 'Prefer deterministic transformations.' }],
            }),
        );
        mockCodeBlastRadiusHandler.mockResolvedValue(
            textResult({ total_affected: 3, affected_files: ['src/services/compiler.ts'] }),
        );
        mockCodeSearchSymbolsHandler.mockResolvedValue(
            textResult({ total: 1, symbols: [{ name: 'compileTicketPrompt' }] }),
        );
        mockGetAgentByStage.mockResolvedValue({
            id: 'agent-1',
            agent_name: 'Backend',
            agent_role: 'Backend',
            description: 'Implements server-side logic',
            stage: 'BACKEND',
            model: 'Claude Opus 4.6',
            tools: ['memory/*'],
            constraints: {},
            forbidden_actions: ['NEVER skip TDD'],
            scope_included: ['src/'],
            scope_excluded: [],
            evidence_requirements: [],
            boot_sequence: [],
            execution_workflow: {},
            metadata: {},
            version: 1,
            created_at: '2026-03-23T00:00:00.000Z',
            updated_at: '2026-03-23T00:00:00.000Z',
        });
    });

    it('uses Gemini path when configured and returns packet metadata', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        process.env.GEMINI_MODEL = 'gemini-test-model';
        mockGenerateContent.mockResolvedValue({ text: '  compiled by gemini  ' });

        const { compileTicketPrompt } = await import('./compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-001');

        expect(result.prompt).toBe('compiled by gemini');
        expect(result.provider).toBe('gemini');
        expect(result.model).toBe('gemini-test-model');
        expect(result.usedFallback).toBe(false);
        expect(result.packetSchemaVersion).toBe(1);
        expect(result.packetVersion).toBe('v1');
        expect(result.templateVersion).toBe('prompt-architect-v1');
        expect(result.freshnessStatus).toBe('fresh');
        expect(result.staleReason).toBeNull();
        expect(result.contextHash).toHaveLength(64);
        expect(result.packetEnvelope).toMatchObject({
            envelopeVersion: 'v1',
            packetVersion: 'v1',
            packetSchemaVersion: 1,
            templateVersion: 'prompt-architect-v1',
            compiledPrompt: 'compiled by gemini',
        });
        expect(result.canonicalContext).toEqual({
            repoCommit: 'repo-main',
            graphVersion: 'graph-v1',
            memorySnapshot: 'memory-v1',
        });
        expect(result.packetEnvelope.canonicalContext).toEqual(result.canonicalContext);
        expect(result.packetEnvelope.contextHash).toBe(result.contextHash);

        expect(mockGeneratePrompt).not.toHaveBeenCalled();
        expect(mockCodeBlastRadiusHandler).toHaveBeenCalledTimes(2);
    });

    it('uses candidate parts text when Gemini response has no direct text', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({
            candidates: [{ content: { parts: [{ text: 'line 1' }, { text: 'line 2' }] } }],
        });

        const { compileTicketPrompt } = await import('./compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-001');

        expect(result.prompt).toBe('line 1\nline 2');
        expect(result.usedFallback).toBe(false);
    });

    it('falls back to PromptArchitectService when Gemini output is empty', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({ text: '   ' });
        mockGeneratePrompt.mockResolvedValue({
            prompt: 'fallback prompt',
            provider: 'ollama',
            model: 'qwen2.5',
            usedFallback: false,
        });

        const { compileTicketPrompt } = await import('./compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-001');

        expect(result.prompt).toBe('fallback prompt');
        expect(result.provider).toBe('ollama');
        expect(result.model).toBe('qwen2.5');
        expect(result.usedFallback).toBe(true);

        const [context] = mockGeneratePrompt.mock.calls[0] as [Record<string, unknown>];
        expect(context.contextFiles).toEqual([
            { path: 'src/services/compiler.ts', reason: 'Derived from tickets.payload file_scope.' },
            { path: 'src/services/orchestrator.ts', reason: 'Derived from tickets.payload file_scope.' },
        ]);
        expect(context.learnings).toEqual([
            'backend: Prefer deterministic transformations.',
            'backend: Prefer deterministic transformations.',
        ]);
        expect(context.history).toEqual([
            {
                agent: 'Architect',
                summary: 'Observed STAGE_COMPLETED event',
                outcome: 'See event payload for details',
                files: [],
            },
        ]);
    });

    it('maps missing context safely for fallback prompt generation', async () => {
        mockTicketsGetHandler.mockResolvedValue(
            textResult({
                ticket: {
                    ticket_id: 'TASK-PC-BE-001',
                    title: 'Fix compiler',
                    description: null,
                    type: 'backend',
                    priority: 'medium',
                    acceptance_criteria: ['AC1'],
                },
            }),
        );
        mockTicketsPayloadHandler.mockResolvedValue(textResult({ file_scope: null, memory_entries: [] }));
        mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [{ category: 123, lesson_text: null }] }));
        mockGeneratePrompt.mockResolvedValue({
            prompt: 'fallback prompt',
            provider: 'ollama',
            model: 'qwen2.5',
            usedFallback: true,
        });

        const { compileTicketPrompt } = await import('./compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-001');

        expect(result.usedFallback).toBe(true);
        const [context] = mockGeneratePrompt.mock.calls[0] as [Record<string, unknown>];
        expect(context.contextFiles).toEqual([
            { path: 'NOT FOUND — agent must investigate', reason: 'No file scope returned.' },
        ]);
        expect(context.learnings).toEqual([]);
        expect(context.exactTask).toBe('NOT FOUND — agent must investigate');
    });

    it('compiles and stores prompt metadata in ticket row', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({ text: 'compiled for storage' });
        mockPoolQuery.mockResolvedValue({ rowCount: 1 });

        const { compileAndStoreTicketPrompt } = await import('./compiler.js');
        const result = await compileAndStoreTicketPrompt('TASK-PC-BE-001');

        expect(result.prompt).toBe('compiled for storage');
        expect(mockPoolQuery).toHaveBeenCalledTimes(1);
        const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('UPDATE tickets');
        expect(params[14]).toBe('TASK-PC-BE-001');
        expect(params[3]).toBe('gemini-1.5-flash');

        const metadataJson = params[13] as string;
        expect(metadataJson).toContain('compiled_prompt');
        expect(metadataJson).toContain('packet_envelope');
    });

    it('produces stable context hash across repeated compile runs with identical context', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({ text: 'compiled deterministically' });

        const { compileTicketPrompt } = await import('./compiler.js');
        const runA = await compileTicketPrompt('TASK-PC-BE-001');
        const runB = await compileTicketPrompt('TASK-PC-BE-001');

        expect(runA.contextHash).toBe(runB.contextHash);
        expect(runA.packetEnvelope.contextHash).toBe(runB.packetEnvelope.contextHash);
        expect(runA.packetEnvelope.packetVersion).toBe('v1');
        expect(runB.packetEnvelope.packetVersion).toBe('v1');
    });

    it('falls back when tool responses are malformed JSON', async () => {
        mockTicketsGetHandler.mockResolvedValue(textResult('{bad json'));
        mockTicketsPayloadHandler.mockResolvedValue(textResult('{bad json'));
        mockMemorySearchLessonsHandler.mockResolvedValue(textResult('{bad json'));
        mockGeneratePrompt.mockResolvedValue({
            prompt: 'fallback prompt',
            provider: 'ollama',
            model: 'qwen2.5',
            usedFallback: true,
        });

        const { compileTicketPrompt } = await import('./compiler.js');
        const result = await compileTicketPrompt('TASK-PC-BE-001');

        expect(result.usedFallback).toBe(true);
        const [context] = mockGeneratePrompt.mock.calls[0] as [Record<string, unknown>];
        expect(context.ticket).toMatchObject({ ticket_id: 'UNKNOWN', type: 'backend', priority: 'medium' });
        expect(context.contextFiles).toEqual([
            { path: 'NOT FOUND — agent must investigate', reason: 'No file scope returned.' },
        ]);
    });

    it('deduplicates queued compile jobs for the same idempotency key', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({ text: 'queued prompt' });
        mockPoolQuery.mockResolvedValue({ rowCount: 1 });

        const { queueCompileTicketPrompt, waitForCompileQueueToDrain } = await import('./compiler.js');

        queueCompileTicketPrompt('TASK-PC-BE-001', 'claim-missing-compiled-prompt');
        queueCompileTicketPrompt('TASK-PC-BE-001', 'claim-missing-compiled-prompt');

        await waitForCompileQueueToDrain();

        expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    });

    it('allows distinct idempotency keys to enqueue separate jobs', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({ text: 'queued prompt' });
        mockPoolQuery.mockResolvedValue({ rowCount: 1 });

        const { queueCompileTicketPrompt, waitForCompileQueueToDrain } = await import('./compiler.js');

        queueCompileTicketPrompt('TASK-PC-BE-001', 'claim-missing-compiled-prompt', { idempotencyKey: 'job-1' });
        queueCompileTicketPrompt('TASK-PC-BE-001', 'claim-missing-compiled-prompt', { idempotencyKey: 'job-2' });

        await waitForCompileQueueToDrain();

        expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    it('throws PacketValidationError when Gemini generates a malformed packet (missing sections)', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({ text: 'incomplete prompt without proper sections' });
        mockValidatePacketSections.mockReturnValue({
            valid: false,
            missingSections: ['SYSTEM CONSTRAINTS', 'EXECUTION PLAN', 'EDGE CASES'],
            misordered: [],
            structuredReason: 'Missing sections: SYSTEM CONSTRAINTS, EXECUTION PLAN, EDGE CASES',
        });

        const { compileTicketPrompt } = await import('./compiler.js');

        await expect(compileTicketPrompt('TASK-PC-BE-001')).rejects.toThrow('Packet validation failed');
        await expect(compileTicketPrompt('TASK-PC-BE-001')).rejects.toMatchObject({
            name: 'PacketValidationError',
        });
    });

    it('throws PacketValidationError when fallback service generates a malformed packet', async () => {
        // No GEMINI_API_KEY — forces fallback path
        mockGeneratePrompt.mockResolvedValue({
            prompt: 'fallback without proper sections',
            provider: 'ollama',
            model: 'qwen2.5',
            usedFallback: false,
        });
        mockValidatePacketSections.mockReturnValue({
            valid: false,
            missingSections: ['ROLE', 'EXECUTION PLAN'],
            misordered: [],
            structuredReason: 'Missing sections: ROLE, EXECUTION PLAN',
        });

        const { compileTicketPrompt } = await import('./compiler.js');

        await expect(compileTicketPrompt('TASK-PC-BE-001')).rejects.toThrow('Packet validation failed');
        await expect(compileTicketPrompt('TASK-PC-BE-001')).rejects.toMatchObject({
            name: 'PacketValidationError',
        });
    });

    it('invokes validatePacketSections on the generated prompt text', async () => {
        process.env.GEMINI_API_KEY = 'test-gemini-key';
        mockGenerateContent.mockResolvedValue({ text: 'prompt text from gemini' });

        const { compileTicketPrompt } = await import('./compiler.js');
        await compileTicketPrompt('TASK-PC-BE-001');

        expect(mockValidatePacketSections).toHaveBeenCalledWith('prompt text from gemini');
    });
});
