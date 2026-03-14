import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    buildContextHashInputsFromEnv,
    canonicalSerialize,
    computeContextHash,
    evaluatePromptFreshness,
} from '../services/context-hash.js';

// ---------------------------------------------------------------------------
// Mocks for compiler freshness-gate tests
// ---------------------------------------------------------------------------

const mockPoolQuery = vi.fn();
const mockTicketsGetHandler = vi.fn();
const mockTicketsPayloadHandler = vi.fn();
const mockMemorySearchLessonsHandler = vi.fn();
const mockCodeBlastRadiusHandler = vi.fn();
const mockCodeSearchSymbolsHandler = vi.fn();
const mockGenerateContent = vi.fn();
const mockGeneratePrompt = vi.fn();

vi.mock('../db/pool.js', () => ({ pool: { query: (...a: unknown[]) => mockPoolQuery(...a) } }));
vi.mock('../middleware/logging.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../tools/tickets-get.js', () => ({ ticketsGetHandler: (...a: unknown[]) => mockTicketsGetHandler(...a) }));
vi.mock('../tools/tickets-payload.js', () => ({ ticketsPayloadHandler: (...a: unknown[]) => mockTicketsPayloadHandler(...a) }));
vi.mock('../tools/memory-search-lessons.js', () => ({ memorySearchLessonsHandler: (...a: unknown[]) => mockMemorySearchLessonsHandler(...a) }));
vi.mock('../tools/code-blast-radius.js', () => ({ codeBlastRadiusHandler: (...a: unknown[]) => mockCodeBlastRadiusHandler(...a) }));
vi.mock('../tools/code-search-symbols.js', () => ({ codeSearchSymbolsHandler: (...a: unknown[]) => mockCodeSearchSymbolsHandler(...a) }));
vi.mock('./prompt-architect-service.js', () => ({
    PromptArchitectService: class {
        async generatePrompt(...a: unknown[]) { return mockGeneratePrompt(...a); }
    },
}));
vi.mock('@google/genai', () => ({
    GoogleGenAI: class {
        models = { generateContent: (...a: unknown[]) => mockGenerateContent(...a) };
    },
}));

function textResult(value: unknown) {
    return { content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] };
}

function stubInvestigationHandlers() {
    mockTicketsGetHandler.mockResolvedValue(textResult({
        ticket: {
            ticket_id: 'TASK-PC-BE-003',
            title: 'Context Hash Engine',
            description: 'Build hash engine',
            type: 'backend',
            priority: 'critical',
            acceptance_criteria: ['AC1'],
            history: [],
        },
    }));
    mockTicketsPayloadHandler.mockResolvedValue(textResult({ file_scope: ['src/services/context-hash.ts'], memory_entries: [] }));
    mockMemorySearchLessonsHandler.mockResolvedValue(textResult({ lessons: [] }));
    mockCodeBlastRadiusHandler.mockResolvedValue(textResult({ total_affected: 1, affected_files: [] }));
    mockCodeSearchSymbolsHandler.mockResolvedValue(textResult({ total: 0, symbols: [] }));
}

