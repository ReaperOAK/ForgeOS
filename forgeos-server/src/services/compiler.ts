/**
 * Ticket Prompt Compiler (JIT) — precomputes high-quality execution directives.
 *
 * Primary model: Gemini Flash (when GEMINI_API_KEY is configured).
 * Fallback: local-first PromptArchitectService (Ollama/OpenAI as configured).
 *
 * The compiler gathers context via existing internal MCP handlers so compiled
 * prompts stay consistent with server-authoritative ticket/memory/code data.
 */

import { GoogleGenAI } from '@google/genai';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import { ticketsGetHandler } from '../tools/tickets-get.js';
import { ticketsPayloadHandler } from '../tools/tickets-payload.js';
import { memorySearchLessonsHandler } from '../tools/memory-search-lessons.js';
import { codeBlastRadiusHandler } from '../tools/code-blast-radius.js';
import { codeSearchSymbolsHandler } from '../tools/code-search-symbols.js';
import {
    buildContextHashInputsFromEnv,
    computeContextHash,
    evaluatePromptFreshness,
} from './context-hash.js';
import {
    validatePacketSections,
    PacketValidationError,
} from './packet-validator.js';
import {
    PromptArchitectService,
    type PromptGenerationContext,
    type PromptHistoryEntry,
    type PromptContextFile,
} from './prompt-architect-service.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export interface CompiledPromptResult {
    prompt: string;
    provider: 'gemini' | 'ollama' | 'openai' | 'cached';
    model: string;
    usedFallback: boolean;
    packetEnvelope: InstructionPacketEnvelope;
    compiledAt: string;
    contextHash: string;
    packetSchemaVersion: number;
    packetVersion: string;
    templateVersion: string;
    freshnessStatus: 'fresh' | 'stale' | 'missing';
    staleReason: string | null;
    canonicalContext: {
        repoCommit: string;
        graphVersion: string;
        memorySnapshot: string;
    };
}

interface TicketShape {
    ticket_id: string;
    title: string;
    description: string | null;
    type: string;
    priority: string;
    stage: string;
    status: string;
    acceptance_criteria: string[];
    file_paths: string[];
    history?: unknown[];
}

interface PayloadShape {
    file_scope?: string[];
    memory_entries?: unknown[];
}

const PROMPT_ARCHITECT_SYSTEM = `
You are the ForgeOS Prompt Architect. You do NOT solve tickets.
You synthesize the definitive execution prompt for the downstream executor.

Output markdown in this exact section order:
**ROLE**
**TICKET**
**SYSTEM CONSTRAINTS**
**HISTORY**
**LEARNINGS**
**BEST PRACTICES**
**CONTEXT LOCATIONS**
**YOUR EXACT TASK**
**EXECUTION PLAN**
**EDGE CASES**
**POST-COMPLETION**

Rules:
- Be specific and operational.
- Use exact file paths when available.
- If context is missing, write: NOT FOUND — agent must investigate
- Do not include any commentary before or after the final prompt.
- Every section must appear in the order listed above.
`;

const PACKET_SCHEMA_VERSION = 1;
const PACKET_VERSION = 'v1';
const TEMPLATE_VERSION = 'prompt-architect-v1';

interface PromptPacketMetadata {
    compiledAt: string;
    contextHash: string;
    packetSchemaVersion: number;
    packetVersion: string;
    templateVersion: string;
    freshnessStatus: 'fresh' | 'stale' | 'missing';
    staleReason: string | null;
    canonicalContext: {
        repoCommit: string;
        graphVersion: string;
        memorySnapshot: string;
    };
}

export interface InstructionPacketEnvelope {
    envelopeVersion: 'v1';
    packetVersion: string;
    packetSchemaVersion: number;
    templateVersion: string;
    compiledAt: string;
    contextHash: string;
    canonicalContext: {
        repoCommit: string;
        graphVersion: string;
        memorySnapshot: string;
    };
    compiledPrompt: string;
}

interface QueuedCompileJob {
    ticketId: string;
    trigger: string;
    idempotencyKey: string;
}

