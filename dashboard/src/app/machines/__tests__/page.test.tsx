import { render, screen, waitFor, act } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import MachinesPage from '@/app/machines/page';
import type { Ticket } from '@/lib/api/types';

// Mock apiClient
jest.mock('@/lib/api-client', () => ({
    apiClient: {
        get: jest.fn(),
    },
}));

// Mock WebSocket client
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
let capturedOnEvent: ((event: unknown) => void) | undefined;

jest.mock('@/lib/api/websocket', () => ({
    TicketWebSocketClient: jest.fn().mockImplementation((opts: { onEvent?: (e: unknown) => void }) => {
        capturedOnEvent = opts.onEvent;
        return { connect: mockConnect, disconnect: mockDisconnect };
    }),
}));

// Mock MachineCard to simplify page-level testing
jest.mock('@/components/machines/MachineCard', () => ({
    MachineCard: ({
        hostname,
        status,
        agents,
    }: {
        hostname: string;
        status: string;
        agents: { agentName: string; ticketId: string }[];
    }) => (
        <div data-testid={`machine-card-${hostname}`} data-status={status}>
            <span>{hostname}</span>
            <span>{status}</span>
            <span data-testid="agent-count">{agents.length}</span>
        </div>
    ),
}));

import { apiClient } from '@/lib/api-client';

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const now = new Date();
const fiveMinutesAgo = new Date(now.getTime() - 5 * 60 * 1000);

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: 'uuid-1',
        ticket_id: 'FORGEOS-BE001',
        project_id: null,
        title: 'Test ticket',
        description: null,
        type: 'backend',
        priority: 'medium',
        status: 'CLAIMED',
        stage: 'BACKEND',
        sdlc_flow: ['READY', 'BACKEND', 'QA', 'DONE'],
        claimed_by: 'agent-uuid',
        claimed_by_name: 'Backend',
        machine_id: 'pop-os',
        operator: 'Ticketer',
        lease_expiry: new Date(fiveMinutesAgo.getTime() + 30 * 60_000).toISOString(),
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
        created_at: fiveMinutesAgo.toISOString(),
        updated_at: fiveMinutesAgo.toISOString(),
        completed_at: null,
        ...overrides,
    };
}

