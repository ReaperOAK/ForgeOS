'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Search, X, Loader2 } from 'lucide-react';
import type { Ticket, TicketStage, TicketType, TicketPriority } from '@/lib/api';
import { fetchTickets } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Active search filter selections for stage, priority, and type. */
export interface SearchFilters {
    /** Filter by one or more SDLC stages. */
    stages?: TicketStage[];
    /** Filter by one or more priority levels. */
    priorities?: TicketPriority[];
    /** Filter by one or more ticket types. */
    types?: TicketType[];
}

/** A single typeahead result produced by matching tickets against the query. */
export interface SearchResult {
    /** Ticket identifier (e.g. `"FORGEOS-FE003"`). */
    ticketId: string;
    /** Human-readable ticket title. */
    title: string;
    /** Current SDLC stage. */
    stage: TicketStage;
    /** Ticket priority level. */
    priority: TicketPriority;
    /** Ticket type category. */
    type: TicketType;
    /** Which field the query matched against. */
    matchField: 'id' | 'title';
    /** Character ranges within `matchField` that matched the query. */
    matchRanges: Array<{ start: number; end: number }>;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const RECENT_KEY = 'forgeos-recent-searches';
const MAX_RECENT = 5;
const DEBOUNCE_MS = 300;
const MAX_TYPEAHEAD = 10;

const STAGE_OPTIONS: TicketStage[] = [
    'READY', 'ARCHITECT', 'BACKEND', 'FRONTEND', 'QA',
    'SECURITY', 'CI', 'DOCUMENTATION', 'DONE',
];

const PRIORITY_OPTIONS: TicketPriority[] = ['critical', 'high', 'medium', 'low'];
const TYPE_OPTIONS: TicketType[] = ['backend', 'frontend', 'fullstack', 'infra', 'security', 'docs'];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function loadRecentSearches(): string[] {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        if (!raw) return [];
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENT);
    } catch {
        return [];
    }
}

function saveRecentSearch(term: string) {
    if (typeof window === 'undefined') return;
    try {
        const existing = loadRecentSearches();
        const updated = [term, ...existing.filter((s) => s !== term)].slice(0, MAX_RECENT);
        localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
    } catch {
        // localStorage unavailable
    }
}

function removeRecentSearch(term: string) {
    if (typeof window === 'undefined') return;
    try {
        const existing = loadRecentSearches();
        localStorage.setItem(RECENT_KEY, JSON.stringify(existing.filter((s) => s !== term)));
    } catch {
        // localStorage unavailable
    }
}

function findMatchRanges(text: string, query: string): Array<{ start: number; end: number }> {
    const ranges: Array<{ start: number; end: number }> = [];
    const lower = text.toLowerCase();
    const q = query.toLowerCase();
    let idx = 0;
    while (idx < lower.length) {
        const found = lower.indexOf(q, idx);
        if (found === -1) break;
        ranges.push({ start: found, end: found + q.length });
        idx = found + 1;
    }
    return ranges;
}

function ticketsToResults(tickets: Ticket[], query: string): SearchResult[] {
    return tickets.slice(0, MAX_TYPEAHEAD).map((t) => {
        const idMatch = t.ticket_id.toLowerCase().includes(query.toLowerCase());
        const titleMatch = t.title.toLowerCase().includes(query.toLowerCase());
        const matchField: 'id' | 'title' = idMatch ? 'id' : 'title';
        const matchText = matchField === 'id' ? t.ticket_id : t.title;
        return {
            ticketId: t.ticket_id,
            title: t.title,
            stage: t.stage,
            priority: t.priority,
            type: t.type,
            matchField,
            matchRanges: findMatchRanges(matchText, query),
        };
    });
}

/* ------------------------------------------------------------------ */
/*  Highlight component                                                */
/* ------------------------------------------------------------------ */

