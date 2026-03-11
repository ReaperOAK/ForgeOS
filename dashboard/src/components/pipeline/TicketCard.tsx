'use client';

import Link from 'next/link';
import type { TicketType, TicketPriority } from '@/lib/api/types';

/** Props for the {@link TicketCard} component. */
export interface TicketCardProps {
    /** Unique ticket identifier (e.g. `'FORGEOS-BE001'`). */
    ticketId: string;
    /** Ticket title, truncated to 50 characters in the UI. */
    title: string;
    /** Ticket type determining the color-coded badge. */
    type: TicketType;
    /** Ticket priority controlling the left border color and dot. */
    priority: TicketPriority;
    /** Agent or user who claimed the ticket, or `null` if unclaimed. */
    claimedBy: string | null;
    /** Machine hostname where the ticket is being processed. */
    machineId: string | null;
    /** Number of times the ticket has been sent back for rework. */
    reworkCount: number;
}

const TYPE_COLORS: Record<string, string> = {
    backend: 'bg-blue-500',
    frontend: 'bg-teal-500',
    fullstack: 'bg-purple-500',
    infra: 'bg-orange-500',
    security: 'bg-red-500',
    docs: 'bg-gray-500',
    research: 'bg-violet-500',
    architecture: 'bg-purple-500',
    product: 'bg-cyan-500',
    design: 'bg-pink-500',
};

const PRIORITY_BORDER: Record<TicketPriority, string> = {
    critical: 'border-l-red-500',
    high: 'border-l-orange-500',
    medium: 'border-l-blue-500',
    low: 'border-l-gray-500',
};

const PRIORITY_DOT: Record<TicketPriority, string> = {
    critical: 'bg-red-500',
    high: 'bg-orange-500',
    medium: 'bg-blue-500',
    low: 'bg-gray-500',
};

function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '…' : text;
}

/**
 * Compact ticket card rendered inside a {@link StageColumn}.
 *
 * Displays the ticket ID, truncated title, color-coded type badge,
 * priority indicator dot, claim status, and optional rework count.
 * Clicking the card navigates to the ticket detail page.
 */
export function TicketCard({
    ticketId,
    title,
    type,
    priority,
    claimedBy,
    machineId,
    reworkCount,
}: TicketCardProps) {
    return (
        <Link
            href={`/tickets/${encodeURIComponent(ticketId)}`}
            className={`block border-l-[3px] ${PRIORITY_BORDER[priority]} bg-surface rounded-r-lg p-3 hover:bg-surface-alt transition-colors duration-fast focus-ring group`}
            aria-label={`${ticketId}: ${title}`}
        >
            {/* Header: ID + machine badge */}
            <div className="flex items-center justify-between gap-2 mb-1">
                <span className="font-mono text-sm font-medium text-primary truncate">
                    {ticketId}
                </span>
                {machineId && (
                    <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-accent/20 text-accent">
                        {machineId}
                    </span>
                )}
            </div>

            {/* Title — max 50 chars */}
            <p className="text-sm text-foreground line-clamp-2 mb-2">
                {truncate(title, 50)}
            </p>

            {/* Metadata row */}
            <div className="flex items-center gap-2 flex-wrap">
                {/* Priority dot */}
                <span
                    className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[priority]}`}
                    title={`${priority} priority`}
                    aria-label={`${priority} priority`}
                />

                {/* Type badge */}
                <span
                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full text-white ${TYPE_COLORS[type] ?? 'bg-gray-500'}`}
                >
                    {type}
                </span>

                {/* Claim indicator */}
                <span className="text-[11px] text-muted truncate">
                    {claimedBy ? (
                        <>
                            <span className="inline-block w-1.5 h-1.5 rounded-full bg-success mr-1 align-middle" />
                            {claimedBy}
                        </>
                    ) : (
                        <span className="italic">Unclaimed</span>
                    )}
                </span>

                {/* Rework badge */}
                {reworkCount > 0 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-warning/20 text-warning">
                        R{reworkCount}
                    </span>
                )}
            </div>
        </Link>
    );
}
