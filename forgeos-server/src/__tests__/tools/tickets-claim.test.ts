/**
 * Tests — tickets-claim.ts (tickets.claim MCP tool)
 *
 * Unit tests with mocked pool/logger for the ticketsClaimHandler and
 * ticketsClaimSchema exports. Validates all 8 acceptance criteria,
 * error handling, edge cases, and MCP response format compliance.
 *
 * @module __tests__/tools/tickets-claim
 * @ticket TASK-FOS-03-002
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories run before module scope) ────────────────

const { mockQuery, mockQueueCompileTicketPrompt, mockLogger } = vi.hoisted(() => {
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
    mockQueueCompileTicketPrompt: vi.fn(),
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

vi.mock('../../services/compiler.js', () => ({
  queueCompileTicketPrompt: (...args: unknown[]) => mockQueueCompileTicketPrompt(...args),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────

import { ticketsClaimSchema, ticketsClaimHandler } from '../../tools/tickets-claim.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

/** Type-safe helper to extract text from MCP content response. */
type TextContent = { type: 'text'; text: string };
function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
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
    metadata: {},
    compiled_prompt: 'compiled prompt',
    compiled_prompt_compiled_at: '2026-03-07T09:50:00.000Z',
    compiled_prompt_context_hash: 'unused-hash',
    compiled_prompt_packet_version: 'v1',
    compiled_prompt_template_version: 'prompt-architect-v1',
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

