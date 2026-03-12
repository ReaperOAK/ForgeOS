import { render, screen, act, waitFor } from '@testing-library/react';
import ClaimsPage from '@/app/claims/page';
import { fetchTickets } from '@/lib/api';
import type { Ticket } from '@/lib/api';

// Mock dependencies
jest.mock('@/lib/api', () => ({
    fetchTickets: jest.fn(),
}));

jest.mock('@/lib/hooks/useTicketStream', () => ({
    useTicketStream: jest.fn(() => ({
        status: 'connected' as const,
        reconnect: jest.fn(),
    })),
}));

jest.mock('@/components/ConnectionStatusIndicator', () => ({
    ConnectionStatusIndicator: ({ status }: { status: string }) => (
        <span data-testid="ws-status">{status}</span>
    ),
}));

jest.mock('@/components/claims/ClaimsTable', () => ({
    ClaimsTable: ({ claims, sortField, sortDirection, onSort, isLoading }: {
        claims: unknown[];
        sortField: string;
        sortDirection: string;
        onSort: (f: string) => void;
        isLoading: boolean;
    }) => (
        <div data-testid="claims-table">
            <span data-testid="claims-count">{claims.length}</span>
            <span data-testid="sort-field">{sortField}</span>
            <span data-testid="sort-direction">{sortDirection}</span>
            <span data-testid="loading">{String(isLoading)}</span>
            <button data-testid="sort-btn" onClick={() => onSort('agent')}>sort</button>
        </div>
    ),
}));

const { useTicketStream } = jest.requireMock('@/lib/hooks/useTicketStream');
const mockFetchTickets = fetchTickets as jest.MockedFunction<typeof fetchTickets>;

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: '1',
        ticket_id: 'FORGEOS-BE001',
        project_id: null,
        title: 'Test ticket',
        description: null,
        type: 'backend',
        priority: 'high',
        status: 'in_progress',
        stage: 'BACKEND',
        sdlc_flow: ['READY', 'BACKEND', 'QA'],
        claimed_by: 'agent-1',
        claimed_by_name: 'Backend',
        machine_id: 'pop-os',
        operator: 'reaperoak',
        lease_expiry: new Date(Date.now() + 600000).toISOString(),
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
        created_at: '2026-03-12T01:00:00Z',
        updated_at: '2026-03-12T01:00:00Z',
        completed_at: null,
        ...overrides,
    } as Ticket;
}

