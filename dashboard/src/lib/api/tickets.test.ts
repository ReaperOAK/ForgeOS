import { fetchTickets, fetchTicket, fetchPipelineOverview, fetchTicketHistory } from './tickets';
import { apiClient } from './client';
import type {
  PaginatedResponse,
  Ticket,
  TicketDetail,
  PipelineOverview,
  EventHistory,
} from './types';

// ── Mock the client ──────────────────────────────────────────────────────────

jest.mock('./client', () => {
  const actual = jest.requireActual('./client');
  return {
    ...actual,
    apiClient: {
      get: jest.fn(),
    },
  };
});

const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

afterEach(() => {
  mockGet.mockReset();
});

// ── fetchTickets ─────────────────────────────────────────────────────────────

describe('fetchTickets', () => {
  const paginated: PaginatedResponse<Ticket> = {
    data: [],
    pagination: { total: 0, limit: 20, offset: 0, has_more: false },
  };

  it('calls /api/tickets with no query when no filters given', async () => {
    mockGet.mockResolvedValue(paginated);

    const result = await fetchTickets();

    expect(mockGet).toHaveBeenCalledWith('/api/tickets');
    expect(result).toEqual(paginated);
  });

  it('calls /api/tickets without query when filters is undefined', async () => {
    mockGet.mockResolvedValue(paginated);

    await fetchTickets(undefined);

    expect(mockGet).toHaveBeenCalledWith('/api/tickets');
  });

  it('builds query string from filters', async () => {
    mockGet.mockResolvedValue(paginated);

    await fetchTickets({ stage: 'QA', limit: 10 });

    const url = mockGet.mock.calls[0][0];
    expect(url).toContain('/api/tickets?');
    expect(url).toContain('stage=QA');
    expect(url).toContain('limit=10');
  });

  it('omits undefined filter values from query', async () => {
    mockGet.mockResolvedValue(paginated);

    await fetchTickets({ stage: 'BACKEND', type: undefined, priority: 'high' });

    const url = mockGet.mock.calls[0][0];
    expect(url).toContain('stage=BACKEND');
    expect(url).toContain('priority=high');
    expect(url).not.toContain('type');
  });

  it('includes offset=0 in query', async () => {
    mockGet.mockResolvedValue(paginated);

    await fetchTickets({ offset: 0, limit: 50 });

    const url = mockGet.mock.calls[0][0];
    expect(url).toContain('offset=0');
    expect(url).toContain('limit=50');
  });

  it('propagates ApiError from client', async () => {
    const apiError = { message: 'Server Error', status: 500 };
    mockGet.mockRejectedValue(apiError);

    await expect(fetchTickets()).rejects.toEqual(apiError);
  });
});

// ── fetchTicket ──────────────────────────────────────────────────────────────

describe('fetchTicket', () => {
  const detail: TicketDetail = {
    id: 'uuid-1',
    ticket_id: 'FORGEOS-FE002',
    project_id: null,
    title: 'Test Ticket',
    description: null,
    type: 'frontend',
    priority: 'critical',
    status: 'CLAIMED',
    stage: 'QA',
    sdlc_flow: ['READY', 'FRONTEND', 'QA', 'DONE'],
    claimed_by: 'agent-1',
    claimed_by_name: 'QA',
    machine_id: 'pop-os',
    operator: 'Ticketer',
    lease_expiry: '2026-03-11T14:00:00Z',
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
    created_at: '2026-03-10T00:00:00Z',
    updated_at: '2026-03-11T00:00:00Z',
    completed_at: null,
    dependency_status: [],
  };

  it('calls /api/tickets/:id with encoded ticket id', async () => {
    mockGet.mockResolvedValue(detail);

    const result = await fetchTicket('FORGEOS-FE002');

    expect(mockGet).toHaveBeenCalledWith('/api/tickets/FORGEOS-FE002');
    expect(result).toEqual(detail);
  });

  it('encodes special characters in ticket id', async () => {
    mockGet.mockResolvedValue(detail);

    await fetchTicket('TICKET/WITH SPACES');

    expect(mockGet).toHaveBeenCalledWith(
      `/api/tickets/${encodeURIComponent('TICKET/WITH SPACES')}`,
    );
  });

  it('propagates ApiError on 404', async () => {
    const err = { message: 'Not Found', status: 404 };
    mockGet.mockRejectedValue(err);

    await expect(fetchTicket('NOPE')).rejects.toEqual(err);
  });
});

// ── fetchPipelineOverview ────────────────────────────────────────────────────

describe('fetchPipelineOverview', () => {
  const overview: PipelineOverview = {
    stages: {
      READY: { count: 5, claimed: 0, ready: 5 },
      QA: { count: 2, claimed: 2, ready: 0 },
    },
    total_tickets: 7,
    timestamp: '2026-03-11T12:00:00Z',
  };

  it('calls /api/stages', async () => {
    mockGet.mockResolvedValue(overview);

    const result = await fetchPipelineOverview();

    expect(mockGet).toHaveBeenCalledWith('/api/stages');
    expect(result).toEqual(overview);
  });

  it('propagates errors', async () => {
    const err = { message: 'Unavailable', status: 503 };
    mockGet.mockRejectedValue(err);

    await expect(fetchPipelineOverview()).rejects.toEqual(err);
  });
});

// ── fetchTicketHistory ───────────────────────────────────────────────────────

describe('fetchTicketHistory', () => {
  const history: EventHistory[] = [
    {
      id: 'evt-1',
      ticket_id: 'FORGEOS-FE002',
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
      created_at: '2026-03-10T00:00:00Z',
    },
  ];

  it('calls /api/tickets/:id/history with encoded id', async () => {
    mockGet.mockResolvedValue(history);

    const result = await fetchTicketHistory('FORGEOS-FE002');

    expect(mockGet).toHaveBeenCalledWith('/api/tickets/FORGEOS-FE002/history');
    expect(result).toEqual(history);
  });

  it('encodes special characters in ticket id', async () => {
    mockGet.mockResolvedValue([]);

    await fetchTicketHistory('MY/TICKET');

    expect(mockGet).toHaveBeenCalledWith(
      `/api/tickets/${encodeURIComponent('MY/TICKET')}/history`,
    );
  });

  it('propagates errors', async () => {
    const err = { message: 'Error', status: 500 };
    mockGet.mockRejectedValue(err);

    await expect(fetchTicketHistory('X')).rejects.toEqual(err);
  });
});
