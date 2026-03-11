import { render, screen } from '@testing-library/react';
import { TicketCard } from '@/components/pipeline/TicketCard';

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

const baseProps = {
    ticketId: 'FORGEOS-BE001',
    title: 'Implement health check endpoint',
    type: 'backend' as const,
    priority: 'high' as const,
    claimedBy: 'BackendAgent',
    machineId: 'pop-os',
    reworkCount: 0,
};

describe('TicketCard', () => {
    it('renders ticket ID', () => {
        render(<TicketCard {...baseProps} />);
        expect(screen.getByText('FORGEOS-BE001')).toBeInTheDocument();
    });

    it('renders title', () => {
        render(<TicketCard {...baseProps} />);
        expect(
            screen.getByText('Implement health check endpoint'),
        ).toBeInTheDocument();
    });

    it('truncates title longer than 50 characters', () => {
        const longTitle =
            'This is a very long title that exceeds the fifty character limit easily';
        render(<TicketCard {...baseProps} title={longTitle} />);
        // Should be truncated at 50 chars + ellipsis
        const truncated = longTitle.slice(0, 50) + '…';
        expect(screen.getByText(truncated)).toBeInTheDocument();
    });

    it('does not truncate title of exactly 50 characters', () => {
        const exact50 = 'A'.repeat(50);
        render(<TicketCard {...baseProps} title={exact50} />);
        expect(screen.getByText(exact50)).toBeInTheDocument();
    });

    it('displays type badge with correct text', () => {
        render(<TicketCard {...baseProps} />);
        expect(screen.getByText('backend')).toBeInTheDocument();
    });

    it('renders blue type badge for backend', () => {
        const { container } = render(<TicketCard {...baseProps} type="backend" />);
        const badge = screen.getByText('backend');
        expect(badge.className).toContain('bg-blue-500');
    });

    it('renders teal type badge for frontend', () => {
        render(<TicketCard {...baseProps} type="frontend" />);
        const badge = screen.getByText('frontend');
        expect(badge.className).toContain('bg-teal-500');
    });

    it('renders purple type badge for fullstack', () => {
        render(<TicketCard {...baseProps} type="fullstack" />);
        const badge = screen.getByText('fullstack');
        expect(badge.className).toContain('bg-purple-500');
    });

    it('renders orange type badge for infra', () => {
        render(<TicketCard {...baseProps} type="infra" />);
        const badge = screen.getByText('infra');
        expect(badge.className).toContain('bg-orange-500');
    });

    it('renders red type badge for security', () => {
        render(<TicketCard {...baseProps} type="security" />);
        const badge = screen.getByText('security');
        expect(badge.className).toContain('bg-red-500');
    });

    it('renders gray type badge for docs', () => {
        render(<TicketCard {...baseProps} type="docs" />);
        const badge = screen.getByText('docs');
        expect(badge.className).toContain('bg-gray-500');
    });

    it('renders priority dot with correct color for high', () => {
        render(<TicketCard {...baseProps} priority="high" />);
        const dot = screen.getByLabelText('high priority');
        expect(dot.className).toContain('bg-orange-500');
    });

    it('renders priority dot for critical', () => {
        render(<TicketCard {...baseProps} priority="critical" />);
        const dot = screen.getByLabelText('critical priority');
        expect(dot.className).toContain('bg-red-500');
    });

    it('renders priority dot for medium', () => {
        render(<TicketCard {...baseProps} priority="medium" />);
        const dot = screen.getByLabelText('medium priority');
        expect(dot.className).toContain('bg-blue-500');
    });

    it('renders priority dot for low', () => {
        render(<TicketCard {...baseProps} priority="low" />);
        const dot = screen.getByLabelText('low priority');
        expect(dot.className).toContain('bg-gray-500');
    });

    it('displays claimed_by when provided', () => {
        render(<TicketCard {...baseProps} claimedBy="BackendAgent" />);
        expect(screen.getByText('BackendAgent')).toBeInTheDocument();
    });

    it('shows "Unclaimed" when claimedBy is null', () => {
        render(<TicketCard {...baseProps} claimedBy={null} />);
        expect(screen.getByText('Unclaimed')).toBeInTheDocument();
    });

    it('navigates to ticket detail page via Link', () => {
        render(<TicketCard {...baseProps} />);
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute('href', '/tickets/FORGEOS-BE001');
    });

    it('encodes special characters in ticket ID for URL', () => {
        render(<TicketCard {...baseProps} ticketId="FORGE/OS#1" />);
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute(
            'href',
            `/tickets/${encodeURIComponent('FORGE/OS#1')}`,
        );
    });

    it('renders machine ID badge when provided', () => {
        render(<TicketCard {...baseProps} machineId="pop-os" />);
        expect(screen.getByText('pop-os')).toBeInTheDocument();
    });

    it('does not render machine badge when machineId is null', () => {
        render(<TicketCard {...baseProps} machineId={null} />);
        expect(screen.queryByText('pop-os')).not.toBeInTheDocument();
    });

    it('renders rework badge when reworkCount > 0', () => {
        render(<TicketCard {...baseProps} reworkCount={2} />);
        expect(screen.getByText('R2')).toBeInTheDocument();
    });

    it('does not render rework badge when reworkCount is 0', () => {
        render(<TicketCard {...baseProps} reworkCount={0} />);
        expect(screen.queryByText('R0')).not.toBeInTheDocument();
    });

    it('has accessible aria-label with ticket ID and title', () => {
        render(<TicketCard {...baseProps} />);
        const link = screen.getByRole('link');
        expect(link).toHaveAttribute(
            'aria-label',
            'FORGEOS-BE001: Implement health check endpoint',
        );
    });
});
