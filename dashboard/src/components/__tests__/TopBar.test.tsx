import { render, screen } from '@testing-library/react';
import { TopBar } from '@/components/TopBar';

describe('TopBar', () => {
    it('renders with role="banner"', () => {
        render(<TopBar breadcrumbs={[{ label: 'Dashboard' }]} />);
        expect(screen.getByRole('banner')).toBeInTheDocument();
    });

    it('renders breadcrumbs', () => {
        render(
            <TopBar
                breadcrumbs={[
                    { label: 'Dashboard', href: '/' },
                    { label: 'Overview' },
                ]}
            />,
        );
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Overview')).toBeInTheDocument();
    });

    it('renders search button with aria-label', () => {
        render(<TopBar breadcrumbs={[]} />);
        expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    });

    it('renders notifications button with aria-label', () => {
        render(<TopBar breadcrumbs={[]} />);
        expect(
            screen.getByRole('button', { name: /Notifications/i }),
        ).toBeInTheDocument();
    });

    it('renders menu toggle button for mobile', () => {
        render(<TopBar breadcrumbs={[]} onMenuToggle={() => {}} />);
        expect(
            screen.getByRole('button', { name: 'Open navigation menu' }),
        ).toBeInTheDocument();
    });

    it('calls onMenuToggle when menu button is clicked', () => {
        const onMenuToggle = jest.fn();
        render(<TopBar breadcrumbs={[]} onMenuToggle={onMenuToggle} />);
        screen.getByRole('button', { name: 'Open navigation menu' }).click();
        expect(onMenuToggle).toHaveBeenCalledTimes(1);
    });

    it('renders connection status indicator', () => {
        render(<TopBar breadcrumbs={[]} />);
        expect(screen.getByText('Live')).toBeInTheDocument();
    });
});
