/**
 * Structured logger — lightweight pino wrapper.
 *
 * **STUB:** This is a minimal placeholder required by pool.ts and server.ts.
 * The full implementation will be delivered by the middleware/logging ticket.
 * Provides the `logger` singleton and `requestLogger` Express middleware
 * expected by downstream modules.
 *
 * @module middleware/logging
 */

import pino from 'pino';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/**
 * Express request-logging middleware (no-op stub).
 *
 * Logs method, url, status code, and response time for every request.
 */
export function requestLogger(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
): void {
  const start = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        durationMs: Date.now() - start,
      },
      'request',
    );
  });
  next();
}
