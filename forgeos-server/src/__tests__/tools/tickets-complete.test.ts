/**
 * Tests — tickets-complete.ts (tickets.complete MCP tool)
 *
 * Unit tests with mocked pool/logger for the ticketsCompleteHandler and
 * ticketsCompleteSchema exports. Validates all 10 acceptance criteria,
 * error handling, edge cases, and MCP response format compliance.
 *
 * @module __tests__/tools/tickets-complete
 * @ticket TASK-FOS-03-004
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

import { ticketsCompleteSchema, ticketsCompleteHandler } from '../../tools/tickets-complete.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

/** Type-safe helper to extract text from MCP content response. */
type TextContent = { type: 'text'; text: string };
function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

/** Parse the JSON text from an MCP response. */
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
    status: 'CLAIMED',
    stage: 'BACKEND',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
    claimed_by: 'agent-uuid-001',
    claimed_by_name: 'Backend Engineer',
    machine_id: 'test-machine',
    operator: 'TestOp',
    lease_expiry: '2026-03-07T10:30:00.000Z',
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
    updated_at: '2026-03-07T10:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

/** Valid evidence fixture */
const validEvidence = {
  artifacts: ['src/feature.ts', 'src/__tests__/feature.test.ts'],
  test_results: '12 tests passed, 0 failed. Coverage: 94%',
  confidence: 'HIGH' as const,
  notes: 'Implementation complete',
};

