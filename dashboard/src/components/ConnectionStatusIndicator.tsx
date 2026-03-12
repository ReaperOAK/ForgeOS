'use client';

import type { ConnectionStatus } from '@/lib/api/websocket';

export interface ConnectionStatusIndicatorProps {
  status: ConnectionStatus;
}

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { color: string; label: string; pulse: boolean }
> = {
  connected: { color: 'bg-green-500', label: 'Connected', pulse: false },
  connecting: { color: 'bg-yellow-500', label: 'Connecting…', pulse: true },
  disconnected: { color: 'bg-red-500', label: 'Disconnected', pulse: false },
};

/**
 * Small status dot indicating WebSocket connection state.
 * Green = connected, yellow pulsing = connecting, red = disconnected.
 */
export function ConnectionStatusIndicator({
  status,
}: ConnectionStatusIndicatorProps) {
  const config = STATUS_CONFIG[status];

  return (
    <span
      className="inline-flex items-center gap-1.5"
      role="status"
      aria-live="polite"
      aria-label={`WebSocket ${config.label}`}
    >
      <span
        className={`w-2.5 h-2.5 rounded-full ${config.color} ${config.pulse ? 'animate-pulse' : ''
          }`}
        aria-hidden="true"
      />
      <span className="text-xs text-muted hidden sm:inline">
        {config.label}
      </span>
    </span>
  );
}
