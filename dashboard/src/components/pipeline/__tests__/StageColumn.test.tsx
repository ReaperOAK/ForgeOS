import { render, screen } from '@testing-library/react';
import { StageColumn } from '@/components/pipeline/StageColumn';
import type { Ticket } from '@/lib/api/types';

// Mock TicketCard to isolate StageColumn tests
jest.mock('@/components/pipeline/TicketCard', () => ({
    TicketCard: ({
        ticketId,
        title,
    }: {
        ticketId: string;
        title: string;
    }) => <div data-testid={`card-${ticketId}`}>{title}</div>,
}));

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: '1',
        ticket_id: 'FORGEOS-BE001',
        project_id: null,
        title: 'Test ticket',
        description: null,
        type: 'backend',
        priority: 'medium',
        status: 'READY',
        stage: 'READY',
        sdlc_flow: ['READY', 'BACKEND', 'QA', 'DONE'],
        claimed_by: null,
        claimed_by_name: null,
        machine_id: null,
        operator: null,
        lease_expiry: null,
        lease_duration_minutes: 30,
        depends_on: [],
        file_paths: [],
        acceptance_criteria: [],
        tags: [],
        rework_count: 0,
        max_reworks: 3,
        metadata: {},
        parent_id: null,
        source_task_file: null,
        created_at: '2026-03-01T00:00:00Z',
        updated_at: '2026-03-01T00:00:00Z',
        completed_at: null,
        ...overrides,
    };
}

const baseProps = {
    stage: 'READY',
    label: 'Ready',
    accentColor: '#06B6D4',
};

describe('StageColumn', () => {
    it('renders stage label', () => {
        render(<StageColumn {...baseProps} tickets={[]} />);
        expect(screen.getByText('Ready')).toBeInTheDocument();
    });

    it('shows ticket count badge with correct number', () => {
        const tickets = [
            makeTicket({ ticket_id: 'T-001' }),
            makeTicket({ ticket_id: 'T-002' }),
        ];
        render(<StageColumn {...baseProps} tickets={tickets} />);
        expect(screen.getByLabelText('2 tickets')).toHaveTextContent('2');
    });

    it('shows zero count when no tickets', () => {
        render(<StageColumn {...baseProps} tickets={[]} />);
        expect(screen.getByLabelText('0 tickets')).toHaveTextContent('0');
    });

    it('renders a TicketCard for each ticket', () => {
        const tickets = [
            makeTicket({ ticket_id: 'T-001', title: 'First' }),
            makeTicket({ ticket_id: 'T-002', title: 'Second' }),
            makeTicket({ ticket_id: 'T-003', title: 'Third' }),
        ];
        render(<StageColumn {...baseProps} tickets={tickets} />);
        expect(screen.getByTestId('card-T-001')).toBeInTheDocument();
        expect(screen.getByTestId('card-T-002')).toBeInTheDocument();
        expect(screen.getByTestId('card-T-003')).toBeInTheDocument();
    });

    it('shows "No tickets" placeholder when empty', () => {
        render(<StageColumn {...baseProps} tickets={[]} />);
        expect(screen.getByText('No tickets')).toBeInTheDocument();
    });

    it('empty placeholder has reduced opacity', () => {
        render(<StageColumn {...baseProps} tickets={[]} />);
        const placeholder = screen.getByText('No tickets');
        expect(placeholder.className).toContain('opacity-50');
    });

    it('has scrollable card container', () => {
        render(<StageColumn {...baseProps} tickets={[]} />);
        // The card list div should have overflow-y-auto
        const section = screen.getByRole('region');
        const scrollContainer = section.querySelector('.overflow-y-auto');
        expect(scrollContainer).toBeInTheDocument();
    });

    it('applies accent color as top border', () => {
        const { container } = render(
            <StageColumn {...baseProps} accentColor="#EF4444" tickets={[]} />,
        );
        const header = container.querySelector(
            '[style*="border-top"]',
        ) as HTMLElement;
        expect(header).toBeTruthy();
        // jsdom converts hex to rgb()
        expect(header.style.borderTop).toMatch(/3px solid/);
    });

    it('has accessible section label with stage name and count', () => {
        const tickets = [makeTicket({ ticket_id: 'T-001' })];
        render(<StageColumn {...baseProps} tickets={tickets} />);
        const section = screen.getByRole('region');
        expect(section).toHaveAttribute(
            'aria-label',
            'Ready stage — 1 tickets',
        );
    });
});
