'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Monitor, RefreshCw, WifiOff } from 'lucide-react';
import { MachineCard } from '@/components/machines/MachineCard';
import type { AgentInfo } from '@/components/machines/AgentList';
import { apiClient } from '@/lib/api-client';
import { TicketWebSocketClient } from '@/lib/api/websocket';
import type { WebSocketEvent, ConnectionStatus } from '@/lib/api/websocket';
import type { Ticket } from '@/lib/api/types';

/** 10 minutes in milliseconds — threshold for online/offline status. */
const HEARTBEAT_THRESHOLD_MS = 10 * 60 * 1000;

/** Refresh interval for re-computing relative times (30s). */
const RELATIVE_TIME_REFRESH_MS = 30_000;

interface MachineData {
    hostname: string;
    lastHeartbeat: string;
    agents: AgentInfo[];
}

/**
 * Derive machine status from heartbeat recency.
 * Online if heartbeat is within the last 10 minutes.
 */
function getMachineStatus(lastHeartbeat: string): 'online' | 'offline' {
    const age = Date.now() - new Date(lastHeartbeat).getTime();
    return age <= HEARTBEAT_THRESHOLD_MS ? 'online' : 'offline';
}

/** Machine color palette from design tokens (dark theme). */
const MACHINE_COLORS = [
    '#3B82F6', '#8B5CF6', '#16A34A', '#F97316',
    '#EC4899', '#06B6D4', '#EAB308', '#14B8A6',
];

/**
 * Aggregate claimed tickets into a map of machines and their running agents.
 */
function aggregateMachines(tickets: Ticket[]): Map<string, MachineData> {
    const machines = new Map<string, MachineData>();

    for (const ticket of tickets) {
        if (!ticket.machine_id || !ticket.claimed_by_name) continue;

        const hostname = ticket.machine_id;
        const existing = machines.get(hostname);

        const heartbeat = ticket.lease_expiry
            ? new Date(
                new Date(ticket.lease_expiry).getTime() -
                ticket.lease_duration_minutes * 60_000
            ).toISOString()
            : ticket.updated_at;

        const agentInfo: AgentInfo = {
            agentName: ticket.claimed_by_name,
            ticketId: ticket.ticket_id,
            stage: ticket.stage,
            claimedAt: ticket.updated_at,
        };

        if (existing) {
            existing.agents.push(agentInfo);
            if (new Date(heartbeat) > new Date(existing.lastHeartbeat)) {
                existing.lastHeartbeat = heartbeat;
            }
        } else {
            machines.set(hostname, {
                hostname,
                lastHeartbeat: heartbeat,
                agents: [agentInfo],
            });
        }
    }

    return machines;
}

function SkeletonCard() {
    return (
        <div
            className="bg-surface border border-border rounded-lg p-4 animate-pulse"
            role="status"
            aria-label="Loading machine card"
        >
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-surface-alt" />
                    <div className="h-5 w-24 bg-surface-alt rounded" />
                </div>
                <div className="h-4 w-12 bg-surface-alt rounded" />
            </div>
            <div className="h-3 w-40 bg-surface-alt rounded mt-2" />
            <div className="border-t border-border my-3" />
            <div className="h-3 w-28 bg-surface-alt rounded mb-2" />
            <div className="space-y-2">
                <div className="h-4 w-full bg-surface-alt rounded" />
                <div className="h-4 w-3/4 bg-surface-alt rounded" />
            </div>
        </div>
    );
}

function EmptyState() {
    return (
        <div
            className="flex flex-col items-center justify-center py-16 text-center"
            role="status"
            aria-label="No machines currently active"
        >
            <WifiOff
                size={48}
                className="text-muted mb-4"
                aria-hidden="true"
            />
            <h2 className="text-lg font-semibold text-foreground mb-2">
                No machines currently active
            </h2>
            <p className="text-sm text-muted max-w-md">
                When operators start working on tickets, their machines will
                appear here with live status and agent information.
            </p>
        </div>
    );
}

