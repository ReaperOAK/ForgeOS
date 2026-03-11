'use client';

import type { Ticket } from '@/lib/api/types';
import { TicketCard } from './TicketCard';

export interface StageColumnProps {
    stage: string;
    label: string;
    accentColor: string;
    tickets: Ticket[];
}

export function StageColumn({
    stage,
    label,
    accentColor,
    tickets,
}: StageColumnProps) {
    return (
        <section
            aria-label={`${label} stage — ${tickets.length} tickets`}
            className="flex flex-col min-w-[200px] max-w-[280px] flex-1 bg-background rounded-lg border border-border overflow-hidden"
        >
            {/* Header with accent top border */}
            <div
                className="px-3 py-2 border-b border-border flex items-center justify-between"
                style={{ borderTop: `3px solid ${accentColor}` }}
            >
                <h3 className="text-xs font-semibold uppercase tracking-wider text-secondary">
                    {label}
                </h3>
                <span
                    className="text-[10px] font-bold min-w-[20px] h-5 flex items-center justify-center rounded-full bg-primary text-inverse px-1.5"
                    aria-label={`${tickets.length} tickets`}
                >
                    {tickets.length}
                </span>
            </div>

            {/* Scrollable card list */}
            <div className="flex-1 overflow-y-auto p-2 space-y-2 min-h-[120px] max-h-[calc(100vh-240px)]">
                {tickets.length === 0 ? (
                    <p className="text-xs text-muted text-center py-8 opacity-50">
                        No tickets
                    </p>
                ) : (
                    tickets.map((ticket) => (
                        <TicketCard
                            key={ticket.ticket_id}
                            ticketId={ticket.ticket_id}
                            title={ticket.title}
                            type={ticket.type}
                            priority={ticket.priority}
                            claimedBy={ticket.claimed_by_name ?? ticket.claimed_by}
                            machineId={ticket.machine_id}
                            reworkCount={ticket.rework_count}
                        />
                    ))
                )}
            </div>
        </section>
    );
}
