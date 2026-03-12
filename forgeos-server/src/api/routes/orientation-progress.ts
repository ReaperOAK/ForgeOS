/**
 * Orientation Progress API — REST status and SSE stream for indexing/orientation progress.
 *
 * Provides real-time progress updates during `init.index` and `init.orient` operations.
 * Dashboard subscribes to progress events for visual feedback.
 *
 * Routes:
 * - GET /api/orientation/status   — Current indexing/orientation state (JSON)
 * - GET /api/orientation/progress — SSE stream of real-time progress events
 *
 * Progress state is stored in-memory (not persisted). Multiple concurrent
 * SSE subscribers are supported via EventEmitter fan-out.
 *
 * @module api/routes/orientation-progress
 * @ticket TASK-INT-BE044
 */

import { Router, type Request, type Response } from 'express';
import { EventEmitter } from 'events';
import { logger } from '../../middleware/logging.js';

/**
 * Represents the current state of an indexing/orientation operation.
 */
export interface ProgressState {
  phase: 'idle' | 'walking' | 'parsing' | 'indexing' | 'orienting' | 'complete' | 'error';
  currentFile?: string;
  filesProcessed: number;
  totalFiles: number;
  percentage: number;
  startedAt?: string;
  error?: string;
}

/** Default idle state. */
const IDLE_STATE: ProgressState = {
  phase: 'idle',
  filesProcessed: 0,
  totalFiles: 0,
  percentage: 0,
};

/** Global progress emitter — tools emit events, SSE routes subscribe. */
export const progressEmitter = new EventEmitter();

/** In-memory progress state. */
let currentProgress: ProgressState = { ...IDLE_STATE };

/** Active SSE subscriber count for logging. */
const sseSubscribers = new Set<Response>();

/**
 * Get the current progress state (read-only copy).
 *
 * @returns A shallow copy of the current progress state
 */
export function getProgress(): ProgressState {
  return { ...currentProgress };
}

/**
 * Get the number of active SSE subscribers.
 *
 * @returns Active subscriber count
 */
export function getSubscriberCount(): number {
  return sseSubscribers.size;
}

/**
 * Update the in-memory progress state and broadcast to all SSE subscribers.
 *
 * Merges the partial update into the current state, clamps percentage to [0, 100],
 * and emits a 'progress' event on the global progressEmitter.
 *
 * @param update - Partial progress state to merge
 */
export function updateProgress(update: Partial<ProgressState>): void {
  currentProgress = { ...currentProgress, ...update };

  // Clamp percentage to valid range
  if (currentProgress.percentage < 0) {
    currentProgress.percentage = 0;
  } else if (currentProgress.percentage > 100) {
    currentProgress.percentage = 100;
  }

  progressEmitter.emit('progress', { ...currentProgress });
}

/**
 * Reset progress state to idle.
 *
 * Useful for cleanup after operation completes or on error recovery.
 */
export function resetProgress(): void {
  currentProgress = { ...IDLE_STATE };
  progressEmitter.emit('progress', { ...currentProgress });
}

/** Express router for orientation progress endpoints. */
export const orientationProgressRouter = Router();

/**
 * GET /api/orientation/status
 *
 * Returns the current indexing/orientation state as JSON.
 */
orientationProgressRouter.get('/status', (_req: Request, res: Response): void => {
  res.json(getProgress());
});

/**
 * GET /api/orientation/progress
 *
 * SSE stream of real-time progress events. Each event contains the full
 * ProgressState as JSON in the data field.
 *
 * SSE format:
 *   event: progress
 *   data: {"phase":"walking","currentFile":"src/foo.ts",...}
 *
 * Sends a keep-alive comment every 30 seconds to prevent proxy timeouts.
 */
orientationProgressRouter.get('/progress', (req: Request, res: Response): void => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders();

  // Send current state as initial event
  const state = getProgress();
  res.write(`event: progress\ndata: ${JSON.stringify(state)}\n\n`);

  // Register subscriber
  sseSubscribers.add(res);

  logger.info(
    { event: 'orientation_sse_connected', subscriberCount: sseSubscribers.size },
    'Orientation SSE client connected',
  );

  // Forward progress events to this client
  const listener = (data: ProgressState): void => {
    try {
      res.write(`event: progress\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Client may have disconnected between check and write
      progressEmitter.off('progress', listener);
      sseSubscribers.delete(res);
    }
  };
  progressEmitter.on('progress', listener);

  // Keep-alive to prevent proxy timeouts
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch {
      clearInterval(keepAliveInterval);
    }
  }, 30_000);

  // Clean up on disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    progressEmitter.off('progress', listener);
    sseSubscribers.delete(res);

    logger.info(
      { event: 'orientation_sse_disconnected', subscriberCount: sseSubscribers.size },
      'Orientation SSE client disconnected',
    );
  });
});

export default orientationProgressRouter;
