/**
 * Tests — tickets-claim-freshness.ts
 *
 * Focused unit tests for the freshness gate wired into the tickets.claim
 * MCP tool handler (TASK-PC-BE-006).  Validates all 4 acceptance criteria:
 *
 * AC1 — fresh: hash matches → freshness_status 'fresh', no recompile queued.
 * AC2 — missing: no compiled prompt → freshness_status 'missing', recompile queued.
 * AC3 — stale: hash mismatch → freshness_status 'stale' with hash_mismatch reason, recompile queued.
 * AC4 — policy: strict mode surfaces freshness_warning; permissive mode is silent.
 *
 * The context-hash module is mocked so these tests exercise handler wiring
 * only — hash math is covered by context-hash.test.ts.
 *
 * @module __tests__/tickets-claim-freshness
 * @ticket TASK-PC-BE-006
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoisted mocks (vi.mock factories run before module scope) ────────────────

const {
  mockQuery,
  mockQueueCompileTicketPrompt,
  mockLogger,
  mockEvaluatePromptFreshness,
  mockBuildContextHashInputsFromEnv,
  mockComputeContextHash,
} = vi.hoisted(() => {
  const mLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
    trace: vi.fn(),
    child: vi.fn(),
  };
  return {
    mockQuery: vi.fn(),
    mockQueueCompileTicketPrompt: vi.fn(),
    mockLogger: mLogger,
    mockEvaluatePromptFreshness: vi.fn(),
    mockBuildContextHashInputsFromEnv: vi.fn(),
    mockComputeContextHash: vi.fn(),
  };
});

vi.mock('../db/pool.js', () => ({
  pool: { query: mockQuery },
}));

vi.mock('../config.js', () => ({
  config: {
    DATABASE_URL: 'postgresql://test:test@localhost:5432/testdb',
    NODE_ENV: 'test',
    LOG_LEVEL: 'info',
  },
}));

vi.mock('../middleware/logging.js', () => ({
  logger: mockLogger,
}));

vi.mock('../services/compiler.js', () => ({
  queueCompileTicketPrompt: (...args: unknown[]) => mockQueueCompileTicketPrompt(...args),
}));

vi.mock('../services/context-hash.js', () => ({
  buildContextHashInputsFromEnv: (...args: unknown[]) => mockBuildContextHashInputsFromEnv(...args),
  computeContextHash: (...args: unknown[]) => mockComputeContextHash(...args),
  evaluatePromptFreshness: (...args: unknown[]) => mockEvaluatePromptFreshness(...args),
}));

// ── Import AFTER mocks ──────────────────────────────────────────────────────

import { ticketsClaimHandler, ticketsClaimSchema } from '../tools/tickets-claim.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const CURRENT_HASH = 'current-context-hash-abc123def456';
const OLD_HASH = 'old-context-hash-stale-999999';
const TICKET_ID = 'TASK-PC-BE-006-test';
const AGENT_UUID = 'agent-uuid-freshness-test';

type TextContent = { type: 'text'; text: string };
function textOf(result: { content: unknown[] }): string {
  return (result.content[0] as TextContent).text;
}

function parsed(result: { content: unknown[] }): Record<string, unknown> {
  return JSON.parse(textOf(result)) as Record<string, unknown>;
}

function makeFreshnessTicketRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'uuid-freshness-001',
    ticket_id: TICKET_ID,
    project_id: null,
    title: 'Freshness Gate Test Ticket',
    description: 'Test ticket for freshness gate',
    type: 'backend',
    priority: 'critical',
    status: 'CLAIMED',
    stage: 'BACKEND',
    sdlc_flow: ['READY', 'BACKEND', 'QA'],
    claimed_by: AGENT_UUID,
    claimed_by_name: 'Backend',
    machine_id: 'test-machine',
    operator: null,
    lease_expiry: '2026-03-15T12:00:00.000Z',
    lease_duration_minutes: 30,
    depends_on: [],
    file_paths: ['forgeos-server/src/tools/tickets-claim.ts'],
    acceptance_criteria: ['AC1'],
    tags: ['prompt-compiler'],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    compiled_prompt: 'compiled prompt text',
    compiled_prompt_compiled_at: '2026-03-15T10:00:00.000Z',
    compiled_prompt_context_hash: CURRENT_HASH,
    compiled_prompt_packet_version: 'v1',
    compiled_prompt_template_version: 'prompt-architect-v1',
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-14T00:00:00Z',
    updated_at: '2026-03-15T10:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

/** Wire up the standard three DB query mocks: agent lookup → claim → file locks. */
function setupDbMocks(ticketRow = makeFreshnessTicketRow()): void {
  mockQuery
    .mockResolvedValueOnce({ rows: [{ id: AGENT_UUID }] })   // agent lookup
    .mockResolvedValueOnce({ rows: [ticketRow] })             // claim_ticket_by_id
    .mockResolvedValueOnce({ rows: [] });                     // file locks
}

