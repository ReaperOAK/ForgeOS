/**
 * QA Tests — tickets-next.ts (tickets.next MCP tool)
 *
 * Unit tests with mocked pool/logger for the ticketsNextHandler and
 * ticketsNextSchema exports. Validates all 7 acceptance criteria,
 * error handling, edge cases, and MCP response format compliance.
 *
 * @module __tests__/tools/tickets-next-qa
 * @ticket TASK-FOS-03-001 (QA stage)
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

import { ticketsNextSchema, ticketsNextHandler } from '../../tools/tickets-next.js';

// ── Test Fixtures ────────────────────────────────────────────────────────────

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
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCHEMA VALIDATION (AC1)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextSchema — AC1: Zod schema validation', () => {
  it('accepts valid input with required stage', () => {
    const result = ticketsNextSchema.safeParse({ stage: 'BACKEND' });
    expect(result.success).toBe(true);
  });

  it('rejects missing stage (required)', () => {
    const result = ticketsNextSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it('rejects invalid stage value', () => {
    const result = ticketsNextSchema.safeParse({ stage: 'INVALID_STAGE' });
    expect(result.success).toBe(false);
  });

  it('accepts optional type filter', () => {
    const result = ticketsNextSchema.safeParse({ stage: 'BACKEND', type: 'backend' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe('backend');
    }
  });

  it('accepts optional priority filter', () => {
    const result = ticketsNextSchema.safeParse({ stage: 'QA', priority: 'high' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('high');
    }
  });

  it('accepts all three parameters together', () => {
    const result = ticketsNextSchema.safeParse({
      stage: 'SECURITY',
      type: 'frontend',
      priority: 'critical',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid type value', () => {
    const result = ticketsNextSchema.safeParse({ stage: 'BACKEND', type: 'INVALID' });
    expect(result.success).toBe(false);
  });

  it('rejects invalid priority value', () => {
    const result = ticketsNextSchema.safeParse({ stage: 'BACKEND', priority: 'ULTRA' });
    expect(result.success).toBe(false);
  });

  it('allows stage to be any valid SDLC stage', () => {
    const validStages = [
      'READY', 'RESEARCH', 'ARCHITECT', 'PRODUCT_MANAGER', 'UI_DESIGN',
      'BACKEND', 'FRONTEND', 'QA', 'SECURITY', 'CI',
      'DOCUMENTATION', 'VALIDATOR', 'DONE',
    ];
    for (const stage of validStages) {
      const result = ticketsNextSchema.safeParse({ stage });
      expect(result.success, `stage ${stage} should be valid`).toBe(true);
    }
  });

  it('allows type to be any valid ticket type', () => {
    const validTypes = [
      'backend', 'frontend', 'fullstack', 'infra', 'security',
      'docs', 'research', 'architecture', 'product', 'design',
    ];
    for (const type of validTypes) {
      const result = ticketsNextSchema.safeParse({ stage: 'BACKEND', type });
      expect(result.success, `type ${type} should be valid`).toBe(true);
    }
  });

  it('allows priority to be any valid priority level', () => {
    const validPriorities = ['critical', 'high', 'medium', 'low'];
    for (const priority of validPriorities) {
      const result = ticketsNextSchema.safeParse({ stage: 'BACKEND', priority });
      expect(result.success, `priority ${priority} should be valid`).toBe(true);
    }
  });

  it('strips unknown properties', () => {
    const result = ticketsNextSchema.safeParse({
      stage: 'BACKEND',
      unknown_field: 'foo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['unknown_field']).toBeUndefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HANDLER — BASIC QUERY (AC2, AC3)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextHandler — AC2/AC3: SQL query construction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('builds correct WHERE clause with stage, status=READY, and claim check (AC2)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    expect(mockQuery).toHaveBeenCalledTimes(1);
    const [sql, params] = mockQuery.mock.calls[0] as [string, string[]];

    // AC2: WHERE stage=$1 AND status='READY' AND (claimed_by IS NULL OR lease_expiry < NOW())
    expect(sql).toContain('stage = $1');
    expect(sql).toContain("status = 'READY'");
    expect(sql).toContain('claimed_by IS NULL OR lease_expiry < NOW()');
    expect(params).toEqual(['BACKEND']);
  });

  it('includes ORDER BY priority DESC, created_at ASC (AC3)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'QA' });

    const [sql] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('ORDER BY priority DESC, created_at ASC');
  });

  it('includes LIMIT 1 (AC3)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    const [sql] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('LIMIT 1');
  });

  it('uses SELECT * FROM tickets', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    const [sql] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('SELECT * FROM tickets');
  });

  it('passes stage as parameterized value $1 (not interpolated)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'SECURITY' });

    const [, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(params[0]).toBe('SECURITY');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HANDLER — RESULT RESPONSES (AC4)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextHandler — AC4: Response format', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full ticket object when found', async () => {
    const ticketRow = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [ticketRow] });

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.ticket).toEqual(ticketRow);
    expect(parsed.message).toBe('OK');
  });

  it('returns {ticket: null, message: "No tickets available"} when none found (AC4)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.ticket).toBeNull();
    expect(parsed.message).toBe('No tickets available');
  });

  it('returns MCP-compliant content array with type "text"', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTicketRow()] });

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
  });

  it('result text is valid JSON', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTicketRow()] });

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. HANDLER — OPTIONAL TYPE FILTER (AC5)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextHandler — AC5: Optional type filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds AND type=$2 when type is provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND', type: 'frontend' });

    const [sql, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('type = $2');
    expect(params).toContain('frontend');
  });

  it('does NOT include type filter when type is omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    const [sql] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).not.toContain('type =');
  });

  it('type is passed as parameterized value (not interpolated)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'QA', type: 'fullstack' });

    const [, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(params).toEqual(['QA', 'fullstack']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. HANDLER — OPTIONAL PRIORITY FILTER (AC6)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextHandler — AC6: Optional priority filter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('adds AND priority >= $2 when priority is provided (no type)', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND', priority: 'high' });

    const [sql, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('priority >= $2');
    expect(params).toEqual(['BACKEND', 'high']);
  });

  it('adds AND priority >= $3 when both type and priority provided', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND', type: 'backend', priority: 'medium' });

    const [sql, params] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).toContain('type = $2');
    expect(sql).toContain('priority >= $3');
    expect(params).toEqual(['BACKEND', 'backend', 'medium']);
  });

  it('does NOT include priority filter when priority is omitted', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    const [sql] = mockQuery.mock.calls[0] as [string, string[]];
    expect(sql).not.toContain('priority >=');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. HANDLER — ERROR HANDLING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextHandler — Error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('catches database errors and returns structured error response', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.ticket).toBeNull();
    expect(parsed.message).toContain('Connection refused');
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.timestamp).toBeDefined();
  });

  it('error timestamp is valid ISO8601', async () => {
    mockQuery.mockRejectedValueOnce(new Error('timeout'));

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(() => new Date(parsed.timestamp)).not.toThrow();
    expect(new Date(parsed.timestamp).toISOString()).toBe(parsed.timestamp);
  });

  it('handles non-Error thrown values', async () => {
    mockQuery.mockRejectedValueOnce('string error');

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.ticket).toBeNull();
    expect(parsed.message).toContain('string error');
  });

  it('does not throw — returns error in MCP content format', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB crash'));

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    // Should not throw, should return valid MCP response
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');
  });

  it('logs error with structured logger', async () => {
    mockQuery.mockRejectedValueOnce(new Error('Pool exhausted'));

    await ticketsNextHandler({ stage: 'BACKEND' });

    expect(mockLogger.error).toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. HANDLER — LOGGING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextHandler — Structured logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs debug on successful query execution', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTicketRow()] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    expect(mockLogger.debug).toHaveBeenCalled();
  });

  it('debug log includes event, stage, durationMs, and found fields', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [makeTicketRow()] });

    await ticketsNextHandler({ stage: 'BACKEND', type: 'backend' });

    const debugCall = mockLogger.debug.mock.calls[0];
    const logObj = debugCall[0] as Record<string, unknown>;
    expect(logObj).toHaveProperty('event', 'tickets_next_query');
    expect(logObj).toHaveProperty('stage', 'BACKEND');
    expect(logObj).toHaveProperty('durationMs');
    expect(typeof logObj['durationMs']).toBe('number');
    expect(logObj).toHaveProperty('found', true);
    expect(logObj).toHaveProperty('type', 'backend');
  });

  it('logs found=false when no rows returned', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    const debugCall = mockLogger.debug.mock.calls[0];
    const logObj = debugCall[0] as Record<string, unknown>;
    expect(logObj).toHaveProperty('found', false);
  });

  it('logs null for omitted optional params', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    await ticketsNextHandler({ stage: 'BACKEND' });

    const debugCall = mockLogger.debug.mock.calls[0];
    const logObj = debugCall[0] as Record<string, unknown>;
    expect(logObj).toHaveProperty('type', null);
    expect(logObj).toHaveProperty('priority', null);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. HANDLER — EDGE CASES & BOUNDARY CONDITIONS
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsNextHandler — Edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('handles stage=DONE without error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsNextHandler({ stage: 'DONE' });

    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.ticket).toBeNull();
  });

  it('handles stage=READY without error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsNextHandler({ stage: 'READY' });

    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.ticket).toBeNull();
  });

  it('returns only the first row when multiple would match', async () => {
    const rows = [
      makeTicketRow({ ticket_id: 'FIRST' }),
      makeTicketRow({ ticket_id: 'SECOND' }),
    ];
    mockQuery.mockResolvedValueOnce({ rows });

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    // Handler returns rows[0]; SQL already limits to 1
    expect(parsed.ticket.ticket_id).toBe('FIRST');
  });

  it('returns ticket with all fields preserved', async () => {
    const ticket = makeTicketRow({
      ticket_id: 'TASK-FOS-99-001',
      type: 'fullstack',
      priority: 'critical',
      depends_on: ['TASK-FOS-01-001'],
      file_paths: ['src/a.ts', 'src/b.ts'],
      acceptance_criteria: ['AC1', 'AC2', 'AC3'],
      tags: ['urgent'],
      metadata: { custom: 'value' },
    });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });

    const result = await ticketsNextHandler({ stage: 'BACKEND' });

    const parsed = JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
    expect(parsed.ticket.ticket_id).toBe('TASK-FOS-99-001');
    expect(parsed.ticket.depends_on).toEqual(['TASK-FOS-01-001']);
    expect(parsed.ticket.file_paths).toEqual(['src/a.ts', 'src/b.ts']);
    expect(parsed.ticket.metadata).toEqual({ custom: 'value' });
  });

  it('handles all four priority values correctly', async () => {
    for (const priority of ['critical', 'high', 'medium', 'low'] as const) {
      vi.clearAllMocks();
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await ticketsNextHandler({ stage: 'BACKEND', priority });

      const [sql, params] = mockQuery.mock.calls[0] as [string, string[]];
      expect(sql).toContain('priority >=');
      expect(params).toContain(priority);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. EXPORT VERIFICATION
// ═════════════════════════════════════════════════════════════════════════════

describe('tickets-next.ts — Module exports', () => {
  it('exports ticketsNextSchema as a Zod object', () => {
    expect(ticketsNextSchema).toBeDefined();
    expect(ticketsNextSchema.safeParse).toBeDefined();
    expect(typeof ticketsNextSchema.safeParse).toBe('function');
  });

  it('exports ticketsNextHandler as an async function', () => {
    expect(ticketsNextHandler).toBeDefined();
    expect(typeof ticketsNextHandler).toBe('function');
  });

  it('schema has .shape property (required for MCP SDK integration)', () => {
    expect(ticketsNextSchema.shape).toBeDefined();
    expect(ticketsNextSchema.shape).toHaveProperty('stage');
    expect(ticketsNextSchema.shape).toHaveProperty('type');
    expect(ticketsNextSchema.shape).toHaveProperty('priority');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. INDEX.TS BARREL — REGISTRATION
// ═════════════════════════════════════════════════════════════════════════════

describe('tools/index.ts — Source analysis for tickets.next registration (AC1)', () => {
  let indexSrc: string;

  beforeEach(async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { fileURLToPath } = await import('node:url');
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    indexSrc = fs.readFileSync(
      path.resolve(__dirname, '../../tools/index.ts'),
      'utf-8',
    );
  });

  it('registers tool as "tickets.next"', () => {
    expect(indexSrc).toContain("'tickets.next'");
  });

  it('imports ticketsNextSchema from tickets-next', () => {
    expect(indexSrc).toMatch(/import.*ticketsNextSchema.*from.*tickets-next/);
  });

  it('imports ticketsNextHandler from tickets-next', () => {
    expect(indexSrc).toMatch(/import.*ticketsNextHandler.*from.*tickets-next/);
  });

  it('passes ticketsNextSchema.shape to server.tool()', () => {
    expect(indexSrc).toContain('ticketsNextSchema.shape');
  });

  it('uses McpServer typed parameter', () => {
    expect(indexSrc).toMatch(/McpServer/);
  });

  it('exports registerTools function', () => {
    expect(indexSrc).toMatch(/export\s+function\s+registerTools/);
  });
});