interface QueueCompileOptions {
    idempotencyKey?: string;
}

const compileQueue = new Map<string, QueuedCompileJob>();
let compileWorkerRunning = false;
let compileWorkerScheduled = false;

/**
 * Compile a ticket prompt using Gemini when available, otherwise fallback.
 */
export async function compileTicketPrompt(ticketId: string): Promise<CompiledPromptResult> {
    logger.info({ ticketId }, 'compiler: compiling ticket prompt');

    const investigation = await gatherInvestigation(ticketId);
    const packetMetadata = createPacketMetadata();

    const geminiResult = await tryGenerateGeminiPrompt(ticketId, investigation);
    if (geminiResult !== null) {
        validateCompiledPromptOrThrow(geminiResult.prompt);
        const packetEnvelope = createInstructionPacketEnvelope(geminiResult.prompt, packetMetadata);
        return {
            prompt: geminiResult.prompt,
            provider: 'gemini',
            model: geminiResult.model,
            usedFallback: false,
            packetEnvelope,
            ...packetMetadata,
        };
    }

    const fallbackService = new PromptArchitectService();
    const fallbackContext = mapInvestigationToFallbackContext(investigation);
    const fallback = await fallbackService.generatePrompt(fallbackContext);
    const fallbackValidation = validatePacketSections(fallback.prompt);
    if (!fallbackValidation.valid) {
        throw new PacketValidationError(fallbackValidation);
    }
    const packetEnvelope = createInstructionPacketEnvelope(fallback.prompt, packetMetadata);

    return {
        prompt: fallback.prompt,
        provider: fallback.provider,
        model: fallback.model,
        usedFallback: true,
        packetEnvelope,
        ...packetMetadata,
    };
}

async function tryGenerateGeminiPrompt(
    ticketId: string,
    investigation: Record<string, unknown>,
): Promise<{ prompt: string; model: string } | null> {
    const geminiApiKey = process.env.GEMINI_API_KEY;
    const geminiModel = process.env.GEMINI_MODEL ?? 'gemini-1.5-flash';
    if (!geminiApiKey) {
        return null;
    }

    try {
        const ai = new GoogleGenAI({ apiKey: geminiApiKey });
        const prompt = (await generateWithGemini(ai, geminiModel, investigation)).trim();
        return prompt.length > 0 ? { prompt, model: geminiModel } : null;
    } catch (err) {
        logger.warn(
            {
                ticketId,
                error: err instanceof Error ? err.message : String(err),
                model: geminiModel,
            },
            'compiler: gemini generation failed, falling back',
        );
        return null;
    }
}

function validateCompiledPromptOrThrow(prompt: string): void {
    const validation = validatePacketSections(prompt);
    if (!validation.valid) {
        throw new PacketValidationError(validation);
    }
}

/**
 * Precompute and persist compiled prompt onto ticket row.
 */
export async function compileAndStoreTicketPrompt(ticketId: string): Promise<CompiledPromptResult> {
    try {
        const compiled = await compileTicketPrompt(ticketId);
        await persistCompiledPromptAtomic(ticketId, compiled);
        return compiled;
    } catch (err) {
        await maybeRecordPacketValidationError(ticketId, err);
        throw err;
    }
}

async function maybeRecordPacketValidationError(ticketId: string, err: unknown): Promise<void> {
    if (!(err instanceof PacketValidationError)) {
        return;
    }

    await recordCompileError(ticketId, err.toPublicMessage());
}

