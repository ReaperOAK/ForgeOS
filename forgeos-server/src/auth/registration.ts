/**
 * Agent registration and identity management service.
 *
 * Provides agent lifecycle operations: registration (with API key
 * generation), listing (paginated, no key hashes), revocation,
 * deregistration (soft-delete + session expiry), heartbeat tracking
 * (last_seen via updated_at), and session management.
 *
 * API key management delegates to the {@link module:auth/keys} module.
 * Role validation delegates to {@link module:auth/roles}.
 *
 * @module auth/registration
 * @ticket TASK-FOS-04-002
 */

import { z } from 'zod';
import { getPool } from '../db/pool.js';
import { generateApiKey, revokeApiKey } from './keys.js';
import { isValidRole, getPermissionsForRole } from './roles.js';
import { logger } from '../middleware/logging.js';
import type { Agent } from '../types/index.js';

// ── Input Schemas ────────────────────────────────────────────────────────────

/**
 * Zod schema for agent registration input.
 *
 * @property name - Unique agent name (1–255 characters)
 * @property role - Agent role (must be a valid AgentRole)
 * @property machine_id - Optional default machine identifier
 */
export const registerAgentSchema = z.object({
  name: z.string().min(1).max(255).describe('Unique agent name'),
  role: z.string().min(1).describe('Agent role (e.g., backend, qa, admin)'),
  machine_id: z.string().optional().describe('Default machine identifier'),
});

/**
 * Zod schema for listing agents with pagination.
 *
 * @property limit - Maximum results per page (1–100, default 20)
 * @property offset - Number of results to skip (default 0)
 */
export const listAgentsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Zod schema for session creation/update input.
 *
 * @property agent_id - UUID of the agent
 * @property session_token - MCP session ID
 * @property machine_id - Machine hostname
 * @property operator - Optional human operator
 * @property ip_address - Optional client IP
 * @property expires_in_minutes - Session TTL (5–1440 minutes, default 60)
 */
export const createSessionSchema = z.object({
  agent_id: z.string().uuid().describe('Agent UUID'),
  session_token: z.string().min(1).describe('MCP session token'),
  machine_id: z.string().min(1).describe('Machine hostname'),
  operator: z.string().optional().describe('Human operator name'),
  ip_address: z.string().optional().describe('Client IP address'),
  expires_in_minutes: z.number().int().min(5).max(1440).default(60),
});

// ── Result Types ─────────────────────────────────────────────────────────────

/**
 * Result of agent registration.
 *
 * Contains the created agent (without api_key_hash) and the plaintext
 * API key that is shown exactly once.
 */
export interface RegisterAgentResult {
  /** Agent record without the sensitive hash field. */
  agent: Omit<Agent, 'api_key_hash'>;
  /** Plaintext API key — shown once, never stored or logged. */
  api_key: string;
}

/**
 * Paginated list of agents.
 */
export interface PaginatedAgentList {
  /** Agent records for the current page (no key hashes). */
  data: Array<Omit<Agent, 'api_key_hash'>>;
  /** Pagination metadata. */
  pagination: {
    total: number;
    limit: number;
    offset: number;
    has_more: boolean;
  };
}

/**
 * Session record returned from create/update operations.
 */
export interface SessionResult {
  id: string;
  agent_id: string;
  session_token: string;
  machine_id: string;
  operator: string | null;
  last_seen: string;
  expires_at: string;
}

// ── Domain Errors ────────────────────────────────────────────────────────────

/**
 * Error thrown when attempting to register an agent with a name+role
 * combination that already exists.
 */
export class AgentAlreadyExistsError extends Error {
  readonly statusCode = 409;
  readonly code = 'AGENT_ALREADY_EXISTS';

  constructor(name: string, role: string) {
    super(`Agent already exists: ${name} (${role})`);
    this.name = 'AgentAlreadyExistsError';
  }
}

/**
 * Error thrown when a registration request specifies an unrecognized role.
 */
export class InvalidRoleError extends Error {
  readonly statusCode = 400;
  readonly code = 'INVALID_ROLE';

  constructor(role: string) {
    super(`Invalid agent role: ${role}`);
    this.name = 'InvalidRoleError';
  }
}