describe('MachinesPage', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        capturedOnEvent = undefined;
    });

    // --- Loading state ---

    it('renders skeleton loading state initially', async () => {
        // Never resolve to keep loading state
        mockGet.mockReturnValue(new Promise(() => { }));
        render(<MachinesPage />);
        expect(screen.getByText('Loading...')).toBeInTheDocument();
        expect(screen.getByLabelText('Loading machines')).toBeInTheDocument();
    });

    it('marks loading grid with aria-busy=true', () => {
        mockGet.mockReturnValue(new Promise(() => { }));
        render(<MachinesPage />);
        expect(screen.getByLabelText('Loading machines')).toHaveAttribute(
            'aria-busy',
            'true',
        );
    });

    // --- Error state ---

    it('renders error message on fetch failure', async () => {
        mockGet.mockRejectedValueOnce(new Error('Network error'));
        render(<MachinesPage />);
        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('renders Retry button on error', async () => {
        mockGet.mockRejectedValueOnce(new Error('Failed'));
        render(<MachinesPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
        });
    });

    it('retries fetch when Retry button is clicked', async () => {
        const user = userEvent.setup();
        mockGet.mockRejectedValueOnce(new Error('Failed'));
        render(<MachinesPage />);
        await waitFor(() => {
            expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
        });

        mockGet.mockResolvedValueOnce({ data: [], status: 200 });
        await user.click(screen.getByRole('button', { name: /retry/i }));

        await waitFor(() => {
            expect(mockGet).toHaveBeenCalledTimes(2);
        });
    });

    // --- AC7: Empty state when no machines are currently active ---

    it('renders empty state when no tickets are returned', async () => {
        mockGet.mockResolvedValueOnce({ data: [], status: 200 });
        render(<MachinesPage />);
        await waitFor(() => {
            expect(
                screen.getByText('No machines currently active'),
            ).toBeInTheDocument();
        });
    });

    it('empty state has role="status" and aria-label', async () => {
        mockGet.mockResolvedValueOnce({ data: [], status: 200 });
        render(<MachinesPage />);
        await waitFor(() => {
            const status = screen.getByRole('status');
            expect(status).toHaveAttribute(
                'aria-label',
                'No machines currently active',
            );
        });
    });

    // --- AC1/AC2: Machine cards display hostname, status, agent info ---

    it('renders machine cards from fetched tickets', async () => {
        const tickets = [
            makeTicket({ machine_id: 'pop-os', claimed_by_name: 'Backend' }),
            makeTicket({
                id: 'uuid-2',
                ticket_id: 'FORGEOS-FE002',
                machine_id: 'dev-box',
                claimed_by_name: 'Frontend',
                stage: 'FRONTEND',
            }),
        ];
        mockGet.mockResolvedValueOnce({ data: tickets, status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(screen.getByTestId('machine-card-pop-os')).toBeInTheDocument();
            expect(screen.getByTestId('machine-card-dev-box')).toBeInTheDocument();
        });
    });

    // --- AC3: Status determined by lease heartbeat recency ---

    it('marks machine as online when heartbeat is within 10 minutes', async () => {
        const ticket = makeTicket({
            machine_id: 'fresh-box',
            lease_expiry: new Date(Date.now() + 25 * 60_000).toISOString(),
            lease_duration_minutes: 30,
        });
        mockGet.mockResolvedValueOnce({ data: [ticket], status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            const card = screen.getByTestId('machine-card-fresh-box');
            expect(card).toHaveAttribute('data-status', 'online');
        });
    });

    it('marks machine as offline when heartbeat is older than 10 minutes', async () => {
        const oldExpiry = new Date(Date.now() - 30 * 60_000).toISOString();
        const ticket = makeTicket({
            machine_id: 'stale-box',
            lease_expiry: oldExpiry,
            lease_duration_minutes: 30,
        });
        mockGet.mockResolvedValueOnce({ data: [ticket], status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            const card = screen.getByTestId('machine-card-stale-box');
            expect(card).toHaveAttribute('data-status', 'offline');
        });
    });

    // --- AC4: Responsive grid layout (structure verified via CSS classes) ---

    it('renders machine cards in a grid container', async () => {
        mockGet.mockResolvedValueOnce({
            data: [makeTicket()],
            status: 200,
        });
        const { container } = render(<MachinesPage />);

        await waitFor(() => {
            expect(screen.getByTestId('machine-card-pop-os')).toBeInTheDocument();
        });

        const grid = container.querySelector(
            '.grid.grid-cols-1.md\\:grid-cols-2.lg\\:grid-cols-3',
        );
        expect(grid).toBeInTheDocument();
    });

    // --- Aggregation: multiple tickets on same machine ---

    it('aggregates multiple tickets on the same machine', async () => {
        const tickets = [
            makeTicket({
                ticket_id: 'FORGEOS-BE001',
                machine_id: 'pop-os',
                claimed_by_name: 'Backend',
            }),
            makeTicket({
                id: 'uuid-3',
                ticket_id: 'FORGEOS-QA003',
                machine_id: 'pop-os',
                claimed_by_name: 'QA Engineer',
                stage: 'QA',
            }),
        ];
        mockGet.mockResolvedValueOnce({ data: tickets, status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            const card = screen.getByTestId('machine-card-pop-os');
            const count = card.querySelector('[data-testid="agent-count"]');
            expect(count).toHaveTextContent('2');
        });
    });

    // --- Skips tickets without machine_id or claimed_by_name ---

    it('ignores tickets without machine_id', async () => {
        const tickets = [
            makeTicket({ machine_id: null, claimed_by_name: 'Backend' }),
        ];
        mockGet.mockResolvedValueOnce({ data: tickets, status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(
                screen.getByText('No machines currently active'),
            ).toBeInTheDocument();
        });
    });

    it('ignores tickets without claimed_by_name', async () => {
        const tickets = [
            makeTicket({ machine_id: 'pop-os', claimed_by_name: null }),
        ];
        mockGet.mockResolvedValueOnce({ data: tickets, status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(
                screen.getByText('No machines currently active'),
            ).toBeInTheDocument();
        });
    });

    // --- Sorting: online first, then alphabetical ---

    it('renders online machines before offline ones', async () => {
        const tickets = [
            makeTicket({
                ticket_id: 'T1',
                machine_id: 'zzz-stale',
                claimed_by_name: 'Agent A',
                lease_expiry: new Date(Date.now() - 30 * 60_000).toISOString(),
                lease_duration_minutes: 30,
            }),
            makeTicket({
                id: 'uuid-4',
                ticket_id: 'T2',
                machine_id: 'aaa-fresh',
                claimed_by_name: 'Agent B',
                lease_expiry: new Date(Date.now() + 25 * 60_000).toISOString(),
                lease_duration_minutes: 30,
            }),
        ];
        mockGet.mockResolvedValueOnce({ data: tickets, status: 200 });
        const { container } = render(<MachinesPage />);

        await waitFor(() => {
            const cards = container.querySelectorAll('[data-testid^="machine-card-"]');
            expect(cards).toHaveLength(2);
            // Online first
            expect(cards[0]).toHaveAttribute('data-testid', 'machine-card-aaa-fresh');
            expect(cards[1]).toHaveAttribute('data-testid', 'machine-card-zzz-stale');
        });
    });

    // --- Page header: online count ---

    it('shows online machine count in header', async () => {
        const tickets = [
            makeTicket({
                machine_id: 'machine-a',
                claimed_by_name: 'Backend',
                lease_expiry: new Date(Date.now() + 25 * 60_000).toISOString(),
                lease_duration_minutes: 30,
            }),
        ];
        mockGet.mockResolvedValueOnce({ data: tickets, status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(screen.getByText('1 machine online')).toBeInTheDocument();
        });
    });

    it('pluralizes machine count correctly', async () => {
        const tickets = [
            makeTicket({
                ticket_id: 'T1',
                machine_id: 'machine-a',
                claimed_by_name: 'A',
                lease_expiry: new Date(Date.now() + 25 * 60_000).toISOString(),
                lease_duration_minutes: 30,
            }),
            makeTicket({
                id: 'uuid-5',
                ticket_id: 'T2',
                machine_id: 'machine-b',
                claimed_by_name: 'B',
                lease_expiry: new Date(Date.now() + 25 * 60_000).toISOString(),
                lease_duration_minutes: 30,
            }),
        ];
        mockGet.mockResolvedValueOnce({ data: tickets, status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(screen.getByText('2 machines online')).toBeInTheDocument();
        });
    });

    // --- AC6: Real-time updates via WebSocket ---

    it('connects WebSocket on mount and disconnects on unmount', async () => {
        mockGet.mockResolvedValueOnce({ data: [], status: 200 });
        const { unmount } = render(<MachinesPage />);

        await waitFor(() => {
            expect(mockConnect).toHaveBeenCalledTimes(1);
        });

        unmount();
        expect(mockDisconnect).toHaveBeenCalledTimes(1);
    });

    it('adds a new machine when WebSocket sends TICKET_CREATED for claimed ticket', async () => {
        mockGet.mockResolvedValueOnce({ data: [], status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(screen.getByText('No machines currently active')).toBeInTheDocument();
        });

        const newTicket = makeTicket({
            ticket_id: 'FORGEOS-WS001',
            machine_id: 'ws-machine',
            claimed_by_name: 'Frontend',
            status: 'CLAIMED',
        });

        act(() => {
            capturedOnEvent?.({
                type: 'TICKET_CREATED',
                ticket: newTicket,
                timestamp: new Date().toISOString(),
            });
        });

        await waitFor(() => {
            expect(screen.getByTestId('machine-card-ws-machine')).toBeInTheDocument();
        });
    });

    it('removes a machine when WebSocket sends status change to non-active', async () => {
        const ticket = makeTicket({
            machine_id: 'disappearing-box',
            claimed_by_name: 'Backend',
            status: 'CLAIMED',
        });
        mockGet.mockResolvedValueOnce({ data: [ticket], status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(
                screen.getByTestId('machine-card-disappearing-box'),
            ).toBeInTheDocument();
        });

        act(() => {
            capturedOnEvent?.({
                type: 'TICKET_STATE_CHANGE',
                ticket_id: ticket.ticket_id,
                previous_stage: 'BACKEND',
                new_stage: 'QA',
                previous_status: 'CLAIMED',
                new_status: 'DONE',
                ticket: { ...ticket, status: 'DONE' as const },
                timestamp: new Date().toISOString(),
            });
        });

        await waitFor(() => {
            expect(
                screen.queryByTestId('machine-card-disappearing-box'),
            ).not.toBeInTheDocument();
        });
    });

    it('updates a machine when WebSocket sends TICKET_UPDATED for active ticket', async () => {
        const ticket = makeTicket({
            machine_id: 'update-box',
            claimed_by_name: 'Backend',
            status: 'IN_PROGRESS',
        });
        mockGet.mockResolvedValueOnce({ data: [ticket], status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(screen.getByTestId('machine-card-update-box')).toBeInTheDocument();
        });

        // Update same ticket — should not create a duplicate
        act(() => {
            capturedOnEvent?.({
                type: 'TICKET_UPDATED',
                ticket: { ...ticket, stage: 'QA' as const, status: 'IN_PROGRESS' as const },
                timestamp: new Date().toISOString(),
            });
        });

        await waitFor(() => {
            // Still exactly one card for this machine
            const cards = screen.getAllByTestId('machine-card-update-box');
            expect(cards).toHaveLength(1);
        });
    });

    // --- Fetch parameters ---

    it('fetches tickets with correct query parameters', async () => {
        mockGet.mockResolvedValueOnce({ data: [], status: 200 });
        render(<MachinesPage />);

        await waitFor(() => {
            expect(mockGet).toHaveBeenCalledWith(
                '/api/tickets?status=CLAIMED&status=IN_PROGRESS&limit=200',
            );
        });
    });
});
