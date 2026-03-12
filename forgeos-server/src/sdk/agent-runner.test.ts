/**
 * Tests for Agent-Runner SDK module.
 *
 * @module sdk/agent-runner.test
 * @ticket TASK-FOS-06-003
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  AgentRunner,
  ForbiddenGitAddError,
  ScopeViolationError,
  TicketOperationError,
} from './agent-runner.js';
import type { SdkConfig } from './config.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides?: Partial<SdkConfig>): SdkConfig {
  return {
    FORGEOS_MCP_URL: 'http://localhost:3000/mcp',
    FORGEOS_API_KEY: 'test-key',
    FORGEOS_FALLBACK_ENABLED: true,
    FORGEOS_TICKETS_PY_PATH: '.github/tickets.py',
    FORGEOS_MCP_TIMEOUT_MS: 5000,
    FORGEOS_WORKSPACE_PATH: '/tmp/test-workspace',
    ...overrides,
  };
}

// ── Git Safety Guards ────────────────────────────────────────────────────────

describe('AgentRunner.validateGitAddPatterns', () => {
  const runner = new AgentRunner(makeConfig());

  it('allows explicit file paths', () => {
    expect(() =>
      runner.validateGitAddPatterns(['src/server.ts', 'src/config.ts']),
    ).not.toThrow();
  });

  it('rejects "." as a file path', () => {
    expect(() =>
      runner.validateGitAddPatterns(['src/server.ts', '.']),
    ).toThrow(ForbiddenGitAddError);
  });

  it('rejects "git add ."', () => {
    expect(() =>
      runner.validateGitAddPatterns(['git add .']),
    ).toThrow(ForbiddenGitAddError);
  });

  it('rejects "git add -A"', () => {
    expect(() =>
      runner.validateGitAddPatterns(['git add -A']),
    ).toThrow(ForbiddenGitAddError);
  });

  it('rejects "git add --all"', () => {
    expect(() =>
      runner.validateGitAddPatterns(['git add --all']),
    ).toThrow(ForbiddenGitAddError);
  });

  it('rejects "git add -a" (case insensitive)', () => {
    expect(() =>
      runner.validateGitAddPatterns(['Git Add -a']),
    ).toThrow(ForbiddenGitAddError);
  });

  it('allows paths containing "add" but not matching forbidden patterns', () => {
    expect(() =>
      runner.validateGitAddPatterns(['src/add-user.ts']),
    ).not.toThrow();
  });
});

describe('AgentRunner.validateScope', () => {
  const runner = new AgentRunner(makeConfig());
  const ticketScope = [
    'forgeos-server/src/sdk/agent-runner.ts',
    'forgeos-server/src/sdk/config.ts',
  ];

  it('allows files within ticket scope', () => {
    expect(() =>
      runner.validateScope(
        ['forgeos-server/src/sdk/agent-runner.ts', 'forgeos-server/src/sdk/config.ts'],
        ticketScope,
      ),
    ).not.toThrow();
  });

  it('allows system paths (.github/agent-output/)', () => {
    expect(() =>
      runner.validateScope(
        ['.github/agent-output/Backend/TASK-FOS-06-003.md'],
        ticketScope,
      ),
    ).not.toThrow();
  });

  it('allows system paths (.github/ticket-state/)', () => {
    expect(() =>
      runner.validateScope(
        ['.github/ticket-state/QA/TASK-FOS-06-003.json'],
        ticketScope,
      ),
    ).not.toThrow();
  });

  it('allows system paths (.github/tickets/)', () => {
    expect(() =>
      runner.validateScope(
        ['.github/tickets/TASK-FOS-06-003.json'],
        ticketScope,
      ),
    ).not.toThrow();
  });

  it('allows system paths (.github/memory-bank/)', () => {
    expect(() =>
      runner.validateScope(
        ['.github/memory-bank/activeContext.md'],
        ticketScope,
      ),
    ).not.toThrow();
  });

  it('rejects files outside ticket scope', () => {
    expect(() =>
      runner.validateScope(
        ['forgeos-server/src/server.ts'],
        ticketScope,
      ),
    ).toThrow(ScopeViolationError);
  });

  it('rejects files in unrelated directories', () => {
    expect(() =>
      runner.validateScope(
        ['mcp-server/src/main.py'],
        ticketScope,
      ),
    ).toThrow(ScopeViolationError);
  });

  it('includes all out-of-scope files in error message', () => {
    try {
      runner.validateScope(
        ['bad/file1.ts', 'bad/file2.ts'],
        ticketScope,
      );
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ScopeViolationError);
      expect((e as ScopeViolationError).message).toContain('bad/file1.ts');
      expect((e as ScopeViolationError).message).toContain('bad/file2.ts');
    }
  });
});

// ── MCP Claim ────────────────────────────────────────────────────────────────

describe('AgentRunner.claimTicket', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls MCP and returns typed result on success', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ticket: { ticket_id: 'TASK-001' },
                lease_expiry: '2026-03-10T13:00:00Z',
                file_locks: ['src/foo.ts'],
              }),
            },
          ],
        },
      }),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const runner = new AgentRunner(makeConfig());
    const result = await runner.claimTicket('TASK-001', 'Backend', 'pop-os', 'Ticketer');

    expect(result.source).toBe('mcp');
    expect(result.ticket.ticket_id).toBe('TASK-001');
    expect(result.lease_expiry).toBe('2026-03-10T13:00:00Z');
    expect(result.file_locks).toEqual(['src/foo.ts']);
  });

  it('falls back to tickets.py when MCP fails and fallback is enabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    // Mock execFile for CLI fallback
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    vi.mock('node:child_process', async (importOriginal) => {
      const original = await importOriginal<typeof import('node:child_process')>();
      return {
        ...original,
        execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: Function) => {
          if (cb) cb(null, { stdout: 'claimed OK\n', stderr: '' });
          return { stdout: 'claimed OK\n', stderr: '' };
        }),
      };
    });

    const runner = new AgentRunner(makeConfig({ FORGEOS_FALLBACK_ENABLED: true }));
    const result = await runner.claimTicket('TASK-001', 'Backend', 'pop-os');

    expect(result.source).toBe('fallback');
    expect(result.ticket.ticket_id).toBe('TASK-001');

    vi.restoreAllMocks();
  });

  it('throws TicketOperationError when MCP fails and fallback is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const runner = new AgentRunner(makeConfig({ FORGEOS_FALLBACK_ENABLED: false }));

    await expect(
      runner.claimTicket('TASK-001', 'Backend', 'pop-os'),
    ).rejects.toThrow(TicketOperationError);
  });
});

// ── MCP Complete ─────────────────────────────────────────────────────────────

describe('AgentRunner.completeStage', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls MCP and returns typed result on success', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ticket: { ticket_id: 'TASK-001' },
                previous_stage: 'BACKEND',
                new_stage: 'QA',
                dependencies_unblocked: ['TASK-002'],
              }),
            },
          ],
        },
      }),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const runner = new AgentRunner(makeConfig());
    const result = await runner.completeStage('TASK-001', {
      artifacts: ['src/foo.ts'],
      test_results: '10 passed',
      confidence: 'HIGH',
    });

    expect(result.source).toBe('mcp');
    expect(result.previous_stage).toBe('BACKEND');
    expect(result.new_stage).toBe('QA');
    expect(result.dependencies_unblocked).toEqual(['TASK-002']);
  });

  it('throws when MCP fails and fallback is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')));

    const runner = new AgentRunner(makeConfig({ FORGEOS_FALLBACK_ENABLED: false }));

    await expect(
      runner.completeStage('TASK-001', {
        artifacts: ['src/foo.ts'],
        test_results: '10 passed',
        confidence: 'HIGH',
      }),
    ).rejects.toThrow(TicketOperationError);
  });
});

// ── MCP Release ──────────────────────────────────────────────────────────────

describe('AgentRunner.releaseTicket', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls MCP and returns result on success', async () => {
    const mockResponse = {
      ok: true,
      json: async () => ({
        result: {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                ticket: { ticket_id: 'TASK-001' },
                released_file_locks: [],
              }),
            },
          ],
        },
      }),
    };

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

    const runner = new AgentRunner(makeConfig());
    const result = await runner.releaseTicket('TASK-001', 'Backend', 'lease expired');

    expect(result.source).toBe('mcp');
    expect(result.released).toBe(true);
    expect(result.ticket_id).toBe('TASK-001');
  });

  it('throws when MCP fails and fallback is disabled', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    const runner = new AgentRunner(makeConfig({ FORGEOS_FALLBACK_ENABLED: false }));

    await expect(
      runner.releaseTicket('TASK-001', 'Backend'),
    ).rejects.toThrow(TicketOperationError);
  });
});

// ── Error Types ──────────────────────────────────────────────────────────────

describe('Error types', () => {
  it('ForbiddenGitAddError has correct name', () => {
    const err = new ForbiddenGitAddError('git add .');
    expect(err.name).toBe('ForbiddenGitAddError');
    expect(err.message).toContain('git add .');
  });

  it('ScopeViolationError has correct name', () => {
    const err = new ScopeViolationError(['bad/file.ts']);
    expect(err.name).toBe('ScopeViolationError');
    expect(err.message).toContain('bad/file.ts');
  });

  it('TicketOperationError has correct name', () => {
    const err = new TicketOperationError('claimTicket', 'MCP down');
    expect(err.name).toBe('TicketOperationError');
    expect(err.message).toContain('claimTicket');
    expect(err.message).toContain('MCP down');
  });
});
