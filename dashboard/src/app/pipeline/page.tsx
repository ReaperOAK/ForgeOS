'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { PipelineBoard } from '@/components/pipeline/PipelineBoard';
import { fetchTickets } from '@/lib/api';
import type { Ticket } from '@/lib/api';

/**
 * Pipeline page displaying all tickets in a horizontal Kanban board.
 *
 * Fetches all tickets on mount and provides a manual refresh button.
 * Renders the {@link PipelineBoard} component with loading and error states.
 *
 * @returns The pipeline Kanban view page
 */
export default function PipelinePage() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [isRefreshing, setIsRefreshing] = useState(false);

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

    return (
        <div>
            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">Pipeline</h1>
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
            <PipelineBoard tickets={tickets} isLoading={isLoading} />
        </div>
    );
}
