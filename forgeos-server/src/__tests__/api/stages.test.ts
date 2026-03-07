/**
 * Stages Route Tests — TASK-FOS-05-002
 *
 * Tests for the REST endpoint:
 * - GET /api/stages — pipeline overview with per-stage counts
 *
 * @module __tests__/api/stages
 * @ticket TASK-FOS-05-002
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

// ── Hoisted mock declarations ────────────────────────────────────────────────

const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(),
}));

// ── Mock database ────────────────────────────────────────────────────────────

vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn(() => ({
    query: mockQuery,
    on: vi.fn(),
    totalCount: 5,
    idleCount: 3,
    waitingCount: 0,
  })),
}));

// ── Mock middleware ──────────────────────────────────────────────────────────

vi.mock('../../middleware/logging.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  requestLogger: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock('../../middleware/auth.js', () => ({
  authMiddleware: vi.fn((_req: Request, _res: Response, next: NextFunction) => next()),
}));

// ── Import after mocks ──────────────────────────────────────────────────────

import { stagesRouter } from '../../api/routes/stages.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/stages', stagesRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Stages Route', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/stages', () => {
    it('returns pipeline overview with stage counts', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { stage: 'READY', total: '5', claimed: '0', ready: '5' },
          { stage: 'BACKEND', total: '3', claimed: '2', ready: '1' },
          { stage: 'QA', total: '1', claimed: '1', ready: '0' },
        ],
      });

      const res = await request(app).get('/api/stages');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('stages');
      expect(res.body).toHaveProperty('total_tickets');
      expect(res.body).toHaveProperty('timestamp');
      expect(res.body.stages).toHaveProperty('READY');
      expect(res.body.stages['READY']).toHaveProperty('count', 5);
      expect(res.body.stages['READY']).toHaveProperty('claimed', 0);
      expect(res.body.stages['READY']).toHaveProperty('ready', 5);
    });

    it('returns zero counts for stages with no tickets', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/stages');

      expect(res.status).toBe(200);
      expect(res.body.total_tickets).toBe(0);
      expect(res.body.stages).toBeDefined();
    });

    it('returns correct count values from database', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { stage: 'BACKEND', total: '10', claimed: '6', ready: '4' },
        ],
      });

      const res = await request(app).get('/api/stages');

      expect(res.status).toBe(200);
      expect(res.body.stages['BACKEND'].count).toBe(10);
      expect(res.body.stages['BACKEND'].claimed).toBe(6);
      expect(res.body.stages['BACKEND'].ready).toBe(4);
    });

    it('handles database errors gracefully', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await request(app).get('/api/stages');

      expect(res.status).toBe(500);
    });

    it('includes ISO timestamp in response', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ stage: 'READY', total: '1', claimed: '0', ready: '1' }],
      });

      const res = await request(app).get('/api/stages');

      expect(res.status).toBe(200);
      const ts = new Date(res.body.timestamp);
      expect(ts.toISOString()).toBe(res.body.timestamp);
    });
  });
});
