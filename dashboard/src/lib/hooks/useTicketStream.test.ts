/**
 * @jest-environment jsdom
 */
import { renderHook, act } from '@testing-library/react';
import { useTicketStream } from '@/lib/hooks/useTicketStream';
import type { Ticket } from '@/lib/api/types';

// Mock the WebSocket client
const mockConnect = jest.fn();
const mockDisconnect = jest.fn();
let capturedOnEvent: ((event: unknown) => void) | undefined;
let capturedOnStatusChange: ((status: string) => void) | undefined;

jest.mock('@/lib/api/websocket', () => ({
  TicketWebSocketClient: jest.fn().mockImplementation((opts: {
    onEvent?: (event: unknown) => void;
    onStatusChange?: (status: string) => void;
  }) => {
    capturedOnEvent = opts.onEvent;
    capturedOnStatusChange = opts.onStatusChange;
    return {
      connect: mockConnect,
      disconnect: mockDisconnect,
    };
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  capturedOnEvent = undefined;
  capturedOnStatusChange = undefined;
});

describe('useTicketStream', () => {
  it('connects on mount and disconnects on unmount', () => {
    const { unmount } = renderHook(() => useTicketStream());
    expect(mockConnect).toHaveBeenCalledTimes(1);

    unmount();
    expect(mockDisconnect).toHaveBeenCalledTimes(1);
  });

  it('does not connect when enabled is false', () => {
    renderHook(() => useTicketStream({ enabled: false }));
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it('starts with disconnected status', () => {
    const { result } = renderHook(() => useTicketStream());
    expect(result.current.status).toBe('disconnected');
  });

  it('updates status when WS status changes', () => {
    const { result } = renderHook(() => useTicketStream());

    act(() => {
      capturedOnStatusChange?.('connecting');
    });
    expect(result.current.status).toBe('connecting');

    act(() => {
      capturedOnStatusChange?.('connected');
    });
    expect(result.current.status).toBe('connected');
  });

  it('calls onTicketUpdate when event contains a ticket', () => {
    const onTicketUpdate = jest.fn();
    renderHook(() => useTicketStream({ onTicketUpdate }));

    const ticket = { ticket_id: 'T-001', title: 'Test' } as Ticket;

    act(() => {
      capturedOnEvent?.({
        type: 'TICKET_STATE_CHANGE',
        ticket,
      });
    });

    expect(onTicketUpdate).toHaveBeenCalledWith(ticket);
  });

  it('provides reconnect function', () => {
    const { result } = renderHook(() => useTicketStream());
    expect(typeof result.current.reconnect).toBe('function');

    act(() => {
      result.current.reconnect();
    });

    expect(mockDisconnect).toHaveBeenCalled();
    expect(mockConnect).toHaveBeenCalledTimes(2); // initial + reconnect
  });

  it('handles events without onTicketUpdate callback', () => {
    renderHook(() => useTicketStream());

    // Should not throw when no callback provided
    expect(() => {
      act(() => {
        capturedOnEvent?.({
          type: 'TICKET_CREATED',
          ticket: { ticket_id: 'T-002' },
        });
      });
    }).not.toThrow();
  });
});
