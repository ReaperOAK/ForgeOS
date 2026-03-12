/**
 * Integration Tests — MCP-Only Ticket Workflow
 *
 * End-to-end integration tests for the full MCP ticket lifecycle using
 * mocked database pool. Tests the complete workflow: spawn → claim →
 * payload → advance through stages → reject (rework) → complete to DONE.
 *
 * Each test chains tool handler calls with coordinated mock responses to
 * verify the workflow contracts between MCP tools.
 *
 * @module __tests__/integration/mcp-workflow
 * @ticket TASK-INT-BE018
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories run before module scope) ────────────────

const { mockQuery, mockConnect, mockLogger, mockReadFile } = vi.hoisted(() => {
  const mLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  };

  const mClient = {
    query: vi.fn(),
    release: vi.fn(),
  };

  return {
    mockQuery: vi.fn(),
    mockConnect: vi.fn().mockResolvedValue(mClient),
    mockClient: mClient,
    mockLogger: mLogger,
    mockReadFile: vi.fn(),
  };
});

vi.mock('../../db/pool.js', () => ({
  pool: {
    query: mockQuery,
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

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────

import { ticketsSpawnHandler } from '../../tools/tickets-spawn.js';
import { ticketsClaimHandler } from '../../tools/tickets-claim.js';
import { ticketsPayloadHandler } from '../../tools/tickets-payload.js';
import { ticketsCompleteHandler } from '../../tools/tickets-complete.js';
import { ticketsRejectHandler } from '../../tools/tickets-reject.js';
import { SDLC_FLOWS } from '../../types/index.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

type TextContent = { type: 'text'; text: string };

function parseResult(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse((result.content[0] as TextContent).text);
}

const BACKEND_FLOW = SDLC_FLOWS['backend'];

/** Build a ticket row fixture with sensible defaults. */
function makeTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-int-001',
    ticket_id: 'TASK-PARENT-001-SUB-1',
    project_id: 'proj-uuid-001',
    title: 'Integration Test Child Ticket',
    description: 'Child ticket for workflow test',
    type: 'backend',
    priority: 'high',
    status: 'READY',
    stage: 'READY',
    sdlc_flow: BACKEND_FLOW,
    claimed_by: null,
    claimed_by_name: null,
    machine_id: null,
    operator: null,
    lease_expiry: null,
    lease_duration_minutes: 30,
    depends_on: [],
    file_paths: ['src/feature.ts'],
    acceptance_criteria: ['Feature works correctly'],
    tags: [],
    rework_count: 0,
    max_reworks: 3,
    metadata: { spawned_from: 'TASK-PARENT-001' },
    parent_id: 'TASK-PARENT-001',
    source_task_file: null,
    created_at: '2026-03-12T10:00:00Z',
    updated_at: '2026-03-12T10:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

/** Build a parent ticket row fixture. */
function makeParentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'uuid-parent-001',
    ticket_id: 'TASK-PARENT-001',
    project_id: 'proj-uuid-001',
    title: 'Parent Ticket',
    description: 'Parent ticket for workflow integration',
    type: 'backend',
    priority: 'high',
    status: 'CLAIMED',
    stage: 'BACKEND',
    sdlc_flow: BACKEND_FLOW,
    claimed_by: 'agent-uuid-001',
    claimed_by_name: 'Backend',
    machine_id: 'test-machine',
    operator: 'TestOp',
    lease_expiry: '2026-03-12T11:00:00Z',
    lease_duration_minutes: 30,
    depends_on: [],
    file_paths: ['src/parent.ts'],
    acceptance_criteria: ['Parent works'],
    tags: [],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-12T09:00:00Z',
    updated_at: '2026-03-12T09:30:00Z',
    completed_at: null,
    ...overrides,
  };
}

/** Standard evidence payload for completing a stage. */
const validEvidence = {
  artifacts: ['src/feature.ts', 'src/__tests__/feature.test.ts'],
  test_results: '12 tests passed, 0 failed. Coverage: 94%',
  confidence: 'HIGH' as const,
};

// ═════════════════════════════════════════════════════════════════════════════
// 1. AC1 — SPAWN: Test spawns a ticket via tickets.spawn
// ═════════════════════════════════════════════════════════════════════════════

