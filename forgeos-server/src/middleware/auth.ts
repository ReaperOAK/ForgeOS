/**
 * Authentication middleware — API key verification.
 *
 * **STUB:** This is a minimal placeholder required by server.ts.
 * The full implementation will be delivered by the auth/security ticket.
 * Currently passes all requests through without auth checks.
 *
 * @module middleware/auth
 */

/**
 * Express authentication middleware (pass-through stub).
 */
export function authMiddleware(
  _req: import('express').Request,
  _res: import('express').Response,
  next: import('express').NextFunction,
): void {
  next();
}
