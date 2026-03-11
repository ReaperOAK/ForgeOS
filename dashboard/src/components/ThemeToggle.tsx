'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from '@/lib/theme';

interface ThemeToggleProps {
    compact?: boolean;
}

export function ThemeToggle({ compact = false }: ThemeToggleProps) {
    const { theme, toggleTheme } = useTheme();
    const isDark = theme === 'dark';

    return (
        <button
            role="switch"
            aria-checked={isDark}
            aria-label="Toggle dark mode"
            onClick={toggleTheme}
            className={`flex items-center gap-2 rounded-lg transition-colors hover:bg-surface-alt focus-ring ${compact ? 'p-2 justify-center' : 'px-3 py-2 w-full'
                }`}
        >
            {isDark ? (
                <Moon size={18} aria-hidden="true" />
            ) : (
                <Sun size={18} aria-hidden="true" />
            )}
            {!compact && (
                <span className="text-sm text-muted">{isDark ? 'Dark' : 'Light'}</span>
            )}
        </button>
    );
}