/**
 * Error thrown when an agent lookup by ID fails.
 *
 * Re-exported from auth/keys for convenience; uses the same shape.
 */
export class AgentNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'AGENT_NOT_FOUND';

  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}

// ── SQL Fragments ────────────────────────────────────────────────────────────

/** Columns selected for agent responses (excludes api_key_hash). */
const AGENT_SELECT_COLUMNS = `
  id, name, role, permissions, machine_id,
  is_active, revoked_at, created_at, updated_at
`;

// ── Service Functions ────────────────────────────────────────────────────────

/**
 * Register a new agent with the given name and role.
 *
 * Creates the agent record in the `agents` table, generates a
 * cryptographic API key via {@link generateApiKey}, and returns the
 * agent identity with the plaintext key (shown exactly once).
 *
 * The role determines the agent's default permissions via
 * {@link getPermissionsForRole}.
 *
 * @param input - Agent name, role, and optional machine_id
 * @returns The created agent (without hash) and the plaintext API key
 * @throws {@link InvalidRoleError} if the role is not recognized
 * @throws {@link AgentAlreadyExistsError} if name+role combo already exists
 */
export async function registerAgent(
  input: z.infer<typeof registerAgentSchema>,
): Promise<RegisterAgentResult> {
  const { name, role, machine_id } = input;

  if (!isValidRole(role)) {
    throw new InvalidRoleError(role);
  }

  const permissions = getPermissionsForRole(role);
  const pool = getPool();

  // Insert agent record
  let agentId: string;
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO agents (name, role, permissions, machine_id)
       VALUES ($1, $2, $3::JSONB, $4)
       RETURNING id`,
      [name, role, JSON.stringify(permissions), machine_id ?? null],
    );
    agentId = result.rows[0]!.id;
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      'code' in err &&
      (err as { code: string }).code === '23505'
    ) {
      throw new AgentAlreadyExistsError(name, role);
    }
    throw err;
  }

  // Generate API key (stores hash in DB, returns plaintext once)
  const keyResult = await generateApiKey(agentId);

  // Fetch the created agent (without hash)
  const agentResult = await pool.query<Agent>(
    `SELECT ${AGENT_SELECT_COLUMNS} FROM agents WHERE id = $1`,
    [agentId],
  );
  const agent = agentResult.rows[0]!;

  logger.info(
    {
      event: 'agent_registered',
      agentId: agent.id,
      agentName: agent.name,
      agentRole: agent.role,
      operation: 'registerAgent',
    },
    'New agent registered',
  );

  return {
    agent: {
      id: agent.id,
      name: agent.name,
      role: agent.role,
      permissions: agent.permissions,
      machine_id: agent.machine_id,
      is_active: agent.is_active,
      revoked_at: agent.revoked_at,
      created_at: agent.created_at,
      updated_at: agent.updated_at,
    },
    api_key: keyResult.plaintextKey,
  };
}

/**
 * List all registered agents (paginated, no key hashes).
 *
 * Returns agents ordered by creation date (newest first). The
 * `api_key_hash` field is never included in the response.
 *
 * @param params - Pagination parameters (limit, offset)
 * @returns Paginated list of agents without sensitive fields
 */
export async function listAgents(
  params: z.infer<typeof listAgentsSchema>,
): Promise<PaginatedAgentList> {
  const { limit, offset } = params;
  const pool = getPool();

  const countResult = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM agents',
  );
  const total = parseInt(countResult.rows[0]!.count, 10);

  const result = await pool.query<Agent>(
    `SELECT ${AGENT_SELECT_COLUMNS}
       FROM agents
      ORDER BY created_at DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  );

  return {
    data: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      permissions: row.permissions,
      machine_id: row.machine_id,
      is_active: row.is_active,
      revoked_at: row.revoked_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    })),
    pagination: {
      total,
      limit,
      offset,
      has_more: offset + limit < total,
    },
  };
}

/**
 * Revoke an agent's API key.
 *
 * Delegates to {@link revokeApiKey} which sets `api_key_hash = NULL`,
 * `is_active = FALSE`, and `revoked_at = NOW()`. Subsequent requests
 * with the revoked key will receive 401 Unauthorized.
 *
 * @param agentId - UUID of the agent to revoke
 * @returns The updated agent record (without key hash)
 * @throws {@link AgentNotFoundError} if the agent does not exist
 */
