'use client';

import Link from 'next/link';
import type { DependencyStatus, TicketDetail } from '@/lib/api';

/** Props for the {@link DependencyTree} component. */
interface DependencyTreeProps {
    /** Full ticket detail including dependency status and depends_on. */
    ticket: TicketDetail;
}

function StatusDot({ resolved }: { resolved: boolean }) {
    return (
        <span
            className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${resolved ? 'bg-success' : 'bg-warning'
                }`}
            aria-label={resolved ? 'Resolved' : 'Unresolved'}
        />
    );
}

function DependencyLink({
    dep,
}: {
    dep: DependencyStatus;
}) {
    return (
        <li className="flex items-center gap-3 bg-surface-alt rounded-lg px-3 py-2 border border-border hover:border-primary transition-colors">
            <StatusDot resolved={dep.is_resolved} />
            <Link
                href={`/tickets/${encodeURIComponent(dep.ticket_id)}`}
                className="flex-1 min-w-0 group"
            >
                <span className="text-sm font-mono text-primary group-hover:underline">
                    {dep.ticket_id}
                </span>
                {dep.title && (
                    <span className="text-sm text-muted ml-2 truncate">
                        — {dep.title}
                    </span>
                )}
            </Link>
            <span
                className={`text-xs px-1.5 py-0.5 rounded font-medium ${dep.is_resolved
                    ? 'bg-success-muted text-success'
                    : 'bg-warning-muted text-warning'
                    }`}
            >
                {dep.status}
            </span>
        </li>
    );
}

function SimpleLink({ ticketId }: { ticketId: string }) {
    return (
        <li className="flex items-center gap-3 bg-surface-alt rounded-lg px-3 py-2 border border-border hover:border-primary transition-colors">
            <span className="inline-block w-2 h-2 rounded-full bg-muted flex-shrink-0" />
            <Link
                href={`/tickets/${encodeURIComponent(ticketId)}`}
                className="text-sm font-mono text-primary hover:underline"
            >
                {ticketId}
            </Link>
        </li>
    );
}

/**
 * Two-section dependency view for a ticket.
 *
 * Shows upstream dependencies (tickets this ticket depends on) with
 * resolved/unresolved status dots and downstream dependents as
 * clickable links to their detail pages.
 */
export function DependencyTree({ ticket }: DependencyTreeProps) {
    const upstream = ticket.dependency_status;
    const downstream = ticket.depends_on.length > 0
        ? ticket.depends_on
        : [];

    const hasUpstream = upstream.length > 0;
    const hasDownstream = downstream.length > 0;

    if (!hasUpstream && !hasDownstream) {
        return (
            <p className="text-sm text-muted py-4">
                No dependencies for this ticket.
            </p>
        );
    }

    return (
        <div className="space-y-6">
            {/* Upstream: tickets this ticket depends on */}
            <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <svg
                        className="w-4 h-4 text-muted"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
                    </svg>
                    Upstream Dependencies
                    <span className="text-xs text-muted font-normal">
                        (depends on)
                    </span>
                </h3>
                {hasUpstream ? (
                    <ul className="space-y-2" aria-label="Upstream dependencies">
                        {upstream.map((dep) => (
                            <DependencyLink key={dep.ticket_id} dep={dep} />
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-muted">None</p>
                )}
            </div>

            {/* Downstream: tickets listed in depends_on that depend on this */}
            <div>
                <h3 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                    <svg
                        className="w-4 h-4 text-muted"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                    >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                    </svg>
                    Downstream Dependents
                    <span className="text-xs text-muted font-normal">
                        (depended by)
                    </span>
                </h3>
                {hasDownstream ? (
                    <ul className="space-y-2" aria-label="Downstream dependents">
                        {downstream.map((id) => (
                            <SimpleLink key={id} ticketId={id} />
                        ))}
                    </ul>
                ) : (
                    <p className="text-xs text-muted">None</p>
                )}
            </div>
        </div>
    );
}
