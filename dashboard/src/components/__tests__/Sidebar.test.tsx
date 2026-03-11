import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '@/components/Sidebar';

// Mock next/navigation
const mockPathname = jest.fn().mockReturnValue('/');
jest.mock('next/navigation', () => ({
    usePathname: () => mockPathname(),
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    Home: (props: Record<string, unknown>) => <span data-testid="icon-home" {...props} />,
    LayoutDashboard: (props: Record<string, unknown>) => <span data-testid="icon-layout" {...props} />,
    Clock: (props: Record<string, unknown>) => <span data-testid="icon-clock" {...props} />,
    Users: (props: Record<string, unknown>) => <span data-testid="icon-users" {...props} />,
    HeartPulse: (props: Record<string, unknown>) => <span data-testid="icon-heart" {...props} />,
    Settings: (props: Record<string, unknown>) => <span data-testid="icon-settings" {...props} />,
    ChevronLeft: (props: Record<string, unknown>) => <span data-testid="icon-chevron-left" {...props} />,
    ChevronRight: (props: Record<string, unknown>) => <span data-testid="icon-chevron-right" {...props} />,
}));

// Mock ThemeToggle
jest.mock('@/components/ThemeToggle', () => ({
    ThemeToggle: ({ compact }: { compact?: boolean }) => (
        <button data-testid="theme-toggle" data-compact={compact}>
            Toggle
        </button>
    ),
}));

describe('Sidebar', () => {
    beforeEach(() => {
        mockPathname.mockReturnValue('/');
    });

    it('renders navigation with accessible label', () => {
        render(<Sidebar isCollapsed={false} onToggleCollapse={() => { }} />);
        expect(
            screen.getByRole('navigation', { name: 'Main navigation' }),
        ).toBeInTheDocument();
    });

    it('renders all nav items when expanded', () => {
        render(<Sidebar isCollapsed={false} onToggleCollapse={() => { }} />);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Pipeline')).toBeInTheDocument();
        expect(screen.getByText('Claims')).toBeInTheDocument();
        expect(screen.getByText('Agents')).toBeInTheDocument();
        expect(screen.getByText('Health')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders ForgeOS branding when expanded', () => {
        render(<Sidebar isCollapsed={false} onToggleCollapse={() => { }} />);
        expect(screen.getByText('ForgeOS')).toBeInTheDocument();
    });

    it('hides branding when collapsed', () => {
        render(<Sidebar isCollapsed={true} onToggleCollapse={() => { }} />);
        expect(screen.queryByText('ForgeOS')).not.toBeInTheDocument();
    });

    it('hides nav labels when collapsed', () => {
        render(<Sidebar isCollapsed={true} onToggleCollapse={() => { }} />);
        expect(screen.queryByText('Dashboard')).not.toBeInTheDocument();
        expect(screen.queryByText('Pipeline')).not.toBeInTheDocument();
    });

    it('shows collapse button with correct aria-label when expanded', () => {
        render(<Sidebar isCollapsed={false} onToggleCollapse={() => { }} />);
        expect(
            screen.getByRole('button', { name: 'Collapse sidebar' }),
        ).toBeInTheDocument();
    });

    it('shows expand button with correct aria-label when collapsed', () => {
        render(<Sidebar isCollapsed={true} onToggleCollapse={() => { }} />);
        expect(
            screen.getByRole('button', { name: 'Expand sidebar' }),
        ).toBeInTheDocument();
    });

    it('calls onToggleCollapse when collapse button is clicked', () => {
        const onToggle = jest.fn();
        render(<Sidebar isCollapsed={false} onToggleCollapse={onToggle} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Collapse sidebar' }),
        );
        expect(onToggle).toHaveBeenCalledTimes(1);
    });

    it('marks active route with aria-current="page"', () => {
        mockPathname.mockReturnValue('/health');
        render(<Sidebar isCollapsed={false} onToggleCollapse={() => { }} />);
        const healthLink = screen.getByRole('link', { name: 'Health' });
        expect(healthLink).toHaveAttribute('aria-current', 'page');
    });

    it('does not mark inactive routes with aria-current', () => {
        mockPathname.mockReturnValue('/');
        render(<Sidebar isCollapsed={false} onToggleCollapse={() => { }} />);
        const pipelineLink = screen.getByRole('link', { name: 'Pipeline' });
        expect(pipelineLink).not.toHaveAttribute('aria-current');
    });

    it('renders user info when expanded', () => {
        render(<Sidebar isCollapsed={false} onToggleCollapse={() => { }} />);
        expect(screen.getByText('ReaperOAK')).toBeInTheDocument();
        expect(screen.getByText('Operator')).toBeInTheDocument();
    });

    it('hides user info when collapsed', () => {
        render(<Sidebar isCollapsed={true} onToggleCollapse={() => { }} />);
        expect(screen.queryByText('ReaperOAK')).not.toBeInTheDocument();
    });

    it('renders ThemeToggle with compact prop matching collapse state', () => {
        render(<Sidebar isCollapsed={true} onToggleCollapse={() => { }} />);
        expect(screen.getByTestId('theme-toggle')).toHaveAttribute(
            'data-compact',
            'true',
        );
    });
});
