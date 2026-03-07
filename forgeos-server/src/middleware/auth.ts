/**
 * Authentication and authorization middleware for the ForgeOS MCP server.
 *
 * Implements API key authentication via `Authorization: Bearer <key>` headers
 * with SHA-256 hash lookup in the `agents` table. Enforces role-based
 * permission checking and populates `req.agent` with the authenticated
 * agent's identity on success.
 *
 * Public paths (e.g., `/health`) are exempt from authentication.
 *
 * @module middleware/auth
 * @ticket TASK-FOS-04-001
 */

import type { Request, Response, NextFunction } from 'express';
import { validateApiKey } from '../auth/keys.js';
import { hasPermission } from '../auth/roles.js';
import { logger } from './logging.js';
import { ForgeOSErrorCode } from '../types/index.js';
import type { AgentIdentity } from '../types/index.js';

// ── Public Path Detection ────────────────────────────────────────────────────

/** Path prefixes exempt from authentication. */
const PUBLIC_PATH_PREFIXES: readonly string[] = ['/health'];

/**
 * Check whether a request path is exempt from authentication.
 *
 * @param path - The request path (e.g., `/health`, `/health/ready`)
 * @returns `true` if the path does not require authentication
 */
function isPublicPath(path: string): boolean {
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

// ── Token Extraction ─────────────────────────────────────────────────────────

/**
 * Extract the bearer token from an Authorization header value.
 *
 * Returns the token portion after `"Bearer "`, trimmed of whitespace.
 * Returns `null` if the header is missing, empty, uses a non-Bearer
 * scheme, or contains no token after the prefix.
 *
 * @param header - The value of the `Authorization` header (may be undefined)
 * @returns The extracted token string, or `null` if invalid
 */
export function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  if (!header.startsWith('Bearer ')) {
    return null;
  }

  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

// ── Error Response Helpers ───────────────────────────────────────────────────

/**
 * Send a 401 Unauthorized JSON response.
 *
 * @param res - Express response object
 * @param message - Human-readable error description
 */
function sendUnauthorized(res: Response, message: string): void {
  res.status(401).json({
    error: ForgeOSErrorCode.UNAUTHORIZED,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Send a 403 Forbidden JSON response.
 *
 * @param res - Express response object
 * @param message - Human-readable error description
 * @param details - Additional context for the error
 */
function sendForbidden(
  res: Response,
  message: string,
  details: Record<string, unknown>,
): void {
  res.status(403).json({
    error: ForgeOSErrorCode.FORBIDDEN,
    message,
    details,
    timestamp: new Date().toISOString(),
  });
}

// ── Authentication Middleware ────────────────────────────────────────────────

/**
 * Express middleware that authenticates requests using API key bearer tokens.
 *
 * Flow:
 * 1. If the path is public (e.g., `/health`), skip authentication.
 * 2. Extract the bearer token from the `Authorization` header.
 * 3. Validate the token via SHA-256 hash lookup in the `agents` table.
 * 4. Populate `req.agent` with the authenticated agent's identity.
 * 5. Return 401 for missing, invalid, or revoked tokens.
 *
 * @param req - Express request (extended with `agent` on success)
 * @param res - Express response
 * @param next - Express next function
 */
export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Public paths bypass authentication
  if (isPublicPath(req.path)) {
    next();
    return;
  }

  // Extract bearer token
  const token = extractBearerToken(req.headers.authorization);
  if (!token) {
    sendUnauthorized(
      res,
      'Missing or malformed Authorization header. Expected: Bearer <api-key>',
    );
    return;
  }

  // Validate API key via SHA-256 hash lookup
  let identity: AgentIdentity | null;
  try {
    identity = await validateApiKey(token);
  } catch (err: unknown) {
    logger.error(
      {
        event: 'auth_validation_error',
        error: err instanceof Error ? err.message : String(err),
        requestId: (req as unknown as Record<string, unknown>).requestId,
        operation: 'authMiddleware',
      },
      'Authentication service unavailable',
    );
    sendUnauthorized(
      res,
      'Authentication service unavailable. Please try again later.',
    );
    return;
  }

  if (!identity) {
    sendUnauthorized(res, 'Invalid or revoked API key.');
    return;
  }

  // Populate request with agent identity
  (req as unknown as Record<string, unknown>).agent = identity;

  logger.debug(
    {
      event: 'auth_success',
      agentId: identity.id,
      agentName: identity.name,
      agentRole: identity.role,
      requestId: (req as unknown as Record<string, unknown>).requestId,
      operation: 'authMiddleware',
    },
    'Request authenticated',
  );

  next();
}

// ── Authorization Middleware ─────────────────────────────────────────────────

/**
 * Express middleware factory that enforces a required permission.
 *
 * Must be used after `authMiddleware` in the middleware chain. Returns:
 * - 401 if `req.agent` is not populated (unauthenticated request).
 * - 403 if the agent's permissions do not include the required permission.
 *
 * @param permission - The permission string to require (e.g., `"tickets.claim"`)
 * @returns Express middleware function
 */
export function requirePermission(
  permission: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req: Request, res: Response, next: NextFunction): void => {
    const agent = (req as unknown as Record<string, unknown>).agent as AgentIdentity | undefined;

    if (!agent) {
      sendUnauthorized(
        res,
        'Authentication required. No agent identity found on request.',
      );
      return;
    }

    if (!hasPermission(agent.permissions, permission)) {
      sendForbidden(
        res,
        `Insufficient permissions. Required: ${permission}`,
        {
          required: permission,
          role: agent.role,
          granted: agent.permissions,
        },
      );
      return;
    }

    next();
  };
}
