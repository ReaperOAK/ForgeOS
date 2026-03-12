'use client';

import { useState, useCallback, useEffect } from 'react';
import { Clock } from 'lucide-react';
import { ConnectionStatusIndicator } from '@/components/ConnectionStatusIndicator';
import { ClaimsTable, type ClaimRow, type SortField, type SortDirection } from '@/components/claims/ClaimsTable';
import { useTicketStream } from '@/lib/hooks/useTicketStream';
import { fetchTickets } from '@/lib/api';
import type { Ticket } from '@/lib/api';

/**
 * Converts a Ticket into a ClaimRow for the claims table.
 * Returns null if the ticket has no active claim or no lease expiry.
 */
function ticketToClaimRow(ticket: Ticket): ClaimRow | null {
    if (!ticket.claimed_by && !ticket.claimed_by_name) return null;
    if (!ticket.lease_expiry) return null;

    return {
        ticketId: ticket.ticket_id,
        ticketTitle: ticket.title,
        agent: ticket.claimed_by_name ?? ticket.claimed_by ?? 'Unknown',
        machine: ticket.machine_id ?? 'unknown',
        operator: ticket.operator ?? 'unknown',
        leaseExpiry: ticket.lease_expiry,
        stage: ticket.stage,
        claimedAt: ticket.updated_at,
    };
}

/**
 * Active Claims Monitor page.
 *
 * Displays all currently claimed tickets in a sortable table with real-time
 * lease countdown timers. Data loads via REST on mount and stays current
 * through WebSocket events from the `useTicketStream` hook.
 */
export default function ClaimsPage() {
    const [claims, setClaims] = useState<Map<string, ClaimRow>>(new Map());
    const [sortField, setSortField] = useState<SortField>('leaseRemaining');
    const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
    const [isLoading, setIsLoading] = useState(true);

    // Load initial claims via REST
    useEffect(() => {
        let cancelled = false;

        async function loadClaims() {
            try {
                const result = await fetchTickets({ limit: 500 });
                if (cancelled) return;

                const claimsMap = new Map<string, ClaimRow>();
                for (const ticket of result.data) {
                    const row = ticketToClaimRow(ticket);
                    if (row) {
                        claimsMap.set(row.ticketId, row);
                    }
                }
                setClaims(claimsMap);
            } catch {
                // Silently handle — WebSocket will populate data
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        }

        loadClaims();
        return () => { cancelled = true; };
    }, []);

    // Handle real-time WebSocket updates
    const handleTicketUpdate = useCallback((ticket: Ticket) => {
        setClaims((prev) => {
            const next = new Map(prev);
            const row = ticketToClaimRow(ticket);

            if (row) {
                next.set(row.ticketId, row);
            } else {
                // Ticket is no longer claimed — remove from table
                next.delete(ticket.ticket_id);
            }

            return next;
        });
    }, []);

    const { status: wsStatus } = useTicketStream({
        onTicketUpdate: handleTicketUpdate,
    });

    const handleSort = useCallback((field: SortField) => {
        setSortField((prev) => {
            if (prev === field) {
                setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
                return prev;
            }
            setSortDirection('asc');
            return field;
        });
    }, []);

    const claimRows = Array.from(claims.values());

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Clock size={24} aria-hidden="true" />
                        Active Claims
                    </h1>
                    <p className="text-sm text-muted mt-1">
                        {isLoading
                            ? 'Loading claims…'
                            : `${claimRows.length} active claim${claimRows.length !== 1 ? 's' : ''}`}
                    </p>
                </div>
                <ConnectionStatusIndicator status={wsStatus} />
            </div>

            <ClaimsTable
                claims={claimRows}
                sortField={sortField}
                sortDirection={sortDirection}
                onSort={handleSort}
                isLoading={isLoading}
            />
        </div>
    );
}
