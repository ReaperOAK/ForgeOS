import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover: 'var(--color-primary-hover)',
          muted: 'var(--color-primary-muted)',
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          hover: 'var(--color-secondary-hover)',
        },
        accent: 'var(--color-accent)',
        surface: {
          DEFAULT: 'var(--color-surface)',
          alt: 'var(--color-surface-alt)',
        },
        background: 'var(--color-background)',
        border: {
          DEFAULT: 'var(--color-border)',
          subtle: 'var(--color-border-subtle)',
        },
        foreground: 'var(--color-text)',
        muted: 'var(--color-text-muted)',
        inverse: 'var(--color-text-inverse)',
        error: {
          DEFAULT: 'var(--color-error)',
          muted: 'var(--color-error-muted)',
        },
        warning: {
          DEFAULT: 'var(--color-warning)',
          muted: 'var(--color-warning-muted)',
        },
        success: {
          DEFAULT: 'var(--color-success)',
          muted: 'var(--color-success-muted)',
        },
        info: {
          DEFAULT: 'var(--color-info)',
          muted: 'var(--color-info-muted)',
        },
        scrim: 'var(--color-scrim)',
        focus: 'var(--color-focus)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
      },
      spacing: {
        'sidebar-expanded': '280px',
        'sidebar-collapsed': '64px',
        topbar: '56px',
      },
      transitionDuration: {
        fast: '150ms',
        normal: '250ms',
        slow: '500ms',
      },
      zIndex: {
        dropdown: '10',
        sticky: '20',
        overlay: '30',
        'slide-over': '40',
        modal: '50',
        toast: '60',
        tooltip: '70',
      },
      animation: {
        'slide-in': 'slideIn 250ms ease-out',
      },
      keyframes: {
        slideIn: {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
      },
    },
  },
  plugins: [],
};

export default config;
