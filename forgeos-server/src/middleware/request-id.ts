/**
 * Request ID middleware — UUID v4 correlation ID generation.
 *
 * Generates or extracts a unique request ID for every HTTP request,
 * enabling correlation across structured logs, error responses, and
 * downstream service calls.
 *
 * If the incoming request contains an `X-Request-ID` header, that value
 * is reused. Otherwise a new UUID v4 is generated via `crypto.randomUUID()`.
 * The resolved ID is attached to `req.requestId` and echoed back in the
 * `X-Request-ID` response header.
 *
 * @module middleware/request-id
 * @ticket TASK-FOS-02-003
 */

import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Augment the Express `Request` interface with a `requestId` field.
 *
 * This declaration merges into the global `Express.Request` type so that
 * all downstream middleware and route handlers can access `req.requestId`
 * without casting.
 */
declare global {
  namespace Express {
    interface Request {
      /** UUID v4 request correlation ID. Set by {@link requestIdMiddleware}. */
      requestId: string;
    }
  }
}

/** HTTP header used for request correlation. */
const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Express middleware that assigns a UUID v4 request ID.
 *
 * - Reads `X-Request-ID` from the incoming request headers.
 * - If present and non-empty, reuses the provided value.
 * - Otherwise generates a new UUID v4 via `crypto.randomUUID()`.
 * - Sets `req.requestId` for downstream consumption.
 * - Echoes the ID in the `X-Request-ID` response header.
 *
 * @param req - Express request object
 * @param res - Express response object
 * @param next - Express next function
 *
 * @example
 * ```typescript
 * import { requestIdMiddleware } from './middleware/request-id.js';
 * app.use(requestIdMiddleware);
 * ```
 */
export function requestIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const existing = req.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof existing === 'string' && existing.length > 0
      ? existing
      : randomUUID();

  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
}
