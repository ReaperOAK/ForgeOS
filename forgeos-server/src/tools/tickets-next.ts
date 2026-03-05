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
  // Build dynamic WHERE clause
  const where = [
    'stage = $1',
    "status = 'READY'",
    '(claimed_by IS NULL OR lease_expiry < NOW())',
    type ? 'type = $2' : null,
    priority ? 'priority >= $3' : null,
  ].filter(Boolean).join(' AND ');

  // Build params array
  const params = [stage];
  if (type) params.push(type);
  if (priority) params.push(priority);

  // Compose query
  const query = `
    SELECT * FROM tickets
    WHERE ${where}
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
    FOR UPDATE SKIP LOCKED
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
