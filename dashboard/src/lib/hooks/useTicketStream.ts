'use client';

import { useEffect, useRef, useCallback, useState } from 'react';
import {
  TicketWebSocketClient,
  type ConnectionStatus,
  type WebSocketEvent,
} from '@/lib/api/websocket';
import type { Ticket } from '@/lib/api/types';

export interface UseTicketStreamOptions {
  /** Whether to connect automatically. Default: true. */
  enabled?: boolean;
  /** Called when a ticket state change event arrives. */
  onTicketUpdate?: (ticket: Ticket) => void;
}

export interface UseTicketStreamResult {
  /** Current WebSocket connection status. */
  status: ConnectionStatus;
  /** Manually trigger reconnection. */
  reconnect: () => void;
}

/**
 * React hook managing a WebSocket connection for real-time ticket updates.
 *
 * Connects on mount (if enabled), disconnects on unmount, and provides
 * connection status tracking. Calls `onTicketUpdate` for every ticket
 * state change, creation, or update event received.
 */
export function useTicketStream(
  options: UseTicketStreamOptions = {},
): UseTicketStreamResult {
  const { enabled = true, onTicketUpdate } = options;
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const clientRef = useRef<TicketWebSocketClient | null>(null);
  const callbackRef = useRef(onTicketUpdate);

  // Keep callback ref current without re-creating the client
  callbackRef.current = onTicketUpdate;

  const handleEvent = useCallback((event: WebSocketEvent) => {
    if ('ticket' in event && event.ticket) {
      callbackRef.current?.(event.ticket);
    }
  }, []);

  const reconnect = useCallback(() => {
    clientRef.current?.disconnect();
    clientRef.current?.connect();
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const client = new TicketWebSocketClient({
      onEvent: handleEvent,
      onStatusChange: setStatus,
    });

    clientRef.current = client;
    client.connect();

    return () => {
      client.disconnect();
      clientRef.current = null;
    };
  }, [enabled, handleEvent]);

  return { status, reconnect };
}
