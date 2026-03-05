// tickets-next.ts — MCP tool: tickets.next
// Implements: Find Next Available Ticket (read-only peek)
// Author: Backend Engineer (TASK-FOS-03-001)


import { z } from 'zod';
import { pool } from '../db/pool.js';
import { TICKET_STAGES, TICKET_TYPES, TICKET_PRIORITIES } from '../types/index.js';

// Zod schema for input validation
export const ticketsNextInputSchema = z.object({
  stage: z.enum([...TICKET_STAGES] as [string, ...string[]]),
  type: z.enum([...TICKET_TYPES] as [string, ...string[]]).optional(),
  priority: z.enum([...TICKET_PRIORITIES] as [string, ...string[]]).optional(),
});

/**
 * Find the next available ticket for a given SDLC stage (peek, not claim).
 *
 * @param input - { stage, type?, priority? }
 * @returns { ticket: object|null, message: string }
 */
export async function ticketsNext(input: z.infer<typeof ticketsNextInputSchema>) {
  const { stage, type, priority } = input;

  // Build dynamic WHERE clause and params
  let where = [
    'stage = $1',
    "status = 'READY'",
    '(claimed_by IS NULL OR lease_expiry < NOW())',
  ];
  const params: any[] = [stage];
  let paramIdx = 2;
  if (type) {
    where.push(`type = $${paramIdx}`);
    params.push(type);
    paramIdx++;
  }
  if (priority) {
    where.push(`priority >= $${paramIdx}`);
    params.push(priority);
    paramIdx++;
  }

  // Compose query (no FOR UPDATE SKIP LOCKED, just a peek)
  const query = `
    SELECT * FROM tickets
    WHERE ${where.join(' AND ')}
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `;

  try {
    const { rows } = await pool.query(query, params);
    if (rows.length === 0) {
      return { ticket: null, message: 'No tickets available' };
    }
    return { ticket: rows[0], message: 'OK' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ticket: null, message: `Query error: ${message}` };
  }
}
