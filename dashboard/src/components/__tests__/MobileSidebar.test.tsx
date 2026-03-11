import { render, screen, fireEvent } from '@testing-library/react';
import { MobileSidebar } from '@/components/MobileSidebar';

// Mock next/navigation
jest.mock('next/navigation', () => ({
    usePathname: () => '/',
}));

// Mock lucide-react icons
jest.mock('lucide-react', () => ({
    X: (props: Record<string, unknown>) => <span data-testid="icon-x" {...props} />,
    Home: (props: Record<string, unknown>) => <span data-testid="icon-home" {...props} />,
    LayoutDashboard: (props: Record<string, unknown>) => <span {...props} />,
    Clock: (props: Record<string, unknown>) => <span {...props} />,
    Users: (props: Record<string, unknown>) => <span {...props} />,
    HeartPulse: (props: Record<string, unknown>) => <span {...props} />,
    Settings: (props: Record<string, unknown>) => <span {...props} />,
}));

// Mock ThemeToggle
jest.mock('@/components/ThemeToggle', () => ({
    ThemeToggle: () => <button data-testid="theme-toggle">Toggle</button>,
}));

describe('MobileSidebar', () => {
    it('renders nothing when closed', () => {
        const { container } = render(
            <MobileSidebar isOpen={false} onClose={() => {}} />,
        );
        expect(container.firstChild).toBeNull();
    });

    it('renders dialog when open', () => {
        render(<MobileSidebar isOpen={true} onClose={() => {}} />);
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });

    it('has aria-modal="true" when open', () => {
        render(<MobileSidebar isOpen={true} onClose={() => {}} />);
        expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    });

    it('renders close button with aria-label', () => {
        render(<MobileSidebar isOpen={true} onClose={() => {}} />);
        expect(
            screen.getByRole('button', { name: 'Close navigation' }),
        ).toBeInTheDocument();
    });

    it('calls onClose when close button is clicked', () => {
        const onClose = jest.fn();
        render(<MobileSidebar isOpen={true} onClose={onClose} />);
        fireEvent.click(
            screen.getByRole('button', { name: 'Close navigation' }),
        );
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('calls onClose on Escape key', () => {
        const onClose = jest.fn();
        render(<MobileSidebar isOpen={true} onClose={onClose} />);
        fireEvent.keyDown(document, { key: 'Escape' });
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('renders all navigation items', () => {
        render(<MobileSidebar isOpen={true} onClose={() => {}} />);
        expect(screen.getByText('Dashboard')).toBeInTheDocument();
        expect(screen.getByText('Pipeline')).toBeInTheDocument();
        expect(screen.getByText('Claims')).toBeInTheDocument();
        expect(screen.getByText('Agents')).toBeInTheDocument();
        expect(screen.getByText('Health')).toBeInTheDocument();
        expect(screen.getByText('Settings')).toBeInTheDocument();
    });

    it('renders ForgeOS branding', () => {
        render(<MobileSidebar isOpen={true} onClose={() => {}} />);
        expect(screen.getByText('ForgeOS')).toBeInTheDocument();
    });

    it('renders user info', () => {
        render(<MobileSidebar isOpen={true} onClose={() => {}} />);
        expect(screen.getByText('ReaperOAK')).toBeInTheDocument();
        expect(screen.getByText('Operator')).toBeInTheDocument();
    });

    it('renders ThemeToggle', () => {
        render(<MobileSidebar isOpen={true} onClose={() => {}} />);
        expect(screen.getByTestId('theme-toggle')).toBeInTheDocument();
    });

    it('calls onClose when scrim is clicked', () => {
        const onClose = jest.fn();
        render(<MobileSidebar isOpen={true} onClose={onClose} />);
        // The scrim is the first div with aria-hidden="true" and onClick
        const scrim = screen.getByRole('dialog').parentElement?.querySelector('[aria-hidden="true"]');
        if (scrim) fireEvent.click(scrim);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
