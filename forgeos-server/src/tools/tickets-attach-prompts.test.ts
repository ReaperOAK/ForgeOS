/**
 * Unit tests for tickets.attach_prompts.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ticketsAttachPromptsSchema,
    ticketsAttachPromptsHandler,
} from './tickets-attach-prompts.js';

const mockQuery = vi.fn();
const mockGeneratePrompt = vi.fn();

vi.mock('../db/pool.js', () => ({
    pool: {
        query: (...args: unknown[]) => mockQuery(...args),
    },
}));

vi.mock('../middleware/logging.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));

vi.mock('../services/prompt-architect-service.js', () => ({
    PromptArchitectService: class {
        generatePrompt(...args: unknown[]): Promise<unknown> {
            return mockGeneratePrompt(...args);
        }
    },
}));

function parse(result: unknown): Record<string, unknown> {
    const maybe = result as { content?: Array<{ type?: string; text?: string }> };
    const first = maybe.content?.[0];
    if (!first || first.type !== 'text' || typeof first.text !== 'string') {
        return {};
    }
    return JSON.parse(first.text);
}

function makeReadyTicket(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: 'pk-1',
        ticket_id: 'TASK-READY-1',
        project_id: null,
        title: 'Implement feature',
        description: 'Implement feature details',
        type: 'backend',
        priority: 'high',
        status: 'READY',
        stage: 'READY',
        sdlc_flow: ['READY', 'BACKEND', 'QA', 'DONE'],
        claimed_by: null,
        claimed_by_name: null,
        machine_id: 'machine-1',
        operator: 'operator-1',
        lease_expiry: null,
        lease_duration_minutes: 30,
        depends_on: [],
        file_paths: ['src/feature.ts'],
        acceptance_criteria: ['AC1', 'AC2'],
        tags: ['backend'],
        rework_count: 0,
        max_reworks: 3,
        metadata: {},
        parent_id: null,
        source_task_file: null,
        created_at: '2026-03-14T00:00:00Z',
        updated_at: '2026-03-14T00:00:00Z',
        completed_at: null,
        ...overrides,
    };
}

describe('ticketsAttachPromptsSchema', () => {
    it('applies defaults', () => {
        const parsed = ticketsAttachPromptsSchema.parse({});
        expect(parsed.limit).toBe(25);
        expect(parsed.force_regenerate).toBe(false);
        expect(parsed.max_context_files).toBe(5);
    });

    it('rejects invalid limit', () => {
        expect(() => ticketsAttachPromptsSchema.parse({ limit: 0 })).toThrow();
    });
});

describe('ticketsAttachPromptsHandler', () => {
    beforeEach(() => {
        mockQuery.mockReset();
        mockGeneratePrompt.mockReset();
    });

    it('returns no-op when no READY tickets are found', async () => {
        mockQuery.mockResolvedValueOnce({ rows: [] });

        const result = await ticketsAttachPromptsHandler({
            limit: 10,
            force_regenerate: false,
            max_context_files: 5,
        });

        const parsed = parse(result);
        expect(parsed.message).toBe('No READY tickets found');
        expect(parsed.processed).toBe(0);
    });

    it('attaches prompt to a READY ticket', async () => {
        mockQuery
            .mockResolvedValueOnce({ rows: [makeReadyTicket()] }) // selectTargetTickets
            .mockResolvedValueOnce({ // loadTicketHistory
                rows: [
                    {
                        event_type: 'STAGE_ADVANCED',
                        agent_name: 'Backend',
                        payload: { evidence: { notes: 'Partial done', artifacts: ['src/feature.ts'] } },
                    },
                ],
            })
            .mockResolvedValueOnce({ rows: [] }) // loadRelevantLessons
            .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // UPDATE tickets
            .mockResolvedValueOnce({ rowCount: 1, rows: [] }); // INSERT event

        mockGeneratePrompt.mockResolvedValue({
            prompt: '**ROLE**\nYou are a Backend Engineer.',
            provider: 'ollama',
            model: 'qwen2.5:7b-instruct',
            usedFallback: false,
        });

        const result = await ticketsAttachPromptsHandler({
            limit: 10,
            force_regenerate: false,
            max_context_files: 5,
        });

        const parsed = parse(result);
        expect(parsed.message).toBe('OK');
        expect(parsed.attached).toBe(1);
        expect(parsed.errors).toBe(0);
        expect(mockGeneratePrompt).toHaveBeenCalledTimes(1);
    });

    it('skips ticket with existing prompt when force_regenerate is false', async () => {
        mockQuery.mockResolvedValueOnce({
            rows: [
                makeReadyTicket({
                    metadata: {
                        agent_prompt: {
                            prompt: 'existing prompt',
                        },
                    },
                }),
            ],
        });

        const result = await ticketsAttachPromptsHandler({
            limit: 1,
            force_regenerate: false,
            max_context_files: 5,
        });

        const parsed = parse(result);
        expect(parsed.skipped).toBe(1);
        expect(mockGeneratePrompt).not.toHaveBeenCalled();
    });
});
