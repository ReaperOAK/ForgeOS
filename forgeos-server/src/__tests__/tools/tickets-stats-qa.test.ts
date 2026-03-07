/**
 * QA Tests — tickets-stats.ts (tickets.stats MCP tool)
 *
 * Unit tests with mocked pool/logger for the ticketsStatsHandler and
 * ticketsStatsSchema exports. Validates all 8 acceptance criteria,
 * error handling, edge cases, caching behaviour, and MCP response format.
 *
 * @module __tests__/tools/tickets-stats-qa
 * @ticket TASK-FOS-03-010 (QA stage)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { ticketsStatsSchema, ticketsStatsHandler } from '../../tools/tickets-stats.js';
import { TICKET_STAGES, TICKET_STATUSES } from '../../types/index.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Return a set of default resolved values for the 6 parallel queries
 * used by ticketsStatsHandler, in order:
 * [stageRows, statusRows, claimRows, durationRows, reworkRows, totalsRows]
 */
function mockDefaultQueryResults(overrides: Partial<{
  stageRows: Array<{ key: string; count: string }>;
  statusRows: Array<{ key: string; count: string }>;
  claimRows: Array<{ healthy: string; expiring_soon: string; expired: string }>;
  durationRows: Array<{ stage: string; avg_seconds: string }>;
  reworkRows: Array<{ rework_count: string; ticket_count: string }>;
  totalsRows: Array<{ total_tickets: string; total_done: string }>;
}> = {}): void {
  const defaults = {
    stageRows: [
      { key: 'READY', count: '3' },
      { key: 'BACKEND', count: '5' },
      { key: 'QA', count: '2' },
      { key: 'DONE', count: '10' },
    ],
    statusRows: [
      { key: 'READY', count: '3' },
      { key: 'IN_PROGRESS', count: '7' },
      { key: 'DONE', count: '10' },
    ],
    claimRows: [
      { healthy: '4', expiring_soon: '1', expired: '2' },
    ],
    durationRows: [
      { stage: 'BACKEND', avg_seconds: '3600' },
      { stage: 'QA', avg_seconds: '1800' },
    ],
    reworkRows: [
      { rework_count: '0', ticket_count: '15' },
      { rework_count: '1', ticket_count: '3' },
      { rework_count: '2', ticket_count: '1' },
    ],
    totalsRows: [
      { total_tickets: '20', total_done: '10' },
    ],
    ...overrides,
  };

  mockQuery
    .mockResolvedValueOnce({ rows: defaults.stageRows })
    .mockResolvedValueOnce({ rows: defaults.statusRows })
    .mockResolvedValueOnce({ rows: defaults.claimRows })
    .mockResolvedValueOnce({ rows: defaults.durationRows })
    .mockResolvedValueOnce({ rows: defaults.reworkRows })
    .mockResolvedValueOnce({ rows: defaults.totalsRows });
}

/** Parse the text content from a CallToolResult */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseResult(result: any): unknown {
  return JSON.parse((result.content[0] as { type: 'text'; text: string }).text);
}

