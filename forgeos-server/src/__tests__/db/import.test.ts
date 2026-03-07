/**
 * Import Tool Tests — TASK-FOS-01-003
 *
 * Unit tests for the filesystem ticket import tool. Mocks the database
 * and filesystem to verify ticket parsing, stage derivation, event
 * import, and idempotency.
 *
 * @module __tests__/db/import
 * @ticket TASK-FOS-01-003
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// ── Mock dependencies before any imports ─────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn(() => ({
    query: mockQuery,
  })),
}));

vi.mock('../../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Filesystem mock ──────────────────────────────────────────────────────────

const mockFiles: Record<string, string> = {};
const mockDirs: Record<string, string[]> = {};
const mockExistsSync: Record<string, boolean> = {};

vi.mock('node:fs', () => ({
  default: {
    existsSync: vi.fn((p: string) => mockExistsSync[p] ?? false),
    readdirSync: vi.fn((p: string) => mockDirs[p] ?? []),
    readFileSync: vi.fn((p: string) => {
      if (mockFiles[p]) return mockFiles[p];
      throw new Error(`ENOENT: no such file: ${p}`);
    }),
  },
  existsSync: vi.fn((p: string) => mockExistsSync[p] ?? false),
  readdirSync: vi.fn((p: string) => mockDirs[p] ?? []),
  readFileSync: vi.fn((p: string) => {
    if (mockFiles[p]) return mockFiles[p];
    throw new Error(`ENOENT: no such file: ${p}`);
  }),
}));

// ── Test Data ────────────────────────────────────────────────────────────────

const WORKSPACE = '/test/workspace';
const PROJECT_ID = '11111111-1111-1111-1111-111111111111';
const TICKETS_DIR = path.join(WORKSPACE, '.github', 'tickets');
const STATE_DIR = path.join(WORKSPACE, '.github', 'ticket-state');

function makeTicketJson(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ticket_id: 'TASK-TEST-001',
    title: 'Test Ticket',
    description: 'A test ticket',
    type: 'backend',
    priority: 'medium',
    stage: 'READY',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
    created_at: '2026-03-01T00:00:00.000Z',
    dependencies: [],
    blocked_by: [],
    file_paths: ['src/test.ts'],
    acceptance_criteria: ['Tests pass'],
    rework_count: 0,
    claimed_by: null,
    machine_id: null,
    operator: null,
    lease_expiry: null,
    lease_duration_minutes: 30,
    history: [
      {
        timestamp: '2026-03-01T00:00:00.000Z',
        event: 'CREATED',
        agent: 'TODO',
        machine_id: 'system',
        details: 'Ticket created',
      },
    ],
    source_task_file: 'TODO/tasks/test.md',
    tags: [],
    ...overrides,
  });
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Import — import.ts', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let stdoutSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);

    // Clear mock filesystem
    Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
    Object.keys(mockDirs).forEach((k) => delete mockDirs[k]);
    Object.keys(mockExistsSync).forEach((k) => delete mockExistsSync[k]);
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function importModule() {
    return import('../../db/import.js');
  }

  function setupFilesystem(ticketFiles: Record<string, string>, stageMap: Record<string, string[]> = {}) {
    // Tickets directory exists
    mockExistsSync[TICKETS_DIR] = true;

    // Ticket files
    const fileNames = Object.keys(ticketFiles);
    mockDirs[TICKETS_DIR] = fileNames;
    for (const [name, content] of Object.entries(ticketFiles)) {
      mockFiles[path.join(TICKETS_DIR, name)] = content;
    }

    // Stage directories
    for (const stage of ['READY', 'ARCHITECT', 'RESEARCH', 'BACKEND', 'FRONTEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE']) {
      const dirPath = path.join(STATE_DIR, stage);
      const tickets = stageMap[stage] ?? [];
      for (const ticketId of tickets) {
        mockExistsSync[path.join(dirPath, `${ticketId}.json`)] = true;
      }
    }
  }

  describe('importTickets()', () => {
    it('should read all .json files excluding ticket-schema.json', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson(),
        'ticket-schema.json': '{}',
        'TASK-TEST-002.json': makeTicketJson({ ticket_id: 'TASK-TEST-002', title: 'Second Ticket' }),
      }, {
        READY: ['TASK-TEST-001', 'TASK-TEST-002'],
      });

      // Mock successful inserts (ticket + event check + event insert for each)
      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      const summary = await importTickets(WORKSPACE, PROJECT_ID);

      expect(summary.success).toBe(2);
      expect(summary.errors).toBe(0);
      expect(summary.skipped).toBe(0);
    });

    it('should derive current stage from .github/ticket-state/ directory location', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson({ stage: 'READY' }),
      }, {
        BACKEND: ['TASK-TEST-001'], // Actual directory location overrides JSON stage
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      // Verify the ticket insert used BACKEND stage, not READY
      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('INSERT INTO tickets');
      // $8 is the stage parameter
      expect(insertCall[1][7]).toBe('BACKEND');
    });

    it('should map DOCS directory to DOCUMENTATION stage', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson({ stage: 'DOCS' }),
      }, {
        DOCS: ['TASK-TEST-001'],
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[1][7]).toBe('DOCUMENTATION');
    });

    it('should map VALIDATION directory to VALIDATOR stage', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson({ stage: 'VALIDATION' }),
      }, {
        VALIDATION: ['TASK-TEST-001'],
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[1][7]).toBe('VALIDATOR');
    });

    it('should use ON CONFLICT (ticket_id) DO UPDATE for idempotency', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson(),
      }, {
        READY: ['TASK-TEST-001'],
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      const insertCall = mockQuery.mock.calls[0];
      expect(insertCall[0]).toContain('ON CONFLICT (ticket_id) DO UPDATE');
    });

    it('should preserve history array as events in the events table', async () => {
      const ticketJson = makeTicketJson({
        history: [
          {
            timestamp: '2026-03-01T00:00:00.000Z',
            event: 'CREATED',
            agent: 'TODO',
            machine_id: 'system',
            details: 'Ticket created',
          },
          {
            timestamp: '2026-03-01T01:00:00.000Z',
            event: 'STAGE_COMPLETED',
            agent: 'Backend',
            machine_id: 'pop-os',
            details: 'Advanced from READY to BACKEND',
            from_stage: 'READY',
            to_stage: 'BACKEND',
          },
        ],
      });

      setupFilesystem({
        'TASK-TEST-001.json': ticketJson,
      }, {
        READY: ['TASK-TEST-001'],
      });

      // First call: ticket insert, subsequent: event checks + inserts
      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      // Should have: 1 ticket insert + 2 event check + 2 event insert = 5 queries
      // Event checks return empty (no existing events), so events get inserted
      expect(mockQuery.mock.calls.length).toBeGreaterThanOrEqual(3);

      // Find the event insert calls (contain INSERT INTO events)
      const eventInserts = mockQuery.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO events'),
      );
      expect(eventInserts.length).toBeGreaterThanOrEqual(2);
    });

    it('should skip events that already exist (idempotent event import)', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson(),
      }, {
        READY: ['TASK-TEST-001'],
      });

      // Ticket insert succeeds
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // Event check returns existing event
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'existing-event-id' }] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      // Should have: 1 ticket insert + 1 event check = 2 queries
      // No event insert because it already exists
      const eventInserts = mockQuery.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO events') && !call[0].includes('SELECT'),
      );
      expect(eventInserts.length).toBe(0);
    });

    it('should produce a summary with success, errors, and skipped counts', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson(),
        'TASK-TEST-002.json': makeTicketJson({ ticket_id: 'TASK-TEST-002' }),
      }, {
        READY: ['TASK-TEST-001', 'TASK-TEST-002'],
      });

      // First ticket succeeds, second ticket fails
      mockQuery.mockResolvedValueOnce({ rows: [] }); // ticket 1 insert
      mockQuery.mockResolvedValueOnce({ rows: [] }); // ticket 1 event check
      mockQuery.mockResolvedValueOnce({ rows: [] }); // ticket 1 event insert
      mockQuery.mockRejectedValueOnce(new Error('DB error')); // ticket 2 fails

      const { importTickets } = await importModule();
      const summary = await importTickets(WORKSPACE, PROJECT_ID);

      expect(summary.success).toBe(1);
      expect(summary.errors).toBe(1);
    });

    it('should print summary to stdout', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson(),
      }, {
        READY: ['TASK-TEST-001'],
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      const summaryOutput = stdoutSpy.mock.calls.find(
        (call: unknown[]) => typeof call[0] === 'string' && (call[0] as string).includes('Import Summary'),
      );
      expect(summaryOutput).toBeDefined();
      expect(summaryOutput![0]).toContain('Success:');
      expect(summaryOutput![0]).toContain('Errors:');
      expect(summaryOutput![0]).toContain('Skipped:');
    });

    it('should skip tickets with missing required fields', async () => {
      setupFilesystem({
        'TASK-INVALID.json': JSON.stringify({ title: 'No ticket_id' }),
      });

      const { importTickets } = await importModule();
      const summary = await importTickets(WORKSPACE, PROJECT_ID);

      expect(summary.skipped).toBe(1);
      expect(summary.success).toBe(0);
    });

    it('should skip tickets with invalid type', async () => {
      setupFilesystem({
        'TASK-BAD-TYPE.json': makeTicketJson({ ticket_id: 'TASK-BAD-TYPE', type: 'invalid_type' }),
      });

      const { importTickets } = await importModule();
      const summary = await importTickets(WORKSPACE, PROJECT_ID);

      expect(summary.skipped).toBe(1);
    });

    it('should throw when tickets directory does not exist', async () => {
      // Don't set mockExistsSync for TICKETS_DIR

      const { importTickets } = await importModule();
      await expect(importTickets(WORKSPACE, PROJECT_ID)).rejects.toThrow(
        'Tickets directory not found',
      );
    });

    it('should map SDLC flow from JSON stage names to DB enum values', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson({
          sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
        }),
      }, {
        READY: ['TASK-TEST-001'],
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      const insertCall = mockQuery.mock.calls[0];
      // $9 is the sdlc_flow parameter
      const sdlcFlow = insertCall[1][8] as string[];
      expect(sdlcFlow).toContain('DOCUMENTATION'); // DOCS → DOCUMENTATION
      expect(sdlcFlow).toContain('VALIDATOR');      // VALIDATION → VALIDATOR
      expect(sdlcFlow).not.toContain('DOCS');
      expect(sdlcFlow).not.toContain('VALIDATION');
    });

    it('should map MOVED_TO_READY event to UPDATED event type', async () => {
      const ticketJson = makeTicketJson({
        history: [
          {
            timestamp: '2026-03-01T00:00:00.000Z',
            event: 'MOVED_TO_READY',
            agent: 'tickets.py',
            machine_id: 'system',
            details: 'Dependencies resolved, moved to READY',
          },
        ],
      });

      setupFilesystem({
        'TASK-TEST-001.json': ticketJson,
      }, {
        READY: ['TASK-TEST-001'],
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      // Find the event insert call
      const eventInserts = mockQuery.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO events') && !call[0].includes('SELECT'),
      );
      expect(eventInserts.length).toBeGreaterThanOrEqual(1);
      // The event_type should be 'UPDATED' (mapped from MOVED_TO_READY)
      expect(eventInserts[0][1][1]).toBe('UPDATED');
    });

    it('should derive DONE status for tickets in DONE stage', async () => {
      setupFilesystem({
        'TASK-TEST-001.json': makeTicketJson({ stage: 'DONE' }),
      }, {
        DONE: ['TASK-TEST-001'],
      });

      mockQuery.mockResolvedValue({ rows: [] });

      const { importTickets } = await importModule();
      await importTickets(WORKSPACE, PROJECT_ID);

      const insertCall = mockQuery.mock.calls[0];
      // $7 is the status parameter
      expect(insertCall[1][6]).toBe('DONE');
    });
  });
});
