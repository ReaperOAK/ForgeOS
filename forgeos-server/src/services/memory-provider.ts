import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { logger } from '../middleware/logging.js';
import { ticketsGetHandler } from '../tools/tickets-get.js';
import { memorySearchLessonsHandler } from '../tools/memory-search-lessons.js';
import { computeDeterministicHash } from './context-hash.js';

export type MemorySnapshotCompleteness = 'complete' | 'reduced';

interface TicketShape {
    title?: string;
    description?: string | null;
    acceptance_criteria?: string[];
}

interface MemoryLessonRow {
    id?: string;
    category?: string | null;
    lesson_text?: string | null;
    similarity?: number;
    created_at?: string | null;
}

export interface MemorySnapshotEntry {
    id: string;
    category: string;
    lessonText: string;
    similarity: number;
    createdAt: string;
}

export interface MemorySnapshot {
    query: string;
    version: string;
    completeness: MemorySnapshotCompleteness;
    warnings: string[];
    learnings: string[];
    bestPractices: string[];
    learningEntries: MemorySnapshotEntry[];
    bestPracticeEntries: MemorySnapshotEntry[];
}

interface SearchOutcome {
    lessons: MemoryLessonRow[];
    warnings: string[];
}

export async function loadMemorySnapshotForTicket(ticketId: string): Promise<MemorySnapshot> {
    const ticketResult = await ticketsGetHandler({ ticket_id: ticketId });
    const ticketJson = parseToolText(ticketResult);
    const ticket = (ticketJson.ticket ?? {}) as TicketShape;

    return retrieveMemorySnapshot(buildLessonQuery(ticket, ticketId));
}

export async function retrieveMemorySnapshot(query: string): Promise<MemorySnapshot> {
    const [generalOutcome, instructionOutcome] = await Promise.all([
        safeSearchLessons(query),
        safeSearchLessons(query, 'instruction'),
    ]);

    const normalizedLessons = [
        ...normalizeLessonRows(generalOutcome.lessons),
        ...normalizeLessonRows(instructionOutcome.lessons),
    ];
    const learningEntries = sortEntries(normalizedLessons.filter((entry) => entry.category !== 'instruction'));
    const bestPracticeEntries = sortEntries(normalizedLessons.filter((entry) => entry.category === 'instruction'));
    const warnings = [...generalOutcome.warnings, ...instructionOutcome.warnings].sort((left, right) => left.localeCompare(right));
    const completeness: MemorySnapshotCompleteness = warnings.length > 0 ? 'reduced' : 'complete';
    const hasUsableEntries = learningEntries.length > 0 || bestPracticeEntries.length > 0;
    const version = hasUsableEntries
        ? computeDeterministicHash({
            query,
            completeness,
            warnings,
            learningEntries,
            bestPracticeEntries,
        })
        : (process.env.FORGEOS_MEMORY_SNAPSHOT_VERSION ?? 'unknown');

    return {
        query,
        version,
        completeness,
        warnings,
        learnings: learningEntries.map(formatLesson),
        bestPractices: bestPracticeEntries.map(formatLesson),
        learningEntries,
        bestPracticeEntries,
    };
}

async function safeSearchLessons(query: string, category?: string): Promise<SearchOutcome> {
    try {
        const result = await memorySearchLessonsHandler({
            query,
            category,
            limit: 5,
            threshold: category === 'instruction' ? 0.5 : 0.55,
        });
        const parsed = parseToolText(result);

        if (!Array.isArray(parsed.lessons)) {
            return {
                lessons: [],
                warnings: [category === 'instruction' ? 'instruction-search-malformed' : 'lessons-search-malformed'],
            };
        }

        if (result.isError) {
            logger.warn({ query, category }, 'memory-provider: memory search returned error payload');
            return {
                lessons: parsed.lessons as MemoryLessonRow[],
                warnings: [category === 'instruction' ? 'instruction-search-unavailable' : 'lessons-search-unavailable'],
            };
        }

        return {
            lessons: parsed.lessons as MemoryLessonRow[],
            warnings: [],
        };
    } catch (error) {
        logger.warn(
            {
                query,
                category,
                error: error instanceof Error ? error.message : String(error),
            },
            'memory-provider: memory search failed',
        );

        return {
            lessons: [],
            warnings: [category === 'instruction' ? 'instruction-search-unavailable' : 'lessons-search-unavailable'],
        };
    }
}

function normalizeLessonRows(rows: MemoryLessonRow[]): MemorySnapshotEntry[] {
    return rows
        .map((row, index) => {
            const lessonText = typeof row.lesson_text === 'string' ? row.lesson_text.trim() : '';
            if (lessonText.length === 0) {
                return null;
            }

            const normalizedCategory = typeof row.category === 'string' ? row.category.trim().toLowerCase() : 'lesson';
            const category = normalizedCategory.length > 0 ? normalizedCategory : 'lesson';

            return {
                id: typeof row.id === 'string' && row.id.trim().length > 0 ? row.id : `lesson-${index}-${category}`,
                category,
                lessonText,
                similarity: typeof row.similarity === 'number' && Number.isFinite(row.similarity) ? row.similarity : 0,
                createdAt: typeof row.created_at === 'string' ? row.created_at : '',
            };
        })
        .filter((entry): entry is MemorySnapshotEntry => entry !== null);
}

function sortEntries(entries: MemorySnapshotEntry[]): MemorySnapshotEntry[] {
    return [...entries].sort((left, right) => {
        if (left.similarity !== right.similarity) {
            return right.similarity - left.similarity;
        }

        const createdAtOrder = right.createdAt.localeCompare(left.createdAt);
        if (createdAtOrder !== 0) {
            return createdAtOrder;
        }

        const categoryOrder = left.category.localeCompare(right.category);
        if (categoryOrder !== 0) {
            return categoryOrder;
        }

        const textOrder = left.lessonText.localeCompare(right.lessonText);
        if (textOrder !== 0) {
            return textOrder;
        }

        return left.id.localeCompare(right.id);
    });
}

function formatLesson(entry: MemorySnapshotEntry): string {
    return `${entry.category}: ${entry.lessonText}`;
}

function buildLessonQuery(ticket: TicketShape, ticketId: string): string {
    const candidate = [
        ticket.title,
        ticket.description ?? '',
        ...(Array.isArray(ticket.acceptance_criteria) ? ticket.acceptance_criteria : []),
    ].join(' ').trim();

    return candidate.length > 0 ? candidate : ticketId;
}

function parseToolText(result: CallToolResult | undefined): Record<string, unknown> {
    if (!result || !Array.isArray(result.content)) {
        return {};
    }

    const first = result.content[0];
    if (!first || first.type !== 'text') {
        return {};
    }

    try {
        return JSON.parse(first.text) as Record<string, unknown>;
    } catch {
        return {};
    }
}