'use client';

import { AgentList, type AgentInfo } from './AgentList';

export interface MachineCardProps {
    hostname: string;
    status: 'online' | 'offline';
    lastHeartbeat: string;
    agents: AgentInfo[];
    machineColor?: string;
}

function formatRelativeTime(isoTimestamp: string): string {
    const now = Date.now();
    const then = new Date(isoTimestamp).getTime();
    const diffMs = now - then;

    if (Number.isNaN(diffMs) || diffMs < 0) return 'just now';

    const minutes = Math.floor(diffMs / 60_000);
    if (minutes < 1) return 'just now';
    if (minutes === 1) return '1 minute ago';
    if (minutes < 60) return `${minutes} minutes ago`;

    const hours = Math.floor(minutes / 60);
    if (hours === 1) return '1 hour ago';
    if (hours < 24) return `${hours} hours ago`;

    const days = Math.floor(hours / 24);
    if (days === 1) return '1 day ago';
    return `${days} days ago`;
}

/**
 * Individual machine status card displaying hostname, online/offline
 * status, last heartbeat, and list of running agents.
 */
export function MachineCard({
    hostname,
    status,
    lastHeartbeat,
    agents,
    machineColor,
}: MachineCardProps) {
    const isOnline = status === 'online';

    return (
        <div
            className="bg-surface border border-border rounded-lg p-4"
            role="article"
            aria-label={`${hostname}: ${status}`}
            style={machineColor ? { borderTopColor: machineColor, borderTopWidth: '2px' } : undefined}
        >
            {/* Header: hostname + status */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span
                        className={`w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-success' : 'bg-secondary'}`}
                        aria-hidden="true"
                    />
                    <h3 className="text-lg font-semibold text-foreground">
                        {hostname}
                    </h3>
                </div>
                <span
                    className={`text-xs font-medium ${isOnline ? 'text-success' : 'text-muted'}`}
                >
                    {isOnline ? 'Online' : 'Offline'}
                </span>
            </div>

            {/* Heartbeat timestamp */}
            <p className="text-xs text-muted mt-1">
                Last heartbeat: {formatRelativeTime(lastHeartbeat)}
            </p>

            {/* Divider */}
            <div className="border-t border-border my-3" />

            {/* Agent section */}
            <div>
                <p className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                    Running Agents ({agents.length})
                </p>
                <AgentList agents={agents} />
            </div>
        </div>
    );
}
