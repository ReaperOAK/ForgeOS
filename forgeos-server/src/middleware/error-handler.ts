/**
 * Error handling middleware and MCP tool error wrapper.
 *
 * Provides two main exports:
 *
 * 1. **`errorHandler`** — Express error-handling middleware (4-arg signature).
 *    Catches all unhandled errors, maps PostgreSQL error codes to
 *    {@link ForgeOSErrorCode} values, and returns a structured
 *    {@link ErrorResponse} JSON body. In production, stack traces and
 *    internal details are never leaked to the client.
 *
 * 2. **`withErrorHandling`** — Generic async wrapper for MCP tool handlers.
 *    Catches thrown errors and returns them as structured MCP text content
 *    responses so that tool invocations never crash the transport.
 *
 * @module middleware/error-handler
 * @ticket TASK-FOS-02-003
 */

import type { Request, Response, NextFunction } from 'express';
import { ForgeOSErrorCode } from '../types/index.js';
import type { ErrorResponse } from '../types/index.js';
import { logger } from './logging.js';

// ── PostgreSQL Error Code → ForgeOS Error Code Map ───────────────────────────

/**
 * Maps well-known PostgreSQL SQLSTATE codes to ForgeOS error codes.
 *
 * @see https://www.postgresql.org/docs/current/errcodes-appendix.html
 * @internal
 */
const PG_ERROR_MAP: Record<string, ForgeOSErrorCode> = {
  /* Class 08 — Connection Exception */
  '08000': ForgeOSErrorCode.DB_UNAVAILABLE,
  '08001': ForgeOSErrorCode.DB_UNAVAILABLE,
  '08003': ForgeOSErrorCode.DB_UNAVAILABLE,
  '08004': ForgeOSErrorCode.DB_UNAVAILABLE,
  '08006': ForgeOSErrorCode.DB_UNAVAILABLE,

  /* Class 23 — Integrity Constraint Violation */
  '23502': ForgeOSErrorCode.INTERNAL_ERROR,       // not_null_violation
  '23503': ForgeOSErrorCode.TICKET_NOT_FOUND,     // foreign_key_violation
  '23505': ForgeOSErrorCode.ALREADY_CLAIMED,       // unique_violation

  /* Class 40 — Transaction Rollback */
  '40001': ForgeOSErrorCode.INTERNAL_ERROR,        // serialization_failure
  '40P01': ForgeOSErrorCode.INTERNAL_ERROR,        // deadlock_detected

  /* Class 42 — Syntax / Access Rule */
  '42P01': ForgeOSErrorCode.DB_UNAVAILABLE,        // undefined_table

  /* Class 57 — Operator Intervention */
  '57P01': ForgeOSErrorCode.DB_UNAVAILABLE,        // admin_shutdown
  '57P02': ForgeOSErrorCode.DB_UNAVAILABLE,        // crash_shutdown
  '57P03': ForgeOSErrorCode.DB_UNAVAILABLE,        // cannot_connect_now
};

// ── ForgeOS Error Code → HTTP Status Map ─────────────────────────────────────

/**
 * Maps {@link ForgeOSErrorCode} to the appropriate HTTP status code.
 *
 * @internal
 */
const HTTP_STATUS_MAP: Record<ForgeOSErrorCode, number> = {
  [ForgeOSErrorCode.TICKET_NOT_FOUND]: 404,
  [ForgeOSErrorCode.ALREADY_CLAIMED]: 409,
  [ForgeOSErrorCode.NOT_CLAIM_OWNER]: 403,
  [ForgeOSErrorCode.FILE_CONFLICT]: 409,
  [ForgeOSErrorCode.INVALID_TRANSITION]: 400,
  [ForgeOSErrorCode.MISSING_EVIDENCE]: 400,
  [ForgeOSErrorCode.INVALID_SUBTASK]: 400,
  [ForgeOSErrorCode.LEASE_EXPIRED]: 410,
  [ForgeOSErrorCode.LEASE_TOO_LONG]: 400,
  [ForgeOSErrorCode.RATE_LIMITED]: 429,
  [ForgeOSErrorCode.UNAUTHORIZED]: 401,
  [ForgeOSErrorCode.FORBIDDEN]: 403,
  [ForgeOSErrorCode.INTERNAL_ERROR]: 500,
  [ForgeOSErrorCode.DB_UNAVAILABLE]: 503,
};

// ── Error Type Guards ────────────────────────────────────────────────────────

/**
 * Shape of a `pg` library DatabaseError.
 *
 * @internal
 */
interface PgDatabaseError extends Error {
  code?: string;
  detail?: string;
  constraint?: string;
  schema?: string;
  table?: string;
}

/**
 * Application-level error carrying ForgeOS error metadata.
 *
 * Throw this from service/repository layers to specify the exact
 * error code and HTTP status that the error handler should return.
 */
export interface ForgeOSAppError extends Error {
  statusCode?: number;
  errorCode?: ForgeOSErrorCode;
  details?: Record<string, unknown>;
  ticketId?: string;
}

/**
 * Determine whether an error originates from the `pg` library.
 *
 * @param err - Error to inspect
 * @returns `true` if the error has a PostgreSQL-style `code` property
 * @internal
 */
function isPgError(err: unknown): err is PgDatabaseError {
  return (
    err instanceof Error &&
    'code' in err &&
    typeof (err as PgDatabaseError).code === 'string'
  );
}

