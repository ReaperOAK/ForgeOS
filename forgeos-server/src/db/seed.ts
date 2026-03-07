/**
 * Database seed script for ForgeOS initial data.
 *
 * Creates the default "ForgeOS" project and an admin agent with a
 * randomly generated API key. The plaintext key is printed exactly
 * once to stdout — it cannot be recovered after this.
 *
 * Idempotent: uses ON CONFLICT DO UPDATE so re-running is safe.
 *
 * @module db/seed
 * @ticket TASK-FOS-01-003
 */

import crypto from 'node:crypto';
import { getPool } from './pool.js';
import { logger } from '../middleware/logging.js';

// ── Types ────────────────────────────────────────────────────────────────────

/** Result of seeding the database. */
export interface SeedResult {
  /** UUID of the created/updated project. */
  projectId: string;
  /** UUID of the created/updated admin agent. */
  agentId: string;
  /** Whether a new API key was generated (false if agent already existed). */
  keyGenerated: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_PROJECT_NAME = 'ForgeOS';
const DEFAULT_REPO_URL = 'https://github.com/ReaperOAK/ForgeOS';
const DEFAULT_LEASE_MINUTES = 30;
const MAX_LEASE_MINUTES = 120;
const ADMIN_AGENT_NAME = 'admin';
const ADMIN_AGENT_ROLE = 'admin';
const API_KEY_BYTE_LENGTH = 32;
const API_KEY_PREFIX = 'fos_';

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Generate a cryptographically secure API key.
 *
 * Format: `fos_<64 hex chars>` (32 random bytes).
 *
 * @returns Plaintext API key string
 */
function generateApiKey(): string {
  const randomBytes = crypto.randomBytes(API_KEY_BYTE_LENGTH);
  return `${API_KEY_PREFIX}${randomBytes.toString('hex')}`;
}

/**
 * Compute SHA-256 hash of a plaintext API key for storage.
 *
 * The hash is stored in the `agents.api_key_hash` column.
 * The plaintext key is never persisted.
 *
 * @param key - Plaintext API key
 * @returns Hex-encoded SHA-256 hash
 */
function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key, 'utf-8').digest('hex');
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Seed the database with default project and admin agent.
 *
 * 1. Creates/updates the "ForgeOS" project with default lease settings.
 * 2. Creates/updates the "admin" agent.
 * 3. If the admin agent is new (no existing API key hash), generates a
 *    fresh API key and prints it to stdout exactly once.
 *
 * @returns Seed result with project ID, agent ID, and key generation status
 * @throws Error if any database operation fails
 */
export async function seed(): Promise<SeedResult> {
  const pool = getPool();

  logger.info({ event: 'seed_start' }, 'Starting database seed');

  // ── Step 1: Upsert default project ─────────────────────────────────────
  const projectResult = await pool.query<{ id: string }>(
    `INSERT INTO projects (name, description, repo_url, default_lease_minutes, max_lease_minutes)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (name) DO UPDATE SET
       repo_url = EXCLUDED.repo_url,
       default_lease_minutes = EXCLUDED.default_lease_minutes,
       max_lease_minutes = EXCLUDED.max_lease_minutes,
       updated_at = NOW()
     RETURNING id`,
    [
      DEFAULT_PROJECT_NAME,
      'ForgeOS — Distributed MCP Orchestration Engine for AI Development',
      DEFAULT_REPO_URL,
      DEFAULT_LEASE_MINUTES,
      MAX_LEASE_MINUTES,
    ],
  );

  const projectRow = projectResult.rows[0];
  if (!projectRow) {
    throw new Error('Failed to create/update default project — no row returned');
  }
  const projectId = projectRow.id;
  logger.info(
    { event: 'seed_project_upserted', projectId, name: DEFAULT_PROJECT_NAME },
    'Default project upserted',
  );

  // ── Step 2: Check if admin agent already exists with an API key ────────
  const existingAgent = await pool.query<{ id: string; api_key_hash: string | null }>(
    `SELECT id, api_key_hash FROM agents WHERE name = $1 AND role = $2`,
    [ADMIN_AGENT_NAME, ADMIN_AGENT_ROLE],
  );

  let agentId: string;
  let keyGenerated = false;

  const existingRow = existingAgent.rows[0];
  if (existingRow && existingRow.api_key_hash !== null) {
    // Agent exists with a key — don't regenerate
    agentId = existingRow.id;
    logger.info(
      { event: 'seed_agent_exists', agentId },
      'Admin agent already exists with API key — skipping key generation',
    );
  } else {
    // Generate new API key
    const plaintextKey = generateApiKey();
    const keyHash = hashApiKey(plaintextKey);

    const agentResult = await pool.query<{ id: string }>(
      `INSERT INTO agents (name, role, api_key_hash, permissions, is_active)
       VALUES ($1, $2, $3, $4::jsonb, TRUE)
       ON CONFLICT (name, role) DO UPDATE SET
         api_key_hash = EXCLUDED.api_key_hash,
         permissions = EXCLUDED.permissions,
         is_active = TRUE,
         revoked_at = NULL,
         updated_at = NOW()
       RETURNING id`,
      [
        ADMIN_AGENT_NAME,
        ADMIN_AGENT_ROLE,
        keyHash,
        JSON.stringify(['*']),
      ],
    );

    const agentRow = agentResult.rows[0];
    if (!agentRow) {
      throw new Error('Failed to create/update admin agent — no row returned');
    }
    agentId = agentRow.id;
    keyGenerated = true;

    // Print the plaintext key exactly once to stdout
    // Using process.stdout.write to avoid logger formatting
    process.stdout.write(
      `\n========================================\n` +
      `  ADMIN API KEY (save this — shown once)\n` +
      `========================================\n` +
      `  ${plaintextKey}\n` +
      `========================================\n\n`,
    );

    logger.info(
      { event: 'seed_agent_created', agentId },
      'Admin agent created with new API key',
    );
  }

  logger.info(
    { event: 'seed_complete', projectId, agentId, keyGenerated },
    'Database seed complete',
  );

  return { projectId, agentId, keyGenerated };
}
