/**
 * Unit tests for the `tickets.payload` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validates ticket_id and agent_role (both required, non-empty)
 * - Returns full ticket JSON for existing ticket
 * - Returns NOT_FOUND error for non-existent ticket IDs
 * - Returns upstream_summary from filesystem when available
 * - Returns null upstream_summary when file is missing
 * - Returns file_scope from ticket's file_paths
 * - Returns memory_entries from events table
 * - Full payload structure matches expected shape
 * - Handles DB errors gracefully
 *
 * @ticket TASK-INT-BE013
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketsPayloadSchema, ticketsPayloadHandler } from './tickets-payload.js';

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

// ── Mock fs ──────────────────────────────────────────────────────────────────

const mockReadFile = vi.fn();

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parseContent(result: { content: Array<{ type: string; [k: string]: unknown }> }): Record<string, any> {
  const item = result.content[0] as { type: 'text'; text: string };
  return JSON.parse(item.text);
}

function makeTicketRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pk-uuid-013',
    ticket_id: 'TASK-INT-BE013',
    project_id: null,
    title: 'Implement tickets.payload MCP Tool',
    description: 'Returns full delegation context for an agent',
    type: 'backend',
    priority: 'critical',
    status: 'CLAIMED',
    stage: 'BACKEND',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
    claimed_by: 'agent-uuid-001',
    claimed_by_name: 'Backend',
    machine_id: 'build-01',
    operator: 'reaperoak',
    lease_expiry: '2026-03-12T16:00:00Z',
    lease_duration_minutes: 30,
    depends_on: [],
    file_paths: ['forgeos-server/src/tools/tickets-payload.ts', 'forgeos-server/src/tools/index.ts'],
    acceptance_criteria: ['AC1', 'AC2', 'AC3'],
    tags: ['backend', 'critical'],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-12T12:00:00Z',
    updated_at: '2026-03-12T12:30:00Z',
    completed_at: null,
    ...overrides,
  };
}

function makeEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-uuid-001',
    ticket_id: 'TASK-INT-BE013',
    event_type: 'CREATED',
    agent_id: null,
    agent_name: 'TODO',
    machine_id: 'system',
    operator: null,
    previous_stage: null,
    new_stage: 'READY',
    previous_status: null,
    new_status: 'READY',
    payload: {},
    created_at: '2026-03-12T12:00:00Z',
    ...overrides,
  };
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('ticketsPayloadSchema', () => {
  it('should require ticket_id and agent_role', () => {
    expect(() => ticketsPayloadSchema.parse({})).toThrow();
    expect(() => ticketsPayloadSchema.parse({ ticket_id: 'T-1' })).toThrow();
    expect(() => ticketsPayloadSchema.parse({ agent_role: 'BACKEND' })).toThrow();
  });

  it('should accept valid parameters', () => {
    const result = ticketsPayloadSchema.parse({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });
    expect(result.ticket_id).toBe('TASK-INT-BE013');
    expect(result.agent_role).toBe('BACKEND');
  });

  it('should reject empty ticket_id', () => {
    expect(() =>
      ticketsPayloadSchema.parse({ ticket_id: '', agent_role: 'BACKEND' }),
    ).toThrow();
  });

  it('should reject empty agent_role', () => {
    expect(() =>
      ticketsPayloadSchema.parse({ ticket_id: 'T-1', agent_role: '' }),
    ).toThrow();
  });

  it('should reject non-string values', () => {
    expect(() =>
      ticketsPayloadSchema.parse({ ticket_id: 123, agent_role: 'BACKEND' }),
    ).toThrow();
    expect(() =>
      ticketsPayloadSchema.parse({ ticket_id: 'T-1', agent_role: 456 }),
    ).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('ticketsPayloadHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockReadFile.mockReset();
  });

  it('should return full payload with upstream summary for existing ticket', async () => {
    const ticket = makeTicketRow();
    const events = [
      makeEventRow({ event_type: 'CLAIMED', created_at: '2026-03-12T12:30:00Z' }),
      makeEventRow({ event_type: 'CREATED', created_at: '2026-03-12T12:00:00Z' }),
    ];

    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: events });
    mockReadFile.mockResolvedValueOnce('# Architect Summary\nDesign completed.');

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseContent(result);

    expect(parsed.message).toBe('OK');
    expect(parsed.ticket.ticket_id).toBe('TASK-INT-BE013');
    expect(parsed.ticket.stage).toBe('BACKEND');
    expect(parsed.file_scope).toEqual([
      'forgeos-server/src/tools/tickets-payload.ts',
      'forgeos-server/src/tools/index.ts',
    ]);
    expect(parsed.memory_entries).toHaveLength(2);
  });

  it('should return upstream_summary when upstream file exists', async () => {
    const ticket = makeTicketRow({ stage: 'QA', sdlc_flow: ['READY', 'BACKEND', 'QA', 'DONE'] });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockReadFile.mockResolvedValueOnce('# Backend Summary\nImplementation done.');

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'QA',
    });

    const parsed = parseContent(result);
    expect(parsed.upstream_summary).toBe('# Backend Summary\nImplementation done.');
  });

  it('should return null upstream_summary when upstream file does not exist', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT: no such file'));

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });

    const parsed = parseContent(result);
    expect(parsed.upstream_summary).toBeNull();
  });

  it('should return null upstream_summary when current stage is first in flow', async () => {
    // READY is the first stage — no upstream
    const ticket = makeTicketRow({ stage: 'READY' });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });

    const parsed = parseContent(result);
    expect(parsed.upstream_summary).toBeNull();
    // readFile should not be called since upstream is null
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('should return file_scope from ticket file_paths', async () => {
    const ticket = makeTicketRow({
      file_paths: ['src/api/handler.ts', 'src/api/router.ts'],
    });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });

    const parsed = parseContent(result);
    expect(parsed.file_scope).toEqual(['src/api/handler.ts', 'src/api/router.ts']);
  });

  it('should return memory_entries from events table', async () => {
    const ticket = makeTicketRow();
    const events = [
      makeEventRow({ event_type: 'STAGE_ADVANCED', payload: { evidence: 'test' } }),
      makeEventRow({ event_type: 'CLAIMED' }),
      makeEventRow({ event_type: 'CREATED' }),
    ];

    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: events });
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });

    const parsed = parseContent(result);
    expect(parsed.memory_entries).toHaveLength(3);
    expect(parsed.memory_entries[0].event_type).toBe('STAGE_ADVANCED');
  });

  it('should return NOT_FOUND error for non-existent ticket', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsPayloadHandler({
      ticket_id: 'DOESNT-EXIST',
      agent_role: 'BACKEND',
    });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);
    expect(parsed.error).toBe('NOT_FOUND');
    expect(parsed.ticket).toBeNull();
    expect(parsed.upstream_summary).toBeNull();
    expect(parsed.file_scope).toEqual([]);
    expect(parsed.memory_entries).toEqual([]);
  });

  it('should handle database error gracefully', async () => {
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });

    expect(result.isError).toBe(true);
    const parsed = parseContent(result);
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toContain('connection refused');
  });

  it('should derive correct upstream for frontend stage', async () => {
    const ticket = makeTicketRow({
      stage: 'FRONTEND',
      type: 'frontend',
      sdlc_flow: ['READY', 'UI_DESIGN', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE'],
    });
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockReadFile.mockResolvedValueOnce('# UIDesigner Summary\nMockups ready.');

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'FRONTEND',
    });

    const parsed = parseContent(result);
    expect(parsed.upstream_summary).toBe('# UIDesigner Summary\nMockups ready.');
    // Verify readFile was called with UIDesigner path
    expect(mockReadFile).toHaveBeenCalledWith(
      expect.stringContaining('UIDesigner'),
      'utf-8',
    );
  });

  it('should return complete MCP content structure', async () => {
    const ticket = makeTicketRow();
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    mockQuery.mockResolvedValueOnce({ rows: [] });
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-INT-BE013',
      agent_role: 'BACKEND',
    });

    expect(result.content).toBeDefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const parsed = parseContent(result);
    expect(parsed).toHaveProperty('ticket');
    expect(parsed).toHaveProperty('upstream_summary');
    expect(parsed).toHaveProperty('file_scope');
    expect(parsed).toHaveProperty('memory_entries');
    expect(parsed).toHaveProperty('message');
  });
});
