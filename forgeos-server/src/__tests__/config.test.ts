/**
 * Environment Configuration Tests — TASK-FOS-08-003
 *
 * Validates:
 * - Zod schema covers all .env.example variables
 * - Default values match acceptance criteria (PORT=3000, LOG_LEVEL=info, etc.)
 * - Validation rejects invalid values (bad URLs, out-of-range ports, bad enums)
 * - loadConfig() returns a typed AppConfig on valid input
 * - loadConfig() throws descriptive errors on invalid input
 * - Dockerfile follows multi-stage build best practices
 * - docker-compose.yml wires services correctly
 * - .dockerignore excludes sensitive files
 * - No hardcoded secrets in source code
 *
 * @module __tests__/config
 * @ticket TASK-FOS-08-003
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(__dirname, '../..');

// ═════════════════════════════════════════════════════════════════════════════
// 1. CONFIG MODULE — ZOD SCHEMA VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Config module — Zod schema', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Isolate env per test — reset modules to re-execute loadConfig
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  /**
   * Helper to dynamically import loadConfig with fresh env.
   * We must use dynamic import because config.ts calls loadConfig() at module level.
   * When env is valid, the import succeeds and we can call loadConfig again.
   * When env is invalid, the module-level loadConfig() call throws during import.
   */
  async function importLoadConfig() {
    const mod = await import('../config.js');
    return mod.loadConfig;
  }

  /**
   * Helper for negative tests: returns the error thrown during module import
   * (because config.ts runs loadConfig() at module scope).
   */
  async function expectImportToThrow(): Promise<Error> {
    try {
      await import('../config.js');
      throw new Error('Expected import to throw but it did not');
    } catch (e) {
      return e as Error;
    }
  }

  // ── Positive: valid minimal config ──────────────────────────────────────

  it('should parse valid config with DATABASE_URL and all defaults', async () => {
    process.env['DATABASE_URL'] = 'postgresql://user:pass@localhost:5432/db';
    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config).toBeDefined();
    expect(config.DATABASE_URL).toBe('postgresql://user:pass@localhost:5432/db');
    expect(config.PORT).toBe(3000);
    // vitest sets NODE_ENV=test, so default 'development' won't appear here
    expect(['development', 'test', 'production']).toContain(config.NODE_ENV);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.ADMIN_API_KEY).toBe('forgeos_admin_CHANGE_ME');
    expect(config.RATE_LIMIT_PER_MINUTE).toBe(100);
    expect(config.DEFAULT_LEASE_MINUTES).toBe(30);
    expect(config.MAX_LEASE_MINUTES).toBe(120);
    expect(config.RECONCILIATION_INTERVAL).toBe(300);
  });

  // ── Default values match acceptance criteria ───────────────────────────

  describe('default values', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('PORT defaults to 3000', async () => {
      delete process.env['PORT'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().PORT).toBe(3000);
    });

    it('NODE_ENV defaults to development', async () => {
      delete process.env['NODE_ENV'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().NODE_ENV).toBe('development');
    });

    it('LOG_LEVEL defaults to info', async () => {
      delete process.env['LOG_LEVEL'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().LOG_LEVEL).toBe('info');
    });

    it('DEFAULT_LEASE_MINUTES defaults to 30', async () => {
      delete process.env['DEFAULT_LEASE_MINUTES'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().DEFAULT_LEASE_MINUTES).toBe(30);
    });

    it('MAX_LEASE_MINUTES defaults to 120', async () => {
      delete process.env['MAX_LEASE_MINUTES'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().MAX_LEASE_MINUTES).toBe(120);
    });

    it('RATE_LIMIT_PER_MINUTE defaults to 100', async () => {
      delete process.env['RATE_LIMIT_PER_MINUTE'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().RATE_LIMIT_PER_MINUTE).toBe(100);
    });

    it('RECONCILIATION_INTERVAL defaults to 300', async () => {
      delete process.env['RECONCILIATION_INTERVAL'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().RECONCILIATION_INTERVAL).toBe(300);
    });

    it('WEBHOOK_SECRET defaults to undefined (optional)', async () => {
      delete process.env['WEBHOOK_SECRET'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().WEBHOOK_SECRET).toBeUndefined();
    });

    it('WORKSPACE_PATH defaults to undefined (optional)', async () => {
      delete process.env['WORKSPACE_PATH'];
      const loadConfig = await importLoadConfig();
      expect(loadConfig().WORKSPACE_PATH).toBeUndefined();
    });
  });

  // ── Coercion: string env vars coerced to numbers ───────────────────────

  describe('numeric coercion', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('coerces PORT from string to number', async () => {
      process.env['PORT'] = '8080';
      const loadConfig = await importLoadConfig();
      const config = loadConfig();
      expect(config.PORT).toBe(8080);
      expect(typeof config.PORT).toBe('number');
    });

    it('coerces RATE_LIMIT_PER_MINUTE from string to number', async () => {
      process.env['RATE_LIMIT_PER_MINUTE'] = '200';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().RATE_LIMIT_PER_MINUTE).toBe(200);
    });

    it('coerces DEFAULT_LEASE_MINUTES from string to number', async () => {
      process.env['DEFAULT_LEASE_MINUTES'] = '15';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().DEFAULT_LEASE_MINUTES).toBe(15);
    });

    it('coerces MAX_LEASE_MINUTES from string to number', async () => {
      process.env['MAX_LEASE_MINUTES'] = '240';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().MAX_LEASE_MINUTES).toBe(240);
    });

    it('coerces RECONCILIATION_INTERVAL from string to number', async () => {
      process.env['RECONCILIATION_INTERVAL'] = '600';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().RECONCILIATION_INTERVAL).toBe(600);
    });
  });

  // ── Negative: invalid DATABASE_URL ──────────────────────────────────────

  describe('DATABASE_URL validation', () => {
    it('throws on missing DATABASE_URL', async () => {
      delete process.env['DATABASE_URL'];
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on non-postgresql URL protocol', async () => {
      process.env['DATABASE_URL'] = 'mysql://user:pass@localhost:3306/db';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on empty string DATABASE_URL', async () => {
      process.env['DATABASE_URL'] = '';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on non-URL DATABASE_URL', async () => {
      process.env['DATABASE_URL'] = 'not-a-url';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });
  });

  // ── Negative: PORT range validation ─────────────────────────────────────

  describe('PORT validation', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('throws on PORT=0 (below min 1)', async () => {
      process.env['PORT'] = '0';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on PORT=70000 (above max 65535)', async () => {
      process.env['PORT'] = '70000';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on non-numeric PORT', async () => {
      process.env['PORT'] = 'abc';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('accepts PORT=1 (minimum valid)', async () => {
      process.env['PORT'] = '1';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().PORT).toBe(1);
    });

    it('accepts PORT=65535 (maximum valid)', async () => {
      process.env['PORT'] = '65535';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().PORT).toBe(65535);
    });
  });

  // ── Negative: NODE_ENV enum validation ──────────────────────────────────

  describe('NODE_ENV validation', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('throws on invalid NODE_ENV value', async () => {
      process.env['NODE_ENV'] = 'staging';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('accepts development', async () => {
      process.env['NODE_ENV'] = 'development';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().NODE_ENV).toBe('development');
    });

    it('accepts production with required vars', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['WEBHOOK_SECRET'] = 'whsec_prod_test_secret';
      process.env['ADMIN_API_KEY'] = 'prod_secure_key_12345';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().NODE_ENV).toBe('production');
    });

    it('accepts test', async () => {
      process.env['NODE_ENV'] = 'test';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().NODE_ENV).toBe('test');
    });

    it('throws in production when WEBHOOK_SECRET is missing', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['ADMIN_API_KEY'] = 'prod_secure_key_12345';
      delete process.env['WEBHOOK_SECRET'];
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
      expect(err.message).toContain('WEBHOOK_SECRET');
      expect(err.message).toContain('required in production');
    });

    it('throws in production when ADMIN_API_KEY is still default', async () => {
      process.env['NODE_ENV'] = 'production';
      process.env['WEBHOOK_SECRET'] = 'whsec_prod_test_secret';
      delete process.env['ADMIN_API_KEY']; // falls back to default
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
      expect(err.message).toContain('ADMIN_API_KEY');
      expect(err.message).toContain('required in production');
    });

    it('lists all missing required vars in production error', async () => {
      process.env['NODE_ENV'] = 'production';
      delete process.env['WEBHOOK_SECRET'];
      delete process.env['ADMIN_API_KEY']; // falls back to default
      const err = await expectImportToThrow();
      expect(err.message).toContain('WEBHOOK_SECRET');
      expect(err.message).toContain('ADMIN_API_KEY');
    });
  });

  // ── Negative: LOG_LEVEL enum validation ─────────────────────────────────

  describe('LOG_LEVEL validation', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('throws on invalid LOG_LEVEL', async () => {
      process.env['LOG_LEVEL'] = 'verbose';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it.each(['trace', 'debug', 'info', 'warn', 'error', 'fatal'] as const)(
      'accepts LOG_LEVEL=%s',
      async (level) => {
        process.env['LOG_LEVEL'] = level;
        const loadConfig = await importLoadConfig();
        expect(loadConfig().LOG_LEVEL).toBe(level);
      },
    );
  });

  // ── Negative: ADMIN_API_KEY min-length validation ───────────────────────

  describe('ADMIN_API_KEY validation', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('throws on ADMIN_API_KEY shorter than 8 characters', async () => {
      process.env['ADMIN_API_KEY'] = 'short';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('accepts ADMIN_API_KEY with exactly 8 characters', async () => {
      process.env['ADMIN_API_KEY'] = '12345678';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().ADMIN_API_KEY).toBe('12345678');
    });
  });

  // ── Negative: lease minute bounds ──────────────────────────────────────

  describe('lease minute bounds', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('throws on DEFAULT_LEASE_MINUTES < 5', async () => {
      process.env['DEFAULT_LEASE_MINUTES'] = '4';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on DEFAULT_LEASE_MINUTES > 120', async () => {
      process.env['DEFAULT_LEASE_MINUTES'] = '121';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on MAX_LEASE_MINUTES < 10', async () => {
      process.env['MAX_LEASE_MINUTES'] = '9';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('throws on MAX_LEASE_MINUTES > 480', async () => {
      process.env['MAX_LEASE_MINUTES'] = '481';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('accepts DEFAULT_LEASE_MINUTES=5 (min boundary)', async () => {
      process.env['DEFAULT_LEASE_MINUTES'] = '5';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().DEFAULT_LEASE_MINUTES).toBe(5);
    });

    it('accepts MAX_LEASE_MINUTES=480 (max boundary)', async () => {
      process.env['MAX_LEASE_MINUTES'] = '480';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().MAX_LEASE_MINUTES).toBe(480);
    });
  });

  // ── Negative: RATE_LIMIT_PER_MINUTE must be >= 1 ───────────────────────

  describe('RATE_LIMIT_PER_MINUTE validation', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('throws on RATE_LIMIT_PER_MINUTE < 1', async () => {
      process.env['RATE_LIMIT_PER_MINUTE'] = '0';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('accepts RATE_LIMIT_PER_MINUTE=1 (min boundary)', async () => {
      process.env['RATE_LIMIT_PER_MINUTE'] = '1';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().RATE_LIMIT_PER_MINUTE).toBe(1);
    });
  });

  // ── RECONCILIATION_INTERVAL must be >= 60 ──────────────────────────────

  describe('RECONCILIATION_INTERVAL validation', () => {
    beforeEach(() => {
      process.env['DATABASE_URL'] = 'postgresql://u:p@localhost:5432/db';
    });

    it('throws on RECONCILIATION_INTERVAL < 60', async () => {
      process.env['RECONCILIATION_INTERVAL'] = '59';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
    });

    it('accepts RECONCILIATION_INTERVAL=60 (min boundary)', async () => {
      process.env['RECONCILIATION_INTERVAL'] = '60';
      const loadConfig = await importLoadConfig();
      expect(loadConfig().RECONCILIATION_INTERVAL).toBe(60);
    });
  });

  // ── Error message quality ──────────────────────────────────────────────

  describe('error messages', () => {
    it('includes field name in error message on invalid config', async () => {
      delete process.env['DATABASE_URL'];
      process.env['PORT'] = 'not_a_number';
      const err = await expectImportToThrow();
      expect(err.message).toContain('Invalid configuration');
      expect(err.message).toContain('DATABASE_URL');
    });
  });

  // ── Full override: all values explicitly set ───────────────────────────

  it('should accept fully specified config without any defaults', async () => {
    process.env['DATABASE_URL'] = 'postgresql://admin:secret@db.example.com:5433/forgeos_prod';
    process.env['PORT'] = '8080';
    process.env['NODE_ENV'] = 'production';
    process.env['LOG_LEVEL'] = 'warn';
    process.env['ADMIN_API_KEY'] = 'super_secret_key_prod_2024';
    process.env['WEBHOOK_SECRET'] = 'whsec_abcdef123456';
    process.env['WORKSPACE_PATH'] = '/opt/forgeos/workspace';
    process.env['RATE_LIMIT_PER_MINUTE'] = '50';
    process.env['DEFAULT_LEASE_MINUTES'] = '15';
    process.env['MAX_LEASE_MINUTES'] = '240';
    process.env['RECONCILIATION_INTERVAL'] = '120';

    const loadConfig = await importLoadConfig();
    const config = loadConfig();

    expect(config.DATABASE_URL).toBe('postgresql://admin:secret@db.example.com:5433/forgeos_prod');
    expect(config.PORT).toBe(8080);
    expect(config.NODE_ENV).toBe('production');
    expect(config.LOG_LEVEL).toBe('warn');
    expect(config.ADMIN_API_KEY).toBe('super_secret_key_prod_2024');
    expect(config.WEBHOOK_SECRET).toBe('whsec_abcdef123456');
    expect(config.WORKSPACE_PATH).toBe('/opt/forgeos/workspace');
    expect(config.RATE_LIMIT_PER_MINUTE).toBe(50);
    expect(config.DEFAULT_LEASE_MINUTES).toBe(15);
    expect(config.MAX_LEASE_MINUTES).toBe(240);
    expect(config.RECONCILIATION_INTERVAL).toBe(120);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. CONFIG MODULE — EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

describe('Config module — exports', () => {
  it('exports loadConfig function', async () => {
    const mod = await import('../config.js');
    expect(typeof mod.loadConfig).toBe('function');
  });

  it('exports config singleton', async () => {
    const mod = await import('../config.js');
    expect(mod.config).toBeDefined();
    expect(typeof mod.config).toBe('object');
  });

  it('config object is frozen (Object.freeze) to prevent mutation', async () => {
    const mod = await import('../config.js');
    expect(Object.isFrozen(mod.config)).toBe(true);
  });

  it('config properties cannot be mutated at runtime', async () => {
    const mod = await import('../config.js');
    const originalPort = mod.config.PORT;
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (mod.config as any).PORT = 9999;
    }).toThrow();
    expect(mod.config.PORT).toBe(originalPort);
  });

  it('exports AppConfig type (indirectly via config object shape)', async () => {
    const mod = await import('../config.js');
    const cfg = mod.config;
    // Verify shape — all expected keys exist
    expect(cfg).toHaveProperty('DATABASE_URL');
    expect(cfg).toHaveProperty('PORT');
    expect(cfg).toHaveProperty('NODE_ENV');
    expect(cfg).toHaveProperty('LOG_LEVEL');
    expect(cfg).toHaveProperty('ADMIN_API_KEY');
    expect(cfg).toHaveProperty('RATE_LIMIT_PER_MINUTE');
    expect(cfg).toHaveProperty('DEFAULT_LEASE_MINUTES');
    expect(cfg).toHaveProperty('MAX_LEASE_MINUTES');
    expect(cfg).toHaveProperty('RECONCILIATION_INTERVAL');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. .env.example — VARIABLE COVERAGE
// ═════════════════════════════════════════════════════════════════════════════

describe('.env.example variable coverage', () => {
  let envContent: string;

  beforeEach(() => {
    envContent = fs.readFileSync(
      path.join(serverRoot, '.env.example'),
      'utf-8',
    );
  });

  it('.env.example file exists', () => {
    expect(fs.existsSync(path.join(serverRoot, '.env.example'))).toBe(true);
  });

  // Variables that should be documented in .env.example
  const requiredVars = [
    'DATABASE_URL',
    'PORT',
    'NODE_ENV',
    'LOG_LEVEL',
    'ADMIN_API_KEY',
    'WEBHOOK_SECRET',
    'WORKSPACE_PATH',
    'RATE_LIMIT_PER_MINUTE',
    'DEFAULT_LEASE_MINUTES',
    'MAX_LEASE_MINUTES',
    'RECONCILIATION_INTERVAL',
  ];

  for (const varName of requiredVars) {
    it(`documents ${varName}`, () => {
      expect(envContent).toContain(varName);
    });
  }

  // Acceptance criteria: POSTGRES_PORT must be present (Docker port mapping)
  it('documents POSTGRES_PORT for Docker port mapping', () => {
    expect(envContent).toContain('POSTGRES_PORT');
  });

  it('provides example values (not just variable names)', () => {
    // Each var line should have = with a value
    const varLines = envContent
      .split('\n')
      .filter((line) => line.match(/^[A-Z_]+=/) && !line.startsWith('#'));
    expect(varLines.length).toBeGreaterThanOrEqual(requiredVars.length);
    for (const line of varLines) {
      const [, value] = line.split('=');
      expect(value).toBeDefined();
      expect(value!.trim().length).toBeGreaterThan(0);
    }
  });

  it('has section comments for organization', () => {
    // Check for at least 3 section comments (e.g., PostgreSQL, MCP Server, Authentication)
    const sectionComments = envContent
      .split('\n')
      .filter((line) => line.startsWith('#') && line.includes('──'));
    expect(sectionComments.length).toBeGreaterThanOrEqual(3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. .env.example vs CONFIG SCHEMA SYNC
// ═════════════════════════════════════════════════════════════════════════════

describe('.env.example ↔ config schema sync', () => {
  it('every Zod schema key has a corresponding .env.example entry', () => {
    const envContent = fs.readFileSync(
      path.join(serverRoot, '.env.example'),
      'utf-8',
    );
    const configSource = fs.readFileSync(
      path.join(serverRoot, 'src/config.ts'),
      'utf-8',
    );

    // Extract keys from configSchema z.object({...})
    const schemaKeyMatches = configSource.matchAll(/^\s+(\w+):\s+z\./gm);
    const schemaKeys = [...schemaKeyMatches].map((m) => m[1]!);

    expect(schemaKeys.length).toBeGreaterThan(0);

    for (const key of schemaKeys) {
      expect(envContent).toContain(key);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. DOCKERFILE — MULTI-STAGE BUILD BEST PRACTICES
// ═════════════════════════════════════════════════════════════════════════════

describe('Dockerfile best practices', () => {
  let dockerContent: string;

  beforeEach(() => {
    dockerContent = fs.readFileSync(
      path.join(serverRoot, 'Dockerfile'),
      'utf-8',
    );
  });

  it('uses multi-stage build (builder + runtime stages)', () => {
    const fromStatements = dockerContent.match(/^FROM\s+/gm);
    expect(fromStatements).not.toBeNull();
    expect(fromStatements!.length).toBeGreaterThanOrEqual(2);
  });

  it('builder stage is named "builder"', () => {
    expect(dockerContent).toMatch(/FROM\s+\S+\s+AS\s+builder/i);
  });

  it('runtime stage is named "runtime"', () => {
    expect(dockerContent).toMatch(/FROM\s+\S+\s+AS\s+runtime/i);
  });

  it('uses Node.js 22 Alpine base image', () => {
    expect(dockerContent).toMatch(/FROM\s+node:22-alpine/);
  });

  it('runs npm ci (not npm install) in builder for reproducible builds', () => {
    expect(dockerContent).toContain('npm ci');
  });

  it('copies only dist from builder (no source in runtime)', () => {
    expect(dockerContent).toMatch(/COPY\s+--from=builder\s+.*dist/);
  });

  it('copies node_modules from builder', () => {
    expect(dockerContent).toMatch(/COPY\s+--from=builder\s+.*node_modules/);
  });

  it('runs as non-root user (USER node)', () => {
    expect(dockerContent).toMatch(/^USER\s+node$/m);
  });

  it('sets NODE_ENV=production', () => {
    expect(dockerContent).toMatch(/ENV\s+NODE_ENV\s*=?\s*production/);
  });

  it('defines HEALTHCHECK', () => {
    expect(dockerContent).toContain('HEALTHCHECK');
    expect(dockerContent).toContain('/health');
  });

  it('exposes port 3000', () => {
    expect(dockerContent).toMatch(/EXPOSE\s+3000/);
  });

  it('uses node (not npm) as CMD entrypoint for signal handling', () => {
    expect(dockerContent).toMatch(/CMD\s+\["node"/);
  });

  it('does not contain .env or secrets in COPY commands', () => {
    // Ensure no COPY .env or COPY .env.* in Dockerfile
    const copyLines = dockerContent
      .split('\n')
      .filter((line) => line.startsWith('COPY'));
    for (const line of copyLines) {
      expect(line).not.toMatch(/COPY\s+\.env\b/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. DOCKER COMPOSE — SERVICE ORCHESTRATION
// ═════════════════════════════════════════════════════════════════════════════

describe('docker-compose.yml service orchestration', () => {
  let composeContent: string;

  beforeEach(() => {
    composeContent = fs.readFileSync(
      path.join(serverRoot, 'docker-compose.yml'),
      'utf-8',
    );
  });

  it('defines postgres service', () => {
    expect(composeContent).toContain('postgres:');
  });

  it('uses the custom postgres 17 image build', () => {
    expect(composeContent).toContain('image: forgeos-postgres:17');
  });

  it('defines forgeos-server service', () => {
    expect(composeContent).toContain('forgeos-server:');
  });

  it('server depends_on postgres with health condition', () => {
    expect(composeContent).toContain('depends_on');
    expect(composeContent).toContain('service_healthy');
  });

  it('postgres has healthcheck', () => {
    expect(composeContent).toContain('pg_isready');
  });

  it('server has healthcheck hitting /health', () => {
    expect(composeContent).toContain('http://localhost:3000/health');
  });

  it('exposes postgres port with env var override', () => {
    expect(composeContent).toMatch(/POSTGRES_PORT.*5432/);
  });

  it('exposes server port with env var override', () => {
    expect(composeContent).toMatch(/PORT.*3000/);
  });

  it('defines persistent pgdata volume', () => {
    expect(composeContent).toContain('pgdata:');
    expect(composeContent).toContain('/var/lib/postgresql/data');
  });

  it('mounts migrations to initdb.d for auto-setup', () => {
    expect(composeContent).toContain('docker-entrypoint-initdb.d');
  });

  it('uses restart: unless-stopped for reliability', () => {
    expect(composeContent).toContain('unless-stopped');
  });

  it('passes DATABASE_URL to server pointing to postgres service', () => {
    expect(composeContent).toMatch(/DATABASE_URL.*postgres.*5432/);
  });

  it('ADMIN_API_KEY uses env var with fallback default', () => {
    expect(composeContent).toMatch(/ADMIN_API_KEY.*\$\{ADMIN_API_KEY/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. .dockerignore — SENSITIVE FILE EXCLUSION
// ═════════════════════════════════════════════════════════════════════════════

describe('.dockerignore', () => {
  let ignoreContent: string;

  beforeEach(() => {
    ignoreContent = fs.readFileSync(
      path.join(serverRoot, '.dockerignore'),
      'utf-8',
    );
  });

  it('excludes node_modules', () => {
    expect(ignoreContent).toContain('node_modules');
  });

  it('excludes dist (built artifacts)', () => {
    expect(ignoreContent).toContain('dist');
  });

  it('excludes .env files (secrets)', () => {
    expect(ignoreContent).toContain('.env');
  });

  it('excludes .git directory', () => {
    expect(ignoreContent).toContain('.git');
  });

  it('does NOT exclude .env.example (safe template)', () => {
    expect(ignoreContent).toContain('!.env.example');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. SOURCE CODE — NO HARDCODED SECRETS
// ═════════════════════════════════════════════════════════════════════════════

describe('No hardcoded secrets in source', () => {
  const srcDir = path.join(serverRoot, 'src');

  function readTsFiles(dir: string): Array<{ file: string; content: string }> {
    const results: Array<{ file: string; content: string }> = [];
    if (!fs.existsSync(dir)) return results;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'node_modules') {
        results.push(...readTsFiles(fullPath));
      } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
        results.push({ file: fullPath, content: fs.readFileSync(fullPath, 'utf-8') });
      }
    }
    return results;
  }

  it('no source files contain hardcoded passwords', () => {
    const files = readTsFiles(srcDir);
    for (const { file, content } of files) {
      // Look for patterns like password = "..." or password: "..." with actual values
      // Exclude default placeholder values and Zod defaults
      const lines = content.split('\n');
      for (const line of lines) {
        if (line.includes('password') && !line.trim().startsWith('//') && !line.trim().startsWith('*')) {
          // Allow: .default('forgeos_admin_CHANGE_ME') as it's a placeholder
          // Disallow: actual credentials
          expect(line).not.toMatch(/password\s*[:=]\s*['"][^'"]*(?:admin|root|secret|prod)[^'"]*['"]/i);
        }
      }
    }
  });

  it('no source files contain hardcoded API keys (non-placeholder)', () => {
    const files = readTsFiles(srcDir);
    for (const { file, content } of files) {
      // Check that no real API keys are embedded (sk_, ghp_, etc.)
      expect(content).not.toMatch(/['"]sk_[a-zA-Z0-9]{20,}['"]/);
      expect(content).not.toMatch(/['"]ghp_[a-zA-Z0-9]{20,}['"]/);
      expect(content).not.toMatch(/['"]Bearer\s+[a-zA-Z0-9._-]{30,}['"]/);
    }
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. config.ts SOURCE — STRUCTURAL VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('config.ts source structure', () => {
  let configSource: string;

  beforeEach(() => {
    configSource = fs.readFileSync(
      path.join(serverRoot, 'src/config.ts'),
      'utf-8',
    );
  });

  it('imports zod', () => {
    expect(configSource).toMatch(/import\s+.*\bz\b.*from\s+['"]zod['"]/);
  });

  it('imports dotenv', () => {
    expect(configSource).toMatch(/import\s+.*dotenv.*from\s+['"]dotenv['"]/);
  });

  it('calls dotenv.config()', () => {
    expect(configSource).toContain('dotenv.config()');
  });

  it('defines configSchema using z.object()', () => {
    expect(configSource).toContain('z.object(');
  });

  it('exports AppConfig type', () => {
    expect(configSource).toMatch(/export\s+type\s+AppConfig/);
  });

  it('exports loadConfig function', () => {
    expect(configSource).toMatch(/export\s+function\s+loadConfig/);
  });

  it('exports config singleton', () => {
    expect(configSource).toMatch(/export\s+const\s+config/);
  });

  it('uses safeParse for error handling', () => {
    expect(configSource).toContain('safeParse');
  });

  it('includes JSDoc module documentation', () => {
    expect(configSource).toContain('@module config');
  });

  it('DATABASE_URL requires postgresql:// prefix', () => {
    expect(configSource).toContain("startsWith('postgresql://')");
  });

  it('contains no `any` type annotations', () => {
    // Exclude comments
    const codeLines = configSource
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const codeOnly = codeLines.join('\n');
    expect(codeOnly).not.toMatch(/:\s*any\b/);
    expect(codeOnly).not.toMatch(/as\s+any\b/);
  });
});