const BASE_PARAMS = {
  ticket_id: TICKET_ID,
  agent_name: 'Backend',
  machine_id: 'test-machine',
  lease_minutes: 30,
} as const;

// ── beforeEach ──────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  // Default: buildContextHashInputsFromEnv + computeContextHash return deterministic values
  mockBuildContextHashInputsFromEnv.mockReturnValue({
    repoCommit: 'test-commit',
    graphVersion: 'test-graph',
    memorySnapshot: 'test-memory',
    packetSchema: 'v1',
    templateVersion: 'prompt-architect-v1',
  });
  mockComputeContextHash.mockReturnValue(CURRENT_HASH);
});

// ═════════════════════════════════════════════════════════════════════════════
// AC1 — fresh: matching hash → freshness_status 'fresh', no recompile
// ═════════════════════════════════════════════════════════════════════════════

describe('AC1 — fresh prompt (hash matches)', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'fresh',
      staleReason: null,
      shouldInvalidateCache: false,
    });
  });

  it('returns freshness_status "fresh" in prompt_packet', async () => {
    setupDbMocks();
    const result = await ticketsClaimHandler(BASE_PARAMS);
    const body = parsed(result);
    const packet = body['prompt_packet'] as Record<string, unknown>;
    expect(packet['freshness_status']).toBe('fresh');
  });

  it('returns stale_reason null for fresh prompt', async () => {
    setupDbMocks();
    const result = await ticketsClaimHandler(BASE_PARAMS);
    const packet = parsed(result)['prompt_packet'] as Record<string, unknown>;
    expect(packet['stale_reason']).toBeNull();
  });

  it('does NOT queue recompile when prompt is fresh', async () => {
    setupDbMocks();
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockQueueCompileTicketPrompt).not.toHaveBeenCalled();
  });

  it('does NOT include freshness_warning in response for fresh prompt', async () => {
    setupDbMocks();
    const body = parsed(await ticketsClaimHandler(BASE_PARAMS));
    expect(body['freshness_warning']).toBeUndefined();
  });

  it('passes compiled_prompt and stored hash to evaluatePromptFreshness', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt_context_hash: CURRENT_HASH });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockEvaluatePromptFreshness).toHaveBeenCalledWith({
      compiledPrompt: 'compiled prompt text',
      storedContextHash: CURRENT_HASH,
      currentContextHash: CURRENT_HASH,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC2 — missing compiled prompt → freshness_status 'missing', recompile triggered
// ═════════════════════════════════════════════════════════════════════════════

describe('AC2 — missing compiled prompt', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'missing',
      staleReason: 'not_compiled',
      shouldInvalidateCache: true,
    });
  });

  it('returns freshness_status "missing" in prompt_packet', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    const body = parsed(await ticketsClaimHandler(BASE_PARAMS));
    const packet = body['prompt_packet'] as Record<string, unknown>;
    expect(packet['freshness_status']).toBe('missing');
  });

  it('returns stale_reason "not_compiled" when prompt is missing', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    const packet = parsed(await ticketsClaimHandler(BASE_PARAMS))['prompt_packet'] as Record<string, unknown>;
    expect(packet['stale_reason']).toBe('not_compiled');
  });

  it('queues recompile with "claim-missing-compiled-prompt" trigger', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockQueueCompileTicketPrompt).toHaveBeenCalledWith(
      TICKET_ID,
      'claim-missing-compiled-prompt',
    );
  });

  it('is silent (no freshness_warning) in permissive mode', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'permissive' }));
    expect(body['freshness_warning']).toBeUndefined();
  });

  it('does not call logger.warn in permissive mode', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC3 — stale (hash mismatch) → freshness_status 'stale', recompile triggered
// ═════════════════════════════════════════════════════════════════════════════

describe('AC3 — stale compiled prompt (hash mismatch)', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'stale',
      staleReason: 'hash_mismatch',
      shouldInvalidateCache: true,
    });
  });

  it('returns freshness_status "stale" in prompt_packet', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt_context_hash: OLD_HASH });
    setupDbMocks(ticket);
    const packet = parsed(await ticketsClaimHandler(BASE_PARAMS))['prompt_packet'] as Record<string, unknown>;
    expect(packet['freshness_status']).toBe('stale');
  });

  it('returns stale_reason "hash_mismatch" when hash has changed', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt_context_hash: OLD_HASH });
    setupDbMocks(ticket);
    const packet = parsed(await ticketsClaimHandler(BASE_PARAMS))['prompt_packet'] as Record<string, unknown>;
    expect(packet['stale_reason']).toBe('hash_mismatch');
  });

  it('queues recompile with "claim-stale-compiled-prompt" trigger', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt_context_hash: OLD_HASH });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockQueueCompileTicketPrompt).toHaveBeenCalledWith(
      TICKET_ID,
      'claim-stale-compiled-prompt',
    );
  });

  it('queues recompile exactly once', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt_context_hash: OLD_HASH });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockQueueCompileTicketPrompt).toHaveBeenCalledTimes(1);
  });

  it('is silent (no freshness_warning) in default permissive mode', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt_context_hash: OLD_HASH });
    setupDbMocks(ticket);
    const body = parsed(await ticketsClaimHandler(BASE_PARAMS));
    expect(body['freshness_warning']).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// AC4 — policy: strict vs permissive mode
