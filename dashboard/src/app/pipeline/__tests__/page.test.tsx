import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PipelinePage from '@/app/pipeline/page';

// Mock fetchTickets
const mockFetchTickets = jest.fn();
jest.mock('@/lib/api', () => ({
    fetchTickets: (...args: unknown[]) => mockFetchTickets(...args),
}));

// Mock PipelineBoard to isolate page logic
jest.mock('@/components/pipeline/PipelineBoard', () => ({
    PipelineBoard: ({
        tickets,
        isLoading,
    }: {
        tickets: unknown[];
        isLoading: boolean;
    }) => (
        <div
            data-testid="pipeline-board"
            data-loading={isLoading}
            data-count={tickets.length}
        />
    ),
}));

// Mock lucide-react icon
jest.mock('lucide-react', () => ({
    RefreshCw: (props: Record<string, unknown>) => (
        <span data-testid="refresh-icon" {...props} />
    ),
}));

const MOCK_TICKETS = [
    {
        ticket_id: 'T-001',
        title: 'Test',
        type: 'backend',
        priority: 'high',
        stage: 'READY',
    },
    {
        ticket_id: 'T-002',
        title: 'Test 2',
        type: 'frontend',
        priority: 'medium',
        stage: 'QA',
    },
];

beforeEach(() => {
    mockFetchTickets.mockReset();
});

describe('PipelinePage', () => {
    it('fetches tickets on page load', async () => {
        mockFetchTickets.mockResolvedValue({ data: MOCK_TICKETS });
        render(<PipelinePage />);
        await waitFor(() => {
            expect(mockFetchTickets).toHaveBeenCalledTimes(1);
        });
        expect(mockFetchTickets).toHaveBeenCalledWith({ limit: 500 });
    });

    it('passes tickets to PipelineBoard after load', async () => {
        mockFetchTickets.mockResolvedValue({ data: MOCK_TICKETS });
        render(<PipelinePage />);
        await waitFor(() => {
            const board = screen.getByTestId('pipeline-board');
            expect(board).toHaveAttribute(
                'data-count',
                String(MOCK_TICKETS.length),
            );
        });
    });

    it('shows loading state initially', () => {
        mockFetchTickets.mockReturnValue(new Promise(() => {})); // never resolves
        render(<PipelinePage />);
        const board = screen.getByTestId('pipeline-board');
        expect(board).toHaveAttribute('data-loading', 'true');
    });

    it('clears loading after fetch completes', async () => {
        mockFetchTickets.mockResolvedValue({ data: [] });
        render(<PipelinePage />);
        await waitFor(() => {
            const board = screen.getByTestId('pipeline-board');
            expect(board).toHaveAttribute('data-loading', 'false');
        });
    });

    it('renders refresh button', () => {
        mockFetchTickets.mockResolvedValue({ data: [] });
        render(<PipelinePage />);
        expect(
            screen.getByRole('button', { name: /refresh/i }),
        ).toBeInTheDocument();
    });

    it('fetches again on manual refresh click', async () => {
        const user = userEvent.setup();
        mockFetchTickets.mockResolvedValue({ data: [] });
        render(<PipelinePage />);
        await waitFor(() => {
            expect(mockFetchTickets).toHaveBeenCalledTimes(1);
        });

        const refreshBtn = screen.getByRole('button', {
            name: /refresh/i,
        });
        await user.click(refreshBtn);
        await waitFor(() => {
            expect(mockFetchTickets).toHaveBeenCalledTimes(2);
        });
    });

    it('shows error banner on fetch failure', async () => {
        mockFetchTickets.mockRejectedValue(
            new Error('Network error'),
        );
        render(<PipelinePage />);
        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('error banner has retry button', async () => {
        mockFetchTickets.mockRejectedValueOnce(
            new Error('Failed'),
        );
        render(<PipelinePage />);
        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        expect(screen.getByText('Retry')).toBeInTheDocument();
    });

    it('retry button re-fetches tickets', async () => {
        const user = userEvent.setup();
        mockFetchTickets
            .mockRejectedValueOnce(new Error('Failed'))
            .mockResolvedValueOnce({ data: MOCK_TICKETS });
        render(<PipelinePage />);
        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        await user.click(screen.getByText('Retry'));
        await waitFor(() => {
            expect(mockFetchTickets).toHaveBeenCalledTimes(2);
        });
    });

    it('renders Pipeline heading', () => {
        mockFetchTickets.mockResolvedValue({ data: [] });
        render(<PipelinePage />);
        expect(
            screen.getByRole('heading', { name: 'Pipeline' }),
        ).toBeInTheDocument();
    });
});
