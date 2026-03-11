'use client';

import { useEffect, useState } from 'react';
import type { EventHistory } from '@/lib/api';
import { fetchTicketHistory, isApiError } from '@/lib/api';

interface HistoryTimelineProps {
    ticketId: string;
}

const eventTypeLabels: Record<string, string> = {
    CREATED: 'Created',
    CLAIMED: 'Claimed',
    RELEASED: 'Released',
    STAGE_ADVANCED: 'Stage Advanced',
    STAGE_REJECTED: 'Stage Rejected',
    UPDATED: 'Updated',
    SPAWNED: 'Spawned',
    ESCALATED: 'Escalated',
    LEASE_EXTENDED: 'Lease Extended',
    FORCE_RELEASED: 'Force Released',
    RECONCILED: 'Reconciled',
    FILE_LOCKED: 'File Locked',
    FILE_UNLOCKED: 'File Unlocked',
    HEARTBEAT: 'Heartbeat',
    COMPLETED: 'Completed',
};

const eventTypeColors: Record<string, string> = {
    CREATED: 'bg-info',
    CLAIMED: 'bg-warning',
    RELEASED: 'bg-muted',
    STAGE_ADVANCED: 'bg-success',
    STAGE_REJECTED: 'bg-error',
    UPDATED: 'bg-info',
    SPAWNED: 'bg-accent',
    ESCALATED: 'bg-error',
    COMPLETED: 'bg-success',
};

function formatTimestamp(iso: string): string {
    const d = new Date(iso);
    return d.toLocaleString();
}

function formatRelativeTime(iso: string): string {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diffMs = now - then;
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return 'just now';
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
}

export function HistoryTimeline({ ticketId }: HistoryTimelineProps) {
    const [events, setEvents] = useState<EventHistory[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);
            try {
                const data = await fetchTicketHistory(ticketId);
                if (!cancelled) setEvents(data);
            } catch (err) {
                if (!cancelled) {
                    setError(
                        isApiError(err) ? err.message : 'Failed to load history',
                    );
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [ticketId]);

    if (loading) {
        return (
            <div className="space-y-4" role="status" aria-label="Loading history">
                {[1, 2, 3].map((i) => (
                    <div key={i} className="animate-pulse flex gap-4">
                        <div className="w-3 h-3 rounded-full bg-surface-alt mt-1.5" />
                        <div className="flex-1 space-y-2">
                            <div className="h-4 bg-surface-alt rounded w-1/3" />
                            <div className="h-3 bg-surface-alt rounded w-2/3" />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-error-muted border border-error rounded-lg p-4 text-sm text-error" role="alert">
                {error}
            </div>
        );
    }

    if (events.length === 0) {
        return (
            <p className="text-sm text-muted py-4">No history events recorded.</p>
        );
    }

    return (
        <ol className="relative border-l border-border ml-2 space-y-6" aria-label="Event timeline">
            {events.map((event) => {
                const dotColor = eventTypeColors[event.event_type] || 'bg-muted';
                const stageTransition =
                    event.previous_stage && event.new_stage
                        ? `${event.previous_stage} → ${event.new_stage}`
                        : event.new_stage
                            ? `→ ${event.new_stage}`
                            : null;

                return (
                    <li key={event.id} className="ml-6">
                        <span
                            className={`absolute -left-1.5 w-3 h-3 rounded-full ${dotColor} ring-4 ring-background`}
                            aria-hidden="true"
                        />
                        <div className="bg-surface border border-border rounded-lg p-4">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                                <span className="text-sm font-semibold text-foreground">
                                    {eventTypeLabels[event.event_type] || event.event_type}
                                </span>
                                <time
                                    dateTime={event.created_at}
                                    className="text-xs text-muted"
                                    title={formatTimestamp(event.created_at)}
                                >
                                    {formatRelativeTime(event.created_at)}
                                </time>
                            </div>
                            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                                {event.agent_name && (
                                    <span>
                                        Agent: <strong className="text-foreground">{event.agent_name}</strong>
                                    </span>
                                )}
                                {event.machine_id && (
                                    <span>
                                        Machine: <strong className="text-foreground">{event.machine_id}</strong>
                                    </span>
                                )}
                                {event.operator && (
                                    <span>
                                        Operator: <strong className="text-foreground">{event.operator}</strong>
                                    </span>
                                )}
                            </div>
                            {stageTransition && (
                                <p className="text-xs font-mono text-primary mt-2">
                                    {stageTransition}
                                </p>
                            )}
                            {event.payload && Object.keys(event.payload).length > 0 && (
                                <details className="mt-2">
                                    <summary className="text-xs text-muted cursor-pointer hover:text-foreground">
                                        Details
                                    </summary>
                                    <pre className="mt-1 text-xs font-mono text-muted bg-surface-alt rounded p-2 overflow-x-auto">
                                        {JSON.stringify(event.payload, null, 2)}
                                    </pre>
                                </details>
                            )}
                        </div>
                    </li>
                );
            })}
        </ol>
    );
}
