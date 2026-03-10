/**
 * Tests — tickets-update.ts (tickets.update MCP tool)
 *
 * Unit tests with mocked pool/logger for the ticketsUpdateHandler and
 * ticketsUpdateSchema exports. Validates all 7 acceptance criteria,
 * error handling, edge cases, and MCP response format compliance.
 *
 * @module __tests__/tools/tickets-update
 * @ticket TASK-FOS-03-003
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories run before module scope) ────────────────

const { mockClientQuery, mockRelease, mockConnect, mockLogger } = vi.hoisted(() => {
  const mClientQuery = vi.fn();
  const mRelease = vi.fn();
  const mConnect = vi.fn().mockResolvedValue({
    query: mClientQuery,
    release: mRelease,
  });
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
    mockClientQuery: mClientQuery,
    mockRelease: mRelease,
    mockConnect: mConnect,
    mockLogger: mLogger,
  };
});

vi.mock('../../db/pool.js', () => ({
  pool: {
    connect: mockConnect,
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

import { ticketsUpdateSchema, ticketsUpdateHandler } from '../../tools/tickets-update.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

type TextContent = { type: 'text'; text: string };
function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

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
    metadata: { existing: 'value' },
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-07T10:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

// ── Reset between tests ──────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockRelease,
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCHEMA VALIDATION (AC1)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateSchema', () => {
  it('should accept valid input with ticket_id and metadata', () => {
    const result = ticketsUpdateSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject missing ticket_id', () => {
    const result = ticketsUpdateSchema.safeParse({
      metadata: { key: 'value' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty ticket_id', () => {
    const result = ticketsUpdateSchema.safeParse({
      ticket_id: '',
      metadata: { key: 'value' },
    });
    expect(result.success).toBe(false);
  });

  it('should reject missing metadata', () => {
    const result = ticketsUpdateSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
    });
    expect(result.success).toBe(false);
  });

  it('should accept metadata with nested values', () => {
    const result = ticketsUpdateSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      metadata: { nested: { a: 1 }, arr: [1, 2, 3] },
    });
    expect(result.success).toBe(true);
  });

  it('should accept empty metadata object', () => {
    const result = ticketsUpdateSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      metadata: {},
    });
    expect(result.success).toBe(true);
  });

  it('should have correct shape keys', () => {
    const keys = Object.keys(ticketsUpdateSchema.shape);
    expect(keys).toContain('ticket_id');
    expect(keys).toContain('metadata');
    expect(keys).toHaveLength(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. TICKET_NOT_FOUND (AC — ticket does not exist)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateHandler — TICKET_NOT_FOUND', () => {
  it('should return TICKET_NOT_FOUND when ticket does not exist', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const result = await ticketsUpdateHandler({
      ticket_id: 'NONEXISTENT',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('TICKET_NOT_FOUND');
    expect(parsed.ticket_id).toBe('NONEXISTENT');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should ROLLBACK on ticket not found', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    await ticketsUpdateHandler({
      ticket_id: 'NONEXISTENT',
      metadata: { key: 'value' },
    });

    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should release client on ticket not found', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    await ticketsUpdateHandler({
      ticket_id: 'NONEXISTENT',
      metadata: { key: 'value' },
    });

    expect(mockRelease).toHaveBeenCalledOnce();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. NOT_CLAIM_OWNER (AC2, AC3)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateHandler — NOT_CLAIM_OWNER', () => {
  it('should return NOT_CLAIM_OWNER when ticket is unclaimed (claimed_by null)', async () => {
    const ticket = makeTicketRow({ claimed_by: null, claimed_by_name: null });
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });

  it('should return NOT_CLAIM_OWNER when claimed_by_name is null', async () => {
    const ticket = makeTicketRow({ claimed_by: 'some-uuid', claimed_by_name: null });
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
  });

  it('should ROLLBACK and release client on NOT_CLAIM_OWNER', async () => {
    const ticket = makeTicketRow({ claimed_by: null, claimed_by_name: null });
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce(undefined); // ROLLBACK

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
    expect(mockRelease).toHaveBeenCalledOnce();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. SUCCESSFUL UPDATE (AC4, AC6)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateHandler — successful update', () => {
  it('should merge metadata and return updated ticket', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow({ metadata: { existing: 'value', new_key: 'new_value' } });

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE ... RETURNING *
      .mockResolvedValueOnce(undefined) // INSERT INTO events
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { new_key: 'new_value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.ticket).toBeDefined();
    expect(parsed.message).toBe('OK');
    expect(parsed.ticket.metadata.new_key).toBe('new_value');
  });

  it('should use jsonb || operator for merge', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow({ metadata: { existing: 'value', priority_override: 'low' } });

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE ... RETURNING *
      .mockResolvedValueOnce(undefined) // INSERT INTO events
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { priority_override: 'low' },
    });

    // Verify the UPDATE query uses || operator
    const updateCall = mockClientQuery.mock.calls[2];
    expect(updateCall[0]).toContain('||');
    expect(updateCall[0]).toContain('metadata');
  });

  it('should COMMIT on successful update', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    expect(mockClientQuery).toHaveBeenCalledWith('COMMIT');
  });

  it('should release client after success', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('should use SELECT FOR UPDATE for row locking', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    const selectCall = mockClientQuery.mock.calls[1];
    expect(selectCall[0]).toContain('FOR UPDATE');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. EVENT RECORDING (AC5)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateHandler — event recording', () => {
  it('should record UPDATED event with metadata payload', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow({ metadata: { existing: 'value', foo: 'bar' } });

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { foo: 'bar' },
    });

    const eventCall = mockClientQuery.mock.calls[3];
    expect(eventCall[0]).toContain('INSERT INTO events');
    expect(eventCall[0]).toContain('UPDATED');
    expect(eventCall[1]).toContain('TASK-TEST-001');
  });

  it('should include agent_id and agent_name from the claimed ticket', async () => {
    const ticket = makeTicketRow({ claimed_by: 'agent-42', claimed_by_name: 'Backend' });
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    const eventCall = mockClientQuery.mock.calls[3];
    // eventCall[1] = [ticket_id, claimed_by, claimed_by_name, machine_id, operator, metadata]
    expect(eventCall[1][1]).toBe('agent-42');
    expect(eventCall[1][2]).toBe('Backend');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. RESPONSE FORMAT (AC6)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateHandler — response format', () => {
  it('should return JSON text content', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
  });

  it('should return parseable JSON in text content', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed).toHaveProperty('ticket');
    expect(parsed).toHaveProperty('message', 'OK');
  });

  it('should return error responses as JSON text content', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT ... (not found)
      .mockResolvedValueOnce(undefined); // ROLLBACK

    const result = await ticketsUpdateHandler({
      ticket_id: 'NONEXISTENT',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed).toHaveProperty('error');
    expect(parsed).toHaveProperty('message');
    expect(parsed).toHaveProperty('ticket_id');
    expect(parsed).toHaveProperty('timestamp');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. ERROR HANDLING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateHandler — error handling', () => {
  it('should return INTERNAL_ERROR on database failure', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('Connection lost')) // SELECT fails
      .mockResolvedValueOnce(undefined); // ROLLBACK in catch

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toBe('Connection lost');
  });

  it('should ROLLBACK on error', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('DB error')) // SELECT fails
      .mockResolvedValueOnce(undefined); // ROLLBACK in catch

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    // ROLLBACK is called via .catch() pattern
    expect(mockClientQuery).toHaveBeenCalledWith('ROLLBACK');
  });

  it('should release client on error', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('DB error')) // SELECT fails
      .mockResolvedValueOnce(undefined); // ROLLBACK in catch

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('should handle non-Error thrown values', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce('string error') // non-Error throw
      .mockResolvedValueOnce(undefined); // ROLLBACK in catch

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toBe('Unknown error');
  });

  it('should handle ROLLBACK failure gracefully', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('Query failed')) // SELECT fails
      .mockRejectedValueOnce(new Error('ROLLBACK also failed')); // ROLLBACK fails

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    // Should still return error response even when rollback fails
    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(mockRelease).toHaveBeenCalledOnce();
  });

  it('should include ticket_id and timestamp in error response', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('fail')) // SELECT fails
      .mockResolvedValueOnce(undefined); // ROLLBACK in catch

    const result = await ticketsUpdateHandler({
      ticket_id: 'TASK-ERR-001',
      metadata: { key: 'value' },
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.ticket_id).toBe('TASK-ERR-001');
    expect(parsed.timestamp).toBeDefined();
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. LOGGING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsUpdateHandler — logging', () => {
  it('should log info on call entry', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      { ticket_id: 'TASK-TEST-001' },
      'tickets.update called',
    );
  });

  it('should log info on successful completion', async () => {
    const ticket = makeTicketRow();
    const updatedTicket = makeTicketRow();

    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockResolvedValueOnce({ rows: [ticket] }) // SELECT ... FOR UPDATE
      .mockResolvedValueOnce({ rows: [updatedTicket] }) // UPDATE
      .mockResolvedValueOnce(undefined) // INSERT event
      .mockResolvedValueOnce(undefined); // COMMIT

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { foo: 'bar' },
    });

    expect(mockLogger.info).toHaveBeenCalledWith(
      { ticket_id: 'TASK-TEST-001', metadata_keys: ['foo'] },
      'tickets.update completed successfully',
    );
  });

  it('should log error on failure', async () => {
    mockClientQuery
      .mockResolvedValueOnce(undefined) // BEGIN
      .mockRejectedValueOnce(new Error('oops')) // SELECT fails
      .mockResolvedValueOnce(undefined); // ROLLBACK in catch

    await ticketsUpdateHandler({
      ticket_id: 'TASK-TEST-001',
      metadata: { key: 'value' },
    });

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ ticket_id: 'TASK-TEST-001' }),
      'tickets.update failed',
    );
  });
});