describe('ticketsClaimSchema — AC1: Zod schema validation', () => {
  it('accepts valid input with all required fields', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing ticket_id', () => {
    const result = ticketsClaimSchema.safeParse({
      agent_name: 'Backend',
      machine_id: 'dev',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing agent_name', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      machine_id: 'dev',
    });
    expect(result.success).toBe(false);
  });

  it('rejects missing machine_id', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional operator field', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      machine_id: 'dev',
      operator: 'Owais',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.operator).toBe('Owais');
    }
  });

  it('accepts optional lease_minutes with default 30', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      machine_id: 'dev',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.lease_minutes).toBe(30);
    }
  });

  it('accepts lease_minutes between 5 and 120', () => {
    for (const lease_minutes of [5, 30, 60, 120]) {
      const result = ticketsClaimSchema.safeParse({
        ticket_id: 'TASK-TEST-001',
        agent_name: 'Backend',
        machine_id: 'dev',
        lease_minutes,
      });
      expect(result.success, `lease_minutes=${lease_minutes} should be valid`).toBe(true);
    }
  });

  it('rejects lease_minutes below 5', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      machine_id: 'dev',
      lease_minutes: 3,
    });
    expect(result.success).toBe(false);
  });

  it('rejects lease_minutes above 120', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      machine_id: 'dev',
      lease_minutes: 121,
    });
    expect(result.success).toBe(false);
  });

  it('rejects non-integer lease_minutes', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      machine_id: 'dev',
      lease_minutes: 30.5,
    });
    expect(result.success).toBe(false);
  });

  it('strips unknown properties', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      machine_id: 'dev',
      unknown_field: 'foo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['unknown_field']).toBeUndefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HANDLER — AGENT LOOKUP (AC2)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — AC2: Agent resolution and SQL function call', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('looks up agent by name before calling claim function', async () => {
    const ticket = makeTicketRow();
    // 1. Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // 2. claim_ticket_by_id
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    // 3. file_locks query
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    expect(mockQuery).toHaveBeenCalledTimes(3);
    const [sql, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('SELECT id FROM agents');
    expect(params).toEqual(['Backend Engineer']);
  });

  it('auto-registers agent if not found', async () => {
    const ticket = makeTicketRow();
    // 1. Agent lookup - not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // 2. Auto-register
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-agent-uuid' }] });
    // 3. claim_ticket_by_id
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    // 4. file_locks
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'NewAgent',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const [insertSql] = mockQuery.mock.calls[1] as [string, string[]];
    expect(insertSql).toContain('INSERT INTO agents');
    expect(insertSql).toContain('ON CONFLICT');
  });

  it('calls claim_ticket_by_id with correct parameters', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      operator: 'Owais',
      lease_minutes: 45,
    });

    const [sql, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('claim_ticket_by_id');
    expect(params).toEqual([
      'TASK-TEST-001',
      'agent-uuid-001',
      'Backend Engineer',
      'dev-machine',
      'Owais',
      45,
    ]);
  });

  it('passes null for operator when not provided', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const [, params] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(params[4]).toBeNull(); // operator should be null
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HANDLER — SUCCESS RESPONSE (AC5)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — AC5: Success response with ticket, lease_expiry, and file_locks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.FORGEOS_REPO_COMMIT = 'repo-main';
    process.env.FORGEOS_GRAPH_VERSION = 'graph-v1';
    process.env.FORGEOS_MEMORY_SNAPSHOT_VERSION = 'memory-v1';
  });

  it('returns {ticket, lease_expiry, file_locks} on success', async () => {
    const ticket = makeTicketRow({
      lease_expiry: '2026-03-07T10:30:00.000Z',
      compiled_prompt_context_hash: '117f49edbc9a1e0efa6bc420b092a8e3897a5e29763f2250055c85f8a70804f9',
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({
      rows: [
        { file_path: 'src/test.ts' },
        { file_path: 'src/other.ts' },
      ],
    });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    expect(result.content).toHaveLength(1);
    expect((result.content[0] as TextContent).type).toBe('text');

    const parsed = JSON.parse(textOf(result));
    expect(parsed.ticket).toBeDefined();
    expect(parsed.ticket.ticket_id).toBe('TASK-TEST-001');
    expect(parsed.lease_expiry).toBe('2026-03-07T10:30:00.000Z');
    expect(parsed.file_locks).toEqual(['src/test.ts', 'src/other.ts']);
    expect(parsed.prompt_packet).toEqual({
      version: 'v1',
      compiled_at: '2026-03-07T09:50:00.000Z',
      context_hash: '117f49edbc9a1e0efa6bc420b092a8e3897a5e29763f2250055c85f8a70804f9',
      freshness_status: 'fresh',
      stale_reason: null,
    });
    expect(mockQueueCompileTicketPrompt).not.toHaveBeenCalled();
  });

  it('returns empty file_locks array when no files locked', async () => {
    const ticket = makeTicketRow({ lease_expiry: '2026-03-07T10:30:00.000Z' });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.file_locks).toEqual([]);
  });

  it('marks stale prompts and triggers background recompile', async () => {
    const ticket = makeTicketRow({
      compiled_prompt_context_hash: 'stale-hash',
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.prompt_packet.freshness_status).toBe('stale');
    expect(parsed.prompt_packet.stale_reason).toBe('hash_mismatch');
    expect(mockQueueCompileTicketPrompt).toHaveBeenCalledWith(
      'TASK-TEST-001',
      'claim-stale-compiled-prompt',
    );
  });

  it('marks missing prompts and triggers background recompile', async () => {
    const ticket = makeTicketRow({
      compiled_prompt: null,
      compiled_prompt_context_hash: null,
    });
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.prompt_packet.freshness_status).toBe('missing');
    expect(parsed.prompt_packet.stale_reason).toBe('not_compiled');
    expect(mockQueueCompileTicketPrompt).toHaveBeenCalledWith(
      'TASK-TEST-001',
      'claim-missing-compiled-prompt',
    );
  });

  it('returns correct MCP response format (content array with text type)', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
    expect(() => JSON.parse(textOf(result))).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. HANDLER — ALREADY_CLAIMED ERROR (AC3)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — AC3: ALREADY_CLAIMED error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns ALREADY_CLAIMED when claim_ticket_by_id returns empty result set', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // No rows = not claimable

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('ALREADY_CLAIMED');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
    expect(parsed.timestamp).toBeDefined();
  });

  it('includes descriptive message in ALREADY_CLAIMED error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.message).toBeDefined();
    expect(typeof parsed.message).toBe('string');
    expect(parsed.message.length).toBeGreaterThan(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. HANDLER — FILE_CONFLICT ERROR (AC4)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — AC4: FILE_CONFLICT error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns FILE_CONFLICT when SQL function raises FILE_CONFLICT exception', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(
      new Error('FILE_CONFLICT: One or more files in file_paths are locked by another ticket'),
    );

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('FILE_CONFLICT');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
    expect(parsed.timestamp).toBeDefined();
  });

  it('includes descriptive message for FILE_CONFLICT', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(
      new Error('FILE_CONFLICT: One or more files in file_paths are locked by another ticket'),
    );

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.message).toContain('file');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. HANDLER — INTERNAL ERROR (AC7)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — AC7: Internal error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns INTERNAL_ERROR for non-FILE_CONFLICT database errors', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.ticket_id).toBe('TASK-TEST-001');
  });

  it('handles non-Error thrown values gracefully', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce('string error');

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
  });

  it('logs error with context on failure', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('db down'));

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0] as unknown[];
    const context = errorCall[0] as Record<string, unknown>;
    expect(context).toHaveProperty('ticket_id', 'TASK-TEST-001');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. HANDLER — LOGGING (AC7)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — Structured logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs info at start of claim with context', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    expect(mockLogger.info).toHaveBeenCalled();
    const infoCall = mockLogger.info.mock.calls[0] as unknown[];
    const context = infoCall[0] as Record<string, unknown>;
    expect(context).toHaveProperty('ticket_id', 'TASK-TEST-001');
    expect(context).toHaveProperty('agent_name', 'Backend Engineer');
    expect(context).toHaveProperty('machine_id', 'dev-machine');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. HANDLER — CONCURRENT SAFETY (AC6)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — AC6: Concurrent claim safety via SKIP LOCKED', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates concurrency control to claim_ticket_by_id SQL function (SKIP LOCKED)', async () => {
    // The SQL function handles concurrency with FOR UPDATE SKIP LOCKED.
    // If two agents call simultaneously, only one gets the row.
    // The other gets an empty result set => ALREADY_CLAIMED error.
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // Simulates SKIP LOCKED - row already locked

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Agent-B',
      machine_id: 'machine-2',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('ALREADY_CLAIMED');
  });

  it('SQL call uses claim_ticket_by_id which internally uses SELECT FOR UPDATE SKIP LOCKED', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const [sql] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('claim_ticket_by_id');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. HANDLER — FILE LOCKS QUERY (AC5)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — AC5: File locks retrieval after claim', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('queries file_locks table for active locks on the ticket', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({
      rows: [{ file_path: 'src/a.ts' }, { file_path: 'src/b.ts' }],
    });

    await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const [sql, params] = mockQuery.mock.calls[2] as [string, string[]];
    expect(sql).toContain('file_locks');
    expect(sql).toContain('released_at IS NULL');
    expect(params).toEqual(['TASK-TEST-001']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. HANDLER — EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimHandler — Edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles agent lookup failure gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('agents table does not exist'));

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
  });

  it('handles file_locks query failure after successful claim', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockRejectedValueOnce(new Error('file_locks query error'));

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend Engineer',
      machine_id: 'dev-machine',
      lease_minutes: 30,
    });

    const parsed = JSON.parse(textOf(result));
    expect(parsed.error).toBe('INTERNAL_ERROR');
  });

  it('returns valid JSON in all error responses', async () => {
    // FILE_CONFLICT
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockRejectedValueOnce(new Error('FILE_CONFLICT: locked'));
    const r1 = await ticketsClaimHandler({
      ticket_id: 'T1', agent_name: 'A', machine_id: 'M', lease_minutes: 30,
    });
    expect(() => JSON.parse(textOf(r1))).not.toThrow();

    // ALREADY_CLAIMED
    vi.clearAllMocks();
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    const r2 = await ticketsClaimHandler({
      ticket_id: 'T2', agent_name: 'A', machine_id: 'M', lease_minutes: 30,
    });
    expect(() => JSON.parse(textOf(r2))).not.toThrow();

    // INTERNAL_ERROR
    vi.clearAllMocks();
    mockQuery.mockRejectedValueOnce(new Error('boom'));
    const r3 = await ticketsClaimHandler({
      ticket_id: 'T3', agent_name: 'A', machine_id: 'M', lease_minutes: 30,
    });
    expect(() => JSON.parse(textOf(r3))).not.toThrow();
  });
});
