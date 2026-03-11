import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
    useRouter: () => ({ replace: mockReplace, back: mockBack, push: jest.fn() }),
    useSearchParams: () => mockSearchParams,
}));

jest.mock('@/lib/api', () => ({
    fetchTickets: jest.fn(),
}));

import { fetchTickets } from '@/lib/api';
import SearchPage from '@/app/search/page';

const mockedFetch = fetchTickets as jest.MockedFunction<typeof fetchTickets>;

function makeTicket(overrides: Record<string, unknown> = {}) {
    return {
        id: '1',
        ticket_id: 'FORGEOS-BE001',
        project_id: null,
        title: 'Implement health check',
        description: 'Add a /health endpoint',
        type: 'backend',
        priority: 'high',
        status: 'READY',
        stage: 'BACKEND',
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

/* ------------------------------------------------------------------ */
/*  Setup                                                              */
/* ------------------------------------------------------------------ */

beforeEach(() => {
    jest.clearAllMocks();
    mockedFetch.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 50, offset: 0, has_more: false },
    } as never);
});

/* ------------------------------------------------------------------ */
/*  Page renders                                                       */
/* ------------------------------------------------------------------ */

describe('SearchPage — Rendering', () => {
    it('renders the Search heading', async () => {
        await act(async () => {
            render(<SearchPage />);
        });
        expect(screen.getByText('Search')).toBeInTheDocument();
    });

    it('renders search input with placeholder', async () => {
        await act(async () => {
            render(<SearchPage />);
        });
        const input = screen.getByRole('textbox', { name: /search tickets/i });
        expect(input).toBeInTheDocument();
        expect(input).toHaveAttribute('placeholder', expect.stringContaining('Search'));
    });
});

/* ------------------------------------------------------------------ */
/*  Filter chips on page (AC4)                                         */
/* ------------------------------------------------------------------ */

describe('SearchPage — Filter chips', () => {
    it('renders Stage, Priority, Type filter groups', async () => {
        await act(async () => {
            render(<SearchPage />);
        });
        expect(screen.getByText('Stage')).toBeInTheDocument();
        expect(screen.getByText('Priority')).toBeInTheDocument();
        expect(screen.getByText('Type')).toBeInTheDocument();
    });

    it('renders individual stage chips', async () => {
        await act(async () => {
            render(<SearchPage />);
        });
        expect(screen.getByRole('button', { name: 'READY' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'QA' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'DONE' })).toBeInTheDocument();
    });

    it('renders priority chips', async () => {
        await act(async () => {
            render(<SearchPage />);
        });
        expect(screen.getByRole('button', { name: 'critical' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'high' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'medium' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'low' })).toBeInTheDocument();
    });

    it('toggles stage filter and triggers re-fetch', async () => {
        await act(async () => {
            render(<SearchPage />);
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'QA' }));
        });

        // After filter change, fetchTickets should be called with new params
        await waitFor(() => {
            expect(mockedFetch).toHaveBeenCalledTimes(2); // once on mount, once on filter
        });
    });

    it('shows "Clear all filters" when filters active', async () => {
        await act(async () => {
            render(<SearchPage />);
        });

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'QA' }));
        });

        expect(screen.getByText('Clear all filters')).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------ */
/*  Results integration (AC3)                                          */
/* ------------------------------------------------------------------ */

describe('SearchPage — Results', () => {
    it('displays matching tickets in SearchResults', async () => {
        mockedFetch.mockResolvedValue({
            data: [
                makeTicket({ ticket_id: 'FORGEOS-FE003', title: 'Search component' }),
            ],
            pagination: { total: 1, limit: 50, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<SearchPage />);
        });

        await waitFor(() => {
            expect(screen.getByText('FORGEOS-FE003')).toBeInTheDocument();
        });
    });

    it('filters results by query text', async () => {
        mockedFetch.mockResolvedValue({
            data: [
                makeTicket({ ticket_id: 'FORGEOS-FE003', title: 'Search component' }),
                makeTicket({ id: '2', ticket_id: 'FORGEOS-BE004', title: 'API endpoint' }),
            ],
            pagination: { total: 2, limit: 50, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<SearchPage />);
        });

        const input = screen.getByRole('textbox', { name: /search tickets/i });
        await act(async () => {
            fireEvent.change(input, { target: { value: 'API' } });
        });

        await waitFor(() => {
            expect(screen.getByText('FORGEOS-BE004')).toBeInTheDocument();
            expect(screen.queryByText('FORGEOS-FE003')).not.toBeInTheDocument();
        });
    });
});

/* ------------------------------------------------------------------ */
/*  Empty & loading states (AC7)                                       */
/* ------------------------------------------------------------------ */

describe('SearchPage — Empty state', () => {
    it('shows empty state messaging when no results', async () => {
        mockedFetch.mockResolvedValue({
            data: [],
            pagination: { total: 0, limit: 50, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<SearchPage />);
        });

        await waitFor(() => {
            expect(screen.getByText(/search for tickets/i)).toBeInTheDocument();
        });
    });

    it('shows no-match message when query has no hits', async () => {
        mockedFetch.mockResolvedValue({
            data: [],
            pagination: { total: 0, limit: 50, offset: 0, has_more: false },
        } as never);

        await act(async () => {
            render(<SearchPage />);
        });

        const input = screen.getByRole('textbox', { name: /search tickets/i });
        await act(async () => {
            fireEvent.change(input, { target: { value: 'zzzznotfound' } });
        });

        await waitFor(() => {
            expect(screen.getByText('No tickets found')).toBeInTheDocument();
        });
    });
});

/* ------------------------------------------------------------------ */
/*  URL param sync                                                     */
/* ------------------------------------------------------------------ */

describe('SearchPage — URL params', () => {
    it('syncs query to URL params', async () => {
        await act(async () => {
            render(<SearchPage />);
        });

        const input = screen.getByRole('textbox', { name: /search tickets/i });
        await act(async () => {
            fireEvent.change(input, { target: { value: 'hello' } });
        });

        await waitFor(() => {
            expect(mockReplace).toHaveBeenCalledWith(
                expect.stringContaining('q=hello'),
                expect.anything(),
            );
        });
    });
});

/* ------------------------------------------------------------------ */
/*  Clear search                                                       */
/* ------------------------------------------------------------------ */

describe('SearchPage — Clear', () => {
    it('clears search when X button clicked', async () => {
        await act(async () => {
            render(<SearchPage />);
        });

        const input = screen.getByRole('textbox', { name: /search tickets/i });
        await act(async () => {
            fireEvent.change(input, { target: { value: 'clear me' } });
        });

        const clearBtn = screen.getByRole('button', { name: /clear search/i });
        await act(async () => {
            fireEvent.click(clearBtn);
        });

        expect(input).toHaveValue('');
    });
});
