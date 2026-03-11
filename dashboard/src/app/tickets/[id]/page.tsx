'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import type { Ticket, TicketDetail } from '@/lib/api';
import { fetchTicket, isApiError } from '@/lib/api';
import { TicketMetadata } from '@/components/tickets/TicketMetadata';
import { HistoryTimeline } from '@/components/tickets/HistoryTimeline';
import { DependencyTree } from '@/components/tickets/DependencyTree';
import { useTicketStream } from '@/lib/hooks/useTicketStream';

type Tab = 'history' | 'dependencies';

/**
 * Ticket detail page with real-time WebSocket updates.
 *
 * Fetches ticket data via {@link fetchTicket} and subscribes to live
 * updates for the currently viewed ticket via {@link useTicketStream}.
 */
export default function TicketDetailPage() {
    const params = useParams<{ id: string }>();
    const ticketId = params.id;

    const [ticket, setTicket] = useState<TicketDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [is404, setIs404] = useState(false);
    const [activeTab, setActiveTab] = useState<Tab>('history');

    const handleTicketUpdate = useCallback(
        (updated: Ticket) => {
            if (updated.ticket_id === ticketId) {
                setTicket((prev) =>
                    prev
                        ? { ...prev, ...updated }
                        : { ...updated, dependency_status: [] },
                );
            }
        },
        [ticketId],
    );

    useTicketStream({ onTicketUpdate: handleTicketUpdate });

    useEffect(() => {
        let cancelled = false;

        async function load() {
            setLoading(true);
            setError(null);
            setIs404(false);
            try {
                const data = await fetchTicket(ticketId);
                if (!cancelled) setTicket(data);
            } catch (err) {
                if (!cancelled) {
                    if (isApiError(err) && err.status === 404) {
                        setIs404(true);
                    } else {
                        setError(
                            isApiError(err) ? err.message : 'Failed to load ticket',
                        );
                    }
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        }

        load();
        return () => { cancelled = true; };
    }, [ticketId]);

    if (is404) {
        notFound();
    }

    if (loading) {
        return (
            <div className="max-w-4xl mx-auto space-y-6" role="status" aria-label="Loading ticket">
                <div className="animate-pulse space-y-4">
                    <div className="h-6 bg-surface-alt rounded w-1/4" />
                    <div className="h-8 bg-surface-alt rounded w-1/2" />
                    <div className="bg-surface border border-border rounded-lg p-6 space-y-4">
                        <div className="h-4 bg-surface-alt rounded w-full" />
                        <div className="h-4 bg-surface-alt rounded w-3/4" />
                        <div className="grid grid-cols-4 gap-4">
                            {[1, 2, 3, 4].map((i) => (
                                <div key={i} className="h-12 bg-surface-alt rounded" />
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="max-w-4xl mx-auto">
                <div className="bg-error-muted border border-error rounded-lg p-6 text-center" role="alert">
                    <p className="text-error font-medium">{error}</p>
                    <button
                        onClick={() => window.location.reload()}
                        className="mt-3 text-sm text-primary hover:underline"
                    >
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    if (!ticket) return null;

    const tabs: { key: Tab; label: string }[] = [
        { key: 'history', label: 'History' },
        { key: 'dependencies', label: 'Dependencies' },
    ];

    return (
        <div className="max-w-4xl mx-auto space-y-6">
            {/* Back link */}
            <Link
                href="/pipeline"
                className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground transition-colors"
            >
                <ArrowLeft size={14} aria-hidden="true" />
                Back to Pipeline
            </Link>

            {/* Metadata panel */}
            <TicketMetadata ticket={ticket} />

            {/* Tabs */}
            <div className="bg-surface border border-border rounded-lg">
                <div className="border-b border-border" role="tablist" aria-label="Ticket details">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            role="tab"
                            aria-selected={activeTab === tab.key}
                            aria-controls={`panel-${tab.key}`}
                            onClick={() => setActiveTab(tab.key)}
                            className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 ${activeTab === tab.key
                                    ? 'border-primary text-primary'
                                    : 'border-transparent text-muted hover:text-foreground'
                                }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                <div
                    id={`panel-${activeTab}`}
                    role="tabpanel"
                    className="p-6"
                >
                    {activeTab === 'history' && (
                        <HistoryTimeline ticketId={ticket.ticket_id} />
                    )}
                    {activeTab === 'dependencies' && (
                        <DependencyTree ticket={ticket} />
                    )}
                </div>
            </div>
        </div>
    );
}
