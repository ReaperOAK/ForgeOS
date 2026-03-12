/**
 * Tickets REST Routes — paginated listing, detail, and history.
 *
 * Endpoints:
 * - GET /api/tickets          — Paginated, filterable ticket list
 * - GET /api/tickets/:id      — Full ticket with resolved dependency status
 * - GET /api/tickets/:id/history — Ordered event timeline
 *
 * All endpoints require authentication (enforced by parent router).
 *
 * @module api/routes/tickets
 * @ticket TASK-FOS-05-002
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { getPool } from '../../db/pool.js';
import { logger } from '../../middleware/logging.js';
import {
  TICKET_STAGES,
  TICKET_TYPES,
  TICKET_STATUSES,
  TICKET_PRIORITIES,
  type Ticket,
  type TicketEvent,
  type TicketStage,
  type TicketType,
  type TicketStatus,
  type TicketPriority,
} from '../../types/index.js';

// ── Query Parameter Schemas ──────────────────────────────────────────────────

const listQuerySchema = z.object({
  stage: z.enum(TICKET_STAGES as [TicketStage, ...TicketStage[]]).optional(),
  type: z.enum(TICKET_TYPES as [TicketType, ...TicketType[]]).optional(),
  status: z.enum(TICKET_STATUSES as [TicketStatus, ...TicketStatus[]]).optional(),
  claimed_by: z.string().optional(),
  priority: z.enum(TICKET_PRIORITIES as [TicketPriority, ...TicketPriority[]]).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

type ListQuery = z.infer<typeof listQuerySchema>;

// ── Types ────────────────────────────────────────────────────────────────────

interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

interface TicketWithDependencyStatus extends Ticket {
  dependency_status: Array<{
    ticket_id: string;
    title: string | null;
    status: string;
    is_resolved: boolean;
  }>;
}

// ── Helper Functions ─────────────────────────────────────────────────────────

/**
 * Build a SQL WHERE clause and parameter array from validated query filters.
 *
 * @param query - Validated query parameters
 * @returns Tuple of [whereClause, params]
 */
function buildWhereClause(query: ListQuery): [string, unknown[]] {
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  if (query.stage !== undefined) {
    conditions.push(`stage = $${paramIndex}::ticket_stage`);
    params.push(query.stage);
    paramIndex++;
  }

  if (query.type !== undefined) {
    conditions.push(`type = $${paramIndex}::ticket_type`);
    params.push(query.type);
    paramIndex++;
  }

  if (query.status !== undefined) {
    conditions.push(`status = $${paramIndex}::ticket_status`);
    params.push(query.status);
    paramIndex++;
  }

  if (query.claimed_by !== undefined) {
    conditions.push(`claimed_by_name = $${paramIndex}`);
    params.push(query.claimed_by);
    paramIndex++;
  }

  if (query.priority !== undefined) {
    conditions.push(`priority = $${paramIndex}::ticket_priority`);
    params.push(query.priority);
    paramIndex++;
  }

  const whereClause = conditions.length > 0
    ? `WHERE ${conditions.join(' AND ')}`
    : '';

  return [whereClause, params];
}

/**
 * Wrap an async route handler to catch errors and forward to error middleware.
 *
 * @param fn - Async route handler
 * @returns Wrapped route handler with error forwarding
 */
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

// ── Router ───────────────────────────────────────────────────────────────────

/** Express router for ticket REST endpoints. */
export const ticketsRouter = Router();

/**
 * GET /api/tickets — Paginated, filterable ticket list.
 *
 * Query parameters:
 * - stage: Filter by SDLC stage
 * - type: Filter by ticket type
 * - status: Filter by ticket status
 * - claimed_by: Filter by agent name
 * - priority: Filter by priority level
 * - limit: Page size (1–100, default 20)
 * - offset: Skip count (default 0)
 *
 * Returns: PaginatedResponse<Ticket>
 */
ticketsRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const parseResult = listQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Invalid query parameters',
        details: {
          fields: parseResult.error.issues.map((issue) => ({
            field: issue.path.join('.'),
            message: issue.message,
            code: issue.code,
          })),
        },
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const query = parseResult.data;
    const [whereClause, params] = buildWhereClause(query);

    const pool = getPool();

    // Count total matching rows
    const countResult = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM tickets ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    // Fetch paginated results
    const limitIdx = params.length + 1;
    const offsetIdx = params.length + 2;
    const dataResult = await pool.query<Ticket>(
      `SELECT * FROM tickets ${whereClause}
       ORDER BY priority DESC, created_at ASC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      [...params, query.limit, query.offset],
    );

    const response: PaginatedResponse<Ticket> = {
      data: dataResult.rows,
      pagination: {
        total,
        limit: query.limit,
        offset: query.offset,
        has_more: query.offset + query.limit < total,
      },
    };

    logger.debug(
      {
        event: 'api_tickets_list',
        total,
        limit: query.limit,
        offset: query.offset,
        filters: { stage: query.stage, type: query.type, status: query.status },
        requestId: req.requestId,
      },
      'Tickets list query served',
    );

    res.status(200).json(response);
  }),
);

/**
 * GET /api/tickets/:id — Full ticket with resolved dependency status.
 *
 * Returns the ticket matching the given ticket_id, plus an array showing
 * the resolved/unresolved status of each dependency.
 *
 * Returns 404 if the ticket is not found.
 */
ticketsRouter.get(
  '/:id',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const pool = getPool();

    // Fetch the ticket
    const ticketResult = await pool.query<Ticket>(
      'SELECT * FROM tickets WHERE ticket_id = $1',
      [id],
    );

    if (ticketResult.rows.length === 0) {
      res.status(404).json({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${id} not found`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const ticket = ticketResult.rows[0] as Ticket;

    // Resolve dependency status
    let dependencyStatus: TicketWithDependencyStatus['dependency_status'] = [];

    const dependsOn = ticket.depends_on ?? [];
    if (dependsOn.length > 0) {
      const depResult = await pool.query<{
        ticket_id: string;
        title: string | null;
        status: string;
      }>(
        `SELECT ticket_id, title, status::text
         FROM tickets
         WHERE ticket_id = ANY($1)`,
        [dependsOn],
      );

      const depMap = new Map(
        depResult.rows.map((row) => [row.ticket_id, row]),
      );

      dependencyStatus = dependsOn.map((depId) => {
        const dep = depMap.get(depId);
        return {
          ticket_id: depId,
          title: dep?.title ?? null,
          status: dep?.status ?? 'UNKNOWN',
          is_resolved: dep?.status === 'DONE',
        };
      });
    }

    const responseTicket = {
      ...ticket,
      dependency_status: dependencyStatus,
    };

    logger.debug(
      {
        event: 'api_ticket_detail',
        ticketId: id,
        requestId: req.requestId,
      },
      'Ticket detail served',
    );

    res.status(200).json(responseTicket);
  }),
);

/**
 * GET /api/tickets/:id/history — Ordered event timeline for a ticket.
 *
 * Returns all events from the events table for the given ticket_id,
 * ordered by created_at ascending (chronological order).
 *
 * Returns 404 if the ticket is not found.
 */
ticketsRouter.get(
  '/:id/history',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const { id } = req.params;
    const pool = getPool();

    // Verify ticket exists
    const ticketExists = await pool.query<{ exists: boolean }>(
      'SELECT EXISTS(SELECT 1 FROM tickets WHERE ticket_id = $1) AS exists',
      [id],
    );

    if (!ticketExists.rows[0]?.exists) {
      res.status(404).json({
        error: 'TICKET_NOT_FOUND',
        message: `Ticket ${id} not found`,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // Fetch events ordered chronologically
    const eventsResult = await pool.query<TicketEvent>(
      `SELECT * FROM events
       WHERE ticket_id = $1
       ORDER BY created_at ASC`,
      [id],
    );

    logger.debug(
      {
        event: 'api_ticket_history',
        ticketId: id,
        eventCount: eventsResult.rows.length,
        requestId: req.requestId,
      },
      'Ticket history served',
    );

    res.status(200).json({
      ticket_id: id,
      events: eventsResult.rows,
      count: eventsResult.rows.length,
    });
  }),
);
