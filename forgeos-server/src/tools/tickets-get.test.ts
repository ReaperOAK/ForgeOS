/**
 * Unit tests for the `tickets.get` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates ticket_id (required, non-empty string)
 * - Returns full ticket JSON for existing ticket
 * - Returns NOT_FOUND error for non-existent ticket IDs
 * - Includes ticket history (events) array
 * - Includes current claim information (claimed_by, lease_expiry)
 * - Response shape matches expected MCP format
 * - Handles DB errors gracefully
 *
 * @ticket TASK-INT-BE011
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketsGetSchema, ticketsGetHandler } from './tickets-get.js';

// ── Mock pool ──────────────────────────────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../db/pool.js', () => ({
  pool: { query: (...args: unknown[]) => mockQuery(...args) },
}));

vi.mock('../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Extract text from the first MCP content block (narrows discriminated union). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseContent(result: { content: Array<{ type: string;[k: string]: unknown }> }): Record<string, any> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

// ── Helper factories ─────────────────────────────────────────────────────────

function makeTicketRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pk-uuid-001',
    ticket_id: 'TASK-TEST-001',
    project_id: null,
    title: 'Test Ticket',
    description: 'A test ticket for unit testing',
    type: 'backend',
    priority: 'high',
    status: 'CLAIMED',
    stage: 'BACKEND',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
    claimed_by: 'agent-uuid-001',
    claimed_by_name: 'Backend',
    machine_id: 'build-01',
    operator: 'Ticketer',
    lease_expiry: '2026-03-12T16:00:00Z',
    lease_duration_minutes: 30,
    depends_on: ['TASK-TEST-000'],
    file_paths: ['src/tools/tickets-get.ts'],
    acceptance_criteria: ['AC1', 'AC2'],
    tags: ['backend', 'critical'],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: 'TODO/tasks/test.md',
    created_at: '2026-03-12T12:00:00Z',
    updated_at: '2026-03-12T12:30:00Z',
    completed_at: null,
    ...overrides,
  };
}

function makeEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-uuid-001',
    ticket_id: 'TASK-TEST-001',
    event_type: 'CREATED',
    agent_id: null,
    agent_name: 'TODO',
    machine_id: 'system',
    operator: null,
    previous_stage: null,
    new_stage: 'READY',
    previous_status: null,
    new_status: 'READY',
    created_at: '2026-03-12T12:00:00Z',
    ...overrides,
  };
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('ticketsGetSchema', () => {
  it('should require ticket_id', () => {
    expect(() => ticketsGetSchema.parse({})).toThrow();
  });

  it('should accept valid ticket_id', () => {
    const result = ticketsGetSchema.parse({ ticket_id: 'TASK-001' });
    expect(result.ticket_id).toBe('TASK-001');
  });

  it('should reject empty ticket_id', () => {
    expect(() => ticketsGetSchema.parse({ ticket_id: '' })).toThrow();
  });

  it('should reject non-string ticket_id', () => {
    expect(() => ticketsGetSchema.parse({ ticket_id: 123 })).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('ticketsGetHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return full ticket JSON with history for existing ticket', async () => {
    const ticket = makeTicketRow();
    const events = [
      makeEventRow({ event_type: 'CLAIMED', created_at: '2026-03-12T12:30:00Z' }),
      makeEventRow({ event_type: 'CREATED', created_at: '2026-03-12T12:00:00Z' }),
    ];

    // First call: ticket query
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    // Second call: events query
    mockQuery.mockResolvedValueOnce({ rows: events });

    const result = await ticketsGetHandler({ ticket_id: 'TASK-TEST-001' });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.message).toBe('OK');
    expect(parsed.ticket.ticket_id).toBe('TASK-TEST-001');
    expect(parsed.ticket.history).toHaveLength(2);
    expect(parsed.ticket.history[0].event_type).toBe('CLAIMED');
    expect(parsed.ticket.history[1].event_type).toBe('CREATED');
  });

  it('should include claim information in response', async () => {
    const ticket = makeTicketRow({
      claimed_by: 'agent-uuid-001',
      claimed_by_name: 'Backend',
      machine_id: 'build-01',
      lease_expiry: '2026-03-12T16:00:00Z',
    });

    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsGetHandler({ ticket_id: 'TASK-TEST-001' });
    const parsed = parseContent(result);

    expect(parsed.ticket.claimed_by).toBe('agent-uuid-001');
    expect(parsed.ticket.claimed_by_name).toBe('Backend');
    expect(parsed.ticket.machine_id).toBe('build-01');
    expect(parsed.ticket.lease_expiry).toBe('2026-03-12T16:00:00Z');
  });

  it('should return NOT_FOUND error for non-existent ticket', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsGetHandler({ ticket_id: 'DOESNT-EXIST' });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);

    expect(parsed.error).toBe('NOT_FOUND');
    expect(parsed.ticket).toBeNull();
    expect(parsed.message).toContain('DOESNT-EXIST');
    expect(parsed.message).toContain('not found');
  });

  it('should return empty history array when no events exist', async () => {
    const ticket = makeTicketRow();

    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsGetHandler({ ticket_id: 'TASK-TEST-001' });
    const parsed = parseContent(result);

    expect(parsed.ticket.history).toEqual([]);
  });

  it('should include all ticket fields in response', async () => {
    const ticket = makeTicketRow();

    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsGetHandler({ ticket_id: 'TASK-TEST-001' });
    const parsed = parseContent(result);

    // Verify core fields
    expect(parsed.ticket.id).toBe('pk-uuid-001');
    expect(parsed.ticket.ticket_id).toBe('TASK-TEST-001');
    expect(parsed.ticket.title).toBe('Test Ticket');
    expect(parsed.ticket.type).toBe('backend');
    expect(parsed.ticket.priority).toBe('high');
    expect(parsed.ticket.status).toBe('CLAIMED');
    expect(parsed.ticket.stage).toBe('BACKEND');
    expect(parsed.ticket.sdlc_flow).toEqual(
      ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
    );
    expect(parsed.ticket.depends_on).toEqual(['TASK-TEST-000']);
    expect(parsed.ticket.file_paths).toEqual(['src/tools/tickets-get.ts']);
    expect(parsed.ticket.acceptance_criteria).toEqual(['AC1', 'AC2']);
    expect(parsed.ticket.tags).toEqual(['backend', 'critical']);
    expect(parsed.ticket.rework_count).toBe(0);
    expect(parsed.ticket.metadata).toEqual({});
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await ticketsGetHandler({ ticket_id: 'TASK-TEST-001' });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);

    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.ticket).toBeNull();
    expect(parsed.message).toContain('Connection refused');
  });

  it('should query with correct SQL and parameters', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTicketRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsGetHandler({ ticket_id: 'TASK-FOS-001' });

    // Ticket query
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM tickets WHERE ticket_id = $1',
      ['TASK-FOS-001'],
    );

    // Events query
    expect(mockQuery).toHaveBeenCalledWith(
      'SELECT * FROM events WHERE ticket_id = $1 ORDER BY created_at DESC',
      ['TASK-FOS-001'],
    );
  });

  it('should return MCP-compatible response format', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTicketRow()] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsGetHandler({ ticket_id: 'TASK-TEST-001' });

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
    expect(() => parseContent(result)).not.toThrow();
  });
});
