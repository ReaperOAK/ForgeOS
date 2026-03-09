/**
 * Tests — tickets-extend.ts (tickets.extend MCP tool)
 *
 * Unit tests with mocked pool/logger for the ticketsExtendHandler and
 * ticketsExtendSchema exports. Validates all 6 acceptance criteria,
 * error handling, edge cases, and MCP response format compliance.
 *
 * TDD: RED phase — tests written before implementation.
 *
 * @module __tests__/tools/tickets-extend
 * @ticket TASK-FOS-03-009
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories run before module scope) ────────────────

const { mockQuery, mockLogger } = vi.hoisted(() => {
  const mLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  };
  return {
    mockQuery: vi.fn(),
    mockLogger: mLogger,
  };
});

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: mockQuery,
  },
}));

vi.mock('../../config.js', () => ({
  config: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
  },
}));

vi.mock('../../middleware/logging.js', () => ({
  logger: mockLogger,
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────

import {
  ticketsExtendSchema,
  ticketsExtendHandler,
} from '../../tools/tickets-extend.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

/** Type-safe helper to extract text from MCP content response. */
type TextContent = { type: 'text'; text: string };
function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

/** Minimal Ticket-like row fixture returned from mocked pool.query. */
function makeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-001',
    ticket_id: 'TASK-TEST-001',
    project_id: null,
    title: 'Test Ticket',
    description: 'A test ticket',
    type: 'backend',
    priority: 'high',
    status: 'CLAIMED',
    stage: 'BACKEND',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY'],
    claimed_by: 'agent-uuid-001',
    claimed_by_name: 'Backend',
    machine_id: 'test-machine',
    operator: 'TestOp',
    lease_expiry: '2026-03-07T11:00:00.000Z',
    lease_duration_minutes: 30,
    depends_on: [],
    file_paths: ['src/test.ts'],
    acceptance_criteria: ['AC1'],
    tags: [],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-07T10:30:00Z',
    completed_at: null,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCHEMA VALIDATION (AC1)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsExtendSchema — AC1: Zod schema validation', () => {
  it('accepts valid input with ticket_id only (duration_minutes defaults to 30)', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration_minutes).toBe(30);
    }
  });

  it('accepts valid input with explicit duration_minutes', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 60,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.duration_minutes).toBe(60);
    }
  });

  it('rejects missing ticket_id', () => {
    const result = ticketsExtendSchema.safeParse({
      agent_name: 'Backend',
      duration_minutes: 30,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing agent_name', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      duration_minutes: 30,
    });
    expect(result.success).toBe(false);
  });

  it('accepts duration_minutes at lower bound (5)', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 5,
    });
    expect(result.success).toBe(true);
  });

  it('accepts duration_minutes at upper bound (120)', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 120,
    });
    expect(result.success).toBe(true);
  });

  it('rejects duration_minutes below 5', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 4,
    });
    expect(result.success).toBe(false);
  });

  it('rejects duration_minutes above 120', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 121,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer duration_minutes', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30.5,
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown properties', () => {
    const result = ticketsExtendSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      unknown_field: 'foo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['unknown_field']).toBeUndefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HANDLER — NOT_CLAIM_OWNER (AC2)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsExtendHandler — AC2: NOT_CLAIM_OWNER error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns NOT_CLAIM_OWNER when agent is not found', async () => {
    // Agent lookup returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'UnknownAgent',
      duration_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });

  it('returns NOT_CLAIM_OWNER when SQL function raises NOT_CLAIM_OWNER', async () => {
    // Agent lookup succeeds
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // extend_lease raises
    mockQuery.mockRejectedValueOnce(
      new Error('NOT_CLAIM_OWNER: You do not hold the claim on this ticket'),
    );

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });

  it('returns NOT_CLAIM_OWNER when extend_lease returns empty rows', async () => {
    // Agent lookup succeeds
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // extend_lease returns empty (no matching ticket for this agent)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-MISSING-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HANDLER — LEASE_TOO_LONG (AC3)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsExtendHandler — AC3: LEASE_TOO_LONG error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns LEASE_TOO_LONG when SQL function raises LEASE_TOO_LONG', async () => {
    // Agent lookup succeeds
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // extend_lease raises
    mockQuery.mockRejectedValueOnce(
      new Error('LEASE_TOO_LONG: Maximum extension is 120 minutes'),
    );

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 120,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('LEASE_TOO_LONG');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. HANDLER — SUCCESS (AC4, AC5, AC6)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsExtendHandler — AC4/5/6: Success response', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls extend_lease with correct parameters', async () => {
    const ticket = makeTicketRow({ lease_expiry: '2026-03-07T11:30:00.000Z' });
    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // extend_lease
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });

    await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 45,
    });

    expect(mockQuery).toHaveBeenCalledTimes(2);
    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('extend_lease');
    expect(params).toEqual([
      'TASK-TEST-001',
      'agent-uuid-001',
      'Backend',
      45,
    ]);
  });

  it('returns {ticket, new_lease_expiry} on success (AC6)', async () => {
    const newExpiry = '2026-03-07T11:30:00.000Z';
    const ticket = makeTicketRow({ lease_expiry: newExpiry });
    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // extend_lease
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    expect(result.content).toHaveLength(1);
    expect((result.content[0] as TextContent).type).toBe('text');

    const parsed = JSON.parse(textOf(result));
    expect(parsed.ticket).toBeDefined();
    expect(parsed.ticket.ticket_id).toBe('TASK-TEST-001');
    expect(parsed.new_lease_expiry).toBe(newExpiry);
  });

  it('uses default 30 minutes when duration_minutes not provided', async () => {
    const ticket = makeTicketRow({ lease_expiry: '2026-03-07T11:00:00.000Z' });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });

    await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30, // default from schema
    });

    const [, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(params[3]).toBe(30);
  });

  it('logs info on call entry', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });

    await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'TASK-TEST-001',
        agent_name: 'Backend',
        duration_minutes: 30,
      }),
      'tickets.extend called',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. HANDLER — INTERNAL_ERROR
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsExtendHandler — INTERNAL_ERROR handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns INTERNAL_ERROR for unexpected database errors', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toContain('connection refused');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
    expect(parsed.timestamp).toBeDefined();
  });

  it('logs error on failure', async () => {
    const err = new Error('unexpected DB failure');
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(err);

    await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err, ticket_id: 'TASK-TEST-001' }),
      'tickets.extend failed',
    );
  });

  it('handles non-Error thrown values', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce('string error');

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toBe('Unknown error');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. HANDLER — MCP Response Format
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsExtendHandler — MCP response format compliance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('always returns { content: [{ type: "text", text: ... }] }', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      duration_minutes: 30,
    });

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(1);
    const first = result.content[0] as TextContent;
    expect(first.type).toBe('text');
    expect(typeof first.text).toBe('string');
    // Must be valid JSON
    expect(() => JSON.parse(first.text)).not.toThrow();
  });

  it('error responses include timestamp in ISO 8601 format', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsExtendHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'UnknownAgent',
      duration_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.timestamp).toBeDefined();
    // Validate ISO 8601 parseable
    const d = new Date(parsed.timestamp);
    expect(d.toISOString()).toBe(parsed.timestamp);
  });

  it('all error responses include ticket_id', async () => {
    // NOT_CLAIM_OWNER path (agent not found)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r1 = await ticketsExtendHandler({
      ticket_id: 'TASK-ERR-001',
      agent_name: 'NoAgent',
      duration_minutes: 30,
    });
    expect(JSON.parse(textOf(r1)).ticket_id).toBe('TASK-ERR-001');

    vi.clearAllMocks();

    // INTERNAL_ERROR path
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const r2 = await ticketsExtendHandler({
      ticket_id: 'TASK-ERR-002',
      agent_name: 'Backend',
      duration_minutes: 30,
    });
    expect(JSON.parse(textOf(r2)).ticket_id).toBe('TASK-ERR-002');
  });
});
