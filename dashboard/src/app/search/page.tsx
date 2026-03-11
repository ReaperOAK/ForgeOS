'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Search, X, ArrowLeft } from 'lucide-react';
import { fetchTickets } from '@/lib/api';
import type { Ticket, TicketStage, TicketType, TicketPriority } from '@/lib/api';
import { SearchResults } from '@/components/search/SearchResults';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STAGE_OPTIONS: TicketStage[] = [
    'READY', 'ARCHITECT', 'BACKEND', 'FRONTEND', 'QA',
    'SECURITY', 'CI', 'DOCUMENTATION', 'DONE',
];

const PRIORITY_OPTIONS: TicketPriority[] = ['critical', 'high', 'medium', 'low'];
const TYPE_OPTIONS: TicketType[] = ['backend', 'frontend', 'fullstack', 'infra', 'security', 'docs'];

/* ------------------------------------------------------------------ */
/*  FilterChip                                                         */
/* ------------------------------------------------------------------ */

function FilterChip({
    label,
    active,
    onClick,
}: {
    label: string;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                active
                    ? 'bg-primary text-inverse border-primary'
                    : 'bg-surface-alt text-muted border-border hover:border-primary/50'
            }`}
        >
            {label}
        </button>
    );
}

/* ------------------------------------------------------------------ */
/*  SearchPageInner (needs Suspense boundary for useSearchParams)       */
/* ------------------------------------------------------------------ */

function SearchPageInner() {
    const searchParams = useSearchParams();
    const router = useRouter();

    const initialQuery = searchParams.get('q') ?? '';
    const initialStages = searchParams.get('stage')?.split(',').filter(Boolean) as TicketStage[] | undefined;
    const initialPriorities = searchParams.get('priority')?.split(',').filter(Boolean) as TicketPriority[] | undefined;
    const initialTypes = searchParams.get('type')?.split(',').filter(Boolean) as TicketType[] | undefined;

    const [query, setQuery] = useState(initialQuery);
    const [stages, setStages] = useState<TicketStage[]>(initialStages ?? []);
    const [priorities, setPriorities] = useState<TicketPriority[]>(initialPriorities ?? []);
    const [types, setTypes] = useState<TicketType[]>(initialTypes ?? []);

    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [isLoading, setIsLoading] = useState(false);

    // Perform search
    const performSearch = useCallback(async () => {
        setIsLoading(true);
        try {
            const response = await fetchTickets({
                stage: stages[0],
                type: types[0],
                priority: priorities[0],
                limit: 50,
            });

            // Client-side text filter
            let filtered = response.data;
            if (query.trim()) {
                const q = query.toLowerCase();
                filtered = filtered.filter(
                    (t) =>
                        t.ticket_id.toLowerCase().includes(q) ||
                        t.title.toLowerCase().includes(q) ||
                        (t.description?.toLowerCase().includes(q) ?? false),
                );
            }

            // Additional filters
            if (stages.length > 1) {
                filtered = filtered.filter((t) => stages.includes(t.stage));
            }
            if (priorities.length > 1) {
                filtered = filtered.filter((t) => priorities.includes(t.priority));
            }
            if (types.length > 1) {
                filtered = filtered.filter((t) => types.includes(t.type));
            }

            setTickets(filtered);
            setTotalCount(filtered.length);
        } catch {
            setTickets([]);
            setTotalCount(0);
        } finally {
            setIsLoading(false);
        }
    }, [query, stages, priorities, types]);

    // Auto-search on mount and filter changes
    useEffect(() => {
        performSearch();
    }, [performSearch]);

    // Update URL params
    useEffect(() => {
        const params = new URLSearchParams();
        if (query) params.set('q', query);
        if (stages.length) params.set('stage', stages.join(','));
        if (priorities.length) params.set('priority', priorities.join(','));
        if (types.length) params.set('type', types.join(','));
        const qs = params.toString();
        router.replace(`/search${qs ? `?${qs}` : ''}`, { scroll: false });
    }, [query, stages, priorities, types, router]);

    function toggleStage(s: TicketStage) {
        setStages((prev) =>
            prev.includes(s) ? prev.filter((v) => v !== s) : [...prev, s],
        );
    }

    function togglePriority(p: TicketPriority) {
        setPriorities((prev) =>
            prev.includes(p) ? prev.filter((v) => v !== p) : [...prev, p],
        );
    }

    function toggleType(t: TicketType) {
        setTypes((prev) =>
            prev.includes(t) ? prev.filter((v) => v !== t) : [...prev, t],
        );
    }

    const hasFilters = stages.length > 0 || priorities.length > 0 || types.length > 0;

    function clearAllFilters() {
        setStages([]);
        setPriorities([]);
        setTypes([]);
    }

    return (
        <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center gap-3 mb-6">
                <button
                    type="button"
                    onClick={() => router.back()}
                    className="p-2 rounded-md hover:bg-surface-alt text-muted md:hidden"
                    aria-label="Go back"
                >
                    <ArrowLeft size={18} />
                </button>
                <h1 className="text-xl font-bold text-foreground">Search</h1>
            </div>

            {/* Search input */}
            <div className="relative mb-4">
                <Search
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    aria-hidden="true"
                />
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search by ticket ID, title, or description..."
                    className="w-full h-11 pl-10 pr-10 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary"
                    aria-label="Search tickets"
                />
                {query && (
                    <button
                        type="button"
                        onClick={() => setQuery('')}
                        className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded text-muted hover:bg-surface-alt"
                        aria-label="Clear search"
                    >
                        <X size={14} />
                    </button>
                )}
            </div>

            {/* Filter chips */}
            <div className="space-y-2 mb-6">
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted uppercase tracking-wide">Stage</span>
                    {STAGE_OPTIONS.map((s) => (
                        <FilterChip
                            key={s}
                            label={s}
                            active={stages.includes(s)}
                            onClick={() => toggleStage(s)}
                        />
                    ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted uppercase tracking-wide">Priority</span>
                    {PRIORITY_OPTIONS.map((p) => (
                        <FilterChip
                            key={p}
                            label={p}
                            active={priorities.includes(p)}
                            onClick={() => togglePriority(p)}
                        />
                    ))}
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted uppercase tracking-wide">Type</span>
                    {TYPE_OPTIONS.map((t) => (
                        <FilterChip
                            key={t}
                            label={t}
                            active={types.includes(t)}
                            onClick={() => toggleType(t)}
                        />
                    ))}
                </div>
                {hasFilters && (
                    <button
                        type="button"
                        onClick={clearAllFilters}
                        className="text-xs text-primary hover:underline"
                    >
                        Clear all filters
                    </button>
                )}
            </div>

            {/* Results */}
            <SearchResults
                tickets={tickets}
                query={query}
                isLoading={isLoading}
                totalCount={totalCount}
            />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Page export with Suspense                                          */
/* ------------------------------------------------------------------ */

/**
 * Full-page search view.
 *
 * Wraps {@link SearchPageInner} in a `Suspense` boundary because
 * `useSearchParams()` requires it under the Next.js App Router.
 * Renders a skeleton placeholder while the inner component loads.
 */
export default function SearchPage() {
    return (
        <Suspense
            fallback={
                <div className="max-w-4xl mx-auto animate-pulse space-y-4">
                    <div className="h-8 w-32 bg-surface-alt rounded" />
                    <div className="h-11 w-full bg-surface-alt rounded-lg" />
                    <div className="h-6 w-full bg-surface-alt rounded" />
                    <div className="space-y-3">
                        {Array.from({ length: 3 }).map((_, i) => (
                            <div key={i} className="h-24 bg-surface-alt rounded-lg" />
                        ))}
                    </div>
                </div>
            }
        >
            <SearchPageInner />
        </Suspense>
    );
}
