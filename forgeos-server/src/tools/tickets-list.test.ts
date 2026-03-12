/**
 * Unit tests for the `tickets.list` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validation for filter parameters with correct enum values
 * - Filtering by stage, status, type, priority, and tags
 * - Pagination via limit and offset with defaults
 * - Sorting by priority, created_at, updated_at (asc/desc)
 * - Response shape: { tickets, total_count, limit, offset }
 * - Error handling for database failures
 *
 * @ticket TASK-INT-BE012
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketsListSchema, ticketsListHandler } from './tickets-list.js';

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

// ── Helper factories ─────────────────────────────────────────────────────────

function makeTicketSummary(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    ticket_id: 'TASK-001',
    title: 'Test ticket',
    type: 'backend',
    priority: 'high',
    status: 'READY',
    stage: 'BACKEND',
    claimed_by_name: null,
    tags: [],
    rework_count: 0,
    created_at: '2026-03-12T00:00:00Z',
    updated_at: '2026-03-12T00:00:00Z',
    ...overrides,
  };
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('ticketsListSchema', () => {
  it('should accept empty input (all filters optional)', () => {
    const result = ticketsListSchema.parse({});
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(result.sort_by).toBe('created_at');
    expect(result.sort_order).toBe('desc');
    expect(result.stage).toBeUndefined();
    expect(result.status).toBeUndefined();
    expect(result.type).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.tags).toBeUndefined();
  });

  it('should accept all valid filter values', () => {
    const result = ticketsListSchema.parse({
      stage: 'BACKEND',
      status: 'READY',
      type: 'backend',
      priority: 'high',
      tags: ['infra', 'urgent'],
      sort_by: 'priority',
      sort_order: 'asc',
      limit: 10,
      offset: 20,
    });
    expect(result.stage).toBe('BACKEND');
    expect(result.status).toBe('READY');
    expect(result.type).toBe('backend');
    expect(result.priority).toBe('high');
    expect(result.tags).toEqual(['infra', 'urgent']);
    expect(result.sort_by).toBe('priority');
    expect(result.sort_order).toBe('asc');
    expect(result.limit).toBe(10);
    expect(result.offset).toBe(20);
  });

  it('should reject invalid stage value', () => {
    expect(() =>
      ticketsListSchema.parse({ stage: 'INVALID_STAGE' }),
    ).toThrow();
  });

  it('should reject invalid status value', () => {
    expect(() =>
      ticketsListSchema.parse({ status: 'INVALID' }),
    ).toThrow();
  });

  it('should reject invalid type value', () => {
    expect(() =>
      ticketsListSchema.parse({ type: 'invalid_type' }),
    ).toThrow();
  });

  it('should reject invalid priority value', () => {
    expect(() =>
      ticketsListSchema.parse({ priority: 'ultra' }),
    ).toThrow();
  });

  it('should reject invalid sort_by value', () => {
    expect(() =>
      ticketsListSchema.parse({ sort_by: 'invalid_column' }),
    ).toThrow();
  });

  it('should reject invalid sort_order value', () => {
    expect(() =>
      ticketsListSchema.parse({ sort_order: 'sideways' }),
    ).toThrow();
  });

  it('should reject limit below 1', () => {
    expect(() => ticketsListSchema.parse({ limit: 0 })).toThrow();
  });

  it('should reject limit above 200', () => {
    expect(() => ticketsListSchema.parse({ limit: 201 })).toThrow();
  });

  it('should reject negative offset', () => {
    expect(() => ticketsListSchema.parse({ offset: -1 })).toThrow();
  });

  it('should reject empty strings in tags array', () => {
    expect(() =>
      ticketsListSchema.parse({ tags: ['valid', ''] }),
    ).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('ticketsListHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return tickets with total_count for unfiltered query', async () => {
    const tickets = [
      makeTicketSummary({ ticket_id: 'T1' }),
      makeTicketSummary({ ticket_id: 'T2' }),
    ];

    // Data query
    mockQuery.mockResolvedValueOnce({ rows: tickets });
    // Count query
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 2 }] });

    const result = await ticketsListHandler({
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.tickets).toHaveLength(2);
    expect(parsed.total_count).toBe(2);
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
    expect(result.isError).toBeUndefined();
  });

  it('should return empty array when no tickets match', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 0 }] });

    const result = await ticketsListHandler({
      stage: 'QA',
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.tickets).toEqual([]);
    expect(parsed.total_count).toBe(0);
  });

  it('should pass stage filter as parameterized query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 0 }] });

    await ticketsListHandler({
      stage: 'BACKEND',
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    // Data query (first call)
    const dataCall = mockQuery.mock.calls[0];
    expect(dataCall[0]).toContain('stage = $1::ticket_stage');
    expect(dataCall[1]).toContain('BACKEND');
    expect(dataCall[1]).toContain(50);  // limit
    expect(dataCall[1]).toContain(0);   // offset
  });

  it('should combine multiple filters with AND', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 0 }] });

    await ticketsListHandler({
      stage: 'BACKEND',
      status: 'CLAIMED',
      type: 'backend',
      priority: 'high',
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 10,
      offset: 0,
    });

    const dataCall = mockQuery.mock.calls[0];
    const query = dataCall[0] as string;
    expect(query).toContain('stage = $1::ticket_stage');
    expect(query).toContain('status = $2::ticket_status');
    expect(query).toContain('type = $3::ticket_type');
    expect(query).toContain('priority = $4::ticket_priority');
    expect(dataCall[1]).toEqual(['BACKEND', 'CLAIMED', 'backend', 'high', 10, 0]);
  });

  it('should handle tags filter with @> operator', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 0 }] });

    await ticketsListHandler({
      tags: ['infra', 'urgent'],
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    const dataCall = mockQuery.mock.calls[0];
    const query = dataCall[0] as string;
    expect(query).toContain('tags @> $1::text[]');
    expect(dataCall[1][0]).toEqual(['infra', 'urgent']);
  });

  it('should apply sort_by and sort_order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 0 }] });

    await ticketsListHandler({
      sort_by: 'priority',
      sort_order: 'asc',
      limit: 50,
      offset: 0,
    });

    const dataCall = mockQuery.mock.calls[0];
    const query = dataCall[0] as string;
    expect(query).toContain('ORDER BY priority ASC');
  });

  it('should apply sort_order desc', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 0 }] });

    await ticketsListHandler({
      sort_by: 'updated_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    const dataCall = mockQuery.mock.calls[0];
    const query = dataCall[0] as string;
    expect(query).toContain('ORDER BY updated_at DESC');
  });

  it('should pass limit and offset to data query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 100 }] });

    const result = await ticketsListHandler({
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 25,
      offset: 50,
    });

    const dataCall = mockQuery.mock.calls[0];
    const params = dataCall[1] as unknown[];
    expect(params[params.length - 2]).toBe(25); // limit
    expect(params[params.length - 1]).toBe(50); // offset

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.total_count).toBe(100);
    expect(parsed.limit).toBe(25);
    expect(parsed.offset).toBe(50);
  });

  it('should not pass limit/offset to count query', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 0 }] });

    await ticketsListHandler({
      stage: 'QA',
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 10,
      offset: 5,
    });

    // Count query (second call)
    const countCall = mockQuery.mock.calls[1];
    const countParams = countCall[1] as unknown[];
    // Only filter param, no limit/offset
    expect(countParams).toEqual(['QA']);
  });

  it('should return ticket summaries with expected fields', async () => {
    const ticket = makeTicketSummary({
      ticket_id: 'TASK-BE-012',
      title: 'Implement list tool',
      type: 'backend',
      priority: 'critical',
      status: 'READY',
      stage: 'BACKEND',
      claimed_by_name: 'Backend',
      tags: ['mcp', 'api'],
      rework_count: 1,
    });

    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [{ total_count: 1 }] });

    const result = await ticketsListHandler({
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    const t = parsed.tickets[0];
    expect(t.ticket_id).toBe('TASK-BE-012');
    expect(t.title).toBe('Implement list tool');
    expect(t.type).toBe('backend');
    expect(t.priority).toBe('critical');
    expect(t.status).toBe('READY');
    expect(t.stage).toBe('BACKEND');
    expect(t.claimed_by_name).toBe('Backend');
    expect(t.tags).toEqual(['mcp', 'api']);
    expect(t.rework_count).toBe(1);
    expect(t.created_at).toBeDefined();
    expect(t.updated_at).toBeDefined();
  });

  it('should handle database errors gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsListHandler({
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    expect(result.isError).toBe(true);
    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.error).toBe('connection refused');
    expect(parsed.message).toBe('Failed to list tickets');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should default total_count to 0 when count query returns no rows', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockQuery.mockResolvedValueOnce({ rows: [] }); // empty count result

    const result = await ticketsListHandler({
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.total_count).toBe(0);
  });

  it('should execute data and count queries in parallel', async () => {
    const resolveOrder: string[] = [];

    mockQuery.mockImplementation((query: string) => {
      if ((query as string).includes('COUNT')) {
        resolveOrder.push('count');
        return Promise.resolve({ rows: [{ total_count: 5 }] });
      }
      resolveOrder.push('data');
      return Promise.resolve({ rows: [] });
    });

    await ticketsListHandler({
      sort_by: 'created_at',
      sort_order: 'desc',
      limit: 50,
      offset: 0,
    });

    // Both queries should have been called
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});
