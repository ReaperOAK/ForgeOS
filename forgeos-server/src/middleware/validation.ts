/**
 * Request validation middleware — Zod schema enforcement.
 *
 * Provides factory functions that accept a Zod schema and return Express
 * middleware validating the corresponding request segment (body, query,
 * params). On validation failure, a 400 response with field-level error
 * details is returned immediately; the request does not reach the handler.
 *
 * @module middleware/validation
 * @ticket TASK-FOS-02-003
 */

import type { ZodSchema, ZodIssue } from 'zod';
import type { Request, Response, NextFunction } from 'express';

/**
 * Shape of a single field-level validation error returned to the client.
 */
export interface FieldError {
  /** Dot-joined path to the invalid field (e.g. `"evidence.artifacts"`). */
  field: string;
  /** Human-readable error description. */
  message: string;
  /** Zod issue code (e.g. `"invalid_type"`, `"too_small"`). */
  code: string;
}

/**
 * Shape of the 400 validation error response body.
 */
export interface ValidationErrorResponse {
  /** Fixed error identifier. */
  error: 'VALIDATION_ERROR';
  /** Summary message. */
  message: string;
  /** Field-level error details. */
  details: { fields: FieldError[] };
  /** ISO 8601 timestamp. */
  timestamp: string;
}

/**
 * Convert an array of Zod issues into field-level error objects.
 *
 * @param issues - Zod validation issues
 * @returns Array of {@link FieldError} objects
 * @internal
 */
function formatIssues(issues: ZodIssue[]): FieldError[] {
  return issues.map((issue) => ({
    field: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

/**
 * Send a 400 validation error response.
 *
 * @param res    - Express response
 * @param fields - Formatted field errors
 * @internal
 */
function sendValidationError(res: Response, fields: FieldError[]): void {
  const body: ValidationErrorResponse = {
    error: 'VALIDATION_ERROR',
    message: 'Request validation failed',
    details: { fields },
    timestamp: new Date().toISOString(),
  };
  res.status(400).json(body);
}

/**
 * Create middleware that validates `req.body` against a Zod schema.
 *
 * On success the parsed (and potentially transformed/defaulted) data
 * replaces `req.body`, ensuring downstream handlers receive clean input.
 *
 * @typeParam T - The expected body shape after validation
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 *
 * @example
 * ```typescript
 * import { z } from 'zod';
 * import { validateBody } from './middleware/validation.js';
 *
 * const CreateTicketSchema = z.object({
 *   title: z.string().min(1),
 *   type: z.enum(['backend', 'frontend']),
 * });
 *
 * router.post('/tickets', validateBody(CreateTicketSchema), handler);
 * ```
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      sendValidationError(res, formatIssues(result.error.issues));
      return;
    }
    req.body = result.data;
    next();
  };
}

/**
 * Create middleware that validates `req.query` against a Zod schema.
 *
 * @typeParam T - The expected query shape after validation
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      sendValidationError(res, formatIssues(result.error.issues));
      return;
    }
    // Replace query with parsed data
    (req as Request & { query: T }).query = result.data as T & Record<string, string>;
    next();
  };
}

/**
 * Create middleware that validates `req.params` against a Zod schema.
 *
 * @typeParam T - The expected params shape after validation
 * @param schema - Zod schema to validate against
 * @returns Express middleware function
 */
export function validateParams<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (!result.success) {
      sendValidationError(res, formatIssues(result.error.issues));
      return;
    }
    req.params = result.data as Record<string, string>;
    next();
  };
}
