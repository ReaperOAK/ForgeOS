/**
 * Environment configuration loader with validation.
 *
 * Loads environment variables from .env file and validates
 * required fields using Zod schemas.
 * @module config
 */

import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  ADMIN_API_KEY: z.string().min(8).default('forgeos_admin_CHANGE_ME'),
  WEBHOOK_SECRET: z.string().optional(),
  WORKSPACE_PATH: z.string().optional(),
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

export type AppConfig = z.infer<typeof configSchema>;

/**
 * Parse and validate environment configuration.
 * Throws on validation failure with detailed error messages.
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

/** Singleton config instance */
export const config = loadConfig();
