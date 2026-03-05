// forgeos-server/src/tools/tickets-next.test.ts
// TDD: Red-Green-Refactor for tickets.next MCP tool
import { ticketsNext, ticketsNextInputSchema } from './tickets-next.js';
import { pool } from '../db/pool.js';

describe('tickets.next MCP tool', () => {
  beforeAll(async () => {
    // Optionally seed test data or use a test DB
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should validate input schema (stage required)', () => {
    expect(() => ticketsNextInputSchema.parse({})).toThrow();
    expect(() => ticketsNextInputSchema.parse({ stage: 'BACKEND' })).not.toThrow();
  });

  it('should return no tickets if none available', async () => {
    // Use a stage/type/priority unlikely to exist
    const result = await ticketsNext({ stage: 'QA', type: 'docs', priority: 'low' });
    expect(result.ticket).toBeNull();
    expect(result.message).toMatch(/no tickets/i);
  });

  // Add more tests for: correct ticket ordering, type/priority filters, error handling
});