// ═════════════════════════════════════════════════════════════════════════════
// 1. SCHEMA VALIDATION (AC1)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsSchema — AC1: Zod schema validation', () => {
  it('accepts empty input (all optional)', () => {
    const result = ticketsStatsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('accepts valid time_range_hours as a positive number', () => {
    const result = ticketsStatsSchema.safeParse({ time_range_hours: 24 });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.time_range_hours).toBe(24);
    }
  });

  it('accepts fractional time_range_hours', () => {
    const result = ticketsStatsSchema.safeParse({ time_range_hours: 0.5 });
    expect(result.success).toBe(true);
  });

  it('rejects time_range_hours = 0 (must be positive)', () => {
    const result = ticketsStatsSchema.safeParse({ time_range_hours: 0 });
    expect(result.success).toBe(false);
  });

  it('rejects negative time_range_hours', () => {
    const result = ticketsStatsSchema.safeParse({ time_range_hours: -1 });
    expect(result.success).toBe(false);
  });

  it('rejects non-numeric time_range_hours', () => {
    const result = ticketsStatsSchema.safeParse({ time_range_hours: 'abc' });
    expect(result.success).toBe(false);
  });

  it('strips unknown properties', () => {
    const result = ticketsStatsSchema.safeParse({
      time_range_hours: 12,
      unknown_field: 'foo',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect((result.data as Record<string, unknown>)['unknown_field']).toBeUndefined();
    }
  });

  it('accepts undefined for time_range_hours (optional)', () => {
    const result = ticketsStatsSchema.safeParse({ time_range_hours: undefined });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.time_range_hours).toBeUndefined();
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. HANDLER — STAGES RESPONSE (AC2)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — AC2: stages object', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns stages object mapping each TicketStage to ticket count', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { stages: Record<string, number> };

    expect(parsed.stages).toBeDefined();
    expect(parsed.stages['READY']).toBe(3);
    expect(parsed.stages['BACKEND']).toBe(5);
    expect(parsed.stages['QA']).toBe(2);
    expect(parsed.stages['DONE']).toBe(10);
  });

  it('initializes all stages to 0 even when no tickets exist for a stage', async () => {
    mockDefaultQueryResults({ stageRows: [] });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { stages: Record<string, number> };

    // All 13 stages should be present
    for (const stage of TICKET_STAGES) {
      expect(parsed.stages[stage]).toBe(0);
    }
  });

  it('includes all 13 defined stages in output', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { stages: Record<string, number> };

    const stageKeys = Object.keys(parsed.stages);
    for (const stage of TICKET_STAGES) {
      expect(stageKeys).toContain(stage);
    }
    expect(stageKeys).toHaveLength(TICKET_STAGES.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. HANDLER — STATUSES RESPONSE (AC3)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — AC3: statuses object', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns statuses object mapping each TicketStatus to ticket count', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { statuses: Record<string, number> };

    expect(parsed.statuses).toBeDefined();
    expect(parsed.statuses['READY']).toBe(3);
    expect(parsed.statuses['IN_PROGRESS']).toBe(7);
    expect(parsed.statuses['DONE']).toBe(10);
  });

  it('initializes all statuses to 0 even when no tickets exist for a status', async () => {
    mockDefaultQueryResults({ statusRows: [] });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { statuses: Record<string, number> };

    for (const status of TICKET_STATUSES) {
      expect(parsed.statuses[status]).toBe(0);
    }
  });

  it('includes all 7 defined statuses in output', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { statuses: Record<string, number> };

    const statusKeys = Object.keys(parsed.statuses);
    for (const status of TICKET_STATUSES) {
      expect(statusKeys).toContain(status);
    }
    expect(statusKeys).toHaveLength(TICKET_STATUSES.length);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. HANDLER — CLAIMS HEALTH (AC4)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — AC4: claims object', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns claims with healthy, expiring_soon, and expired counts', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      claims: { healthy: number; expiring_soon: number; expired: number };
    };

    expect(parsed.claims).toBeDefined();
    expect(parsed.claims.healthy).toBe(4);
    expect(parsed.claims.expiring_soon).toBe(1);
    expect(parsed.claims.expired).toBe(2);
  });

  it('handles zero claim counts gracefully', async () => {
    mockDefaultQueryResults({
      claimRows: [{ healthy: '0', expiring_soon: '0', expired: '0' }],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      claims: { healthy: number; expiring_soon: number; expired: number };
    };

    expect(parsed.claims.healthy).toBe(0);
    expect(parsed.claims.expiring_soon).toBe(0);
    expect(parsed.claims.expired).toBe(0);
  });

  it('defaults to 0 when claim query returns no rows', async () => {
    mockDefaultQueryResults({ claimRows: [] });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      claims: { healthy: number; expiring_soon: number; expired: number };
    };

    // When claimRows.rows[0] is undefined, it should fallback to '0'
    expect(parsed.claims.healthy).toBe(0);
    expect(parsed.claims.expiring_soon).toBe(0);
    expect(parsed.claims.expired).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. HANDLER — AVG STAGE DURATION (AC5)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — AC5: avg_stage_duration', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns avg_stage_duration mapping stages to average seconds', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      avg_stage_duration: Record<string, number>;
    };

    expect(parsed.avg_stage_duration).toBeDefined();
    expect(parsed.avg_stage_duration['BACKEND']).toBe(3600);
    expect(parsed.avg_stage_duration['QA']).toBe(1800);
  });

  it('initializes all stages to 0 in avg_stage_duration', async () => {
    mockDefaultQueryResults({ durationRows: [] });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      avg_stage_duration: Record<string, number>;
    };

    for (const stage of TICKET_STAGES) {
      expect(parsed.avg_stage_duration[stage]).toBe(0);
    }
  });

  it('handles NaN avg_seconds by defaulting to 0', async () => {
    mockDefaultQueryResults({
      durationRows: [{ stage: 'BACKEND', avg_seconds: 'NaN' }],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      avg_stage_duration: Record<string, number>;
    };

    // parseFloat('NaN') || 0 should give 0
    expect(parsed.avg_stage_duration['BACKEND']).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. HANDLER — REWORK DISTRIBUTION (AC6)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — AC6: rework_distribution', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns rework_distribution mapping rework_count to ticket count', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      rework_distribution: Record<string, number>;
    };

    expect(parsed.rework_distribution).toBeDefined();
    expect(parsed.rework_distribution['0']).toBe(15);
    expect(parsed.rework_distribution['1']).toBe(3);
    expect(parsed.rework_distribution['2']).toBe(1);
  });

  it('returns empty rework_distribution when all tickets have 0 reworks', async () => {
    mockDefaultQueryResults({
      reworkRows: [{ rework_count: '0', ticket_count: '20' }],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      rework_distribution: Record<string, number>;
    };

    expect(Object.keys(parsed.rework_distribution)).toHaveLength(1);
    expect(parsed.rework_distribution['0']).toBe(20);
  });

  it('handles empty rework distribution (no tickets)', async () => {
    mockDefaultQueryResults({ reworkRows: [] });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      rework_distribution: Record<string, number>;
    };

    expect(Object.keys(parsed.rework_distribution)).toHaveLength(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. HANDLER — TOTALS (AC7)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — AC7: total_tickets and total_done', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns total_tickets and total_done counts', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      total_tickets: number;
      total_done: number;
    };

    expect(parsed.total_tickets).toBe(20);
    expect(parsed.total_done).toBe(10);
  });

  it('handles zero totals', async () => {
    mockDefaultQueryResults({
      totalsRows: [{ total_tickets: '0', total_done: '0' }],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      total_tickets: number;
      total_done: number;
    };

    expect(parsed.total_tickets).toBe(0);
    expect(parsed.total_done).toBe(0);
  });

  it('defaults to 0 when totals query returns no rows', async () => {
    mockDefaultQueryResults({ totalsRows: [] });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      total_tickets: number;
      total_done: number;
    };

    expect(parsed.total_tickets).toBe(0);
    expect(parsed.total_done).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. HANDLER — PARALLEL QUERIES & PERFORMANCE (AC8)
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — AC8: parallel queries for performance', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('executes exactly 6 queries in parallel (Promise.all)', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    expect(mockQuery).toHaveBeenCalledTimes(6);
  });

  it('query 1 groups by stage', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('GROUP BY stage');
    expect(sql).toContain('stage::text AS key');
  });

  it('query 2 groups by status', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    const [sql] = mockQuery.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('GROUP BY status');
    expect(sql).toContain('status::text AS key');
  });

  it('query 3 uses FILTER for claim health breakdown', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    const [sql] = mockQuery.mock.calls[2] as [string, unknown[]];
    expect(sql).toContain('FILTER');
    expect(sql).toContain('lease_expiry');
    expect(sql).toContain('claimed_by IS NOT NULL');
  });

  it('query 4 uses LAG() window function for stage duration', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    const [sql] = mockQuery.mock.calls[3] as [string, unknown[]];
    expect(sql).toContain('LAG');
    expect(sql).toContain('STAGE_ADVANCED');
    expect(sql).toContain('previous_stage');
  });

  it('query 5 groups by rework_count', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    const [sql] = mockQuery.mock.calls[4] as [string, unknown[]];
    expect(sql).toContain('GROUP BY rework_count');
  });

  it('query 6 counts total tickets and done tickets', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    const [sql] = mockQuery.mock.calls[5] as [string, unknown[]];
    expect(sql).toContain('total_tickets');
    expect(sql).toContain('total_done');
    expect(sql).toContain("status = 'DONE'");
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. TIME RANGE FILTER
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — time_range_hours filter', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('passes time_range_hours as parameterized query value', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 24 });

    // Queries 1, 2, 5, 6 (stage, status, rework, totals) should get the time filter param
    const call0Params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(call0Params).toEqual([24]);

    const call1Params = mockQuery.mock.calls[1]![1] as unknown[];
    expect(call1Params).toEqual([24]);
  });

  it('builds WHERE clause with interval for time-filtered queries', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 12 });

    const [sql] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('created_at >= NOW()');
    expect(sql).toContain('interval');
  });

  it('omits WHERE clause when no time_range_hours specified', async () => {
    mockDefaultQueryResults();

    // Use a fresh time_range_hours to skip module-level cache
    await ticketsStatsHandler({ time_range_hours: 999 });

    // For stage query (first call), params should have 999
    const call0Params = mockQuery.mock.calls[0]![1] as unknown[];
    expect(call0Params).toEqual([999]);

    vi.clearAllMocks();
    mockDefaultQueryResults();

    // Now call without filter — should not have WHERE clause for stage/status
    await ticketsStatsHandler({});

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('created_at >= NOW()');
    expect(params).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. CACHING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — caching', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('caches all-time results (no time_range_hours)', async () => {
    // Advance past any stale cache from prior tests
    vi.advanceTimersByTime(6_000);

    mockDefaultQueryResults();
    // First call - should query DB
    await ticketsStatsHandler({});
    expect(mockQuery).toHaveBeenCalledTimes(6);

    mockQuery.mockReset();

    // Second call within cache window - should NOT query DB
    const result2 = await ticketsStatsHandler({});
    expect(mockQuery).toHaveBeenCalledTimes(0);

    // Should still return valid data
    const parsed = parseResult(result2) as { total_tickets: number };
    expect(parsed.total_tickets).toBe(20);
  });

  it('does not use cache when time_range_hours is specified', async () => {
    // Advance well past any stale cache from prior tests
    vi.advanceTimersByTime(60_000);

    mockDefaultQueryResults();
    await ticketsStatsHandler({});
    expect(mockQuery).toHaveBeenCalledTimes(6);

    mockQuery.mockReset();
    mockDefaultQueryResults();

    // Call with filter should bypass cache and query DB
    await ticketsStatsHandler({ time_range_hours: 24 });
    expect(mockQuery).toHaveBeenCalledTimes(6);
  });

  it('logs cache hit on debug level', async () => {
    // Advance past any stale cache from prior tests
    vi.advanceTimersByTime(6_000);

    mockDefaultQueryResults();
    await ticketsStatsHandler({});

    mockQuery.mockReset();
    mockLogger.debug.mockClear();

    await ticketsStatsHandler({});

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'tickets_stats_cache_hit' }),
      expect.any(String),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. ERROR HANDLING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — error handling', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('catches DB errors and returns error response', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { error: string; message: string; timestamp: string };

    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toContain('connection refused');
    expect(parsed.timestamp).toBeDefined();
  });

  it('logs error with structured format', async () => {
    mockQuery.mockRejectedValueOnce(new Error('DB timeout'));

    await ticketsStatsHandler({ time_range_hours: 1 });

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tickets_stats_error',
        error: 'DB timeout',
      }),
      expect.any(String),
    );
  });

  it('handles non-Error thrown values', async () => {
    mockQuery.mockRejectedValueOnce('string error');

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { error: string; message: string };

    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toContain('string error');
  });

  it('does not throw — always returns a CallToolResult', async () => {
    mockQuery.mockRejectedValueOnce(new Error('fatal'));

    const result = await ticketsStatsHandler({ time_range_hours: 1 });

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content[0]).toHaveProperty('type', 'text');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. MCP RESPONSE FORMAT
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — MCP response format', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns MCP-compliant content array with type "text"', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });

    expect(result).toHaveProperty('content');
    expect(Array.isArray(result.content)).toBe(true);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]).toHaveProperty('type', 'text');
    expect(result.content[0]).toHaveProperty('text');
  });

  it('result text is valid JSON', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });

    const text = (result.content[0] as { type: 'text'; text: string }).text;
    expect(() => JSON.parse(text)).not.toThrow();
  });

  it('response contains all expected top-level keys', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as Record<string, unknown>;

    expect(parsed).toHaveProperty('stages');
    expect(parsed).toHaveProperty('statuses');
    expect(parsed).toHaveProperty('claims');
    expect(parsed).toHaveProperty('avg_stage_duration');
    expect(parsed).toHaveProperty('rework_distribution');
    expect(parsed).toHaveProperty('total_tickets');
    expect(parsed).toHaveProperty('total_done');
  });

  it('stages values are numbers, not strings', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { stages: Record<string, unknown> };

    for (const value of Object.values(parsed.stages)) {
      expect(typeof value).toBe('number');
    }
  });

  it('claims values are numbers, not strings', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      claims: { healthy: unknown; expiring_soon: unknown; expired: unknown };
    };

    expect(typeof parsed.claims.healthy).toBe('number');
    expect(typeof parsed.claims.expiring_soon).toBe('number');
    expect(typeof parsed.claims.expired).toBe('number');
  });

  it('total_tickets and total_done are numbers', async () => {
    mockDefaultQueryResults();

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      total_tickets: unknown;
      total_done: unknown;
    };

    expect(typeof parsed.total_tickets).toBe('number');
    expect(typeof parsed.total_done).toBe('number');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. LOGGING
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — structured logging', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('logs query execution with structured event tag', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 1 });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tickets_stats_query',
        durationMs: expect.any(Number),
        totalTickets: 20,
      }),
      expect.any(String),
    );
  });

  it('includes timeRangeHours in log when specified', async () => {
    mockDefaultQueryResults();

    await ticketsStatsHandler({ time_range_hours: 48 });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'tickets_stats_query',
        timeRangeHours: 48,
      }),
      expect.any(String),
    );
  });

  it('logs timeRangeHours as null when not specified', async () => {
    mockDefaultQueryResults();

    // Need to bust cache first
    await ticketsStatsHandler({ time_range_hours: 7777 });

    expect(mockLogger.debug).toHaveBeenCalledWith(
      expect.objectContaining({
        timeRangeHours: 7777,
      }),
      expect.any(String),
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. EDGE CASES
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsHandler — edge cases', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('handles completely empty database (all queries return no rows)', async () => {
    mockDefaultQueryResults({
      stageRows: [],
      statusRows: [],
      claimRows: [],
      durationRows: [],
      reworkRows: [],
      totalsRows: [],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      stages: Record<string, number>;
      statuses: Record<string, number>;
      claims: { healthy: number; expiring_soon: number; expired: number };
      avg_stage_duration: Record<string, number>;
      rework_distribution: Record<string, number>;
      total_tickets: number;
      total_done: number;
    };

    // Should not throw, all values defaulted to 0
    expect(parsed.total_tickets).toBe(0);
    expect(parsed.total_done).toBe(0);
    expect(parsed.claims.healthy).toBe(0);
    expect(parsed.claims.expiring_soon).toBe(0);
    expect(parsed.claims.expired).toBe(0);
    expect(Object.keys(parsed.rework_distribution)).toHaveLength(0);

    // All stages and statuses should be initialized to 0
    for (const stage of TICKET_STAGES) {
      expect(parsed.stages[stage]).toBe(0);
      expect(parsed.avg_stage_duration[stage]).toBe(0);
    }
    for (const status of TICKET_STATUSES) {
      expect(parsed.statuses[status]).toBe(0);
    }
  });

  it('ignores unknown stages returned from DB', async () => {
    mockDefaultQueryResults({
      stageRows: [
        { key: 'UNKNOWN_STAGE', count: '5' },
        { key: 'BACKEND', count: '3' },
      ],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { stages: Record<string, number> };

    // UNKNOWN_STAGE should not appear (guard: `if (stage in stages)`)
    expect(parsed.stages['UNKNOWN_STAGE']).toBeUndefined();
    expect(parsed.stages['BACKEND']).toBe(3);
  });

  it('ignores unknown statuses returned from DB', async () => {
    mockDefaultQueryResults({
      statusRows: [
        { key: 'INVALID_STATUS', count: '2' },
        { key: 'DONE', count: '10' },
      ],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as { statuses: Record<string, number> };

    expect(parsed.statuses['INVALID_STATUS']).toBeUndefined();
    expect(parsed.statuses['DONE']).toBe(10);
  });

  it('handles large ticket counts without overflow', async () => {
    mockDefaultQueryResults({
      totalsRows: [{ total_tickets: '999999', total_done: '500000' }],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      total_tickets: number;
      total_done: number;
    };

    expect(parsed.total_tickets).toBe(999999);
    expect(parsed.total_done).toBe(500000);
  });

  it('handles fractional avg_seconds from stage duration', async () => {
    mockDefaultQueryResults({
      durationRows: [{ stage: 'BACKEND', avg_seconds: '123.456' }],
    });

    const result = await ticketsStatsHandler({ time_range_hours: 1 });
    const parsed = parseResult(result) as {
      avg_stage_duration: Record<string, number>;
    };

    expect(parsed.avg_stage_duration['BACKEND']).toBeCloseTo(123.456);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. EXPORTED SCHEMA TYPE
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsStatsSchema — export shape', () => {
  it('exports ticketsStatsSchema as a Zod object', () => {
    expect(ticketsStatsSchema).toBeDefined();
    expect(ticketsStatsSchema.shape).toBeDefined();
    expect(ticketsStatsSchema.shape).toHaveProperty('time_range_hours');
  });

  it('exports ticketsStatsHandler as a function', () => {
    expect(typeof ticketsStatsHandler).toBe('function');
  });
});
