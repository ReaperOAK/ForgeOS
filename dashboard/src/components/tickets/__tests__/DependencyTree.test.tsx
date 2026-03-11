import { render, screen, within } from '@testing-library/react';
import { DependencyTree } from '@/components/tickets/DependencyTree';
import type { TicketDetail } from '@/lib/api';

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

const baseTicket: TicketDetail = {
    id: 'uuid-1',
    ticket_id: 'FORGEOS-FE004',
    project_id: null,
    title: 'Implement Ticket Detail View',
    description: null,
    type: 'frontend',
    priority: 'critical',
    status: 'CLAIMED',
    stage: 'QA',
    sdlc_flow: ['READY', 'FRONTEND', 'QA', 'DONE'],
    claimed_by: null,
    claimed_by_name: null,
    machine_id: null,
    operator: null,
    lease_expiry: null,
    lease_duration_minutes: 30,
    depends_on: ['FORGEOS-FE002', 'FORGEOS-UID002'],
    file_paths: [],
    acceptance_criteria: [],
    tags: [],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-05T18:00:00Z',
    updated_at: '2026-03-11T14:00:00Z',
    completed_at: null,
    dependency_status: [
        { ticket_id: 'FORGEOS-FE002', title: 'Pipeline Board', status: 'DONE', is_resolved: true },
        { ticket_id: 'FORGEOS-UID002', title: 'UI Design', status: 'DONE', is_resolved: true },
    ],
};

describe('DependencyTree', () => {
    it('renders upstream dependencies section', () => {
        render(<DependencyTree ticket={baseTicket} />);
        expect(screen.getByText('Upstream Dependencies')).toBeInTheDocument();
    });

    it('renders downstream dependents section', () => {
        render(<DependencyTree ticket={baseTicket} />);
        expect(screen.getByText('Downstream Dependents')).toBeInTheDocument();
    });

    it('renders upstream dependency ticket IDs as clickable links', () => {
        render(<DependencyTree ticket={baseTicket} />);
        const upstreamList = screen.getByLabelText('Upstream dependencies');
        const links = within(upstreamList).getAllByRole('link');
        expect(links.length).toBe(2);

        const fe002Link = links.find((l) => l.textContent?.includes('FORGEOS-FE002'));
        expect(fe002Link).toHaveAttribute('href', '/tickets/FORGEOS-FE002');
    });

    it('renders upstream dependency titles', () => {
        render(<DependencyTree ticket={baseTicket} />);
        expect(screen.getByText(/Pipeline Board/)).toBeInTheDocument();
        expect(screen.getByText(/UI Design/)).toBeInTheDocument();
    });

    it('shows resolved status for upstream deps', () => {
        render(<DependencyTree ticket={baseTicket} />);
        const resolvedLabels = screen.getAllByLabelText('Resolved');
        expect(resolvedLabels.length).toBe(2);
    });

    it('shows unresolved status for pending deps', () => {
        const ticket: TicketDetail = {
            ...baseTicket,
            dependency_status: [
                { ticket_id: 'FORGEOS-FE002', title: 'Pipeline Board', status: 'BLOCKED', is_resolved: false },
            ],
        };
        render(<DependencyTree ticket={ticket} />);
        expect(screen.getByLabelText('Unresolved')).toBeInTheDocument();
    });

    it('renders downstream dependents as clickable links', () => {
        render(<DependencyTree ticket={baseTicket} />);
        const downstreamList = screen.getByLabelText('Downstream dependents');
        const links = within(downstreamList).getAllByRole('link');
        expect(links.length).toBe(2);

        const fe002Link = links.find((l) => l.textContent?.includes('FORGEOS-FE002'));
        expect(fe002Link).toHaveAttribute('href', '/tickets/FORGEOS-FE002');

        const uid002Link = links.find((l) => l.textContent?.includes('FORGEOS-UID002'));
        expect(uid002Link).toHaveAttribute('href', '/tickets/FORGEOS-UID002');
    });

    it('shows status badge text for upstream deps', () => {
        render(<DependencyTree ticket={baseTicket} />);
        const badges = screen.getAllByText('DONE');
        expect(badges.length).toBeGreaterThanOrEqual(2);
    });

    it('shows "No dependencies" when both lists are empty', () => {
        const ticket: TicketDetail = {
            ...baseTicket,
            depends_on: [],
            dependency_status: [],
        };
        render(<DependencyTree ticket={ticket} />);
        expect(screen.getByText('No dependencies for this ticket.')).toBeInTheDocument();
    });

    it('shows "None" for upstream when dependency_status is empty but downstream exists', () => {
        const ticket: TicketDetail = {
            ...baseTicket,
            dependency_status: [],
            depends_on: ['FORGEOS-FE001'],
        };
        render(<DependencyTree ticket={ticket} />);
        expect(screen.getByText('None')).toBeInTheDocument();
    });

    it('shows "None" for downstream when depends_on is empty but upstream exists', () => {
        const ticket: TicketDetail = {
            ...baseTicket,
            depends_on: [],
            dependency_status: [
                { ticket_id: 'FORGEOS-FE002', title: 'Board', status: 'DONE', is_resolved: true },
            ],
        };
        render(<DependencyTree ticket={ticket} />);
        expect(screen.getByText('None')).toBeInTheDocument();
    });

    it('encodes ticket IDs in link hrefs', () => {
        const ticket: TicketDetail = {
            ...baseTicket,
            depends_on: ['TICKET/SPECIAL'],
        };
        render(<DependencyTree ticket={ticket} />);
        const link = screen.getByRole('link', { name: 'TICKET/SPECIAL' });
        expect(link).toHaveAttribute('href', '/tickets/TICKET%2FSPECIAL');
    });
});