function HighlightedText({
    text,
    ranges,
}: {
    text: string;
    ranges: Array<{ start: number; end: number }>;
}) {
    if (ranges.length === 0) return <>{text}</>;

    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const { start, end } of ranges) {
        if (start > cursor) parts.push(text.slice(cursor, start));
        parts.push(
            <mark
                key={start}
                className="bg-warning/30 text-foreground rounded-sm px-0.5"
            >
                {text.slice(start, end)}
            </mark>,
        );
        cursor = end;
    }
    if (cursor < text.length) parts.push(text.slice(cursor));
    return <>{parts}</>;
}

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
/*  FilterChipGroup                                                    */
/* ------------------------------------------------------------------ */

function FilterChipGroup<T extends string>({
    title,
    options,
    selected,
    onToggle,
}: {
    title: string;
    options: T[];
    selected: T[];
    onToggle: (value: T) => void;
}) {
    return (
        <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted uppercase tracking-wide mr-1">{title}</span>
            {options.map((opt) => (
                <FilterChip
                    key={opt}
                    label={opt}
                    active={selected.includes(opt)}
                    onClick={() => onToggle(opt)}
                />
            ))}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/*  Priority / Stage badges                                            */
/* ------------------------------------------------------------------ */

const priorityColors: Record<TicketPriority, string> = {
    critical: 'bg-error text-inverse',
    high: 'bg-warning text-inverse',
    medium: 'bg-info text-inverse',
    low: 'bg-surface-alt text-muted',
};

const stageColors: Record<string, string> = {
    READY: 'text-primary',
    BACKEND: 'text-info',
    FRONTEND: 'text-success',
    QA: 'text-warning',
    SECURITY: 'text-error',
    DONE: 'text-success',
};

/* ------------------------------------------------------------------ */
/*  SearchBar Component                                                */
/* ------------------------------------------------------------------ */

/**
 * Global combobox-style search bar.
 *
 * Opens with `Cmd/Ctrl + K`, debounces API queries by 300 ms, and renders
 * a typeahead dropdown with highlighted matches and filter chips.  Recent
 * searches are persisted in `localStorage`.
 */
export function SearchBar() {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const [query, setQuery] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [results, setResults] = useState<SearchResult[]>([]);
    const [highlightedIdx, setHighlightedIdx] = useState(-1);
    const [recentSearches, setRecentSearches] = useState<string[]>([]);
    const [filters, setFilters] = useState<SearchFilters>({});
    const [showFilters, setShowFilters] = useState(false);

    // Load recent searches on mount
    useEffect(() => {
        setRecentSearches(loadRecentSearches());
    }, []);

    // Global Cmd/Ctrl+K shortcut
    useEffect(() => {
        function handleKeyDown(e: KeyboardEvent) {
            if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
                e.preventDefault();
                inputRef.current?.focus();
                setIsOpen(true);
            }
        }
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Close dropdown on outside click
    useEffect(() => {
        function handleClick(e: MouseEvent) {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(e.target as Node)
            ) {
                setIsOpen(false);
            }
        }
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    // Debounced search
    useEffect(() => {
        if (query.length < 2) {
            setResults([]);
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        const timer = setTimeout(async () => {
            try {
                const response = await fetchTickets({
                    stage: filters.stages?.[0],
                    type: filters.types?.[0],
                    priority: filters.priorities?.[0],
                    limit: MAX_TYPEAHEAD,
                });
                // Client-side filter by query since API may not support text search
                const filtered = response.data.filter(
                    (t) =>
                        t.ticket_id.toLowerCase().includes(query.toLowerCase()) ||
                        t.title.toLowerCase().includes(query.toLowerCase()),
                );
                setResults(ticketsToResults(filtered, query));
            } catch {
                setResults([]);
            } finally {
                setIsLoading(false);
            }
        }, DEBOUNCE_MS);

        return () => clearTimeout(timer);
    }, [query, filters]);

    const handleSelect = useCallback(
        (ticketId: string) => {
            saveRecentSearch(query);
            setRecentSearches(loadRecentSearches());
            setIsOpen(false);
            setQuery('');
            router.push(`/tickets/${encodeURIComponent(ticketId)}`);
        },
        [query, router],
    );

    const handleSubmit = useCallback(() => {
        if (query.trim()) {
            saveRecentSearch(query.trim());
            setRecentSearches(loadRecentSearches());
            setIsOpen(false);
            const params = new URLSearchParams({ q: query.trim() });
            if (filters.stages?.length) params.set('stage', filters.stages.join(','));
            if (filters.priorities?.length) params.set('priority', filters.priorities.join(','));
            if (filters.types?.length) params.set('type', filters.types.join(','));
            router.push(`/search?${params.toString()}`);
        }
    }, [query, filters, router]);

    const handleClear = useCallback(() => {
        setQuery('');
        setResults([]);
        setIsOpen(false);
        inputRef.current?.focus();
    }, []);

    const handleRemoveRecent = useCallback((term: string) => {
        removeRecentSearch(term);
        setRecentSearches(loadRecentSearches());
    }, []);

    function toggleFilter<T extends string>(
        key: 'stages' | 'priorities' | 'types',
        value: T,
    ) {
        setFilters((prev) => {
            const current = (prev[key] ?? []) as T[];
            const updated = current.includes(value)
                ? current.filter((v) => v !== value)
                : [...current, value];
            return { ...prev, [key]: updated.length ? updated : undefined };
        });
    }

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === 'ArrowDown') {
                e.preventDefault();
                setHighlightedIdx((prev) =>
                    prev < results.length - 1 ? prev + 1 : 0,
                );
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setHighlightedIdx((prev) =>
                    prev > 0 ? prev - 1 : results.length - 1,
                );
            } else if (e.key === 'Enter') {
                e.preventDefault();
                if (highlightedIdx >= 0 && results[highlightedIdx]) {
                    handleSelect(results[highlightedIdx].ticketId);
                } else {
                    handleSubmit();
                }
            } else if (e.key === 'Escape') {
                setIsOpen(false);
                inputRef.current?.blur();
            }
        },
        [results, highlightedIdx, handleSelect, handleSubmit],
    );

    const showDropdown =
        isOpen && (query.length >= 2 || recentSearches.length > 0);
    const listboxId = 'search-results-listbox';

    return (
        <div ref={dropdownRef} className="relative w-full max-w-md sm:max-w-lg">
            {/* Search input */}
            <div className="relative">
                <Search
                    size={16}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                    aria-hidden="true"
                />
                <input
                    ref={inputRef}
                    type="text"
                    role="combobox"
                    aria-expanded={showDropdown}
                    aria-controls={listboxId}
                    aria-activedescendant={
                        highlightedIdx >= 0
                            ? `search-result-${highlightedIdx}`
                            : undefined
                    }
                    aria-label="Search tickets by ID or title"
                    aria-busy={isLoading}
                    placeholder="Search tickets... (⌘K)"
                    value={query}
                    onChange={(e) => {
                        setQuery(e.target.value);
                        setIsOpen(true);
                        setHighlightedIdx(-1);
                    }}
                    onFocus={() => setIsOpen(true)}
                    onKeyDown={handleKeyDown}
                    className="w-full h-10 pl-9 pr-20 rounded-lg bg-surface border border-border text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary transition-colors"
                />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                    {isLoading && (
                        <Loader2 size={14} className="animate-spin text-muted" aria-hidden="true" />
                    )}
                    {query && (
                        <button
                            type="button"
                            onClick={handleClear}
                            className="p-1 rounded hover:bg-surface-alt text-muted"
                            aria-label="Clear search"
                        >
                            <X size={14} />
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={() => setShowFilters((p) => !p)}
                        className={`px-1.5 py-0.5 rounded text-xs font-mono border ${
                            showFilters
                                ? 'border-primary text-primary'
                                : 'border-border text-muted'
                        }`}
                        aria-label="Toggle search filters"
                    >
                        Filters
                    </button>
                </div>
            </div>

            {/* Filter chips */}
            {showFilters && (
                <div className="mt-2 p-3 bg-surface border border-border rounded-lg space-y-2">
                    <FilterChipGroup
                        title="Stage"
                        options={STAGE_OPTIONS}
                        selected={filters.stages ?? []}
                        onToggle={(v) => toggleFilter('stages', v)}
                    />
                    <FilterChipGroup
                        title="Priority"
                        options={PRIORITY_OPTIONS}
                        selected={filters.priorities ?? []}
                        onToggle={(v) => toggleFilter('priorities', v)}
                    />
                    <FilterChipGroup
                        title="Type"
                        options={TYPE_OPTIONS}
                        selected={filters.types ?? []}
                        onToggle={(v) => toggleFilter('types', v)}
                    />
                </div>
            )}

            {/* Dropdown */}
            {showDropdown && (
                <div
                    className="absolute top-full left-0 right-0 mt-1 bg-surface border border-border rounded-lg shadow-lg overflow-hidden z-dropdown"
                    role="listbox"
                    id={listboxId}
                    aria-label="Search results"
                >
                    {/* Recent searches (shown when no query) */}
                    {query.length < 2 && recentSearches.length > 0 && (
                        <div className="p-2">
                            <p className="px-2 py-1 text-xs text-muted uppercase tracking-wide">
                                Recent Searches
                            </p>
                            {recentSearches.map((term) => (
                                <div
                                    key={term}
                                    className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-surface-alt cursor-pointer group"
                                >
                                    <button
                                        type="button"
                                        className="text-sm text-foreground truncate text-left flex-1"
                                        onClick={() => {
                                            setQuery(term);
                                            setIsOpen(true);
                                        }}
                                    >
                                        {term}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => handleRemoveRecent(term)}
                                        className="p-1 rounded text-muted opacity-0 group-hover:opacity-100 hover:bg-error/20"
                                        aria-label={`Remove "${term}" from recent searches`}
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Loading state */}
                    {query.length >= 2 && isLoading && (
                        <div className="p-4 flex items-center justify-center gap-2 text-muted text-sm">
                            <Loader2 size={16} className="animate-spin" />
                            Searching...
                        </div>
                    )}

                    {/* Results */}
                    {query.length >= 2 && !isLoading && results.length > 0 && (
                        <>
                            <div aria-live="polite" className="sr-only">
                                {results.length} results found
                            </div>
                            {results.map((result, idx) => (
                                <button
                                    key={result.ticketId}
                                    id={`search-result-${idx}`}
                                    role="option"
                                    aria-selected={idx === highlightedIdx}
                                    type="button"
                                    className={`w-full text-left px-3 py-2.5 border-b border-border/50 last:border-0 transition-colors ${
                                        idx === highlightedIdx
                                            ? 'bg-primary/10'
                                            : 'hover:bg-surface-alt'
                                    }`}
                                    onClick={() => handleSelect(result.ticketId)}
                                    onMouseEnter={() => setHighlightedIdx(idx)}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-primary">
                                            {result.matchField === 'id' ? (
                                                <HighlightedText
                                                    text={result.ticketId}
                                                    ranges={result.matchRanges}
                                                />
                                            ) : (
                                                result.ticketId
                                            )}
                                        </span>
                                        <span className="text-sm text-foreground truncate">
                                            {result.matchField === 'title' ? (
                                                <HighlightedText
                                                    text={result.title}
                                                    ranges={result.matchRanges}
                                                />
                                            ) : (
                                                result.title
                                            )}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <span
                                            className={`text-xs font-medium ${stageColors[result.stage] ?? 'text-muted'}`}
                                        >
                                            {result.stage}
                                        </span>
                                        <span className="text-muted">·</span>
                                        <span
                                            className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${priorityColors[result.priority]}`}
                                        >
                                            {result.priority}
                                        </span>
                                        <span className="text-muted">·</span>
                                        <span className="text-xs text-muted capitalize">
                                            {result.type}
                                        </span>
                                    </div>
                                </button>
                            ))}
                            <button
                                type="button"
                                className="w-full px-3 py-2 text-xs text-primary hover:bg-surface-alt text-center"
                                onClick={handleSubmit}
                            >
                                View all results →
                            </button>
                        </>
                    )}

                    {/* Empty state */}
                    {query.length >= 2 && !isLoading && results.length === 0 && (
                        <div className="p-6 text-center">
                            <Search
                                size={32}
                                className="mx-auto mb-2 text-muted/50"
                                aria-hidden="true"
                            />
                            <p className="text-sm text-muted">
                                No tickets match &ldquo;{query}&rdquo;
                            </p>
                            <p className="text-xs text-muted/70 mt-1">
                                Try a different search term or adjust your filters
                            </p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
