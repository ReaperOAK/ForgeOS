import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeToggle } from '@/components/ThemeToggle';

// Mock the theme context
const mockToggleTheme = jest.fn();
let mockTheme = 'dark';

jest.mock('@/lib/theme', () => ({
    useTheme: () => ({
        theme: mockTheme,
        toggleTheme: mockToggleTheme,
    }),
}));

describe('ThemeToggle', () => {
    beforeEach(() => {
        mockTheme = 'dark';
        mockToggleTheme.mockClear();
    });

    it('renders with role="switch"', () => {
        render(<ThemeToggle />);
        expect(screen.getByRole('switch')).toBeInTheDocument();
    });

    it('has aria-label "Toggle dark mode"', () => {
        render(<ThemeToggle />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-label', 'Toggle dark mode');
    });

    it('shows aria-checked=true in dark mode', () => {
        mockTheme = 'dark';
        render(<ThemeToggle />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
    });

    it('shows aria-checked=false in light mode', () => {
        mockTheme = 'light';
        render(<ThemeToggle />);
        expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'false');
    });

    it('calls toggleTheme on click', () => {
        render(<ThemeToggle />);
        fireEvent.click(screen.getByRole('switch'));
        expect(mockToggleTheme).toHaveBeenCalledTimes(1);
    });

    it('shows theme label in non-compact mode', () => {
        mockTheme = 'dark';
        render(<ThemeToggle />);
        expect(screen.getByText('Dark')).toBeInTheDocument();
    });

    it('shows "Light" label in light mode', () => {
        mockTheme = 'light';
        render(<ThemeToggle />);
        expect(screen.getByText('Light')).toBeInTheDocument();
    });

    it('hides label in compact mode', () => {
        render(<ThemeToggle compact />);
        expect(screen.queryByText('Dark')).not.toBeInTheDocument();
        expect(screen.queryByText('Light')).not.toBeInTheDocument();
    });
});