describe('context-hash service', () => {
    it('produces identical hash across 100 repeated runs for identical inputs', () => {
        const inputs = {
            repoCommit: 'abc123',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'prompt-architect-v1',
        };

        const baseline = computeContextHash(inputs);
        for (let run = 0; run < 100; run += 1) {
            expect(computeContextHash(inputs)).toBe(baseline);
        }
    });

    it('changes hash when any single canonical input mutates', () => {
        const base = {
            repoCommit: 'abc123',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'prompt-architect-v1',
        };

        const baseline = computeContextHash(base);

        expect(computeContextHash({ ...base, repoCommit: 'abc124' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, graphVersion: 'g2' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, memorySnapshot: 'm2' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, packetSchema: 'v2' })).not.toBe(baseline);
        expect(computeContextHash({ ...base, templateVersion: 'prompt-architect-v2' })).not.toBe(baseline);
    });

    it('serializes unordered objects deterministically using canonical key ordering', () => {
        const left = {
            b: { y: 2, x: 1 },
            a: [
                { z: 3, y: 2 },
                { b: true, a: false },
            ],
        };

        const right = {
            a: [
                { y: 2, z: 3 },
                { a: false, b: true },
            ],
            b: { x: 1, y: 2 },
        };

        expect(canonicalSerialize(left)).toBe(canonicalSerialize(right));
    });

    it('evaluates freshness and cache invalidation decisions correctly', () => {
        const currentHash = computeContextHash({
            repoCommit: 'abc123',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'prompt-architect-v1',
        });

        expect(
            evaluatePromptFreshness({
                compiledPrompt: 'compiled',
                storedContextHash: currentHash,
                currentContextHash: currentHash,
            }),
        ).toEqual({
            freshnessStatus: 'fresh',
            staleReason: null,
            shouldInvalidateCache: false,
        });

        expect(
            evaluatePromptFreshness({
                compiledPrompt: 'compiled',
                storedContextHash: 'different-hash',
                currentContextHash: currentHash,
            }),
        ).toEqual({
            freshnessStatus: 'stale',
            staleReason: 'hash_mismatch',
            shouldInvalidateCache: true,
        });

        expect(
            evaluatePromptFreshness({
                compiledPrompt: null,
                storedContextHash: null,
                currentContextHash: currentHash,
            }),
        ).toEqual({
            freshnessStatus: 'missing',
            staleReason: 'not_compiled',
            shouldInvalidateCache: true,
        });
    });

    it('builds canonical inputs from environment tokens with sanitization', () => {
        const inputs = buildContextHashInputsFromEnv(
            {
                FORGEOS_REPO_COMMIT: 'repo|sha\n1',
                FORGEOS_GRAPH_VERSION: 'graph\tversion',
                FORGEOS_MEMORY_SNAPSHOT_VERSION: 'memory\rversion',
            },
            'v1',
            'prompt-template-v1',
        );

        expect(inputs).toEqual({
            repoCommit: 'repo_sha_1',
            graphVersion: 'graph_version',
            memorySnapshot: 'memory_version',
            packetSchema: 'v1',
            templateVersion: 'prompt-template-v1',
        });
    });

    it('falls back to GIT_COMMIT_SHA when FORGEOS_REPO_COMMIT is absent', () => {
        const inputs = buildContextHashInputsFromEnv(
            { GIT_COMMIT_SHA: 'git-sha-abc', FORGEOS_GRAPH_VERSION: 'gv1', FORGEOS_MEMORY_SNAPSHOT_VERSION: 'mv1' },
            'v1',
            'tmpl-v1',
        );
        expect(inputs.repoCommit).toBe('git-sha-abc');
    });

    it('returns missing status when compiled prompt exists but stored hash is empty', () => {
        const currentHash = computeContextHash({
            repoCommit: 'r1',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'tv1',
        });

        expect(
            evaluatePromptFreshness({
                compiledPrompt: 'some compiled prompt',
                storedContextHash: '',
                currentContextHash: currentHash,
            }),
        ).toEqual({
            freshnessStatus: 'missing',
            staleReason: 'not_compiled',
            shouldInvalidateCache: true,
        });
    });
});

// ---------------------------------------------------------------------------
// Freshness gate integration: compileIfStale and invalidatePromptCache
// These tests verify the compiler-level skip/recompile/invalidation behavior.
// ---------------------------------------------------------------------------