/**
 * Determine whether an error carries ForgeOS application metadata.
 *
 * @param err - Error to inspect
 * @returns `true` if the error has an `errorCode` property
 * @internal
 */
function isForgeOSError(err: unknown): err is ForgeOSAppError {
  return (
    err instanceof Error &&
    'errorCode' in err &&
    typeof (err as ForgeOSAppError).errorCode === 'string'
  );
}

/**
 * Map a PostgreSQL SQLSTATE code to a ForgeOS error code.
 *
 * @param pgCode - PostgreSQL SQLSTATE (e.g. `'23505'`)
 * @returns Mapped ForgeOS error code, or `INTERNAL_ERROR` if unknown
 * @internal
 */
export function mapPgErrorCode(pgCode: string): ForgeOSErrorCode {
  return PG_ERROR_MAP[pgCode] ?? ForgeOSErrorCode.INTERNAL_ERROR;
}

/**
 * Resolve the HTTP status code for a ForgeOS error code.
 *
 * @param code - ForgeOS error code
 * @returns HTTP status code
 * @internal
 */
export function httpStatusForCode(code: ForgeOSErrorCode): number {
  return HTTP_STATUS_MAP[code] ?? 500;
}

// ── Express Error Handler ────────────────────────────────────────────────────

/**
 * Express error-handling middleware (4-argument signature).
 *
 * Catches all errors propagated via `next(err)` and returns a structured
 * {@link ErrorResponse} JSON body. Error classification follows this
 * priority:
 *
 * 1. **ForgeOSAppError** — uses the embedded `errorCode` and `statusCode`.
 * 2. **PgDatabaseError** — maps the PostgreSQL `code` via {@link PG_ERROR_MAP}.
 * 3. **Generic Error** — falls back to `INTERNAL_ERROR` / 500.
 *
 * In production (`NODE_ENV=production`):
 * - Stack traces are **never** included in the response.
 * - The `message` field is replaced with a generic string.
 *
 * @param err  - The thrown or propagated error
 * @param req  - Express request (used for `requestId` and path logging)
 * @param res  - Express response (JSON error body is written here)
 * @param _next - Express next (unused; required for Express error-handler signature)
 */
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const isProduction = process.env.NODE_ENV === 'production';

  let errorCode: ForgeOSErrorCode = ForgeOSErrorCode.INTERNAL_ERROR;
  let statusCode = 500;
  let details: Record<string, unknown> | undefined;
  let ticketId: string | undefined;

  if (isForgeOSError(err)) {
    errorCode = err.errorCode ?? ForgeOSErrorCode.INTERNAL_ERROR;
    statusCode = err.statusCode ?? httpStatusForCode(errorCode);
    details = err.details;
    ticketId = err.ticketId;
  } else if (isPgError(err)) {
    errorCode = mapPgErrorCode(err.code ?? '');
    statusCode = httpStatusForCode(errorCode);
  }

  // Structured error log — always includes full context for debugging
  logger.error(
    {
      err: isProduction ? { message: err.message } : err,
      errorCode,
      statusCode,
      requestId: req.requestId,
      method: req.method,
      path: req.path,
    },
    'Request error',
  );

  const response: ErrorResponse = {
    error: errorCode,
    message: isProduction ? 'An error occurred' : err.message,
    timestamp: new Date().toISOString(),
    ...(details && { details }),
    ...(ticketId && { ticket_id: ticketId }),
  };

  res.status(statusCode).json(response);
}

// ── MCP Tool Error Wrapper ───────────────────────────────────────────────────

/**
 * MCP content response shape returned by {@link withErrorHandling} on failure.
 */
export interface McpErrorContent {
  content: Array<{ type: 'text'; text: string }>;
}

/**
 * Wrap an async MCP tool handler with error handling.
 *
 * Catches any thrown error, maps it to a {@link ForgeOSErrorCode},
 * and returns a structured MCP text content response instead of
 * letting the error crash the transport.
 *
 * @typeParam T - The success return type of the handler
 * @param handler - Async function implementing the MCP tool logic
 * @returns The handler's result on success, or an {@link McpErrorContent} on failure
 *
 * @example
 * ```typescript
 * const result = await withErrorHandling(async () => {
 *   const ticket = await ticketRepo.findById(id);
 *   if (!ticket) throw Object.assign(new Error('Not found'), {
 *     errorCode: ForgeOSErrorCode.TICKET_NOT_FOUND,
 *   });
 *   return { content: [{ type: 'text', text: JSON.stringify(ticket) }] };
 * });
 * ```
 */
export async function withErrorHandling<T>(
  handler: () => Promise<T>,
): Promise<T | McpErrorContent> {
  try {
    return await handler();
  } catch (thrown: unknown) {
    const err = thrown instanceof Error ? thrown : new Error(String(thrown));

    let errorCode: ForgeOSErrorCode = ForgeOSErrorCode.INTERNAL_ERROR;

    if (isForgeOSError(err)) {
      errorCode = err.errorCode ?? ForgeOSErrorCode.INTERNAL_ERROR;
    } else if (isPgError(err)) {
      errorCode = mapPgErrorCode(err.code ?? '');
    }

    const errorResponse: ErrorResponse = {
      error: errorCode,
      message: err.message,
      timestamp: new Date().toISOString(),
    };

    logger.error({ err, errorCode }, 'MCP tool handler error');

    return {
      content: [{ type: 'text' as const, text: JSON.stringify(errorResponse) }],
    };
  }
}
