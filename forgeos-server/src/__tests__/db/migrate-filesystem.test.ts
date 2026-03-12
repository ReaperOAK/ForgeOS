/**
 * Filesystem-to-PostgreSQL migration script tests.
 *
 * Unit tests with fixture data for the one-time migration script.
 * Mocks the database pool and filesystem to verify ticket parsing,
 * stage derivation, event reconstruction, idempotency, and error handling.
 *
 * @module __tests__/db/migrate-filesystem
 * @ticket TASK-INT-BE017
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'node:path';

// ── Mock dependencies before any imports ─────────────────────────────────────

const mockQuery = vi.fn();

vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn(() => ({
    query: mockQuery,
  })),
  closePool: vi.fn(),
}));

vi.mock('../../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../db/seed.js', () => ({
  seed: vi.fn(),
}));

vi.mock('../../db/migrate.js', () => ({
  runMigrations: vi.fn(),
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

// ── Fixture Data ─────────────────────────────────────────────────────────────

const WORKSPACE = '/test/workspace';
const PROJECT_ID = '22222222-2222-2222-2222-222222222222';
const TICKETS_DIR = path.join(WORKSPACE, '.github', 'tickets');
const STATE_DIR = path.join(WORKSPACE, '.github', 'ticket-state');

/** Create a valid ticket JSON fixture with optional overrides. */
function makeTicketFixture(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    ticket_id: 'TASK-TEST-001',
    title: 'Test Ticket Alpha',
    description: 'A test ticket for migration validation',
    type: 'backend',
    priority: 'high',
    stage: 'BACKEND',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'],
    created_at: '2026-03-01T00:00:00.000Z',
    dependencies: ['TASK-TEST-000'],
    blocked_by: [],
    file_paths: ['src/feature.ts', 'src/feature.test.ts'],
    acceptance_criteria: ['Feature works', 'Tests pass'],
    rework_count: 0,
    claimed_by: null,
    machine_id: null,
    operator: null,
    lease_expiry: null,
    lease_duration_minutes: 30,
    completed_at: null,
    history: [
      {
        timestamp: '2026-03-01T00:00:00.000Z',
        event: 'CREATED',
        agent: 'TODO',
        machine_id: 'system',
        details: 'Ticket created from task file',
      },
      {
        timestamp: '2026-03-02T10:00:00.000Z',
        event: 'MOVED_TO_READY',
        agent: 'tickets.py',
        machine_id: 'system',
        details: 'Dependencies resolved, moved to READY',
      },
    ],
    source_task_file: 'TODO/tasks/test.md',
    tags: ['backend', 'test'],
    ...overrides,
  });
}

/** Create a completed ticket fixture (in DONE stage). */
function makeDoneTicketFixture(): string {
  return makeTicketFixture({
    ticket_id: 'TASK-TEST-002',
    title: 'Completed Ticket',
    stage: 'DONE',
    completed_at: '2026-03-05T12:00:00.000Z',
    history: [
      {
        timestamp: '2026-03-01T00:00:00.000Z',
        event: 'CREATED',
        agent: 'TODO',
        machine_id: 'system',
        details: 'Ticket created',
      },
      {
        timestamp: '2026-03-05T12:00:00.000Z',
        event: 'STAGE_COMPLETED',
        agent: 'Validator',
        machine_id: 'pop-os',
        from_stage: 'VALIDATION',
        to_stage: 'DONE',
        details: 'Advanced from VALIDATION to DONE',
      },
    ],
  });
}

/** Create a ticket with no history (tests synthetic event creation). */
function makeNoHistoryFixture(): string {
  return makeTicketFixture({
    ticket_id: 'TASK-TEST-003',
    title: 'No History Ticket',
    history: [],
  });
}

// ── Setup helpers ────────────────────────────────────────────────────────────

function clearMockFs(): void {
  Object.keys(mockFiles).forEach((k) => delete mockFiles[k]);
  Object.keys(mockDirs).forEach((k) => delete mockDirs[k]);
  Object.keys(mockExistsSync).forEach((k) => delete mockExistsSync[k]);
}