async function persistCompiledPromptAtomic(ticketId: string, compiled: CompiledPromptResult): Promise<void> {
    await pool.query(
        `UPDATE tickets
     SET compiled_prompt = $1,
         compiled_prompt_generated_at = $2::timestamptz,
         compiled_prompt_provider = $3,
         compiled_prompt_model = $4,
         compiled_prompt_compiled_at = $2::timestamptz,
         compiled_prompt_context_hash = $5,
         compiled_prompt_packet_schema_version = $6,
         compiled_prompt_packet_version = $7,
         compiled_prompt_template_version = $8,
         compiled_prompt_freshness_status = $9,
         compiled_prompt_stale_reason = $10,
         compiled_prompt_freshness_checked_at = $2::timestamptz,
         compiled_prompt_context_repo_commit = $11,
         compiled_prompt_context_graph_version = $12,
         compiled_prompt_context_memory_snapshot = $13,
         last_error = NULL,
         metadata = COALESCE(metadata, '{}'::jsonb) || $14::jsonb
     WHERE ticket_id = $15`,
        [
            compiled.prompt,
            compiled.compiledAt,
            compiled.provider,
            compiled.model,
            compiled.contextHash,
            compiled.packetSchemaVersion,
            compiled.packetVersion,
            compiled.templateVersion,
            compiled.freshnessStatus,
            compiled.staleReason,
            compiled.canonicalContext.repoCommit,
            compiled.canonicalContext.graphVersion,
            compiled.canonicalContext.memorySnapshot,
            JSON.stringify({
                compiled_prompt: {
                    generated_at: compiled.compiledAt,
                    provider: compiled.provider,
                    model: compiled.model,
                    used_fallback: compiled.usedFallback,
                    compiled_at: compiled.compiledAt,
                    context_hash: compiled.contextHash,
                    packet_schema_version: compiled.packetSchemaVersion,
                    packet_version: compiled.packetVersion,
                    template_version: compiled.templateVersion,
                    freshness_status: compiled.freshnessStatus,
                    stale_reason: compiled.staleReason,
                    canonical_context: {
                        repo_commit: compiled.canonicalContext.repoCommit,
                        graph_version: compiled.canonicalContext.graphVersion,
                        memory_snapshot: compiled.canonicalContext.memorySnapshot,
                    },
                    packet_envelope: compiled.packetEnvelope,
                },
            }),
            ticketId,
        ],
    );
}

async function recordCompileError(ticketId: string, message: string): Promise<void> {
    await pool.query(
        `UPDATE tickets
         SET last_error = $1
         WHERE ticket_id = $2`,
        [message, ticketId],
    );
}

function createInstructionPacketEnvelope(
    compiledPrompt: string,
    metadata: PromptPacketMetadata,
): InstructionPacketEnvelope {
    return {
        envelopeVersion: 'v1',
        packetVersion: metadata.packetVersion,
        packetSchemaVersion: metadata.packetSchemaVersion,
        templateVersion: metadata.templateVersion,
        compiledAt: metadata.compiledAt,
        contextHash: metadata.contextHash,
        canonicalContext: metadata.canonicalContext,
        compiledPrompt,
    };
}

/**
 * Fire-and-forget helper to precompute prompt in background.
 *
 * Idempotency foundation: duplicate enqueue calls with the same key collapse
 * into one queued compile job.
 */
export function queueCompileTicketPrompt(ticketId: string, trigger: string, options?: QueueCompileOptions): void {
    const idempotencyKey = options?.idempotencyKey ?? `${ticketId}:${trigger}`;
    if (compileQueue.has(idempotencyKey)) {
        logger.info(
            {
                ticketId,
                trigger,
                idempotencyKey,
            },
            'compiler: compile job already queued (idempotent replay)',
        );
        return;
    }

    compileQueue.set(idempotencyKey, {
        ticketId,
        trigger,
        idempotencyKey,
    });
    scheduleCompileWorker();
}

async function runCompileWorker(): Promise<void> {
    if (compileWorkerRunning) {
        return;
    }

    compileWorkerRunning = true;
    try {
        await processCompileQueue();
    } finally {
        compileWorkerRunning = false;
        scheduleWorkerIfQueuePending();
    }
}

function dequeueCompileJob(): QueuedCompileJob | null {
    const next = compileQueue.entries().next().value as [string, QueuedCompileJob] | undefined;
    if (!next) {
        return null;
    }

    const [queueKey, job] = next;
    compileQueue.delete(queueKey);
    return job;
}

