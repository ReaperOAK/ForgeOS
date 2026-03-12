/**
 * Structured JSON logger and request-logging middleware.
 *
 * Provides:
 * - `logger` — A pino-based singleton logger with JSON output in production
 *   and pretty-printed output in development.
 * - `requestLogger` — Express middleware that logs every HTTP request with
 *   structured fields: timestamp, method, url, statusCode, durationMs,
 *   requestId, userAgent, and contentLength.
 *
 * Duration is measured with `Date.now()` for millisecond precision.
 * Request IDs are generated via `crypto.randomUUID()` or extracted from
 * the incoming `X-Request-ID` header.
 *
 * @module middleware/logging
 * @ticket TASK-FOS-02-003
 */

import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Singleton pino logger.
 *
 * - In production (`NODE_ENV=production`), emits raw JSON lines
 *   suitable for log aggregators (ELK, Datadog, etc.).
 * - In all other environments, uses `pino-pretty` for human-readable
 *   coloured output.
 * - Log level defaults to `info` and can be overridden via `LOG_LEVEL`.
 * - Uses ISO 8601 timestamps via an inline isoTime function.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  timestamp: () => `,"time":"${new Date().toISOString()}"`,
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/**
 * Express middleware that assigns a UUID v4 request ID.
 *
 * - Reads `x-request-id` from the incoming request headers.
 * - If present and non-empty, reuses it; otherwise generates via `randomUUID()`.
 * - Sets `req.requestId` and echoes in the `X-Request-ID` response header.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const existing = req.headers['x-request-id'];
  const requestId =
    typeof existing === 'string' && existing.length > 0
      ? existing
      : randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}

/**
 * Express middleware that logs each request on response finish.
 *
 * On response finish:
 * - Logs method, path, url, statusCode, durationMs, requestId (if present),
 *   userAgent, contentLength.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startMs = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startMs;

    const logData: Record<string, unknown> = {
      method: req.method,
      path: req.path,
      url: req.url,
      statusCode: res.statusCode,
      durationMs,
      userAgent: req.headers['user-agent'],
      contentLength: res.getHeader('content-length'),
    };

    if (req.requestId !== undefined) {
      logData.requestId = req.requestId;
    }

    logger.info(logData, 'request completed');
  });

  next();
}
