/**
 * Seed Script Tests — TASK-FOS-01-003
 *
 * Unit tests for the database seed script that creates the default
 * project and admin agent. Uses Vitest mocks to isolate from real
 * PostgreSQL.
 *
 * @module __tests__/db/seed
 * @ticket TASK-FOS-01-003
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock dependencies before any imports ─────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn(() => ({
    query: mockQuery,
  })),
}));

vi.mock('../../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Seed — seed.ts', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function importSeed() {
    return import('../../db/seed.js');
  }

  describe('seed()', () => {
    it('should create default ForgeOS project with repo_url and lease settings', async () => {
      const projectId = '11111111-1111-1111-1111-111111111111';
      const agentId = '22222222-2222-2222-2222-222222222222';

      // Project upsert returns project id
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: projectId }],
      });
      // Agent lookup — no existing agent
      mockQuery.mockResolvedValueOnce({
        rows: [],
      });
      // Agent insert returns agent id
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: agentId }],
      });

      const { seed } = await importSeed();
      const result = await seed();

      expect(result.projectId).toBe(projectId);

      // Verify project insert was called with correct parameters
      const projectCall = mockQuery.mock.calls[0];
      expect(projectCall[0]).toContain('INSERT INTO projects');
      expect(projectCall[0]).toContain('ON CONFLICT (name) DO UPDATE');
      expect(projectCall[1][0]).toBe('ForgeOS');
      expect(projectCall[1][2]).toBe('https://github.com/Ticketer/ForgeOS');
      expect(projectCall[1][3]).toBe(30);  // default_lease_minutes
      expect(projectCall[1][4]).toBe(120); // max_lease_minutes
    });

    it('should create admin agent with generated API key when none exists', async () => {
      const projectId = '11111111-1111-1111-1111-111111111111';
      const agentId = '22222222-2222-2222-2222-222222222222';

      mockQuery.mockResolvedValueOnce({ rows: [{ id: projectId }] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // No existing agent
      mockQuery.mockResolvedValueOnce({ rows: [{ id: agentId }] });

      const { seed } = await importSeed();
      const result = await seed();

      expect(result.agentId).toBe(agentId);
      expect(result.keyGenerated).toBe(true);

      // Verify agent insert was called
      const agentCall = mockQuery.mock.calls[2];
      expect(agentCall[0]).toContain('INSERT INTO agents');
      expect(agentCall[1][0]).toBe('admin');    // name
      expect(agentCall[1][1]).toBe('admin');    // role
      expect(agentCall[1][2]).toMatch(/^[a-f0-9]{64}$/); // SHA-256 hash
      expect(agentCall[1][3]).toBe('["*"]');    // permissions
    });

    it('should print plaintext API key exactly once to stdout', async () => {
      const projectId = '11111111-1111-1111-1111-111111111111';
      const agentId = '22222222-2222-2222-2222-222222222222';

      mockQuery.mockResolvedValueOnce({ rows: [{ id: projectId }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [{ id: agentId }] });

      const { seed } = await importSeed();
      await seed();

      // Find the stdout call that contains the API key
      const keyOutput = stdoutSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && call[0].includes('ADMIN API KEY'),
      );
      expect(keyOutput).toBeDefined();

      // Extract and verify key format: fos_<64 hex chars>
      const output = keyOutput![0] as string;
      const keyMatch = output.match(/fos_[a-f0-9]{64}/);
      expect(keyMatch).not.toBeNull();

      // Verify it's only printed once
      const keyOutputs = stdoutSpy.mock.calls.filter(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('fos_'),
      );
      expect(keyOutputs.length).toBe(1);
    });

    it('should skip key generation when admin agent already exists with API key', async () => {
      const projectId = '11111111-1111-1111-1111-111111111111';
      const agentId = '22222222-2222-2222-2222-222222222222';

      mockQuery.mockResolvedValueOnce({ rows: [{ id: projectId }] });
      // Existing agent with key hash
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: agentId, api_key_hash: 'abc123def456' }],
      });

      const { seed } = await importSeed();
      const result = await seed();

      expect(result.agentId).toBe(agentId);
      expect(result.keyGenerated).toBe(false);

      // Only 2 queries: project upsert + agent lookup (no insert)
      expect(mockQuery).toHaveBeenCalledTimes(2);

      // No API key printed to stdout
      const keyOutput = stdoutSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('ADMIN API KEY'),
      );
      expect(keyOutput).toBeUndefined();
    });

    it('should throw when project upsert returns no rows', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const { seed } = await importSeed();
      await expect(seed()).rejects.toThrow('Failed to create/update default project');
    });

    it('should throw when agent insert returns no rows', async () => {
      const projectId = '11111111-1111-1111-1111-111111111111';

      mockQuery.mockResolvedValueOnce({ rows: [{ id: projectId }] });
      mockQuery.mockResolvedValueOnce({ rows: [] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // No row returned from insert

      const { seed } = await importSeed();
      await expect(seed()).rejects.toThrow('Failed to create/update admin agent');
    });
  });
});
