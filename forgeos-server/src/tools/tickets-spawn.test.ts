/**
 * TDD tests for tickets.spawn MCP tool.
 *
 * Tests cover all acceptance criteria:
 * 1. Schema validation (parent_id, title, type, acceptance_criteria, etc.)
 * 2. INVALID_SUBTASK error when required fields missing/empty
 * 3. TICKET_NOT_FOUND error when parent doesn't exist
 * 4. Child ticket_id generation pattern: {parent_id}-SUB-{sequential_number}
 * 5. Child ticket has parent_id, correct sdlc_flow, inherits project_id
 * 6. READY status when no depends_on; BLOCKED when depends_on present
 * 7. SPAWNED event recorded on parent ticket
 * 8. Returns {ticket, parent_ticket_id} on success
 *
 * @module tools/tickets-spawn.test
 * @ticket TASK-FOS-03-006
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { ticketsSpawnSchema, ticketsSpawnHandler } from './tickets-spawn.js';
import { pool } from '../db/pool.js';
import { SDLC_FLOWS } from '../types/index.js';
import type { TicketsSpawnOutput } from '../types/index.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

/** Parse the JSON string from a CallToolResult. */
function parseResult<T>(result: unknown): T {
  const r = result as { content: Array<{ type: string; text: string }> };
  return JSON.parse(r.content[0]!.text) as T;
}

const PARENT_TICKET_ID = 'TEST-SPAWN-PARENT';
const PARENT_PROJECT_ID_PLACEHOLDER = '00000000-0000-0000-0000-000000000099';

// ── Setup / Teardown ─────────────────────────────────────────────────────────

beforeAll(async () => {
  // Ensure a project exists for FK reference
  await pool.query(
    `INSERT INTO projects (id, name, description)
     VALUES ($1, 'test-spawn-project', 'Test project for spawn')
     ON CONFLICT (id) DO NOTHING`,
    [PARENT_PROJECT_ID_PLACEHOLDER],
  );

  // Insert a parent ticket
  await pool.query(
    `INSERT INTO tickets (ticket_id, project_id, title, type, priority, status, stage, sdlc_flow, acceptance_criteria, file_paths)
     VALUES ($1, $2, 'Parent Ticket', 'backend', 'high', 'CLAIMED', 'BACKEND',
             ARRAY['READY','BACKEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE']::ticket_stage[],
             ARRAY['AC1'], ARRAY['src/parent.ts'])
     ON CONFLICT (ticket_id) DO UPDATE SET
       project_id = EXCLUDED.project_id,
       status = EXCLUDED.status,
       stage = EXCLUDED.stage`,
    [PARENT_TICKET_ID, PARENT_PROJECT_ID_PLACEHOLDER],
  );
});

afterEach(async () => {
  // Clean up child tickets and events
  await pool.query(
    "DELETE FROM events WHERE ticket_id LIKE $1 OR (ticket_id = $2 AND event_type = 'SPAWNED')",
    [`${PARENT_TICKET_ID}-SUB-%`, PARENT_TICKET_ID],
  );
  await pool.query(
    'DELETE FROM tickets WHERE parent_id = $1',
    [PARENT_TICKET_ID],
  );
});

afterAll(async () => {
  // Clean up parent ticket, events, and project
  await pool.query('DELETE FROM events WHERE ticket_id = $1', [PARENT_TICKET_ID]);
  await pool.query('DELETE FROM tickets WHERE ticket_id = $1', [PARENT_TICKET_ID]);
  await pool.query('DELETE FROM projects WHERE id = $1', [PARENT_PROJECT_ID_PLACEHOLDER]);
  await pool.end();
});

// ── Schema Validation Tests ──────────────────────────────────────────────────

