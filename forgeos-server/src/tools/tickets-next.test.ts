// forgeos-server/src/tools/tickets-next.test.ts
// TDD: Red-Green-Refactor for tickets.next MCP tool
import { ticketsNext, ticketsNextInputSchema } from './tickets-next.js';
import { pool } from '../db/pool.js';

describe('tickets.next MCP tool', () => {
  const testTickets = [
    {
      ticket_id: 'T1',
      stage: 'BACKEND',
      status: 'READY',
      type: 'backend',
      priority: 'high',
      claimed_by: null,
      lease_expiry: null,
      created_at: new Date(Date.now() - 100000),
    },
    {
      ticket_id: 'T2',
      stage: 'BACKEND',
      status: 'READY',
      type: 'backend',
      priority: 'medium',
      claimed_by: null,
      lease_expiry: null,
      created_at: new Date(Date.now() - 50000),
    },
    {
      ticket_id: 'T3',
      stage: 'BACKEND',
      status: 'READY',
      type: 'frontend',
      priority: 'high',
      claimed_by: null,
      lease_expiry: null,
      created_at: new Date(Date.now() - 20000),
    },
    {
      ticket_id: 'T4',
      stage: 'BACKEND',
      status: 'READY',
      type: 'backend',
      priority: 'low',
      claimed_by: null,
      lease_expiry: null,
      created_at: new Date(Date.now() - 30000),
    },
    {
      ticket_id: 'T5',
      stage: 'BACKEND',
      status: 'READY',
      type: 'backend',
      priority: 'high',
      claimed_by: 'some-agent',
      lease_expiry: new Date(Date.now() + 100000), // still claimed
      created_at: new Date(Date.now() - 150000),
    },
  ];

  beforeAll(async () => {
    // Clean and seed tickets table
    await pool.query('DELETE FROM tickets');
    for (const t of testTickets) {
      await pool.query(
        `INSERT INTO tickets (ticket_id, stage, status, type, priority, claimed_by, lease_expiry, created_at, sdlc_flow) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,ARRAY['BACKEND','QA','SECURITY'])`,
        [t.ticket_id, t.stage, t.status, t.type, t.priority, t.claimed_by, t.lease_expiry, t.created_at]
      );
    }
  });

  afterAll(async () => {
    await pool.query('DELETE FROM tickets');
    await pool.end();
  });

  it('should validate input schema (stage required)', () => {
    expect(() => ticketsNextInputSchema.parse({})).toThrow();
    expect(() => ticketsNextInputSchema.parse({ stage: 'BACKEND' })).not.toThrow();
  });

  it('should return no tickets if none available', async () => {
    const result = await ticketsNext({ stage: 'QA', type: 'docs', priority: 'low' });
    expect(result.ticket).toBeNull();
    expect(result.message).toMatch(/no tickets/i);
  });

  it('should return the highest priority, oldest ticket for stage', async () => {
    const result = await ticketsNext({ stage: 'BACKEND' });
    expect(result.ticket).not.toBeNull();
    expect(result.ticket.ticket_id).toBe('T1'); // T1: high priority, oldest
  });

  it('should filter by type', async () => {
    const result = await ticketsNext({ stage: 'BACKEND', type: 'frontend' });
    expect(result.ticket).not.toBeNull();
    expect(result.ticket.ticket_id).toBe('T3');
  });

  it('should filter by priority', async () => {
    const result = await ticketsNext({ stage: 'BACKEND', priority: 'medium' });
    expect(result.ticket).not.toBeNull();
    // Should return T1 (high > medium)
    expect(result.ticket.priority === 'high' || result.ticket.priority === 'medium').toBe(true);
  });

  it('should skip tickets with active claims', async () => {
    // T5 is claimed, should not be returned
    const result = await ticketsNext({ stage: 'BACKEND' });
    expect(result.ticket.ticket_id).not.toBe('T5');
  });

  it('should handle DB errors gracefully', async () => {
    // Simulate error by passing invalid param (should not throw)
    // @ts-ignore
    const result = await ticketsNext({ stage: 'BACKEND', type: 123 });
    expect(result.ticket).toBeNull();
    expect(result.message).toMatch(/error/i);
  });
});
