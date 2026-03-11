import { render, screen, fireEvent, act } from '@testing-library/react';
import { ThemeProvider, useTheme } from '@/lib/theme';

// Test consumer component
function ThemeConsumer() {
    const { theme, toggleTheme } = useTheme();
    return (
        <div>
            <span data-testid="theme">{theme}</span>
            <button data-testid="toggle" onClick={toggleTheme}>
                Toggle
            </button>
        </div>
    );
}

describe('ThemeProvider', () => {
    const originalMatchMedia = window.matchMedia;
    const originalLocalStorage = { ...window.localStorage };

    beforeEach(() => {
        localStorage.clear();
        // Mock matchMedia
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: jest.fn().mockImplementation((query: string) => ({
                matches: false, // default: prefers dark
                media: query,
                onchange: null,
                addListener: jest.fn(),
                removeListener: jest.fn(),
                addEventListener: jest.fn(),
                removeEventListener: jest.fn(),
                dispatchEvent: jest.fn(),
            })),
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: originalMatchMedia,
        });
    });

    it('provides theme context to children', () => {
        render(
            <ThemeProvider>
                <ThemeConsumer />
            </ThemeProvider>,
        );
        // After mount, should show dark (default when no localStorage and prefers-color-scheme doesn't match light)
        expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('toggles theme from dark to light', () => {
        render(
            <ThemeProvider>
                <ThemeConsumer />
            </ThemeProvider>,
        );

        act(() => {
            fireEvent.click(screen.getByTestId('toggle'));
        });

        expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('toggles theme from light back to dark', () => {
        localStorage.setItem('forgeos-theme', 'light');
        render(
            <ThemeProvider>
                <ThemeConsumer />
            </ThemeProvider>,
        );

        act(() => {
            fireEvent.click(screen.getByTestId('toggle'));
        });

        expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });

    it('persists theme to localStorage', () => {
        render(
            <ThemeProvider>
                <ThemeConsumer />
            </ThemeProvider>,
        );

        act(() => {
            fireEvent.click(screen.getByTestId('toggle'));
        });

        expect(localStorage.getItem('forgeos-theme')).toBe('light');
    });

    it('reads theme from localStorage on mount', () => {
        localStorage.setItem('forgeos-theme', 'light');
        render(
            <ThemeProvider>
                <ThemeConsumer />
            </ThemeProvider>,
        );
        expect(screen.getByTestId('theme')).toHaveTextContent('light');
    });

    it('defaults to dark when localStorage is empty and prefers-color-scheme is dark', () => {
        render(
            <ThemeProvider>
                <ThemeConsumer />
            </ThemeProvider>,
        );
        expect(screen.getByTestId('theme')).toHaveTextContent('dark');
    });
});

describe('useTheme', () => {
    it('throws when used outside ThemeProvider', () => {
        // Suppress console.error for this test
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => { });
        expect(() => render(<ThemeConsumer />)).toThrow(
            'useTheme must be used within ThemeProvider',
        );
        consoleSpy.mockRestore();
    });
});