function setupBasicFilesystem(tickets: Record<string, string>, stageMap: Record<string, string>): void {
  // Tickets directory
  mockExistsSync[TICKETS_DIR] = true;
  const ticketFiles = Object.keys(tickets).map((id) => `${id}.json`);
  mockDirs[TICKETS_DIR] = ticketFiles;

  for (const [id, json] of Object.entries(tickets)) {
    mockFiles[path.join(TICKETS_DIR, `${id}.json`)] = json;
  }

  // State directories
  for (const stage of ['READY', 'ARCHITECT', 'RESEARCH', 'BACKEND', 'FRONTEND',
    'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE']) {
    const stageDir = path.join(STATE_DIR, stage);
    const ticketsInStage = Object.entries(stageMap)
      .filter(([, s]) => s === stage)
      .map(([id]) => `${id}.json`);

    mockExistsSync[stageDir] = true;
    mockDirs[stageDir] = ticketsInStage;

    for (const [id, s] of Object.entries(stageMap)) {
      const filePath = path.join(STATE_DIR, s, `${id}.json`);
      mockExistsSync[filePath] = s === stage;
    }
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Import module under test AFTER mocks are set up
// ═════════════════════════════════════════════════════════════════════════════

import {
  migrateTickets,
  deriveStageFromFilesystem,
  mapSdlcFlow,
  mapHistoryEvent,
  deriveStatus,
} from '../../../scripts/migrate-filesystem.js';

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe('migrate-filesystem.ts', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    clearMockFs();
  });

  afterEach(() => {
    stdoutSpy.mockRestore();
    vi.restoreAllMocks();
  });

  // ── deriveStageFromFilesystem ────────────────────────────────────────────

  describe('deriveStageFromFilesystem', () => {
    it('returns stage from filesystem directory when ticket exists there', () => {
      mockExistsSync[path.join(STATE_DIR, 'BACKEND', 'T-001.json')] = true;
      expect(deriveStageFromFilesystem('T-001', WORKSPACE, 'READY')).toBe('BACKEND');
    });

    it('maps DOCS directory to DOCUMENTATION stage', () => {
      mockExistsSync[path.join(STATE_DIR, 'DOCS', 'T-002.json')] = true;
      expect(deriveStageFromFilesystem('T-002', WORKSPACE, 'READY')).toBe('DOCUMENTATION');
    });

    it('maps VALIDATION directory to VALIDATOR stage', () => {
      mockExistsSync[path.join(STATE_DIR, 'VALIDATION', 'T-003.json')] = true;
      expect(deriveStageFromFilesystem('T-003', WORKSPACE, 'READY')).toBe('VALIDATOR');
    });

    it('falls back to JSON stage when not found in any directory', () => {
      expect(deriveStageFromFilesystem('T-004', WORKSPACE, 'QA')).toBe('QA');
    });

    it('returns READY when both filesystem and JSON stage are unknown', () => {
      expect(deriveStageFromFilesystem('T-005', WORKSPACE, 'UNKNOWN_STAGE')).toBe('READY');
    });
  });

  // ── mapSdlcFlow ─────────────────────────────────────────────────────────

  describe('mapSdlcFlow', () => {
    it('maps all stages in a valid backend flow', () => {
      const input = ['READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE'];
      const result = mapSdlcFlow(input, 'backend');
      expect(result).toEqual([
        'READY', 'BACKEND', 'QA', 'SECURITY', 'CI', 'DOCUMENTATION', 'VALIDATOR', 'DONE',
      ]);
    });

    it('maps DOCS to DOCUMENTATION and VALIDATION to VALIDATOR', () => {
      const result = mapSdlcFlow(['DOCS', 'VALIDATION'], 'backend');
      expect(result).toEqual(['DOCUMENTATION', 'VALIDATOR']);
    });

    it('falls back to canonical flow for known types when mapping fails', () => {
      const result = mapSdlcFlow(['UNKNOWN1', 'UNKNOWN2'], 'backend');
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toBe('READY');
    });

    it('returns [READY, DONE] for completely unmappable flow and unknown type', () => {
      const result = mapSdlcFlow(['X', 'Y'], 'nonexistent_type');
      expect(result).toEqual(['READY', 'DONE']);
    });
  });

  // ── mapHistoryEvent ──────────────────────────────────────────────────────

  describe('mapHistoryEvent', () => {
    it('maps CREATED to CREATED', () => {
      expect(mapHistoryEvent('CREATED')).toBe('CREATED');
    });

    it('maps STAGE_COMPLETED to STAGE_ADVANCED', () => {
      expect(mapHistoryEvent('STAGE_COMPLETED')).toBe('STAGE_ADVANCED');
    });

    it('maps MOVED_TO_READY to UPDATED', () => {
      expect(mapHistoryEvent('MOVED_TO_READY')).toBe('UPDATED');
    });

    it('maps BACKEND_COMPLETE to STAGE_ADVANCED', () => {
      expect(mapHistoryEvent('BACKEND_COMPLETE')).toBe('STAGE_ADVANCED');
    });

    it('maps unknown events to UPDATED', () => {
      expect(mapHistoryEvent('SOME_CUSTOM_EVENT')).toBe('UPDATED');
    });
  });

  // ── deriveStatus ────────────────────────────────────────────────────────

  describe('deriveStatus', () => {
    it('returns DONE for DONE stage', () => {
      expect(deriveStatus('DONE', false)).toBe('DONE');
    });

    it('returns CLAIMED when ticket has an active claim', () => {
      expect(deriveStatus('BACKEND', true)).toBe('CLAIMED');
    });

    it('returns READY for unclaimed non-DONE tickets', () => {
      expect(deriveStatus('QA', false)).toBe('READY');
    });
  });

  // ── migrateTickets ──────────────────────────────────────────────────────

  describe('migrateTickets', () => {
    it('throws when tickets directory does not exist', async () => {
      mockExistsSync[TICKETS_DIR] = false;
      await expect(migrateTickets(WORKSPACE, PROJECT_ID)).rejects.toThrow(
        'Tickets directory not found',
      );
    });

    it('returns zero stats when tickets directory is empty', async () => {
      mockExistsSync[TICKETS_DIR] = true;
      mockDirs[TICKETS_DIR] = [];

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats).toEqual({ total: 0, migrated: 0, skipped: 0, errors: [] });
    });

    it('migrates a single valid ticket with history', async () => {
      setupBasicFilesystem(
        { 'TASK-TEST-001': makeTicketFixture() },
        { 'TASK-TEST-001': 'BACKEND' },
      );

      // No existing ticket in DB
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT check
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ticket
      // History events: 2 entries, each needs SELECT + INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event 1 SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event 1 INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event 2 SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event 2 INSERT

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.total).toBe(1);
      expect(stats.migrated).toBe(1);
      expect(stats.skipped).toBe(0);
      expect(stats.errors).toEqual([]);
    });

    it('skips tickets that already exist in the database', async () => {
      setupBasicFilesystem(
        { 'TASK-TEST-001': makeTicketFixture() },
        { 'TASK-TEST-001': 'BACKEND' },
      );

      // Ticket already exists in DB
      mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }], rowCount: 1 });

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.total).toBe(1);
      expect(stats.migrated).toBe(0);
      expect(stats.skipped).toBe(1);
      expect(stats.errors).toEqual([]);
    });

    it('handles multiple tickets with mixed existing/new', async () => {
      setupBasicFilesystem(
        {
          'TASK-TEST-001': makeTicketFixture(),
          'TASK-TEST-002': makeDoneTicketFixture(),
        },
        {
          'TASK-TEST-001': 'BACKEND',
          'TASK-TEST-002': 'DONE',
        },
      );

      // First ticket: already exists
      mockQuery.mockResolvedValueOnce({ rows: [{ 1: 1 }], rowCount: 1 });

      // Second ticket: new
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT check
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ticket
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.total).toBe(2);
      expect(stats.migrated).toBe(1);
      expect(stats.skipped).toBe(1);
    });

    it('records error for malformed JSON and continues', async () => {
      setupBasicFilesystem(
        {
          'BAD-TICKET': '{ invalid json !!!',
          'TASK-TEST-001': makeTicketFixture(),
        },
        { 'TASK-TEST-001': 'READY' },
      );

      // Good ticket: new
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT check
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ticket
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.total).toBe(2);
      expect(stats.migrated).toBe(1);
      expect(stats.errors.length).toBe(1);
      expect(stats.errors[0]).toContain('BAD-TICKET');
    });

    it('skips tickets with missing required fields', async () => {
      const incompleteTicket = JSON.stringify({ ticket_id: 'T-INCOMPLETE' });
      setupBasicFilesystem(
        { 'T-INCOMPLETE': incompleteTicket },
        {},
      );

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.total).toBe(1);
      expect(stats.migrated).toBe(0);
      expect(stats.errors.length).toBe(1);
      expect(stats.errors[0]).toContain('Missing required fields');
    });

    it('skips tickets with invalid type', async () => {
      const badTypeTicket = makeTicketFixture({
        ticket_id: 'T-BAD-TYPE',
        type: 'nonexistent_type',
      });
      setupBasicFilesystem(
        { 'T-BAD-TYPE': badTypeTicket },
        {},
      );

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.total).toBe(1);
      expect(stats.migrated).toBe(0);
      expect(stats.errors.length).toBe(1);
      expect(stats.errors[0]).toContain("Invalid ticket type");
    });

    it('records DB insert errors without crashing', async () => {
      setupBasicFilesystem(
        { 'TASK-TEST-001': makeTicketFixture() },
        { 'TASK-TEST-001': 'BACKEND' },
      );

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT check
      mockQuery.mockRejectedValueOnce(new Error('duplicate key violation')); // INSERT fails

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.total).toBe(1);
      expect(stats.migrated).toBe(0);
      expect(stats.errors.length).toBe(1);
      expect(stats.errors[0]).toContain('duplicate key violation');
    });

    it('excludes ticket-schema.json from migration', async () => {
      mockExistsSync[TICKETS_DIR] = true;
      mockDirs[TICKETS_DIR] = ['ticket-schema.json', 'TASK-TEST-001.json'];
      mockFiles[path.join(TICKETS_DIR, 'TASK-TEST-001.json')] = makeTicketFixture();

      // Set up state directory
      for (const stage of ['READY', 'ARCHITECT', 'RESEARCH', 'BACKEND', 'FRONTEND',
        'QA', 'SECURITY', 'CI', 'DOCS', 'VALIDATION', 'DONE']) {
        mockExistsSync[path.join(STATE_DIR, stage)] = true;
        mockDirs[path.join(STATE_DIR, stage)] = [];
      }

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT check
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ticket
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      // Only 1 ticket, not 2 (schema file excluded)
      expect(stats.total).toBe(1);
      expect(stats.migrated).toBe(1);
    });

    it('normalizes invalid priority to medium', async () => {
      const badPriority = makeTicketFixture({
        ticket_id: 'T-BAD-PRIO',
        priority: 'ultra-critical',
      });
      setupBasicFilesystem(
        { 'T-BAD-PRIO': badPriority },
        { 'T-BAD-PRIO': 'READY' },
      );

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT check
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ticket
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.migrated).toBe(1);

      // Check the INSERT query was called with 'medium' as priority (param index 5)
      const insertCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO tickets'),
      );
      expect(insertCall).toBeDefined();
      expect(insertCall![1][5]).toBe('medium');
    });
  });

  // ── Dry-run mode ────────────────────────────────────────────────────────

  describe('dry-run mode', () => {
    it('previews changes without database writes', async () => {
      setupBasicFilesystem(
        { 'TASK-TEST-001': makeTicketFixture() },
        { 'TASK-TEST-001': 'BACKEND' },
      );

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID, true);

      expect(stats.total).toBe(1);
      expect(stats.migrated).toBe(1);
      expect(stats.skipped).toBe(0);
      expect(stats.errors).toEqual([]);

      // No database queries should have been made
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('still reports errors for malformed JSON in dry-run', async () => {
      setupBasicFilesystem(
        { 'BAD-TICKET': '{ not json' },
        {},
      );

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID, true);
      expect(stats.total).toBe(1);
      expect(stats.errors.length).toBe(1);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('prints dry-run preview for each ticket', async () => {
      setupBasicFilesystem(
        {
          'TASK-TEST-001': makeTicketFixture(),
          'TASK-TEST-002': makeDoneTicketFixture(),
        },
        {
          'TASK-TEST-001': 'BACKEND',
          'TASK-TEST-002': 'DONE',
        },
      );

      await migrateTickets(WORKSPACE, PROJECT_ID, true);

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('[DRY-RUN]');
      expect(output).toContain('TASK-TEST-001');
      expect(output).toContain('TASK-TEST-002');
    });
  });

  // ── Depends_on preservation ─────────────────────────────────────────────

  describe('dependency preservation', () => {
    it('passes depends_on array to the INSERT query', async () => {
      const ticketWithDeps = makeTicketFixture({
        ticket_id: 'T-DEPS',
        dependencies: ['DEP-001', 'DEP-002', 'DEP-003'],
      });
      setupBasicFilesystem(
        { 'T-DEPS': ticketWithDeps },
        { 'T-DEPS': 'READY' },
      );

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT check
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ticket
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // event SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // event INSERT

      await migrateTickets(WORKSPACE, PROJECT_ID);

      const insertCall = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO tickets'),
      );
      expect(insertCall).toBeDefined();
      // depends_on is at index 14 in the params array
      expect(insertCall![1][14]).toEqual(['DEP-001', 'DEP-002', 'DEP-003']);
    });
  });

  // ── Synthetic events ────────────────────────────────────────────────────

  describe('synthetic event creation', () => {
    it('creates synthetic events for tickets with no history', async () => {
      setupBasicFilesystem(
        { 'TASK-TEST-003': makeNoHistoryFixture() },
        { 'TASK-TEST-003': 'BACKEND' },
      );

      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT ticket exists
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // INSERT ticket
      // Synthetic events: CREATED check + insert, STAGE_ADVANCED check + insert
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // CREATED SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // CREATED INSERT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // STAGE_ADVANCED SELECT
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 }); // STAGE_ADVANCED INSERT

      const stats = await migrateTickets(WORKSPACE, PROJECT_ID);
      expect(stats.migrated).toBe(1);

      // Verify synthetic CREATED event — 'migration' appears in the SQL text as agent_name
      const createdEventQuery = mockQuery.mock.calls.find(
        (call) => typeof call[0] === 'string' &&
          call[0].includes('INSERT INTO events') &&
          call[0].includes('migration'),
      );
      expect(createdEventQuery).toBeDefined();
    });
  });
});
