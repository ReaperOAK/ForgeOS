/**
 * Logging middleware tests.
 *
 * Validates structured JSON log output, duration measurement, and
 * field presence for the requestLogger middleware.
 *
 * @module __tests__/middleware/logging.test
 * @ticket TASK-FOS-02-003
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';

// ── Mock pino before importing the module under test ─────────────────────────

const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();
const mockLoggerWarn = vi.fn();
const mockLoggerDebug = vi.fn();

vi.mock('pino', () => {
  const mockPino = () => ({
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: mockLoggerWarn,
    debug: mockLoggerDebug,
    level: 'info',
    child: vi.fn().mockReturnThis(),
  });
  return { default: mockPino };
});

// Import AFTER mocking
const { requestLogger, logger } = await import('../../middleware/logging.js');

// ── Test Helpers ─────────────────────────────────────────────────────────────

interface MockRequest {
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  requestId?: string;
}

class MockResponse extends EventEmitter {
  statusCode = 200;
  private _headers: Record<string, string | number | undefined> = {};

  getHeader(name: string): string | number | undefined {
    return this._headers[name.toLowerCase()];
  }

  setHeader(name: string, value: string | number): void {
    this._headers[name.toLowerCase()] = value;
  }
}

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: 'GET',
    path: '/health',
    headers: { 'user-agent': 'vitest/1.0' },
    ...overrides,
  };
}

function createMockRes(): MockResponse {
  return new MockResponse();
}

function createMockNext(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('requestLogger', () => {
  let req: MockRequest;
  let res: MockResponse;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    req = createMockReq();
    res = createMockRes();
    next = createMockNext();
  });

  it('calls next() immediately without blocking', () => {
    requestLogger(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledWith();
  });

  it('logs on response finish event', () => {
    requestLogger(req as never, res as never, next);

    // Before finish — no log yet
    expect(mockLoggerInfo).not.toHaveBeenCalled();

    // Emit finish
    res.emit('finish');

    expect(mockLoggerInfo).toHaveBeenCalledTimes(1);
  });

  it('includes method in the log line', () => {
    req = createMockReq({ method: 'POST' });
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData.method).toBe('POST');
  });

  it('includes path in the log line', () => {
    req = createMockReq({ path: '/api/tickets' });
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData.path).toBe('/api/tickets');
  });

  it('includes statusCode in the log line', () => {
    res.statusCode = 404;
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData.statusCode).toBe(404);
  });

  it('includes durationMs as a number', () => {
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(typeof logData.durationMs).toBe('number');
    expect(logData.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('includes requestId when present on req', () => {
    req = createMockReq();
    req.requestId = 'test-request-id-123';
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData.requestId).toBe('test-request-id-123');
  });

  it('omits requestId when not present on req', () => {
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData).not.toHaveProperty('requestId');
  });

  it('includes userAgent header', () => {
    req = createMockReq({ headers: { 'user-agent': 'Mozilla/5.0' } });
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData.userAgent).toBe('Mozilla/5.0');
  });

  it('includes contentLength from response header', () => {
    res.setHeader('content-length', 1234);
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData.contentLength).toBe(1234);
  });

  it('logs with message "request completed"', () => {
    requestLogger(req as never, res as never, next);
    res.emit('finish');

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.any(Object),
      'request completed',
    );
  });

  it('measures positive duration for delayed finish', async () => {
    requestLogger(req as never, res as never, next);

    // Simulate some delay
    await new Promise((resolve) => setTimeout(resolve, 10));

    res.emit('finish');

    const logData = mockLoggerInfo.mock.calls[0][0] as Record<string, unknown>;
    expect(logData.durationMs).toBeGreaterThan(0);
  });
});

describe('logger', () => {
  it('exports a logger object with info method', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
  });

  it('exports a logger object with error method', () => {
    expect(typeof logger.error).toBe('function');
  });
});
