import { render, screen, fireEvent } from '@testing-library/react';
import { ClaimsTable, type ClaimRow } from '@/components/claims/ClaimsTable';

// Mock LeaseCountdown to avoid timer complexity in table tests
jest.mock('@/components/claims/LeaseCountdown', () => ({
    LeaseCountdown: ({ expiresAt }: { expiresAt: string }) => (
        <span data-testid="lease-countdown">{expiresAt}</span>
    ),
}));

function futureISO(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
}

const baseClaims: ClaimRow[] = [
    {
        ticketId: 'FORGEOS-BE001',
        ticketTitle: 'Implement health check',
        agent: 'Backend',
        machine: 'pop-os',
        operator: 'reaperoak',
        leaseExpiry: futureISO(600),
        stage: 'BACKEND',
        claimedAt: '2026-03-12T01:00:00Z',
    },
    {
        ticketId: 'FORGEOS-FE002',
        ticketTitle: 'Build dashboard UI',
        agent: 'Frontend',
        machine: 'dev-box',
        operator: 'oak',
        leaseExpiry: futureISO(120),
        stage: 'FRONTEND',
        claimedAt: '2026-03-12T01:05:00Z',
    },
    {
        ticketId: 'FORGEOS-QA003',
        ticketTitle: 'Run QA checks',
        agent: 'QA Engineer',
        machine: 'ci-runner',
        operator: 'bot',
        leaseExpiry: futureISO(30),
        stage: 'QA',
        claimedAt: '2026-03-12T01:10:00Z',
    },
];

const defaultProps = {
    claims: baseClaims,
    sortField: 'leaseRemaining' as const,
    sortDirection: 'asc' as const,
    onSort: jest.fn(),
    isLoading: false,
};

