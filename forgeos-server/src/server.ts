/**
 * ForgeOS MCP Server — Express app factory with Streamable HTTP transport.
 *
 * Binds the McpServer to an Express app with:
 * - /mcp  — Streamable HTTP MCP endpoint
 * - /health — Health check (DB connectivity)
 * - /events — SSE stream of ticket changes (LISTEN/NOTIFY)
 * - /dashboard — Static dashboard files
 * @module server
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Request, type Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerTools } from './tools/index.js';
import { authMiddleware } from './middleware/auth.js';
import { requestLogger, logger } from './middleware/logging.js';
import { pool, healthCheck } from './db/pool.js';
import type { AppConfig } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Active SSE client connections for real-time push */
const sseClients = new Set<Response>();

/**
 * Build and return the configured Express application.
 *
 * Registers middleware (JSON body parsing, request logging, auth),
 * HTTP endpoints (`/health`, `/events`, `/dashboard`, `/mcp`),
 * and the MCP tool server with Streamable HTTP transport.
 *
 * Does NOT call `app.listen()` — that is done in `index.ts`
 * so the server can be managed with graceful shutdown.
 *
 * @param _config - Validated application configuration (see {@link AppConfig})
 * @returns Configured Express application ready to listen
 */
export function createApp(_config: AppConfig): express.Express {
  const app = express();

  // ── Middleware ──────────────────────────────────────
  app.use(express.json());
  app.use(requestLogger);
  app.use(authMiddleware);

  // ── Health ─────────────────────────────────────────
  app.get('/health', async (_req: Request, res: Response) => {
    try {
      const healthy = await healthCheck();
      if (healthy) {
        res.json({ status: 'ok', timestamp: new Date().toISOString() });
      } else {
        res.status(503).json({ status: 'unhealthy', timestamp: new Date().toISOString() });
      }
    } catch {
      res.status(503).json({ status: 'error', timestamp: new Date().toISOString() });
    }
  });

  // ── SSE Events ─────────────────────────────────────
  app.get('/events', (req: Request, res: Response) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    res.write('data: {"type":"connected"}\n\n');
    sseClients.add(res);

    logger.info({ clientCount: sseClients.size }, 'SSE client connected');

    req.on('close', () => {
      sseClients.delete(res);
      logger.info({ clientCount: sseClients.size }, 'SSE client disconnected');
    });
  });

  // ── Dashboard (static files) ───────────────────────
  const dashboardPath = path.join(__dirname, 'dashboard');
  app.use('/dashboard', express.static(dashboardPath));

  // ── MCP Endpoint ───────────────────────────────────
  const mcpServer = new McpServer({
    name: 'forgeos',
    version: '1.0.0',
  });

  registerTools(mcpServer);

  // Streamable HTTP transport for MCP
  app.post('/mcp', async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body as Record<string, unknown>);
    } catch (err) {
      logger.error({ err }, 'MCP request failed');
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP_ERROR', message: 'Internal server error' });
      }
    }
  });

  // Handle GET and DELETE for SSE-based MCP transport
  app.get('/mcp', async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      logger.error({ err }, 'MCP GET request failed');
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP_ERROR', message: 'Internal server error' });
      }
    }
  });

  app.delete('/mcp', async (req: Request, res: Response) => {
    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      logger.error({ err }, 'MCP DELETE request failed');
      if (!res.headersSent) {
        res.status(500).json({ error: 'MCP_ERROR', message: 'Internal server error' });
      }
    }
  });

  return app;
}

/**
 * Start listening for PostgreSQL NOTIFY events and broadcast to SSE clients.
 *
 * Acquires a dedicated client from the pool and issues `LISTEN ticket_changes`.
 * The client is intentionally **not** released so the LISTEN subscription
 * survives normal pool churn. On connection error the listener reconnects
 * automatically after a 3-second delay.
 *
 * @returns Resolves when the LISTEN query succeeds
 * @throws Re-throws if the initial `LISTEN` query fails (client is released)
 */
export async function startNotifyListener(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('LISTEN ticket_changes');
    logger.info('Listening for ticket_changes notifications');

    client.on('notification', (msg) => {
      if (msg.channel === 'ticket_changes' && msg.payload) {
        const sseData = `data: ${msg.payload}\n\n`;
        for (const client of sseClients) {
          client.write(sseData);
        }
        logger.debug({ payload: msg.payload }, 'SSE broadcast');
      }
    });

    client.on('error', (err) => {
      logger.error({ err }, 'NOTIFY listener error, reconnecting...');
      // Reconnect after a brief delay
      setTimeout(() => {
        startNotifyListener().catch((e) =>
          logger.error({ err: e }, 'Failed to restart NOTIFY listener'),
        );
      }, 3000);
    });
  } catch (err) {
    client.release();
    throw err;
  }
  // NOTE: do NOT release — client must stay connected for LISTEN
}

/**
 * Release expired claims on a recurring interval.
 *
 * Calls the `release_expired_claims()` SQL function periodically
 * and logs the count of released claims when non-zero.
 *
 * @param intervalMs - Reconciliation interval in milliseconds
 * @returns Timer handle (pass to `clearInterval` to stop the loop)
 */
export function startReconciliationLoop(intervalMs: number): NodeJS.Timeout {
  return setInterval(async () => {
    try {
      const result = await pool.query<{ released_count: number }>(
        'SELECT * FROM release_expired_claims()',
      );
      const released = result.rows[0]?.released_count ?? 0;
      if (released > 0) {
        logger.info({ released }, 'Reconciliation: released expired claims');
      }
    } catch (err) {
      logger.error({ err }, 'Reconciliation loop failed');
    }
  }, intervalMs);
}

/**
 * Broadcast a JSON message to all connected SSE clients.
 *
 * @param data - Payload object serialized as `data: {...}\n\n`
 */
export function broadcastSSE(data: Record<string, unknown>): void {
  const sseData = `data: ${JSON.stringify(data)}\n\n`;
  for (const client of sseClients) {
    client.write(sseData);
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
