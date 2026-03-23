/**
 * Authentication and authorization middleware tests.
 *
 * Validates bearer token extraction, authMiddleware authentication
 * flow (public path exemption, missing/invalid/valid keys), and
 * requirePermission authorization enforcement.
 *
 * @module __tests__/middleware/auth.test
 * @ticket TASK-FOS-04-001
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { ForgeOSErrorCode } from '../../types/index.js';
import type { AgentIdentity } from '../../types/index.js';

// ── Mock pino before importing modules ───────────────────────────────────────

vi.mock('pino', () => {
  const mockPino = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    level: 'info',
    child: vi.fn().mockReturnThis(),
  });
  return { default: mockPino };
});

// ── Mock keys module ─────────────────────────────────────────────────────────

const mockValidateApiKey = vi.fn();

vi.mock('../../auth/keys.js', () => ({
  validateApiKey: (...args: unknown[]) => mockValidateApiKey(...args),
}));

// ── Mock dotenv ──────────────────────────────────────────────────────────────

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// ── Mock pg pool (needed by transitive db/pool import) ───────────────────────

vi.mock('../../db/pool.js', () => ({
  getPool: () => ({
    query: vi.fn(),
    on: vi.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  }),
  pool: { query: vi.fn(), on: vi.fn() },
}));

const { authMiddleware, requirePermission, extractBearerToken } =
  await import('../../middleware/auth.js');

// ── Test Helpers ─────────────────────────────────────────────────────────────

interface MockRequest {
  headers: Record<string, string | undefined>;
  path: string;
  method: string;
  requestId?: string;
  agent?: AgentIdentity;
}

interface MockResponse {
  statusCode: number;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
}

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    headers: {},
    path: '/mcp',
    method: 'POST',
    requestId: 'test-req-id',
    ...overrides,
  };
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

function createMockNext(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

const VALID_AGENT: AgentIdentity = {
  id: 'agent-uuid-001',
  name: 'Backend Engineer',
  role: 'backend',
  permissions: ['tickets.claim', 'tickets.advance'],
  machine_id: 'pop-os',
};

// ── Test Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── extractBearerToken ───────────────────────────────────────────────────────

describe('extractBearerToken', () => {
  it('returns null for undefined header', () => {
    expect(extractBearerToken(undefined)).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractBearerToken('')).toBeNull();
  });

  it('returns null for non-Bearer scheme', () => {
    expect(extractBearerToken('Basic abc123')).toBeNull();
  });

  it('returns null for Bearer with no token', () => {
    expect(extractBearerToken('Bearer ')).toBeNull();
  });

  it('returns null for Bearer with only whitespace', () => {
    expect(extractBearerToken('Bearer   ')).toBeNull();
  });

  it('extracts a valid bearer token', () => {
    expect(extractBearerToken('Bearer fos_abc123')).toBe('fos_abc123');
  });

  it('trims whitespace from the token', () => {
    expect(extractBearerToken('Bearer  fos_abc123  ')).toBe('fos_abc123');
  });

  it('is case-sensitive on Bearer prefix', () => {
    expect(extractBearerToken('bearer fos_abc123')).toBeNull();
  });
});

// ── authMiddleware ───────────────────────────────────────────────────────────

describe('authMiddleware', () => {
  it('skips authentication for /health path', async () => {
    const req = createMockReq({ path: '/health' });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
    expect(mockValidateApiKey).not.toHaveBeenCalled();
  });

  it('skips authentication for /health/ subpath', async () => {
    const req = createMockReq({ path: '/health/ready' });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
  });

  it('returns 401 when Authorization header is missing', async () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.UNAUTHORIZED,
        message: expect.stringContaining('Authorization'),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when Authorization header has wrong scheme', async () => {
    const req = createMockReq({
      headers: { authorization: 'Basic abc123' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 401 when API key is invalid', async () => {
    mockValidateApiKey.mockResolvedValueOnce(null);

    const req = createMockReq({
      headers: { authorization: 'Bearer fos_invalid_key' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(mockValidateApiKey).toHaveBeenCalledWith('fos_invalid_key');
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.UNAUTHORIZED,
        message: expect.stringContaining('Invalid or revoked'),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('populates req.agent and calls next for valid key', async () => {
    mockValidateApiKey.mockResolvedValueOnce(VALID_AGENT);

    const req = createMockReq({
      headers: { authorization: 'Bearer fos_valid_key' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(mockValidateApiKey).toHaveBeenCalledWith('fos_valid_key');
    expect((req as MockRequest).agent).toEqual(VALID_AGENT);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 401 when validateApiKey throws an error', async () => {
    mockValidateApiKey.mockRejectedValueOnce(new Error('DB connection lost'));

    const req = createMockReq({
      headers: { authorization: 'Bearer fos_valid_key' },
    });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.UNAUTHORIZED,
        message: expect.stringContaining('unavailable'),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('includes timestamp in error response', async () => {
    const req = createMockReq({ headers: {} });
    const res = createMockRes();
    const next = createMockNext();

    await authMiddleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(responseBody.timestamp).toBeDefined();
    expect(new Date(responseBody.timestamp).getTime()).not.toBeNaN();
  });
});

// ── requirePermission ────────────────────────────────────────────────────────

describe('requirePermission', () => {
  it('returns 401 when req.agent is not set', () => {
    const middleware = requirePermission('tickets.claim');
    const req = createMockReq();
    const res = createMockRes();
    const next = createMockNext();

    middleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.UNAUTHORIZED,
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when agent lacks the required permission', () => {
    const middleware = requirePermission('admin.manage');
    const req = createMockReq();
    (req as MockRequest).agent = { ...VALID_AGENT, permissions: ['tickets.claim'] };
    const res = createMockRes();
    const next = createMockNext();

    middleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.FORBIDDEN,
        message: expect.stringContaining('admin.manage'),
      }),
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when agent has the required permission', () => {
    const middleware = requirePermission('tickets.claim');
    const req = createMockReq();
    (req as MockRequest).agent = VALID_AGENT;
    const res = createMockRes();
    const next = createMockNext();

    middleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('calls next when agent has wildcard permission', () => {
    const middleware = requirePermission('admin.manage');
    const req = createMockReq();
    (req as MockRequest).agent = {
      ...VALID_AGENT,
      permissions: ['*'],
    };
    const res = createMockRes();
    const next = createMockNext();

    middleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('includes required permission and role in 403 error details', () => {
    const middleware = requirePermission('admin.manage');
    const req = createMockReq();
    (req as MockRequest).agent = VALID_AGENT;
    const res = createMockRes();
    const next = createMockNext();

    middleware(
      req as unknown as Request,
      res as unknown as Response,
      next as NextFunction,
    );

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(responseBody.details).toEqual(
      expect.objectContaining({
        required: 'admin.manage',
        role: 'backend',
      }),
    );
  });
});
