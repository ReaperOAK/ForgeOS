/**
 * Reconciliation Engine Unit Tests — TASK-FOS-06-004
 *
 * Tests the webhook state reconciliation functions with mocked database
 * pool and structured logger. Validates each reconciliation rule:
 * - CLAIM commit + READY ticket → create claim
 * - WORK commit + CLAIMED ticket → advance ticket
 * - Duplicate operations → idempotent (ALREADY_RECONCILED)
 * - Missing/terminal tickets → AMBIGUOUS
 *
 * @module webhooks/reconciliation.test
 * @ticket TASK-FOS-06-004
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  reconcileClaimOp,
  reconcileWorkOp,
  reconcileOperations,
  runPeriodicReconciliation,
  type DatabasePool,
  type StructuredLogger,
  type ReconciliationDeps,
} from './reconciliation.js';
import type { ClaimCommitOp, WorkCommitOp, TicketCommitOp } from './parser.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

interface MockDeps extends ReconciliationDeps {
  pool: DatabasePool & { query: ReturnType<typeof vi.fn> };
  logger: StructuredLogger & {
    info: ReturnType<typeof vi.fn>;
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    debug: ReturnType<typeof vi.fn>;
  };
}

function createMockDeps(): MockDeps {
  return {
    pool: { query: vi.fn() },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    },
  };
}

function makeClaimOp(overrides: Partial<ClaimCommitOp> = {}): ClaimCommitOp {
  return {
    type: 'CLAIM',
    ticketId: 'TASK-FOS-01-001',
    agent: 'Backend',
    machine: 'ws-1',
    operator: 'oak',
    commitSha: 'abc123',
    ...overrides,
  };
}

function makeWorkOp(overrides: Partial<WorkCommitOp> = {}): WorkCommitOp {
  return {
    type: 'WORK',
    ticketId: 'TASK-FOS-01-001',
    stage: 'BACKEND',
    agent: 'Backend',
    machine: 'ws-1',
    commitSha: 'def456',
    ...overrides,
  };
}

// ── reconcileClaimOp ─────────────────────────────────────────────────────────

describe('reconcileClaimOp', () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('creates claim when ticket is READY and agent found', async () => {
    deps.pool.query
      // SELECT ticket
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'READY',
          stage: 'BACKEND',
          claimed_by: null,
          claimed_by_name: null,
          machine_id: null,
          lease_expiry: null,
        }],
      })
      // SELECT agent
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] })
      // UPDATE ticket (with RETURNING)
      .mockResolvedValueOnce({ rows: [{ ticket_id: 'TASK-FOS-01-001' }] })
      // INSERT event
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileClaimOp(makeClaimOp(), deps);

    expect(result.action).toBe('CLAIM_CREATED');
    expect(result.ticketId).toBe('TASK-FOS-01-001');
    expect(result.commitSha).toBe('abc123');
    expect(deps.pool.query).toHaveBeenCalledTimes(4);
  });

  it('returns ALREADY_RECONCILED when ticket is already CLAIMED', async () => {
    deps.pool.query.mockResolvedValueOnce({
      rows: [{
        ticket_id: 'TASK-FOS-01-001',
        status: 'CLAIMED',
        stage: 'BACKEND',
        claimed_by: 'some-agent-id',
        claimed_by_name: 'Backend',
        machine_id: 'ws-1',
        lease_expiry: '2026-03-07T12:00:00Z',
      }],
    });

    const result = await reconcileClaimOp(makeClaimOp(), deps);

    expect(result.action).toBe('ALREADY_RECONCILED');
    expect(result.details).toContain('CLAIMED');
    // Should not attempt UPDATE or INSERT
    expect(deps.pool.query).toHaveBeenCalledTimes(1);
  });

  it('returns ALREADY_RECONCILED when ticket is IN_PROGRESS', async () => {
    deps.pool.query.mockResolvedValueOnce({
      rows: [{
        ticket_id: 'TASK-FOS-01-001',
        status: 'IN_PROGRESS',
        stage: 'BACKEND',
        claimed_by: 'some-agent-id',
        claimed_by_name: 'Backend',
        machine_id: 'ws-1',
        lease_expiry: '2026-03-07T12:00:00Z',
      }],
    });

    const result = await reconcileClaimOp(makeClaimOp(), deps);

    expect(result.action).toBe('ALREADY_RECONCILED');
    expect(result.details).toContain('IN_PROGRESS');
  });

  it('returns AMBIGUOUS when ticket not found in database', async () => {
    deps.pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await reconcileClaimOp(makeClaimOp(), deps);

    expect(result.action).toBe('AMBIGUOUS');
    expect(result.details).toContain('not found');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns AMBIGUOUS when ticket is in terminal status DONE', async () => {
    deps.pool.query
      // SELECT ticket
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'DONE',
          stage: 'DONE',
          claimed_by: null,
          claimed_by_name: null,
          machine_id: null,
          lease_expiry: null,
        }],
      })
      // INSERT reconciliation event
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileClaimOp(makeClaimOp(), deps);

    expect(result.action).toBe('AMBIGUOUS');
    expect(result.details).toContain('terminal status');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns AMBIGUOUS when agent not found in database', async () => {
    deps.pool.query
      // SELECT ticket (READY)
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'READY',
          stage: 'BACKEND',
          claimed_by: null,
          claimed_by_name: null,
          machine_id: null,
          lease_expiry: null,
        }],
      })
      // SELECT agent (not found)
      .mockResolvedValueOnce({ rows: [] })
      // INSERT reconciliation event
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileClaimOp(makeClaimOp(), deps);

    expect(result.action).toBe('AMBIGUOUS');
    expect(result.details).toContain('Agent');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns ALREADY_RECONCILED when UPDATE matches no rows (race condition)', async () => {
    deps.pool.query
      // SELECT ticket (READY)
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'READY',
          stage: 'BACKEND',
          claimed_by: null,
          claimed_by_name: null,
          machine_id: null,
          lease_expiry: null,
        }],
      })
      // SELECT agent
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] })
      // UPDATE ticket (no rows returned — someone claimed it in between)
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileClaimOp(makeClaimOp(), deps);

    expect(result.action).toBe('ALREADY_RECONCILED');
    expect(result.details).toContain('no longer in READY status');
  });
});

// ── reconcileWorkOp ──────────────────────────────────────────────────────────

describe('reconcileWorkOp', () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('advances ticket when at correct stage and CLAIMED', async () => {
    deps.pool.query
      // SELECT ticket
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'CLAIMED',
          stage: 'BACKEND',
          claimed_by: 'agent-uuid-1',
          claimed_by_name: 'Backend',
          machine_id: 'ws-1',
          lease_expiry: '2026-03-07T12:00:00Z',
        }],
      })
      // SELECT agent
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] })
      // advance_ticket stored function
      .mockResolvedValueOnce({ rows: [{}] })
      // INSERT reconciliation event
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileWorkOp(makeWorkOp(), deps);

    expect(result.action).toBe('TICKET_ADVANCED');
    expect(result.ticketId).toBe('TASK-FOS-01-001');
    expect(result.details).toContain('BACKEND');
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it('returns ALREADY_RECONCILED when ticket is DONE', async () => {
    deps.pool.query.mockResolvedValueOnce({
      rows: [{
        ticket_id: 'TASK-FOS-01-001',
        status: 'DONE',
        stage: 'DONE',
        claimed_by: null,
        claimed_by_name: null,
        machine_id: null,
        lease_expiry: null,
      }],
    });

    const result = await reconcileWorkOp(makeWorkOp(), deps);

    expect(result.action).toBe('ALREADY_RECONCILED');
    expect(result.details).toContain('completed');
  });

  it('returns ALREADY_RECONCILED when stage has already been passed', async () => {
    deps.pool.query.mockResolvedValueOnce({
      rows: [{
        ticket_id: 'TASK-FOS-01-001',
        status: 'CLAIMED',
        stage: 'QA',
        claimed_by: 'agent-uuid-2',
        claimed_by_name: 'QA',
        machine_id: 'ws-1',
        lease_expiry: '2026-03-07T12:00:00Z',
      }],
    });

    const result = await reconcileWorkOp(
      makeWorkOp({ stage: 'BACKEND' }),
      deps,
    );

    expect(result.action).toBe('ALREADY_RECONCILED');
    expect(result.details).toContain('stage QA');
    expect(result.details).toContain('stage BACKEND');
  });

  it('returns AMBIGUOUS when ticket not found', async () => {
    deps.pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await reconcileWorkOp(makeWorkOp(), deps);

    expect(result.action).toBe('AMBIGUOUS');
    expect(result.details).toContain('not found');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('returns AMBIGUOUS when ticket is READY (WORK without prior CLAIM)', async () => {
    deps.pool.query
      // SELECT ticket — status is READY, not CLAIMED
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'READY',
          stage: 'BACKEND',
          claimed_by: null,
          claimed_by_name: null,
          machine_id: null,
          lease_expiry: null,
        }],
      })
      // INSERT reconciliation event
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileWorkOp(makeWorkOp(), deps);

    expect(result.action).toBe('AMBIGUOUS');
    expect(result.details).toContain('READY');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('falls back to manual advance when advance_ticket throws', async () => {
    deps.pool.query
      // SELECT ticket
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'IN_PROGRESS',
          stage: 'BACKEND',
          claimed_by: 'agent-uuid-1',
          claimed_by_name: 'Backend',
          machine_id: 'ws-1',
          lease_expiry: '2026-03-07T12:00:00Z',
        }],
      })
      // SELECT agent
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] })
      // advance_ticket FAILS
      .mockRejectedValueOnce(new Error('Agent does not own claim'))
      // manualAdvanceTicket UPDATE
      .mockResolvedValueOnce({ rows: [] })
      // INSERT reconciliation event
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileWorkOp(makeWorkOp(), deps);

    expect(result.action).toBe('TICKET_ADVANCED');
    expect(deps.logger.warn).toHaveBeenCalled();
  });

  it('uses manual advance when agent not found', async () => {
    deps.pool.query
      // SELECT ticket
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'TASK-FOS-01-001',
          status: 'CLAIMED',
          stage: 'BACKEND',
          claimed_by: 'agent-uuid-1',
          claimed_by_name: 'Backend',
          machine_id: 'ws-1',
          lease_expiry: '2026-03-07T12:00:00Z',
        }],
      })
      // SELECT agent (not found)
      .mockResolvedValueOnce({ rows: [] })
      // manualAdvanceTicket UPDATE
      .mockResolvedValueOnce({ rows: [] })
      // INSERT reconciliation event
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileWorkOp(makeWorkOp(), deps);

    expect(result.action).toBe('TICKET_ADVANCED');
  });
});

// ── reconcileOperations ──────────────────────────────────────────────────────

describe('reconcileOperations', () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('processes mixed CLAIM and WORK operations', async () => {
    const operations: TicketCommitOp[] = [
      makeClaimOp({ ticketId: 'T-001', commitSha: 'sha-1' }),
      makeWorkOp({ ticketId: 'T-002', commitSha: 'sha-2' }),
    ];

    // CLAIM op: ticket READY, agent found, UPDATE succeeds
    deps.pool.query
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'T-001', status: 'READY', stage: 'BACKEND',
          claimed_by: null, claimed_by_name: null, machine_id: null, lease_expiry: null,
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-1' }] })
      .mockResolvedValueOnce({ rows: [{ ticket_id: 'T-001' }] })
      .mockResolvedValueOnce({ rows: [] })
      // WORK op: ticket CLAIMED at correct stage
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'T-002', status: 'CLAIMED', stage: 'BACKEND',
          claimed_by: 'agent-uuid-2', claimed_by_name: 'Backend', machine_id: 'ws-1', lease_expiry: '2026-03-07T12:00:00Z',
        }],
      })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-2' }] })
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileOperations(operations, deps);

    expect(result.claimsCreated).toBe(1);
    expect(result.ticketsAdvanced).toBe(1);
    expect(result.alreadyReconciled).toBe(0);
    expect(result.ambiguousStates).toBe(0);
    expect(result.events).toHaveLength(2);
  });

  it('handles empty operations array', async () => {
    const result = await reconcileOperations([], deps);

    expect(result.claimsCreated).toBe(0);
    expect(result.ticketsAdvanced).toBe(0);
    expect(result.events).toHaveLength(0);
    expect(deps.pool.query).not.toHaveBeenCalled();
  });

  it('aggregates ambiguous states correctly', async () => {
    const operations: TicketCommitOp[] = [
      makeClaimOp({ ticketId: 'T-MISSING-1', commitSha: 'sha-1' }),
      makeClaimOp({ ticketId: 'T-MISSING-2', commitSha: 'sha-2' }),
    ];

    deps.pool.query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    const result = await reconcileOperations(operations, deps);

    expect(result.ambiguousStates).toBe(2);
    expect(result.events).toHaveLength(2);
  });
});

// ── runPeriodicReconciliation ────────────────────────────────────────────────

describe('runPeriodicReconciliation', () => {
  let deps: MockDeps;

  beforeEach(() => {
    deps = createMockDeps();
  });

  it('releases expired claims', async () => {
    deps.pool.query.mockResolvedValueOnce({
      rows: [{ released_count: 3 }],
    });

    const result = await runPeriodicReconciliation(deps);

    expect(result.claimsReleased).toBe(3);
    expect(result.claimsCreated).toBe(0);
    expect(result.ticketsAdvanced).toBe(0);
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it('handles zero expired claims', async () => {
    deps.pool.query.mockResolvedValueOnce({
      rows: [{ released_count: 0 }],
    });

    const result = await runPeriodicReconciliation(deps);

    expect(result.claimsReleased).toBe(0);
  });

  it('handles empty result from release function', async () => {
    deps.pool.query.mockResolvedValueOnce({ rows: [] });

    const result = await runPeriodicReconciliation(deps);

    expect(result.claimsReleased).toBe(0);
  });
});
