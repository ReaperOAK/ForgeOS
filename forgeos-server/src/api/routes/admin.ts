/**
 * Admin REST Routes — agent registration and management.
 *
 * Endpoints:
 * - POST   /api/admin/agents            — Register a new agent
 * - GET    /api/admin/agents            — List registered agents (paginated)
 * - POST   /api/admin/agents/:id/revoke — Revoke agent's API key
 * - DELETE /api/admin/agents/:id        — Deregister (soft-delete) agent
 *
 * All endpoints require admin role authentication. Non-admin callers
 * receive 403 Forbidden. Authentication is enforced by the parent
 * router's `authMiddleware`, and admin authorization is enforced by
 * `requirePermission(ADMIN_MANAGE_KEYS)` applied to all routes.
 *
 * @module api/routes/admin
 * @ticket TASK-FOS-04-002
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { z } from 'zod';
import { requirePermission } from '../../middleware/auth.js';
import { validateBody, validateQuery, validateParams } from '../../middleware/validation.js';
import { logger } from '../../middleware/logging.js';
import { PERMISSIONS } from '../../auth/roles.js';
import {
  registerAgent,
  registerAgentSchema,
  listAgents,
  listAgentsSchema,
  revokeAgent,
  deregisterAgent,
  createOrUpdateSession,
  createSessionSchema,
  AgentAlreadyExistsError,
  InvalidRoleError,
  AgentNotFoundError,
} from '../../auth/registration.js';

// ── Param Schemas ────────────────────────────────────────────────────────────

/**
 * Zod schema for agent UUID path parameter.
 */
const agentIdParamSchema = z.object({
  id: z.string().uuid('Invalid agent ID format — must be a UUID'),
});

// ── Router ───────────────────────────────────────────────────────────────────

export const adminRouter = Router();

// All admin routes require admin.manage_keys permission
adminRouter.use(requirePermission(PERMISSIONS.ADMIN_MANAGE_KEYS));

// ── POST /agents — Register Agent ────────────────────────────────────────────

/**
 * Register a new agent.
 *
 * Creates an agent record with the specified name and role, generates
 * a cryptographic API key, and returns the agent identity along with
 * the plaintext key (shown exactly once).
 *
 * @route POST /api/admin/agents
 * @body {name: string, role: string, machine_id?: string}
 * @returns 201 {agent: Agent, api_key: string}
 * @returns 400 if role is invalid or body validation fails
 * @returns 409 if agent name+role already exists
 */
adminRouter.post(
  '/agents',
  validateBody(registerAgentSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await registerAgent(req.body);

      logger.info(
        {
          event: 'admin_agent_registered',
          agentId: result.agent.id,
          agentName: result.agent.name,
          requestId: req.requestId,
          operation: 'POST /api/admin/agents',
        },
        'Agent registered via admin API',
      );

      res.status(201).json(result);
    } catch (err) {
      if (err instanceof AgentAlreadyExistsError) {
        res.status(409).json({
          error: 'AGENT_ALREADY_EXISTS',
          message: err.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      if (err instanceof InvalidRoleError) {
        res.status(400).json({
          error: 'INVALID_ROLE',
          message: err.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(err);
    }
  },
);

// ── GET /agents — List Agents ────────────────────────────────────────────────

/**
 * List all registered agents (paginated).
 *
 * Returns agents ordered by creation date (newest first). No key
 * hashes are included in the response.
 *
 * @route GET /api/admin/agents
 * @query {limit?: number, offset?: number}
 * @returns 200 {data: Agent[], pagination: {...}}
 */
adminRouter.get(
  '/agents',
  validateQuery(listAgentsSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await listAgents(
        req.query as unknown as z.infer<typeof listAgentsSchema>,
      );
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// ── POST /agents/:id/revoke — Revoke API Key ────────────────────────────────

/**
 * Revoke an agent's API key.
 *
 * Sets `revoked_at` timestamp and `is_active = false`. Subsequent
 * requests with the revoked key will receive 401 Unauthorized.
 *
 * @route POST /api/admin/agents/:id/revoke
 * @param id - Agent UUID
 * @returns 200 {agent: Agent, message: string}
 * @returns 404 if agent not found
 */
adminRouter.post(
  '/agents/:id/revoke',
  validateParams(agentIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = req.params.id as string;
      const agent = await revokeAgent(agentId);

      logger.info(
        {
          event: 'admin_agent_revoked',
          agentId,
          requestId: req.requestId,
          operation: 'POST /api/admin/agents/:id/revoke',
        },
        'Agent key revoked via admin API',
      );

      res.json({ agent, message: 'API key revoked successfully' });
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        res.status(404).json({
          error: 'AGENT_NOT_FOUND',
          message: err.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(err);
    }
  },
);

// ── DELETE /agents/:id — Deregister Agent ────────────────────────────────────

/**
 * Deregister (soft-delete) an agent.
 *
 * Revokes the API key, deactivates the agent, and expires all
 * active sessions. The record is preserved for audit.
 *
 * @route DELETE /api/admin/agents/:id
 * @param id - Agent UUID
 * @returns 200 {agent: Agent, message: string}
 * @returns 404 if agent not found
 */
adminRouter.delete(
  '/agents/:id',
  validateParams(agentIdParamSchema),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const agentId = req.params.id as string;
      const agent = await deregisterAgent(agentId);

      logger.info(
        {
          event: 'admin_agent_deregistered',
          agentId,
          requestId: req.requestId,
          operation: 'DELETE /api/admin/agents/:id',
        },
        'Agent deregistered via admin API',
      );

      res.json({ agent, message: 'Agent deregistered successfully' });
    } catch (err) {
      if (err instanceof AgentNotFoundError) {
        res.status(404).json({
          error: 'AGENT_NOT_FOUND',
          message: err.message,
          timestamp: new Date().toISOString(),
        });
        return;
      }
      next(err);
    }
  },
);

// ── POST /agents/:id/sessions — Create/Update Session ────────────────────────

/**
 * Create or update a session for an agent.
 *
 * Binds an MCP session token to an agent, enabling session-level
 * tracking. Updates `last_seen` on conflict (existing session_token).
 *
 * @route POST /api/admin/agents/:id/sessions
 * @param id - Agent UUID
 * @body {session_token: string, machine_id: string, operator?: string, ip_address?: string, expires_in_minutes?: number}
 * @returns 200 Session record
 */
adminRouter.post(
  '/agents/:id/sessions',
  validateParams(agentIdParamSchema),
  validateBody(createSessionSchema.omit({ agent_id: true })),
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const session = await createOrUpdateSession({
        agent_id: req.params.id,
        ...req.body,
      });

      logger.info(
        {
          event: 'admin_session_created',
          agentId: req.params.id,
          sessionToken: session.session_token,
          requestId: req.requestId,
          operation: 'POST /api/admin/agents/:id/sessions',
        },
        'Agent session created/updated via admin API',
      );

      res.json(session);
    } catch (err) {
      next(err);
    }
  },
);
