/**
 * API Router — mounts REST and SSE route modules under /api.
 *
 * Routes:
 * - GET /api/events      — SSE stream of real-time ticket updates
 * - GET /api/tickets      — Paginated, filterable ticket list
 * - GET /api/tickets/:id  — Full ticket detail with resolved dependencies
 * - GET /api/tickets/:id/history — Ordered event timeline for a ticket
 * - GET /api/stages       — Pipeline overview with counts per stage
 *
 * All REST endpoints require authentication (via authMiddleware).
 * The SSE endpoint is optionally authenticated.
 *
 * @module api
 * @ticket TASK-FOS-05-002
 */

import { Router } from 'express';
import { eventsRouter } from './routes/events.js';
import { ticketsRouter } from './routes/tickets.js';
import { stagesRouter } from './routes/stages.js';
import { authMiddleware } from '../middleware/auth.js';
import { adminRouter } from './routes/admin.js';

/**
 * Create and return the top-level API router.
 *
 * Mounts sub-routers for events (SSE), tickets (REST), and stages (REST).
 * SSE endpoint is mounted without auth middleware (optionally authenticated).
 * REST endpoints are mounted with auth middleware.
 *
 * @returns Configured Express Router for /api prefix
 */
export function createApiRouter(): Router {
  const router = Router();

  // SSE endpoint — optionally authenticated (no auth middleware)
  router.use('/events', eventsRouter);

  // REST endpoints — require authentication
  router.use('/tickets', authMiddleware, ticketsRouter);
  router.use('/stages', authMiddleware, stagesRouter);

  // Admin endpoints — require authentication
  router.use('/admin', authMiddleware, adminRouter);

  return router;
}
