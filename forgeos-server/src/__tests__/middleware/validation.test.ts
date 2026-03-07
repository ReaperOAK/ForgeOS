/**
 * Validation middleware tests.
 *
 * Validates Zod schema enforcement for request body, query, and params.
 * Verifies 400 responses with field-level error details on validation failure.
 *
 * @module __tests__/middleware/validation.test
 * @ticket TASK-FOS-02-003
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import { validateBody, validateQuery, validateParams } from '../../middleware/validation.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

interface MockRequest {
  body?: unknown;
  query?: Record<string, string>;
  params?: Record<string, string>;
}

interface MockResponse {
  statusCode: number;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    body: {},
    query: {},
    params: {},
    ...overrides,
  };
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    status: vi.fn(),
    json: vi.fn(),
  };
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

function createMockNext(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

// ── Test Schemas ─────────────────────────────────────────────────────────────

const TicketSchema = z.object({
  title: z.string().min(1, 'Title is required'),
  type: z.enum(['backend', 'frontend', 'fullstack']),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
});

const QuerySchema = z.object({
  stage: z.string().min(1),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const ParamsSchema = z.object({
  id: z.string().uuid('Must be a valid UUID'),
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe('validateBody', () => {
  let req: MockRequest;
  let res: MockResponse;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    req = createMockReq();
    res = createMockRes();
    next = createMockNext();
  });

  it('calls next() when body is valid', () => {
    req.body = { title: 'Implement login', type: 'backend' };
    const middleware = validateBody(TicketSchema);

    middleware(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('replaces req.body with parsed data (including defaults)', () => {
    req.body = { title: 'Test', type: 'frontend' };
    const middleware = validateBody(TicketSchema);

    middleware(req as never, res as never, next);

    // Parsed data should be set back on req.body
    expect(req.body).toEqual({ title: 'Test', type: 'frontend' });
  });

  it('returns 400 when body is invalid', () => {
    req.body = { title: '', type: 'invalid_type' };
    const middleware = validateBody(TicketSchema);

    middleware(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns field-level error details', () => {
    req.body = { type: 'invalid' };
    const middleware = validateBody(TicketSchema);

    middleware(req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      error: string;
      details: { fields: Array<{ field: string; message: string; code: string }> };
    };
    expect(responseBody.error).toBe('VALIDATION_ERROR');
    expect(responseBody.details.fields).toBeInstanceOf(Array);
    expect(responseBody.details.fields.length).toBeGreaterThan(0);

    // Each field error should have field, message, and code
    for (const fieldErr of responseBody.details.fields) {
      expect(fieldErr).toHaveProperty('field');
      expect(fieldErr).toHaveProperty('message');
      expect(fieldErr).toHaveProperty('code');
    }
  });

  it('includes specific field names in error details', () => {
    req.body = {};
    const middleware = validateBody(TicketSchema);

    middleware(req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      details: { fields: Array<{ field: string }> };
    };
    const fieldNames = responseBody.details.fields.map((f) => f.field);
    expect(fieldNames).toContain('title');
    expect(fieldNames).toContain('type');
  });

  it('includes error message "Request validation failed"', () => {
    req.body = {};
    const middleware = validateBody(TicketSchema);

    middleware(req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { message: string };
    expect(responseBody.message).toBe('Request validation failed');
  });

  it('includes timestamp in ISO 8601 format', () => {
    req.body = {};
    const middleware = validateBody(TicketSchema);

    middleware(req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as { timestamp: string };
    expect(responseBody.timestamp).toBeDefined();
    expect(new Date(responseBody.timestamp).toISOString()).toBe(responseBody.timestamp);
  });

  it('handles nested validation errors with dot-joined paths', () => {
    const nestedSchema = z.object({
      evidence: z.object({
        artifacts: z.array(z.string()).min(1),
        confidence: z.enum(['HIGH', 'MEDIUM', 'LOW']),
      }),
    });
    req.body = { evidence: { artifacts: [], confidence: 'INVALID' } };
    const middleware = validateBody(nestedSchema);

    middleware(req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      details: { fields: Array<{ field: string }> };
    };
    const fieldNames = responseBody.details.fields.map((f) => f.field);
    // Should include dot-joined paths like "evidence.artifacts" or "evidence.confidence"
    expect(fieldNames.some((f) => f.startsWith('evidence.'))).toBe(true);
  });
});

describe('validateQuery', () => {
  let req: MockRequest;
  let res: MockResponse;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    req = createMockReq();
    res = createMockRes();
    next = createMockNext();
  });

  it('calls next() when query is valid', () => {
    req.query = { stage: 'BACKEND' };
    const middleware = validateQuery(QuerySchema);

    middleware(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when query is invalid', () => {
    req.query = { stage: '' };
    const middleware = validateQuery(QuerySchema);

    middleware(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('validateParams', () => {
  let req: MockRequest;
  let res: MockResponse;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    req = createMockReq();
    res = createMockRes();
    next = createMockNext();
  });

  it('calls next() when params are valid', () => {
    req.params = { id: '550e8400-e29b-41d4-a716-446655440000' };
    const middleware = validateParams(ParamsSchema);

    middleware(req as never, res as never, next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('returns 400 when params are invalid', () => {
    req.params = { id: 'not-a-uuid' };
    const middleware = validateParams(ParamsSchema);

    middleware(req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('includes field-level error with UUID validation message', () => {
    req.params = { id: 'invalid' };
    const middleware = validateParams(ParamsSchema);

    middleware(req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
      details: { fields: Array<{ field: string; message: string }> };
    };
    expect(responseBody.details.fields[0].field).toBe('id');
    expect(responseBody.details.fields[0].message).toContain('UUID');
  });
});
