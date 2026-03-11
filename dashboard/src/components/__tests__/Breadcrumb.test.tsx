import { render, screen } from '@testing-library/react';
import { Breadcrumb } from '@/components/Breadcrumb';

describe('Breadcrumb', () => {
    it('renders a single breadcrumb item', () => {
        render(<Breadcrumb items={[{ label: 'Home' }]} />);
        expect(screen.getByText('Home')).toBeInTheDocument();
        expect(screen.getByRole('navigation', { name: 'Breadcrumbs' })).toBeInTheDocument();
    });

    it('renders multiple breadcrumb items with separators', () => {
        render(
            <Breadcrumb
                items={[
                    { label: 'Dashboard', href: '/' },
                    { label: 'Overview' },
                ]}
            />,
        );
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Overview')).toBeInTheDocument();
        expect(screen.getByText('>')).toBeInTheDocument();
    });

    it('renders the last item with aria-current="page"', () => {
        render(
            <Breadcrumb
                items={[
                    { label: 'Dashboard', href: '/' },
                    { label: 'Overview' },
                ]}
            />,
        );
        const lastItem = screen.getByText('Overview');
        expect(lastItem).toHaveAttribute('aria-current', 'page');
    });

    it('renders linked items as links', () => {
        render(
            <Breadcrumb
                items={[
                    { label: 'Dashboard', href: '/' },
                    { label: 'Current' },
                ]}
            />,
        );
        const link = screen.getByRole('link', { name: 'Dashboard' });
        expect(link).toHaveAttribute('href', '/');
    });

    it('renders non-linked non-last items as plain text', () => {
        render(
            <Breadcrumb
                items={[
                    { label: 'Dashboard' },
                    { label: 'Sub' },
                    { label: 'Current' },
                ]}
            />,
        );
        // First item has no href, should be a span not a link
        const dashboardEl = screen.getByText('Dashboard');
        expect(dashboardEl.tagName).toBe('SPAN');
    });

    it('renders empty items array without crashing', () => {
        render(<Breadcrumb items={[]} />);
        expect(screen.getByRole('navigation', { name: 'Breadcrumbs' })).toBeInTheDocument();
    });
});
