/**
 * SSE Events Route — Server-Sent Events for real-time ticket updates.
 *
 * GET /api/events returns a text/event-stream connection that:
 * 1. Sends a snapshot of current system state as the first event
 * 2. Listens on PostgreSQL 'ticket_changes' NOTIFY channel
 * 3. Broadcasts ticket updates to all connected clients
 * 4. Cleans up listener on client disconnection
 *
 * SSE event format:
 *   event: ticket-update
 *   data: {"ticket_id":"...","status":"...","stage":"...",...}
 *
 * @module api/routes/events
 * @ticket TASK-FOS-05-002
 */

import { Router, type Request, type Response } from 'express';
import pg from 'pg';
import { getPool } from '../../db/pool.js';
import { logger } from '../../middleware/logging.js';

/** Active SSE client connections for real-time push. */
const sseClients = new Set<Response>();

/** Dedicated PG client for LISTEN. Null until first connection. */
let notifyClient: pg.PoolClient | null = null;

/** Whether the NOTIFY listener is currently active. */
let listenerActive = false;

/**
 * Send a named SSE event to a single client.
 *
 * @param res - Express response (SSE stream)
 * @param eventName - SSE event name (e.g. 'ticket-update')
 * @param data - JSON-serializable payload
 */
function sendSSEEvent(res: Response, eventName: string, data: Record<string, unknown>): void {
  res.write(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`);
}

/**
 * Broadcast a named SSE event to all connected clients.
 *
 * @param eventName - SSE event name
 * @param data - JSON-serializable payload
 */
export function broadcastEvent(eventName: string, data: Record<string, unknown>): void {
  for (const client of sseClients) {
    sendSSEEvent(client, eventName, data);
  }
}

/**
 * Fetch a snapshot of current system state for initial SSE connection.
 *
 * Returns aggregated stage counts and recent ticket activity.
 *
 * @returns Snapshot object with stage_summary and recent_tickets
 */
async function fetchSystemSnapshot(): Promise<Record<string, unknown>> {
  const pool = getPool();

  const stageResult = await pool.query<{
    stage: string;
    total: string;
    claimed: string;
    ready: string;
  }>(`
    SELECT
      stage::text,
      COUNT(*)::text AS total,
      COUNT(*) FILTER (WHERE status = 'CLAIMED')::text AS claimed,
      COUNT(*) FILTER (WHERE status = 'READY')::text AS ready
    FROM tickets
    WHERE stage != 'DONE'
    GROUP BY stage
    ORDER BY stage
  `);

  const recentResult = await pool.query<{
    ticket_id: string;
    title: string;
    status: string;
    stage: string;
    claimed_by_name: string | null;
    updated_at: string;
  }>(`
    SELECT ticket_id, title, status::text, stage::text, claimed_by_name, updated_at
    FROM tickets
    ORDER BY updated_at DESC
    LIMIT 20
  `);

  const stageSummary: Record<string, { count: number; claimed: number; ready: number }> = {};
  for (const row of stageResult.rows) {
    stageSummary[row.stage] = {
      count: Number(row.total),
      claimed: Number(row.claimed),
      ready: Number(row.ready),
    };
  }

  return {
    type: 'snapshot',
    stage_summary: stageSummary,
    recent_tickets: recentResult.rows,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Start the PostgreSQL NOTIFY listener for the 'ticket_changes' channel.
 *
 * Acquires a dedicated client from the pool and issues LISTEN.
 * The client is intentionally NOT released to keep the subscription alive.
 * On notification, broadcasts to all SSE clients with proper event format.
 * On connection error, attempts automatic reconnection after 3 seconds.
 */
async function ensureNotifyListener(): Promise<void> {
  if (listenerActive) {
    return;
  }

  const pool = getPool();
  notifyClient = await pool.connect();

  try {
    await notifyClient.query('LISTEN ticket_changes');
    listenerActive = true;

    logger.info(
      { event: 'sse_notify_listener_started', channel: 'ticket_changes' },
      'SSE NOTIFY listener started on ticket_changes channel',
    );

    notifyClient.on('notification', (msg: pg.Notification) => {
      if (msg.channel === 'ticket_changes' && msg.payload) {
        try {
          const payload = JSON.parse(msg.payload) as Record<string, unknown>;
          broadcastEvent('ticket-update', payload);

          logger.debug(
            { event: 'sse_broadcast', clientCount: sseClients.size, ticketId: payload['ticket_id'] },
            'SSE broadcast ticket-update',
          );
        } catch (parseErr) {
          logger.error(
            { err: parseErr, event: 'sse_payload_parse_error', rawPayload: msg.payload },
            'Failed to parse NOTIFY payload',
          );
        }
      }
    });

    notifyClient.on('error', (err: Error) => {
      logger.error(
        { err, event: 'sse_notify_listener_error' },
        'SSE NOTIFY listener error, will reconnect',
      );
      listenerActive = false;
      notifyClient = null;

      setTimeout(() => {
        ensureNotifyListener().catch((reconnectErr) =>
          logger.error(
            { err: reconnectErr, event: 'sse_notify_reconnect_failed' },
            'Failed to reconnect SSE NOTIFY listener',
          ),
        );
      }, 3011);
    });
  } catch (err) {
    notifyClient.release();
    notifyClient = null;
    listenerActive = false;
    throw err;
  }
}

/**
 * Get the number of currently connected SSE clients.
 *
 * @returns Active SSE connection count
 */
export function getSSEClientCount(): number {
  return sseClients.size;
}

/**
 * Clean up the NOTIFY listener and all SSE connections.
 *
 * Called during graceful shutdown to release the dedicated PG client
 * and close all SSE streams.
 */
export async function cleanupSSE(): Promise<void> {
  listenerActive = false;
  if (notifyClient) {
    try {
      await notifyClient.query('UNLISTEN ticket_changes');
    } catch {
      // Ignore errors during cleanup
    }
    notifyClient.release();
    notifyClient = null;
  }
  sseClients.clear();
  logger.info({ event: 'sse_cleanup' }, 'SSE cleanup complete');
}

/** Express router for SSE events endpoint. */
export const eventsRouter = Router();

/**
 * GET /api/events — SSE stream of real-time ticket updates.
 *
 * Sets proper SSE headers (Content-Type, Cache-Control, Connection).
 * On connection, sends a snapshot of current system state as the first event.
 * Subscribes to PostgreSQL NOTIFY and broadcasts ticket changes.
 * Cleans up on client disconnection.
 */
eventsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Disable response buffering for immediate event delivery
  res.flushHeaders();

  // Send initial snapshot
  try {
    const snapshot = await fetchSystemSnapshot();
    sendSSEEvent(res, 'snapshot', snapshot);
  } catch (snapshotErr) {
    logger.error(
      { err: snapshotErr, event: 'sse_snapshot_error' },
      'Failed to send initial SSE snapshot',
    );
    sendSSEEvent(res, 'error', {
      message: 'Failed to load initial state',
      timestamp: new Date().toISOString(),
    });
  }

  // Register this client
  sseClients.add(res);

  logger.info(
    { event: 'sse_client_connected', clientCount: sseClients.size, requestId: req.requestId },
    'SSE client connected',
  );

  // Ensure the NOTIFY listener is running
  try {
    await ensureNotifyListener();
  } catch (listenerErr) {
    logger.error(
      { err: listenerErr, event: 'sse_listener_start_error' },
      'Failed to start NOTIFY listener',
    );
  }

  // Send periodic keep-alive comments to prevent proxy timeouts
  const keepAliveInterval = setInterval(() => {
    try {
      res.write(':keepalive\n\n');
    } catch {
      clearInterval(keepAliveInterval);
    }
  }, 30_000);

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(keepAliveInterval);
    sseClients.delete(res);

    logger.info(
      { event: 'sse_client_disconnected', clientCount: sseClients.size, requestId: req.requestId },
      'SSE client disconnected',
    );
  });
});