/** Minimal valid input */
const validInput = {
  ticket_id: 'TASK-TEST-001',
  evidence: validEvidence,
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCHEMA VALIDATION (AC1, AC2)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsCompleteSchema — AC1: Zod schema validation', () => {
  it('accepts valid input with all required fields', () => {
    const result = ticketsCompleteSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts valid input without optional notes', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: 'TASK-001',
      evidence: {
        artifacts: ['src/file.ts'],
        test_results: 'All pass',
        confidence: 'MEDIUM',
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing ticket_id', () => {
    const result = ticketsCompleteSchema.safeParse({
      evidence: validEvidence,
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty ticket_id', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: '',
      evidence: validEvidence,
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing evidence object', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: 'TASK-001',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty artifacts array', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: 'TASK-001',
      evidence: {
        artifacts: [],
        test_results: 'All pass',
        confidence: 'HIGH',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing test_results', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: 'TASK-001',
      evidence: {
        artifacts: ['src/file.ts'],
        confidence: 'HIGH',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty test_results', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: 'TASK-001',
      evidence: {
        artifacts: ['src/file.ts'],
        test_results: '',
        confidence: 'HIGH',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing confidence', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: 'TASK-001',
      evidence: {
        artifacts: ['src/file.ts'],
        test_results: 'All pass',
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid confidence value', () => {
    const result = ticketsCompleteSchema.safeParse({
      ticket_id: 'TASK-001',
      evidence: {
        artifacts: ['src/file.ts'],
        test_results: 'All pass',
        confidence: 'SUPER_HIGH',
      },
    });
    expect(result.success).toBe(false);
  });

  it('accepts all three valid confidence values', () => {
    for (const confidence of ['HIGH', 'MEDIUM', 'LOW']) {
      const result = ticketsCompleteSchema.safeParse({
        ticket_id: 'TASK-001',
        evidence: {
          artifacts: ['src/file.ts'],
          test_results: 'All pass',
          confidence,
        },
      });
      expect(result.success).toBe(true);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HANDLER — SUCCESSFUL ADVANCEMENT (AC3, AC5, AC9, AC10)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsCompleteHandler — AC5: success path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advances ticket and returns {ticket, previous_stage, new_stage, dependencies_unblocked}', async () => {
    const currentTicket = makeTicketRow({ stage: 'BACKEND', claimed_by: 'agent-uuid-001' });
    const advancedTicket = makeTicketRow({
      stage: 'QA',
      status: 'READY',
      claimed_by: null,
      claimed_by_name: null,
      machine_id: null,
      operator: null,
      lease_expiry: null,
    });

    // Call 1: SELECT ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    // Call 2: advance_ticket SQL function
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.previous_stage).toBe('BACKEND');
    expect(parsed.new_stage).toBe('QA');
    expect(parsed.dependencies_unblocked).toEqual([]);
    expect(parsed.ticket).toBeDefined();
  });

  it('passes evidence as JSONB to advance_ticket SQL function', async () => {
    const currentTicket = makeTicketRow();
    const advancedTicket = makeTicketRow({ stage: 'QA', status: 'READY' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    await ticketsCompleteHandler(validInput);

    // Second call is the advance_ticket call
    const advanceCall = mockQuery.mock.calls[1]!;
    expect(advanceCall[0]).toContain('advance_ticket');
    // Params: [ticket_id, agent_id, agent_name, evidence_json]
    const evidenceJson = JSON.parse(advanceCall[1]![3] as string);
    expect(evidenceJson.artifacts).toEqual(validEvidence.artifacts);
    expect(evidenceJson.test_results).toBe(validEvidence.test_results);
    expect(evidenceJson.confidence).toBe('HIGH');
    expect(evidenceJson.notes).toBe('Implementation complete');
    expect(evidenceJson.stage).toBe('BACKEND');
  });

  it('queries unblocked dependencies when ticket reaches DONE', async () => {
    const currentTicket = makeTicketRow({ stage: 'VALIDATOR' });
    const doneTicket = makeTicketRow({
      stage: 'DONE',
      status: 'DONE',
      completed_at: '2026-03-07T10:30:00.000Z',
    });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [doneTicket] });
    // dependency query
    mockQuery.mockResolvedValueOnce({
      rows: [{ ticket_id: 'TASK-DEP-001' }, { ticket_id: 'TASK-DEP-002' }],
    });

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.new_stage).toBe('DONE');
    expect(parsed.dependencies_unblocked).toEqual(['TASK-DEP-001', 'TASK-DEP-002']);
  });

  it('does not query dependencies when not reaching DONE', async () => {
    const currentTicket = makeTicketRow({ stage: 'BACKEND' });
    const advancedTicket = makeTicketRow({ stage: 'QA', status: 'READY' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    await ticketsCompleteHandler(validInput);

    // Should only have 2 query calls (lookup + advance), not 3
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  it('logs info on successful completion', async () => {
    const currentTicket = makeTicketRow();
    const advancedTicket = makeTicketRow({ stage: 'QA', status: 'READY' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    await ticketsCompleteHandler(validInput);

    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: 'TASK-TEST-001' }),
      'tickets.complete called',
    );
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: 'TASK-TEST-001',
        previous_stage: 'BACKEND',
        new_stage: 'QA',
      }),
      'tickets.complete succeeded',
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HANDLER — ERROR PATHS (AC2, AC4)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsCompleteHandler — error paths', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns TICKET_NOT_FOUND when ticket does not exist', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('TICKET_NOT_FOUND');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });

  it('returns NOT_CLAIM_OWNER when ticket is unclaimed', async () => {
    const unclaimedTicket = makeTicketRow({ claimed_by: null });
    mockQuery.mockResolvedValueOnce({ rows: [unclaimedTicket] });

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
  });

  it('returns NOT_CLAIM_OWNER on SQL NOT_CLAIM_OWNER exception', async () => {
    const currentTicket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockRejectedValueOnce(new Error('NOT_CLAIM_OWNER: You do not hold the claim'));

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
  });

  it('returns INVALID_TRANSITION on SQL INVALID_TRANSITION exception', async () => {
    const currentTicket = makeTicketRow({ stage: 'DONE' });
    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockRejectedValueOnce(new Error('INVALID_TRANSITION: Cannot advance beyond final stage'));

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('INVALID_TRANSITION');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });

  it('returns INVALID_TRANSITION when advance_ticket returns no rows', async () => {
    const currentTicket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('INVALID_TRANSITION');
  });

  it('returns INTERNAL_ERROR on unexpected database error', async () => {
    const currentTicket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toContain('connection refused');
  });

  it('returns INTERNAL_ERROR on ticket lookup failure', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'));

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toContain('timeout');
  });

  it('handles non-Error exception gracefully', async () => {
    const currentTicket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockRejectedValueOnce('string error');

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.error).toBe('INTERNAL_ERROR');
  });

  it('handles dependency query failure gracefully (non-fatal)', async () => {
    const currentTicket = makeTicketRow({ stage: 'VALIDATOR' });
    const doneTicket = makeTicketRow({ stage: 'DONE', status: 'DONE' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [doneTicket] });
    mockQuery.mockRejectedValueOnce(new Error('dep query failed'));

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    // Should still succeed, dependency query failure is non-fatal
    expect(parsed.new_stage).toBe('DONE');
    expect(parsed.dependencies_unblocked).toEqual([]);
    expect(mockLogger.warn).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. MCP RESPONSE FORMAT
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsCompleteHandler — MCP response format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns content array with single text entry', async () => {
    const currentTicket = makeTicketRow();
    const advancedTicket = makeTicketRow({ stage: 'QA', status: 'READY' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    const result = await ticketsCompleteHandler(validInput);

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
  });

  it('text content is valid JSON', async () => {
    const currentTicket = makeTicketRow();
    const advancedTicket = makeTicketRow({ stage: 'QA', status: 'READY' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    const result = await ticketsCompleteHandler(validInput);
    const text = textOf(result);

    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('error responses include timestamp', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsCompleteHandler(validInput);
    const parsed = parseResult(result);

    expect(parsed.timestamp).toBeDefined();
    expect(typeof parsed.timestamp).toBe('string');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. EVIDENCE HANDLING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsCompleteHandler — evidence serialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes stage name in evidence payload', async () => {
    const currentTicket = makeTicketRow({ stage: 'QA' });
    const advancedTicket = makeTicketRow({ stage: 'SECURITY', status: 'READY' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    await ticketsCompleteHandler({
      ticket_id: 'TASK-TEST-001',
      evidence: {
        artifacts: ['src/qa-report.md'],
        test_results: 'Coverage verified at 95%',
        confidence: 'HIGH',
      },
    });

    const advanceCall = mockQuery.mock.calls[1]!;
    const evidenceJson = JSON.parse(advanceCall[1]![3] as string);
    expect(evidenceJson.stage).toBe('QA');
  });

  it('omits notes from evidence when not provided', async () => {
    const currentTicket = makeTicketRow();
    const advancedTicket = makeTicketRow({ stage: 'QA', status: 'READY' });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    await ticketsCompleteHandler({
      ticket_id: 'TASK-TEST-001',
      evidence: {
        artifacts: ['src/file.ts'],
        test_results: 'All pass',
        confidence: 'MEDIUM',
      },
    });

    const advanceCall = mockQuery.mock.calls[1]!;
    const evidenceJson = JSON.parse(advanceCall[1]![3] as string);
    expect(evidenceJson).not.toHaveProperty('notes');
  });
});
