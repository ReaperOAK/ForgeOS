/**
 * Unit tests for auth/registration module.
 *
 * Validates agent registration (insert + key generation), listing
 * (paginated, no hashes), revocation (delegates to keys.revokeApiKey),
 * deregistration (soft-delete + session expiry), heartbeat (updated_at),
 * and session management (upsert).
 *
 * @module __tests__/auth/registration.test
 * @ticket TASK-FOS-04-002
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// ── Mock pg pool ─────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../db/pool.js', () => ({
  getPool: () => ({
    query: mockQuery,
    on: vi.fn(),
    totalCount: 0,
    idleCount: 0,
    waitingCount: 0,
  }),
  pool: {
    query: mockQuery,
    on: vi.fn(),
  },
}));

// ── Mock dotenv ──────────────────────────────────────────────────────────────

vi.mock('dotenv', () => ({ default: { config: vi.fn() } }));

// ── Mock generateApiKey and revokeApiKey from keys module ────────────────────

const mockGenerateApiKey = vi.fn();
const mockRevokeApiKey = vi.fn();

vi.mock('../../auth/keys.js', () => ({
  generateApiKey: (...args: unknown[]) => mockGenerateApiKey(...args),
  revokeApiKey: (...args: unknown[]) => mockRevokeApiKey(...args),
  AgentNotFoundError: class AgentNotFoundError extends Error {
    readonly statusCode = 404;
    readonly code = 'AGENT_NOT_FOUND';
    constructor(agentId: string) {
      super(`Agent not found: ${agentId}`);
      this.name = 'AgentNotFoundError';
    }
  },
}));

// ── Import after mocks ──────────────────────────────────────────────────────

const {
  registerAgent,
  listAgents,
  revokeAgent,
  deregisterAgent,
  updateLastSeen,
  createOrUpdateSession,
  AgentAlreadyExistsError,
  InvalidRoleError,
} = await import('../../auth/registration.js');

// ── Test Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const MOCK_AGENT_ROW = {
  id: 'agent-uuid-001',
  name: 'Backend Engineer',
  role: 'backend',
  permissions: ['tickets.claim', 'tickets.advance'],
  machine_id: 'pop-os',
  is_active: true,
  revoked_at: null,
  created_at: '2026-03-07T00:00:00Z',
  updated_at: '2026-03-07T00:00:00Z',
};

// ── registerAgent ────────────────────────────────────────────────────────────

describe('registerAgent', () => {
  it('creates agent record and returns plaintext API key', async () => {
    // INSERT returns new agent id
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'agent-uuid-001' }],
    });
    // SELECT returns created agent
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [MOCK_AGENT_ROW],
    });

    mockGenerateApiKey.mockResolvedValueOnce({
      plaintextKey: 'fos_test_plaintext_key',
      keyHash: 'hash_of_key',
      agentId: 'agent-uuid-001',
    });

    const result = await registerAgent({
      name: 'Backend Engineer',
      role: 'backend',
    });

    expect(result.agent.id).toBe('agent-uuid-001');
    expect(result.agent.name).toBe('Backend Engineer');
    expect(result.agent.role).toBe('backend');
    expect(result.api_key).toBe('fos_test_plaintext_key');
    // Verify API key hash is NOT in the returned agent
    expect(result.agent).not.toHaveProperty('api_key_hash');
  });

  it('passes correct permissions for the role', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'agent-uuid-002' }],
    });
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...MOCK_AGENT_ROW, id: 'agent-uuid-002', role: 'qa' }],
    });
    mockGenerateApiKey.mockResolvedValueOnce({
      plaintextKey: 'fos_qa_key',
      keyHash: 'hash',
      agentId: 'agent-uuid-002',
    });

    await registerAgent({ name: 'QA Engineer', role: 'qa' });

    // First call is INSERT — check that permissions were passed
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO agents'),
      expect.arrayContaining(['QA Engineer', 'qa']),
    );
  });

  it('includes machine_id when provided', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'agent-uuid-003' }],
    });
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...MOCK_AGENT_ROW, id: 'agent-uuid-003', machine_id: 'build-server' }],
    });
    mockGenerateApiKey.mockResolvedValueOnce({
      plaintextKey: 'fos_key3',
      keyHash: 'hash3',
      agentId: 'agent-uuid-003',
    });

    const result = await registerAgent({
      name: 'Backend Engineer',
      role: 'backend',
      machine_id: 'build-server',
    });

    expect(result.agent.machine_id).toBe('build-server');
  });

  it('throws InvalidRoleError for unrecognized role', async () => {
    await expect(
      registerAgent({ name: 'Bad Agent', role: 'nonexistent_role' }),
    ).rejects.toThrow(InvalidRoleError);
  });

  it('throws AgentAlreadyExistsError on unique constraint violation', async () => {
    const pgError = new Error('duplicate key value violates unique constraint');
    (pgError as unknown as Record<string, string>).code = '23505';
    mockQuery.mockRejectedValueOnce(pgError);

    await expect(
      registerAgent({ name: 'Backend Engineer', role: 'backend' }),
    ).rejects.toThrow(AgentAlreadyExistsError);
  });

  it('calls generateApiKey with the new agent ID', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'agent-uuid-004' }],
    });
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...MOCK_AGENT_ROW, id: 'agent-uuid-004' }],
    });
    mockGenerateApiKey.mockResolvedValueOnce({
      plaintextKey: 'fos_key4',
      keyHash: 'hash4',
      agentId: 'agent-uuid-004',
    });

    await registerAgent({ name: 'Backend Engineer', role: 'backend' });

    expect(mockGenerateApiKey).toHaveBeenCalledWith('agent-uuid-004');
  });
});

// ── listAgents ───────────────────────────────────────────────────────────────

describe('listAgents', () => {
  it('returns paginated agent list without api_key_hash', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '2' }] })
      .mockResolvedValueOnce({
        rows: [
          MOCK_AGENT_ROW,
          { ...MOCK_AGENT_ROW, id: 'agent-uuid-002', name: 'QA Engineer', role: 'qa' },
        ],
      });

    const result = await listAgents({ limit: 20, offset: 0 });

    expect(result.data).toHaveLength(2);
    expect(result.pagination.total).toBe(2);
    expect(result.pagination.limit).toBe(20);
    expect(result.pagination.offset).toBe(0);
    expect(result.pagination.has_more).toBe(false);
    // Verify no api_key_hash in returned data
    for (const agent of result.data) {
      expect(agent).not.toHaveProperty('api_key_hash');
      expect(agent).toHaveProperty('id');
      expect(agent).toHaveProperty('name');
      expect(agent).toHaveProperty('role');
      expect(agent).toHaveProperty('is_active');
      expect(agent).toHaveProperty('created_at');
    }
  });

  it('returns correct has_more when more pages exist', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '50' }] })
      .mockResolvedValueOnce({ rows: [MOCK_AGENT_ROW] });

    const result = await listAgents({ limit: 20, offset: 0 });

    expect(result.pagination.has_more).toBe(true);
  });

  it('returns has_more=false on last page', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '5' }] })
      .mockResolvedValueOnce({ rows: [MOCK_AGENT_ROW] });

    const result = await listAgents({ limit: 20, offset: 0 });

    expect(result.pagination.has_more).toBe(false);
  });

  it('applies LIMIT and OFFSET parameters', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [{ count: '10' }] })
      .mockResolvedValueOnce({ rows: [] });

    await listAgents({ limit: 5, offset: 10 });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('LIMIT'),
      [5, 10],
    );
  });
});

// ── revokeAgent ──────────────────────────────────────────────────────────────

describe('revokeAgent', () => {
  it('calls revokeApiKey and returns updated agent', async () => {
    mockRevokeApiKey.mockResolvedValueOnce(true);
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        ...MOCK_AGENT_ROW,
        is_active: false,
        revoked_at: '2026-03-07T12:00:00Z',
      }],
    });

    const result = await revokeAgent('agent-uuid-001');

    expect(mockRevokeApiKey).toHaveBeenCalledWith('agent-uuid-001');
    expect(result.is_active).toBe(false);
    expect(result.revoked_at).toBe('2026-03-07T12:00:00Z');
  });

  it('throws when agent not found (revokeApiKey returns false)', async () => {
    mockRevokeApiKey.mockResolvedValueOnce(false);

    await expect(revokeAgent('nonexistent')).rejects.toThrow('Agent not found');
  });
});

// ── deregisterAgent ──────────────────────────────────────────────────────────

describe('deregisterAgent', () => {
  it('deactivates agent and expires sessions', async () => {
    // Check agent exists
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ id: 'agent-uuid-001' }],
    });
    // Deactivate agent
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // Expire sessions
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    // Fetch updated agent
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{
        ...MOCK_AGENT_ROW,
        is_active: false,
        revoked_at: '2026-03-07T12:00:00Z',
      }],
    });

    const result = await deregisterAgent('agent-uuid-001');

    expect(result.is_active).toBe(false);
    // Verify UPDATE agents was called
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      ['agent-uuid-001'],
    );
    // Verify UPDATE sessions was called
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE sessions'),
      ['agent-uuid-001'],
    );
  });

  it('throws when agent does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(deregisterAgent('nonexistent')).rejects.toThrow('Agent not found');
  });
});

// ── updateLastSeen ───────────────────────────────────────────────────────────

describe('updateLastSeen', () => {
  it('updates agents.updated_at for the given agent', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });

    await updateLastSeen('agent-uuid-001');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      ['agent-uuid-001'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('updated_at = NOW()'),
      expect.any(Array),
    );
  });
});

// ── createOrUpdateSession ────────────────────────────────────────────────────

describe('createOrUpdateSession', () => {
  it('creates a new session with correct parameters', async () => {
    const mockSession = {
      id: 'session-uuid-001',
      agent_id: 'agent-uuid-001',
      session_token: 'mcp-session-token-123',
      machine_id: 'pop-os',
      operator: 'reaperoak',
      last_seen: '2026-03-07T12:00:00Z',
      expires_at: '2026-03-07T13:00:00Z',
    };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [mockSession] });

    const result = await createOrUpdateSession({
      agent_id: 'agent-uuid-001',
      session_token: 'mcp-session-token-123',
      machine_id: 'pop-os',
      operator: 'reaperoak',
      expires_in_minutes: 60,
    });

    expect(result.session_token).toBe('mcp-session-token-123');
    expect(result.agent_id).toBe('agent-uuid-001');
    expect(result.machine_id).toBe('pop-os');
  });

  it('updates last_seen on conflict (existing session)', async () => {
    const mockSession = {
      id: 'session-uuid-001',
      agent_id: 'agent-uuid-001',
      session_token: 'existing-token',
      machine_id: 'pop-os',
      operator: null,
      last_seen: '2026-03-07T12:30:00Z',
      expires_at: '2026-03-07T13:00:00Z',
    };
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [mockSession] });

    const result = await createOrUpdateSession({
      agent_id: 'agent-uuid-001',
      session_token: 'existing-token',
      machine_id: 'pop-os',
      expires_in_minutes: 60,
    });

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT'),
      expect.any(Array),
    );
    expect(result.session_token).toBe('existing-token');
  });
});

// ── Domain Error Classes ─────────────────────────────────────────────────────

describe('AgentAlreadyExistsError', () => {
  it('has correct properties', () => {
    const err = new AgentAlreadyExistsError('Test Agent', 'backend');
    expect(err.message).toBe('Agent already exists: Test Agent (backend)');
    expect(err.statusCode).toBe(409);
    expect(err.code).toBe('AGENT_ALREADY_EXISTS');
    expect(err.name).toBe('AgentAlreadyExistsError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('InvalidRoleError', () => {
  it('has correct properties', () => {
    const err = new InvalidRoleError('bad_role');
    expect(err.message).toBe('Invalid agent role: bad_role');
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('INVALID_ROLE');
    expect(err.name).toBe('InvalidRoleError');
    expect(err).toBeInstanceOf(Error);
  });
});
