/**
 * Stages REST Route — Pipeline overview with per-stage counts.
 *
 * GET /api/stages returns an object with one key per active stage,
 * each containing { count, claimed, ready } metrics.
 *
 * Requires authentication (enforced by parent router).
 *
 * @module api/routes/stages
 * @ticket TASK-FOS-05-002
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { getPool } from '../../db/pool.js';
import { logger } from '../../middleware/logging.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface StageSummary {
  count: number;
  claimed: number;
  ready: number;
}

interface StagesResponse {
  stages: Record<string, StageSummary>;
  total_tickets: number;
  timestamp: string;
}

// ── Helper ───────────────────────────────────────────────────────────────────

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

/** Express router for stages REST endpoint. */
export const stagesRouter = Router();

/**
 * GET /api/stages — Pipeline overview with counts per stage.
 *
 * Returns { stage: { count, claimed, ready } } for each stage that has
 * at least one ticket. Also includes total_tickets across all stages.
 *
 * Response shape:
 * ```json
 * {
 *   "stages": {
 *     "READY": { "count": 5, "claimed": 0, "ready": 5 },
 *     "BACKEND": { "count": 3, "claimed": 2, "ready": 1 },
 *     ...
 *   },
 *   "total_tickets": 42,
 *   "timestamp": "2026-03-07T..."
 * }
 * ```
 */
stagesRouter.get(
  '/',
  asyncHandler(async (req: Request, res: Response): Promise<void> => {
    const pool = getPool();

    const result = await pool.query<{
      stage: string;
      total: string;
      claimed: string;
      ready: string;
    }>(`
      SELECT
        stage::text,
        COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE status = 'CLAIMED' OR status = 'IN_PROGRESS')::text AS claimed,
        COUNT(*) FILTER (WHERE status = 'READY')::text AS ready
      FROM tickets
      GROUP BY stage
      ORDER BY stage
    `);

    const stages: Record<string, StageSummary> = {};
    let totalTickets = 0;

    for (const row of result.rows) {
      const count = Number(row.total);
      stages[row.stage] = {
        count,
        claimed: Number(row.claimed),
        ready: Number(row.ready),
      };
      totalTickets += count;
    }

    const response: StagesResponse = {
      stages,
      total_tickets: totalTickets,
      timestamp: new Date().toISOString(),
    };

    logger.debug(
      {
        event: 'api_stages_overview',
        stageCount: Object.keys(stages).length,
        totalTickets,
        requestId: req.requestId,
      },
      'Stages overview served',
    );

    res.status(200).json(response);
  }),
);
