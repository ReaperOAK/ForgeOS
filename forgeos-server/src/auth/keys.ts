/**
 * API key generation and hash-based validation.
 *
 * Provides cryptographically secure API key generation using 32 bytes
 * of randomness from `node:crypto`, SHA-256 hashing for storage, and
 * database lookup for validation. Plaintext keys are returned exactly
 * once at creation time and never stored.
 *
 * @module auth/keys
 * @ticket TASK-FOS-04-001
 */

import { randomBytes, createHash } from 'node:crypto';
import { getPool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { AgentIdentity } from '../types/index.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** Number of random bytes for API key generation (32 bytes = 256 bits). */
const KEY_BYTE_LENGTH = 32;

/** Prefix for ForgeOS API keys to aid identification. */
const KEY_PREFIX = 'fos_';

// ── Types ────────────────────────────────────────────────────────────────────

/**
 * Result of generating a new API key.
 *
 * The `plaintextKey` is returned exactly once and must be securely
 * transmitted to the agent operator. It is never stored in the database.
 */
export interface GenerateKeyResult {
  /** The plaintext API key (shown once, then discarded). */
  plaintextKey: string;
  /** The SHA-256 hash stored in the `agents.api_key_hash` column. */
  keyHash: string;
  /** UUID of the agent the key was provisioned for. */
  agentId: string;
}

// ── Key Generation ───────────────────────────────────────────────────────────

/**
 * Compute the SHA-256 hex digest of a plaintext API key.
 *
 * @param plaintextKey - The raw API key string
 * @returns Lowercase hex-encoded SHA-256 hash
 *
 * @example
 * ```ts
 * const hash = hashApiKey('fos_abc123...');
 * // 'a1b2c3d4...' (64-char hex string)
 * ```
 */
export function hashApiKey(plaintextKey: string): string {
  return createHash('sha256').update(plaintextKey).digest('hex');
}

/**
 * Generate a cryptographically secure API key.
 *
 * Creates a 32-byte random key prefixed with `fos_`, computes its
 * SHA-256 hash, and stores the hash in the `agents.api_key_hash`
 * column. The plaintext key is returned exactly once via
 * {@link GenerateKeyResult.plaintextKey}.
 *
 * @param agentId - UUID of the agent to provision the key for
 * @returns The plaintext key (one-time), its hash, and agent ID
 * @throws Error if the agent does not exist or the database operation fails
 *
 * @example
 * ```ts
 * const result = await generateApiKey('uuid-of-backend-agent');
 * console.log(result.plaintextKey); // 'fos_<64 hex chars>'
 * // Store result.plaintextKey securely — it cannot be recovered.
 * ```
 */
export async function generateApiKey(agentId: string): Promise<GenerateKeyResult> {
  const rawBytes = randomBytes(KEY_BYTE_LENGTH);
  const plaintextKey = `${KEY_PREFIX}${rawBytes.toString('hex')}`;
  const keyHash = hashApiKey(plaintextKey);

  const pool = getPool();
  const result = await pool.query(
    `UPDATE agents
       SET api_key_hash = $1,
           revoked_at = NULL,
           is_active = TRUE,
           updated_at = NOW()
     WHERE id = $2
     RETURNING id`,
    [keyHash, agentId],
  );

  if (result.rowCount === 0) {
    throw new AgentNotFoundError(agentId);
  }

  logger.info(
    {
      event: 'api_key_generated',
      agentId,
      operation: 'generateApiKey',
    },
    'API key generated for agent',
  );

  return { plaintextKey, keyHash, agentId };
}

// ── Key Validation ───────────────────────────────────────────────────────────

/**
 * Validate an API key by looking up its SHA-256 hash in the `agents` table.
 *
 * Returns the agent identity if the key is valid, active, and not revoked.
 * Returns `null` if the key is invalid, the agent is inactive, or revoked.
 *
 * The lookup uses an indexed query on `api_key_hash` for sub-5ms latency.
 *
 * @param plaintextKey - The raw API key from the Authorization header
 * @returns Agent identity if valid, `null` otherwise
 *
 * @example
 * ```ts
 * const identity = await validateApiKey('fos_abc123...');
 * if (identity) {
 *   console.log(identity.name, identity.role);
 * }
 * ```
 */
export async function validateApiKey(plaintextKey: string): Promise<AgentIdentity | null> {
  const keyHash = hashApiKey(plaintextKey);
  const pool = getPool();

  const result = await pool.query<{
    id: string;
    name: string;
    role: string;
    permissions: string[];
    machine_id: string | null;
    is_active: boolean;
    revoked_at: string | null;
  }>(
    `SELECT id, name, role, permissions, machine_id, is_active, revoked_at
       FROM agents
      WHERE api_key_hash = $1`,
    [keyHash],
  );

  const agent = result.rows[0];
  if (!agent) {
    logger.debug(
      { event: 'api_key_not_found', operation: 'validateApiKey' },
      'API key hash not found in agents table',
    );
    return null;
  }

  if (!agent.is_active || agent.revoked_at !== null) {
    logger.warn(
      {
        event: 'api_key_revoked',
        agentId: agent.id,
        agentName: agent.name,
        isActive: agent.is_active,
        revokedAt: agent.revoked_at,
        operation: 'validateApiKey',
      },
      'Attempted authentication with revoked API key',
    );
    return null;
  }

  return {
    id: agent.id,
    name: agent.name,
    role: agent.role,
    permissions: agent.permissions,
    machine_id: agent.machine_id,
  };
}

/**
 * Revoke an agent's API key by clearing the hash and setting revoked_at.
 *
 * @param agentId - UUID of the agent whose key to revoke
 * @returns `true` if the key was revoked, `false` if agent not found
 */
export async function revokeApiKey(agentId: string): Promise<boolean> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE agents
       SET api_key_hash = NULL,
           is_active = FALSE,
           revoked_at = NOW(),
           updated_at = NOW()
     WHERE id = $1
     RETURNING id`,
    [agentId],
  );

  if (result.rowCount === 0) {
    return false;
  }

  logger.info(
    {
      event: 'api_key_revoked',
      agentId,
      operation: 'revokeApiKey',
    },
    'API key revoked for agent',
  );

  return true;
}

// ── Domain Errors ────────────────────────────────────────────────────────────

/**
 * Error thrown when an agent is not found during key operations.
 */
export class AgentNotFoundError extends Error {
  readonly statusCode = 404;
  readonly code = 'AGENT_NOT_FOUND';

  constructor(agentId: string) {
    super(`Agent not found: ${agentId}`);
    this.name = 'AgentNotFoundError';
  }
}