describe('ClaimsTable', () => {
    beforeEach(() => {
        defaultProps.onSort.mockClear();
    });

    // --- AC1: Displays all claim fields ---
    it('renders all ticket IDs', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getAllByText('FORGEOS-BE001').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('FORGEOS-FE002').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('FORGEOS-QA003').length).toBeGreaterThanOrEqual(1);
    });

    it('renders agent names', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getAllByText('Backend').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Frontend').length).toBeGreaterThanOrEqual(1);
    });

    it('renders machine names', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getAllByText('pop-os').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('dev-box').length).toBeGreaterThanOrEqual(1);
    });

    it('renders operator names', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getAllByText('reaperoak').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('oak').length).toBeGreaterThanOrEqual(1);
    });

    it('renders stage badges', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getAllByText('BACKEND').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('FRONTEND').length).toBeGreaterThanOrEqual(1);
    });

    it('renders LeaseCountdown for each claim', () => {
        render(<ClaimsTable {...defaultProps} />);
        const countdowns = screen.getAllByTestId('lease-countdown');
        // At least 3 (mobile cards) + 3 (table rows) = 6 instances
        expect(countdowns.length).toBeGreaterThanOrEqual(3);
    });

    // --- Column headers ---
    it('renders all 6 column headers', () => {
        render(<ClaimsTable {...defaultProps} />);
        const headers = screen.getAllByRole('columnheader');
        expect(headers).toHaveLength(6);
        const headerTexts = headers.map(h => h.textContent?.trim());
        expect(headerTexts).toContain('Ticket');
        expect(headerTexts).toContain('Agent');
        expect(headerTexts).toContain('Machine');
        expect(headerTexts).toContain('Operator');
        expect(headerTexts).toContain('Stage');
        expect(headerTexts).toContain('Lease Remaining');
    });

    // --- AC6: Sorting ---
    it('calls onSort when column header is clicked', () => {
        render(<ClaimsTable {...defaultProps} />);
        const headers = screen.getAllByRole('columnheader');
        const agentHeader = headers.find(h => h.textContent?.includes('Agent'))!;
        fireEvent.click(agentHeader);
        expect(defaultProps.onSort).toHaveBeenCalledWith('agent');
    });

    it('calls onSort on keyboard Enter on a column header', () => {
        render(<ClaimsTable {...defaultProps} />);
        const headers = screen.getAllByRole('columnheader');
        const agentHeader = headers.find(h => h.textContent?.includes('Agent'))!;
        fireEvent.keyDown(agentHeader, { key: 'Enter' });
        expect(defaultProps.onSort).toHaveBeenCalledWith('agent');
    });

    it('calls onSort on keyboard Space on a column header', () => {
        render(<ClaimsTable {...defaultProps} />);
        const headers = screen.getAllByRole('columnheader');
        const ticketHeader = headers.find(h => h.textContent?.includes('Ticket'))!;
        fireEvent.keyDown(ticketHeader, { key: ' ' });
        expect(defaultProps.onSort).toHaveBeenCalledWith('ticket');
    });

    it('shows ascending sort icon for active sort field', () => {
        render(<ClaimsTable {...defaultProps} sortField="leaseRemaining" sortDirection="asc" />);
        const headers = screen.getAllByRole('columnheader');
        const leaseHeader = headers.find(h => h.textContent?.includes('Lease Remaining'))!;
        expect(leaseHeader.querySelector('svg')).toBeInTheDocument();
    });

    it('shows descending sort icon when direction is desc', () => {
        render(<ClaimsTable {...defaultProps} sortField="agent" sortDirection="desc" />);
        const headers = screen.getAllByRole('columnheader');
        const agentHeader = headers.find(h => h.textContent?.includes('Agent'))!;
        expect(agentHeader.querySelector('svg')).toBeInTheDocument();
    });

    // --- Accessibility ---
    it('has role="table" on the table element', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getByRole('table')).toBeInTheDocument();
    });

    it('sets aria-sort="ascending" on active sort column', () => {
        render(<ClaimsTable {...defaultProps} sortField="leaseRemaining" sortDirection="asc" />);
        const headers = screen.getAllByRole('columnheader');
        const leaseHeader = headers.find(h => h.textContent?.includes('Lease Remaining'));
        expect(leaseHeader).toHaveAttribute('aria-sort', 'ascending');
    });

    it('sets aria-sort="descending" when direction is desc', () => {
        render(<ClaimsTable {...defaultProps} sortField="agent" sortDirection="desc" />);
        const headers = screen.getAllByRole('columnheader');
        const agentHeader = headers.find(h => h.textContent?.includes('Agent'));
        expect(agentHeader).toHaveAttribute('aria-sort', 'descending');
    });

    it('sets aria-sort="none" on inactive columns', () => {
        render(<ClaimsTable {...defaultProps} sortField="agent" sortDirection="asc" />);
        const headers = screen.getAllByRole('columnheader');
        const ticketHeader = headers.find(h => h.textContent?.includes('Ticket'));
        expect(ticketHeader).toHaveAttribute('aria-sort', 'none');
    });

    it('column headers are focusable via tabIndex', () => {
        render(<ClaimsTable {...defaultProps} />);
        const headers = screen.getAllByRole('columnheader');
        headers.forEach(header => {
            expect(header).toHaveAttribute('tabindex', '0');
        });
    });

    it('has aria-label on table', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getByRole('table')).toHaveAttribute('aria-label', 'Active claims monitor');
    });

    // --- Mobile card layout ---
    it('renders mobile card view with role="list"', () => {
        render(<ClaimsTable {...defaultProps} />);
        expect(screen.getByRole('list')).toBeInTheDocument();
    });

    // --- Empty state ---
    it('shows empty state when no claims', () => {
        render(<ClaimsTable {...defaultProps} claims={[]} />);
        expect(screen.getAllByText('No active claims').length).toBeGreaterThanOrEqual(1);
    });

    it('shows helpful text in empty state', () => {
        render(<ClaimsTable {...defaultProps} claims={[]} />);
        expect(
            screen.getAllByText(/When agents claim tickets/).length,
        ).toBeGreaterThanOrEqual(1);
    });

    // --- Loading state ---
    it('renders skeleton rows when loading', () => {
        const { container } = render(<ClaimsTable {...defaultProps} isLoading={true} />);
        const pulseElements = container.querySelectorAll('.animate-pulse');
        expect(pulseElements.length).toBeGreaterThan(0);
    });

    // --- Sorting logic ---
    it('sorts claims by lease remaining ascending', () => {
        render(<ClaimsTable {...defaultProps} sortField="leaseRemaining" sortDirection="asc" />);
        // QA003 (30s) should appear before FE002 (120s) before BE001 (600s)
        const ticketIds = screen.getAllByText(/FORGEOS-/).map(el => el.textContent);
        const qaIdx = ticketIds.indexOf('FORGEOS-QA003');
        const feIdx = ticketIds.indexOf('FORGEOS-FE002');
        const beIdx = ticketIds.indexOf('FORGEOS-BE001');
        // At least in the table body, QA003 should come first
        expect(qaIdx).toBeLessThan(feIdx);
        expect(feIdx).toBeLessThan(beIdx);
    });

    it('sorts claims by ticket ID ascending', () => {
        render(<ClaimsTable {...defaultProps} sortField="ticket" sortDirection="asc" />);
        const ticketIds = screen.getAllByText(/FORGEOS-/).map(el => el.textContent);
        const beIdx = ticketIds.indexOf('FORGEOS-BE001');
        const feIdx = ticketIds.indexOf('FORGEOS-FE002');
        expect(beIdx).toBeLessThan(feIdx);
    });

    it('sorts claims descending when direction is desc', () => {
        render(<ClaimsTable {...defaultProps} sortField="leaseRemaining" sortDirection="desc" />);
        const ticketIds = screen.getAllByText(/FORGEOS-/).map(el => el.textContent);
        const beIdx = ticketIds.indexOf('FORGEOS-BE001');
        const qaIdx = ticketIds.indexOf('FORGEOS-QA003');
        // BE001 (600s) should appear before QA003 (30s)
        expect(beIdx).toBeLessThan(qaIdx);
    });

    // --- Row state styling ---
    it('applies warning row classes for claims with <5min remaining', () => {
        const warningClaim: ClaimRow = {
            ticketId: 'WARN-001',
            ticketTitle: 'Warning claim',
            agent: 'Agent',
            machine: 'box',
            operator: 'op',
            leaseExpiry: futureISO(200),
            stage: 'BACKEND',
            claimedAt: '2026-03-12T01:00:00Z',
        };
        const { container } = render(
            <ClaimsTable {...defaultProps} claims={[warningClaim]} />,
        );
        // Check that the table row has warning classes
        const rows = container.querySelectorAll('tr');
        const dataRow = Array.from(rows).find(r => r.textContent?.includes('WARN-001'));
        expect(dataRow?.className).toContain('border-warning');
    });

    it('applies critical row classes for claims with <1min remaining', () => {
        const criticalClaim: ClaimRow = {
            ticketId: 'CRIT-001',
            ticketTitle: 'Critical claim',
            agent: 'Agent',
            machine: 'box',
            operator: 'op',
            leaseExpiry: futureISO(30),
            stage: 'QA',
            claimedAt: '2026-03-12T01:00:00Z',
        };
        const { container } = render(
            <ClaimsTable {...defaultProps} claims={[criticalClaim]} />,
        );
        const rows = container.querySelectorAll('tr');
        const dataRow = Array.from(rows).find(r => r.textContent?.includes('CRIT-001'));
        expect(dataRow?.className).toContain('border-error');
    });

    it('applies expired row classes with reduced opacity', () => {
        const expiredClaim: ClaimRow = {
            ticketId: 'EXP-001',
            ticketTitle: 'Expired claim',
            agent: 'Agent',
            machine: 'box',
            operator: 'op',
            leaseExpiry: new Date(Date.now() - 5000).toISOString(),
            stage: 'SECURITY',
            claimedAt: '2026-03-12T01:00:00Z',
        };
        const { container } = render(
            <ClaimsTable {...defaultProps} claims={[expiredClaim]} />,
        );
        const rows = container.querySelectorAll('tr');
        const dataRow = Array.from(rows).find(r => r.textContent?.includes('EXP-001'));
        expect(dataRow?.className).toContain('opacity-80');
    });
});