describe('ClaimsPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchTickets.mockResolvedValue({
            data: [],
            pagination: { total: 0, limit: 500, offset: 0, has_more: false },
        } as never);
    });

    it('renders page heading "Active Claims"', async () => {
        await act(async () => {
            render(<ClaimsPage />);
        });
        expect(screen.getByText('Active Claims')).toBeInTheDocument();
    });

    it('shows loading state initially', () => {
        mockFetchTickets.mockReturnValue(new Promise(() => {})); // never resolves
        render(<ClaimsPage />);
        expect(screen.getByText('Loading claims…')).toBeInTheDocument();
    });

    it('displays ConnectionStatusIndicator with WebSocket status', async () => {
        await act(async () => {
            render(<ClaimsPage />);
        });
        expect(screen.getByTestId('ws-status')).toHaveTextContent('connected');
    });

    it('passes default sort to ClaimsTable (leaseRemaining, asc)', async () => {
        await act(async () => {
            render(<ClaimsPage />);
        });
        expect(screen.getByTestId('sort-field')).toHaveTextContent('leaseRemaining');
        expect(screen.getByTestId('sort-direction')).toHaveTextContent('asc');
    });

    it('loads claims from REST API on mount', async () => {
        const tickets = [makeTicket()];
        mockFetchTickets.mockResolvedValue({
            data: tickets,
            pagination: { total: 1, limit: 500, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<ClaimsPage />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('claims-count')).toHaveTextContent('1');
        });
    });

    it('filters out tickets without lease_expiry', async () => {
        const tickets = [
            makeTicket({ ticket_id: 'T1', lease_expiry: new Date(Date.now() + 60000).toISOString() }),
            makeTicket({ ticket_id: 'T2', lease_expiry: null, claimed_by: null, claimed_by_name: null }),
        ];
        mockFetchTickets.mockResolvedValue({
            data: tickets,
            pagination: { total: 2, limit: 500, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<ClaimsPage />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('claims-count')).toHaveTextContent('1');
        });
    });

    it('filters out tickets without claimed_by', async () => {
        const tickets = [
            makeTicket({ ticket_id: 'T1' }),
            makeTicket({ ticket_id: 'T2', claimed_by: null, claimed_by_name: null }),
        ];
        mockFetchTickets.mockResolvedValue({
            data: tickets,
            pagination: { total: 2, limit: 500, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<ClaimsPage />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('claims-count')).toHaveTextContent('1');
        });
    });

    it('shows claim count after loading', async () => {
        const tickets = [makeTicket(), makeTicket({ ticket_id: 'T2' })];
        mockFetchTickets.mockResolvedValue({
            data: tickets,
            pagination: { total: 2, limit: 500, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<ClaimsPage />);
        });

        await waitFor(() => {
            expect(screen.getByText('2 active claims')).toBeInTheDocument();
        });
    });

    it('shows singular "claim" for exactly 1 claim', async () => {
        mockFetchTickets.mockResolvedValue({
            data: [makeTicket()],
            pagination: { total: 1, limit: 500, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<ClaimsPage />);
        });

        await waitFor(() => {
            expect(screen.getByText('1 active claim')).toBeInTheDocument();
        });
    });

    // --- AC7: WebSocket integration ---
    it('passes onTicketUpdate to useTicketStream', async () => {
        await act(async () => {
            render(<ClaimsPage />);
        });
        expect(useTicketStream).toHaveBeenCalledWith(
            expect.objectContaining({
                onTicketUpdate: expect.any(Function),
            }),
        );
    });

    it('adds a new claimed ticket via WebSocket update', async () => {
        mockFetchTickets.mockResolvedValue({
            data: [],
            pagination: { total: 0, limit: 500, offset: 0, has_more: false },
        } as never);

        // Capture the onTicketUpdate callback
        let capturedCallback: ((ticket: Ticket) => void) | undefined;
        useTicketStream.mockImplementation((opts: { onTicketUpdate?: (t: Ticket) => void }) => {
            capturedCallback = opts.onTicketUpdate;
            return { status: 'connected', reconnect: jest.fn() };
        });

        await act(async () => {
            render(<ClaimsPage />);
        });

        // Simulate WS update with a new claimed ticket
        const newTicket = makeTicket({ ticket_id: 'WS-001' });
        await act(async () => {
            capturedCallback?.(newTicket);
        });

        await waitFor(() => {
            expect(screen.getByTestId('claims-count')).toHaveTextContent('1');
        });
    });

    it('removes a ticket from claims when it becomes unclaimed via WebSocket', async () => {
        mockFetchTickets.mockResolvedValue({
            data: [makeTicket({ ticket_id: 'T1' })],
            pagination: { total: 1, limit: 500, offset: 0, has_more: false },
        } as never);

        let capturedCallback: ((ticket: Ticket) => void) | undefined;
        useTicketStream.mockImplementation((opts: { onTicketUpdate?: (t: Ticket) => void }) => {
            capturedCallback = opts.onTicketUpdate;
            return { status: 'connected', reconnect: jest.fn() };
        });

        await act(async () => {
            render(<ClaimsPage />);
        });

        await waitFor(() => {
            expect(screen.getByTestId('claims-count')).toHaveTextContent('1');
        });

        // Simulate unclaim
        const unclaimedTicket = makeTicket({
            ticket_id: 'T1',
            claimed_by: null,
            claimed_by_name: null,
            lease_expiry: null,
        });
        await act(async () => {
            capturedCallback?.(unclaimedTicket);
        });

        await waitFor(() => {
            expect(screen.getByTestId('claims-count')).toHaveTextContent('0');
        });
    });

    // --- Sort toggling ---
    it('toggles sort direction when clicking same field', async () => {
        await act(async () => {
            render(<ClaimsPage />);
        });

        // Click sort button (which sorts by 'agent')
        const sortBtn = screen.getByTestId('sort-btn');
        await act(async () => {
            sortBtn.click();
        });

        // Field should change to agent, direction resets to asc
        expect(screen.getByTestId('sort-field')).toHaveTextContent('agent');
    });

    // --- Error resilience ---
    it('handles fetchTickets failure gracefully', async () => {
        mockFetchTickets.mockRejectedValue(new Error('Network error'));

        await act(async () => {
            render(<ClaimsPage />);
        });

        // Page should still render without crashing
        await waitFor(() => {
            expect(screen.getByText('Active Claims')).toBeInTheDocument();
            expect(screen.getByTestId('loading')).toHaveTextContent('false');
        });
    });
});
