/**
 * Environment configuration loader with Zod validation.
 *
 * Reads environment variables from a `.env` file (via `dotenv`) and validates
 * them against a strict Zod schema. Exports a frozen, typed `AppConfig` object
 * that is the single source of truth for runtime configuration.
 *
 * In production mode, additional validation ensures security-critical variables
 * (`WEBHOOK_SECRET`, `ADMIN_API_KEY`) are explicitly set.
 *
 * @module config
 * @see {@link https://zod.dev/ Zod documentation}
 * @see {@link forgeos-server/.env.example .env.example} for variable reference
 */

import { z } from 'zod';
import dotenv from 'dotenv';

if (!process.env.VITEST && process.env.NODE_ENV !== 'test') {
  dotenv.config();
}

/**
 * Zod schema defining all supported environment variables, their types,
 * constraints, and default values. Includes a `superRefine` callback that
 * enforces production-only requirements.
 *
 * @internal
 */
const configSchema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3011),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ADMIN_API_KEY: z.string().min(8).default('forgeos_admin_CHANGE_ME'),
  WEBHOOK_SECRET: z.string().optional(),
  WORKSPACE_PATH: z.string().optional(),
  EMBEDDING_PROVIDER: z.enum(['ollama', 'openai']).default('ollama'),
  EMBEDDING_MODEL: z.string().min(1).default('mxbai-embed-large'),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434/api/embed'),
  OPENAI_API_KEY: z.string().optional(),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(100),
  DEFAULT_LEASE_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  MAX_LEASE_MINUTES: z.coerce.number().int().min(10).max(480).default(120),
  RECONCILIATION_INTERVAL: z.coerce.number().int().min(60).default(300),
}).superRefine((cfg, ctx) => {
  if (cfg.NODE_ENV === 'production') {
    const missing: string[] = [];
    if (!cfg.WEBHOOK_SECRET) missing.push('WEBHOOK_SECRET');
    if (cfg.ADMIN_API_KEY === 'forgeos_admin_CHANGE_ME') missing.push('ADMIN_API_KEY (still default)');
    if (missing.length > 0) {
      for (const name of missing) {
        ctx.addIssue({
          code: 'custom',
          message: `${name} is required in production`,
          path: [name],
        });
      }
    }
  }
});

/**
 * Typed configuration object inferred from `configSchema`.
 *
 * All fields are strongly typed. Numeric fields are coerced from string
 * environment variables. Optional fields may be `undefined` in non-production.
 */
export type AppConfig = z.infer<typeof configSchema>;

/**
 * Parse and validate environment configuration from `process.env`.
 *
 * Reads all supported environment variables, applies defaults, coerces
 * numeric strings, and enforces production constraints. The returned
 * object is frozen to prevent accidental mutation.
 *
 * @returns Frozen `AppConfig` object with validated configuration values
 * @throws {Error} If any environment variable fails validation. The error
 *   message lists each invalid field and its specific validation failure.
 *
 * @example
 * ```typescript
 * import { loadConfig, AppConfig } from './config';
 *
 * const cfg: AppConfig = loadConfig();
 * logger.info(cfg.PORT);       // 3011 (default)
 * logger.info(cfg.NODE_ENV);    // 'development' (default)
 * ```
 */
export function loadConfig(): AppConfig {
  const result = configSchema.safeParse(process.env);
  if (!result.success) {
    const errors = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${errors}`);
  }
  return Object.freeze(result.data);
}

/**
 * Singleton configuration instance, created at module load time.
 *
 * Import this for read-only access to validated environment configuration.
 * The object is frozen — any attempt to mutate it throws in strict mode.
 *
 * @example
 * ```typescript
 * import { config } from './config';
 *
 * logger.info(config.DATABASE_URL);
 * logger.info(config.LOG_LEVEL);
 * ```
 */
export const config = loadConfig();
