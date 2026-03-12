'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

export interface LeaseCountdownProps {
    /** ISO 8601 lease expiry timestamp */
    expiresAt: string;
    /** Seconds remaining to enter warning state. Default: 300 (5 min) */
    warningThreshold?: number;
    /** Seconds remaining to enter critical state. Default: 60 (1 min) */
    criticalThreshold?: number;
    /** Callback when timer reaches zero */
    onExpire?: () => void;
}

type CountdownState = 'normal' | 'warning' | 'critical' | 'expired';

function getRemaining(expiresAt: string): number {
    return Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
}

function formatTime(totalSeconds: number): string {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getState(
    remaining: number,
    warningThreshold: number,
    criticalThreshold: number,
): CountdownState {
    if (remaining <= 0) return 'expired';
    if (remaining <= criticalThreshold) return 'critical';
    if (remaining <= warningThreshold) return 'warning';
    return 'normal';
}

/**
 * Real-time countdown timer showing lease remaining time.
 * Ticks every second. Transitions through normal → warning → critical → expired
 * with distinct visual urgency.
 */
export function LeaseCountdown({
    expiresAt,
    warningThreshold = 300,
    criticalThreshold = 60,
    onExpire,
}: LeaseCountdownProps) {
    const [remaining, setRemaining] = useState(() => getRemaining(expiresAt));
    const expiredFiredRef = useRef(false);
    const lastAnnouncedRef = useRef(remaining);

    const state = getState(remaining, warningThreshold, criticalThreshold);

    const handleExpire = useCallback(() => {
        if (!expiredFiredRef.current) {
            expiredFiredRef.current = true;
            onExpire?.();
        }
    }, [onExpire]);

    useEffect(() => {
        expiredFiredRef.current = false;
        setRemaining(getRemaining(expiresAt));
    }, [expiresAt]);

    useEffect(() => {
        if (remaining <= 0) {
            handleExpire();
            return;
        }

        const interval = setInterval(() => {
            setRemaining(getRemaining(expiresAt));
        }, 1000);

        return () => clearInterval(interval);
    }, [expiresAt, remaining, handleExpire]);

    // Throttle aria-live updates: 30s (normal), 10s (warning), 5s (critical)
    const announceInterval =
        state === 'critical' ? 5 : state === 'warning' ? 10 : 30;
    const shouldAnnounce =
        state === 'expired' ||
        Math.abs(lastAnnouncedRef.current - remaining) >= announceInterval;

    if (shouldAnnounce) {
        lastAnnouncedRef.current = remaining;
    }

    const ariaLabel =
        state === 'expired'
            ? 'Lease expired'
            : `Lease expires in ${formatTime(remaining)}`;

    if (state === 'expired') {
        return (
            <span
                role="timer"
                aria-live="polite"
                aria-label={ariaLabel}
                className="inline-flex items-center"
            >
                <span className="bg-error text-inverse text-xs font-semibold uppercase px-2 py-0.5 rounded">
                    EXPIRED
                </span>
            </span>
        );
    }

    const dotClass =
        state === 'critical'
            ? 'bg-error w-2 h-2 rounded-full animate-pulse'
            : state === 'warning'
                ? 'bg-warning w-2 h-2 rounded-full animate-pulse'
                : 'bg-success w-2 h-2 rounded-full';

    const textClass =
        state === 'critical'
            ? 'text-error font-bold'
            : state === 'warning'
                ? 'text-warning'
                : 'text-success';

    return (
        <span
            role="timer"
            aria-live="polite"
            aria-label={ariaLabel}
            className="inline-flex items-center gap-1.5"
        >
            <span className={`${dotClass} motion-reduce:animate-none`} aria-hidden="true" />
            <span className={`font-mono text-sm ${textClass}`}>
                {formatTime(remaining)}
            </span>
        </span>
    );
}
