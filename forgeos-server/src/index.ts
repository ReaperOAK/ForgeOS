/**
 * ForgeOS MCP Server — Entry point.
 *
 * Loads configuration, runs migrations, starts the Express/MCP server,
 * sets up PostgreSQL LISTEN/NOTIFY, and handles graceful shutdown.
 * @module index
 */

import { config } from './config.js';
import { runMigrations } from './db/migrate.js';
import { closePool } from './db/pool.js';
import { logger } from './middleware/logging.js';
import {
  createApp,
  startNotifyListener,
  startReconciliationLoop,
} from './server.js';

/**
 * Application entry point.
 *
 * Executes the boot sequence in order:
 * 1. Run database migrations
 * 2. Create the Express/MCP application
 * 3. Start the HTTP server on the configured port
 * 4. Start the PostgreSQL NOTIFY listener for SSE
 * 5. Start the reconciliation loop for expired claims
 * 6. Register graceful shutdown handlers
 *
 * @returns Resolves when the server is fully started
 * @throws Exits with code 1 if boot fails (migration error, port conflict, etc.)
 */
async function main(): Promise<void> {
  logger.info({
    nodeEnv: config.NODE_ENV,
    port: config.PORT,
    logLevel: config.LOG_LEVEL,
  }, 'ForgeOS MCP Server starting');

  // ── 1. Run database migrations ────────────────────
  logger.info('Running database migrations...');
  await runMigrations();
  logger.info('Migrations complete');

  // ── 2. Create Express app ─────────────────────────
  const app = createApp(config);

  // ── 3. Start HTTP server ──────────────────────────
  const server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'ForgeOS MCP Server listening');
    logger.info(`  MCP endpoint:  http://localhost:${config.PORT}/mcp`);
    logger.info(`  Health check:  http://localhost:${config.PORT}/health`);
    logger.info(`  SSE events:    http://localhost:${config.PORT}/events`);
    logger.info(`  Dashboard:     http://localhost:${config.PORT}/dashboard`);
  });

  // ── 4. Start NOTIFY listener for SSE ──────────────
  try {
    await startNotifyListener();
  } catch (err) {
    logger.error({ err }, 'Failed to start NOTIFY listener (SSE will not work)');
  }

  // ── 5. Start reconciliation loop ──────────────────
  const reconciliationMs = config.RECONCILIATION_INTERVAL * 1000;
  const reconciliationTimer = startReconciliationLoop(reconciliationMs);
  logger.info(
    { intervalSeconds: config.RECONCILIATION_INTERVAL },
    'Reconciliation loop started',
  );

  // ── 6. Graceful shutdown ──────────────────────────
  /**
   * Graceful shutdown handler.
   *
   * Stops the reconciliation loop, closes the HTTP server (draining
   * in-flight requests), and closes the database pool. Forces exit
   * after 10 seconds if draining stalls.
   *
   * @param signal - Name of the signal that triggered shutdown
   */
  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down...');

    clearInterval(reconciliationTimer);

    server.close(async () => {
      logger.info('HTTP server closed');
      await closePool();
      logger.info('Database pool closed');
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Unhandled rejection / uncaught exception safety
  process.on('unhandledRejection', (err) => {
    logger.error({ err }, 'Unhandled rejection');
  });

  process.on('uncaughtException', (err) => {
    logger.fatal({ err }, 'Uncaught exception — shutting down');
    void shutdown('uncaughtException');
  });
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start ForgeOS MCP Server');
  process.exit(1);
});