// ═════════════════════════════════════════════════════════════════════════════

describe('AC4a — strict mode with stale prompt', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'stale',
      staleReason: 'hash_mismatch',
      shouldInvalidateCache: true,
    });
  });

  it('includes freshness_warning in response when strict + stale', async () => {
    setupDbMocks();
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' }));
    expect(body['freshness_warning']).toBeDefined();
    expect(typeof body['freshness_warning']).toBe('string');
  });

  it('freshness_warning mentions stale status', async () => {
    setupDbMocks();
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' }));
    expect(body['freshness_warning'] as string).toContain('stale');
  });

  it('freshness_warning mentions hash_mismatch reason', async () => {
    setupDbMocks();
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' }));
    expect(body['freshness_warning'] as string).toContain('hash_mismatch');
  });

  it('calls logger.warn with freshness context when strict + stale', async () => {
    setupDbMocks();
    await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        ticket_id: TICKET_ID,
        freshness_status: 'stale',
      }),
      expect.stringContaining('strict freshness gate'),
    );
  });

  it('still queues recompile in strict mode', async () => {
    setupDbMocks();
    await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' });
    expect(mockQueueCompileTicketPrompt).toHaveBeenCalledWith(
      TICKET_ID,
      'claim-stale-compiled-prompt',
    );
  });

  it('still includes prompt_packet with freshness_status when strict', async () => {
    setupDbMocks();
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' }));
    const packet = body['prompt_packet'] as Record<string, unknown>;
    expect(packet['freshness_status']).toBe('stale');
    expect(packet['stale_reason']).toBe('hash_mismatch');
  });
});

describe('AC4b — strict mode with missing prompt', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'missing',
      staleReason: 'not_compiled',
      shouldInvalidateCache: true,
    });
  });

  it('includes freshness_warning when strict + missing', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' }));
    expect(body['freshness_warning']).toBeDefined();
  });

  it('freshness_warning mentions missing status', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' }));
    expect(body['freshness_warning'] as string).toContain('missing');
  });

  it('calls logger.warn with missing freshness_status', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt: null });
    setupDbMocks(ticket);
    await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' });
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ freshness_status: 'missing' }),
      expect.stringContaining('strict freshness gate'),
    );
  });
});