describe('ticketsSpawnSchema', () => {
  it('should require parent_id', () => {
    const result = ticketsSpawnSchema.safeParse({
      title: 'Child Ticket',
      type: 'backend',
      acceptance_criteria: ['AC1'],
      file_paths: ['src/child.ts'],
    });
    expect(result.success).toBe(false);
  });

  it('should require title', () => {
    const result = ticketsSpawnSchema.safeParse({
      parent_id: 'PARENT-001',
      type: 'backend',
      acceptance_criteria: ['AC1'],
      file_paths: ['src/child.ts'],
    });
    expect(result.success).toBe(false);
  });

  it('should enforce title max length of 200', () => {
    const result = ticketsSpawnSchema.safeParse({
      parent_id: 'PARENT-001',
      title: 'A'.repeat(201),
      type: 'backend',
      acceptance_criteria: ['AC1'],
      file_paths: ['src/child.ts'],
    });
    expect(result.success).toBe(false);
  });

  it('should require type to be a valid ticket type', () => {
    const result = ticketsSpawnSchema.safeParse({
      parent_id: 'PARENT-001',
      title: 'Child Ticket',
      type: 'invalid_type',
      acceptance_criteria: ['AC1'],
      file_paths: ['src/child.ts'],
    });
    expect(result.success).toBe(false);
  });

  it('should require acceptance_criteria to have at least 1 entry', () => {
    const result = ticketsSpawnSchema.safeParse({
      parent_id: 'PARENT-001',
      title: 'Child Ticket',
      type: 'backend',
      acceptance_criteria: [],
      file_paths: ['src/child.ts'],
    });
    expect(result.success).toBe(false);
  });

  it('should default priority to medium', () => {
    const result = ticketsSpawnSchema.safeParse({
      parent_id: 'PARENT-001',
      title: 'Child Ticket',
      type: 'backend',
      acceptance_criteria: ['AC1'],
      file_paths: ['src/child.ts'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe('medium');
    }
  });

  it('should accept valid complete input', () => {
    const result = ticketsSpawnSchema.safeParse({
      parent_id: 'PARENT-001',
      title: 'Child Ticket',
      type: 'backend',
      priority: 'high',
      acceptance_criteria: ['AC1', 'AC2'],
      file_paths: ['src/child.ts'],
      description: 'A detailed description',
      depends_on: ['DEP-001'],
    });
    expect(result.success).toBe(true);
  });

  it('should allow optional description and depends_on', () => {
    const result = ticketsSpawnSchema.safeParse({
      parent_id: 'PARENT-001',
      title: 'Child Ticket',
      type: 'frontend',
      acceptance_criteria: ['AC1'],
      file_paths: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeUndefined();
      expect(result.data.depends_on).toBeUndefined();
    }
  });
});

// ── Handler Tests ────────────────────────────────────────────────────────────

describe('ticketsSpawnHandler', () => {
  // AC2: Returns INVALID_SUBTASK error if title, type, or acceptance_criteria missing/empty
  describe('INVALID_SUBTASK validation', () => {
    it('should return INVALID_SUBTASK when title is empty after trim', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: '   ',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<{ error: string }>(result);
      expect(parsed.error).toBe('INVALID_SUBTASK');
    });

    it('should return INVALID_SUBTASK when acceptance_criteria is empty', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Valid Title',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: [],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<{ error: string }>(result);
      expect(parsed.error).toBe('INVALID_SUBTASK');
    });
  });

  // AC3: Returns TICKET_NOT_FOUND error if parent ticket doesn't exist
  describe('TICKET_NOT_FOUND validation', () => {
    it('should return TICKET_NOT_FOUND when parent does not exist', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: 'NONEXISTENT-PARENT',
        title: 'Child Ticket',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<{ error: string; message: string }>(result);
      expect(parsed.error).toBe('TICKET_NOT_FOUND');
      expect(parsed.message).toContain('NONEXISTENT-PARENT');
    });
  });

  // AC4: Generated child ticket_id follows pattern: {parent_id}-SUB-{sequential_number}
  describe('child ticket_id generation', () => {
    it('should generate ticket_id with pattern {parent_id}-SUB-1 for first child', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'First Child',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.ticket_id).toBe(`${PARENT_TICKET_ID}-SUB-1`);
    });

    it('should generate sequential ticket_ids for multiple children', async () => {
      // Spawn first child
      await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'First Child',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child1.ts'],
      });

      // Spawn second child
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Second Child',
        type: 'frontend',
        priority: 'low',
        acceptance_criteria: ['AC2'],
        file_paths: ['src/child2.ts'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.ticket_id).toBe(`${PARENT_TICKET_ID}-SUB-2`);
    });
  });

  // AC5: Child ticket has parent_id set, correct sdlc_flow, inherits project_id
  describe('child ticket properties', () => {
    it('should set parent_id on child ticket', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Child with parent_id',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.parent_id).toBe(PARENT_TICKET_ID);
    });

    it('should set correct sdlc_flow based on type', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Frontend Child',
        type: 'frontend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/component.tsx'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.sdlc_flow).toEqual(SDLC_FLOWS['frontend']);
    });

    it('should inherit project_id from parent', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Child inheriting project',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.project_id).toBe(PARENT_PROJECT_ID_PLACEHOLDER);
    });

    it('should set child title, type, priority, acceptance_criteria, and file_paths', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Detailed Child',
        type: 'infra',
        priority: 'critical',
        acceptance_criteria: ['AC1', 'AC2', 'AC3'],
        file_paths: ['infra/config.yml', 'infra/deploy.sh'],
        description: 'Infrastructure child ticket',
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.title).toBe('Detailed Child');
      expect(parsed.ticket.type).toBe('infra');
      expect(parsed.ticket.priority).toBe('critical');
      expect(parsed.ticket.acceptance_criteria).toEqual(['AC1', 'AC2', 'AC3']);
      expect(parsed.ticket.file_paths).toEqual(['infra/config.yml', 'infra/deploy.sh']);
      expect(parsed.ticket.description).toBe('Infrastructure child ticket');
    });
  });

  // AC6: If depends_on is empty, child starts in READY status; otherwise BLOCKED
  describe('initial status based on dependencies', () => {
    it('should set status to READY when depends_on is empty', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Ready Child',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
        depends_on: [],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.status).toBe('READY');
    });

    it('should set status to READY when depends_on is omitted', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Ready Child No Deps',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.status).toBe('READY');
    });

    it('should set status to BLOCKED when depends_on has entries', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Blocked Child',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
        depends_on: ['SOME-DEP-001'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      expect(parsed.ticket.status).toBe('BLOCKED');
    });
  });

  // AC7: SPAWNED event recorded on parent ticket with child ticket_id in payload
  describe('SPAWNED event on parent', () => {
    it('should record a SPAWNED event on the parent ticket', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Event Test Child',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      const childId = parsed.ticket.ticket_id;

      // Query for the SPAWNED event
      const eventResult = await pool.query(
        "SELECT * FROM events WHERE ticket_id = $1 AND event_type = 'SPAWNED' ORDER BY created_at DESC LIMIT 1",
        [PARENT_TICKET_ID],
      );

      expect(eventResult.rows.length).toBe(1);
      const event = eventResult.rows[0];
      expect(event.event_type).toBe('SPAWNED');
      expect(event.payload.child_ticket_id).toBe(childId);
    });

    it('should record a CREATED event on the child ticket', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Created Event Child',
        type: 'docs',
        priority: 'low',
        acceptance_criteria: ['AC1'],
        file_paths: [],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);
      const childId = parsed.ticket.ticket_id;

      const eventResult = await pool.query(
        "SELECT * FROM events WHERE ticket_id = $1 AND event_type = 'CREATED' LIMIT 1",
        [childId],
      );

      expect(eventResult.rows.length).toBe(1);
      const event = eventResult.rows[0];
      expect(event.payload.parent_ticket_id).toBe(PARENT_TICKET_ID);
      expect(event.payload.spawned).toBe(true);
    });
  });

  // AC8: Returns {ticket: childTicket, parent_ticket_id} on success
  describe('success response shape', () => {
    it('should return ticket and parent_ticket_id on success', async () => {
      const result = await ticketsSpawnHandler({
        parent_id: PARENT_TICKET_ID,
        title: 'Success Shape Test',
        type: 'backend',
        priority: 'medium',
        acceptance_criteria: ['AC1'],
        file_paths: ['src/child.ts'],
      });

      const parsed = parseResult<TicketsSpawnOutput>(result);

      // Verify shape
      expect(parsed).toHaveProperty('ticket');
      expect(parsed).toHaveProperty('parent_ticket_id');
      expect(parsed.parent_ticket_id).toBe(PARENT_TICKET_ID);
      expect(parsed.ticket.ticket_id).toBeDefined();
      expect(parsed.ticket.id).toBeDefined();
      expect(parsed.ticket.created_at).toBeDefined();
    });
  });
});
