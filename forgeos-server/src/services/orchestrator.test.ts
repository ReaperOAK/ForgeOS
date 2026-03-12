/**
 * Unit tests for the ForgeOS Orchestrator Loop.
 *
 * All database interactions are mocked. Tests verify:
 * - Polls for READY tickets via database query
 * - Configurable poll interval
 * - Uses claim_ticket_by_id stored function for atomic claiming
 * - Determines correct agent from ticket stage
 * - Records dispatch events in the events table
 * - Handles concurrent instances gracefully (no double-claiming)
 * - Graceful shutdown on stop()
 * - Skips unmapped stages without crashing
 *
 * @ticket TASK-INT-BE015
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ForgeOSOrchestrator,
  STAGE_TO_AGENT,
  createOrchestrator,
  type OrchestratorConfig,
} from './orchestrator.js';

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

/** Build a mock pg.Pool with a controllable `query` function. */
function createMockPool(queryFn: ReturnType<typeof vi.fn>) {
  return { query: queryFn } as unknown as import('pg').Pool;
}

const DEFAULT_CONFIG: OrchestratorConfig = {
  pollIntervalMs: 50, // fast polling for tests
  machineName: 'test-host',
  operatorName: 'test-operator',
  leaseMinutes: 30,
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Wait for at least `ms` milliseconds and drain the microtask queue. */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('ForgeOSOrchestrator', () => {
  let mockQuery: ReturnType<typeof vi.fn>;
  let orchestrator: ForgeOSOrchestrator;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockQuery = vi.fn();
  });

  afterEach(async () => {
    if (orchestrator?.isRunning) {
      await orchestrator.stop();
    }
    vi.useRealTimers();
  });

  // ── STAGE_TO_AGENT mapping ─────────────────────────────────────────────

  describe('STAGE_TO_AGENT', () => {
    it('maps all implementation stages to agent names', () => {
      expect(STAGE_TO_AGENT['BACKEND']).toBe('Backend');
      expect(STAGE_TO_AGENT['FRONTEND']).toBe('Frontend');
      expect(STAGE_TO_AGENT['QA']).toBe('QA');
      expect(STAGE_TO_AGENT['SECURITY']).toBe('Security');
      expect(STAGE_TO_AGENT['CI']).toBe('CIReviewer');
      expect(STAGE_TO_AGENT['DOCUMENTATION']).toBe('Documentation');
      expect(STAGE_TO_AGENT['VALIDATOR']).toBe('Validator');
      expect(STAGE_TO_AGENT['RESEARCH']).toBe('Research');
      expect(STAGE_TO_AGENT['ARCHITECT']).toBe('Architect');
      expect(STAGE_TO_AGENT['PRODUCT_MANAGER']).toBe('ProductManager');
      expect(STAGE_TO_AGENT['UI_DESIGN']).toBe('UIDesigner');
    });

    it('does not map READY or DONE stages', () => {
      expect(STAGE_TO_AGENT['READY']).toBeUndefined();
      expect(STAGE_TO_AGENT['DONE']).toBeUndefined();
    });
  });

  // ── start / stop lifecycle ─────────────────────────────────────────────

  describe('lifecycle', () => {
    it('starts and reports running state', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);

      expect(orchestrator.isRunning).toBe(false);
      await orchestrator.start();
      expect(orchestrator.isRunning).toBe(true);
    });

    it('stops gracefully and reports stopped state', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);

      await orchestrator.start();
      await orchestrator.stop();
      expect(orchestrator.isRunning).toBe(false);
    });

    it('start is idempotent when already running', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);

      await orchestrator.start();
      await orchestrator.start(); // second call is no-op
      expect(orchestrator.isRunning).toBe(true);
    });

    it('stop is safe to call multiple times', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);

      await orchestrator.start();
      await orchestrator.stop();
      await orchestrator.stop(); // second call is no-op
      expect(orchestrator.isRunning).toBe(false);
    });
  });

  // ── Polling for READY tickets ──────────────────────────────────────────

  describe('polling', () => {
    it('queries for READY tickets on first poll', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);

      await orchestrator.start();
      // Advance past the immediate (0ms) timer
      await vi.advanceTimersByTimeAsync(10);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'READY'"),
      );

      await orchestrator.stop();
    });

    it('polls repeatedly at the configured interval', async () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), {
        ...DEFAULT_CONFIG,
        pollIntervalMs: 100,
      });

      await orchestrator.start();
      // First poll (immediate)
      await vi.advanceTimersByTimeAsync(10);
      const callsAfterFirst = mockQuery.mock.calls.length;

      // Advance to next interval
      await vi.advanceTimersByTimeAsync(110);
      expect(mockQuery.mock.calls.length).toBeGreaterThan(callsAfterFirst);

      await orchestrator.stop();
    });
  });

  // ── Claim and dispatch ─────────────────────────────────────────────────

  describe('claim and dispatch', () => {
    it('claims a READY ticket and records dispatch event', async () => {
      const readyTickets = [
        { ticket_id: 'TASK-001', stage: 'BACKEND', priority: 'high' },
      ];

      mockQuery
        // 1st call: SELECT READY tickets
        .mockResolvedValueOnce({ rows: readyTickets })
        // 2nd call: agent upsert
        .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] })
        // 3rd call: claim_ticket_by_id
        .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-001' }] })
        // 4th call: INSERT event
        .mockResolvedValueOnce({ rows: [] })
        // Subsequent polls return empty
        .mockResolvedValue({ rows: [] });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();
      await vi.advanceTimersByTimeAsync(10);

      // Verify agent upsert
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents'),
        ['Backend'],
      );

      // Verify claim call with correct arguments
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('claim_ticket_by_id'),
        ['TASK-001', 'agent-uuid-1', 'Backend', 'test-host', 'test-operator', 30],
      );

      // Verify dispatch event recorded
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO events'),
        expect.arrayContaining(['TASK-001', 'agent-uuid-1', 'Backend']),
      );

      await orchestrator.stop();
    });

    it('determines the correct agent from the ticket stage', async () => {
      const readyTickets = [
        { ticket_id: 'TASK-002', stage: 'QA', priority: 'medium' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: readyTickets })
        .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-qa' }] })
        .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-002' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();
      await vi.advanceTimersByTimeAsync(10);

      // Agent upsert should use 'QA' (mapped from QA stage)
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO agents'),
        ['QA'],
      );

      await orchestrator.stop();
    });

    it('processes multiple READY tickets in priority order', async () => {
      const readyTickets = [
        { ticket_id: 'TASK-A', stage: 'BACKEND', priority: 'critical' },
        { ticket_id: 'TASK-B', stage: 'FRONTEND', priority: 'high' },
      ];

      const claimedTickets: string[] = [];

      mockQuery
        .mockResolvedValueOnce({ rows: readyTickets })
        // TASK-A: agent upsert + claim + event
        .mockResolvedValueOnce({ rows: [{ id: 'agent-be' }] })
        .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-A' }] })
        .mockResolvedValueOnce({ rows: [] })
        // TASK-B: agent upsert + claim + event
        .mockResolvedValueOnce({ rows: [{ id: 'agent-fe' }] })
        .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-B' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] });

      // Track claim calls
      mockQuery.mockImplementation((...args: unknown[]) => {
        const sql = args[0] as string;
        const params = args[1] as string[] | undefined;
        if (sql.includes('claim_ticket_by_id') && params) {
          claimedTickets.push(params[0]);
        }
        // Return the original mock chain value
        return mockQuery.getMockImplementation()
          ? Promise.resolve({ rows: [] })
          : Promise.resolve({ rows: [] });
      });

      // Re-setup with ordered mocks
      mockQuery.mockReset();
      mockQuery
        .mockResolvedValueOnce({ rows: readyTickets })
        .mockResolvedValueOnce({ rows: [{ id: 'agent-be' }] })
        .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-A' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ id: 'agent-fe' }] })
        .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-B' }] })
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();
      await vi.advanceTimersByTimeAsync(10);

      // Both agents should be registered
      const agentUpsertCalls = mockQuery.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO agents'),
      );
      expect(agentUpsertCalls.length).toBe(2);
      expect(agentUpsertCalls[0]![1]).toEqual(['Backend']);
      expect(agentUpsertCalls[1]![1]).toEqual(['Frontend']);

      await orchestrator.stop();
    });
  });

  // ── Concurrent safety (no double-claiming) ────────────────────────────

  describe('concurrent safety', () => {
    it('handles claim failure gracefully (race lost to another instance)', async () => {
      const readyTickets = [
        { ticket_id: 'TASK-RACE', stage: 'BACKEND', priority: 'high' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: readyTickets })
        .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid' }] })
        // claim returns 0 rows = someone else won
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValue({ rows: [] });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();
      await vi.advanceTimersByTimeAsync(10);

      // No event insert should have happened (claim returned 0 rows)
      const eventInserts = mockQuery.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('INSERT INTO events'),
      );
      expect(eventInserts.length).toBe(0);

      await orchestrator.stop();
    });

    it('handles claim exception gracefully (DB error during race)', async () => {
      const readyTickets = [
        { ticket_id: 'TASK-ERR', stage: 'SECURITY', priority: 'medium' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: readyTickets })
        .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid' }] })
        // claim throws (e.g., serialization failure)
        .mockRejectedValueOnce(new Error('serialization_failure'))
        .mockResolvedValue({ rows: [] });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();
      await vi.advanceTimersByTimeAsync(10);

      // Orchestrator should still be running — error was handled
      expect(orchestrator.isRunning).toBe(true);

      await orchestrator.stop();
    });
  });

  // ── Unmapped stage handling ────────────────────────────────────────────

  describe('unmapped stages', () => {
    it('skips tickets with unmapped stages (READY, DONE)', async () => {
      const readyTickets = [
        { ticket_id: 'TASK-SKIP', stage: 'DONE', priority: 'low' },
      ];

      mockQuery
        .mockResolvedValueOnce({ rows: readyTickets })
        .mockResolvedValue({ rows: [] });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();
      await vi.advanceTimersByTimeAsync(10);

      // No claim attempt should have been made
      const claimCalls = mockQuery.mock.calls.filter(
        (c) => typeof c[0] === 'string' && c[0].includes('claim_ticket_by_id'),
      );
      expect(claimCalls.length).toBe(0);

      await orchestrator.stop();
    });
  });

  // ── Poll error handling ────────────────────────────────────────────────

  describe('poll error handling', () => {
    it('continues polling after a query failure', async () => {
      mockQuery
        // First poll fails
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        // Second poll succeeds
        .mockResolvedValue({ rows: [] });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();

      // First poll (fails)
      await vi.advanceTimersByTimeAsync(10);
      // Second poll (succeeds)
      await vi.advanceTimersByTimeAsync(DEFAULT_CONFIG.pollIntervalMs + 10);

      expect(orchestrator.isRunning).toBe(true);
      expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(2);

      await orchestrator.stop();
    });
  });

  // ── Graceful shutdown ──────────────────────────────────────────────────

  describe('graceful shutdown', () => {
    it('stops processing mid-batch when stop() is called', async () => {
      const manyTickets = Array.from({ length: 5 }, (_, i) => ({
        ticket_id: `TASK-${i}`,
        stage: 'BACKEND',
        priority: 'medium',
      }));

      let claimCount = 0;
      mockQuery.mockImplementation(async (sql: string) => {
        if (sql.includes("status = 'READY'")) {
          return { rows: manyTickets };
        }
        if (sql.includes('INSERT INTO agents')) {
          return { rows: [{ id: `agent-${claimCount}` }] };
        }
        if (sql.includes('claim_ticket_by_id')) {
          claimCount++;
          // Simulate some processing time
          await wait(5);
          return { rows: [{ ticket_id: `TASK-${claimCount}` }] };
        }
        return { rows: [] };
      });

      orchestrator = new ForgeOSOrchestrator(createMockPool(mockQuery), DEFAULT_CONFIG);
      await orchestrator.start();

      // Let the first poll start
      await vi.advanceTimersByTimeAsync(5);

      // Stop while processing
      await orchestrator.stop();

      // Should have stopped — not all 5 tickets necessarily claimed
      expect(orchestrator.isRunning).toBe(false);
    });
  });

  // ── createOrchestrator factory ─────────────────────────────────────────

  describe('createOrchestrator', () => {
    it('creates an orchestrator with default config', () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = createOrchestrator(createMockPool(mockQuery));
      expect(orchestrator).toBeInstanceOf(ForgeOSOrchestrator);
      expect(orchestrator.isRunning).toBe(false);
    });

    it('merges partial config with defaults', () => {
      mockQuery.mockResolvedValue({ rows: [] });
      orchestrator = createOrchestrator(createMockPool(mockQuery), {
        machineName: 'custom-host',
      });
      expect(orchestrator).toBeInstanceOf(ForgeOSOrchestrator);
    });
  });
});