describe('AC4c — permissive mode with stale prompt', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'stale',
      staleReason: 'hash_mismatch',
      shouldInvalidateCache: true,
    });
  });

  it('does NOT include freshness_warning in permissive mode', async () => {
    setupDbMocks();
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'permissive' }));
    expect(body['freshness_warning']).toBeUndefined();
  });

  it('does NOT call logger.warn in permissive mode', async () => {
    setupDbMocks();
    await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'permissive' });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('still queues recompile in permissive mode with stale prompt', async () => {
    setupDbMocks();
    await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'permissive' });
    expect(mockQueueCompileTicketPrompt).toHaveBeenCalledWith(
      TICKET_ID,
      'claim-stale-compiled-prompt',
    );
  });
});

describe('AC4d — strict mode with fresh prompt (no warning expected)', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'fresh',
      staleReason: null,
      shouldInvalidateCache: false,
    });
  });

  it('does NOT include freshness_warning when strict + fresh', async () => {
    setupDbMocks();
    const body = parsed(await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' }));
    expect(body['freshness_warning']).toBeUndefined();
  });

  it('does NOT call logger.warn when strict + fresh', async () => {
    setupDbMocks();
    await ticketsClaimHandler({ ...BASE_PARAMS, freshness_policy: 'strict' });
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Schema validation — freshness_policy field
// ═════════════════════════════════════════════════════════════════════════════

describe('ticketsClaimSchema — freshness_policy field', () => {
  it('defaults to "permissive" when not provided', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: TICKET_ID,
      agent_name: 'Backend',
      machine_id: 'test-machine',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.freshness_policy).toBe('permissive');
    }
  });

  it('accepts "strict" value', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: TICKET_ID,
      agent_name: 'Backend',
      machine_id: 'test-machine',
      freshness_policy: 'strict',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.freshness_policy).toBe('strict');
    }
  });

  it('accepts "permissive" value explicitly', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: TICKET_ID,
      agent_name: 'Backend',
      machine_id: 'test-machine',
      freshness_policy: 'permissive',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.freshness_policy).toBe('permissive');
    }
  });

  it('rejects unknown freshness_policy values', () => {
    const result = ticketsClaimSchema.safeParse({
      ticket_id: TICKET_ID,
      agent_name: 'Backend',
      machine_id: 'test-machine',
      freshness_policy: 'aggressive',
    });
    expect(result.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Context hash integration — correct inputs passed through
// ═════════════════════════════════════════════════════════════════════════════

describe('Context hash integration', () => {
  beforeEach(() => {
    mockEvaluatePromptFreshness.mockReturnValue({
      freshnessStatus: 'fresh',
      staleReason: null,
      shouldInvalidateCache: false,
    });
  });

  it('calls buildContextHashInputsFromEnv with process.env and ticket versions', async () => {
    const ticket = makeFreshnessTicketRow({
      compiled_prompt_packet_version: 'v2',
      compiled_prompt_template_version: 'prompt-architect-v2',
    });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockBuildContextHashInputsFromEnv).toHaveBeenCalledWith(
      process.env,
      'v2',
      'prompt-architect-v2',
    );
  });

  it('uses default packet version "v1" when not set on ticket', async () => {
    const ticket = makeFreshnessTicketRow({
      compiled_prompt_packet_version: null,
      compiled_prompt_template_version: null,
    });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockBuildContextHashInputsFromEnv).toHaveBeenCalledWith(
      process.env,
      'v1',
      'prompt-architect-v1',
    );
  });

  it('passes computed hash to evaluatePromptFreshness as currentContextHash', async () => {
    const ticket = makeFreshnessTicketRow({
      compiled_prompt_context_hash: CURRENT_HASH,
    });
    setupDbMocks(ticket);
    await ticketsClaimHandler(BASE_PARAMS);
    expect(mockEvaluatePromptFreshness).toHaveBeenCalledWith(
      expect.objectContaining({ currentContextHash: CURRENT_HASH }),
    );
  });

  it('stores context_hash from ticket (stored value) in prompt_packet', async () => {
    const ticket = makeFreshnessTicketRow({ compiled_prompt_context_hash: OLD_HASH });
    setupDbMocks(ticket);
    const packet = parsed(await ticketsClaimHandler(BASE_PARAMS))['prompt_packet'] as Record<string, unknown>;
    expect(packet['context_hash']).toBe(OLD_HASH);
  });
});
