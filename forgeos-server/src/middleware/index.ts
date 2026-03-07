/**
 * Middleware barrel export.
 *
 * Re-exports all middleware functions from a single entry point.
 * Mount order for Express:
 *
 * 1. `requestIdMiddleware` — sets `req.requestId`
 * 2. `requestLogger` — logs request with requestId
 * 3. `authMiddleware` — authenticates the request
 * 4. Route handlers (with optional `validateBody` / `validateQuery` / `validateParams`)
 * 5. `errorHandler` — catches unhandled errors (must be last)
 *
 * @module middleware
 * @ticket TASK-FOS-02-003
 */

export { requestIdMiddleware } from './request-id.js';
export { logger, requestLogger } from './logging.js';
export { authMiddleware } from './auth.js';
export {
  errorHandler,
  withErrorHandling,
  mapPgErrorCode,
  httpStatusForCode,
} from './error-handler.js';
export type { ForgeOSAppError, McpErrorContent } from './error-handler.js';
export { validateBody, validateQuery, validateParams } from './validation.js';
export type { FieldError, ValidationErrorResponse } from './validation.js';
