import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from '@/components/search/SearchBar';

/* ------------------------------------------------------------------ */
/*  Mocks                                                              */
/* ------------------------------------------------------------------ */

const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: mockPush }),
}));

jest.mock('@/lib/api', () => ({
    fetchTickets: jest.fn(),
}));

import { fetchTickets } from '@/lib/api';
const mockedFetch = fetchTickets as jest.MockedFunction<typeof fetchTickets>;

function makeTicket(overrides: Record<string, unknown> = {}) {
    return {
        id: '1',
        ticket_id: 'FORGEOS-BE001',
        project_id: null,
        title: 'Implement health check',
        description: 'Health check endpoint',
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
/*  Setup / Teardown                                                   */
/* ------------------------------------------------------------------ */

beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    localStorage.clear();
    mockedFetch.mockResolvedValue({
        data: [],
        pagination: { total: 0, limit: 10, offset: 0, has_more: false },
    } as never);
});

afterEach(() => {
    jest.useRealTimers();
});

/* ------------------------------------------------------------------ */
/*  AC1: Cmd/Ctrl+K keyboard shortcut                                  */
/* ------------------------------------------------------------------ */

describe('AC1 — Keyboard shortcut', () => {
    it('focuses input on Cmd+K', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        expect(document.activeElement).not.toBe(input);
        fireEvent.keyDown(document, { key: 'k', metaKey: true });
        expect(document.activeElement).toBe(input);
    });

    it('focuses input on Ctrl+K', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
        expect(document.activeElement).toBe(input);
    });

    it('does not focus without modifier key', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        fireEvent.keyDown(document, { key: 'k' });
        expect(document.activeElement).not.toBe(input);
    });
});

/* ------------------------------------------------------------------ */
/*  AC2: 300ms debounce                                                */
/* ------------------------------------------------------------------ */

describe('AC2 — Debounced search (300ms)', () => {
    it('does not call API before debounce period', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'test' } });

        // Before debounce fires
        expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('calls API after 300ms debounce', async () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'test' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(mockedFetch).toHaveBeenCalled();
        });
    });

    it('does not call API for single character queries', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'a' } });

        act(() => {
            jest.advanceTimersByTime(500);
        });

        expect(mockedFetch).not.toHaveBeenCalled();
    });

    it('cancels previous debounce on new input', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'te' } });
        act(() => {
            jest.advanceTimersByTime(200);
        });

        fireEvent.change(input, { target: { value: 'tes' } });
        act(() => {
            jest.advanceTimersByTime(100);
        });

        // Only 100ms after second change — should not have called yet
        expect(mockedFetch).not.toHaveBeenCalled();
    });
});

/* ------------------------------------------------------------------ */
/*  AC3: Results show ticket ID, title, stage with highlighted matches */
/* ------------------------------------------------------------------ */

describe('AC3 — Search results display', () => {
    it('renders results with ticket ID and title', async () => {
        mockedFetch.mockResolvedValue({
            data: [
                makeTicket({ ticket_id: 'FORGEOS-BE001', title: 'Health check endpoint' }),
            ],
            pagination: { total: 1, limit: 10, offset: 0, has_more: false },
        } as never);

        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'health' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText('FORGEOS-BE001')).toBeInTheDocument();
        });
    });

    it('shows stage in results', async () => {
        mockedFetch.mockResolvedValue({
            data: [makeTicket({ stage: 'QA' })],
            pagination: { total: 1, limit: 10, offset: 0, has_more: false },
        } as never);

        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'health' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText('QA')).toBeInTheDocument();
        });
    });

    it('highlights matching text with <mark> elements', async () => {
        mockedFetch.mockResolvedValue({
            data: [
                makeTicket({ ticket_id: 'FORGEOS-BE001', title: 'Health check endpoint' }),
            ],
            pagination: { total: 1, limit: 10, offset: 0, has_more: false },
        } as never);

        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'health' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            const marks = document.querySelectorAll('mark');
            expect(marks.length).toBeGreaterThan(0);
        });
    });

    it('displays empty state when no results found', async () => {
        mockedFetch.mockResolvedValue({
            data: [],
            pagination: { total: 0, limit: 10, offset: 0, has_more: false },
        } as never);

        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'nonexistent' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText(/no tickets match/i)).toBeInTheDocument();
        });
    });
});

/* ------------------------------------------------------------------ */
/*  AC4: Filter chips                                                  */
/* ------------------------------------------------------------------ */

describe('AC4 — Filter chips', () => {
    it('renders filter toggle button', () => {
        render(<SearchBar />);
        expect(screen.getByRole('button', { name: /toggle search filters/i })).toBeInTheDocument();
    });

    it('shows filter chips when toggle clicked', () => {
        render(<SearchBar />);
        const filterBtn = screen.getByRole('button', { name: /toggle search filters/i });
        fireEvent.click(filterBtn);

        // Verify Stage/Priority/Type chip groups appear
        expect(screen.getByText('Stage')).toBeInTheDocument();
        expect(screen.getByText('Priority')).toBeInTheDocument();
        expect(screen.getByText('Type')).toBeInTheDocument();
    });

    it('toggles stage chip on/off', () => {
        render(<SearchBar />);
        fireEvent.click(screen.getByRole('button', { name: /toggle search filters/i }));

        const readyChip = screen.getByRole('button', { name: 'READY' });
        fireEvent.click(readyChip);

        // Chip should have active styling (bg-primary)
        expect(readyChip.className).toContain('bg-primary');

        // Click again to deactivate
        fireEvent.click(readyChip);
        expect(readyChip.className).not.toContain('bg-primary');
    });

    it('toggles priority chip on/off', () => {
        render(<SearchBar />);
        fireEvent.click(screen.getByRole('button', { name: /toggle search filters/i }));

        const criticalChip = screen.getByRole('button', { name: 'critical' });
        fireEvent.click(criticalChip);
        expect(criticalChip.className).toContain('bg-primary');
    });
});

