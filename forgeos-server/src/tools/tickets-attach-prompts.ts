/**
 * tickets.attach_prompts — Generate and attach execution prompts for READY tickets.
 *
 * Builds rich prompt context from ticket data + event history + lessons,
 * then stores the generated prompt under `metadata.agent_prompt`.
 *
 * Default LLM provider is local Ollama (free). If generation fails,
 * a deterministic fallback prompt is attached.
 *
 * @module tools/tickets-attach-prompts
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { Ticket } from '../types/index.js';
import {
    PromptArchitectService,
    type PromptGenerationContext,
    type PromptHistoryEntry,
    type PromptContextFile,
} from '../services/prompt-architect-service.js';
import { ticketsGetHandler } from './tickets-get.js';
import { ticketsPayloadHandler } from './tickets-payload.js';
import { memoryGetContextHandler, memoryGetContextSchema } from './memory-get-context.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 25;
const DEFAULT_CONTEXT_FILES = 5;

export const ticketsAttachPromptsSchema = z.object({
    ticket_id: z.string().min(1).optional().describe(
        'Optional single ticket ID. When omitted, all READY tickets up to limit are processed.',
    ),
    limit: z.number().int().min(1).max(MAX_LIMIT).optional().default(DEFAULT_LIMIT).describe(
        `Maximum READY tickets to process when ticket_id is not provided (1-${MAX_LIMIT}).`,
    ),
    force_regenerate: z.boolean().optional().default(false).describe(
        'If true, replace existing metadata.agent_prompt entries. If false, skip tickets with existing prompts.',
    ),
    max_context_files: z.number().int().min(3).max(10).optional().default(DEFAULT_CONTEXT_FILES).describe(
        'Maximum number of context files to include in prompt context.',
    ),
});

type TicketsAttachPromptsInput = z.infer<typeof ticketsAttachPromptsSchema>;

interface EventRow {
    event_type: string;
    agent_name: string | null;
    payload: Record<string, unknown> | null;
}

interface LessonRow {
    lesson_text: string;
    category: string;
}

interface AttachResultItem {
    ticket_id: string;
    status: 'attached' | 'skipped' | 'error';
    reason?: string;
    used_fallback?: boolean;
}

interface AttachResult {
    message: string;
    processed: number;
    attached: number;
    skipped: number;
    errors: number;
    results: AttachResultItem[];
}

interface McpContextBundle {
    history: PromptHistoryEntry[];
    fileScope: string[];
    lessons: string[];
}

export async function ticketsAttachPromptsHandler(
    input: TicketsAttachPromptsInput,
): Promise<CallToolResult> {
    const { ticket_id, limit, force_regenerate, max_context_files } = input;
    const promptService = new PromptArchitectService();

    logger.info({ ticket_id: ticket_id ?? null, limit, force_regenerate }, 'tickets.attach_prompts called');

    try {
        const tickets = await selectTargetTickets(ticket_id, limit);
        if (tickets.length === 0) {
            const empty: AttachResult = {
                message: 'No READY tickets found',
                processed: 0,
                attached: 0,
                skipped: 0,
                errors: 0,
                results: [],
            };
            return {
                content: [{ type: 'text', text: JSON.stringify(empty) }],
            };
        }

        const results: AttachResultItem[] = [];

        for (const ticket of tickets) {
            const existingPrompt = readExistingPrompt(ticket.metadata);
            if (existingPrompt !== null && !force_regenerate) {
                results.push({
                    ticket_id: ticket.ticket_id,
                    status: 'skipped',
                    reason: 'metadata.agent_prompt already exists (use force_regenerate=true to replace)',
                });
                continue;
            }

            try {
                const [history, lessons] = await Promise.all([
                    loadTicketHistory(ticket.ticket_id),
                    loadRelevantLessons(ticket.type, ticket.tags),
                ]);

                const mcpBundle = await loadContextViaMcpTools(ticket.ticket_id);
                const mergedHistory = mcpBundle.history.length > 0 ? mcpBundle.history : history;
                const mergedLessons = uniqueStrings([...lessons, ...mcpBundle.lessons]);

                const context = buildPromptContext(
                    ticket,
                    mergedHistory,
                    mergedLessons,
                    max_context_files,
                    mcpBundle.fileScope,
                );
                const generated = await promptService.generatePrompt(context);

                await attachPromptToTicket(ticket, generated.prompt, generated.provider, generated.model, generated.usedFallback);

                results.push({
                    ticket_id: ticket.ticket_id,
                    status: 'attached',
                    used_fallback: generated.usedFallback,
                });
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                logger.error({ ticket_id: ticket.ticket_id, err: message }, 'tickets.attach_prompts ticket processing failed');
                results.push({
                    ticket_id: ticket.ticket_id,
                    status: 'error',
                    reason: message,
                });
            }
        }

        const attached = results.filter((item) => item.status === 'attached').length;
        const skipped = results.filter((item) => item.status === 'skipped').length;
        const errors = results.filter((item) => item.status === 'error').length;

        const response: AttachResult = {
            message: 'OK',
            processed: results.length,
            attached,
            skipped,
            errors,
            results,
        };

        return {
            content: [{ type: 'text', text: JSON.stringify(response) }],
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err: message }, 'tickets.attach_prompts failed');
        return {
            content: [{
                type: 'text',
                text: JSON.stringify({
                    message: 'Failed to attach prompts',
                    error: message,
                    timestamp: new Date().toISOString(),
                }),
            }],
            isError: true,
        };
    }
}

async function selectTargetTickets(ticketId: string | undefined, limit: number): Promise<Ticket[]> {
    if (ticketId) {
        const result = await pool.query<Ticket>(
            `SELECT * FROM tickets
       WHERE ticket_id = $1
         AND stage = 'READY'::ticket_stage
       LIMIT 1`,
            [ticketId],
        );
        return result.rows;
    }

    const result = await pool.query<Ticket>(
        `SELECT * FROM tickets
     WHERE stage = 'READY'::ticket_stage
       AND status = 'READY'::ticket_status
       AND (claimed_by IS NULL OR lease_expiry < NOW())
     ORDER BY
       CASE priority
         WHEN 'critical' THEN 0
         WHEN 'high' THEN 1
         WHEN 'medium' THEN 2
         WHEN 'low' THEN 3
         ELSE 4
       END ASC,
       created_at ASC
     LIMIT $1`,
        [limit],
    );
    return result.rows;
}

function readExistingPrompt(metadata: Record<string, unknown>): string | null {
    const promptEntry = metadata.agent_prompt;
    if (!promptEntry || typeof promptEntry !== 'object') {
        return null;
    }
    const maybePrompt = (promptEntry as Record<string, unknown>).prompt;
    return typeof maybePrompt === 'string' && maybePrompt.trim().length > 0
        ? maybePrompt
        : null;
}

async function loadTicketHistory(ticketId: string): Promise<PromptHistoryEntry[]> {
    const result = await pool.query<EventRow>(
        `SELECT event_type, agent_name, payload
     FROM events
     WHERE ticket_id = $1
     ORDER BY created_at ASC
     LIMIT 40`,
        [ticketId],
    );

    const history: PromptHistoryEntry[] = [];

    for (const event of result.rows) {
        const eventType = event.event_type;
        if (!['CLAIMED', 'STAGE_ADVANCED', 'STAGE_REJECTED', 'UPDATED'].includes(eventType)) {
            continue;
        }

        const payload = event.payload ?? {};
        const files = extractArtifactPaths(payload);

        if (eventType === 'STAGE_REJECTED') {
            history.push({
                agent: event.agent_name ?? 'Unknown agent',
                summary: 'Review gate rejected the previous implementation',
                outcome: extractString(payload.reason) ?? 'Rejected',
                files,
            });
            continue;
        }

        if (eventType === 'STAGE_ADVANCED') {
            history.push({
                agent: event.agent_name ?? 'Unknown agent',
                summary: 'Completed a stage and provided evidence',
                outcome: extractString(((payload.evidence ?? {}) as Record<string, unknown>).notes) ?? 'Advanced to next stage',
                files,
            });
            continue;
        }

        if (eventType === 'UPDATED') {
            const action = extractString(payload.action) ?? 'updated metadata';
            history.push({
                agent: event.agent_name ?? 'Unknown agent',
                summary: `Updated ticket metadata (${action})`,
                outcome: 'Metadata updated',
                files,
            });
            continue;
        }

        history.push({
            agent: event.agent_name ?? 'Unknown agent',
            summary: 'Claimed the ticket for work',
            outcome: 'Work started',
            files,
        });
    }

    return history.slice(-5);
}

async function loadRelevantLessons(ticketType: string, tags: string[]): Promise<string[]> {
    try {
        const result = await pool.query<LessonRow>(
            `SELECT lesson_text, category
       FROM lessons
       WHERE category = $1
          OR category = 'general'
          OR category = ANY($2::text[])
       ORDER BY created_at DESC
       LIMIT 5`,
            [ticketType, tags],
        );

        const lines = result.rows.map((row) => `${row.category}: ${row.lesson_text}`);
        return lines;
    } catch {
        return [];
    }
}

function buildPromptContext(
    ticket: Ticket,
    history: PromptHistoryEntry[],
    lessons: string[],
    maxContextFiles: number,
    mcpFileScope: string[],
): PromptGenerationContext {
    const contextFiles = buildContextFiles(ticket, history, maxContextFiles, mcpFileScope);
    const bestPractices = buildBestPractices(ticket);
    const edgeCases = buildEdgeCases(history);

    const exactTask = ticket.description?.trim().length
        ? ticket.description
        : `Implement ${ticket.title} and satisfy all acceptance criteria.`;

    const validationChecks = validationChecksForType(ticket.type);

    return {
        ticket: {
            ticket_id: ticket.ticket_id,
            title: ticket.title,
            description: ticket.description,
            type: ticket.type,
            priority: ticket.priority,
            acceptance_criteria: ticket.acceptance_criteria,
        },
        history,
        learnings: lessons,
        bestPractices,
        contextFiles,
        exactTask,
        executionSteps: [
            'Read the context files and acceptance criteria first.',
            'Implement only within the ticket file scope and keep changes minimal but complete.',
            'Run relevant tests/lint/type checks before advancing the ticket.',
        ],
        edgeCases,
        nextStage: nextStageFromFlow(ticket.sdlc_flow, ticket.stage),
        validationChecks,
    };
}

function buildContextFiles(
    ticket: Ticket,
    history: PromptHistoryEntry[],
    maxContextFiles: number,
    mcpFileScope: string[],
): PromptContextFile[] {
    const result: PromptContextFile[] = [];
    const seen = new Set<string>();

    for (const path of mcpFileScope) {
        if (!seen.has(path)) {
            seen.add(path);
            result.push({
                path,
                reason: 'Derived from tickets.payload MCP context scope.',
            });
        }
        if (result.length >= maxContextFiles) {
            return result;
        }
    }

    for (const path of ticket.file_paths) {
        if (!seen.has(path)) {
            seen.add(path);
            result.push({
                path,
                reason: 'Ticket file scope; likely direct implementation target.',
            });
        }
        if (result.length >= maxContextFiles) {
            return result;
        }
    }

    for (const entry of history) {
        for (const path of entry.files) {
            if (!seen.has(path)) {
                seen.add(path);
                result.push({
                    path,
                    reason: 'Modified in previous attempts; review for regressions or partial work.',
                });
            }
            if (result.length >= maxContextFiles) {
                return result;
            }
        }
    }

    if (result.length === 0) {
        result.push({
            path: 'NOT FOUND — agent must investigate',
            reason: 'No scoped files were provided for this ticket.',
        });
    }

    return result;
}

function uniqueStrings(values: string[]): string[] {
    return values.filter((value, index, arr) => value.trim().length > 0 && arr.indexOf(value) === index);
}

async function loadContextViaMcpTools(ticketId: string): Promise<McpContextBundle> {
    const fallback: McpContextBundle = {
        history: [],
        fileScope: [],
        lessons: [],
    };

    try {
        const [getResult, payloadResult, memoryResult] = await Promise.all([
            ticketsGetHandler({ ticket_id: ticketId }),
            ticketsPayloadHandler({ ticket_id: ticketId, agent_role: 'PromptArchitect' }),
            memoryGetContextHandler(memoryGetContextSchema.parse({ ticket_id: ticketId, max_lessons: 5 })),
        ]);

        const getJson = readTextContent(getResult);
        const payloadJson = readTextContent(payloadResult);
        const memoryJson = readTextContent(memoryResult);

        const getParsed = safeParse(getJson);
        const payloadParsed = safeParse(payloadJson);
        const memoryParsed = safeParse(memoryJson);

        const history = parseHistoryFromMcp(getParsed.ticket?.history);
        const fileScope = Array.isArray(payloadParsed.file_scope)
            ? payloadParsed.file_scope.filter((item: unknown) => typeof item === 'string')
            : [];
        const lessons = Array.isArray(memoryParsed.relevant_lessons)
            ? memoryParsed.relevant_lessons
                .map((entry: unknown) => {
                    if (!entry || typeof entry !== 'object') return null;
                    const row = entry as Record<string, unknown>;
                    const text = extractString(row.lesson_text);
                    const category = extractString(row.category) ?? 'lesson';
                    return text ? `${category}: ${text}` : null;
                })
                .filter((value: string | null): value is string => value !== null)
            : [];

        return {
            history,
            fileScope,
            lessons,
        };
    } catch {
        return fallback;
    }
}

function parseHistoryFromMcp(rawHistory: unknown): PromptHistoryEntry[] {
    if (!Array.isArray(rawHistory)) {
        return [];
    }

    const output: PromptHistoryEntry[] = [];
    for (const rawEntry of rawHistory) {
        if (!rawEntry || typeof rawEntry !== 'object') {
            continue;
        }

        const entry = rawEntry as Record<string, unknown>;
        const eventType = extractString(entry.event_type) ?? 'UNKNOWN';
        const agent = extractString(entry.agent_name) ?? 'Unknown agent';
        const payload = entry.payload && typeof entry.payload === 'object'
            ? (entry.payload as Record<string, unknown>)
            : {};

        const files = extractArtifactPaths(payload);
        if (eventType === 'STAGE_REJECTED') {
            output.push({
                agent,
                summary: 'Review gate rejected the previous implementation',
                outcome: extractString(payload.reason) ?? 'Rejected',
                files,
            });
            continue;
        }

        if (eventType === 'STAGE_ADVANCED') {
            output.push({
                agent,
                summary: 'Completed a stage and provided evidence',
                outcome: extractString(((payload.evidence ?? {}) as Record<string, unknown>).notes) ?? 'Advanced to next stage',
                files,
            });
            continue;
        }

        if (eventType === 'UPDATED') {
            output.push({
                agent,
                summary: `Updated ticket metadata (${extractString(payload.action) ?? 'updated metadata'})`,
                outcome: 'Metadata updated',
                files,
            });
            continue;
        }

        if (eventType === 'CLAIMED') {
            output.push({
                agent,
                summary: 'Claimed the ticket for work',
                outcome: 'Work started',
                files,
            });
        }
    }

    return output.slice(-5);
}

function readTextContent(result: CallToolResult): string {
    const first = result.content[0];
    if (first && first.type === 'text') {
        return first.text;
    }
    return '{}';
}

function safeParse(raw: string): Record<string, any> {
    try {
        return JSON.parse(raw) as Record<string, any>;
    } catch {
        return {};
    }
}

function buildBestPractices(ticket: Ticket): string[] {
    const base = [
        'Follow explicit ticket file scope and avoid cross-ticket edits.',
        'Keep changes auditable and include evidence in completion metadata.',
    ];

    if (ticket.type === 'backend' || ticket.type === 'infra' || ticket.type === 'security') {
        base.push('Validate edge cases and failures with deterministic tests before completion.');
    }

    if (ticket.type === 'frontend' || ticket.type === 'design') {
        base.push('Preserve existing design system tokens and accessibility requirements.');
    }

    return base;
}

function buildEdgeCases(history: PromptHistoryEntry[]): string[] {
    const rejections = history
        .filter((entry) => entry.summary.includes('rejected'))
        .map((entry) => entry.outcome);

    if (rejections.length === 0) {
        return [
            'No rejection history found; verify assumptions with tests before stage completion.',
        ];
    }

    return rejections;
}

function validationChecksForType(ticketType: string): string[] {
    if (ticketType === 'frontend' || ticketType === 'design') {
        return ['npm run lint', 'npm run typecheck', 'npm test'];
    }
    if (ticketType === 'docs') {
        return ['docs build/validation checks (if configured)'];
    }
    return ['pytest -q (or project backend tests)', 'lint checks', 'type checks'];
}

function nextStageFromFlow(flow: string[], stage: string): string {
    const index = flow.indexOf(stage);
    if (index === -1 || index + 1 >= flow.length) {
        return 'NOT FOUND — agent must investigate';
    }
    return flow[index + 1] ?? 'NOT FOUND — agent must investigate';
}

function extractString(value: unknown): string | null {
    return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function extractArtifactPaths(payload: Record<string, unknown>): string[] {
    const files: string[] = [];

    const directArtifacts = payload.artifacts;
    if (Array.isArray(directArtifacts)) {
        for (const item of directArtifacts) {
            if (typeof item === 'string' && item.trim().length > 0) {
                files.push(item);
            }
        }
    }

    const evidence = payload.evidence;
    if (evidence && typeof evidence === 'object') {
        const artifacts = (evidence as Record<string, unknown>).artifacts;
        if (Array.isArray(artifacts)) {
            for (const item of artifacts) {
                if (typeof item === 'string' && item.trim().length > 0) {
                    files.push(item);
                }
            }
        }
    }

    return files.filter((value, index, arr) => arr.indexOf(value) === index);
}

async function attachPromptToTicket(
    ticket: Ticket,
    prompt: string,
    provider: string,
    model: string,
    usedFallback: boolean,
): Promise<void> {
    const now = new Date().toISOString();
    const metadataPatch = {
        agent_prompt: {
            version: 1,
            generated_at: now,
            generator: {
                provider,
                model,
                used_fallback: usedFallback,
            },
            prompt,
        },
    };

    await pool.query(
        `UPDATE tickets
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
     WHERE ticket_id = $2`,
        [JSON.stringify(metadataPatch), ticket.ticket_id],
    );

    await pool.query(
        `INSERT INTO events (ticket_id, event_type, agent_name, machine_id, operator, payload)
     VALUES ($1, 'UPDATED', $2, $3, $4, $5::jsonb)`,
        [
            ticket.ticket_id,
            'PromptArchitect',
            ticket.machine_id,
            ticket.operator,
            JSON.stringify({
                action: 'agent_prompt_attached',
                provider,
                model,
                used_fallback: usedFallback,
            }),
        ],
    );
}
