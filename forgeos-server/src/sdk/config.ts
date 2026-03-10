/**
 * SDK Configuration for Agent-Runner.
 *
 * Loads agent-runner settings from environment variables with sensible
 * defaults. Controls MCP server connectivity, fallback behavior, and
 * Git safety guards.
 *
 * @module sdk/config
 * @ticket TASK-FOS-06-003
 */

import { z } from 'zod';

/**
 * Zod schema for SDK environment variables.
 *
 * - `FORGEOS_MCP_URL` — MCP server endpoint; defaults to local dev server.
 * - `FORGEOS_API_KEY` — Bearer token for MCP authentication; required in production.
 * - `FORGEOS_FALLBACK_ENABLED` — When `true`, falls back to `tickets.py` CLI
 *   if the MCP server is unreachable. Defaults to `true`.
 * - `FORGEOS_TICKETS_PY_PATH` — Path to the `tickets.py` script for CLI fallback.
 * - `FORGEOS_MCP_TIMEOUT_MS` — HTTP request timeout for MCP calls in milliseconds.
 * - `FORGEOS_WORKSPACE_PATH` — Workspace root for Git operations.
 */
const sdkConfigSchema = z.object({
  FORGEOS_MCP_URL: z.string().url().default('http://localhost:3000/mcp'),
  FORGEOS_API_KEY: z.string().default(''),
  FORGEOS_FALLBACK_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  FORGEOS_TICKETS_PY_PATH: z.string().default('.github/tickets.py'),
  FORGEOS_MCP_TIMEOUT_MS: z.coerce.number().int().min(1000).max(60000).default(10000),
  FORGEOS_WORKSPACE_PATH: z.string().default(process.cwd()),
});

export type SdkConfig = z.infer<typeof sdkConfigSchema>;

/**
 * Load and validate SDK configuration from `process.env`.
 *
 * @returns Frozen, typed configuration object.
 * @throws {z.ZodError} If environment variables fail validation.
 */
export function loadSdkConfig(): SdkConfig {
  return sdkConfigSchema.parse({
    FORGEOS_MCP_URL: process.env.FORGEOS_MCP_URL,
    FORGEOS_API_KEY: process.env.FORGEOS_API_KEY,
    FORGEOS_FALLBACK_ENABLED: process.env.FORGEOS_FALLBACK_ENABLED,
    FORGEOS_TICKETS_PY_PATH: process.env.FORGEOS_TICKETS_PY_PATH,
    FORGEOS_MCP_TIMEOUT_MS: process.env.FORGEOS_MCP_TIMEOUT_MS,
    FORGEOS_WORKSPACE_PATH: process.env.FORGEOS_WORKSPACE_PATH,
  });
}

/** Forbidden git-add patterns that stage all files indiscriminately. */
export const FORBIDDEN_GIT_ADD_PATTERNS: ReadonlyArray<string> = Object.freeze([
  'git add .',
  'git add -A',
  'git add --all',
  'git add -a',
]);