async function processCompileQueue(): Promise<void> {
    for (let job = dequeueCompileJob(); job !== null; job = dequeueCompileJob()) {
        await processCompileJob(job);
    }
}

async function processCompileJob(job: QueuedCompileJob): Promise<void> {
    try {
        const result = await compileAndStoreTicketPrompt(job.ticketId);
        logger.info(
            {
                ticketId: job.ticketId,
                trigger: job.trigger,
                idempotencyKey: job.idempotencyKey,
                provider: result.provider,
                model: result.model,
                usedFallback: result.usedFallback,
                contextHash: result.contextHash,
                freshnessStatus: result.freshnessStatus,
            },
            'compiler: compiled prompt stored',
        );
    } catch (err) {
        logger.error(
            {
                ticketId: job.ticketId,
                trigger: job.trigger,
                idempotencyKey: job.idempotencyKey,
                error: err instanceof Error ? err.message : String(err),
            },
            'compiler: failed to compile/store prompt',
        );
    }
}

function scheduleWorkerIfQueuePending(): void {
    if (compileQueue.size > 0) {
        scheduleCompileWorker();
    }
}

function scheduleCompileWorker(): void {
    if (compileWorkerScheduled) {
        return;
    }

    compileWorkerScheduled = true;
    queueMicrotask(() => {
        compileWorkerScheduled = false;
        void runCompileWorker();
    });
}

/**
 * Test helper: wait until in-process compile queue is empty and worker is idle.
 */
