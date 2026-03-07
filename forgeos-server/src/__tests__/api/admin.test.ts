import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const {
  mockRegisterAgent,
  mockListAgents,
  mockRevokeAgent,
  mockDeregisterAgent,
} = vi.hoisted(() => ({
  mockRegisterAgent: vi.fn(),
  mockListAgents: vi.fn(),
  mockRevokeAgent: vi.fn(),
  mockDeregisterAgent: vi.fn(),
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
  createOrUpdateSession: vi.fn(),
}));

const { adminRouter } = await import('../../api/routes/admin.js');
const registrationMod = await import('../../auth/registration.js');
const AgentAlreadyExistsError = registrationMod.AgentAlreadyExistsError;
const InvalidRoleError = registrationMod.InvalidRoleError;

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

  describe('POST /agents', () => {
    const handler = findHandler('post', '/agents');
    it('handler exists', () => { expect(handler).toBeDefined(); });
    it('returns 201 on success', async () => {
      const mockResult = {
        agent: { id: 'a1', name: 'BE', role: 'backend', permissions: ['tickets.claim'], machine_id: null, is_active: true, revoked_at: null, created_at: '2026-03-07T00:00:00Z', updated_at: '2026-03-07T00:00:00Z' },
        api_key: 'fos_key',
      };
      mockRegisterAgent.mockResolvedValueOnce(mockResult);
      const req = createMockReq({ body: { name: 'BE', role: 'backend' } });
      const res = createMockRes();
      await handler!(req as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(201);
      expect(res._data).toHaveProperty('api_key', 'fos_key');
    });
    it('returns 409 on duplicate', async () => {
      mockRegisterAgent.mockRejectedValueOnce(new AgentAlreadyExistsError('BE', 'backend'));
      const res = createMockRes();
      await handler!(createMockReq({ body: { name: 'BE', role: 'backend' } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(409);
      expect(res._data).toHaveProperty('error', 'AGENT_ALREADY_EXISTS');
    });
    it('returns 400 on invalid role', async () => {
      mockRegisterAgent.mockRejectedValueOnce(new InvalidRoleError('bad'));
      const res = createMockRes();
      await handler!(createMockReq({ body: { name: 'X', role: 'bad' } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(400);
      expect(res._data).toHaveProperty('error', 'INVALID_ROLE');
    });
    it('calls next on unexpected error', async () => {
      const err = new Error('DB fail');
      mockRegisterAgent.mockRejectedValueOnce(err);
      const next = vi.fn();
      await handler!(createMockReq({ body: { name: 'A', role: 'b' } }) as Request, createMockRes() as unknown as Response, next);
      expect(next).toHaveBeenCalledWith(err);
    });
  });

  describe('GET /agents', () => {
    const handler = findHandler('get', '/agents');
    it('handler exists', () => { expect(handler).toBeDefined(); });
    it('returns 200 with paginated list', async () => {
      mockListAgents.mockResolvedValueOnce({
        data: [{ id: 'a1', name: 'BE', role: 'backend', is_active: true }],
        pagination: { total: 1, limit: 20, offset: 0, has_more: false },
      });
      const res = createMockRes();
      await handler!(createMockReq({ query: {} }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
      expect(res._data).toHaveProperty('data');
      expect(res._data).toHaveProperty('pagination');
    });
  });

  describe('POST /agents/:id/revoke', () => {
    const handler = findHandler('post', '/agents/:id/revoke');
    it('handler exists', () => { expect(handler).toBeDefined(); });
    it('returns 200 on revoke', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      mockRevokeAgent.mockResolvedValueOnce({ id: uuid, name: 'BE', is_active: false, revoked_at: '2026-03-07T12:00:00Z' });
      const res = createMockRes();
      await handler!(createMockReq({ params: { id: uuid } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
      expect(res._data).toHaveProperty('agent');
      expect(mockRevokeAgent).toHaveBeenCalledWith(uuid);
    });
  });

  describe('DELETE /agents/:id', () => {
    const handler = findHandler('delete', '/agents/:id');
    it('handler exists', () => { expect(handler).toBeDefined(); });
    it('returns 200 on deregister', async () => {
      const uuid = '550e8400-e29b-41d4-a716-446655440000';
      mockDeregisterAgent.mockResolvedValueOnce({ id: uuid, name: 'BE', is_active: false });
      const res = createMockRes();
      await handler!(createMockReq({ params: { id: uuid } }) as Request, res as unknown as Response, vi.fn());
      expect(res.statusCode).toBe(200);
      expect(res._data).toHaveProperty('agent');
    });
  });
});
