import { render, screen } from '@testing-library/react';
import { SearchResults } from '@/components/search/SearchResults';
import type { Ticket } from '@/lib/api';

/* ------------------------------------------------------------------ */
/*  Test data                                                          */
/* ------------------------------------------------------------------ */

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: '1',
        ticket_id: 'FORGEOS-BE001',
        project_id: null,
        title: 'Implement health check endpoint',
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
        file_paths: ['src/health.ts'],
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
    } as Ticket;
}

/* ------------------------------------------------------------------ */
/*  Loading state                                                      */
/* ------------------------------------------------------------------ */

describe('SearchResults — Loading', () => {
    it('renders skeleton loaders when isLoading=true', () => {
        const { container } = render(
            <SearchResults tickets={[]} query="test" isLoading={true} totalCount={0} />,
        );
        const skeletons = container.querySelectorAll('.animate-pulse');
        expect(skeletons.length).toBeGreaterThan(0);
    });

    it('does not render tickets while loading', () => {
        render(
            <SearchResults
                tickets={[makeTicket()]}
                query="test"
                isLoading={true}
                totalCount={1}
            />,
        );
        expect(screen.queryByText('FORGEOS-BE001')).not.toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------ */
/*  Empty state (AC7)                                                  */
/* ------------------------------------------------------------------ */

describe('SearchResults — Empty state', () => {
    it('shows "No tickets found" when query present but no results', () => {
        render(
            <SearchResults tickets={[]} query="missing" isLoading={false} totalCount={0} />,
        );
        expect(screen.getByText('No tickets found')).toBeInTheDocument();
        expect(screen.getByText(/no tickets match/i)).toBeInTheDocument();
    });

    it('shows helpful placeholder when no query and no results', () => {
        render(
            <SearchResults tickets={[]} query="" isLoading={false} totalCount={0} />,
        );
        expect(screen.getByText('Search for tickets')).toBeInTheDocument();
        expect(screen.getByText(/enter a search term/i)).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------ */
/*  Results rendering (AC3)                                            */
/* ------------------------------------------------------------------ */

describe('SearchResults — Results display', () => {
    const tickets = [
        makeTicket({ ticket_id: 'FORGEOS-BE001', title: 'Health check', priority: 'high' }),
        makeTicket({
            id: '2',
            ticket_id: 'FORGEOS-FE002',
            title: 'Dashboard layout',
            type: 'frontend',
            priority: 'medium',
            stage: 'FRONTEND',
        }),
    ];

    it('renders all ticket results', () => {
        render(
            <SearchResults tickets={tickets} query="xyz" isLoading={false} totalCount={2} />,
        );
        expect(screen.getByText('FORGEOS-BE001')).toBeInTheDocument();
        expect(screen.getByText('FORGEOS-FE002')).toBeInTheDocument();
    });

    it('renders result count', () => {
        render(
            <SearchResults tickets={tickets} query="xyz" isLoading={false} totalCount={2} />,
        );
        // "Showing 2 of 2 results" — appears twice so use getAllByText
        const counts = screen.getAllByText('2');
        expect(counts.length).toBeGreaterThanOrEqual(1);
    });

    it('highlights matching text in ticket ID', () => {
        render(
            <SearchResults
                tickets={[makeTicket({ ticket_id: 'FORGEOS-BE001' })]}
                query="BE001"
                isLoading={false}
                totalCount={1}
            />,
        );
        const marks = document.querySelectorAll('mark');
        expect(marks.length).toBeGreaterThan(0);
        expect(marks[0].textContent).toBe('BE001');
    });

    it('highlights matching text in title', () => {
        render(
            <SearchResults
                tickets={[makeTicket({ title: 'Health check endpoint' })]}
                query="Health"
                isLoading={false}
                totalCount={1}
            />,
        );
        const marks = document.querySelectorAll('mark');
        expect(marks.length).toBeGreaterThan(0);
        expect(marks[0].textContent).toBe('Health');
    });

    it('displays priority badge', () => {
        render(
            <SearchResults
                tickets={[makeTicket({ priority: 'critical' })]}
                query="test"
                isLoading={false}
                totalCount={1}
            />,
        );
        expect(screen.getByText('critical')).toBeInTheDocument();
    });

    it('displays stage label', () => {
        render(
            <SearchResults
                tickets={[makeTicket({ stage: 'QA' })]}
                query="test"
                isLoading={false}
                totalCount={1}
            />,
        );
        expect(screen.getByText('QA')).toBeInTheDocument();
    });

    it('displays file count', () => {
        render(
            <SearchResults
                tickets={[makeTicket({ file_paths: ['a.ts', 'b.ts'] })]}
                query="test"
                isLoading={false}
                totalCount={1}
            />,
        );
        expect(screen.getByText('2 file(s)')).toBeInTheDocument();
    });
});

/* ------------------------------------------------------------------ */
/*  Navigation links (AC6)                                             */
/* ------------------------------------------------------------------ */

describe('SearchResults — Navigation', () => {
    it('renders ticket cards as links to detail page', () => {
        render(
            <SearchResults
                tickets={[makeTicket({ ticket_id: 'FORGEOS-FE003' })]}
                query="test"
                isLoading={false}
                totalCount={1}
            />,
        );
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/tickets/FORGEOS-FE003');
    });
});

/* ------------------------------------------------------------------ */
/*  Accessibility                                                      */
/* ------------------------------------------------------------------ */

describe('SearchResults — Accessibility', () => {
    it('uses role="list" and role="listitem"', () => {
        render(
            <SearchResults
                tickets={[makeTicket()]}
                query="test"
                isLoading={false}
                totalCount={1}
            />,
        );
        expect(screen.getByRole('list', { name: /search results/i })).toBeInTheDocument();
        expect(screen.getByRole('listitem')).toBeInTheDocument();
    });

    it('has aria-live for result count', () => {
        const { container } = render(
            <SearchResults
                tickets={[makeTicket()]}
                query="test"
                isLoading={false}
                totalCount={1}
            />,
        );
        const liveRegion = container.querySelector('[aria-live="polite"]');
        expect(liveRegion).toBeInTheDocument();
    });
});
