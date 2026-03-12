import { render, screen } from '@testing-library/react';
import { AgentList, type AgentInfo } from '@/components/machines/AgentList';

// Mock next/link
jest.mock('next/link', () => {
    return function MockLink({
        href,
        children,
        ...props
    }: {
        href: string;
        children: React.ReactNode;
        [key: string]: unknown;
    }) {
        return (
            <a href={href} {...props}>
                {children}
            </a>
        );
    };
});

const sampleAgents: AgentInfo[] = [
    {
        agentName: 'Backend',
        ticketId: 'FORGEOS-BE001',
        stage: 'BACKEND',
        claimedAt: '2026-03-12T01:00:00Z',
    },
    {
        agentName: 'QA Engineer',
        ticketId: 'FORGEOS-QA003',
        stage: 'QA',
        claimedAt: '2026-03-12T01:10:00Z',
    },
];

describe('AgentList', () => {
    // --- AC2: Each machine card shows a list of currently running agents with their claimed tickets ---

    it('renders agent names and ticket IDs', () => {
        render(<AgentList agents={sampleAgents} />);
        expect(screen.getByText('Backend')).toBeInTheDocument();
        expect(screen.getByText('FORGEOS-BE001')).toBeInTheDocument();
        expect(screen.getByText('QA Engineer')).toBeInTheDocument();
        expect(screen.getByText('FORGEOS-QA003')).toBeInTheDocument();
    });

    it('renders as an unordered list with correct number of items', () => {
        render(<AgentList agents={sampleAgents} />);
        const items = screen.getAllByRole('listitem');
        expect(items).toHaveLength(2);
    });

    // --- AC5: Clicking an agent name navigates to the claims view filtered by that agent ---

    it('links agent names to claims view with correct query param', () => {
        render(<AgentList agents={sampleAgents} />);
        const backendLink = screen.getByRole('link', {
            name: /Backend working on FORGEOS-BE001/i,
        });
        expect(backendLink).toHaveAttribute('href', '/claims?agent=Backend');

        const qaLink = screen.getByRole('link', {
            name: /QA Engineer working on FORGEOS-QA003/i,
        });
        expect(qaLink).toHaveAttribute(
            'href',
            '/claims?agent=QA%20Engineer',
        );
    });

    it('encodes agent names with special characters in URL', () => {
        const agents: AgentInfo[] = [
            {
                agentName: 'CI/CD Runner',
                ticketId: 'FORGEOS-CI001',
                stage: 'CI',
                claimedAt: '2026-03-12T01:00:00Z',
            },
        ];
        render(<AgentList agents={agents} />);
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute(
            'href',
            '/claims?agent=CI%2FCD%20Runner',
        );
    });

    // --- Accessibility ---

    it('provides aria-label on each agent link', () => {
        render(<AgentList agents={sampleAgents} />);
        const links = screen.getAllByRole('link');
        expect(links[0]).toHaveAttribute(
            'aria-label',
            'Backend working on FORGEOS-BE001',
        );
        expect(links[1]).toHaveAttribute(
            'aria-label',
            'QA Engineer working on FORGEOS-QA003',
        );
    });

    // --- AC7 (partial): Empty state when no agents ---

    it('renders "No active agents" when agents array is empty', () => {
        render(<AgentList agents={[]} />);
        expect(screen.getByText('No active agents')).toBeInTheDocument();
    });

    it('does not render a list when agents array is empty', () => {
        render(<AgentList agents={[]} />);
        expect(screen.queryByRole('list')).not.toBeInTheDocument();
    });
});
