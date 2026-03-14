/**
 * Tests for SDK config module.
 *
 * @module sdk/config.test
 * @ticket TASK-FOS-06-003
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadSdkConfig, FORBIDDEN_GIT_ADD_PATTERNS } from './config.js';

describe('loadSdkConfig', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns defaults when no env vars are set', () => {
    delete process.env.FORGEOS_MCP_URL;
    delete process.env.FORGEOS_API_KEY;
    delete process.env.FORGEOS_FALLBACK_ENABLED;
    delete process.env.FORGEOS_TICKETS_PY_PATH;
    delete process.env.FORGEOS_MCP_TIMEOUT_MS;
    delete process.env.FORGEOS_WORKSPACE_PATH;

    const config = loadSdkConfig();

    expect(config.FORGEOS_MCP_URL).toBe('http://localhost:3011/mcp');
    expect(config.FORGEOS_API_KEY).toBe('');
    expect(config.FORGEOS_FALLBACK_ENABLED).toBe(true);
    expect(config.FORGEOS_TICKETS_PY_PATH).toBe('.github/tickets.py');
    expect(config.FORGEOS_MCP_TIMEOUT_MS).toBe(10000);
    expect(config.FORGEOS_WORKSPACE_PATH).toBe(process.cwd());
  });

  it('reads FORGEOS_MCP_URL from env', () => {
    process.env.FORGEOS_MCP_URL = 'http://mcp.example.com/mcp';
    delete process.env.FORGEOS_API_KEY;
    delete process.env.FORGEOS_FALLBACK_ENABLED;
    delete process.env.FORGEOS_TICKETS_PY_PATH;
    delete process.env.FORGEOS_MCP_TIMEOUT_MS;
    delete process.env.FORGEOS_WORKSPACE_PATH;

    const config = loadSdkConfig();
    expect(config.FORGEOS_MCP_URL).toBe('http://mcp.example.com/mcp');
  });

  it('sets FORGEOS_FALLBACK_ENABLED to false when env is "false"', () => {
    process.env.FORGEOS_FALLBACK_ENABLED = 'false';
    delete process.env.FORGEOS_MCP_URL;
    delete process.env.FORGEOS_API_KEY;
    delete process.env.FORGEOS_TICKETS_PY_PATH;
    delete process.env.FORGEOS_MCP_TIMEOUT_MS;
    delete process.env.FORGEOS_WORKSPACE_PATH;

    const config = loadSdkConfig();
    expect(config.FORGEOS_FALLBACK_ENABLED).toBe(false);
  });

  it('coerces FORGEOS_MCP_TIMEOUT_MS from string', () => {
    process.env.FORGEOS_MCP_TIMEOUT_MS = '5000';
    delete process.env.FORGEOS_MCP_URL;
    delete process.env.FORGEOS_API_KEY;
    delete process.env.FORGEOS_FALLBACK_ENABLED;
    delete process.env.FORGEOS_TICKETS_PY_PATH;
    delete process.env.FORGEOS_WORKSPACE_PATH;

    const config = loadSdkConfig();
    expect(config.FORGEOS_MCP_TIMEOUT_MS).toBe(5000);
  });

  it('rejects invalid URL for FORGEOS_MCP_URL', () => {
    process.env.FORGEOS_MCP_URL = 'not-a-url';
    delete process.env.FORGEOS_API_KEY;
    delete process.env.FORGEOS_FALLBACK_ENABLED;

    expect(() => loadSdkConfig()).toThrow();
  });
});

describe('FORBIDDEN_GIT_ADD_PATTERNS', () => {
  it('contains the four forbidden patterns', () => {
    expect(FORBIDDEN_GIT_ADD_PATTERNS).toContain('git add .');
    expect(FORBIDDEN_GIT_ADD_PATTERNS).toContain('git add -A');
    expect(FORBIDDEN_GIT_ADD_PATTERNS).toContain('git add --all');
    expect(FORBIDDEN_GIT_ADD_PATTERNS).toContain('git add -a');
  });

  it('is readonly', () => {
    expect(Object.isFrozen(FORBIDDEN_GIT_ADD_PATTERNS)).toBe(true);
  });
});
