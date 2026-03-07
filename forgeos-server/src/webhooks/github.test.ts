/**
 * GitHub Webhook Router Unit Tests — TASK-FOS-06-004
 *
 * Tests the HMAC-SHA256 signature verification (pure function) and
 * the router factory with live HTTP requests using Node's native fetch.
 *
 * @module webhooks/github.test
 * @ticket TASK-FOS-06-004
 */

import crypto from 'node:crypto';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { verifyWebhookSignature, createGitHubWebhookRouter } from './github.js';
import type { DatabasePool, StructuredLogger } from './reconciliation.js';

// ── Test Helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = 'test-webhook-secret-2026';

function computeSignature(payload: string | Buffer, secret: string): string {
  return (
    'sha256=' +
    crypto.createHmac('sha256', secret).update(payload).digest('hex')
  );
}

function createMockPool(): DatabasePool & { query: ReturnType<typeof vi.fn> } {
  return { query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

function createMockLogger(): StructuredLogger & {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
}

// ── verifyWebhookSignature ───────────────────────────────────────────────────

describe('verifyWebhookSignature', () => {
  it('accepts valid HMAC-SHA256 signature with string payload', () => {
    const payload = '{"action":"push","ref":"refs/heads/main"}';
    const signature = computeSignature(payload, TEST_SECRET);

    expect(verifyWebhookSignature(payload, signature, TEST_SECRET)).toBe(true);
  });

  it('accepts valid HMAC-SHA256 signature with Buffer payload', () => {
    const payload = Buffer.from('{"commits":[]}');
    const signature = computeSignature(payload, TEST_SECRET);

    expect(verifyWebhookSignature(payload, signature, TEST_SECRET)).toBe(true);
  });

  it('rejects signature computed with wrong secret', () => {
    const payload = '{"action":"push"}';
    const wrongSignature = computeSignature(payload, 'wrong-secret');

    expect(
      verifyWebhookSignature(payload, wrongSignature, TEST_SECRET),
    ).toBe(false);
  });

  it('rejects modified payload (same secret)', () => {
    const originalPayload = '{"action":"push"}';
    const signature = computeSignature(originalPayload, TEST_SECRET);
    const tamperedPayload = '{"action":"delete"}';

    expect(
      verifyWebhookSignature(tamperedPayload, signature, TEST_SECRET),
    ).toBe(false);
  });

  it('rejects signature with mismatched length', () => {
    const payload = '{"test":true}';
    const shortSignature = 'sha256=abcdef';

    expect(
      verifyWebhookSignature(payload, shortSignature, TEST_SECRET),
    ).toBe(false);
  });

  it('rejects empty signature string', () => {
    const payload = '{"test":true}';

    expect(verifyWebhookSignature(payload, '', TEST_SECRET)).toBe(false);
  });

  it('handles empty payload correctly', () => {
    const payload = '';
    const signature = computeSignature(payload, TEST_SECRET);

    expect(verifyWebhookSignature(payload, signature, TEST_SECRET)).toBe(true);
  });

  it('handles large payload correctly', () => {
    const payload = JSON.stringify({
      commits: Array.from({ length: 100 }, (_, i) => ({
        id: `sha-${String(i)}`,
        message: `commit ${String(i)}`,
      })),
    });
    const signature = computeSignature(payload, TEST_SECRET);

    expect(verifyWebhookSignature(payload, signature, TEST_SECRET)).toBe(true);
  });

  it('is case-sensitive on signature hex digits', () => {
    const payload = '{"data":"test"}';
    const signature = computeSignature(payload, TEST_SECRET);
    const upperSignature = signature.toUpperCase();

    expect(
      verifyWebhookSignature(payload, upperSignature, TEST_SECRET),
    ).toBe(false);
  });
});

// ── createGitHubWebhookRouter ────────────────────────────────────────────────

describe('createGitHubWebhookRouter', () => {
  it('returns an Express Router instance', () => {
    const router = createGitHubWebhookRouter({
      webhookSecret: TEST_SECRET,
      pool: createMockPool(),
      logger: createMockLogger(),
    });

    expect(typeof router).toBe('function');
    expect(router.stack).toBeDefined();
    expect(Array.isArray(router.stack)).toBe(true);
  });

  it('registers routes on the router', () => {
    const router = createGitHubWebhookRouter({
      webhookSecret: TEST_SECRET,
      pool: createMockPool(),
      logger: createMockLogger(),
    });

    expect(router.stack.length).toBeGreaterThanOrEqual(3);
  });
});

// ── HTTP Handler Integration Tests ───────────────────────────────────────────

describe('POST / handler', () => {
  let server: Server;
  let baseUrl: string;
  let mockPool: ReturnType<typeof createMockPool>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeAll(() => {
    mockPool = createMockPool();
    mockLogger = createMockLogger();
    const app = express();
    app.use(
      '/webhook',
      createGitHubWebhookRouter({
        webhookSecret: TEST_SECRET,
        pool: mockPool,
        logger: mockLogger,
      }),
    );
    server = app.listen(0);
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(addr.port)}`;
  });

  afterAll(() => {
    server.close();
  });

  it('rejects request without X-Hub-Signature-256 header', async () => {
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('rejects request with invalid signature', async () => {
    const payload = '{"ref":"refs/heads/main","commits":[]}';
    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': 'sha256=invalid',
      },
      body: payload,
    });

    expect(res.status).toBe(401);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('skips non-push events (no ref field)', async () => {
    const payload = JSON.stringify({ action: 'opened' });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string };
    expect(body.status).toBe('skipped');
  });

  it('returns ok with zero operations for regular commits', async () => {
    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      before: '0000000',
      after: 'abc1234',
      repository: { full_name: 'org/repo', name: 'repo', html_url: 'https://github.com/org/repo' },
      pusher: { name: 'user' },
      commits: [
        {
          id: 'sha-1',
          message: 'fix: update readme',
          timestamp: '2026-03-07T10:00:00Z',
          added: [],
          removed: [],
          modified: ['README.md'],
          author: { name: 'User', email: 'user@example.com' },
        },
      ],
      head_commit: null,
      compare: 'https://github.com/org/repo/compare/000...abc',
    });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; operations: number };
    expect(body.status).toBe('ok');
    expect(body.operations).toBe(0);
  });

  it('processes CLAIM operations and returns reconciliation result', async () => {
    // Mock: ticket found as READY, agent found, UPDATE succeeds, event recorded
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'T-001', status: 'READY', stage: 'BACKEND',
          claimed_by: null, claimed_by_name: null, machine_id: null, lease_expiry: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ticket_id: 'T-001' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      before: '0000000',
      after: 'abc1234',
      repository: { full_name: 'org/repo', name: 'repo', html_url: 'https://github.com/org/repo' },
      pusher: { name: 'user' },
      commits: [
        {
          id: 'sha-claim',
          message: '[T-001] CLAIM by Backend on ws-1 (oak)',
          timestamp: '2026-03-07T10:00:00Z',
          added: [],
          removed: [],
          modified: ['.github/tickets/T-001.json'],
          author: { name: 'Backend', email: 'bot@example.com' },
        },
      ],
      head_commit: null,
      compare: 'https://github.com/org/repo/compare/000...abc',
    });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      reconciliation: { claims_created: number };
    };
    expect(body.status).toBe('ok');
    expect(body.reconciliation.claims_created).toBe(1);
  });

  it('returns 500 when reconciliation throws', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('DB connection lost'));

    const payload = JSON.stringify({
      ref: 'refs/heads/main',
      before: '0000000',
      after: 'abc1234',
      repository: { full_name: 'org/repo', name: 'repo', html_url: 'https://github.com/org/repo' },
      pusher: { name: 'user' },
      commits: [
        {
          id: 'sha-work',
          message: '[T-002] BACKEND complete by Backend on ws-1',
          timestamp: '2026-03-07T10:00:00Z',
          added: [],
          removed: [],
          modified: [],
          author: { name: 'Backend', email: 'bot@example.com' },
        },
      ],
      head_commit: null,
      compare: 'https://github.com/org/repo/compare/000...abc',
    });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('RECONCILIATION_ERROR');
  });
});

describe('POST /recover handler', () => {
  let server: Server;
  let baseUrl: string;
  let mockPool: ReturnType<typeof createMockPool>;
  let mockLogger: ReturnType<typeof createMockLogger>;

  beforeAll(() => {
    mockPool = createMockPool();
    mockLogger = createMockLogger();
    const app = express();
    app.use(
      '/webhook',
      createGitHubWebhookRouter({
        webhookSecret: TEST_SECRET,
        pool: mockPool,
        logger: mockLogger,
      }),
    );
    server = app.listen(0);
    const addr = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${String(addr.port)}`;
  });

  afterAll(() => {
    server.close();
  });

  it('rejects recovery request without signature', async () => {
    const res = await fetch(`${baseUrl}/webhook/recover`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    });

    expect(res.status).toBe(401);
  });

  it('rejects recovery with missing commits array', async () => {
    const payload = JSON.stringify({ last_known_sha: 'abc123' });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('INVALID_PAYLOAD');
  });

  it('returns ok with no ticket operations in recovery payload', async () => {
    const payload = JSON.stringify({
      commits: [
        {
          id: 'sha-1',
          message: 'chore: update deps',
          timestamp: '2026-03-07T10:00:00Z',
          added: [],
          removed: [],
          modified: [],
          author: { name: 'User', email: 'user@example.com' },
        },
      ],
      last_known_sha: 'prev-sha',
    });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; last_known_sha: string };
    expect(body.status).toBe('ok');
    expect(body.last_known_sha).toBe('prev-sha');
  });

  it('processes recovery commits and returns reconciliation result', async () => {
    // Mock: ticket found as READY, agent found, UPDATE succeeds, event recorded
    mockPool.query
      .mockResolvedValueOnce({
        rows: [{
          ticket_id: 'T-REC-001', status: 'READY', stage: 'BACKEND',
          claimed_by: null, claimed_by_name: null, machine_id: null, lease_expiry: null,
        }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [{ id: 'agent-uuid' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [{ ticket_id: 'T-REC-001' }], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const payload = JSON.stringify({
      commits: [
        {
          id: 'sha-recovery',
          message: '[T-REC-001] CLAIM by Backend on ws-2 (bob)',
          timestamp: '2026-03-07T10:00:00Z',
          added: [],
          removed: [],
          modified: [],
          author: { name: 'Backend', email: 'bot@example.com' },
        },
      ],
      last_known_sha: 'prev-sha-123',
    });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(200);
    const body = await res.json() as {
      status: string;
      reconciliation: { claims_created: number };
    };
    expect(body.status).toBe('recovered');
    expect(body.reconciliation.claims_created).toBe(1);
  });

  it('returns 500 when recovery reconciliation fails', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('Connection timeout'));

    const payload = JSON.stringify({
      commits: [
        {
          id: 'sha-fail',
          message: '[T-FAIL] CLAIM by Backend on ws-1 (oak)',
          timestamp: '2026-03-07T10:00:00Z',
          added: [],
          removed: [],
          modified: [],
          author: { name: 'Backend', email: 'bot@example.com' },
        },
      ],
    });
    const signature = computeSignature(payload, TEST_SECRET);

    const res = await fetch(`${baseUrl}/webhook/recover`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Hub-Signature-256': signature,
      },
      body: payload,
    });

    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('RECOVERY_ERROR');
  });
});

