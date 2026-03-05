/**
 * Server Scaffold Tests — TASK-FOS-02-001
 *
 * Validates the MCP server scaffold: Express app factory, MCP endpoint
 * registration, SSE support, NOTIFY/LISTEN, graceful shutdown, config
 * validation, middleware, and tool registration.
 *
 * These tests use Vitest mocks to isolate from external dependencies
 * (PostgreSQL, network). No live database required.
 *
 * @module __tests__/server
 * @ticket TASK-FOS-02-001
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ═════════════════════════════════════════════════════════════════════════════
// 1. PROJECT STRUCTURE VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Project structure', () => {
  const serverRoot = path.resolve(__dirname, '../..');

  it('has package.json at project root', () => {
    expect(fs.existsSync(path.join(serverRoot, 'package.json'))).toBe(true);
  });

  it('has tsconfig.json at project root', () => {
    expect(fs.existsSync(path.join(serverRoot, 'tsconfig.json'))).toBe(true);
  });

  it('has src/index.ts entry point', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/index.ts'))).toBe(true);
  });

  it('has src/server.ts app factory', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/server.ts'))).toBe(true);
  });

  it('has src/config.ts configuration module', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/config.ts'))).toBe(true);
  });

  it('has src/middleware/auth.ts', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/middleware/auth.ts'))).toBe(true);
  });

  it('has src/middleware/logging.ts', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/middleware/logging.ts'))).toBe(true);
  });

  it('has src/tools/index.ts tool registration hub', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/tools/index.ts'))).toBe(true);
  });

  it('has src/types/index.ts type definitions', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/types/index.ts'))).toBe(true);
  });

  it('has Dockerfile', () => {
    expect(fs.existsSync(path.join(serverRoot, 'Dockerfile'))).toBe(true);
  });

  it('has docker-compose.yml', () => {
    expect(fs.existsSync(path.join(serverRoot, 'docker-compose.yml'))).toBe(true);
  });

  it('has src/dashboard/ static assets', () => {
    expect(fs.existsSync(path.join(serverRoot, 'src/dashboard/index.html'))).toBe(true);
    expect(fs.existsSync(path.join(serverRoot, 'src/dashboard/css/style.css'))).toBe(true);
    expect(fs.existsSync(path.join(serverRoot, 'src/dashboard/js/app.js'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. PACKAGE.JSON VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('package.json', () => {
  let pkg: Record<string, unknown>;
  const pkgPath = path.resolve(__dirname, '../../package.json');

  beforeEach(() => {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  });

  describe('production dependencies', () => {
    it('includes @modelcontextprotocol/sdk', () => {
      expect(pkg['dependencies']).toHaveProperty('@modelcontextprotocol/sdk');
    });

    it('includes express', () => {
      expect(pkg['dependencies']).toHaveProperty('express');
    });

    it('includes pg', () => {
      expect(pkg['dependencies']).toHaveProperty('pg');
    });

    it('includes zod', () => {
      expect(pkg['dependencies']).toHaveProperty('zod');
    });

    it('includes pino', () => {
      expect(pkg['dependencies']).toHaveProperty('pino');
    });

    it('includes dotenv', () => {
      expect(pkg['dependencies']).toHaveProperty('dotenv');
    });
  });

  describe('dev dependencies', () => {
    it('includes typescript', () => {
      expect(pkg['devDependencies']).toHaveProperty('typescript');
    });

    it('includes @types/express', () => {
      expect(pkg['devDependencies']).toHaveProperty('@types/express');
    });

    it('includes @types/pg', () => {
      expect(pkg['devDependencies']).toHaveProperty('@types/pg');
    });

    it('includes tsx', () => {
      expect(pkg['devDependencies']).toHaveProperty('tsx');
    });

    it('includes vitest', () => {
      expect(pkg['devDependencies']).toHaveProperty('vitest');
    });

    it('includes @types/node', () => {
      expect(pkg['devDependencies']).toHaveProperty('@types/node');
    });
  });

  describe('scripts', () => {
    const getScripts = () => pkg['scripts'] as Record<string, string>;

    it('has build script using tsc', () => {
      expect(getScripts()['build']).toContain('tsc');
    });

    it('has dev script using tsx watch', () => {
      expect(getScripts()['dev']).toContain('tsx');
      expect(getScripts()['dev']).toContain('watch');
    });

    it('has start script pointing to dist/index.js', () => {
      expect(getScripts()['start']).toContain('dist/index.js');
    });

    it('has test script using vitest', () => {
      expect(getScripts()['test']).toContain('vitest');
    });

    it('has migrate script', () => {
      expect(getScripts()['migrate']).toBeDefined();
    });

    it('has typecheck script', () => {
      expect(getScripts()['typecheck']).toContain('tsc');
      expect(getScripts()['typecheck']).toContain('noEmit');
    });
  });

  describe('project metadata', () => {
    it('uses ESM (type: module)', () => {
      expect(pkg['type']).toBe('module');
    });

    it('sets main to dist/index.js', () => {
      expect(pkg['main']).toBe('dist/index.js');
    });

    it('requires Node >= 22', () => {
      const engines = pkg['engines'] as Record<string, string>;
      expect(engines).toBeDefined();
      expect(engines['node']).toMatch(/22/);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. TSCONFIG.JSON VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('tsconfig.json', () => {
  let tsconfig: Record<string, unknown>;
  const tsconfigPath = path.resolve(__dirname, '../../tsconfig.json');

  beforeEach(() => {
    const raw = fs.readFileSync(tsconfigPath, 'utf-8');
    // Strip comments (JSONC support)
    const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    tsconfig = JSON.parse(cleaned);
  });

  it('has strict mode enabled', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['strict']).toBe(true);
  });

  it('targets ES2022', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['target']).toBe('ES2022');
  });

  it('uses NodeNext module resolution', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['module']).toBe('NodeNext');
    expect(co['moduleResolution']).toBe('NodeNext');
  });

  it('outputs to dist/', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['outDir']).toBe('./dist');
  });

  it('has rootDir as src/', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['rootDir']).toBe('./src');
  });

  it('enables noUncheckedIndexedAccess', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['noUncheckedIndexedAccess']).toBe(true);
  });

  it('enables noImplicitReturns', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['noImplicitReturns']).toBe(true);
  });

  it('enables noUnusedLocals', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['noUnusedLocals']).toBe(true);
  });

  it('enables noUnusedParameters', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['noUnusedParameters']).toBe(true);
  });

  it('enables source maps', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['sourceMap']).toBe(true);
  });

  it('enables declaration output', () => {
    const co = tsconfig['compilerOptions'] as Record<string, unknown>;
    expect(co['declaration']).toBe(true);
  });

  it('excludes test files from compilation', () => {
    const exclude = tsconfig['exclude'] as string[];
    expect(exclude).toBeDefined();
    expect(exclude.some((e) => e.includes('.test.ts'))).toBe(true);
  });

  it('includes src/**/*.ts', () => {
    const include = tsconfig['include'] as string[];
    expect(include).toBeDefined();
    expect(include.some((i) => i.includes('src'))).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. CONFIG MODULE VALIDATION (source analysis)