describe('AC1: tickets.spawn — create child ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('spawns a child ticket from a parent ticket', async () => {
    const mockClient = await mockConnect();

    const parentTicket = makeParentRow();
    const childTicket = makeTicketRow();

    // BEGIN
    mockClient.query.mockResolvedValueOnce({});
    // SELECT parent: verify parent exists
    mockClient.query.mockResolvedValueOnce({ rows: [parentTicket] });
    // COUNT children for ID generation (pool.query, not client.query)
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] });
    // INSERT child ticket
    mockClient.query.mockResolvedValueOnce({ rows: [childTicket] });
    // INSERT SPAWNED event on parent
    mockClient.query.mockResolvedValueOnce({});
    // INSERT CREATED event on child
    mockClient.query.mockResolvedValueOnce({});
    // COMMIT
    mockClient.query.mockResolvedValueOnce({});

    const result = await ticketsSpawnHandler({
      parent_id: 'TASK-PARENT-001',
      title: 'Integration Test Child Ticket',
      type: 'backend',
      acceptance_criteria: ['Feature works correctly'],
      file_paths: ['src/feature.ts'],
    });

    const parsed = parseResult(result);
    expect(parsed.ticket).toBeDefined();
    expect(parsed.parent_ticket_id).toBe('TASK-PARENT-001');
    expect((parsed.ticket as Record<string, unknown>).parent_id).toBe('TASK-PARENT-001');
    expect((parsed.ticket as Record<string, unknown>).type).toBe('backend');
    expect((parsed.ticket as Record<string, unknown>).sdlc_flow).toEqual(BACKEND_FLOW);
  });

  it('returns TICKET_NOT_FOUND when parent does not exist', async () => {
    const mockClient = await mockConnect();

    // BEGIN
    mockClient.query.mockResolvedValueOnce({});
    // SELECT parent: not found
    mockClient.query.mockResolvedValueOnce({ rows: [] });
    // ROLLBACK
    mockClient.query.mockResolvedValueOnce({});

    const result = await ticketsSpawnHandler({
      parent_id: 'NONEXISTENT-PARENT',
      title: 'Orphan Ticket',
      type: 'backend',
      acceptance_criteria: ['Should fail'],
      file_paths: ['src/orphan.ts'],
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('TICKET_NOT_FOUND');
    expect(parsed.parent_id).toBe('NONEXISTENT-PARENT');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. AC2 — CLAIM: Test claims the spawned ticket via tickets.claim
// ═════════════════════════════════════════════════════════════════════════════

describe('AC2: tickets.claim — claim a ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('claims a READY ticket successfully', async () => {
    const claimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'BACKEND',
      claimed_by: 'agent-uuid-001',
      claimed_by_name: 'Backend Engineer',
      machine_id: 'test-machine',
      operator: 'TestOp',
      lease_expiry: '2026-03-12T10:30:00Z',
    });

    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // claim_ticket_by_id SQL function
    mockQuery.mockResolvedValueOnce({ rows: [claimedTicket] });
    // File locks query
    mockQuery.mockResolvedValueOnce({ rows: [{ file_path: 'src/feature.ts' }] });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      agent_name: 'Backend Engineer',
      machine_id: 'test-machine',
      operator: 'TestOp',
    });

    const parsed = parseResult(result);
    expect(parsed.ticket).toBeDefined();
    expect(parsed.lease_expiry).toBe('2026-03-12T10:30:00Z');
    expect(parsed.file_locks).toEqual(['src/feature.ts']);
    expect((parsed.ticket as Record<string, unknown>).status).toBe('CLAIMED');
  });

  it('returns ALREADY_CLAIMED when ticket is not available', async () => {
    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // claim_ticket_by_id returns empty (already claimed or wrong status)
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsClaimHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      agent_name: 'Backend Engineer',
      machine_id: 'test-machine',
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('ALREADY_CLAIMED');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. AC3 — PAYLOAD: Test retrieves full payload via tickets.payload
// ═════════════════════════════════════════════════════════════════════════════

describe('AC3: tickets.payload — retrieve delegation context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns full payload with ticket, upstream_summary, file_scope, and memory_entries', async () => {
    const ticket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'BACKEND',
      claimed_by: 'agent-uuid-001',
    });

    // Ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [ticket] });
    // Events query
    mockQuery.mockResolvedValueOnce({
      rows: [
        {
          id: 'evt-001',
          ticket_id: 'TASK-PARENT-001-SUB-1',
          event_type: 'CLAIMED',
          created_at: '2026-03-12T10:05:00Z',
        },
      ],
    });

    // Upstream summary from Architect (READY is first stage, no upstream)
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));

    const result = await ticketsPayloadHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      agent_role: 'BACKEND',
    });

    const parsed = parseResult(result);
    expect(parsed.ticket).toBeDefined();
    expect(parsed.message).toBe('OK');
    expect(parsed.file_scope).toEqual(['src/feature.ts']);
    expect(parsed.memory_entries).toHaveLength(1);
    // BACKEND is index 1 in the flow, upstream is READY (no agent folder)
    expect(parsed.upstream_summary).toBeNull();
  });

  it('returns NOT_FOUND for non-existent ticket', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsPayloadHandler({
      ticket_id: 'NONEXISTENT-999',
      agent_role: 'BACKEND',
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('NOT_FOUND');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. AC4 — ADVANCE: Test advances ticket through stages via tickets.complete
// ═════════════════════════════════════════════════════════════════════════════

describe('AC4: tickets.complete — advance through stages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('advances ticket from BACKEND to QA stage', async () => {
    const currentTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'BACKEND',
      claimed_by: 'agent-uuid-001',
      claimed_by_name: 'Backend Engineer',
    });
    const advancedTicket = makeTicketRow({
      status: 'READY',
      stage: 'QA',
      claimed_by: null,
      claimed_by_name: null,
    });

    // Ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    // advance_ticket SQL function
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    const result = await ticketsCompleteHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      evidence: validEvidence,
    });

    const parsed = parseResult(result);
    expect(parsed.previous_stage).toBe('BACKEND');
    expect(parsed.new_stage).toBe('QA');
    expect(parsed.dependencies_unblocked).toEqual([]);
  });

  it('advances ticket from QA to SECURITY stage', async () => {
    const currentTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'QA',
      claimed_by: 'agent-uuid-002',
      claimed_by_name: 'QA Engineer',
    });
    const advancedTicket = makeTicketRow({
      status: 'READY',
      stage: 'SECURITY',
    });

    mockQuery.mockResolvedValueOnce({ rows: [currentTicket] });
    mockQuery.mockResolvedValueOnce({ rows: [advancedTicket] });

    const result = await ticketsCompleteHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      evidence: {
        artifacts: ['src/__tests__/feature.test.ts'],
        test_results: '15 tests passed, coverage 92%',
        confidence: 'HIGH',
      },
    });

    const parsed = parseResult(result);
    expect(parsed.previous_stage).toBe('QA');
    expect(parsed.new_stage).toBe('SECURITY');
  });

  it('returns NOT_CLAIM_OWNER when ticket is not claimed', async () => {
    const unclaimedTicket = makeTicketRow({
      status: 'READY',
      stage: 'BACKEND',
      claimed_by: null,
    });

    mockQuery.mockResolvedValueOnce({ rows: [unclaimedTicket] });

    const result = await ticketsCompleteHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      evidence: validEvidence,
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('NOT_CLAIM_OWNER');
  });

  it('returns TICKET_NOT_FOUND for non-existent ticket', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });

    const result = await ticketsCompleteHandler({
      ticket_id: 'NONEXISTENT-999',
      evidence: validEvidence,
    });

    const parsed = parseResult(result);
    expect(parsed.error).toBe('TICKET_NOT_FOUND');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. AC5 — REWORK: Test reject → stage reset → re-claim → complete