export async function waitForCompileQueueToDrain(maxPasses = 20): Promise<void> {
    for (let pass = 0; pass < maxPasses && isCompileWorkerBusy(); pass += 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
}

function isCompileWorkerBusy(): boolean {
    return compileWorkerRunning || compileWorkerScheduled || compileQueue.size > 0;
}

interface StoredPromptSnapshot {
    compiledPrompt: string | null;
    contextHash: string | null;
}

/**
 * Read the stored compiled_prompt and context_hash from the ticket row.
 * Used by the freshness gate to decide whether a recompile is needed.
 */
async function loadStoredPromptSnapshot(ticketId: string): Promise<StoredPromptSnapshot> {
    const result = await pool.query<{
        compiled_prompt: string | null;
        compiled_prompt_context_hash: string | null;
    }>(
        'SELECT compiled_prompt, compiled_prompt_context_hash FROM tickets WHERE ticket_id = $1',
        [ticketId],
    );

    const row = result.rows[0];
    if (!row) {
        return { compiledPrompt: null, contextHash: null };
    }

    return {
        compiledPrompt: row.compiled_prompt ?? null,
        contextHash: row.compiled_prompt_context_hash ?? null,
    };
}

/**
 * Compiles a ticket prompt only when freshness checks mark the cache stale.
 *
 * This function computes the current deterministic context hash, compares it
 * with the hash stored on the ticket row, and decides whether to reuse the
 * cached prompt or run a full compile-and-store cycle.
 *
 * @param ticketId - Ticket identifier whose compiled prompt cache is checked.
 * @returns A `CompiledPromptResult` from cache (`provider: 'cached'`) when the
 * stored hash matches, or a newly compiled/stored result when the cache is
 * missing or stale.
 */
export async function compileIfStale(ticketId: string): Promise<CompiledPromptResult> {
    const hashInputs = buildContextHashInputsFromEnv(process.env, PACKET_VERSION, TEMPLATE_VERSION);
    const currentHash = computeContextHash(hashInputs);

    const { compiledPrompt: storedPrompt, contextHash: storedHash } = await loadStoredPromptSnapshot(ticketId);

    const freshness = evaluatePromptFreshness({
        compiledPrompt: storedPrompt,
        storedContextHash: storedHash,
        currentContextHash: currentHash,
    });

    if (!freshness.shouldInvalidateCache) {
        logger.info(
            { ticketId, contextHash: currentHash },
            'compiler: freshness gate: skipping recompile (hash unchanged)',
        );

        const now = new Date().toISOString();
        const canonicalContext = {
            repoCommit: hashInputs.repoCommit,
            graphVersion: hashInputs.graphVersion,
            memorySnapshot: hashInputs.memorySnapshot,
        };
        const cachedMetadata: PromptPacketMetadata = {
            compiledAt: now,
            contextHash: currentHash,
            packetSchemaVersion: PACKET_SCHEMA_VERSION,
            packetVersion: PACKET_VERSION,
            templateVersion: TEMPLATE_VERSION,
            freshnessStatus: 'fresh',
            staleReason: null,
            canonicalContext,
        };

        return {
            prompt: storedPrompt!,
            provider: 'cached',
            model: 'cached',
            usedFallback: false,
            packetEnvelope: createInstructionPacketEnvelope(storedPrompt!, cachedMetadata),
            ...cachedMetadata,
        };
    }

    logger.info(
        { ticketId, freshnessStatus: freshness.freshnessStatus, staleReason: freshness.staleReason },
        'compiler: freshness gate: recompiling',
    );

    return compileAndStoreTicketPrompt(ticketId);
}

/**
 * Invalidates compiled prompt freshness metadata for a ticket.
 *
 * This clears the stored context hash and marks freshness as `missing`, so the
 * next `compileIfStale` call must recompile and persist a fresh packet.
 *
 * @param ticketId - Ticket identifier whose compiled prompt cache is invalidated.
 * @returns Resolves when invalidation metadata has been persisted.
 */
export async function invalidatePromptCache(ticketId: string): Promise<void> {
    logger.info({ ticketId }, 'compiler: invalidating prompt cache');
    await pool.query(
        `UPDATE tickets
         SET compiled_prompt_context_hash = NULL,
             compiled_prompt_freshness_status = 'missing',
             compiled_prompt_stale_reason = 'not_compiled',
             compiled_prompt_freshness_checked_at = NOW()
         WHERE ticket_id = $1`,
        [ticketId],
    );
}

async function generateWithGemini(
    ai: GoogleGenAI,
    model: string,
    investigation: Record<string, unknown>,
): Promise<string> {
    const userPrompt = `Compile an execution prompt for ticket ${String(investigation.ticket_id ?? 'UNKNOWN')} using this context JSON:\n${JSON.stringify(investigation, null, 2)}`;

    const response = await (ai as unknown as {
        models: {
            generateContent: (input: Record<string, unknown>) => Promise<Record<string, unknown>>;
        };
    }).models.generateContent({
        model,
        config: {
            systemInstruction: PROMPT_ARCHITECT_SYSTEM,
            temperature: 0.1,
        },
        contents: [
            {
                role: 'user',
                parts: [{ text: userPrompt }],
            },
        ],
    });

    const text = extractGeminiText(response);
    return text;
}

function extractGeminiText(response: Record<string, unknown>): string {
    const directText = response.text;
    if (typeof directText === 'string') return directText;

    const candidateParts = getFirstCandidateParts(response);
    if (!Array.isArray(candidateParts)) return '';

    const text = candidateParts
        .map((part) => (part && typeof part === 'object' ? (part as Record<string, unknown>).text : undefined))
        .filter((value): value is string => typeof value === 'string')
        .join('\n');

    return text.trim().length > 0 ? text : '';
}

function getFirstCandidateParts(response: Record<string, unknown>): unknown[] | null {
    const candidates = response.candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) {
        return null;
    }
    const first = candidates[0] as Record<string, unknown>;
    const content = first.content as Record<string, unknown> | undefined;
    const parts = content?.parts;
    return Array.isArray(parts) ? parts : null;
}

function createPacketMetadata(now: Date = new Date()): PromptPacketMetadata {
    const hashInputs = buildContextHashInputsFromEnv(process.env, PACKET_VERSION, TEMPLATE_VERSION);

    return {
        compiledAt: now.toISOString(),
        contextHash: computeContextHash(hashInputs),
        packetSchemaVersion: PACKET_SCHEMA_VERSION,
        packetVersion: PACKET_VERSION,
        templateVersion: TEMPLATE_VERSION,
        freshnessStatus: 'fresh',
        staleReason: null,
        canonicalContext: {
            repoCommit: hashInputs.repoCommit,
            graphVersion: hashInputs.graphVersion,
            memorySnapshot: hashInputs.memorySnapshot,
        },
    };
}

