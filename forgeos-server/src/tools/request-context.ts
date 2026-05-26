/**
 * Request-scoped context via AsyncLocalStorage.
 *
 * Bridges the authenticated Express request identity (`req.agent`, set by
 * `authMiddleware`) into MCP tool handlers. Since MCP SDK tool handlers
 * are closures created during tool registration — not Express route
 * handlers — they do not have direct access to `req`. AsyncLocalStorage
 * provides a per-request async scope that any downstream call can read.
 *
 * # Trust Boundary
 *
 * The value stored here is the **authenticated** `AgentIdentity` that was
 * validated by `authMiddleware` via the `Authorization: Bearer <key>`
 * header. MCP tool handlers **must** call `getRequestAgent()` instead of
 * accepting caller-supplied agent metadata in their Zod schemas.
 *
 * This removes caller-supplied identity as a trust anchor.  Without a
 * valid session established by the auth middleware, `getRequestAgent()`
 * throws, causing the handler to return `UNAUTHORIZED` — even if the
 * caller passed valid-looking agent metadata.
 *
 * @module tools/request-context
 * @ticket TASK-COP-MCP003
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import type { AgentIdentity } from '../types/index.js';

/** The per-request store containing the authenticated agent identity. */
export interface RequestStore {
  /** Authenticated agent identity, validated by authMiddleware. */
  agent: AgentIdentity;
}

/**
 * Global AsyncLocalStorage instance for request-scoped agent identity.
 *
 * Initialized in `server.ts` before each MCP request is dispatched.
 * Must be read after `authMiddleware` has run.
 */
export const requestContext = new AsyncLocalStorage<RequestStore>();

/**
 * Retrieve the authenticated agent identity from the current request scope.
 *
 * Call from any MCP tool handler to obtain the caller's validated
 * identity. Throws if no request context is active — this indicates a
 * programming error (handler invoked outside an HTTP request) or an
 * authentication bypass.
 *
 * @returns The validated {@link AgentIdentity}
 * @throws Error if no request context is active
 *
 * @example
 * ```ts
 * import { getRequestAgent } from './request-context.js';
 *
 * export async function myHandler(params: Input): Promise<CallToolResult> {
 *   const agent = getRequestAgent();
 *   // agent.id, agent.name, agent.permissions, ...
 * }
 * ```
 */
export function getRequestAgent(): AgentIdentity {
  const store = requestContext.getStore();
  if (!store?.agent) {
    throw new Error(
      'No authenticated agent in request context. '
      + 'This handler requires a valid bearer token.',
    );
  }
  return store.agent;
}