export default function MachinesPage() {
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [, setTick] = useState(0);
    const wsRef = useRef<TicketWebSocketClient | null>(null);

    const fetchData = useCallback(async () => {
        try {
            setError(null);
            const response = await apiClient.get<Ticket[]>(
                '/api/tickets?status=CLAIMED&status=IN_PROGRESS&limit=200',
            );
            setTickets(response.data ?? []);
        } catch (err) {
            setError(
                err instanceof Error ? err.message : 'Failed to fetch machine data',
            );
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // WebSocket for real-time updates
    useEffect(() => {
        const client = new TicketWebSocketClient({
            onEvent: (event: WebSocketEvent) => {
                if (event.type === 'TICKET_STATE_CHANGE' || event.type === 'TICKET_UPDATED') {
                    setTickets((prev) => {
                        const ticket = event.ticket;
                        const isActive =
                            ticket.status === 'CLAIMED' || ticket.status === 'IN_PROGRESS';

                        if (isActive) {
                            const idx = prev.findIndex((t) => t.ticket_id === ticket.ticket_id);
                            if (idx >= 0) {
                                const next = [...prev];
                                next[idx] = ticket;
                                return next;
                            }
                            return [...prev, ticket];
                        } else {
                            return prev.filter((t) => t.ticket_id !== ticket.ticket_id);
                        }
                    });
                } else if (event.type === 'TICKET_CREATED') {
                    const ticket = event.ticket;
                    if (ticket.status === 'CLAIMED' || ticket.status === 'IN_PROGRESS') {
                        setTickets((prev) => [...prev, ticket]);
                    }
                }
            },
        });

        client.connect();
        wsRef.current = client;

        return () => {
            client.disconnect();
            wsRef.current = null;
        };
    }, []);

    // Periodic tick to refresh relative timestamps and re-evaluate online/offline
    useEffect(() => {
        const interval = setInterval(() => {
            setTick((t) => t + 1);
        }, RELATIVE_TIME_REFRESH_MS);
        return () => clearInterval(interval);
    }, []);

    const machines = useMemo(() => aggregateMachines(tickets), [tickets]);

    const machineEntries = useMemo(() => {
        const entries = Array.from(machines.values());
        // Sort: online first, then by hostname
        return entries.sort((a, b) => {
            const aOnline = getMachineStatus(a.lastHeartbeat) === 'online' ? 0 : 1;
            const bOnline = getMachineStatus(b.lastHeartbeat) === 'online' ? 0 : 1;
            if (aOnline !== bOnline) return aOnline - bOnline;
            return a.hostname.localeCompare(b.hostname);
        });
    }, [machines]);

    const onlineCount = useMemo(
        () =>
            machineEntries.filter(
                (m) => getMachineStatus(m.lastHeartbeat) === 'online',
            ).length,
        [machineEntries],
    );

    if (isLoading) {
        return (
            <div className="p-4 md:p-6">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-foreground">Machines</h1>
                    <p className="text-sm text-muted mt-1">Loading...</p>
                </div>
                <div
                    className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6"
                    aria-busy="true"
                    aria-label="Loading machines"
                >
                    <SkeletonCard />
                    <SkeletonCard />
                    <SkeletonCard />
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-4 md:p-6">
                <div className="mb-6">
                    <h1 className="text-2xl font-bold text-foreground">Machines</h1>
                </div>
                <div
                    className="bg-error-muted border border-error rounded-lg p-6 text-center"
                    role="alert"
                >
                    <p className="text-sm text-error mb-3">{error}</p>
                    <button
                        onClick={() => {
                            setIsLoading(true);
                            fetchData();
                        }}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-primary hover:text-primary-hover rounded-md border border-border bg-surface focus-ring"
                    >
                        <RefreshCw size={14} aria-hidden="true" />
                        Retry
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="p-4 md:p-6">
            {/* Page header */}
            <div className="mb-6">
                <div className="flex items-center gap-2">
                    <Monitor size={24} className="text-primary" aria-hidden="true" />
                    <h1 className="text-2xl font-bold text-foreground">Machines</h1>
                </div>
                <p className="text-sm text-muted mt-1">
                    {machineEntries.length > 0
                        ? `${onlineCount} machine${onlineCount !== 1 ? 's' : ''} online`
                        : 'No active machines'}
                </p>
            </div>

            {/* Machine grid or empty state */}
            {machineEntries.length === 0 ? (
                <EmptyState />
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                    {machineEntries.map((machine, index) => (
                        <MachineCard
                            key={machine.hostname}
                            hostname={machine.hostname}
                            status={getMachineStatus(machine.lastHeartbeat)}
                            lastHeartbeat={machine.lastHeartbeat}
                            agents={machine.agents}
                            machineColor={MACHINE_COLORS[index % MACHINE_COLORS.length]}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