async function gatherInvestigation(ticketId: string): Promise<Record<string, unknown>> {
    const [ticketRes, payloadRes] = await Promise.all([
        ticketsGetHandler({ ticket_id: ticketId }),
        ticketsPayloadHandler({ ticket_id: ticketId, agent_role: 'PromptArchitect' }),
    ]);

    const ticketJson = parseToolText(ticketRes);
    const payloadJson = parseToolText(payloadRes);

    const ticket = (ticketJson.ticket ?? {}) as TicketShape;
    const payload = payloadJson as PayloadShape;
    const lessonQuery = buildLessonQuery(ticket, ticketId);

    const lessonsRes = await memorySearchLessonsHandler({
        query: lessonQuery,
        category: undefined,
        limit: 5,
        threshold: 0.55,
    });
    const instructionRes = await memorySearchLessonsHandler({
        query: lessonQuery,
        category: 'instruction',
        limit: 5,
        threshold: 0.5,
    });
    const lessonsJson = parseToolText(lessonsRes);
    const instructionJson = parseToolText(instructionRes);

    const contextFiles = getContextFiles(payload.file_scope);
    const blastSummaries = await gatherBlastSummaries(contextFiles);
    const symbolHints = await gatherSymbolHints(ticket.title, ticket.description ?? '');

    return {
        ticket_id: ticket.ticket_id ?? ticketId,
        ticket,
        payload_context: {
            file_scope: payload.file_scope ?? [],
            memory_entries_count: Array.isArray(payload.memory_entries) ? payload.memory_entries.length : 0,
        },
        lessons: [
            ...(Array.isArray(lessonsJson.lessons) ? lessonsJson.lessons : []),
            ...(Array.isArray(instructionJson.lessons) ? instructionJson.lessons : []),
        ],
        blast_radius: blastSummaries,
        symbol_hints: symbolHints,
    };
}

function buildLessonQuery(ticket: TicketShape, ticketId: string): string {
    const candidate = [
        ticket.title,
        ticket.description ?? '',
        ...(ticket.acceptance_criteria ?? []),
    ].join(' ').trim();
    return candidate.length > 0 ? candidate : ticketId;
}

function getContextFiles(fileScope: unknown): string[] {
    if (!Array.isArray(fileScope)) {
        return [];
    }
    return fileScope.filter((entry): entry is string => typeof entry === 'string').slice(0, 5);
}

async function gatherBlastSummaries(contextFiles: string[]): Promise<Array<Record<string, unknown>>> {
    const selectedPaths = contextFiles.slice(0, 2);
    const results = await Promise.all(
        selectedPaths.map(async (path) => {
            const blastRes = await codeBlastRadiusHandler({ file_path: path, max_depth: 3 });
            const blastJson = parseToolText(blastRes);
            return {
                file_path: path,
                total_affected: blastJson.total_affected ?? 0,
                affected_files: blastJson.affected_files ?? [],
            };
        }),
    );
    return results;
}

async function gatherSymbolHints(title: string, description: string): Promise<Array<Record<string, unknown>>> {
    const terms = extractSymbolTerms(title, description).slice(0, 3);
    const results = await Promise.all(
        terms.map(async (term) => {
            const symbolRes = await codeSearchSymbolsHandler({ name_pattern: `%${term}%` });
            const symbolJson = parseToolText(symbolRes);
            return {
                term,
                total: symbolJson.total ?? 0,
                symbols: Array.isArray(symbolJson.symbols) ? symbolJson.symbols.slice(0, 5) : [],
            };
        }),
    );
    return results;
}

function parseToolText(result: CallToolResult): Record<string, any> {
    const first = result.content[0];
    if (!first || first.type !== 'text') {
        return {};
    }
    return safeJsonObject(first.text);
}

