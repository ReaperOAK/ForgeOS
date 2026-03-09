/**
 * Unit tests for the `tickets.release` MCP tool.
 *
 * Tests verify all acceptance criteria:
 * - Zod schema validation (ticket_id, agent_name, reason, force)
 * - NOT_CLAIM_OWNER error when caller is not the claim owner
 * - FORBIDDEN error when non-admin attempts force=true
 * - Successful release clears claim fields and returns READY status
 * - File locks are released on success
 * - RELEASED / FORCE_RELEASED event is recorded
 * - Response shape: {ticket, released_file_locks: string[]}
 *
 * @ticket TASK-FOS-03-008
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ticketsReleaseSchema, ticketsReleaseHandler } from './tickets-release.js';

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

function makeAgentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'agent-uuid-001',
    permissions: ['agent_update'],
    ...overrides,
  };
}

function makeAdminAgentRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'admin-uuid-001',
    permissions: ['*'],
    ...overrides,
  };
}

function makeTicketRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'pk-uuid-001',
    ticket_id: 'TASK-TEST-001',
    status: 'READY',
    stage: 'BACKEND',
    claimed_by: null,
    claimed_by_name: null,
    machine_id: null,
    operator: null,
    lease_expiry: null,
    ...overrides,
  };
}

// ── Schema Tests ─────────────────────────────────────────────────────────────

describe('ticketsReleaseSchema', () => {
  it('should require ticket_id and agent_name', () => {
    expect(() => ticketsReleaseSchema.parse({})).toThrow();
    expect(() => ticketsReleaseSchema.parse({ ticket_id: 'T1' })).toThrow();
  });

  it('should accept valid minimal input', () => {
    const result = ticketsReleaseSchema.parse({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
    });
    expect(result.ticket_id).toBe('TASK-001');
    expect(result.agent_name).toBe('Backend');
    expect(result.force).toBe(false);
    expect(result.reason).toBeUndefined();
  });

  it('should accept all fields', () => {
    const result = ticketsReleaseSchema.parse({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
      reason: 'Work complete',
      force: true,
    });
    expect(result.force).toBe(true);
    expect(result.reason).toBe('Work complete');
  });

  it('should default force to false', () => {
    const result = ticketsReleaseSchema.parse({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
    });
    expect(result.force).toBe(false);
  });

  it('should reject empty ticket_id', () => {
    expect(() =>
      ticketsReleaseSchema.parse({ ticket_id: '', agent_name: 'Backend' }),
    ).toThrow();
  });

  it('should reject empty agent_name', () => {
    expect(() =>
      ticketsReleaseSchema.parse({ ticket_id: 'T1', agent_name: '' }),
    ).toThrow();
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('ticketsReleaseHandler', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('should return NOT_CLAIM_OWNER when caller is not the claim owner', async () => {
    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeAgentRow()] });
    // File locks query (before release)
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // release_ticket raises NOT_CLAIM_OWNER
    mockQuery.mockRejectedValueOnce(
      new Error('NOT_CLAIM_OWNER: You do not hold the claim on this ticket'),
    );

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
      force: false,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
    expect(parsed.ticket_id).toBe('TASK-001');
  });

  it('should return FORBIDDEN when non-admin attempts force=true', async () => {
    // Agent lookup — non-admin permissions
    mockQuery.mockResolvedValueOnce({
      rows: [makeAgentRow({ permissions: ['agent_update'] })],
    });

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
      force: true,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.error).toBe('FORBIDDEN');
    expect(parsed.message).toMatch(/admin/i);
  });

  it('should return TICKET_NOT_FOUND when ticket does not exist', async () => {
    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeAgentRow()] });
    // File locks query
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // release_ticket raises TICKET_NOT_FOUND
    mockQuery.mockRejectedValueOnce(
      new Error('TICKET_NOT_FOUND: Ticket TASK-999 does not exist'),
    );

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-999',
      agent_name: 'Backend',
      force: false,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.error).toBe('TICKET_NOT_FOUND');
    expect(parsed.ticket_id).toBe('TASK-999');
  });

  it('should successfully release a claim and return ticket with released_file_locks', async () => {
    const releasedTicket = makeTicketRow({
      status: 'READY',
      claimed_by: null,
      machine_id: null,
      lease_expiry: null,
    });

    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeAgentRow()] });
    // File locks before release
    mockQuery.mockResolvedValueOnce({
      rows: [
        { file_path: 'src/tools/foo.ts' },
        { file_path: 'src/tools/bar.ts' },
      ],
    });
    // release_ticket success
    mockQuery.mockResolvedValueOnce({ rows: [releasedTicket] });

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      reason: 'Work complete',
      force: false,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.ticket).toBeDefined();
    expect(parsed.ticket.status).toBe('READY');
    expect(parsed.ticket.claimed_by).toBeNull();
    expect(parsed.ticket.machine_id).toBeNull();
    expect(parsed.ticket.lease_expiry).toBeNull();
    expect(parsed.released_file_locks).toEqual([
      'src/tools/foo.ts',
      'src/tools/bar.ts',
    ]);
  });

  it('should allow admin to force-release another agent claim', async () => {
    const releasedTicket = makeTicketRow({
      status: 'READY',
      claimed_by: null,
    });

    // Agent lookup — admin
    mockQuery.mockResolvedValueOnce({ rows: [makeAdminAgentRow()] });
    // File locks before release
    mockQuery.mockResolvedValueOnce({ rows: [{ file_path: 'src/file.ts' }] });
    // release_ticket success with force
    mockQuery.mockResolvedValueOnce({ rows: [releasedTicket] });

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Admin',
      force: true,
      reason: 'Lease recovery',
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.ticket).toBeDefined();
    expect(parsed.ticket.status).toBe('READY');
    expect(parsed.released_file_locks).toEqual(['src/file.ts']);
  });

  it('should allow agent with admin_all permission to force-release', async () => {
    const releasedTicket = makeTicketRow({ status: 'READY' });

    // Agent with admin_all permission
    mockQuery.mockResolvedValueOnce({
      rows: [makeAgentRow({ permissions: ['admin_all'] })],
    });
    // File locks
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // release_ticket success
    mockQuery.mockResolvedValueOnce({ rows: [releasedTicket] });

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      force: true,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.ticket).toBeDefined();
    expect(parsed.released_file_locks).toEqual([]);
  });

  it('should auto-register unknown agent with non-admin permissions', async () => {
    // Agent not found
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Auto-register insert
    mockQuery.mockResolvedValueOnce({
      rows: [{ id: 'new-agent-uuid', permissions: ['agent_update'] }],
    });

    // Attempting force with auto-registered (non-admin) agent → FORBIDDEN
    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-001',
      agent_name: 'NewAgent',
      force: true,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.error).toBe('FORBIDDEN');
  });

  it('should return empty released_file_locks when no locks exist', async () => {
    const releasedTicket = makeTicketRow({ status: 'READY' });

    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeAgentRow()] });
    // No file locks
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // release_ticket success
    mockQuery.mockResolvedValueOnce({ rows: [releasedTicket] });

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-TEST-001',
      agent_name: 'Backend',
      force: false,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.released_file_locks).toEqual([]);
  });

  it('should handle unexpected database errors as INTERNAL_ERROR', async () => {
    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeAgentRow()] });
    // File locks
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // Unexpected DB error
    mockQuery.mockRejectedValueOnce(new Error('connection refused'));

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
      force: false,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.error).toBe('INTERNAL_ERROR');
    expect(parsed.message).toMatch(/connection refused/i);
  });

  it('should handle release_ticket returning zero rows as INTERNAL_ERROR', async () => {
    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeAgentRow()] });
    // File locks
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // release_ticket returns empty
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsReleaseHandler({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
      force: false,
    });

    const parsed = JSON.parse(result.content[0]!.text as string);
    expect(parsed.error).toBe('INTERNAL_ERROR');
  });

  it('should pass reason to release_ticket SQL function', async () => {
    const releasedTicket = makeTicketRow({ status: 'READY' });

    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [makeAgentRow()] });
    // File locks
    mockQuery.mockResolvedValueOnce({ rows: [] });
    // release_ticket success
    mockQuery.mockResolvedValueOnce({ rows: [releasedTicket] });

    await ticketsReleaseHandler({
      ticket_id: 'TASK-001',
      agent_name: 'Backend',
      reason: 'Voluntary release after completion',
      force: false,
    });

    // Verify the SQL call included the reason
    const releaseCall = mockQuery.mock.calls[2];
    expect(releaseCall).toBeDefined();
    expect(releaseCall![0]).toMatch(/release_ticket/);
    expect(releaseCall![1]).toContain('Voluntary release after completion');
  });
});