/* ------------------------------------------------------------------ */
/*  AC5: Recent searches in localStorage                               */
/* ------------------------------------------------------------------ */

describe('AC5 — Recent searches in localStorage', () => {
    it('saves search term on submit', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'test query' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        const stored = JSON.parse(localStorage.getItem('forgeos-recent-searches') ?? '[]');
        expect(stored).toContain('test query');
    });

    it('shows recent searches when input focused and empty', () => {
        localStorage.setItem(
            'forgeos-recent-searches',
            JSON.stringify(['first search', 'second search']),
        );

        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);

        expect(screen.getByText('first search')).toBeInTheDocument();
        expect(screen.getByText('second search')).toBeInTheDocument();
    });

    it('limits recent searches to 5', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        for (let i = 1; i <= 7; i++) {
            fireEvent.change(input, { target: { value: `query ${i}` } });
            fireEvent.keyDown(input, { key: 'Enter' });
        }

        const stored = JSON.parse(localStorage.getItem('forgeos-recent-searches') ?? '[]');
        expect(stored.length).toBeLessThanOrEqual(5);
    });

    it('removes duplicate and keeps most recent first', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'alpha' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        fireEvent.change(input, { target: { value: 'beta' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        fireEvent.change(input, { target: { value: 'alpha' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        const stored = JSON.parse(localStorage.getItem('forgeos-recent-searches') ?? '[]');
        expect(stored[0]).toBe('alpha');
        expect(stored.filter((s: string) => s === 'alpha').length).toBe(1);
    });

    it('can remove a recent search', () => {
        localStorage.setItem(
            'forgeos-recent-searches',
            JSON.stringify(['removeme', 'keepme']),
        );

        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);

        const removeBtn = screen.getByRole('button', { name: /remove "removeme"/i });
        fireEvent.click(removeBtn);

        expect(screen.queryByText('removeme')).not.toBeInTheDocument();
        expect(screen.getByText('keepme')).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------ */
/*  AC6: Clicking a result navigates to ticket detail page             */
/* ------------------------------------------------------------------ */

describe('AC6 — Result navigation', () => {
    it('navigates to ticket detail on result click', async () => {
        mockedFetch.mockResolvedValue({
            data: [makeTicket({ ticket_id: 'FORGEOS-BE001', title: 'Health check' })],
            pagination: { total: 1, limit: 10, offset: 0, has_more: false },
        } as never);

        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'health' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText('FORGEOS-BE001')).toBeInTheDocument();
        });

        // Click result
        const resultBtn = screen.getByRole('option');
        fireEvent.click(resultBtn);

        expect(mockPush).toHaveBeenCalledWith('/tickets/FORGEOS-BE001');
    });

    it('navigates via Enter key on highlighted result', async () => {
        mockedFetch.mockResolvedValue({
            data: [makeTicket({ ticket_id: 'FORGEOS-FE002', title: 'Frontend ticket' })],
            pagination: { total: 1, limit: 10, offset: 0, has_more: false },
        } as never);

        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'frontend' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText('FORGEOS-FE002')).toBeInTheDocument();
        });

        // Arrow down then enter
        fireEvent.keyDown(input, { key: 'ArrowDown' });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mockPush).toHaveBeenCalledWith('/tickets/FORGEOS-FE002');
    });

    it('submits to search page on Enter without highlighted result', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'test' } });
        fireEvent.keyDown(input, { key: 'Enter' });

        expect(mockPush).toHaveBeenCalledWith(expect.stringContaining('/search?q=test'));
    });
});

/* ------------------------------------------------------------------ */
/*  AC7: Empty state messaging                                         */
/* ------------------------------------------------------------------ */

describe('AC7 — Empty state', () => {
    it('shows placeholder text in search input', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        expect(input).toHaveAttribute('placeholder', expect.stringContaining('Search'));
    });

    it('shows empty state when search yields no results', async () => {
        mockedFetch.mockResolvedValue({
            data: [],
            pagination: { total: 0, limit: 10, offset: 0, has_more: false },
        } as never);

        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'zzzzz' } });
        fireEvent.focus(input);

        act(() => {
            jest.advanceTimersByTime(300);
        });

        await waitFor(() => {
            expect(screen.getByText(/no tickets match/i)).toBeInTheDocument();
        });
    });
});

/* ------------------------------------------------------------------ */
/*  Accessibility & keyboard nav                                       */
/* ------------------------------------------------------------------ */

describe('Accessibility', () => {
    it('input has combobox role and aria-label', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        expect(input).toHaveAttribute('aria-label', expect.stringContaining('Search'));
    });

    it('Escape closes dropdown and blurs input', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');
        fireEvent.focus(input);
        fireEvent.keyDown(input, { key: 'Escape' });
        expect(document.activeElement).not.toBe(input);
    });

    it('clear button resets query', () => {
        render(<SearchBar />);
        const input = screen.getByRole('combobox');

        fireEvent.change(input, { target: { value: 'some text' } });
        expect(input).toHaveValue('some text');

        const clearBtn = screen.getByRole('button', { name: /clear search/i });
        fireEvent.click(clearBtn);
        expect(input).toHaveValue('');
    });
});
