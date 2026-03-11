import { render, screen, act } from '@testing-library/react';
import { ConnectionStatusIndicator } from '@/components/ConnectionStatusIndicator';

describe('ConnectionStatusIndicator', () => {
  it('shows green dot and "Connected" for connected status', () => {
    render(<ConnectionStatusIndicator status="connected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('aria-label', 'WebSocket Connected');
    expect(screen.getByText('Connected')).toBeInTheDocument();
  });

  it('shows yellow pulsing dot and "Connecting…" for connecting status', () => {
    render(<ConnectionStatusIndicator status="connecting" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('aria-label', 'WebSocket Connecting…');
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
    // Verify pulse animation class
    const dot = indicator.querySelector('span:first-child');
    expect(dot?.className).toContain('animate-pulse');
  });

  it('shows red dot and "Disconnected" for disconnected status', () => {
    render(<ConnectionStatusIndicator status="disconnected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('aria-label', 'WebSocket Disconnected');
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('has accessible role="status" and aria-live', () => {
    render(<ConnectionStatusIndicator status="connected" />);
    const indicator = screen.getByRole('status');
    expect(indicator).toHaveAttribute('aria-live', 'polite');
  });
});