describe('compiler freshness gate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.resetModules();
        process.env.FORGEOS_REPO_COMMIT = 'abc123';
        process.env.FORGEOS_GRAPH_VERSION = 'g1';
        process.env.FORGEOS_MEMORY_SNAPSHOT_VERSION = 'm1';
        delete process.env.GEMINI_API_KEY;
    });

    it('skips recompilation when stored hash matches current hash', async () => {
        // Compute the hash that would be generated by the compiler right now
        const currentHash = computeContextHash({
            repoCommit: 'abc123',
            graphVersion: 'g1',
            memorySnapshot: 'm1',
            packetSchema: 'v1',
            templateVersion: 'prompt-architect-v1',
        });

        // DB returns a stored prompt with a matching hash
        mockPoolQuery.mockResolvedValueOnce({
            rows: [{ compiled_prompt: 'cached prompt text', compiled_prompt_context_hash: currentHash }],
        });

        const { compileIfStale } = await import('../services/compiler.js');
        const result = await compileIfStale('TASK-PC-BE-003');

        // Should return the cached prompt without calling UPDATE (no second pool.query)
        expect(result.prompt).toBe('cached prompt text');
        expect(result.freshnessStatus).toBe('fresh');
        expect(result.provider).toBe('cached');
        // Only the SELECT query should have been called, not an UPDATE
        expect(mockPoolQuery).toHaveBeenCalledTimes(1);
        expect((mockPoolQuery.mock.calls[0] as [string])[0]).toContain('SELECT');
    });

    it('recompiles when stored hash does not match current hash', async () => {
        process.env.GEMINI_API_KEY = 'test-key';
        mockGenerateContent.mockResolvedValue({ text: 'freshly compiled prompt' });
        stubInvestigationHandlers();

        // DB returns a stored prompt with a stale hash
        mockPoolQuery
            .mockResolvedValueOnce({
                rows: [{ compiled_prompt: 'old prompt', compiled_prompt_context_hash: 'stale-hash-value' }],
            })
            .mockResolvedValue({ rowCount: 1 }); // UPDATE call from compileAndStoreTicketPrompt

        const { compileIfStale } = await import('../services/compiler.js');
        const result = await compileIfStale('TASK-PC-BE-003');

        expect(result.prompt).toBe('freshly compiled prompt');
        expect(result.freshnessStatus).toBe('fresh'); // freshly stored result
        expect(result.provider).toBe('gemini');
        // SELECT + UPDATE should have been called
        expect(mockPoolQuery).toHaveBeenCalledTimes(2);
        expect((mockPoolQuery.mock.calls[0] as [string])[0]).toContain('SELECT');
        expect((mockPoolQuery.mock.calls[1] as [string])[0]).toContain('UPDATE');
    });

    it('recompiles when no compiled prompt exists (missing case)', async () => {
        process.env.GEMINI_API_KEY = 'test-key';
        mockGenerateContent.mockResolvedValue({ text: 'first time compiled' });
        stubInvestigationHandlers();

        // DB returns null for both hash and prompt
        mockPoolQuery
            .mockResolvedValueOnce({ rows: [{ compiled_prompt: null, compiled_prompt_context_hash: null }] })
            .mockResolvedValue({ rowCount: 1 });

        const { compileIfStale } = await import('../services/compiler.js');
        const result = await compileIfStale('TASK-PC-BE-003');

        expect(result.prompt).toBe('first time compiled');
        expect(result.provider).toBe('gemini');
        expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });

    it('explicit invalidation clears stored hash and forces recompile on next call', async () => {
        process.env.GEMINI_API_KEY = 'test-key';
        mockGenerateContent.mockResolvedValue({ text: 'recompiled after invalidation' });
        stubInvestigationHandlers();

        // invalidatePromptCache should issue an UPDATE
        mockPoolQuery.mockResolvedValueOnce({ rowCount: 1 });

        const { invalidatePromptCache } = await import('../services/compiler.js');
        await invalidatePromptCache('TASK-PC-BE-003');

        // Verify the UPDATE cleared the hash
        expect(mockPoolQuery).toHaveBeenCalledTimes(1);
        const [sql, params] = mockPoolQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('compiled_prompt_context_hash = NULL');
        expect(params[0]).toBe('TASK-PC-BE-003');

        vi.clearAllMocks();

        // Now simulate next compileIfStale: stored hash is NULL (cleared), triggers recompile
        mockPoolQuery
            .mockResolvedValueOnce({ rows: [{ compiled_prompt: null, compiled_prompt_context_hash: null }] })
            .mockResolvedValue({ rowCount: 1 });

        const { compileIfStale } = await import('../services/compiler.js');
        const result = await compileIfStale('TASK-PC-BE-003');

        expect(result.prompt).toBe('recompiled after invalidation');
        expect(result.provider).toBe('gemini');
        // SELECT + UPDATE for recompile
        expect(mockPoolQuery).toHaveBeenCalledTimes(2);
    });
});
