import {
  TicketWebSocketClient,
  type ConnectionStatus,
  type WebSocketEvent,
} from '@/lib/api/websocket';

// --- WebSocket mock --------------------------------------------------------

type WsHandler = ((event: { data: string }) => void) | null;

class MockWebSocket {
  static OPEN = 1;
  static CONNECTING = 0;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: WsHandler = null;

  close() {
    this.readyState = MockWebSocket.CLOSED;
  }

  // helpers for tests
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  simulateMessage(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateClose() {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }

  simulateError() {
    this.onerror?.();
  }
}

let mockInstances: MockWebSocket[] = [];

beforeEach(() => {
  jest.useFakeTimers();
  mockInstances = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (globalThis as any).WebSocket = class extends MockWebSocket {
    static override OPEN = 1;
    static override CONNECTING = 0;
    static override CLOSED = 3;
    static CLOSING = 2;

    constructor() {
      super();
      mockInstances.push(this);
    }
  };
});

afterEach(() => {
  jest.useRealTimers();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  delete (globalThis as any).WebSocket;
});

// --- Tests -----------------------------------------------------------------

describe('TicketWebSocketClient', () => {
  it('connects and reports connected status', () => {
    const statuses: ConnectionStatus[] = [];
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      onStatusChange: (s) => statuses.push(s),
    });

    client.connect();
    expect(statuses).toContain('connecting');

    mockInstances[0].simulateOpen();
    expect(statuses).toContain('connected');

    client.disconnect();
  });

  it('parses and dispatches incoming events', () => {
    const events: WebSocketEvent[] = [];
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      onEvent: (e) => events.push(e),
    });

    client.connect();
    mockInstances[0].simulateOpen();

    const event: WebSocketEvent = {
      type: 'TICKET_STATE_CHANGE',
      ticket_id: 'T-001',
      previous_stage: 'READY',
      new_stage: 'BACKEND',
      previous_status: 'READY',
      new_status: 'IN_PROGRESS',
      ticket: { ticket_id: 'T-001' } as WebSocketEvent extends { ticket: infer T } ? T : never,
      timestamp: new Date().toISOString(),
    };

    mockInstances[0].simulateMessage(event);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TICKET_STATE_CHANGE');

    client.disconnect();
  });

  it('ignores malformed messages without crashing', () => {
    const events: WebSocketEvent[] = [];
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      onEvent: (e) => events.push(e),
    });

    client.connect();
    mockInstances[0].simulateOpen();
    // Send invalid JSON via raw handler
    mockInstances[0].onmessage?.({ data: 'not-json' });
    expect(events).toHaveLength(0);

    client.disconnect();
  });

  it('reconnects with exponential backoff on close', () => {
    const statuses: ConnectionStatus[] = [];
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      initialDelay: 1000,
      maxDelay: 30000,
      onStatusChange: (s) => statuses.push(s),
    });

    client.connect();
    mockInstances[0].simulateOpen();
    statuses.length = 0;

    // Close triggers reconnect
    mockInstances[0].simulateClose();
    expect(statuses).toContain('disconnected');

    // Fast-forward 1s (initial delay)
    jest.advanceTimersByTime(1000);
    expect(mockInstances).toHaveLength(2);

    // Close again — delay should double
    mockInstances[1].simulateClose();
    jest.advanceTimersByTime(1000);
    // Should NOT have reconnected yet (delay is now 2s)
    expect(mockInstances).toHaveLength(2);

    jest.advanceTimersByTime(1000);
    expect(mockInstances).toHaveLength(3);

    client.disconnect();
  });

  it('does not reconnect after intentional disconnect', () => {
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
    });

    client.connect();
    mockInstances[0].simulateOpen();

    client.disconnect();
    jest.advanceTimersByTime(60_000);
    // Only the initial connection
    expect(mockInstances).toHaveLength(1);
  });

  it('resets delay on successful reconnection', () => {
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      initialDelay: 500,
    });

    client.connect();
    mockInstances[0].simulateOpen();
    mockInstances[0].simulateClose();

    jest.advanceTimersByTime(500);
    expect(mockInstances).toHaveLength(2);

    // Successful reconnect
    mockInstances[1].simulateOpen();
    mockInstances[1].simulateClose();

    // Delay should be back to initial (500), not doubled
    jest.advanceTimersByTime(500);
    expect(mockInstances).toHaveLength(3);

    client.disconnect();
  });

  it('caps backoff at maxDelay', () => {
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      initialDelay: 10000,
      maxDelay: 15000,
    });

    client.connect();
    mockInstances[0].simulateOpen();
    mockInstances[0].simulateClose();

    jest.advanceTimersByTime(10000);
    expect(mockInstances).toHaveLength(2);

    mockInstances[1].simulateClose();
    // Next delay = min(20000, 15000) = 15000
    jest.advanceTimersByTime(14999);
    expect(mockInstances).toHaveLength(2);
    jest.advanceTimersByTime(1);
    expect(mockInstances).toHaveLength(3);

    client.disconnect();
  });

  it('skips connect when already OPEN or CONNECTING', () => {
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
    });

    client.connect();
    mockInstances[0].simulateOpen();
    expect(mockInstances).toHaveLength(1);

    // Second connect while OPEN should be no-op
    client.connect();
    expect(mockInstances).toHaveLength(1);

    client.disconnect();
  });

  it('falls back to disconnected and schedules reconnect when constructor throws', () => {
    const statuses: ConnectionStatus[] = [];

    // Make WebSocket constructor throw BEFORE creating the client
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = class {
      static OPEN = 1;
      static CONNECTING = 0;
      static CLOSED = 3;
      static CLOSING = 2;
      constructor() {
        throw new Error('Network error');
      }
    };

    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      initialDelay: 500,
      onStatusChange: (s) => statuses.push(s),
    });

    client.connect();
    expect(statuses).toContain('connecting');
    expect(statuses).toContain('disconnected');

    // Restore mock and verify reconnection is scheduled
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).WebSocket = class extends MockWebSocket {
      static override OPEN = 1;
      static override CONNECTING = 0;
      static override CLOSED = 3;
      static CLOSING = 2;
      constructor() {
        super();
        mockInstances.push(this);
      }
    };

    jest.advanceTimersByTime(500);
    expect(mockInstances.length).toBeGreaterThanOrEqual(1);

    client.disconnect();
  });

  it('dispatches TICKET_CREATED events', () => {
    const events: WebSocketEvent[] = [];
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      onEvent: (e) => events.push(e),
    });

    client.connect();
    mockInstances[0].simulateOpen();

    mockInstances[0].simulateMessage({
      type: 'TICKET_CREATED',
      ticket: { ticket_id: 'T-002' },
      timestamp: new Date().toISOString(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TICKET_CREATED');
    client.disconnect();
  });

  it('dispatches TICKET_UPDATED events', () => {
    const events: WebSocketEvent[] = [];
    const client = new TicketWebSocketClient({
      url: 'ws://test/ws/tickets',
      onEvent: (e) => events.push(e),
    });

    client.connect();
    mockInstances[0].simulateOpen();

    mockInstances[0].simulateMessage({
      type: 'TICKET_UPDATED',
      ticket: { ticket_id: 'T-003' },
      timestamp: new Date().toISOString(),
    });

    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('TICKET_UPDATED');
    client.disconnect();
  });
});
