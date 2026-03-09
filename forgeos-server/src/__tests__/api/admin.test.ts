/**
 * Admin Route Tests — TASK-FOS-04-002
 *
 * Tests for the admin REST endpoints:
 * - POST /api/admin/agents            — register new agent
 * - GET  /api/admin/agents            — list agents (paginated)
 * - POST /api/admin/agents/:id/revoke — revoke agent API key
 * - DELETE /api/admin/agents/:id      — deregister agent
 * - POST /api/admin/agents/:id/sessions — create/update session
 *
 * @module __tests__/api/admin
 * @ticket TASK-FOS-04-002
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const {
  mockRegisterAgent,
  mockListAgents,
  mockRevokeAgent,
  mockDeregisterAgent,
  mockCreateOrUpdateSession,
} = vi.hoisted(() => ({
  mockRegisterAgent: vi.fn(),
  mockListAgents: vi.fn(),
  mockRevokeAgent: vi.fn(),
  mockDeregisterAgent: vi.fn(),
  mockCreateOrUpdateSession: vi.fn(),
}));

vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn(() => ({ query: vi.fn(), on: vi.fn(), totalCount: 5, idleCount: 3, waitingCount: 0 })),
}));

vi.mock('../../middleware/logging.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
  requestLogger: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
  requirePermission: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('../../middleware/validation.js', () => ({
  validateBody: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  validateQuery: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
  validateParams: vi.fn(() => (_req: Request, _res: Response, next: NextFunction) => next()),
}));

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

vi.mock('pino', () => {
  const mockPino = () => ({
    info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(),
    level: 'info', child: vi.fn().mockReturnThis(),
  });
  return { default: mockPino };
});

vi.mock('../../auth/registration.js', () => ({
  registerAgent: (...args: unknown[]) => mockRegisterAgent(...args),
  listAgents: (...args: unknown[]) => mockListAgents(...args),
  revokeAgent: (...args: unknown[]) => mockRevokeAgent(...args),
  deregisterAgent: (...args: unknown[]) => mockDeregisterAgent(...args),
  createOrUpdateSession: (...args: unknown[]) => mockCreateOrUpdateSession(...args),
  AgentAlreadyExistsError: class extends Error {
    public readonly code = 'AGENT_ALREADY_EXISTS' as const;
    constructor(name: string, role: string) {
      super('Agent already exists: ' + name + ' ' + role);
      this.name = 'AgentAlreadyExistsError';
    }
  },
  InvalidRoleError: class extends Error {
    public readonly code = 'INVALID_ROLE' as const;
    constructor(role: string) {
      super('Invalid role: ' + role);
      this.name = 'InvalidRoleError';
    }
  },
  AgentNotFoundError: class extends Error {
    public readonly code = 'AGENT_NOT_FOUND' as const;
    constructor(id: string) {
      super('Agent not found: ' + id);
      this.name = 'AgentNotFoundError';
    }
  },
  registerAgentSchema: { safeParse: () => ({ success: true, data: {} }), omit: () => ({ safeParse: () => ({ success: true, data: {} }) }) },
  listAgentsSchema: { safeParse: () => ({ success: true, data: {} }), omit: () => ({ safeParse: () => ({ success: true, data: {} }) }) },
  createSessionSchema: { safeParse: () => ({ success: true, data: {} }), omit: () => ({ safeParse: () => ({ success: true, data: {} }) }) },
  updateLastSeen: vi.fn().mockResolvedValue(undefined),
}));

const { adminRouter } = await import('../../api/routes/admin.js');
const registrationMod = await import('../../auth/registration.js');
const AgentAlreadyExistsError = registrationMod.AgentAlreadyExistsError;
const InvalidRoleError = registrationMod.InvalidRoleError;
const AgentNotFoundError = registrationMod.AgentNotFoundError;

interface MockResponse {
  statusCode: number;
  _data: unknown;
  status: (code: number) => MockResponse;
  json: (data: unknown) => MockResponse;
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    _data: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(data: unknown) { this._data = data; return this; },
  };
  return res;
}

function createMockReq(overrides: Record<string, unknown> = {}): Partial<Request> {
  return { body: {}, params: {}, query: {}, requestId: 'test-request-id', ...overrides } as Partial<Request>;
}

function findHandler(
  method: string,
  path: string,
): ((req: Request, res: Response, next: NextFunction) => Promise<void>) | undefined {
  interface RouteLayer { handle: (req: Request, res: Response, next: NextFunction) => Promise<void>; }
  interface RouterLayer { route?: { path: string; methods: Record<string, boolean>; stack: RouteLayer[] }; }
  const stack = (adminRouter as unknown as { stack: RouterLayer[] }).stack;
  for (const layer of stack) {
    if (layer.route && layer.route.path === path && layer.route.methods[method.toLowerCase()]) {
      const routeStack = layer.route.stack;
      return routeStack[routeStack.length - 1].handle;
    }
  }
  return undefined;
}

describe('Admin Routes', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('POST /agents (register agent)', () => {
    const handler = findHandler('post', '/agents');

    it('handler is registered on the router', () => {
      expect(handler).toBeDefined();
    });

    it('returns 201 with agent and API key on success', async () => {
      const mockResult = {
        agent: {
          id: 'agent-uuid-001', name: 'Backend Engineer', role: 'backend',
          permissions: ['tickets.claim'], machine_id: null, is_active: true,
          revoked_at: null, created_at: '2026-03-07T00:00:00Z', updated_at: '2026-03-07T00:00:00Z',
        },
        api_key: 'fos_plaintext_key_shown_once',
      };
      mockRegisterAgent.mockResolvedValueOnce(mockResult);
      const req = createMockReq({ body: { name: 'Backend Engineer', role: 'backend' } });
      const res = createMockRes();
      await handler!(req as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(201);
      expect(res._data).toHaveProperty('agent');
      expect(res._data).toHaveProperty('api_key', 'fos_plaintext_key_shown_once');
      expect(mockRegisterAgent).toHaveBeenCalledWith(req.body);
    });

    it('returns 409 when agent already exists', async () => {
      mockRegisterAgent.mockRejectedValueOnce(new AgentAlreadyExistsError('BE', 'backend'));
      const res = createMockRes();
      await handler!(createMockReq({ body: { name: 'BE', role: 'backend' } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(409);
      expect(res._data).toHaveProperty('error', 'AGENT_ALREADY_EXISTS');
    });

    it('returns 400 for invalid role', async () => {
      mockRegisterAgent.mockRejectedValueOnce(new InvalidRoleError('nonexistent'));
      const res = createMockRes();
      await handler!(createMockReq({ body: { name: 'Bad', role: 'nonexistent' } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(400);
      expect(res._data).toHaveProperty('error', 'INVALID_ROLE');
    });

    it('calls next(err) for unexpected errors', async () => {
      const err = new Error('Database connection lost');
      mockRegisterAgent.mockRejectedValueOnce(err);
      const next = vi.fn();
      await handler!(createMockReq({ body: { name: 'A', role: 'b' } }) as Request, createMockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('GET /agents (list agents)', () => {
    const handler = findHandler('get', '/agents');

    it('handler is registered on the router', () => {
      expect(handler).toBeDefined();
    });

    it('returns 200 with paginated agent list', async () => {
      const mockResult = {
        data: [{ id: 'a1', name: 'BE', role: 'backend', is_active: true, created_at: '2026-03-07T00:00:00Z' }],
        pagination: { total: 1, limit: 20, offset: 0, has_more: false },
      };
      mockListAgents.mockResolvedValueOnce(mockResult);
      const res = createMockRes();
      await handler!(createMockReq({ query: {} }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
      expect(res._data).toHaveProperty('data');
      expect(res._data).toHaveProperty('pagination');
    });

    it('calls next(err) for unexpected errors', async () => {
      const err = new Error('DB fail');
      mockListAgents.mockRejectedValueOnce(err);
      const next = vi.fn();
      await handler!(createMockReq({ query: {} }) as Request, createMockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('POST /agents/:id/revoke (revoke agent)', () => {
    const handler = findHandler('post', '/agents/:id/revoke');

    it('handler is registered on the router', () => {
      expect(handler).toBeDefined();
    });

    it('returns 200 with revoked agent on success', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      mockRevokeAgent.mockResolvedValueOnce({
        id: uuid, name: 'BE', role: 'backend', is_active: false, revoked_at: '2026-03-07T12:00:00Z',
      });
      const res = createMockRes();
      await handler!(createMockReq({ params: { id: uuid } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
      expect(res._data).toHaveProperty('agent');
      expect(res._data).toHaveProperty('message');
      expect(mockRevokeAgent).toHaveBeenCalledWith(uuid);
    });

    it('returns 404 when agent not found', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      mockRevokeAgent.mockRejectedValueOnce(new AgentNotFoundError(uuid));
      const res = createMockRes();
      await handler!(createMockReq({ params: { id: uuid } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(404);
      expect(res._data).toHaveProperty('error', 'AGENT_NOT_FOUND');
    });

    it('calls next(err) for unexpected errors', async () => {
      const err = new Error('DB fail');
      mockRevokeAgent.mockRejectedValueOnce(err);
      const next = vi.fn();
      await handler!(createMockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } }) as Request, createMockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('DELETE /agents/:id (deregister agent)', () => {
    const handler = findHandler('delete', '/agents/:id');

    it('handler is registered on the router', () => {
      expect(handler).toBeDefined();
    });

    it('returns 200 with deregistered agent on success', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      mockDeregisterAgent.mockResolvedValueOnce({
        id: uuid, name: 'BE', role: 'backend', is_active: false, revoked_at: '2026-03-07T12:00:00Z',
      });
      const res = createMockRes();
      await handler!(createMockReq({ params: { id: uuid } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
      expect(res._data).toHaveProperty('agent');
      expect(res._data).toHaveProperty('message');
    });

    it('returns 404 when agent not found', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      mockDeregisterAgent.mockRejectedValueOnce(new AgentNotFoundError(uuid));
      const res = createMockRes();
      await handler!(createMockReq({ params: { id: uuid } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(404);
      expect(res._data).toHaveProperty('error', 'AGENT_NOT_FOUND');
    });

    it('calls next(err) for unexpected errors', async () => {
      const err = new Error('DB fail');
      mockDeregisterAgent.mockRejectedValueOnce(err);
      const next = vi.fn();
      await handler!(createMockReq({ params: { id: '550e8400-e29b-41d4-a716-446655440000' } }) as Request, createMockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('POST /agents/:id/sessions (create/update session)', () => {
    const handler = findHandler('post', '/agents/:id/sessions');

    it('handler is registered on the router', () => {
      expect(handler).toBeDefined();
    });

    it('returns 200 with session on success', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      const mockSession = {
        id: 'session-001', agent_id: uuid, session_token: 'mcp-token-123',
        machine_id: 'pop-os', operator: 'reaperoak',
        last_seen: '2026-03-07T12:00:00Z', expires_at: '2026-03-07T13:00:00Z',
      };
      mockCreateOrUpdateSession.mockResolvedValueOnce(mockSession);
      const req = createMockReq({
        params: { id: uuid },
        body: { session_token: 'mcp-token-123', machine_id: 'pop-os', operator: 'reaperoak', expires_in_minutes: 60 },
      });
      const res = createMockRes();
      await handler!(req as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
      expect(res._data).toHaveProperty('session_token', 'mcp-token-123');
      expect(mockCreateOrUpdateSession).toHaveBeenCalledWith(expect.objectContaining({
        agent_id: uuid,
        session_token: 'mcp-token-123',
      }));
    });

    it('calls next(err) for unexpected errors', async () => {
      const err = new Error('DB fail');
      mockCreateOrUpdateSession.mockRejectedValueOnce(err);
      const next = vi.fn();
      const req = createMockReq({
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
        body: { session_token: 'x', machine_id: 'y' },
      });
      await handler!(req as Request, createMockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });
});
