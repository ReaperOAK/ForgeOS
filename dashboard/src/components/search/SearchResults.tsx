'use client';

import { Search } from 'lucide-react';
import type { Ticket, TicketPriority } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface SearchResultsProps {
    tickets: Ticket[];
    query: string;
    isLoading: boolean;
    totalCount: number;
}

/* ------------------------------------------------------------------ */
/*  Highlight helper                                                   */
/* ------------------------------------------------------------------ */

function highlightText(text: string, query: string): React.ReactNode {
    if (!query.trim()) return text;

    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    const parts: React.ReactNode[] = [];
    let cursor = 0;

    while (cursor < lower.length) {
        const idx = lower.indexOf(q, cursor);
        if (idx === -1) {
            parts.push(text.slice(cursor));
            break;
        }
        if (idx > cursor) parts.push(text.slice(cursor, idx));
        parts.push(
            <mark
                key={idx}
                className="bg-warning/30 text-foreground rounded-sm px-0.5"
            >
                {text.slice(idx, idx + q.length)}
            </mark>,
        );
        cursor = idx + q.length;
    }

    return <>{parts}</>;
}

/* ------------------------------------------------------------------ */
/*  Badge helpers                                                      */
/* ------------------------------------------------------------------ */

const priorityColors: Record<TicketPriority, string> = {
    critical: 'bg-error text-inverse',
    high: 'bg-warning text-inverse',
    medium: 'bg-info text-inverse',
    low: 'bg-surface-alt text-muted',
};

const stageColors: Record<string, string> = {
    READY: 'text-primary',
    ARCHITECT: 'text-accent',
    RESEARCH: 'text-accent',
    BACKEND: 'text-info',
    FRONTEND: 'text-success',
    QA: 'text-warning',
    SECURITY: 'text-error',
    CI: 'text-warning',
    DOCUMENTATION: 'text-muted',
    DONE: 'text-success',
};

/* ------------------------------------------------------------------ */
/*  TicketResultCard                                                    */
/* ------------------------------------------------------------------ */

function TicketResultCard({
    ticket,
    query,
}: {
    ticket: Ticket;
    query: string;
}) {
    const priorityBorder: Record<TicketPriority, string> = {
        critical: 'border-l-error',
        high: 'border-l-warning',
        medium: 'border-l-info',
        low: 'border-l-border',
    };

    return (
        <a
            href={`/tickets/${encodeURIComponent(ticket.ticket_id)}`}
            className={`block bg-surface border border-border rounded-lg p-4 hover:bg-surface-alt transition-colors border-l-4 ${priorityBorder[ticket.priority]} focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary`}
        >
            {/* Header */}
            <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono text-primary">
                    {highlightText(ticket.ticket_id, query)}
                </span>
                <span
                    className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${priorityColors[ticket.priority]}`}
                >
                    {ticket.priority}
                </span>
                <span
                    className={`text-xs font-medium ${stageColors[ticket.stage] ?? 'text-muted'}`}
                >
                    {ticket.stage}
                </span>
            </div>

            {/* Title */}
            <h3 className="text-sm font-medium text-foreground mb-2">
                {highlightText(ticket.title, query)}
            </h3>

            {/* Description */}
            {ticket.description && (
                <p className="text-xs text-muted line-clamp-2 mb-2">
                    {highlightText(ticket.description, query)}
                </p>
            )}

            {/* Footer meta */}
            <div className="flex items-center gap-3 text-xs text-muted">
                <span className="capitalize">{ticket.type}</span>
                {ticket.claimed_by_name && (
                    <>
                        <span>·</span>
                        <span>Claimed by {ticket.claimed_by_name}</span>
                    </>
                )}
                {ticket.file_paths.length > 0 && (
                    <>
                        <span>·</span>
                        <span>{ticket.file_paths.length} file(s)</span>
                    </>
                )}
            </div>
        </a>
    );
}

/* ------------------------------------------------------------------ */
/*  Skeleton loader                                                    */
/* ------------------------------------------------------------------ */

function ResultSkeleton() {
    return (
        <div className="bg-surface border border-border rounded-lg p-4 animate-pulse border-l-4 border-l-border">
            <div className="flex items-center gap-2 mb-2">
                <div className="h-3 w-24 bg-surface-alt rounded" />
                <div className="h-3 w-12 bg-surface-alt rounded" />
            </div>
            <div className="h-4 w-3/4 bg-surface-alt rounded mb-2" />
            <div className="h-3 w-1/2 bg-surface-alt rounded" />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  SearchResults Component                                            */
/* ------------------------------------------------------------------ */

export function SearchResults({
    tickets,
    query,
    isLoading,
    totalCount,
}: SearchResultsProps) {
    // Loading
    if (isLoading) {
        return (
            <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <ResultSkeleton key={i} />
                ))}
            </div>
        );
    }

    // Empty state
    if (tickets.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-16 text-center">
                <Search
                    size={48}
                    className="text-muted/30 mb-4"
                    aria-hidden="true"
                />
                {query ? (
                    <>
                        <h3 className="text-lg font-medium text-foreground mb-1">
                            No tickets found
                        </h3>
                        <p className="text-sm text-muted max-w-md">
                            No tickets match &ldquo;{query}&rdquo;. Try adjusting your
                            search terms or filters.
                        </p>
                    </>
                ) : (
                    <>
                        <h3 className="text-lg font-medium text-foreground mb-1">
                            Search for tickets
                        </h3>
                        <p className="text-sm text-muted max-w-md">
                            Enter a search term above to find tickets by ID, title, or
                            description. Use filters to narrow your results.
                        </p>
                    </>
                )}
            </div>
        );
    }

    return (
        <div>
            {/* Result count */}
            <div className="mb-4" aria-live="polite">
                <p className="text-sm text-muted">
                    Showing{' '}
                    <span className="text-foreground font-medium">
                        {tickets.length}
                    </span>{' '}
                    of{' '}
                    <span className="text-foreground font-medium">{totalCount}</span>{' '}
                    results
                    {query && (
                        <>
                            {' '}
                            for &ldquo;
                            <span className="text-primary">{query}</span>&rdquo;
                        </>
                    )}
                </p>
            </div>

            {/* Results list */}
            <div className="space-y-3" role="list" aria-label="Search results">
                {tickets.map((ticket) => (
                    <div key={ticket.ticket_id} role="listitem">
                        <TicketResultCard ticket={ticket} query={query} />
                    </div>
                ))}
            </div>
        </div>
    );
}
