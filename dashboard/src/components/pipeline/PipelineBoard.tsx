'use client';

import { useMemo } from 'react';
import type { Ticket, TicketStage } from '@/lib/api/types';
import { StageColumn } from './StageColumn';

/** Props for the {@link PipelineBoard} component. */
export interface PipelineBoardProps {
    /** All tickets to distribute across stage columns. */
    tickets: Ticket[];
    /** When `true`, renders skeleton columns instead of real data. */
    isLoading: boolean;
}

/** Ordered SDLC stages with display labels and accent colors (from design tokens). */
const PIPELINE_STAGES: {
    stage: TicketStage;
    label: string;
    color: string;
}[] = [
        { stage: 'READY', label: 'Ready', color: '#06B6D4' },
        { stage: 'RESEARCH', label: 'Research', color: '#A855F7' },
        { stage: 'ARCHITECT', label: 'Architect', color: '#8B5CF6' },
        { stage: 'BACKEND', label: 'Backend', color: '#3B82F6' },
        { stage: 'FRONTEND', label: 'Frontend', color: '#14B8A6' },
        { stage: 'QA', label: 'QA', color: '#F97316' },
        { stage: 'SECURITY', label: 'Security', color: '#EF4444' },
        { stage: 'CI', label: 'CI', color: '#EAB308' },
        { stage: 'DOCUMENTATION', label: 'Docs', color: '#64748B' },
        { stage: 'VALIDATOR', label: 'Validation', color: '#16A34A' },
        { stage: 'DONE', label: 'Done', color: '#22C55E' },
    ];

function SkeletonColumn() {
    return (
        <div className="min-w-[200px] max-w-[280px] flex-1 bg-background rounded-lg border border-border overflow-hidden animate-pulse">
            <div className="px-3 py-2 border-b border-border">
                <div className="h-4 w-20 bg-surface rounded" />
            </div>
            <div className="p-2 space-y-2">
                <div className="h-20 bg-surface rounded" />
                <div className="h-20 bg-surface rounded" />
            </div>
        </div>
    );
}

/**
 * Horizontal Kanban board displaying 11 SDLC stage columns.
 *
 * Groups tickets by stage, sorts each group by priority (critical first)
 * then by most-recently-updated, and renders a {@link StageColumn} for
 * each stage. Shows skeleton placeholders while loading.
 */
export function PipelineBoard({ tickets, isLoading }: PipelineBoardProps) {
    const ticketsByStage = useMemo(() => {
        const grouped: Record<string, Ticket[]> = {};
        for (const col of PIPELINE_STAGES) {
            grouped[col.stage] = [];
        }
        for (const ticket of tickets) {
            if (grouped[ticket.stage]) {
                grouped[ticket.stage].push(ticket);
            }
        }
        // Sort within each stage: critical first, then by updated_at descending
        const priorityOrder: Record<string, number> = {
            critical: 0,
            high: 1,
            medium: 2,
            low: 3,
        };
        for (const stage of Object.keys(grouped)) {
            grouped[stage].sort(
                (a, b) =>
                    (priorityOrder[a.priority] ?? 9) -
                    (priorityOrder[b.priority] ?? 9) ||
                    new Date(b.updated_at).getTime() -
                    new Date(a.updated_at).getTime(),
            );
        }
        return grouped;
    }, [tickets]);

    if (isLoading) {
        return (
            <div
                className="flex gap-3 overflow-x-auto pb-4"
                aria-busy="true"
                aria-label="Loading pipeline"
            >
                {PIPELINE_STAGES.map((col) => (
                    <SkeletonColumn key={col.stage} />
                ))}
            </div>
        );
    }

    return (
        <div
            className="flex gap-3 overflow-x-auto pb-4"
            role="region"
            aria-label="Pipeline board"
        >
            {PIPELINE_STAGES.map((col) => (
                <StageColumn
                    key={col.stage}
                    stage={col.stage}
                    label={col.label}
                    accentColor={col.color}
                    tickets={ticketsByStage[col.stage] ?? []}
                />
            ))}
        </div>
    );
}
