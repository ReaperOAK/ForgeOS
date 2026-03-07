/**
 * Unit tests for auth/keys module.
 *
 * Validates API key generation (32-byte random, SHA-256 hashing),
 * key validation (hash lookup, active/revoked checks), and key
 * revocation. Database interactions are mocked via vi.mock.
 *
 * @module __tests__/auth/keys.test
 * @ticket TASK-FOS-04-001
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

const { hashApiKey, generateApiKey, validateApiKey, revokeApiKey, AgentNotFoundError } =
  await import('../../auth/keys.js');

// ── Test Setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

// ── hashApiKey ───────────────────────────────────────────────────────────────

describe('hashApiKey', () => {
  it('returns a 64-character hex string', () => {
    const hash = hashApiKey('test-key');
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces consistent hashes for the same input', () => {
    const hash1 = hashApiKey('same-key');
    const hash2 = hashApiKey('same-key');
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    const hash1 = hashApiKey('key-a');
    const hash2 = hashApiKey('key-b');
    expect(hash1).not.toBe(hash2);
  });
});

// ── generateApiKey ───────────────────────────────────────────────────────────

describe('generateApiKey', () => {
  it('generates a key with fos_ prefix', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-uuid' }] });

    const result = await generateApiKey('agent-uuid');

    expect(result.plaintextKey).toMatch(/^fos_[0-9a-f]{64}$/);
    expect(result.agentId).toBe('agent-uuid');
    expect(result.keyHash).toHaveLength(64);
  });

  it('stores the SHA-256 hash, not the plaintext key', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-uuid' }] });

    const result = await generateApiKey('agent-uuid');
    const expectedHash = hashApiKey(result.plaintextKey);

    expect(result.keyHash).toBe(expectedHash);
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE agents'),
      [expectedHash, 'agent-uuid'],
    );
  });

  it('throws AgentNotFoundError if agent does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    await expect(generateApiKey('nonexistent')).rejects.toThrow(AgentNotFoundError);
  });

  it('generates unique keys on each call', async () => {
    mockQuery
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-uuid' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-uuid' }] });

    const result1 = await generateApiKey('agent-uuid');
    const result2 = await generateApiKey('agent-uuid');

    expect(result1.plaintextKey).not.toBe(result2.plaintextKey);
    expect(result1.keyHash).not.toBe(result2.keyHash);
  });
});

// ── validateApiKey ───────────────────────────────────────────────────────────

describe('validateApiKey', () => {
  const mockAgent = {
    id: 'agent-uuid',
    name: 'Backend Engineer',
    role: 'backend',
    permissions: ['tickets.claim', 'tickets.advance'],
    machine_id: 'pop-os',
    is_active: true,
    revoked_at: null,
  };

  it('returns agent identity for a valid active key', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [mockAgent] });

    const identity = await validateApiKey('fos_valid_key');

    expect(identity).toEqual({
      id: 'agent-uuid',
      name: 'Backend Engineer',
      role: 'backend',
      permissions: ['tickets.claim', 'tickets.advance'],
      machine_id: 'pop-os',
    });
  });

  it('returns null for an unknown key', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const identity = await validateApiKey('fos_unknown_key');
    expect(identity).toBeNull();
  });

  it('returns null for a revoked key', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...mockAgent, is_active: false, revoked_at: '2026-03-07T00:00:00Z' }],
    });

    const identity = await validateApiKey('fos_revoked_key');
    expect(identity).toBeNull();
  });

  it('returns null for an inactive agent', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...mockAgent, is_active: false }],
    });

    const identity = await validateApiKey('fos_inactive_key');
    expect(identity).toBeNull();
  });

  it('returns null when revoked_at is set even if is_active is true', async () => {
    mockQuery.mockResolvedValueOnce({
      rowCount: 1,
      rows: [{ ...mockAgent, is_active: true, revoked_at: '2026-03-07T00:00:00Z' }],
    });

    const identity = await validateApiKey('fos_revoked_active_key');
    expect(identity).toBeNull();
  });

  it('queries using SHA-256 hash of the key', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const testKey = 'fos_test_key_for_hash';
    const expectedHash = hashApiKey(testKey);

    await validateApiKey(testKey);

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('api_key_hash'),
      [expectedHash],
    );
  });
});

// ── revokeApiKey ─────────────────────────────────────────────────────────────

describe('revokeApiKey', () => {
  it('returns true when agent is found and key is revoked', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-uuid' }] });

    const result = await revokeApiKey('agent-uuid');
    expect(result).toBe(true);
  });

  it('returns false when agent is not found', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 0, rows: [] });

    const result = await revokeApiKey('nonexistent');
    expect(result).toBe(false);
  });

  it('sets api_key_hash to NULL and is_active to FALSE', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'agent-uuid' }] });

    await revokeApiKey('agent-uuid');

    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('api_key_hash = NULL'),
      ['agent-uuid'],
    );
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining('is_active = FALSE'),
      ['agent-uuid'],
    );
  });
});

// ── AgentNotFoundError ───────────────────────────────────────────────────────

describe('AgentNotFoundError', () => {
  it('has correct properties', () => {
    const err = new AgentNotFoundError('some-id');
    expect(err.message).toBe('Agent not found: some-id');
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe('AGENT_NOT_FOUND');
    expect(err.name).toBe('AgentNotFoundError');
    expect(err).toBeInstanceOf(Error);
  });
});