export async function revokeAgent(
  agentId: string,
): Promise<Omit<Agent, 'api_key_hash'>> {
  const revoked = await revokeApiKey(agentId);
  if (!revoked) {
    throw new AgentNotFoundError(agentId);
  }

  const pool = getPool();
  const result = await pool.query<Agent>(
    `SELECT ${AGENT_SELECT_COLUMNS} FROM agents WHERE id = $1`,
    [agentId],
  );

  if (result.rows.length === 0) {
    throw new AgentNotFoundError(agentId);
  }

  logger.info(
    {
      event: 'agent_revoked',
      agentId,
      operation: 'revokeAgent',
    },
    'Agent API key revoked',
  );

  return result.rows[0]!;
}

/**
 * Deregister an agent (soft-delete).
 *
 * Revokes the API key, deactivates the agent, and expires all
 * active sessions. The agent record is preserved for audit purposes.
 *
 * @param agentId - UUID of the agent to deregister
 * @returns The updated (deactivated) agent record
 * @throws {@link AgentNotFoundError} if agent does not exist
 */
export async function deregisterAgent(
  agentId: string,
): Promise<Omit<Agent, 'api_key_hash'>> {
  const pool = getPool();

  // Verify agent exists
  const check = await pool.query<{ id: string }>(
    'SELECT id FROM agents WHERE id = $1',
    [agentId],
  );
  if (check.rows.length === 0) {
    throw new AgentNotFoundError(agentId);
  }

  // Deactivate agent and revoke key
  await pool.query(
    `UPDATE agents
       SET api_key_hash = NULL,
           is_active = FALSE,
           revoked_at = NOW(),
           updated_at = NOW()
     WHERE id = $1`,
    [agentId],
  );

  // Expire all active sessions
  await pool.query(
    `UPDATE sessions
       SET expires_at = NOW()
     WHERE agent_id = $1 AND expires_at > NOW()`,
    [agentId],
  );

  // Fetch updated agent
  const result = await pool.query<Agent>(
    `SELECT ${AGENT_SELECT_COLUMNS} FROM agents WHERE id = $1`,
    [agentId],
  );

  logger.info(
    {
      event: 'agent_deregistered',
      agentId,
      operation: 'deregisterAgent',
    },
    'Agent deregistered',
  );

  return result.rows[0]!;
}

/**
 * Update last_seen timestamp for agent staleness detection.
 *
 * Called on every authenticated API call via the auth middleware.
 * Updates `agents.updated_at` as a heartbeat signal. This is a
 * fire-and-forget operation — failures are logged but do not
 * propagate to the caller.
 *
 * @param agentId - UUID of the authenticated agent
 */
export async function updateLastSeen(agentId: string): Promise<void> {
  const pool = getPool();
  await pool.query(
    'UPDATE agents SET updated_at = NOW() WHERE id = $1',
    [agentId],
  );
}

/**
 * Create or update a session for an agent.
 *
 * Inserts a new session record bound to the given MCP session token,
 * or updates `last_seen` and metadata if the session_token already
 * exists (ON CONFLICT upsert).
 *
 * @param input - Session parameters (agent_id, session_token, machine_id, etc.)
 * @returns The created or updated session record
 */
export async function createOrUpdateSession(
  input: z.infer<typeof createSessionSchema>,
): Promise<SessionResult> {
  const {
    agent_id,
    session_token,
    machine_id,
    operator,
    ip_address,
    expires_in_minutes,
  } = input;

  const pool = getPool();

  const result = await pool.query<SessionResult>(
    `INSERT INTO sessions (agent_id, session_token, machine_id, operator, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, $5::INET, NOW() + INTERVAL '1 minute' * $6)
     ON CONFLICT (session_token) DO UPDATE
       SET last_seen = NOW(),
           machine_id = EXCLUDED.machine_id,
           operator = EXCLUDED.operator
     RETURNING id, agent_id, session_token, machine_id, operator,
               last_seen::TEXT AS last_seen, expires_at::TEXT AS expires_at`,
    [agent_id, session_token, machine_id, operator ?? null, ip_address ?? null, expires_in_minutes],
  );

  return result.rows[0]!;
}
