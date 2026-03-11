import { render, screen } from '@testing-library/react';
import { MetricCard } from '@/components/MetricCard';

describe('MetricCard', () => {
    it('renders label and numeric value', () => {
        render(<MetricCard label="Active Tickets" value={12} />);
        expect(screen.getByText('Active Tickets')).toBeInTheDocument();
        expect(screen.getByText('12')).toBeInTheDocument();
    });

    it('renders label and string value', () => {
        render(<MetricCard label="Services" value="5/5" />);
        expect(screen.getByText('Services')).toBeInTheDocument();
        expect(screen.getByText('5/5')).toBeInTheDocument();
    });

    it('has correct aria-label', () => {
        render(<MetricCard label="Active Tickets" value={12} />);
        expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Active Tickets: 12');
    });

    it('renders up trend with arrow and value', () => {
        render(
            <MetricCard
                label="Tickets"
                value={12}
                trend={{ direction: 'up', value: '+3' }}
            />,
        );
        expect(screen.getByText(/\+3/)).toBeInTheDocument();
        expect(screen.getByText(/↑/)).toBeInTheDocument();
    });

    it('renders down trend with arrow and value', () => {
        render(
            <MetricCard
                label="Blocked"
                value={2}
                trend={{ direction: 'down', value: '-1' }}
            />,
        );
        expect(screen.getByText(/-1/)).toBeInTheDocument();
        expect(screen.getByText(/↓/)).toBeInTheDocument();
    });

    it('renders flat trend with arrow', () => {
        render(
            <MetricCard
                label="Stable"
                value={5}
                trend={{ direction: 'flat', value: '0' }}
            />,
        );
        expect(screen.getByText(/→/)).toBeInTheDocument();
    });

    it('renders loading skeleton when isLoading is true', () => {
        render(<MetricCard label="Loading" value={0} isLoading />);
        expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading: loading');
        // Value should NOT be rendered during loading
        expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('renders icon when provided', () => {
        render(
            <MetricCard
                label="Test"
                value={1}
                icon={<span data-testid="icon">IC</span>}
            />,
        );
        expect(screen.getByTestId('icon')).toBeInTheDocument();
    });
});
