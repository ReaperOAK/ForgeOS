import type { Ticket, TicketStage, TicketStatus } from './types';

/** Events emitted by the /ws/tickets WebSocket endpoint. */
export interface TicketStateChangeEvent {
  type: 'TICKET_STATE_CHANGE';
  ticket_id: string;
  previous_stage: TicketStage | null;
  new_stage: TicketStage;
  previous_status: TicketStatus | null;
  new_status: TicketStatus;
  ticket: Ticket;
  timestamp: string;
}

export interface TicketCreatedEvent {
  type: 'TICKET_CREATED';
  ticket: Ticket;
  timestamp: string;
}

export interface TicketUpdatedEvent {
  type: 'TICKET_UPDATED';
  ticket: Ticket;
  timestamp: string;
}

export type WebSocketEvent =
  | TicketStateChangeEvent
  | TicketCreatedEvent
  | TicketUpdatedEvent;

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected';

export interface WebSocketClientOptions {
  /** Base URL for the WebSocket endpoint. Defaults to env or localhost:3000. */
  url?: string;
  /** Initial reconnection delay in ms. Default: 1000. */
  initialDelay?: number;
  /** Maximum reconnection delay in ms. Default: 30000. */
  maxDelay?: number;
  /** Called on every incoming event. */
  onEvent?: (event: WebSocketEvent) => void;
  /** Called when connection status changes. */
  onStatusChange?: (status: ConnectionStatus) => void;
}

const DEFAULT_WS_URL =
  (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000')
    .replace(/^http/, 'ws') + '/ws/tickets';

/**
 * WebSocket client with exponential backoff reconnection.
 *
 * Connects to the /ws/tickets endpoint and dispatches parsed events.
 * Handles automatic reconnection on close/error with configurable backoff.
 */
export class TicketWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  private initialDelay: number;
  private maxDelay: number;
  private currentDelay: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private intentionallyClosed = false;
  private onEvent: (event: WebSocketEvent) => void;
  private onStatusChange: (status: ConnectionStatus) => void;

  constructor(options: WebSocketClientOptions = {}) {
    this.url = options.url ?? DEFAULT_WS_URL;
    this.initialDelay = options.initialDelay ?? 1_000;
    this.maxDelay = options.maxDelay ?? 30_000;
    this.currentDelay = this.initialDelay;
    this.onEvent = options.onEvent ?? (() => { });
    this.onStatusChange = options.onStatusChange ?? (() => { });
  }

  /** Initiate connection. Safe to call multiple times. */
  connect(): void {
    if (this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }

    this.intentionallyClosed = false;
    this.onStatusChange('connecting');

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.onStatusChange('disconnected');
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.currentDelay = this.initialDelay;
      this.onStatusChange('connected');
    };

    this.ws.onmessage = (event: MessageEvent) => {
      try {
        const parsed = JSON.parse(event.data as string) as WebSocketEvent;
        if (parsed && typeof parsed.type === 'string') {
          this.onEvent(parsed);
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.onStatusChange('disconnected');
      if (!this.intentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose fires after onerror — reconnection handled there
    };
  }

  /** Close connection and stop reconnection attempts. */
  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.close();
      this.ws = null;
    }
    this.onStatusChange('disconnected');
  }

  private scheduleReconnect(): void {
    if (this.intentionallyClosed) return;
    this.reconnectTimer = setTimeout(() => {
      this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
      this.connect();
    }, this.currentDelay);
  }
}
