'use client';

import Link from 'next/link';

export interface AgentInfo {
    agentName: string;
    ticketId: string;
    stage: string;
    claimedAt: string;
}

export interface AgentListProps {
    agents: AgentInfo[];
}

/**
 * List of agents currently running on a machine, with clickable agent
 * names linking to the claims view filtered by that agent.
 */
export function AgentList({ agents }: AgentListProps) {
    if (agents.length === 0) {
        return (
            <p className="text-sm text-muted italic">No active agents</p>
        );
    }

    return (
        <ul className="space-y-0">
            {agents.map((agent) => (
                <li
                    key={`${agent.agentName}-${agent.ticketId}`}
                    className="flex items-center justify-between py-3 md:py-1.5"
                >
                    <Link
                        href={`/claims?agent=${encodeURIComponent(agent.agentName)}`}
                        className="text-sm font-medium text-primary hover:text-primary-hover hover:underline focus-ring rounded px-1 -mx-1"
                        aria-label={`${agent.agentName} working on ${agent.ticketId}`}
                    >
                        {agent.agentName}
                    </Link>
                    <span className="text-xs font-mono text-muted">
                        {agent.ticketId}
                    </span>
                </li>
            ))}
        </ul>
    );
}