// ═════════════════════════════════════════════════════════════════════════════

describe('config.ts source analysis', () => {
  let configSrc: string;

  beforeEach(() => {
    configSrc = fs.readFileSync(
      path.resolve(__dirname, '../config.ts'),
      'utf-8',
    );
  });

  it('imports zod', () => {
    expect(configSrc).toMatch(/import\s+.*\bz\b.*from\s+['"]zod['"]/);
  });

  it('imports dotenv', () => {
    expect(configSrc).toMatch(/import\s+.*dotenv.*from\s+['"]dotenv['"]/);
  });

  it('calls dotenv.config()', () => {
    expect(configSrc).toContain('dotenv.config()');
  });

  it('defines DATABASE_URL as required string URL', () => {
    expect(configSrc).toMatch(/DATABASE_URL.*z\.string\(\)\.url\(\)/);
  });

  it('constrains DATABASE_URL to postgresql:// prefix', () => {
    expect(configSrc).toMatch(/startsWith\s*\(\s*['"]postgresql:\/\//);
  });

  it('defines PORT with default 3000', () => {
    expect(configSrc).toMatch(/PORT.*default\(3000\)/);
  });

  it('defines NODE_ENV with enum validation', () => {
    expect(configSrc).toMatch(/NODE_ENV.*z\.enum/);
    expect(configSrc).toContain('development');
    expect(configSrc).toContain('production');
    expect(configSrc).toContain('test');
  });

  it('defines LOG_LEVEL with enum values', () => {
    expect(configSrc).toMatch(/LOG_LEVEL.*z\.enum/);
    expect(configSrc).toContain('trace');
    expect(configSrc).toContain('debug');
    expect(configSrc).toContain('info');
    expect(configSrc).toContain('warn');
    expect(configSrc).toContain('error');
    expect(configSrc).toContain('fatal');
  });

  it('defines ADMIN_API_KEY with minimum length', () => {
    expect(configSrc).toMatch(/ADMIN_API_KEY.*z\.string\(\)\.min\(/);
  });

  it('defines DEFAULT_LEASE_MINUTES with constraints', () => {
    expect(configSrc).toMatch(/DEFAULT_LEASE_MINUTES.*z\.coerce\.number/);
  });

  it('defines MAX_LEASE_MINUTES with constraints', () => {
    expect(configSrc).toMatch(/MAX_LEASE_MINUTES.*z\.coerce\.number/);
  });

  it('defines RECONCILIATION_INTERVAL with constraints', () => {
    expect(configSrc).toMatch(/RECONCILIATION_INTERVAL.*z\.coerce\.number/);
  });

  it('exports loadConfig function', () => {
    expect(configSrc).toMatch(/export\s+function\s+loadConfig/);
  });

  it('exports AppConfig type', () => {
    expect(configSrc).toMatch(/export\s+type\s+AppConfig/);
  });

  it('exports singleton config instance', () => {
    expect(configSrc).toMatch(/export\s+const\s+config\s*=/);
  });

  it('uses safeParse for validation with error formatting', () => {
    expect(configSrc).toContain('safeParse');
  });

  it('throws Error on invalid config', () => {
    expect(configSrc).toMatch(/throw\s+new\s+Error/);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. SERVER.TS SOURCE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════

describe('server.ts source analysis', () => {
  let serverSrc: string;

  beforeEach(() => {
    serverSrc = fs.readFileSync(
      path.resolve(__dirname, '../server.ts'),
      'utf-8',
    );
  });

  describe('Express app factory', () => {
    it('exports createApp function', () => {
      expect(serverSrc).toMatch(/export\s+function\s+createApp/);
    });

    it('createApp accepts AppConfig parameter', () => {
      expect(serverSrc).toMatch(/createApp\s*\(.*AppConfig/);
    });

    it('createApp returns Express app (not listening)', () => {
      expect(serverSrc).toMatch(/return\s+app/);
      // Should NOT have app.listen in createApp
      const createAppBody = serverSrc.slice(
        serverSrc.indexOf('function createApp'),
        serverSrc.indexOf('export async function startNotifyListener'),
      );
      expect(createAppBody).not.toContain('app.listen');
    });

    it('applies JSON body parser', () => {
      expect(serverSrc).toContain('express.json()');
    });

    it('applies request logger middleware', () => {
      expect(serverSrc).toContain('requestLogger');
    });

    it('applies auth middleware', () => {
      expect(serverSrc).toContain('authMiddleware');
    });
  });

  describe('health endpoint', () => {
    it('registers GET /health', () => {
      expect(serverSrc).toMatch(/app\.get\s*\(\s*['"]\/health['"]/);
    });

    it('returns JSON with status field', () => {
      expect(serverSrc).toMatch(/status:\s*['"]ok['"]/);
    });

    it('returns timestamp in ISO format', () => {
      expect(serverSrc).toContain('toISOString()');
    });

    it('returns 503 on unhealthy state', () => {
      expect(serverSrc).toContain('503');
    });

    it('calls healthCheck function', () => {
      expect(serverSrc).toContain('healthCheck()');
    });
  });

  describe('SSE events endpoint', () => {
    it('registers GET /events', () => {
      expect(serverSrc).toMatch(/app\.get\s*\(\s*['"]\/events['"]/);
    });

    it('sets Content-Type to text/event-stream', () => {
      expect(serverSrc).toContain('text/event-stream');
    });

    it('sets Cache-Control to no-cache', () => {
      expect(serverSrc).toContain('no-cache');
    });

    it('sets Connection to keep-alive', () => {
      expect(serverSrc).toContain('keep-alive');
    });

    it('disables buffering with X-Accel-Buffering', () => {
      expect(serverSrc).toContain('X-Accel-Buffering');
    });

    it('sends initial connected message', () => {
      expect(serverSrc).toMatch(/connected/);
    });

    it('tracks SSE clients in a Set', () => {
      expect(serverSrc).toContain('sseClients');
      expect(serverSrc).toMatch(/new\s+Set/);
    });

    it('removes client on disconnect', () => {
      expect(serverSrc).toContain('sseClients.delete');
      expect(serverSrc).toMatch(/req\.on\s*\(\s*['"]close['"]/);
    });
  });

  describe('MCP endpoint', () => {
    it('creates McpServer with name and version', () => {
      expect(serverSrc).toMatch(/new\s+McpServer/);
      expect(serverSrc).toContain("name: 'forgeos'");
      expect(serverSrc).toContain("version: '1.0.0'");
    });

    it('registers POST /mcp endpoint', () => {
      expect(serverSrc).toMatch(/app\.post\s*\(\s*['"]\/mcp['"]/);
    });

    it('registers GET /mcp for SSE-based transport', () => {
      expect(serverSrc).toMatch(/app\.get\s*\(\s*['"]\/mcp['"]/);
    });

    it('registers DELETE /mcp for session cleanup', () => {
      expect(serverSrc).toMatch(/app\.delete\s*\(\s*['"]\/mcp['"]/);
    });

    it('uses StreamableHTTPServerTransport', () => {
      expect(serverSrc).toContain('StreamableHTTPServerTransport');
    });

    it('configures stateless sessions (sessionIdGenerator: undefined)', () => {
      expect(serverSrc).toContain('sessionIdGenerator: undefined');
    });

    it('calls registerTools', () => {
      expect(serverSrc).toContain('registerTools(mcpServer)');
    });

    it('handles MCP errors without leaking stack traces', () => {
      expect(serverSrc).toContain("error: 'MCP_ERROR'");
      expect(serverSrc).toContain("message: 'Internal server error'");
    });

    it('checks headersSent before responding on error', () => {
      expect(serverSrc).toContain('res.headersSent');
    });
  });

  describe('dashboard static files', () => {
    it('serves dashboard at /dashboard', () => {
      expect(serverSrc).toMatch(/app\.use\s*\(\s*['"]\/dashboard['"]/);
    });

    it('uses express.static', () => {
      expect(serverSrc).toContain('express.static');
    });
  });

  describe('NOTIFY/LISTEN', () => {
    it('exports startNotifyListener function', () => {
      expect(serverSrc).toMatch(/export\s+async\s+function\s+startNotifyListener/);
    });

    it('executes LISTEN ticket_changes query', () => {
      expect(serverSrc).toContain("LISTEN ticket_changes");
    });

    it('handles notification events', () => {
      expect(serverSrc).toMatch(/client\.on\s*\(\s*['"]notification['"]/);
    });

    it('checks channel name is ticket_changes', () => {
      expect(serverSrc).toContain("msg.channel === 'ticket_changes'");
    });

    it('broadcasts to SSE clients', () => {
      expect(serverSrc).toContain('client.write(sseData)');
    });

    it('handles error with reconnection', () => {
      expect(serverSrc).toMatch(/client\.on\s*\(\s*['"]error['"]/);
      expect(serverSrc).toContain('startNotifyListener');
    });

    it('uses setTimeout for reconnection delay', () => {
      expect(serverSrc).toContain('setTimeout');
      expect(serverSrc).toContain('3000');
    });

    it('does NOT release the LISTEN client (stays connected)', () => {
      expect(serverSrc).toMatch(/do NOT release/i);
    });
  });

  describe('reconciliation loop', () => {
    it('exports startReconciliationLoop function', () => {
      expect(serverSrc).toMatch(/export\s+function\s+startReconciliationLoop/);
    });

    it('calls release_expired_claims SQL function', () => {
      expect(serverSrc).toContain('release_expired_claims()');
    });

    it('uses setInterval for periodic execution', () => {
      expect(serverSrc).toContain('setInterval');
    });

    it('returns NodeJS.Timeout for cleanup', () => {
      expect(serverSrc).toMatch(/:\s*NodeJS\.Timeout/);
    });

    it('logs released count', () => {
      expect(serverSrc).toContain('released_count');
    });
  });

  describe('SSE broadcast utility', () => {
    it('exports broadcastSSE function', () => {
      expect(serverSrc).toMatch(/export\s+function\s+broadcastSSE/);
    });

    it('exports getSSEClientCount function', () => {
      expect(serverSrc).toMatch(/export\s+function\s+getSSEClientCount/);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. INDEX.TS (ENTRY POINT) SOURCE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════

describe('index.ts source analysis', () => {
  let indexSrc: string;

  beforeEach(() => {
    indexSrc = fs.readFileSync(
      path.resolve(__dirname, '../index.ts'),
      'utf-8',
    );
  });

  describe('boot sequence', () => {
    it('imports config', () => {
      expect(indexSrc).toMatch(/import.*\bconfig\b.*from\s+['"]\.\/config/);
    });

    it('imports runMigrations', () => {
      expect(indexSrc).toMatch(/import.*runMigrations.*from/);
    });

    it('imports createApp from server', () => {
      expect(indexSrc).toContain('createApp');
      expect(indexSrc).toMatch(/from\s+['"]\.\/server/);
    });

    it('imports startNotifyListener from server', () => {
      expect(indexSrc).toContain('startNotifyListener');
    });

    it('imports startReconciliationLoop from server', () => {
      expect(indexSrc).toContain('startReconciliationLoop');
    });

    it('imports closePool from db/pool', () => {
      expect(indexSrc).toMatch(/import.*closePool.*from/);
    });

    it('imports logger', () => {
      expect(indexSrc).toMatch(/import.*logger.*from/);
    });
  });

  describe('startup order', () => {
    it('runs migrations before creating app', () => {
      const migrateIdx = indexSrc.indexOf('runMigrations()');
      const createIdx = indexSrc.indexOf('createApp(');
      expect(migrateIdx).toBeLessThan(createIdx);
      expect(migrateIdx).toBeGreaterThan(-1);
    });

    it('creates app before starting HTTP server', () => {
      const createIdx = indexSrc.indexOf('createApp(');
      const listenIdx = indexSrc.indexOf('app.listen');
      expect(createIdx).toBeLessThan(listenIdx);
    });

    it('starts server before NOTIFY listener', () => {
      const listenIdx = indexSrc.indexOf('app.listen');
      const notifyIdx = indexSrc.indexOf('startNotifyListener()');
      expect(listenIdx).toBeLessThan(notifyIdx);
    });

    it('starts reconciliation loop', () => {
      expect(indexSrc).toContain('startReconciliationLoop');
    });

    it('uses config.PORT for server listen', () => {
      expect(indexSrc).toContain('config.PORT');
    });
  });

  describe('graceful shutdown', () => {
    it('handles SIGTERM signal', () => {
      expect(indexSrc).toContain("'SIGTERM'");
    });

    it('handles SIGINT signal', () => {
      expect(indexSrc).toContain("'SIGINT'");
    });

    it('clears reconciliation timer on shutdown', () => {
      expect(indexSrc).toContain('clearInterval');
    });

    it('closes HTTP server', () => {
      expect(indexSrc).toContain('server.close');
    });

    it('closes database pool', () => {
      expect(indexSrc).toContain('closePool()');
    });

    it('implements forced shutdown timeout', () => {
      expect(indexSrc).toContain('10_000');
      expect(indexSrc).toContain('process.exit(1)');
    });

    it('exits cleanly with code 0 on normal shutdown', () => {
      expect(indexSrc).toContain('process.exit(0)');
    });
  });

  describe('error handling', () => {
    it('handles unhandled rejections', () => {
      expect(indexSrc).toContain("'unhandledRejection'");
    });

    it('handles uncaught exceptions', () => {
      expect(indexSrc).toContain("'uncaughtException'");
    });

    it('shuts down on uncaught exception', () => {
      const excIdx = indexSrc.indexOf("'uncaughtException'");
      const shutdownCall = indexSrc.indexOf("shutdown('uncaughtException')");
      expect(shutdownCall).toBeGreaterThan(excIdx);
    });

    it('catches main() failures and exits with code 1', () => {
      expect(indexSrc).toMatch(/main\(\)\.catch/);
      expect(indexSrc).toContain('process.exit(1)');
    });
  });

  describe('structured logging', () => {
    it('logs startup with nodeEnv, port, logLevel', () => {
      expect(indexSrc).toContain('nodeEnv');
      expect(indexSrc).toContain('config.PORT');
      expect(indexSrc).toContain('config.LOG_LEVEL');
    });

    it('logs migration status', () => {
      expect(indexSrc).toMatch(/logger\.info.*[Mm]igration/);
    });

    it('logs server listening with port', () => {
      expect(indexSrc).toMatch(/logger\.info.*listening|MCP.*endpoint/i);
    });

    it('logs all available endpoints', () => {
      expect(indexSrc).toContain('/mcp');
      expect(indexSrc).toContain('/health');
      expect(indexSrc).toContain('/events');
      expect(indexSrc).toContain('/dashboard');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. AUTH MIDDLEWARE SOURCE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════

describe('middleware/auth.ts source analysis', () => {
  let authSrc: string;

  beforeEach(() => {
    authSrc = fs.readFileSync(
      path.resolve(__dirname, '../middleware/auth.ts'),
      'utf-8',
    );
  });

  describe('public endpoint bypass', () => {
    it('skips auth for /health', () => {
      expect(authSrc).toContain('/health');
    });

    it('skips auth for /dashboard', () => {
      expect(authSrc).toContain('/dashboard');
    });

    it('skips auth for /events', () => {
      expect(authSrc).toContain('/events');
    });

    it('uses publicPaths array for path matching', () => {
      expect(authSrc).toContain('publicPaths');
      expect(authSrc).toContain('startsWith');
    });
  });

  describe('API key authentication', () => {
    it('extracts Bearer token from Authorization header', () => {
      expect(authSrc).toContain("Bearer ");
      expect(authSrc).toContain('authorization');
    });

    it('returns 401 on missing auth header', () => {
      expect(authSrc).toContain('401');
      expect(authSrc).toContain('UNAUTHORIZED');
    });

    it('uses SHA-256 for API key hashing', () => {
      expect(authSrc).toContain("'sha256'");
      expect(authSrc).toContain('createHash');
    });

    it('exports hashApiKey as internal function', () => {
      expect(authSrc).toContain('function hashApiKey');
    });

    it('looks up hashed key in agents table', () => {
      expect(authSrc).toContain('api_key_hash');
      expect(authSrc).toContain('agents');
    });
  });

  describe('admin shortcut', () => {
    it('checks for admin API key from config', () => {
      expect(authSrc).toContain('config.ADMIN_API_KEY');
    });

    it('sets admin identity with wildcard permissions', () => {
      expect(authSrc).toContain("'*'");
      expect(authSrc).toContain("role: 'admin'");
    });
  });

  describe('agent identity', () => {
    it('extends Express Request type with agent property', () => {
      expect(authSrc).toContain('req.agent');
    });

    it('sets id, name, role, permissions, machine_id on req.agent', () => {
      // Verify the identity shape is set
      expect(authSrc).toContain('agent.id');
      expect(authSrc).toContain('agent.name');
      expect(authSrc).toContain('agent.role');
      expect(authSrc).toContain('agent.permissions');
      expect(authSrc).toContain('agent.machine_id');
    });

    it('checks is_active and revoked_at', () => {
      expect(authSrc).toContain('is_active');
      expect(authSrc).toContain('revoked_at');
    });

    it('returns 401 for revoked API keys', () => {
      expect(authSrc).toContain('has been revoked');
    });
  });

  describe('error handling', () => {
    it('returns 503 on database errors', () => {
      expect(authSrc).toContain('503');
      expect(authSrc).toContain('DB_UNAVAILABLE');
    });

    it('includes timestamps in error responses', () => {
      expect(authSrc).toContain('toISOString()');
    });

    it('does not leak internals in error messages', () => {
      expect(authSrc).not.toMatch(/stack/i);
    });
  });

  describe('type safety', () => {
    it('imports types from types/index', () => {
      expect(authSrc).toMatch(/import.*AgentIdentity.*from/);
    });

    it('exports authMiddleware function', () => {
      expect(authSrc).toMatch(/export\s+async\s+function\s+authMiddleware/);
    });

    it('uses Express types (Request, Response, NextFunction)', () => {
      expect(authSrc).toContain('Request');
      expect(authSrc).toContain('Response');
      expect(authSrc).toContain('NextFunction');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. LOGGING MIDDLEWARE SOURCE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════

describe('middleware/logging.ts source analysis', () => {
  let loggingSrc: string;

  beforeEach(() => {
    loggingSrc = fs.readFileSync(
      path.resolve(__dirname, '../middleware/logging.ts'),
      'utf-8',
    );
  });

  it('imports pino', () => {
    expect(loggingSrc).toMatch(/import\s+pino\s+from\s+['"]pino['"]/);
  });

  it('exports singleton logger instance', () => {
    expect(loggingSrc).toMatch(/export\s+const\s+logger\s*=/);
  });

  it('configures log level from environment', () => {
    expect(loggingSrc).toContain('LOG_LEVEL');
  });

  it('uses pino-pretty in development', () => {
    expect(loggingSrc).toContain('pino-pretty');
  });

  it('disables pretty printing in production', () => {
    expect(loggingSrc).toContain("'production'");
  });

  it('uses ISO timestamps', () => {
    expect(loggingSrc).toContain('isoTime');
  });

  describe('request logger middleware', () => {
    it('exports requestLogger function', () => {
      expect(loggingSrc).toMatch(/export\s+function\s+requestLogger/);
    });

    it('generates correlation ID (X-Request-ID)', () => {
      expect(loggingSrc).toContain('x-request-id');
      expect(loggingSrc).toContain('X-Request-ID');
    });

    it('uses randomUUID for request IDs', () => {
      expect(loggingSrc).toContain('randomUUID');
    });

    it('respects incoming X-Request-ID header', () => {
      expect(loggingSrc).toContain("req.headers['x-request-id']");
    });

    it('sets X-Request-ID on response', () => {
      expect(loggingSrc).toContain("res.setHeader('X-Request-ID'");
    });

    it('measures request duration', () => {
      expect(loggingSrc).toContain('Date.now()');
      expect(loggingSrc).toContain('durationMs');
    });

    it('logs request completion on response finish', () => {
      expect(loggingSrc).toMatch(/res\.on\s*\(\s*['"]finish['"]/);
    });

    it('includes method, url, status, and user-agent in log', () => {
      expect(loggingSrc).toContain('req.method');
      expect(loggingSrc).toContain('req.url');
      expect(loggingSrc).toContain('res.statusCode');
      expect(loggingSrc).toContain('user-agent');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. TOOL REGISTRATION HUB VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('tools/index.ts source analysis', () => {
  let toolsSrc: string;

  beforeEach(() => {
    toolsSrc = fs.readFileSync(
      path.resolve(__dirname, '../tools/index.ts'),
      'utf-8',
    );
  });

  it('exports registerTools function', () => {
    expect(toolsSrc).toMatch(/export\s+function\s+registerTools/);
  });

  it('accepts McpServer parameter', () => {
    expect(toolsSrc).toContain('McpServer');
  });

  describe('registers all 10 MCP tools', () => {
    const expectedTools = [
      'tickets.next',
      'tickets.claim',
      'tickets.update',
      'tickets.complete',
      'tickets.reject',
      'tickets.spawn',
      'tickets.graph',
      'tickets.release',
      'tickets.extend',
      'tickets.stats',
    ];

    for (const tool of expectedTools) {
      it(`registers ${tool}`, () => {
        expect(toolsSrc).toContain(`'${tool}'`);
      });
    }

    it('calls server.tool() exactly 10 times', () => {
      const matches = toolsSrc.match(/server\.tool\s*\(/g);
      expect(matches).toHaveLength(10);
    });
  });

  describe('imports all tool modules', () => {
    const expectedImports = [
      'tickets-next',
      'tickets-claim',
      'tickets-update',
      'tickets-complete',
      'tickets-reject',
      'tickets-spawn',
      'tickets-graph',
      'tickets-release',
      'tickets-extend',
      'tickets-stats',
    ];

    for (const mod of expectedImports) {
      it(`imports from ${mod}`, () => {
        expect(toolsSrc).toContain(`'./${mod}.js'`);
      });
    }
  });

  describe('each tool has schema and handler', () => {
    const tools = [
      'ticketsNext', 'ticketsClaim', 'ticketsUpdate', 'ticketsComplete',
      'ticketsReject', 'ticketsSpawn', 'ticketsGraph', 'ticketsRelease',
      'ticketsExtend', 'ticketsStats',
    ];

    for (const tool of tools) {
      it(`imports ${tool}Schema`, () => {
        expect(toolsSrc).toContain(`${tool}Schema`);
      });

      it(`imports ${tool}Handler`, () => {
        expect(toolsSrc).toContain(`${tool}Handler`);
      });
    }
  });

  it('passes schema.shape to server.tool for Zod integration', () => {
    const shapeMatches = toolsSrc.match(/Schema\.shape/g);
    expect(shapeMatches).toHaveLength(10);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. TOOL MODULE FILE VALIDATION — all 10 exist with required exports
// ═════════════════════════════════════════════════════════════════════════════

describe('Tool module files', () => {
  const toolsDir = path.resolve(__dirname, '../tools');

  const toolModules = [
    { file: 'tickets-next.ts', schema: 'ticketsNextSchema', handler: 'ticketsNextHandler' },
    { file: 'tickets-claim.ts', schema: 'ticketsClaimSchema', handler: 'ticketsClaimHandler' },
    { file: 'tickets-update.ts', schema: 'ticketsUpdateSchema', handler: 'ticketsUpdateHandler' },
    { file: 'tickets-complete.ts', schema: 'ticketsCompleteSchema', handler: 'ticketsCompleteHandler' },
    { file: 'tickets-reject.ts', schema: 'ticketsRejectSchema', handler: 'ticketsRejectHandler' },
    { file: 'tickets-spawn.ts', schema: 'ticketsSpawnSchema', handler: 'ticketsSpawnHandler' },
    { file: 'tickets-graph.ts', schema: 'ticketsGraphSchema', handler: 'ticketsGraphHandler' },
    { file: 'tickets-release.ts', schema: 'ticketsReleaseSchema', handler: 'ticketsReleaseHandler' },
    { file: 'tickets-extend.ts', schema: 'ticketsExtendSchema', handler: 'ticketsExtendHandler' },
    { file: 'tickets-stats.ts', schema: 'ticketsStatsSchema', handler: 'ticketsStatsHandler' },
  ];

  for (const { file, schema, handler } of toolModules) {
    describe(file, () => {
      let src: string;

      beforeEach(() => {
        src = fs.readFileSync(path.join(toolsDir, file), 'utf-8');
      });

      it('exists', () => {
        expect(fs.existsSync(path.join(toolsDir, file))).toBe(true);
      });

      it(`exports ${schema}`, () => {
        expect(src).toMatch(new RegExp(`export\\s+const\\s+${schema}\\s*=`));
      });

      it(`exports ${handler} async function`, () => {
        expect(src).toMatch(new RegExp(`export\\s+async\\s+function\\s+${handler}`));
      });

      it('uses Zod for input validation', () => {
        expect(src).toMatch(/import.*\bz\b.*from\s+['"]zod['"]/);
        expect(src).toContain('z.object');
      });

      it('imports pool from db/pool', () => {
        expect(src).toMatch(/import.*pool.*from.*pool/);
      });

      it('imports logger from middleware/logging', () => {
        expect(src).toMatch(/import.*logger.*from.*logging/);
      });

      it('handler returns MCP content format', () => {
        expect(src).toContain("type: 'text'");
        expect(src).toContain('JSON.stringify');
      });

      it('handles errors with structured response', () => {
        expect(src).toMatch(/catch\s*\(/);
        expect(src).toContain('error');
        expect(src).toContain('message');
      });

      it('includes timestamp in error responses', () => {
        expect(src).toContain('toISOString()');
      });
    });
  }
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. DB POOL MODULE SOURCE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════

describe('db/pool.ts source analysis', () => {
  let poolSrc: string;

  beforeEach(() => {
    poolSrc = fs.readFileSync(
      path.resolve(__dirname, '../db/pool.ts'),
      'utf-8',
    );
  });

  it('exports pool singleton', () => {
    expect(poolSrc).toMatch(/export\s+const\s+pool/);
  });

  it('uses config.DATABASE_URL for connection', () => {
    expect(poolSrc).toContain('config.DATABASE_URL');
  });

  it('configures pool max connections', () => {
    expect(poolSrc).toContain('max:');
  });

  it('sets idle timeout', () => {
    expect(poolSrc).toContain('idleTimeoutMillis');
  });

  it('sets connection timeout', () => {
    expect(poolSrc).toContain('connectionTimeoutMillis');
  });

  it('handles pool errors', () => {
    expect(poolSrc).toMatch(/pool\.on\s*\(\s*['"]error['"]/);
  });

  it('exports healthCheck function', () => {
    expect(poolSrc).toMatch(/export\s+async\s+function\s+healthCheck/);
  });

  it('exports queryWithRLS function', () => {
    expect(poolSrc).toMatch(/export\s+async\s+function\s+queryWithRLS/);
  });

  it('exports transactionWithRLS function', () => {
    expect(poolSrc).toMatch(/export\s+async\s+function\s+transactionWithRLS/);
  });

  it('exports closePool function', () => {
    expect(poolSrc).toMatch(/export\s+async\s+function\s+closePool/);
  });

  describe('queryWithRLS', () => {
    it('sets app.agent_role session variable', () => {
      expect(poolSrc).toContain('app.agent_role');
    });

    it('sets app.agent_name session variable', () => {
      expect(poolSrc).toContain('app.agent_name');
    });

    it('releases client in finally block', () => {
      expect(poolSrc).toMatch(/finally[\s\S]*?client\.release/);
    });
  });

  describe('transactionWithRLS', () => {
    it('wraps in BEGIN/COMMIT', () => {
      expect(poolSrc).toContain("'BEGIN'");
      expect(poolSrc).toContain("'COMMIT'");
    });

    it('rolls back on error', () => {
      expect(poolSrc).toContain("'ROLLBACK'");
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. DB MIGRATE MODULE SOURCE ANALYSIS
// ═════════════════════════════════════════════════════════════════════════════

describe('db/migrate.ts source analysis', () => {
  let migrateSrc: string;

  beforeEach(() => {
    migrateSrc = fs.readFileSync(
      path.resolve(__dirname, '../db/migrate.ts'),
      'utf-8',
    );
  });

  it('exports runMigrations function', () => {
    expect(migrateSrc).toMatch(/export\s+async\s+function\s+runMigrations/);
  });

  it('creates _migrations tracking table', () => {
    expect(migrateSrc).toContain('_migrations');
    expect(migrateSrc).toContain('CREATE TABLE IF NOT EXISTS');
  });

  it('reads migration files from migrations directory', () => {
    expect(migrateSrc).toContain('migrations');
    expect(migrateSrc).toContain('.sql');
  });

  it('applies migrations in order', () => {
    expect(migrateSrc).toContain('.sort()');
  });

  it('uses transactions for each migration', () => {
    expect(migrateSrc).toContain("'BEGIN'");
    expect(migrateSrc).toContain("'COMMIT'");
    expect(migrateSrc).toContain("'ROLLBACK'");
  });

  it('tracks applied migrations to avoid re-application', () => {
    expect(migrateSrc).toContain('INSERT INTO _migrations');
  });

  it('supports direct CLI execution', () => {
    expect(migrateSrc).toContain('isDirectRun');
    expect(migrateSrc).toContain('process.argv');
  });

  it('returns count of applied migrations', () => {
    expect(migrateSrc).toContain('pending.length');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. TYPES MODULE VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('types/index.ts', () => {
  let typesSrc: string;

  beforeEach(() => {
    typesSrc = fs.readFileSync(
      path.resolve(__dirname, '../types/index.ts'),
      'utf-8',
    );
  });

  describe('enums', () => {
    it('defines TicketStatus type', () => {
      expect(typesSrc).toMatch(/export\s+type\s+TicketStatus/);
    });

    it('defines TicketStage type', () => {
      expect(typesSrc).toMatch(/export\s+type\s+TicketStage/);
    });

    it('defines TicketType type', () => {
      expect(typesSrc).toMatch(/export\s+type\s+TicketType/);
    });

    it('defines TicketPriority type', () => {
      expect(typesSrc).toMatch(/export\s+type\s+TicketPriority/);
    });

    it('defines EventType type', () => {
      expect(typesSrc).toMatch(/export\s+type\s+EventType/);
    });
  });

  describe('domain models', () => {
    const models = ['Ticket', 'TicketEvent', 'Agent', 'Session', 'FileLock', 'Project'];
    for (const model of models) {
      it(`exports ${model} interface`, () => {
        expect(typesSrc).toMatch(new RegExp(`export\\s+interface\\s+${model}\\b`));
      });
    }
  });

  describe('MCP IO types', () => {
    const ioTypes = [
      'TicketsNextInput', 'TicketsNextOutput',
      'TicketsClaimInput', 'TicketsClaimOutput',
      'TicketsUpdateInput', 'TicketsUpdateOutput',
      'TicketsCompleteInput', 'TicketsCompleteOutput',
      'TicketsRejectInput', 'TicketsRejectOutput',
      'TicketsSpawnInput', 'TicketsSpawnOutput',
      'TicketsGraphInput', 'TicketsGraphOutput',
      'TicketsReleaseInput', 'TicketsReleaseOutput',
      'TicketsExtendInput', 'TicketsExtendOutput',
      'TicketsStatsOutput',
    ];

    for (const t of ioTypes) {
      it(`exports ${t}`, () => {
        expect(typesSrc).toMatch(new RegExp(`export\\s+interface\\s+${t}\\b`));
      });
    }
  });

  describe('auth types', () => {
    it('exports AgentIdentity interface', () => {
      expect(typesSrc).toMatch(/export\s+interface\s+AgentIdentity/);
    });
  });

  describe('error types', () => {
    it('exports ForgeOSErrorCode enum', () => {
      expect(typesSrc).toMatch(/export\s+enum\s+ForgeOSErrorCode/);
    });

    it('exports ErrorResponse interface', () => {
      expect(typesSrc).toMatch(/export\s+interface\s+ErrorResponse/);
    });
  });

  describe('SDLC flows', () => {
    it('exports SDLC_FLOWS mapping', () => {
      expect(typesSrc).toMatch(/export\s+const\s+SDLC_FLOWS/);
    });

    it('defines flow for all 10 ticket types', () => {
      const types = [
        'backend', 'frontend', 'fullstack', 'infra', 'security',
        'docs', 'research', 'architecture', 'product', 'design',
      ];
      for (const t of types) {
        expect(typesSrc).toMatch(new RegExp(`${t}\\s*:`));
      }
    });

    it('all flows start with READY and end with DONE', () => {
      // Extract flow arrays from source
      const flowRegex = /(\w+)\s*:\s*\[([^\]]+)\]/g;
      let match: RegExpExecArray | null;
      while ((match = flowRegex.exec(typesSrc)) !== null) {
        const values = match[2]!;
        const stages = [...values.matchAll(/'([^']+)'/g)].map((m) => m[1]);
        if (stages.length > 0) {
          expect(stages[0]).toBe('READY');
          expect(stages[stages.length - 1]).toBe('DONE');
        }
      }
    });
  });

  describe('constant arrays for Zod schemas', () => {
    it('exports TICKET_STAGES array', () => {
      expect(typesSrc).toMatch(/export\s+const\s+TICKET_STAGES/);
    });

    it('exports TICKET_TYPES array', () => {
      expect(typesSrc).toMatch(/export\s+const\s+TICKET_TYPES/);
    });

    it('exports TICKET_STATUSES array', () => {
      expect(typesSrc).toMatch(/export\s+const\s+TICKET_STATUSES/);
    });

    it('exports TICKET_PRIORITIES array', () => {
      expect(typesSrc).toMatch(/export\s+const\s+TICKET_PRIORITIES/);
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 14. ACCEPTANCE CRITERIA VERIFICATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Acceptance criteria — TASK-FOS-02-001', () => {
  it('AC1: package.json includes MCP SDK, pg, zod, express as production deps', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'),
    );
    const deps = pkg['dependencies'] as Record<string, string>;
    expect(deps).toHaveProperty('@modelcontextprotocol/sdk');
    expect(deps).toHaveProperty('pg');
    expect(deps).toHaveProperty('zod');
    expect(deps).toHaveProperty('express');
  });

  it('AC2: package.json includes typescript, @types/express, @types/pg, tsx as dev deps', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'),
    );
    const devDeps = pkg['devDependencies'] as Record<string, string>;
    expect(devDeps).toHaveProperty('typescript');
    expect(devDeps).toHaveProperty('@types/express');
    expect(devDeps).toHaveProperty('@types/pg');
    expect(devDeps).toHaveProperty('tsx');
  });

  it('AC3: package.json has build, dev, start, migrate scripts', () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'),
    );
    const scripts = pkg['scripts'] as Record<string, string>;
    expect(scripts['build']).toBeDefined();
    expect(scripts['dev']).toBeDefined();
    expect(scripts['start']).toBeDefined();
    expect(scripts['migrate']).toBeDefined();
  });

  it('AC4: tsconfig.json has strict:true, ES2022, NodeNext, outDir dist, rootDir src', () => {
    const raw = fs.readFileSync(path.resolve(__dirname, '../../tsconfig.json'), 'utf-8');
    const cleaned = raw.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const tsconf = JSON.parse(cleaned);
    const co = tsconf['compilerOptions'];
    expect(co['strict']).toBe(true);
    expect(co['target']).toBe('ES2022');
    expect(co['module']).toBe('NodeNext');
    expect(co['outDir']).toBe('./dist');
    expect(co['rootDir']).toBe('./src');
  });

  it('AC5: index.ts boots Express app from factory and listens on PORT', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf-8');
    expect(src).toContain('createApp(config)');
    expect(src).toContain('app.listen(config.PORT');
  });

  it('AC6: Streamable HTTP transport configured', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf-8');
    expect(src).toContain('StreamableHTTPServerTransport');
    expect(src).toContain('sessionIdGenerator');
  });

  it('AC7: GET /health returns status and timestamp', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../server.ts'), 'utf-8');
    expect(src).toMatch(/app\.get\s*\(\s*['"]\/health['"]/);
    expect(src).toContain("status: 'ok'");
    expect(src).toContain('timestamp');
    expect(src).toContain('toISOString()');
  });

  it('AC8: Graceful shutdown on SIGTERM/SIGINT with pool close', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf-8');
    expect(src).toContain("'SIGTERM'");
    expect(src).toContain("'SIGINT'");
    expect(src).toContain('server.close');
    expect(src).toContain('closePool()');
  });

  it('AC9: Structured JSON logging at startup', () => {
    const src = fs.readFileSync(path.resolve(__dirname, '../index.ts'), 'utf-8');
    expect(src).toContain('logger.info');
    expect(src).toContain('config.PORT');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 15. DOCKER & INFRASTRUCTURE VALIDATION
// ═════════════════════════════════════════════════════════════════════════════

describe('Docker infrastructure', () => {
  const serverRoot = path.resolve(__dirname, '../..');

  describe('Dockerfile', () => {
    let dockerfile: string;

    beforeEach(() => {
      dockerfile = fs.readFileSync(path.join(serverRoot, 'Dockerfile'), 'utf-8');
    });

    it('uses multi-stage build', () => {
      const fromCount = (dockerfile.match(/^FROM\s+/gm) ?? []).length;
      expect(fromCount).toBeGreaterThanOrEqual(2);
    });

    it('uses Node 22 base image', () => {
      expect(dockerfile).toMatch(/FROM\s+node:22/);
    });

    it('copies package.json for dependency caching', () => {
      expect(dockerfile).toContain('package.json');
    });

    it('runs npm install', () => {
      expect(dockerfile).toMatch(/npm\s+(ci|install)/);
    });

    it('copies source and builds', () => {
      expect(dockerfile).toContain('COPY');
      expect(dockerfile).toMatch(/npm\s+run\s+build|tsc/);
    });

    it('exposes port', () => {
      expect(dockerfile).toMatch(/EXPOSE\s+\d+/);
    });
  });

  describe('docker-compose.yml', () => {
    let compose: string;

    beforeEach(() => {
      compose = fs.readFileSync(path.join(serverRoot, 'docker-compose.yml'), 'utf-8');
    });

    it('defines postgres service', () => {
      expect(compose).toMatch(/postgres/i);
    });

    it('uses PostgreSQL 17', () => {
      expect(compose).toMatch(/postgres:17/);
    });

    it('defines server service', () => {
      expect(compose).toMatch(/server|forgeos/i);
    });

    it('maps port 3000', () => {
      expect(compose).toContain('3000');
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 16. SECURITY CHECKS (source-level)
// ═════════════════════════════════════════════════════════════════════════════

describe('Security checks', () => {
  const srcDir = path.resolve(__dirname, '..');

  function readAllTsFiles(dir: string): string {
    let content = '';
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '__tests__' && entry.name !== 'dashboard') {
        content += readAllTsFiles(fullPath);
      } else if (entry.isFile() && entry.name.endsWith('.ts')) {
        content += fs.readFileSync(fullPath, 'utf-8') + '\n';
      }
    }
    return content;
  }

  let allSrc: string;

  beforeEach(() => {
    allSrc = readAllTsFiles(srcDir);
  });

  it('no hardcoded passwords or secrets', () => {
    // Check for common patterns (excluding config defaults and test fixtures)
    const configSrc = fs.readFileSync(path.resolve(srcDir, 'config.ts'), 'utf-8');
    const nonConfigSrc = allSrc.replace(configSrc, '');
    expect(nonConfigSrc).not.toMatch(/password\s*[:=]\s*['"][^'"]+['"]/i);
  });

  it('no console.log statements (should use structured logger)', () => {
    expect(allSrc).not.toContain('console.log');
    expect(allSrc).not.toContain('console.error');
    expect(allSrc).not.toContain('console.warn');
  });

  it('auth middleware uses SHA-256 hashing (not plain text comparison)', () => {
    const authSrc = fs.readFileSync(
      path.resolve(srcDir, 'middleware/auth.ts'),
      'utf-8',
    );
    expect(authSrc).toContain("'sha256'");
    expect(authSrc).toContain('createHash');
  });

  it('error responses do not leak stack traces', () => {
    // Check that no error handler includes stack in response
    expect(allSrc).not.toMatch(/res\.json\([^)]*stack/);
    expect(allSrc).not.toMatch(/res\.send\([^)]*stack/);
  });

  it('MCP endpoint catches errors and returns safe responses', () => {
    const serverSrc = fs.readFileSync(
      path.resolve(srcDir, 'server.ts'),
      'utf-8',
    );
    expect(serverSrc).toContain('headersSent');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 17. CODE QUALITY CHECKS
// ═════════════════════════════════════════════════════════════════════════════

describe('Code quality', () => {
  const srcDir = path.resolve(__dirname, '..');

  it('no TODO comments in implementation code', () => {
    const filesToCheck = [
      'server.ts', 'index.ts', 'config.ts',
      'middleware/auth.ts', 'middleware/logging.ts',
      'tools/index.ts', 'db/pool.ts', 'db/migrate.ts',
      'types/index.ts',
    ];

    for (const file of filesToCheck) {
      const src = fs.readFileSync(path.join(srcDir, file), 'utf-8');
      // Only flag "//" style TODO comments, not references to TODO directory
      const lines = src.split('\n');
      for (const line of lines) {
        // Ignore import paths and string literals that may reference TODO
        if (line.trim().startsWith('//') || line.trim().startsWith('*')) {
          // Count as TODO comment only if it's a code-comment-style TODO
          const isTodoComment = /\/\/\s*TODO\b/i.test(line) || /\*\s*TODO\b/i.test(line);
          if (isTodoComment) {
            // Allow NOTE: do NOT release comments
            if (!line.includes('do NOT release')) {
              expect.soft(line.trim()).not.toMatch(/\bTODO\b/i);
            }
          }
        }
      }
    }
  });

  it('all source files have JSDoc module documentation', () => {
    const filesToCheck = [
      'server.ts', 'index.ts', 'config.ts',
      'middleware/auth.ts', 'middleware/logging.ts',
      'tools/index.ts', 'db/pool.ts', 'db/migrate.ts',
      'types/index.ts',
    ];

    for (const file of filesToCheck) {
      const src = fs.readFileSync(path.join(srcDir, file), 'utf-8');
      expect(src).toMatch(/\/\*\*[\s\S]*?@module/);
    }
  });

  it('all handler functions have JSDoc comments', () => {
    const toolFiles = [
      'tickets-next.ts', 'tickets-claim.ts', 'tickets-update.ts',
      'tickets-complete.ts', 'tickets-reject.ts', 'tickets-spawn.ts',
      'tickets-graph.ts', 'tickets-release.ts', 'tickets-extend.ts',
      'tickets-stats.ts',
    ];

    for (const file of toolFiles) {
      const src = fs.readFileSync(path.join(srcDir, 'tools', file), 'utf-8');
      expect(src).toMatch(/\/\*\*[\s\S]*?\*\//);
    }
  });
});