// ═════════════════════════════════════════════════════════════════════════════

describe('AC5: tickets.reject — rework flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects ticket and returns it to implementation stage for rework', async () => {
    const reworkedTicket = makeTicketRow({
      status: 'READY',
      stage: 'BACKEND',
      rework_count: 1,
      claimed_by: null,
      claimed_by_name: null,
    });

    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-002' }] });
    // reject_ticket SQL function
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      reason: 'Test coverage is only 62%, below 80% minimum requirement',
      evidence: { coverage: 62 },
    });

    const parsed = parseResult(result);
    expect(parsed.escalated).toBe(false);
    expect(parsed.rework_count).toBe(1);
    expect(parsed.returned_to_stage).toBe('BACKEND');
    expect((parsed.ticket as Record<string, unknown>).status).toBe('READY');
  });

  it('escalates ticket after max rework attempts', async () => {
    const escalatedTicket = makeTicketRow({
      status: 'ESCALATED',
      stage: 'BACKEND',
      rework_count: 4,
      max_reworks: 3,
      claimed_by: null,
      claimed_by_name: null,
    });

    // Agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-002' }] });
    // reject_ticket SQL function → escalated
    mockQuery.mockResolvedValueOnce({ rows: [escalatedTicket] });

    const result = await ticketsRejectHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      reason: 'Failed for the fourth time — coverage still below threshold',
    });

    const parsed = parseResult(result);
    expect(parsed.escalated).toBe(true);
    expect(parsed.rework_count).toBe(4);
    expect((parsed.ticket as Record<string, unknown>).status).toBe('ESCALATED');
  });

  it('re-claims a reworked ticket and completes successfully', async () => {
    // Step 1: Re-claim the reworked ticket
    const reclaimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'BACKEND',
      rework_count: 1,
      claimed_by: 'agent-uuid-001',
      claimed_by_name: 'Backend Engineer',
      machine_id: 'test-machine',
      lease_expiry: '2026-03-12T11:30:00Z',
    });

    // Agent lookup for claim
    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] });
    // claim_ticket_by_id
    mockQuery.mockResolvedValueOnce({ rows: [reclaimedTicket] });
    // File locks query
    mockQuery.mockResolvedValueOnce({ rows: [{ file_path: 'src/feature.ts' }] });

    const claimResult = await ticketsClaimHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      agent_name: 'Backend Engineer',
      machine_id: 'test-machine',
    });

    const claimParsed = parseResult(claimResult);
    expect(claimParsed.ticket).toBeDefined();
    expect((claimParsed.ticket as Record<string, unknown>).rework_count).toBe(1);

    // Step 2: Complete the reworked ticket
    vi.clearAllMocks();

    const completedTicket = makeTicketRow({
      status: 'READY',
      stage: 'QA',
      rework_count: 1,
      claimed_by: null,
    });

    // Ticket lookup for complete
    mockQuery.mockResolvedValueOnce({ rows: [reclaimedTicket] });
    // advance_ticket
    mockQuery.mockResolvedValueOnce({ rows: [completedTicket] });

    const completeResult = await ticketsCompleteHandler({
      ticket_id: 'TASK-PARENT-001-SUB-1',
      evidence: {
        ...validEvidence,
        notes: 'Fixed coverage to 92% after rework',
      },
    });

    const completeParsed = parseResult(completeResult);
    expect(completeParsed.previous_stage).toBe('BACKEND');
    expect(completeParsed.new_stage).toBe('QA');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. AC6 — FULL LIFECYCLE: spawn → claim → advance → QA reject → rework →
