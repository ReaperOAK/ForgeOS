import { render, screen } from '@testing-library/react';
import TicketNotFound from '@/app/tickets/[id]/not-found';

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

describe('TicketNotFound', () => {
    it('renders 404 heading', () => {
        render(<TicketNotFound />);
        expect(screen.getByText('404')).toBeInTheDocument();
    });

    it('renders "Ticket Not Found" message', () => {
        render(<TicketNotFound />);
        expect(screen.getByText('Ticket Not Found')).toBeInTheDocument();
    });

    it('shows descriptive text', () => {
        render(<TicketNotFound />);
        expect(screen.getByText(/doesn't exist or has been removed/)).toBeInTheDocument();
    });

    it('renders link back to pipeline', () => {
        render(<TicketNotFound />);
        const link = screen.getByRole('link', { name: /Back to Pipeline/ });
        expect(link).toHaveAttribute('href', '/pipeline');
    });
});
