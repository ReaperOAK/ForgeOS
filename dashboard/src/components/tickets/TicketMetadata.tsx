'use client';

import type { TicketDetail } from '@/lib/api';

/** Props for the {@link TicketMetadata} component. */
interface TicketMetadataProps {
    /** Full ticket detail object returned by the API. */
    ticket: TicketDetail;
}

const priorityColors: Record<string, string> = {
    critical: 'bg-error text-inverse',
    high: 'bg-warning text-inverse',
    medium: 'bg-info text-inverse',
    low: 'bg-surface-alt text-muted',
};

const statusColors: Record<string, string> = {
    READY: 'bg-primary text-inverse',
    BLOCKED: 'bg-error-muted text-error',
    CLAIMED: 'bg-warning-muted text-warning',
    IN_PROGRESS: 'bg-info-muted text-info',
    DONE: 'bg-success-muted text-success',
    FAILED: 'bg-error-muted text-error',
    ESCALATED: 'bg-error text-inverse',
};

function formatTimestamp(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
}

function Badge({ label, className }: { label: string; className: string }) {
    return (
        <span
            className={`inline-block px-2 py-0.5 rounded text-xs font-semibold uppercase ${className}`}
        >
            {label}
        </span>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="flex flex-col gap-1">
            <dt className="text-xs font-medium text-muted uppercase tracking-wide">
                {label}
            </dt>
            <dd className="text-sm text-foreground">{children}</dd>
        </div>
    );
}

/**
 * Metadata panel displaying all ticket fields.
 *
 * Renders the ticket header (ID, title, priority/status badges),
 * description, an 8-field metadata grid, acceptance criteria checklist,
 * file paths list, and tags.
 */
export function TicketMetadata({ ticket }: TicketMetadataProps) {
    return (
        <section
            aria-label="Ticket metadata"
            className="bg-surface border border-border rounded-lg p-6 space-y-6"
        >
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                    <p className="text-xs font-mono text-muted">{ticket.ticket_id}</p>
                    <h1 className="text-xl font-bold text-foreground mt-1">
                        {ticket.title}
                    </h1>
                </div>
                <div className="flex items-center gap-2">
                    <Badge
                        label={ticket.priority}
                        className={priorityColors[ticket.priority] || 'bg-surface-alt text-muted'}
                    />
                    <Badge
                        label={ticket.status}
                        className={statusColors[ticket.status] || 'bg-surface-alt text-muted'}
                    />
                </div>
            </div>

            {/* Description */}
            {ticket.description && (
                <p className="text-sm text-muted leading-relaxed">
                    {ticket.description}
                </p>
            )}

            {/* Metadata grid */}
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Field label="Type">
                    <span className="capitalize">{ticket.type}</span>
                </Field>
                <Field label="Stage">
                    <span className="font-mono text-primary">{ticket.stage}</span>
                </Field>
                <Field label="Claimed By">
                    {ticket.claimed_by_name || ticket.claimed_by || '—'}
                </Field>
                <Field label="Machine">
                    {ticket.machine_id || '—'}
                </Field>
                <Field label="Operator">
                    {ticket.operator || '—'}
                </Field>
                <Field label="Lease Expiry">
                    {formatTimestamp(ticket.lease_expiry)}
                </Field>
                <Field label="Rework Count">
                    <span>
                        {ticket.rework_count} / {ticket.max_reworks}
                    </span>
                </Field>
                <Field label="Created">
                    {formatTimestamp(ticket.created_at)}
                </Field>
            </dl>

            {/* Acceptance Criteria */}
            {ticket.acceptance_criteria.length > 0 && (
                <div>
                    <h2 className="text-sm font-semibold text-foreground mb-2">
                        Acceptance Criteria
                    </h2>
                    <ul className="space-y-1.5" role="list" aria-label="Acceptance criteria checklist">
                        {ticket.acceptance_criteria.map((criterion, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-muted">
                                <span
                                    className="mt-0.5 w-4 h-4 flex-shrink-0 rounded border border-border flex items-center justify-center"
                                    aria-hidden="true"
                                >
                                    <svg
                                        className="w-2.5 h-2.5 text-muted"
                                        fill="none"
                                        viewBox="0 0 24 24"
                                        stroke="currentColor"
                                        strokeWidth={3}
                                    >
                                        <circle cx="12" cy="12" r="4" fill="currentColor" />
                                    </svg>
                                </span>
                                <span>{criterion}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* File Paths */}
            {ticket.file_paths.length > 0 && (
                <div>
                    <h2 className="text-sm font-semibold text-foreground mb-2">
                        File Paths
                    </h2>
                    <ul className="space-y-1" role="list" aria-label="File paths">
                        {ticket.file_paths.map((path) => (
                            <li
                                key={path}
                                className="text-sm font-mono text-primary bg-surface-alt rounded px-2 py-1"
                            >
                                {path}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {/* Tags */}
            {ticket.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                    {ticket.tags.map((tag) => (
                        <span
                            key={tag}
                            className="text-xs bg-surface-alt text-muted rounded-full px-2.5 py-0.5 border border-border"
                        >
                            {tag}
                        </span>
                    ))}
                </div>
            )}
        </section>
    );
}
