import { render, screen, act } from '@testing-library/react';
import { LeaseCountdown } from '@/components/claims/LeaseCountdown';

function futureISO(seconds: number): string {
    return new Date(Date.now() + seconds * 1000).toISOString();
}

describe('LeaseCountdown', () => {
    beforeEach(() => {
        jest.useFakeTimers();
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    // --- AC2: MM:SS format ---
    it('displays remaining time in MM:SS format', () => {
        render(<LeaseCountdown expiresAt={futureISO(272)} />);
        // 272s = 4:32
        expect(screen.getByText('04:32')).toBeInTheDocument();
    });

    it('zero-pads single-digit minutes and seconds', () => {
        render(<LeaseCountdown expiresAt={futureISO(65)} />);
        expect(screen.getByText('01:05')).toBeInTheDocument();
    });

    it('shows 00:00 when exactly at expiry', () => {
        render(<LeaseCountdown expiresAt={new Date().toISOString()} />);
        expect(screen.getByText('EXPIRED')).toBeInTheDocument();
    });

    // --- AC3: Warning state (<5 min) ---
    it('applies warning styling when lease < 5 minutes', () => {
        render(<LeaseCountdown expiresAt={futureISO(200)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('text-warning');
    });

    it('does not apply warning styling at exactly 300 seconds', () => {
        render(<LeaseCountdown expiresAt={futureISO(301)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).not.toContain('text-warning');
        expect(timer.innerHTML).toContain('text-success');
    });

    it('shows warning dot with animate-pulse', () => {
        render(<LeaseCountdown expiresAt={futureISO(200)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('bg-warning');
        expect(timer.innerHTML).toContain('animate-pulse');
    });

    // --- AC4: Critical state (<1 min) ---
    it('applies critical styling when lease < 1 minute', () => {
        render(<LeaseCountdown expiresAt={futureISO(45)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('text-error');
        expect(timer.innerHTML).toContain('font-bold');
    });

    it('shows critical dot with animate-pulse', () => {
        render(<LeaseCountdown expiresAt={futureISO(30)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('bg-error');
        expect(timer.innerHTML).toContain('animate-pulse');
    });

    // --- AC5: Expired badge ---
    it('shows EXPIRED badge when lease has passed', () => {
        const pastDate = new Date(Date.now() - 5000).toISOString();
        render(<LeaseCountdown expiresAt={pastDate} />);
        expect(screen.getByText('EXPIRED')).toBeInTheDocument();
    });

    it('EXPIRED badge uses red styling', () => {
        const pastDate = new Date(Date.now() - 5000).toISOString();
        render(<LeaseCountdown expiresAt={pastDate} />);
        const badge = screen.getByText('EXPIRED');
        expect(badge.className).toContain('bg-error');
        expect(badge.className).toContain('text-inverse');
    });

    // --- Normal state ---
    it('shows normal/success styling above 5 min', () => {
        render(<LeaseCountdown expiresAt={futureISO(600)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('text-success');
        expect(timer.innerHTML).toContain('bg-success');
    });

    it('does not show animate-pulse in normal state', () => {
        render(<LeaseCountdown expiresAt={futureISO(600)} />);
        const timer = screen.getByRole('timer');
        // The dot should NOT pulse in normal state
        const dotSpan = timer.querySelector('[aria-hidden="true"]');
        expect(dotSpan?.className).not.toContain('animate-pulse');
    });

    // --- Timer behavior ---
    it('counts down every second', () => {
        render(<LeaseCountdown expiresAt={futureISO(10)} />);
        expect(screen.getByText('00:10')).toBeInTheDocument();

        act(() => {
            jest.advanceTimersByTime(1000);
        });
        expect(screen.getByText('00:09')).toBeInTheDocument();
    });

    it('transitions from normal to warning state as time decreases', () => {
        render(<LeaseCountdown expiresAt={futureISO(302)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('text-success');

        // Advance past 300s boundary
        act(() => {
            jest.advanceTimersByTime(3000);
        });
        expect(timer.innerHTML).toContain('text-warning');
    });

    it('transitions from warning to critical as time decreases', () => {
        render(<LeaseCountdown expiresAt={futureISO(62)} />);
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('text-warning');

        act(() => {
            jest.advanceTimersByTime(3000);
        });
        expect(timer.innerHTML).toContain('text-error');
    });

    // --- onExpire callback ---
    it('fires onExpire when timer reaches zero', () => {
        const onExpire = jest.fn();
        render(<LeaseCountdown expiresAt={futureISO(2)} onExpire={onExpire} />);
        expect(onExpire).not.toHaveBeenCalled();

        act(() => {
            jest.advanceTimersByTime(3000);
        });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('fires onExpire exactly once (ref guard)', () => {
        const onExpire = jest.fn();
        render(<LeaseCountdown expiresAt={futureISO(1)} onExpire={onExpire} />);

        act(() => {
            jest.advanceTimersByTime(5000);
        });
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('fires onExpire immediately when expiresAt is already past', () => {
        const onExpire = jest.fn();
        const pastDate = new Date(Date.now() - 5000).toISOString();
        render(<LeaseCountdown expiresAt={pastDate} onExpire={onExpire} />);
        expect(onExpire).toHaveBeenCalledTimes(1);
    });

    // --- Custom thresholds ---
    it('respects custom warningThreshold', () => {
        render(
            <LeaseCountdown expiresAt={futureISO(150)} warningThreshold={200} />,
        );
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('text-warning');
    });

    it('respects custom criticalThreshold', () => {
        render(
            <LeaseCountdown expiresAt={futureISO(90)} criticalThreshold={120} />,
        );
        const timer = screen.getByRole('timer');
        expect(timer.innerHTML).toContain('text-error');
    });

    // --- Accessibility ---
    it('has role="timer"', () => {
        render(<LeaseCountdown expiresAt={futureISO(120)} />);
        expect(screen.getByRole('timer')).toBeInTheDocument();
    });

    it('has aria-live="polite"', () => {
        render(<LeaseCountdown expiresAt={futureISO(120)} />);
        expect(screen.getByRole('timer')).toHaveAttribute('aria-live', 'polite');
    });

    it('has aria-label with remaining time', () => {
        render(<LeaseCountdown expiresAt={futureISO(120)} />);
        expect(screen.getByRole('timer')).toHaveAttribute(
            'aria-label',
            'Lease expires in 02:00',
        );
    });

    it('has aria-label "Lease expired" when expired', () => {
        const pastDate = new Date(Date.now() - 5000).toISOString();
        render(<LeaseCountdown expiresAt={pastDate} />);
        expect(screen.getByRole('timer')).toHaveAttribute(
            'aria-label',
            'Lease expired',
        );
    });

    it('has motion-reduce:animate-none on pulse dots', () => {
        render(<LeaseCountdown expiresAt={futureISO(200)} />);
        const timer = screen.getByRole('timer');
        const dot = timer.querySelector('[aria-hidden="true"]');
        expect(dot?.className).toContain('motion-reduce:animate-none');
    });

    // --- expiresAt change resets ---
    it('resets expired state when expiresAt changes', () => {
        const onExpire = jest.fn();
        const { rerender } = render(
            <LeaseCountdown expiresAt={new Date(Date.now() - 1000).toISOString()} onExpire={onExpire} />,
        );
        expect(screen.getByText('EXPIRED')).toBeInTheDocument();
        expect(onExpire).toHaveBeenCalledTimes(1);

        // Change to future date
        rerender(
            <LeaseCountdown expiresAt={futureISO(300)} onExpire={onExpire} />,
        );
        expect(screen.queryByText('EXPIRED')).not.toBeInTheDocument();
    });
});
