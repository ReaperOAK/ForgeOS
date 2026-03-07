/**
 * Tickets Route Tests — TASK-FOS-05-002
 *
 * Tests for the REST endpoints:
 * - GET /api/tickets — paginated list with filters
 * - GET /api/tickets/:id — full ticket detail with dependency_status
 * - GET /api/tickets/:id/history — ordered event history
 *
 * @module __tests__/api/tickets
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

import { ticketsRouter } from '../../api/routes/tickets.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/tickets', ticketsRouter);
  // Error handler for test
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Tickets Route', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/tickets', () => {
    it('returns paginated ticket list with defaults', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '3' }] })
        .mockResolvedValueOnce({
          rows: [
            { ticket_id: 'T-001', title: 'Ticket 1', stage: 'READY', status: 'READY' },
            { ticket_id: 'T-002', title: 'Ticket 2', stage: 'BACKEND', status: 'CLAIMED' },
            { ticket_id: 'T-003', title: 'Ticket 3', stage: 'QA', status: 'IN_PROGRESS' },
          ],
        });

      const res = await request(app).get('/api/tickets');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('data');
      expect(res.body).toHaveProperty('pagination');
      expect(res.body.pagination).toHaveProperty('total', 3);
      expect(res.body.pagination).toHaveProperty('limit');
      expect(res.body.pagination).toHaveProperty('offset', 0);
      expect(res.body.pagination).toHaveProperty('has_more');
      expect(res.body.data).toHaveLength(3);
    });

    it('applies stage filter from query param', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '1' }] })
        .mockResolvedValueOnce({
          rows: [
            { ticket_id: 'T-001', title: 'Ticket 1', stage: 'BACKEND', status: 'CLAIMED' },
          ],
        });

      const res = await request(app).get('/api/tickets?stage=BACKEND');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      // Verify filters were applied — both calls should have parameterized queries
      expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('applies pagination with limit and offset', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '50' }] })
        .mockResolvedValueOnce({
          rows: [
            { ticket_id: 'T-011', title: 'Ticket 11', stage: 'READY', status: 'READY' },
          ],
        });

      const res = await request(app).get('/api/tickets?limit=1&offset=10');

      expect(res.status).toBe(200);
      expect(res.body.pagination.limit).toBe(1);
      expect(res.body.pagination.offset).toBe(10);
      expect(res.body.pagination.has_more).toBe(true);
    });

    it('rejects invalid query parameters', async () => {
      const res = await request(app).get('/api/tickets?limit=-1');

      expect(res.status).toBe(400);
    });

    it('returns empty data when no tickets match', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ count: '0' }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/tickets?stage=DONE');

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(0);
      expect(res.body.pagination.total).toBe(0);
      expect(res.body.pagination.has_more).toBe(false);
    });
  });

  describe('GET /api/tickets/:id', () => {
    it('returns full ticket detail with dependency_status', async () => {
      mockQuery
        .mockResolvedValueOnce({
          rows: [{
            ticket_id: 'T-001',
            title: 'Ticket 1',
            stage: 'BACKEND',
            status: 'CLAIMED',
            depends_on: ['T-000'],
          }],
        })
        .mockResolvedValueOnce({
          rows: [{ ticket_id: 'T-000', title: 'Dependency Ticket', status: 'DONE', stage: 'DONE' }],
        });

      const res = await request(app).get('/api/tickets/T-001');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('ticket_id', 'T-001');
      expect(res.body).toHaveProperty('dependency_status');
      expect(res.body.dependency_status).toBeInstanceOf(Array);
      expect(res.body.dependency_status[0]).toHaveProperty('ticket_id', 'T-000');
      expect(res.body.dependency_status[0]).toHaveProperty('is_resolved', true);
    });

    it('returns 404 for non-existent ticket', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/tickets/NONEXISTENT');

      expect(res.status).toBe(404);
      expect(res.body).toHaveProperty('error', 'TICKET_NOT_FOUND');
      expect(res.body).toHaveProperty('message');
    });

    it('returns empty dependency_status when ticket has no dependencies', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{
          ticket_id: 'T-002',
          title: 'No Deps',
          stage: 'READY',
          status: 'READY',
          depends_on: [],
        }],
      });

      const res = await request(app).get('/api/tickets/T-002');

      expect(res.status).toBe(200);
      expect(res.body.dependency_status).toEqual([]);
    });
  });

  describe('GET /api/tickets/:id/history', () => {
    it('returns event history ordered by created_at', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        .mockResolvedValueOnce({
          rows: [
            { event_id: 'E-001', event_type: 'CREATED', created_at: '2024-01-01T00:00:00Z' },
            { event_id: 'E-002', event_type: 'CLAIMED', created_at: '2024-01-01T01:00:00Z' },
            { event_id: 'E-003', event_type: 'ADVANCED', created_at: '2024-01-01T02:00:00Z' },
          ],
        });

      const res = await request(app).get('/api/tickets/T-001/history');

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('events');
      expect(res.body.events).toHaveLength(3);
      expect(res.body.events[0]).toHaveProperty('event_type', 'CREATED');
      expect(res.body.events[2]).toHaveProperty('event_type', 'ADVANCED');
      expect(res.body).toHaveProperty('count', 3);
    });

    it('returns 404 if ticket does not exist', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ exists: false }] });

      const res = await request(app).get('/api/tickets/NONEXISTENT/history');

      expect(res.status).toBe(404);
    });

    it('returns empty events array for ticket with no events', async () => {
      mockQuery
        .mockResolvedValueOnce({ rows: [{ exists: true }] })
        .mockResolvedValueOnce({ rows: [] });

      const res = await request(app).get('/api/tickets/T-003/history');

      expect(res.status).toBe(200);
      expect(res.body.events).toEqual([]);
      expect(res.body.count).toBe(0);
    });
  });
});
