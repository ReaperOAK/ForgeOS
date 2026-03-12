import { render, screen, waitFor } from '@testing-library/react';
import { HistoryTimeline } from '@/components/tickets/HistoryTimeline';
import type { EventHistory } from '@/lib/api';

jest.mock('@/lib/api', () => ({
    fetchTicketHistory: jest.fn(),
    isApiError: jest.fn((err: unknown) => {
        return (
            typeof err === 'object' &&
            err !== null &&
            'message' in err &&
            'status' in err
        );
    }),
}));

const { fetchTicketHistory } = jest.requireMock('@/lib/api') as {
    fetchTicketHistory: jest.Mock;
};

const mockEvents: EventHistory[] = [
    {
        id: 'evt-1',
        ticket_id: 'FORGEOS-FE004',
        event_type: 'CREATED',
        agent_id: null,
        agent_name: 'TODO',
        machine_id: 'system',
        operator: null,
        previous_stage: null,
        new_stage: 'READY',
        previous_status: null,
        new_status: 'READY',
        payload: {},
        created_at: '2026-03-05T18:00:00Z',
    },
    {
        id: 'evt-2',
        ticket_id: 'FORGEOS-FE004',
        event_type: 'CLAIMED',
        agent_id: 'agent-1',
        agent_name: 'FrontendEngineer',
        machine_id: 'pop-os',
        operator: 'reaperoak',
        previous_stage: 'READY',
        new_stage: 'FRONTEND',
        previous_status: 'READY',
        new_status: 'CLAIMED',
        payload: { lease_duration: 30 },
        created_at: '2026-03-11T14:00:00Z',
    },
    {
        id: 'evt-3',
        ticket_id: 'FORGEOS-FE004',
        event_type: 'STAGE_ADVANCED',
        agent_id: 'agent-1',
        agent_name: 'FrontendEngineer',
        machine_id: 'pop-os',
        operator: 'reaperoak',
        previous_stage: 'FRONTEND',
        new_stage: 'QA',
        previous_status: 'CLAIMED',
        new_status: 'READY',
        payload: {},
        created_at: '2026-03-11T15:00:00Z',
    },
];

describe('HistoryTimeline', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('shows loading skeleton initially', () => {
        fetchTicketHistory.mockReturnValue(new Promise(() => { })); // never resolves
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);
        expect(screen.getByRole('status', { name: /Loading history/ })).toBeInTheDocument();
    });

    it('renders timeline events after fetch', async () => {
        fetchTicketHistory.mockResolvedValue(mockEvents);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('Created')).toBeInTheDocument();
        });
        expect(screen.getByText('Claimed')).toBeInTheDocument();
        expect(screen.getByText('Stage Advanced')).toBeInTheDocument();
    });

    it('displays agent name for each event', async () => {
        fetchTicketHistory.mockResolvedValue(mockEvents);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('TODO')).toBeInTheDocument();
        });
        const feLabels = screen.getAllByText('FrontendEngineer');
        expect(feLabels.length).toBeGreaterThanOrEqual(2);
    });

    it('displays machine_id for events', async () => {
        fetchTicketHistory.mockResolvedValue(mockEvents);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('system')).toBeInTheDocument();
        });
        const machines = screen.getAllByText('pop-os');
        expect(machines.length).toBeGreaterThanOrEqual(2);
    });

    it('displays operator when present', async () => {
        fetchTicketHistory.mockResolvedValue(mockEvents);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            const ops = screen.getAllByText('reaperoak');
            expect(ops.length).toBeGreaterThanOrEqual(1);
        });
    });

    it('shows stage transitions', async () => {
        fetchTicketHistory.mockResolvedValue(mockEvents);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('READY → FRONTEND')).toBeInTheDocument();
        });
        expect(screen.getByText('FRONTEND → QA')).toBeInTheDocument();
    });

    it('shows "→ STAGE" when only new_stage is present', async () => {
        fetchTicketHistory.mockResolvedValue([mockEvents[0]]); // CREATED: no prev, new=READY
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('→ READY')).toBeInTheDocument();
        });
    });

    it('renders timeline with aria-label', async () => {
        fetchTicketHistory.mockResolvedValue(mockEvents);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByLabelText('Event timeline')).toBeInTheDocument();
        });
    });

    it('shows timestamps with time elements', async () => {
        fetchTicketHistory.mockResolvedValue(mockEvents);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            const timeEls = document.querySelectorAll('time[dateTime]');
            expect(timeEls.length).toBe(3);
        });
    });

    it('shows error state on API failure', async () => {
        fetchTicketHistory.mockRejectedValue({ message: 'Network error', status: 500 });
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByRole('alert')).toBeInTheDocument();
        });
        expect(screen.getByText('Network error')).toBeInTheDocument();
    });

    it('shows generic error for non-ApiError failures', async () => {
        fetchTicketHistory.mockRejectedValue(new Error('unexpected'));
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('Failed to load history')).toBeInTheDocument();
        });
    });

    it('shows empty state when no events', async () => {
        fetchTicketHistory.mockResolvedValue([]);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('No history events recorded.')).toBeInTheDocument();
        });
    });

    it('calls fetchTicketHistory with correct ticketId', async () => {
        fetchTicketHistory.mockResolvedValue([]);
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(fetchTicketHistory).toHaveBeenCalledWith('FORGEOS-FE004');
        });
    });

    it('renders expandable details when payload is non-empty', async () => {
        fetchTicketHistory.mockResolvedValue([mockEvents[1]]); // has payload { lease_duration: 30 }
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('Details')).toBeInTheDocument();
        });
    });

    it('does not render details when payload is empty', async () => {
        fetchTicketHistory.mockResolvedValue([mockEvents[0]]); // empty payload
        render(<HistoryTimeline ticketId="FORGEOS-FE004" />);

        await waitFor(() => {
            expect(screen.getByText('Created')).toBeInTheDocument();
        });
        expect(screen.queryByText('Details')).not.toBeInTheDocument();
    });
});