function safeJsonObject(value: string): Record<string, any> {
    try {
        return JSON.parse(value) as Record<string, any>;
    } catch {
        return {};
    }
}

function extractSymbolTerms(title: string, description: string): string[] {
    const text = `${title} ${description}`.trim();
    const tokens = text
        .replace(/[^a-zA-Z0-9_\-\s]/g, ' ')
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 4);

    return tokens.filter((token, index, arr) => arr.indexOf(token) === index);
}

function mapInvestigationToFallbackContext(investigation: Record<string, unknown>): PromptGenerationContext {
    const ticketObj = (investigation.ticket ?? {}) as Record<string, unknown>;
    const payload = (investigation.payload_context ?? {}) as Record<string, unknown>;
    const fileScope = normalizeStringArray(payload.file_scope);
    const history = parseHistory(ticketObj.history);
    const contextFiles = mapContextFiles(fileScope);
    const lessons = mapLessons(investigation.lessons);
    const ticket = mapTicketSummary(ticketObj);
    const exactTask = typeof ticketObj.description === 'string'
        ? ticketObj.description
        : 'NOT FOUND — agent must investigate';

    return {
        ticket,
        history,
        learnings: lessons,
        bestPractices: [
            'Respect SDLC stage ownership and evidence requirements.',
            'Keep edits within ticket file scope and avoid cross-ticket changes.',
        ],
        contextFiles,
        exactTask,
        executionSteps: [
            'Read context files and acceptance criteria first.',
            'Implement surgically within scoped files.',
            'Run validation checks before completion.',
        ],
        edgeCases: ['Missing historical context or lessons in memory.'],
        nextStage: 'NOT FOUND — agent must investigate',
        validationChecks: ['Run tests', 'Run lint', 'Run type checks'],
    };
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
}

function mapContextFiles(fileScope: string[]): PromptContextFile[] {
    if (fileScope.length === 0) {
        return [{ path: 'NOT FOUND — agent must investigate', reason: 'No file scope returned.' }];
    }
    return fileScope.map((path) => ({ path, reason: 'Derived from tickets.payload file_scope.' }));
}

function mapLessons(lessonsRaw: unknown): string[] {
    if (!Array.isArray(lessonsRaw)) {
        return [];
    }

    return lessonsRaw
        .map((lesson) => {
            if (!lesson || typeof lesson !== 'object') {
                return null;
            }
            const row = lesson as Record<string, unknown>;
            const category = typeof row.category === 'string' ? row.category : 'lesson';
            const text = typeof row.lesson_text === 'string' ? row.lesson_text : null;
            return text ? `${category}: ${text}` : null;
        })
        .filter((value): value is string => value !== null);
}

function mapTicketSummary(ticketObj: Record<string, unknown>): PromptGenerationContext['ticket'] {
    return {
        ticket_id: typeof ticketObj.ticket_id === 'string' ? ticketObj.ticket_id : 'UNKNOWN',
        title: typeof ticketObj.title === 'string' ? ticketObj.title : 'NOT FOUND — agent must investigate',
        description: typeof ticketObj.description === 'string' ? ticketObj.description : null,
        type: typeof ticketObj.type === 'string' ? ticketObj.type : 'backend',
        priority: typeof ticketObj.priority === 'string' ? ticketObj.priority : 'medium',
        acceptance_criteria: normalizeStringArray(ticketObj.acceptance_criteria),
    };
}

function parseHistory(historyRaw: unknown): PromptHistoryEntry[] {
    if (!Array.isArray(historyRaw)) {
        return [];
    }

    return historyRaw
        .slice(0, 10)
        .filter(isRecord)
        .map((row) => ({
            agent: typeof row.agent_name === 'string' ? row.agent_name : 'Unknown agent',
            summary: `Observed ${typeof row.event_type === 'string' ? row.event_type : 'UNKNOWN'} event`,
            outcome: 'See event payload for details',
            files: [],
        }))
        .slice(-5);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === 'object';
}