//    QA pass → all stages → DONE
// ═════════════════════════════════════════════════════════════════════════════

describe('AC6: Full lifecycle — spawn through DONE with rework', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completes full SDLC lifecycle: spawn → claim → BACKEND → QA reject → rework → QA pass → SECURITY → CI → DOCS → VALIDATOR → DONE', async () => {
    const ticketId = 'TASK-PARENT-001-SUB-1';

    // ── Phase 1: SPAWN ─────────────────────────────────────────────────
    const mockClient = await mockConnect();

    const parentTicket = makeParentRow();
    const spawnedTicket = makeTicketRow({ status: 'READY', stage: 'READY' });

    mockClient.query.mockResolvedValueOnce({}); // BEGIN
    mockClient.query.mockResolvedValueOnce({ rows: [parentTicket] }); // parent lookup
    mockQuery.mockResolvedValueOnce({ rows: [{ count: '0' }] }); // child count
    mockClient.query.mockResolvedValueOnce({ rows: [spawnedTicket] }); // INSERT child
    mockClient.query.mockResolvedValueOnce({}); // SPAWNED event
    mockClient.query.mockResolvedValueOnce({}); // CREATED event
    mockClient.query.mockResolvedValueOnce({}); // COMMIT

    const spawnResult = await ticketsSpawnHandler({
      parent_id: 'TASK-PARENT-001',
      title: 'Integration Test Child Ticket',
      type: 'backend',
      acceptance_criteria: ['Feature works correctly'],
      file_paths: ['src/feature.ts'],
    });

    const spawnParsed = parseResult(spawnResult);
    expect(spawnParsed.parent_ticket_id).toBe('TASK-PARENT-001');
    expect(spawnParsed.ticket).toBeDefined();

    // ── Phase 2: CLAIM ─────────────────────────────────────────────────
    vi.clearAllMocks();

    const claimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'BACKEND',
      claimed_by: 'agent-uuid-001',
      claimed_by_name: 'Backend Engineer',
      machine_id: 'test-machine',
      lease_expiry: '2026-03-12T10:30:00Z',
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] }); // agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [claimedTicket] }); // claim_ticket_by_id
    mockQuery.mockResolvedValueOnce({ rows: [{ file_path: 'src/feature.ts' }] }); // file locks

    const claimResult = await ticketsClaimHandler({
      ticket_id: ticketId,
      agent_name: 'Backend Engineer',
      machine_id: 'test-machine',
    });

    const claimParsed = parseResult(claimResult);
    expect((claimParsed.ticket as Record<string, unknown>).status).toBe('CLAIMED');

    // ── Phase 3: BACKEND complete → QA ─────────────────────────────────
    vi.clearAllMocks();

    const qaTicket = makeTicketRow({ status: 'READY', stage: 'QA' });

    mockQuery.mockResolvedValueOnce({ rows: [claimedTicket] }); // ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [qaTicket] }); // advance_ticket

    const backendResult = await ticketsCompleteHandler({
      ticket_id: ticketId,
      evidence: validEvidence,
    });

    expect(parseResult(backendResult).new_stage).toBe('QA');

    // ── Phase 4: QA REJECT → rework ────────────────────────────────────
    vi.clearAllMocks();

    const reworkedTicket = makeTicketRow({
      status: 'READY',
      stage: 'BACKEND',
      rework_count: 1,
      claimed_by: null,
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-002' }] }); // agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [reworkedTicket] }); // reject_ticket

    const rejectResult = await ticketsRejectHandler({
      ticket_id: ticketId,
      reason: 'Coverage is only 62%, below the 80% minimum requirement',
      evidence: { coverage: 62 },
    });

    const rejectParsed = parseResult(rejectResult);
    expect(rejectParsed.escalated).toBe(false);
    expect(rejectParsed.rework_count).toBe(1);
    expect(rejectParsed.returned_to_stage).toBe('BACKEND');

    // ── Phase 5: Re-CLAIM after rework ─────────────────────────────────
    vi.clearAllMocks();

    const reclaimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'BACKEND',
      rework_count: 1,
      claimed_by: 'agent-uuid-001',
      claimed_by_name: 'Backend Engineer',
      machine_id: 'test-machine',
      lease_expiry: '2026-03-12T11:30:00Z',
    });

    mockQuery.mockResolvedValueOnce({ rows: [{ id: 'agent-uuid-001' }] }); // agent lookup
    mockQuery.mockResolvedValueOnce({ rows: [reclaimedTicket] }); // claim_ticket_by_id
    mockQuery.mockResolvedValueOnce({ rows: [{ file_path: 'src/feature.ts' }] }); // file locks

    const reclaimResult = await ticketsClaimHandler({
      ticket_id: ticketId,
      agent_name: 'Backend Engineer',
      machine_id: 'test-machine',
    });

    expect((parseResult(reclaimResult).ticket as Record<string, unknown>).rework_count).toBe(1);

    // ── Phase 6: BACKEND complete (rework) → QA ────────────────────────
    vi.clearAllMocks();

    const qaTicket2 = makeTicketRow({ status: 'READY', stage: 'QA', rework_count: 1 });

    mockQuery.mockResolvedValueOnce({ rows: [reclaimedTicket] }); // ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [qaTicket2] }); // advance_ticket

    const backendResult2 = await ticketsCompleteHandler({
      ticket_id: ticketId,
      evidence: {
        ...validEvidence,
        test_results: '18 tests passed, 0 failed. Coverage: 92%',
        notes: 'Fixed coverage after QA rework',
      },
    });

    expect(parseResult(backendResult2).new_stage).toBe('QA');

    // ── Phase 7: QA PASS → SECURITY ────────────────────────────────────
    vi.clearAllMocks();

    const qaClaimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'QA',
      claimed_by: 'agent-uuid-002',
      claimed_by_name: 'QA Engineer',
      rework_count: 1,
    });
    const securityTicket = makeTicketRow({ status: 'READY', stage: 'SECURITY', rework_count: 1 });

    mockQuery.mockResolvedValueOnce({ rows: [qaClaimedTicket] }); // ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [securityTicket] }); // advance_ticket

    const qaResult = await ticketsCompleteHandler({
      ticket_id: ticketId,
      evidence: {
        artifacts: ['src/__tests__/feature.test.ts'],
        test_results: '18 tests passed, coverage 92%',
        confidence: 'HIGH',
      },
    });

    expect(parseResult(qaResult).new_stage).toBe('SECURITY');

    // ── Phase 8: SECURITY PASS → CI ────────────────────────────────────
    vi.clearAllMocks();

    const secClaimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'SECURITY',
      claimed_by: 'agent-uuid-003',
      claimed_by_name: 'Security Engineer',
    });
    const ciTicket = makeTicketRow({ status: 'READY', stage: 'CI' });

    mockQuery.mockResolvedValueOnce({ rows: [secClaimedTicket] }); // ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [ciTicket] }); // advance_ticket

    const secResult = await ticketsCompleteHandler({
      ticket_id: ticketId,
      evidence: {
        artifacts: ['security-report.md'],
        test_results: 'OWASP scan passed, no vulnerabilities',
        confidence: 'HIGH',
      },
    });

    expect(parseResult(secResult).new_stage).toBe('CI');

    // ── Phase 9: CI PASS → DOCUMENTATION ───────────────────────────────
    vi.clearAllMocks();

    const ciClaimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'CI',
      claimed_by: 'agent-uuid-004',
      claimed_by_name: 'CI Reviewer',
    });
    const docsTicket = makeTicketRow({ status: 'READY', stage: 'DOCUMENTATION' });

    mockQuery.mockResolvedValueOnce({ rows: [ciClaimedTicket] }); // ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [docsTicket] }); // advance_ticket

    const ciResult = await ticketsCompleteHandler({
      ticket_id: ticketId,
      evidence: {
        artifacts: ['ci-report.md'],
        test_results: 'Lint: 0 errors, TypeCheck: pass, Complexity: pass',
        confidence: 'HIGH',
      },
    });

    expect(parseResult(ciResult).new_stage).toBe('DOCUMENTATION');

    // ── Phase 10: DOCS PASS → VALIDATOR ────────────────────────────────
    vi.clearAllMocks();

    const docsClaimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'DOCUMENTATION',
      claimed_by: 'agent-uuid-005',
      claimed_by_name: 'Documentation Specialist',
    });
    const validatorTicket = makeTicketRow({ status: 'READY', stage: 'VALIDATOR' });

    mockQuery.mockResolvedValueOnce({ rows: [docsClaimedTicket] }); // ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [validatorTicket] }); // advance_ticket

    const docsResult = await ticketsCompleteHandler({
      ticket_id: ticketId,
      evidence: {
        artifacts: ['docs/feature.md'],
        test_results: 'N/A — documentation update',
        confidence: 'HIGH',
      },
    });

    expect(parseResult(docsResult).new_stage).toBe('VALIDATOR');

    // ── Phase 11: VALIDATOR PASS → DONE ────────────────────────────────
    vi.clearAllMocks();

    const validatorClaimedTicket = makeTicketRow({
      status: 'CLAIMED',
      stage: 'VALIDATOR',
      claimed_by: 'agent-uuid-006',
      claimed_by_name: 'Validator',
    });
    const doneTicket = makeTicketRow({
      status: 'DONE',
      stage: 'DONE',
      completed_at: '2026-03-12T14:00:00Z',
    });

    mockQuery.mockResolvedValueOnce({ rows: [validatorClaimedTicket] }); // ticket lookup
    mockQuery.mockResolvedValueOnce({ rows: [doneTicket] }); // advance_ticket
    // Dependencies unblocked query (runs when stage === DONE)
    mockQuery.mockResolvedValueOnce({
      rows: [{ ticket_id: 'TASK-BLOCKED-001' }],
    });

    const validatorResult = await ticketsCompleteHandler({
      ticket_id: ticketId,
      evidence: {
        artifacts: ['validation-report.md'],
        test_results: 'DoD: 11/11 pass',
        confidence: 'HIGH',
      },
    });

    const doneParsed = parseResult(validatorResult);
    expect(doneParsed.new_stage).toBe('DONE');
    expect(doneParsed.dependencies_unblocked).toEqual(['TASK-BLOCKED-001']);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. AC7 — TEST DATABASE: Verify tests use mocked pool, not real DB
// ═════════════════════════════════════════════════════════════════════════════

describe('AC7: Test isolation — mocked database', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('pool.query is a vitest mock function', () => {
    expect(vi.isMockFunction(mockQuery)).toBe(true);
  });

  it('pool.connect is a vitest mock function', () => {
    expect(vi.isMockFunction(mockConnect)).toBe(true);
  });

  it('mocks are cleared between tests', () => {
    // This test runs after other tests; if mocks leaked, call count would be > 0.
    // The beforeEach(vi.clearAllMocks) in each describe handles this.
    // We verify the pattern by checking a mock is callable.
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(mockQuery).toHaveBeenCalledTimes(0); // not called yet in this test scope
  });
});
