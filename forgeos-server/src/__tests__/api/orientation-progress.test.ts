/**
 * Orientation Progress Route Tests — TASK-INT-BE044
 *
 * Tests for the orientation progress endpoints:
 * - GET /api/orientation/status — returns current progress state (JSON)
 * - GET /api/orientation/progress — SSE stream of progress events
 * - updateProgress() — merges state and broadcasts
 * - resetProgress() — returns to idle
 * - Multiple concurrent SSE subscribers
 *
 * @module __tests__/api/orientation-progress
 * @ticket TASK-INT-BE044
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express, { type Express, type Request, type Response, type NextFunction } from 'express';
import request from 'supertest';

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

import {
  orientationProgressRouter,
  updateProgress,
  resetProgress,
  getProgress,
  getSubscriberCount,
  progressEmitter,
} from '../../api/routes/orientation-progress.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function createApp(): Express {
  const app = express();
  app.use(express.json());
  app.use('/api/orientation', orientationProgressRouter);
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('Orientation Progress Route', () => {
  let app: Express;

  beforeEach(() => {
    vi.clearAllMocks();
    resetProgress();
    app = createApp();
  });

  afterEach(() => {
    progressEmitter.removeAllListeners();
    vi.restoreAllMocks();
  });

  // ── GET /api/orientation/status ──────────────────────────────────────────

  describe('GET /api/orientation/status', () => {
    it('returns idle state by default', async () => {
      const res = await request(app).get('/api/orientation/status');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        phase: 'idle',
        filesProcessed: 0,
        totalFiles: 0,
        percentage: 0,
      });
    });

    it('returns updated state after updateProgress()', async () => {
      updateProgress({
        phase: 'walking',
        currentFile: 'src/index.ts',
        filesProcessed: 5,
        totalFiles: 100,
        percentage: 5,
        startedAt: '2026-03-12T10:00:00Z',
      });

      const res = await request(app).get('/api/orientation/status');

      expect(res.status).toBe(200);
      expect(res.body.phase).toBe('walking');
      expect(res.body.currentFile).toBe('src/index.ts');
      expect(res.body.filesProcessed).toBe(5);
      expect(res.body.totalFiles).toBe(100);
      expect(res.body.percentage).toBe(5);
      expect(res.body.startedAt).toBe('2026-03-12T10:00:00Z');
    });

    it('returns idle state after resetProgress()', async () => {
      updateProgress({ phase: 'indexing', filesProcessed: 50, totalFiles: 100, percentage: 50 });
      resetProgress();

      const res = await request(app).get('/api/orientation/status');

      expect(res.status).toBe(200);
      expect(res.body.phase).toBe('idle');
      expect(res.body.filesProcessed).toBe(0);
    });

    it('includes error field when phase is error', async () => {
      updateProgress({ phase: 'error', error: 'Permission denied: /root/secret' });

      const res = await request(app).get('/api/orientation/status');

      expect(res.status).toBe(200);
      expect(res.body.phase).toBe('error');
      expect(res.body.error).toBe('Permission denied: /root/secret');
    });

    it('returns JSON content type', async () => {
      const res = await request(app).get('/api/orientation/status');

      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  // ── GET /api/orientation/progress (SSE) ──────────────────────────────────

  describe('GET /api/orientation/progress', () => {
    it('returns SSE headers and initial state', async () => {
      updateProgress({ phase: 'parsing', filesProcessed: 10, totalFiles: 50, percentage: 20 });

      const collected: string[] = [];
      let headers: Record<string, string> = {};

      await new Promise<void>((resolve) => {
        const server = app.listen(0, () => {
          const port = (server.address() as { port: number }).port;
          const http = require('http');
          const req = http.get(`http://127.0.0.1:${port}/api/orientation/progress`, (res: { statusCode: number; headers: Record<string, string>; on: (event: string, cb: (chunk: Buffer) => void) => void; destroy: () => void }) => {
            headers = res.headers;
            expect(res.statusCode).toBe(200);

            res.on('data', (chunk: Buffer) => {
              collected.push(chunk.toString());
              // Once we have data, tear down
              res.destroy();
              server.close(() => resolve());
            });
          });
          req.on('error', () => { /* expected on abort */ });
        });
      });

      expect(headers['content-type']).toBe('text/event-stream');
      expect(headers['cache-control']).toBe('no-cache');

      const body = collected.join('');
      expect(body).toContain('event: progress');
      expect(body).toContain('"phase":"parsing"');
      expect(body).toContain('"filesProcessed":10');
      expect(body).toContain('"percentage":20');
    });
  });

  // ── updateProgress() ────────────────────────────────────────────────────

  describe('updateProgress()', () => {
    it('merges partial state into current progress', () => {
      updateProgress({ phase: 'walking', totalFiles: 200 });

      const state = getProgress();
      expect(state.phase).toBe('walking');
      expect(state.totalFiles).toBe(200);
      expect(state.filesProcessed).toBe(0); // preserved default
    });

    it('incremental updates preserve previous fields', () => {
      updateProgress({
        phase: 'indexing',
        filesProcessed: 0,
        totalFiles: 100,
        percentage: 0,
        startedAt: '2026-03-12T10:00:00Z',
      });
      updateProgress({ filesProcessed: 42, percentage: 42, currentFile: 'src/api.ts' });

      const state = getProgress();
      expect(state.phase).toBe('indexing');
      expect(state.filesProcessed).toBe(42);
      expect(state.totalFiles).toBe(100);
      expect(state.percentage).toBe(42);
      expect(state.currentFile).toBe('src/api.ts');
      expect(state.startedAt).toBe('2026-03-12T10:00:00Z');
    });

    it('clamps percentage to 0 minimum', () => {
      updateProgress({ percentage: -10 });

      expect(getProgress().percentage).toBe(0);
    });

    it('clamps percentage to 100 maximum', () => {
      updateProgress({ percentage: 150 });

      expect(getProgress().percentage).toBe(100);
    });

    it('emits progress event on progressEmitter', () => {
      const listener = vi.fn();
      progressEmitter.on('progress', listener);

      updateProgress({ phase: 'orienting', filesProcessed: 80, totalFiles: 100, percentage: 80 });

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({
          phase: 'orienting',
          filesProcessed: 80,
          totalFiles: 100,
          percentage: 80,
        }),
      );
    });

    it('emits a copy of state (not a reference)', () => {
      const emitted: unknown[] = [];
      progressEmitter.on('progress', (data: unknown) => emitted.push(data));

      updateProgress({ phase: 'walking', filesProcessed: 1 });
      updateProgress({ phase: 'walking', filesProcessed: 2 });

      expect(emitted).toHaveLength(2);
      expect((emitted[0] as Record<string, unknown>).filesProcessed).toBe(1);
      expect((emitted[1] as Record<string, unknown>).filesProcessed).toBe(2);
    });
  });

  // ── resetProgress() ─────────────────────────────────────────────────────

  describe('resetProgress()', () => {
    it('resets state to idle defaults', () => {
      updateProgress({
        phase: 'complete',
        filesProcessed: 100,
        totalFiles: 100,
        percentage: 100,
        startedAt: '2026-03-12T10:00:00Z',
        currentFile: 'last.ts',
      });

      resetProgress();

      const state = getProgress();
      expect(state.phase).toBe('idle');
      expect(state.filesProcessed).toBe(0);
      expect(state.totalFiles).toBe(0);
      expect(state.percentage).toBe(0);
      expect(state.currentFile).toBeUndefined();
      expect(state.startedAt).toBeUndefined();
    });

    it('emits progress event on reset', () => {
      const listener = vi.fn();
      progressEmitter.on('progress', listener);

      resetProgress();

      expect(listener).toHaveBeenCalledOnce();
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ phase: 'idle', percentage: 0 }),
      );
    });
  });

  // ── getProgress() ───────────────────────────────────────────────────────

  describe('getProgress()', () => {
    it('returns a copy, not the internal reference', () => {
      const a = getProgress();
      const b = getProgress();

      expect(a).toEqual(b);
      expect(a).not.toBe(b);
    });
  });

  // ── getSubscriberCount() ────────────────────────────────────────────────

  describe('getSubscriberCount()', () => {
    it('exports getSubscriberCount function that returns a number', () => {
      expect(typeof getSubscriberCount()).toBe('number');
      expect(getSubscriberCount()).toBeGreaterThanOrEqual(0);
    });
  });

  // ── Multiple concurrent subscribers ─────────────────────────────────────

  describe('concurrent subscribers', () => {
    it('progressEmitter supports multiple listeners', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      const listener3 = vi.fn();

      progressEmitter.on('progress', listener1);
      progressEmitter.on('progress', listener2);
      progressEmitter.on('progress', listener3);

      updateProgress({ phase: 'walking', filesProcessed: 1, totalFiles: 10, percentage: 10 });

      expect(listener1).toHaveBeenCalledOnce();
      expect(listener2).toHaveBeenCalledOnce();
      expect(listener3).toHaveBeenCalledOnce();

      // All receive the same data
      const expected = expect.objectContaining({ phase: 'walking', filesProcessed: 1 });
      expect(listener1).toHaveBeenCalledWith(expected);
      expect(listener2).toHaveBeenCalledWith(expected);
      expect(listener3).toHaveBeenCalledWith(expected);
    });

    it('removing one listener does not affect others', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      progressEmitter.on('progress', listener1);
      progressEmitter.on('progress', listener2);

      // Remove first
      progressEmitter.off('progress', listener1);

      updateProgress({ phase: 'parsing' });

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledOnce();
    });
  });

  // ── Phase transitions ───────────────────────────────────────────────────

  describe('phase lifecycle', () => {
    it('supports full lifecycle: idle → walking → parsing → indexing → orienting → complete', () => {
      const phases: string[] = [];
      progressEmitter.on('progress', (data: { phase: string }) => phases.push(data.phase));

      updateProgress({ phase: 'walking', startedAt: '2026-03-12T10:00:00Z' });
      updateProgress({ phase: 'parsing', filesProcessed: 10, totalFiles: 100, percentage: 10 });
      updateProgress({ phase: 'indexing', filesProcessed: 50, totalFiles: 100, percentage: 50 });
      updateProgress({ phase: 'orienting', filesProcessed: 90, totalFiles: 100, percentage: 90 });
      updateProgress({ phase: 'complete', filesProcessed: 100, totalFiles: 100, percentage: 100 });

      expect(phases).toEqual(['walking', 'parsing', 'indexing', 'orienting', 'complete']);
    });

    it('supports error phase', () => {
      updateProgress({ phase: 'walking', startedAt: '2026-03-12T10:00:00Z' });
      updateProgress({ phase: 'error', error: 'ENOENT: no such file' });

      const state = getProgress();
      expect(state.phase).toBe('error');
      expect(state.error).toBe('ENOENT: no such file');
    });
  });
});
