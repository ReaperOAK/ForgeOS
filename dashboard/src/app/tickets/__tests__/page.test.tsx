import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TicketDetailPage from '@/app/tickets/[id]/page';
import type { TicketDetail } from '@/lib/api';

// Mock next/navigation
const mockNotFound = jest.fn();
jest.mock('next/navigation', () => ({
    useParams: () => ({ id: 'FORGEOS-FE004' }),
    notFound: (...args: unknown[]) => mockNotFound(...args),
}));

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

// Mock lucide-react
jest.mock('lucide-react', () => ({
    ArrowLeft: ({ size, ...props }: { size?: number;[key: string]: unknown }) => (
        <svg data-testid="arrow-left" {...props} />
    ),
}));

// Mock API
jest.mock('@/lib/api', () => ({
    fetchTicket: jest.fn(),
    isApiError: jest.fn((err: unknown) => {
        return (
            typeof err === 'object' &&
            err !== null &&
            'message' in err &&
            'status' in err
        );
    }),
}));

// Mock child components to isolate page logic
jest.mock('@/components/tickets/TicketMetadata', () => ({
    TicketMetadata: ({ ticket }: { ticket: TicketDetail }) => (
        <div data-testid="ticket-metadata">{ticket.title}</div>
    ),
}));

jest.mock('@/components/tickets/HistoryTimeline', () => ({
    HistoryTimeline: ({ ticketId }: { ticketId: string }) => (
        <div data-testid="history-timeline">{ticketId}</div>
    ),
}));

jest.mock('@/components/tickets/DependencyTree', () => ({
    DependencyTree: ({ ticket }: { ticket: TicketDetail }) => (
        <div data-testid="dependency-tree">{ticket.ticket_id}</div>
    ),
}));

const { fetchTicket } = jest.requireMock('@/lib/api') as {
    fetchTicket: jest.Mock;
};

const mockTicket: TicketDetail = {
    id: 'uuid-1',
    ticket_id: 'FORGEOS-FE004',
    project_id: null,
    title: 'Implement Ticket Detail View',
    description: 'Desc',
    type: 'frontend',
    priority: 'critical',
    status: 'CLAIMED',
    stage: 'QA',
    sdlc_flow: ['READY', 'FRONTEND', 'QA', 'DONE'],
    claimed_by: 'agent-1',
    claimed_by_name: 'FrontendEngineer',
    machine_id: 'pop-os',
    operator: 'reaperoak',
    lease_expiry: '2026-03-11T15:30:00Z',
    lease_duration_minutes: 30,
    depends_on: ['FORGEOS-FE002'],
    file_paths: ['page.tsx'],
    acceptance_criteria: ['AC1'],
    tags: [],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-05T18:00:00Z',
    updated_at: '2026-03-11T14:00:00Z',
    completed_at: null,
    dependency_status: [],
};

describe('TicketDetailPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading skeleton while fetching', () => {
        fetchTicket.mockReturnValue(new Promise(() => { })); // never resolves
        render(<TicketDetailPage />);
        expect(screen.getByRole('status', { name: /Loading ticket/ })).toBeInTheDocument();
    });

    it('fetches ticket by ID from URL params', async () => {
        fetchTicket.mockResolvedValue(mockTicket);
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(fetchTicket).toHaveBeenCalledWith('FORGEOS-FE004');
        });
    });

    it('renders TicketMetadata after successful fetch', async () => {
        fetchTicket.mockResolvedValue(mockTicket);
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(screen.getByTestId('ticket-metadata')).toBeInTheDocument();
        });
        expect(screen.getByTestId('ticket-metadata')).toHaveTextContent('Implement Ticket Detail View');
    });

    it('renders back link to pipeline', async () => {
        fetchTicket.mockResolvedValue(mockTicket);
        render(<TicketDetailPage />);

        await waitFor(() => {
            const link = screen.getByRole('link', { name: /Back to Pipeline/ });
            expect(link).toHaveAttribute('href', '/pipeline');
        });
    });

    it('renders tablist with History and Dependencies tabs', async () => {
        fetchTicket.mockResolvedValue(mockTicket);
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('tablist', { name: /Ticket details/ })).toBeInTheDocument();
        });
        expect(screen.getByRole('tab', { name: 'History' })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: 'Dependencies' })).toBeInTheDocument();
    });

    it('shows History tab as active by default', async () => {
        fetchTicket.mockResolvedValue(mockTicket);
        render(<TicketDetailPage />);

        await waitFor(() => {
            const historyTab = screen.getByRole('tab', { name: 'History' });
            expect(historyTab).toHaveAttribute('aria-selected', 'true');
        });
        expect(screen.getByTestId('history-timeline')).toBeInTheDocument();
    });

    it('switches to Dependencies tab on click', async () => {
        fetchTicket.mockResolvedValue(mockTicket);
        const user = userEvent.setup();
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('tab', { name: 'Dependencies' })).toBeInTheDocument();
        });

        await user.click(screen.getByRole('tab', { name: 'Dependencies' }));

        expect(screen.getByRole('tab', { name: 'Dependencies' })).toHaveAttribute('aria-selected', 'true');
        expect(screen.getByTestId('dependency-tree')).toBeInTheDocument();
    });

    it('calls notFound() on 404 error', async () => {
        fetchTicket.mockRejectedValue({ message: 'Not Found', status: 404 });
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(mockNotFound).toHaveBeenCalled();
        });
    });

    it('shows error message on non-404 API error', async () => {
        fetchTicket.mockRejectedValue({ message: 'Server Error', status: 500 });
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        expect(screen.getByText('Server Error')).toBeInTheDocument();
    });

    it('shows generic error for non-API errors', async () => {
        fetchTicket.mockRejectedValue(new Error('network'));
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(screen.getByText('Failed to load ticket')).toBeInTheDocument();
        });
    });

    it('shows retry button on error', async () => {
        fetchTicket.mockRejectedValue({ message: 'Server Error', status: 500 });
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(screen.getByText('Retry')).toBeInTheDocument();
        });
    });

    it('renders tabpanel with correct id', async () => {
        fetchTicket.mockResolvedValue(mockTicket);
        render(<TicketDetailPage />);

        await waitFor(() => {
            expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'panel-history');
        });
    });
});
