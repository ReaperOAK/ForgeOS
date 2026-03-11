import { render, screen, fireEvent, act } from '@testing-library/react';
import { DashboardShell } from '@/components/DashboardShell';

// Mock next/navigation
jest.mock('next/navigation', () => ({
    usePathname: () => '/',
}));

// Mock child components to isolate DashboardShell logic
jest.mock('@/components/Sidebar', () => ({
    Sidebar: ({ isCollapsed, onToggleCollapse }: { isCollapsed: boolean; onToggleCollapse: () => void }) => (
        <nav data-testid="sidebar" data-collapsed={isCollapsed}>
            <button data-testid="toggle-sidebar" onClick={onToggleCollapse}>
                Toggle
            </button>
        </nav>
    ),
}));

jest.mock('@/components/TopBar', () => ({
    TopBar: ({ breadcrumbs, onMenuToggle }: { breadcrumbs: { label: string }[]; onMenuToggle?: () => void }) => (
        <header data-testid="topbar">
            <span data-testid="breadcrumb-count">{breadcrumbs.length}</span>
            {onMenuToggle && (
                <button data-testid="menu-toggle" onClick={onMenuToggle}>
                    Menu
                </button>
            )}
        </header>
    ),
}));

jest.mock('@/components/MobileSidebar', () => ({
    MobileSidebar: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) =>
        isOpen ? (
            <div data-testid="mobile-sidebar">
                <button data-testid="close-mobile" onClick={onClose}>
                    Close
                </button>
            </div>
        ) : null,
}));

describe('DashboardShell', () => {
    it('renders sidebar, topbar, and main content', () => {
        render(
            <DashboardShell>
                <div data-testid="content">Content</div>
            </DashboardShell>,
        );
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
        expect(screen.getByTestId('topbar')).toBeInTheDocument();
        expect(screen.getByTestId('content')).toBeInTheDocument();
    });

    it('passes children to main area', () => {
        render(
            <DashboardShell>
                <p>Hello World</p>
            </DashboardShell>,
        );
        expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('sidebar starts expanded', () => {
        render(<DashboardShell><div /></DashboardShell>);
        expect(screen.getByTestId('sidebar')).toHaveAttribute(
            'data-collapsed',
            'false',
        );
    });

    it('toggles sidebar collapse state', () => {
        render(<DashboardShell><div /></DashboardShell>);
        expect(screen.getByTestId('sidebar')).toHaveAttribute(
            'data-collapsed',
            'false',
        );

        act(() => {
            fireEvent.click(screen.getByTestId('toggle-sidebar'));
        });

        expect(screen.getByTestId('sidebar')).toHaveAttribute(
            'data-collapsed',
            'true',
        );
    });

    it('generates breadcrumbs for root route', () => {
        render(<DashboardShell><div /></DashboardShell>);
        // Root route produces 2 breadcrumbs: Dashboard + Overview
        expect(screen.getByTestId('breadcrumb-count')).toHaveTextContent('2');
    });

    it('mobile sidebar is closed by default', () => {
        render(<DashboardShell><div /></DashboardShell>);
        expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();
    });

    it('opens mobile sidebar via menu toggle', () => {
        render(<DashboardShell><div /></DashboardShell>);

        act(() => {
            fireEvent.click(screen.getByTestId('menu-toggle'));
        });

        expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();
    });

    it('closes mobile sidebar', () => {
        render(<DashboardShell><div /></DashboardShell>);

        act(() => {
            fireEvent.click(screen.getByTestId('menu-toggle'));
        });
        expect(screen.getByTestId('mobile-sidebar')).toBeInTheDocument();

        act(() => {
            fireEvent.click(screen.getByTestId('close-mobile'));
        });
        expect(screen.queryByTestId('mobile-sidebar')).not.toBeInTheDocument();
    });
});
