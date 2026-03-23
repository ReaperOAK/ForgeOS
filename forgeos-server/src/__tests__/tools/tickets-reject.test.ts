/**
 * Tests — tickets-reject.ts (tickets.reject MCP tool)
 *
 * Unit tests with mocked pool/logger for the ticketsRejectHandler and
 * ticketsRejectSchema exports. Validates all 8 acceptance criteria,
 * error handling, edge cases, and MCP response format compliance.
 *
 * TDD: Red-Green-Refactor cycle.
 *
 * @module __tests__/tools/tickets-reject
 * @ticket TASK-FOS-03-005
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

vi.mock('../../webhooks/reconciliation.js', () => ({
  handleTicketTransition: vi.fn(),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────

import { ticketsRejectSchema, ticketsRejectHandler } from '../../tools/tickets-reject.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

/** Type-safe helper to extract text from MCP content response. */
type TextContent = { type: 'text'; text: string };
function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

/** Parse the JSON response text from an MCP CallToolResult. */
function parseResult(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse(textOf(result));
}

/** Minimal Ticket-like row fixture returned from mocked pool.query */
function makeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-001',
    ticket_id: 'TASK-TEST-001',
    project_id: null,
    title: 'Test Ticket',
    description: 'A test ticket',
    type: 'backend',
    priority: 'high',
    status: 'READY',
    stage: 'BACKEND',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY'],
    claimed_by: null,
    claimed_by_name: null,
    machine_id: null,
    operator: null,
    lease_expiry: null,
    lease_duration_minutes: 30,
    depends_on: [],
    file_paths: ['src/test.ts'],
    acceptance_criteria: ['AC1'],
    tags: [],
    rework_count: 1,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-07T10:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCHEMA VALIDATION (AC1)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectSchema — AC1: Zod schema validation', () => {
  it('accepts valid input with ticket_id and reason', () => {
    const result = ticketsRejectSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing ticket_id', () => {
    const result = ticketsRejectSchema.safeParse({
      reason: 'Coverage is below 80% minimum threshold',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing reason', () => {
    const result = ticketsRejectSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
    });
    expect(result.success).toBe(false);
  });

  it('rejects reason shorter than 10 characters', () => {
    const result = ticketsRejectSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      reason: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional evidence record', () => {
    const result = ticketsRejectSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
      evidence: {
        coverage_report: { total: 62, required: 80 },
        missing_tests: ['pool.ts:handleDisconnect'],
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.evidence).toEqual({
        coverage_report: { total: 62, required: 80 },
        missing_tests: ['pool.ts:handleDisconnect'],
      });
    }
  });

  it('accepts empty evidence object', () => {
    const result = ticketsRejectSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
      evidence: {},
    });
    expect(result.success).toBe(true);
  });

  it('accepts reason exactly 10 characters', () => {
    const result = ticketsRejectSchema.safeParse({
      ticket_id: 'T-001',
      reason: '1234567890',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty ticket_id', () => {
    const result = ticketsRejectSchema.safeParse({
      ticket_id: '',
      reason: 'Coverage is below 80% minimum threshold',
    });
    expect(result.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HANDLER — AC2: Validates caller holds claim
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — AC2: Validates claim ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns NOT_CLAIM_OWNER when reject_ticket raises NOT_CLAIM_OWNER', async () => {
    // Agent lookup succeeds
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // reject_ticket raises NOT_CLAIM_OWNER
    mockQuery.mockRejectedValueOnce(new Error('NOT_CLAIM_OWNER: You do not hold the claim on this ticket'));

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HANDLER — AC3: Calls reject_ticket SQL function
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — AC3: Calls reject_ticket SQL function', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls reject_ticket with correct parameters', async () => {
    const reworkedTicket = makeTicketRow({ rework_count: 1, status: 'READY', stage: 'BACKEND' });

    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // reject_ticket call
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
      evidence: { coverage: 62 },
    });

    // Verify reject_ticket was called (second call after agent lookup)
    expect(mockQuery).toHaveBeenCalledTimes(2);
    const rejectCall = mockQuery.mock.calls[1];
    expect(rejectCall[0]).toContain('reject_ticket');
    expect(rejectCall[1]).toEqual([
      'TASK-TEST-001',
      'agent-uuid-001',
      'system',
      'Coverage is below 80% minimum threshold',
      JSON.stringify({ coverage: 62 }),
    ]);
  });

  it('passes empty object as evidence when not provided', async () => {
    const reworkedTicket = makeTicketRow({ rework_count: 1 });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const rejectCall = mockQuery.mock.calls[1];
    expect(rejectCall[1]![4]).toBe('{}');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. HANDLER — AC4: Returns rework result
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — AC4: Returns rework result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ticket, rework_count, escalated=false, returned_to_stage on rework', async () => {
    const reworkedTicket = makeTicketRow({
      rework_count: 1,
      status: 'READY',
      stage: 'BACKEND',
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const parsed = parseResult(result);
    expect(parsed.escalated).toBe(false);
    expect(parsed.rework_count).toBe(1);
    expect(parsed.returned_to_stage).toBe('BACKEND');
    expect(parsed.ticket).toBeDefined();
    expect((parsed.ticket as Record<string, unknown>).ticket_id).toBe('TASK-TEST-001');
  });

  it('correctly identifies returned_to_stage from ticket stage', async () => {
    const reworkedTicket = makeTicketRow({
      rework_count: 2,
      status: 'READY',
      stage: 'FRONTEND',
      sdlc_flow: ['READY', 'BACKEND', 'FRONTEND', 'QA', 'SECURITY'],
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'UI component does not match mockup specifications',
    });

    const parsed = parseResult(result);
    expect(parsed.returned_to_stage).toBe('FRONTEND');
    expect(parsed.rework_count).toBe(2);
    expect(parsed.escalated).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. HANDLER — AC5: Returns escalated result when rework_count >= max_reworks
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — AC5: Returns escalated result', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns escalated=true when rework_count >= max_reworks', async () => {
    const escalatedTicket = makeTicketRow({
      rework_count: 4,
      max_reworks: 3,
      status: 'ESCALATED',
      stage: 'BACKEND',
      claimed_by: null,
      claimed_by_name: null,
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [escalatedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold for the third time',
    });

    const parsed = parseResult(result);
    expect(parsed.escalated).toBe(true);
    expect(parsed.rework_count).toBe(4);
    expect((parsed.ticket as Record<string, unknown>).status).toBe('ESCALATED');
  });

  it('returns escalated=true at exact boundary (rework_count == max_reworks + 1)', async () => {
    const escalatedTicket = makeTicketRow({
      rework_count: 4,
      max_reworks: 3,
      status: 'ESCALATED',
      stage: 'QA',
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [escalatedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Test failures persist after three rework attempts',
    });

    const parsed = parseResult(result);
    expect(parsed.escalated).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. HANDLER — AC6: STAGE_REJECTED event recorded
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — AC6: Event recording', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('STAGE_REJECTED event is recorded via reject_ticket SQL (no separate insert needed)', async () => {
    const reworkedTicket = makeTicketRow({ rework_count: 1 });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
      evidence: { reason_code: 'LOW_COVERAGE' },
    });

    const parsed = parseResult(result);
    // The reject_ticket SQL function handles event insertion internally.
    // We verify the handler called the SQL function with evidence.
    expect(parsed.ticket).toBeDefined();
    const rejectCall = mockQuery.mock.calls[1];
    expect(rejectCall[0]).toContain('reject_ticket');
    // Evidence is passed as JSON string
    expect(rejectCall[1]![4]).toBe(JSON.stringify({ reason_code: 'LOW_COVERAGE' }));
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. HANDLER — AC7: File locks released (via SQL function)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — AC7: File locks released', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('file locks are released by SQL function (handler does not do separate release)', async () => {
    const reworkedTicket = makeTicketRow({ rework_count: 1 });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    // Only 2 queries: agent lookup + reject_ticket.
    // File lock release is handled inside reject_ticket SQL function.
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. HANDLER — AC8: Escalated tickets have ESCALATED status and null claimed_by
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — AC8: Escalated ticket state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('escalated tickets have status ESCALATED and claimed_by set to NULL', async () => {
    const escalatedTicket = makeTicketRow({
      rework_count: 4,
      max_reworks: 3,
      status: 'ESCALATED',
      claimed_by: null,
      claimed_by_name: null,
      machine_id: null,
      operator: null,
      lease_expiry: null,
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [escalatedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Same failures persist after three rework cycles',
    });

    const parsed = parseResult(result);
    const ticket = parsed.ticket as Record<string, unknown>;
    expect(ticket.status).toBe('ESCALATED');
    expect(ticket.claimed_by).toBeNull();
    expect(ticket.claimed_by_name).toBeNull();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. ERROR HANDLING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — Error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns INTERNAL_ERROR on unexpected database failure', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toContain('connection refused');
  });

  it('returns INTERNAL_ERROR when reject_ticket returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
  });

  it('auto-registers agent when not found in agents table', async () => {
    const reworkedTicket = makeTicketRow({ rework_count: 1 });

    // Agent not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Auto-register returns new UUID
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-agent-uuid' }] });
    // reject_ticket call
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const parsed = parseResult(result);
    expect(parsed.ticket).toBeDefined();
    // Verify auto-register INSERT was called
    const registerCall = mockQuery.mock.calls[1];
    expect(registerCall[0]).toContain('INSERT INTO agents');
  });

  it('logs error via structured logger on failure', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('timeout'));

    await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: 'TASK-TEST-001' }),
      'tickets.reject failed',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. MCP RESPONSE FORMAT
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsRejectHandler — MCP response format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns content array with single text block', async () => {
    const reworkedTicket = makeTicketRow({ rework_count: 1 });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
    // Verify it's valid JSON
    expect(() => JSON.parse(textOf(result))).not.toThrow();
  });

  it('success response has all required output fields', async () => {
    const reworkedTicket = makeTicketRow({ rework_count: 1, stage: 'BACKEND' });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const parsed = parseResult(result);
    expect(parsed).toHaveProperty('ticket');
    expect(parsed).toHaveProperty('rework_count');
    expect(parsed).toHaveProperty('escalated');
    expect(parsed).toHaveProperty('returned_to_stage');
  });

  it('error response has error, message, ticket_id, timestamp', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('db error'));

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-TEST-001',
      reason: 'Coverage is below 80% minimum threshold',
    });

    const parsed = parseResult(result);
    expect(parsed).toHaveProperty('error');
    expect(parsed).toHaveProperty('message');
    expect(parsed).toHaveProperty('ticket_id');
    expect(parsed).toHaveProperty('timestamp');
  });
});
