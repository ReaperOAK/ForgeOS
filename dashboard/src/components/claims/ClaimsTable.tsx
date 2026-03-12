'use client';

import { useMemo } from 'react';
import { ArrowUp, ArrowDown, Inbox } from 'lucide-react';
import { LeaseCountdown } from './LeaseCountdown';

export interface ClaimRow {
    ticketId: string;
    ticketTitle: string;
    agent: string;
    machine: string;
    operator: string;
    leaseExpiry: string;
    stage: string;
    claimedAt: string;
}

export type SortField = 'ticket' | 'agent' | 'machine' | 'operator' | 'stage' | 'leaseRemaining';
export type SortDirection = 'asc' | 'desc';

export interface ClaimsTableProps {
    claims: ClaimRow[];
    sortField: SortField;
    sortDirection: SortDirection;
    onSort: (field: SortField) => void;
    isLoading?: boolean;
}

function getLeaseRemaining(expiresAt: string): number {
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

type RowState = 'normal' | 'warning' | 'critical' | 'expired';

function getRowState(expiresAt: string): RowState {
    const remaining = getLeaseRemaining(expiresAt);
    if (remaining <= 0) return 'expired';
    if (remaining <= 60) return 'critical';
    if (remaining <= 300) return 'warning';
    return 'normal';
}

const ROW_STATE_CLASSES: Record<RowState, string> = {
    normal: 'border-l-2 border-transparent',
    warning: 'border-l-2 border-warning bg-warning-muted/30',
    critical: 'border-l-2 border-error bg-error-muted/30',
    expired: 'border-l-2 border-error bg-error-muted/20 opacity-80',
};

const COLUMNS: { field: SortField; label: string; className: string }[] = [
    { field: 'ticket', label: 'Ticket', className: 'w-[160px]' },
    { field: 'agent', label: 'Agent', className: 'w-[120px]' },
    { field: 'machine', label: 'Machine', className: 'w-[120px] hidden md:table-cell' },
    { field: 'operator', label: 'Operator', className: 'w-[120px] hidden lg:table-cell' },
    { field: 'stage', label: 'Stage', className: 'w-[100px]' },
    { field: 'leaseRemaining', label: 'Lease Remaining', className: 'w-[140px]' },
];

function SortIcon({ field, sortField, sortDirection }: {
    field: SortField;
    sortField: SortField;
    sortDirection: SortDirection;
}) {
    if (field !== sortField) return null;
    return sortDirection === 'asc'
        ? <ArrowUp size={12} aria-hidden="true" className="inline ml-1" />
        : <ArrowDown size={12} aria-hidden="true" className="inline ml-1" />;
}

function getAriaSort(
    field: SortField,
    sortField: SortField,
    sortDirection: SortDirection,
): 'ascending' | 'descending' | 'none' {
    if (field !== sortField) return 'none';
    return sortDirection === 'asc' ? 'ascending' : 'descending';
}

function SkeletonRows() {
    return (
        <>
            {Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border">
                    {COLUMNS.map((col) => (
                        <td key={col.field} className={`px-3 py-3 ${col.className}`}>
                            <div className="animate-pulse bg-surface-alt rounded h-4 w-3/4" />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

function EmptyState() {
    return (
        <tr>
            <td colSpan={COLUMNS.length} className="py-16 text-center">
                <div className="flex flex-col items-center gap-2">
                    <Inbox size={40} className="text-muted" aria-hidden="true" />
                    <p className="text-foreground font-medium">No active claims</p>
                    <p className="text-muted text-sm">
                        When agents claim tickets, they will appear here with live lease countdowns.
                    </p>
                </div>
            </td>
        </tr>
    );
}

/** Mobile card layout for a single claim row. */
function ClaimCard({ claim }: { claim: ClaimRow }) {
    const rowState = getRowState(claim.leaseExpiry);

    return (
        <div
            className={`bg-surface border border-border rounded-lg p-4 ${ROW_STATE_CLASSES[rowState]}`}
        >
            <div className="flex items-start justify-between mb-2">
                <div>
                    <span className="font-mono text-primary text-sm">{claim.ticketId}</span>
                    <p className="text-xs text-muted mt-0.5 line-clamp-1">{claim.ticketTitle}</p>
                </div>
                <LeaseCountdown expiresAt={claim.leaseExpiry} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-3 text-sm">
                <div>
                    <span className="text-muted text-xs">Agent</span>
                    <p>{claim.agent}</p>
                </div>
                <div>
                    <span className="text-muted text-xs">Stage</span>
                    <p>
                        <span className="text-xs font-semibold uppercase bg-surface-alt px-2 py-0.5 rounded">
                            {claim.stage}
                        </span>
                    </p>
                </div>
                <div>
                    <span className="text-muted text-xs">Machine</span>
                    <p className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full inline-block">
                        {claim.machine}
                    </p>
                </div>
                <div>
                    <span className="text-muted text-xs">Operator</span>
                    <p>{claim.operator}</p>
                </div>
            </div>
        </div>
    );
}

/**
 * Sortable data table displaying all active ticket claims with real-time
 * lease countdown timers. Shows cards on mobile, table on tablet/desktop.
 */
export function ClaimsTable({
    claims,
    sortField,
    sortDirection,
    onSort,
    isLoading = false,
}: ClaimsTableProps) {
    const sortedClaims = useMemo(() => {
        const sorted = [...claims];
        const dir = sortDirection === 'asc' ? 1 : -1;

        sorted.sort((a, b) => {
            switch (sortField) {
                case 'ticket':
                    return dir * a.ticketId.localeCompare(b.ticketId);
                case 'agent':
                    return dir * a.agent.localeCompare(b.agent);
                case 'machine':
                    return dir * a.machine.localeCompare(b.machine);
                case 'operator':
                    return dir * a.operator.localeCompare(b.operator);
                case 'stage':
                    return dir * a.stage.localeCompare(b.stage);
                case 'leaseRemaining':
                    return dir * (getLeaseRemaining(a.leaseExpiry) - getLeaseRemaining(b.leaseExpiry));
                default:
                    return 0;
            }
        });

        return sorted;
    }, [claims, sortField, sortDirection]);

    // Mobile card layout
    const mobileView = (
        <div className="md:hidden space-y-3" role="list" aria-label="Active claims">
            {isLoading ? (
                Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="bg-surface border border-border rounded-lg p-4 animate-pulse">
                        <div className="h-4 bg-surface-alt rounded w-1/3 mb-3" />
                        <div className="h-3 bg-surface-alt rounded w-2/3 mb-2" />
                        <div className="h-3 bg-surface-alt rounded w-1/2" />
                    </div>
                ))
            ) : sortedClaims.length === 0 ? (
                <div className="py-12 text-center">
                    <Inbox size={40} className="text-muted mx-auto mb-2" aria-hidden="true" />
                    <p className="text-foreground font-medium">No active claims</p>
                    <p className="text-muted text-sm">
                        When agents claim tickets, they will appear here with live lease countdowns.
                    </p>
                </div>
            ) : (
                sortedClaims.map((claim) => (
                    <ClaimCard key={claim.ticketId} claim={claim} />
                ))
            )}
        </div>
    );

    // Desktop/tablet table layout
    const tableView = (
        <div className="hidden md:block bg-surface border border-border rounded-lg overflow-hidden">
            <table
                role="table"
                aria-label="Active claims monitor"
                className="w-full"
            >
                <thead>
                    <tr className="border-b border-border">
                        {COLUMNS.map((col) => (
                            <th
                                key={col.field}
                                role="columnheader"
                                aria-sort={getAriaSort(col.field, sortField, sortDirection)}
                                className={`${col.className} text-left text-xs font-medium text-muted uppercase tracking-wide px-3 py-3 cursor-pointer hover:text-foreground select-none focus-ring ${col.field === sortField ? 'text-primary' : ''
                                    }`}
                                tabIndex={0}
                                onClick={() => onSort(col.field)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        onSort(col.field);
                                    }
                                }}
                            >
                                {col.label}
                                <SortIcon field={col.field} sortField={sortField} sortDirection={sortDirection} />
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {isLoading ? (
                        <SkeletonRows />
                    ) : sortedClaims.length === 0 ? (
                        <EmptyState />
                    ) : (
                        sortedClaims.map((claim, idx) => {
                            const rowState = getRowState(claim.leaseExpiry);
                            const stripeBg = idx % 2 === 0 ? '' : 'bg-surface-alt';

                            return (
                                <tr
                                    key={claim.ticketId}
                                    className={`border-b border-border transition-colors ${ROW_STATE_CLASSES[rowState]} ${rowState === 'normal' ? stripeBg : ''
                                        }`}
                                >
                                    <td className="px-3 py-3 w-[160px]">
                                        <span className="font-mono text-primary text-sm">{claim.ticketId}</span>
                                        <p className="text-xs text-muted mt-0.5 truncate max-w-[140px]">
                                            {claim.ticketTitle}
                                        </p>
                                    </td>
                                    <td className="px-3 py-3 w-[120px] text-sm">{claim.agent}</td>
                                    <td className="px-3 py-3 w-[120px] hidden md:table-cell">
                                        <span className="text-xs bg-accent/20 text-accent px-2 py-0.5 rounded-full">
                                            {claim.machine}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 w-[120px] text-sm hidden lg:table-cell">
                                        {claim.operator}
                                    </td>
                                    <td className="px-3 py-3 w-[100px]">
                                        <span className="text-xs font-semibold uppercase bg-surface-alt px-2 py-0.5 rounded">
                                            {claim.stage}
                                        </span>
                                    </td>
                                    <td className="px-3 py-3 w-[140px]">
                                        <LeaseCountdown expiresAt={claim.leaseExpiry} />
                                    </td>
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );

    return (
        <>
            {mobileView}
            {tableView}
        </>
    );
}
