/**
 * Request ID middleware tests.
 *
 * Validates UUID v4 generation, header extraction, and response header echo.
 *
 * @module __tests__/middleware/request-id.test
 * @ticket TASK-FOS-02-003
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { requestIdMiddleware } from '../../middleware/request-id.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

/** UUID v4 regex pattern. */
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface MockRequest {
  headers: Record<string, string | string[] | undefined>;
  requestId?: string;
}

interface MockResponse {
  setHeader: ReturnType<typeof vi.fn>;
}

function createMockReq(headers: Record<string, string | string[] | undefined> = {}): MockRequest {
  return { headers };
}

function createMockRes(): MockResponse {
  return { setHeader: vi.fn() };
}

function createMockNext(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('requestIdMiddleware', () => {
  let req: MockRequest;
  let res: MockResponse;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    req = createMockReq();
    res = createMockRes();
    next = createMockNext();
  });

  it('generates a UUID v4 when no X-Request-ID header is present', () => {
    requestIdMiddleware(req as never, res as never, next);

    expect(req.requestId).toBeDefined();
    expect(req.requestId).toMatch(UUID_V4_REGEX);
  });

  it('reuses the X-Request-ID header value when present', () => {
    const customId = 'custom-correlation-id-123';
    req = createMockReq({ 'x-request-id': customId });

    requestIdMiddleware(req as never, res as never, next);

    expect(req.requestId).toBe(customId);
  });

  it('ignores empty X-Request-ID header and generates a new UUID', () => {
    req = createMockReq({ 'x-request-id': '' });

    requestIdMiddleware(req as never, res as never, next);

    expect(req.requestId).toMatch(UUID_V4_REGEX);
  });

  it('echoes the request ID in the X-Request-ID response header', () => {
    requestIdMiddleware(req as never, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', req.requestId);
  });

  it('echoes the provided ID (not a new one) in the response header', () => {
    const providedId = 'provided-id-abc';
    req = createMockReq({ 'x-request-id': providedId });

    requestIdMiddleware(req as never, res as never, next);

    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', providedId);
  });

  it('calls next() exactly once', () => {
    requestIdMiddleware(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('calls next() with no arguments (no error)', () => {
    requestIdMiddleware(req as never, res as never, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('generates unique IDs for successive requests', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const r = createMockReq();
      requestIdMiddleware(r as never, res as never, next);
      ids.add(r.requestId!);
    }
    expect(ids.size).toBe(100);
  });

  it('handles array-typed header value by generating a new UUID', () => {
    // Express can return string[] for duplicate headers
    req = createMockReq({ 'x-request-id': ['id1', 'id2'] as unknown as string });

    requestIdMiddleware(req as never, res as never, next);

    // Array is not typeof 'string', so a new UUID should be generated
    expect(req.requestId).toMatch(UUID_V4_REGEX);
  });
});
