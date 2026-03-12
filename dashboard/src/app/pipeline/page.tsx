'use client';

import { Suspense, useState, useEffect, useCallback, useMemo } from 'react';
import { RefreshCw, SlidersHorizontal } from 'lucide-react';
import { PipelineBoard } from '@/components/pipeline/PipelineBoard';
import { ConnectionStatusIndicator } from '@/components/ConnectionStatusIndicator';
import { FilterBar } from '@/components/filters/FilterBar';
import { useTicketStream } from '@/lib/hooks/useTicketStream';
import { useFilters } from '@/lib/hooks/useFilters';
import { fetchTickets } from '@/lib/api';
import type { Ticket } from '@/lib/api';
import type { TicketPriority } from '@/lib/api/types';

const PRIORITY_ORDER: Record<TicketPriority, number> = {
    critical: 0,
    high: 1,
    medium: 2,
    low: 3,
};

function PipelinePageContent() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [showFilters, setShowFilters] = useState(false);

    const filtersResult = useFilters();
    const { filters } = filtersResult;

    const handleTicketUpdate = useCallback((updated: Ticket) => {
        setTickets((prev) => {
            const idx = prev.findIndex((t) => t.ticket_id === updated.ticket_id);
            if (idx >= 0) {
                const next = [...prev];
                next[idx] = updated;
                return next;
            }
            return [...prev, updated];
        });
    }, []);

    const { status: wsStatus } = useTicketStream({
        onTicketUpdate: handleTicketUpdate,
    });

    const loadTickets = useCallback(async (showSpinner = false) => {
        if (showSpinner) setIsRefreshing(true);
        try {
            const result = await fetchTickets({ limit: 500 });
            setTickets(result.data);
            setError(null);
        } catch (err) {
            const message =
                err instanceof Error ? err.message : 'Failed to load tickets';
            setError(message);
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        loadTickets();
    }, [loadTickets]);

    // Dynamic values for contextual filter chips
    const { operators, machines, agents } = useMemo(() => {
        const ops = new Set<string>();
        const macs = new Set<string>();
        const ags = new Set<string>();
        for (const t of tickets) {
            if (t.operator) ops.add(t.operator);
            if (t.machine_id) macs.add(t.machine_id);
            if (t.claimed_by_name) ags.add(t.claimed_by_name);
        }
        return {
            operators: [...ops].sort(),
            machines: [...macs].sort(),
            agents: [...ags].sort(),
        };
    }, [tickets]);

    // Apply client-side filtering + sorting
    const filteredTickets = useMemo(() => {
        let result = tickets;

        if (filters.stage.length > 0) {
            result = result.filter((t) => filters.stage.includes(t.stage));
        }
        if (filters.type.length > 0) {
            result = result.filter((t) => filters.type.includes(t.type));
        }
        if (filters.priority.length > 0) {
            result = result.filter((t) => filters.priority.includes(t.priority));
        }
        if (filters.operator.length > 0) {
            result = result.filter((t) => t.operator !== null && filters.operator.includes(t.operator));
        }
        if (filters.machine.length > 0) {
            result = result.filter((t) => t.machine_id !== null && filters.machine.includes(t.machine_id));
        }
        if (filters.agent.length > 0) {
            result = result.filter((t) => t.claimed_by_name !== null && filters.agent.includes(t.claimed_by_name));
        }

        // Sort
        const dir = filters.sortDir === 'asc' ? 1 : -1;
        result = [...result].sort((a, b) => {
            switch (filters.sort) {
                case 'priority':
                    return dir * (PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
                case 'created_at':
                    return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
                case 'updated_at':
                    return dir * (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime());
                case 'ticket_id':
                    return dir * a.ticket_id.localeCompare(b.ticket_id);
                default:
                    return 0;
            }
        });

        return result;
    }, [tickets, filters]);

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold">Pipeline</h1>
                    <ConnectionStatusIndicator status={wsStatus} />
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowFilters((p) => !p)}
                        className={`flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors focus-ring ${showFilters
                                ? 'bg-primary text-inverse border-primary'
                                : 'bg-surface border-border hover:bg-surface-alt'
                            }`}
                        aria-label={showFilters ? 'Hide filters' : 'Show filters'}
                        aria-expanded={showFilters}
                    >
                        <SlidersHorizontal size={14} aria-hidden="true" />
                        Filters
                        {filtersResult.activeFilterCount > 0 && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full bg-surface text-foreground font-medium">
                                {filtersResult.activeFilterCount}
                            </span>
                        )}
                    </button>
                    <button
                        onClick={() => loadTickets(true)}
                        disabled={isRefreshing}
                        className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium rounded-lg bg-surface border border-border hover:bg-surface-alt transition-colors focus-ring disabled:opacity-50"
                        aria-label="Refresh pipeline data"
                    >
                        <RefreshCw
                            size={14}
                            className={isRefreshing ? 'animate-spin' : ''}
                            aria-hidden="true"
                        />
                        Refresh
                    </button>
                </div>
            </div>

            {/* Filters panel */}
            {showFilters && (
                <div className="mb-4">
                    <FilterBar
                        filters={filtersResult}
                        availableOperators={operators}
                        availableMachines={machines}
                        availableAgents={agents}
                    />
                </div>
            )}

            {/* Error banner */}
            {error && (
                <div
                    className="mb-4 p-3 rounded-lg bg-error-muted border border-error text-sm text-error"
                    role="alert"
                >
                    {error}
                    <button
                        onClick={() => loadTickets(true)}
                        className="ml-2 underline hover:no-underline"
                    >
                        Retry
                    </button>
                </div>
            )}

            {/* Board */}
            <PipelineBoard tickets={filteredTickets} isLoading={isLoading} />
        </div>
    );
}

/**
 * Pipeline page displaying all tickets in a horizontal Kanban board.
 *
 * Fetches all tickets on mount, subscribes to WebSocket events for
 * real-time updates, and provides a manual refresh fallback button.
 * Includes client-side filtering by stage, type, priority, operator,
 * machine, and agent — with sort controls and URL-synced state.
 */
export default function PipelinePage() {
    return (
        <Suspense fallback={<div className="text-muted text-sm p-4">Loading pipeline…</div>}>
            <PipelinePageContent />
        </Suspense>
    );
}
