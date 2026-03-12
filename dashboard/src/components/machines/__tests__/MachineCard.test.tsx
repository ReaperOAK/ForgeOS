import { render, screen } from '@testing-library/react';
import { MachineCard, type MachineCardProps } from '@/components/machines/MachineCard';

// Mock AgentList to isolate MachineCard tests
jest.mock('@/components/machines/AgentList', () => ({
    AgentList: ({ agents }: { agents: { agentName: string }[] }) => (
        <ul data-testid="agent-list">
            {agents.map((a) => (
                <li key={a.agentName}>{a.agentName}</li>
            ))}
        </ul>
    ),
}));

const now = new Date();
const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000).toISOString();
const twentyMinutesAgo = new Date(now.getTime() - 20 * 60 * 1000).toISOString();
const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString();

const baseProps: MachineCardProps = {
    hostname: 'pop-os',
    status: 'online',
    lastHeartbeat: fiveMinutesAgo,
    agents: [
        {
            agentName: 'Backend',
            ticketId: 'FORGEOS-BE001',
            stage: 'BACKEND',
            claimedAt: '2026-03-12T01:00:00Z',
        },
    ],
};

describe('MachineCard', () => {
    // --- AC1: Machine cards display hostname, status indicator, and last heartbeat time ---

    it('renders hostname', () => {
        render(<MachineCard {...baseProps} />);
        expect(screen.getByText('pop-os')).toBeInTheDocument();
    });

    it('renders "Online" label for online status', () => {
        render(<MachineCard {...baseProps} />);
        expect(screen.getByText('Online')).toBeInTheDocument();
    });

    it('renders "Offline" label for offline status', () => {
        render(<MachineCard {...baseProps} status="offline" />);
        expect(screen.getByText('Offline')).toBeInTheDocument();
    });

    it('renders green status indicator for online', () => {
        render(<MachineCard {...baseProps} />);
        const article = screen.getByRole('article');
        const dot = article.querySelector('[aria-hidden="true"]');
        expect(dot).toHaveClass('bg-success');
    });

    it('renders gray status indicator for offline', () => {
        render(<MachineCard {...baseProps} status="offline" />);
        const article = screen.getByRole('article');
        const dot = article.querySelector('[aria-hidden="true"]');
        expect(dot).toHaveClass('bg-secondary');
    });

    it('renders last heartbeat as relative time', () => {
        render(<MachineCard {...baseProps} lastHeartbeat={fiveMinutesAgo} />);
        expect(screen.getByText(/Last heartbeat:.*5 minutes ago/)).toBeInTheDocument();
    });

    // --- Relative time formatting ---

    it('shows "just now" for very recent heartbeat', () => {
        const justNow = new Date().toISOString();
        render(<MachineCard {...baseProps} lastHeartbeat={justNow} />);
        expect(screen.getByText(/just now/)).toBeInTheDocument();
    });

    it('shows hours for older heartbeat', () => {
        render(<MachineCard {...baseProps} lastHeartbeat={twoHoursAgo} />);
        expect(screen.getByText(/2 hours ago/)).toBeInTheDocument();
    });

    it('shows days for much older heartbeat', () => {
        render(<MachineCard {...baseProps} lastHeartbeat={twoDaysAgo} />);
        expect(screen.getByText(/2 days ago/)).toBeInTheDocument();
    });

    it('shows "1 minute ago" for exactly 1 minute', () => {
        const oneMinAgo = new Date(now.getTime() - 60_000).toISOString();
        render(<MachineCard {...baseProps} lastHeartbeat={oneMinAgo} />);
        expect(screen.getByText(/1 minute ago/)).toBeInTheDocument();
    });

    // --- Agent count ---

    it('renders agent count in section header', () => {
        render(<MachineCard {...baseProps} />);
        expect(screen.getByText('Running Agents (1)')).toBeInTheDocument();
    });

    it('shows count 0 when no agents', () => {
        render(<MachineCard {...baseProps} agents={[]} />);
        expect(screen.getByText('Running Agents (0)')).toBeInTheDocument();
    });

    // --- Accessibility ---

    it('has role="article" with aria-label containing hostname and status', () => {
        render(<MachineCard {...baseProps} />);
        const article = screen.getByRole('article');
        expect(article).toHaveAttribute('aria-label', 'pop-os: online');
    });

    it('marks status dot as aria-hidden', () => {
        render(<MachineCard {...baseProps} />);
        const article = screen.getByRole('article');
        const dot = article.querySelector('.rounded-full');
        expect(dot).toHaveAttribute('aria-hidden', 'true');
    });

    // --- Machine color ---

    it('applies machineColor as border-top style', () => {
        render(<MachineCard {...baseProps} machineColor="#3B82F6" />);
        const article = screen.getByRole('article');
        expect(article).toHaveStyle({
            borderTopColor: '#3B82F6',
            borderTopWidth: '2px',
        });
    });

    it('does not apply border-top style when machineColor is not provided', () => {
        render(<MachineCard {...baseProps} />);
        const article = screen.getByRole('article');
        expect(article).not.toHaveStyle({ borderTopWidth: '2px' });
    });

    // --- Renders AgentList child ---

    it('passes agents to AgentList', () => {
        render(<MachineCard {...baseProps} />);
        expect(screen.getByTestId('agent-list')).toBeInTheDocument();
        expect(screen.getByText('Backend')).toBeInTheDocument();
    });
});
