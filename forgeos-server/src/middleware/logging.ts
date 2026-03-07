/**
 * Structured JSON logger and request-logging middleware.
 *
 * Provides:
 * - `logger` — A pino-based singleton logger with JSON output in production
 *   and pretty-printed output in development.
 * - `requestLogger` — Express middleware that logs every HTTP request with
 *   structured fields: timestamp, method, path, statusCode, durationMs,
 *   requestId, userAgent, and contentLength.
 *
 * Duration is measured with `process.hrtime.bigint()` for sub-millisecond
 * precision. The `requestId` field is populated by the upstream
 * {@link requestIdMiddleware} — if absent, it is omitted from the log line.
 *
 * @module middleware/logging
 * @ticket TASK-FOS-02-003
 */

import pino from 'pino';
import type { Request, Response, NextFunction } from 'express';

/**
 * Singleton pino logger.
 *
 * - In production (`NODE_ENV=production`), emits raw JSON lines
 *   suitable for log aggregators (ELK, Datadog, etc.).
 * - In all other environments, uses `pino-pretty` for human-readable
 *   coloured output.
 * - Log level defaults to `info` and can be overridden via `LOG_LEVEL`.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/**
 * Express middleware that emits a structured JSON log line for every request.
 *
 * Attaches a `finish` listener on the response object. When the response
 * completes, the middleware logs:
 *
 * | Field           | Source                            |
 * |-----------------|-----------------------------------|
 * | `method`        | `req.method`                      |
 * | `path`          | `req.path`                        |
 * | `statusCode`    | `res.statusCode`                  |
 * | `durationMs`    | `process.hrtime.bigint()` delta   |
 * | `requestId`     | `req.requestId` (if present)      |
 * | `userAgent`     | `User-Agent` header               |
 * | `contentLength` | `Content-Length` response header   |
 *
 * @param req - Express request object (should have `requestId` from upstream middleware)
 * @param res - Express response object
 * @param next - Express next function
 *
 * @example
 * ```typescript
 * import { requestIdMiddleware } from './middleware/request-id.js';
 * import { requestLogger } from './middleware/logging.js';
 *
 * app.use(requestIdMiddleware);
 * app.use(requestLogger);
 * ```
 */
export function requestLogger(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const startNs = process.hrtime.bigint();

  res.on('finish', () => {
    const durationNs = process.hrtime.bigint() - startNs;
    const durationMs = Number(durationNs) / 1_000_000;

    logger.info(
      {
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        ...(req.requestId && { requestId: req.requestId }),
        userAgent: req.headers['user-agent'],
        contentLength: res.getHeader('content-length'),
      },
      'request completed',
    );
  });

  next();
}
