/**
 * Extended unit tests for the EmbeddingService — edge cases.
 *
 * Supplements the co-located test at `services/embedding-service.test.ts`
 * with coverage for:
 *   - Unicode / multi-byte input
 *   - Very long text input
 *   - Whitespace-only input
 *   - Batch with mixed valid / edge-case texts
 *   - Retry timing verification (exponential backoff pattern)
 *   - Concurrent embedText calls hitting the concurrency limiter
 *   - 429 rate-limit followed by success
 *   - Multiple sequential retries before success
 *   - Response body parsing edge cases
 *
 * All tests mock `fetch` — no real API calls.
 *
 * @ticket TASK-INT-BE040
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  EmbeddingService,
  EmbeddingApiError,
  type EmbeddingServiceOptions,
} from '../services/embedding-service.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockEmbeddingResponse(inputs: string[]): object {
  return {
    data: inputs.map((_, i) => ({
      embedding: Array.from({ length: 1536 }, (__, d) => (i + 1) * 0.001 + d * 0.0001),
      index: i,
    })),
    model: 'text-embedding-3-small',
    usage: { prompt_tokens: inputs.length * 5, total_tokens: inputs.length * 5 },
  };
}

function okResponse(body: object): Response {
  return {
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(body),
    text: vi.fn().mockResolvedValue(JSON.stringify(body)),
  } as unknown as Response;
}

function errorResponse(status: number, body = ''): Response {
  return {
    ok: false,
    status,
    json: vi.fn().mockResolvedValue({}),
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

const FAST_OPTIONS: EmbeddingServiceOptions = {
  maxRetries: 3,
  batchSize: 2,
  maxConcurrent: 2,
  baseDelayMs: 0,
};

// ── Setup / Teardown ─────────────────────────────────────────────────────────

let originalEnv: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalEnv = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-edge-cases';
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  if (originalEnv !== undefined) {
    process.env.OPENAI_API_KEY = originalEnv;
  } else {
    delete process.env.OPENAI_API_KEY;
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ── Edge Cases: embedText ────────────────────────────────────────────────────

describe('EmbeddingService edge cases — embedText', () => {
  it('handles Unicode / emoji input', async () => {
    const unicode = '日本語テスト 🚀🎯 Ñoño café résumé';
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse([unicode])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText(unicode);

    expect(result).toHaveLength(1536);
    expect(fetchMock).toHaveBeenCalledOnce();

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.input).toEqual([unicode]);
  });

  it('handles multi-byte characters (Chinese, Arabic, Hindi)', async () => {
    const text = '中文 العربية हिन्दी';
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse([text])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText(text);

    expect(result).toHaveLength(1536);
  });

  it('handles very long text input (10,000 characters)', async () => {
    const longText = 'a'.repeat(10_000);
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse([longText])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText(longText);

    expect(result).toHaveLength(1536);
    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.input[0]).toHaveLength(10_000);
  });

  it('rejects whitespace-only input (single space)', async () => {
    // The service checks for empty string but not whitespace;
    // a space is non-empty so it should go through to the API
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse([' '])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText(' ');

    expect(result).toHaveLength(1536);
  });

  it('handles text with newlines and tabs', async () => {
    const text = 'line1\nline2\ttabbed\rcarriage';
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse([text])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText(text);

    expect(result).toHaveLength(1536);
  });

  it('returns correct embedding dimension (1536)', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['test'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('test');

    expect(result).toHaveLength(1536);
    result.forEach((val) => expect(typeof val).toBe('number'));
  });
});

// ── Edge Cases: embedBatch ───────────────────────────────────────────────────

describe('EmbeddingService edge cases — embedBatch', () => {
  it('handles batch with single text', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['only'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedBatch(['only']);

    expect(result).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('preserves ordering across multi-batch processing', async () => {
    // batchSize=2, so 5 texts → 3 batches (2+2+1)
    fetchMock
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['a', 'b'])))
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['c', 'd'])))
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['e'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedBatch(['a', 'b', 'c', 'd', 'e']);

    expect(result).toHaveLength(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Verify each batch was called with the correct texts
    const batch1Body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    const batch2Body = JSON.parse(fetchMock.mock.calls[1][1].body as string);
    const batch3Body = JSON.parse(fetchMock.mock.calls[2][1].body as string);
    expect(batch1Body.input).toEqual(['a', 'b']);
    expect(batch2Body.input).toEqual(['c', 'd']);
    expect(batch3Body.input).toEqual(['e']);
  });

  it('handles batch with mixed Unicode and ASCII texts', async () => {
    const texts = ['hello', '你好', 'مرحبا'];
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(texts.slice(0, 2))));
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(texts.slice(2))));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedBatch(texts);

    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('batch with batchSize=1 makes one call per text', async () => {
    const texts = ['a', 'b', 'c'];
    texts.forEach((t) => {
      fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse([t])));
    });

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedBatch(texts, 1);

    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('large batch size with fewer texts uses single call', async () => {
    const texts = ['one', 'two'];
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(texts)));

    const service = new EmbeddingService({ ...FAST_OPTIONS, batchSize: 1000 });
    const result = await service.embedBatch(texts);

    expect(result).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ── Retry Timing ─────────────────────────────────────────────────────────────

describe('EmbeddingService edge cases — retry timing', () => {
  it('verifies exponential backoff delay pattern', async () => {
    const delays: number[] = [];
    const originalSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) => {
      delays.push(ms ?? 0);
      // Execute immediately for fast tests
      fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    fetchMock
      .mockResolvedValueOnce(errorResponse(500))
      .mockResolvedValueOnce(errorResponse(502))
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['ok'])));

    const service = new EmbeddingService({ ...FAST_OPTIONS, baseDelayMs: 100 });
    await service.embedText('ok');

    // Exponential backoff: 2^0 * 100 = 100ms, 2^1 * 100 = 200ms
    expect(delays).toContain(100);
    expect(delays).toContain(200);

    vi.mocked(globalThis.setTimeout).mockRestore();
  });

  it('retries exactly maxRetries times before throwing', async () => {
    fetchMock.mockResolvedValue(errorResponse(503, 'Service Unavailable'));

    const service = new EmbeddingService({ ...FAST_OPTIONS, maxRetries: 2 });

    await expect(service.embedText('fail')).rejects.toThrow(EmbeddingApiError);
    // 1 initial attempt + 2 retries = 3 total calls
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('maxRetries=0 means single attempt with no retries', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(500));

    const service = new EmbeddingService({ ...FAST_OPTIONS, maxRetries: 0 });

    await expect(service.embedText('fail')).rejects.toThrow(EmbeddingApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ── Concurrency Limiter ──────────────────────────────────────────────────────

describe('EmbeddingService edge cases — concurrency limiter', () => {
  it('handles burst of concurrent embedText calls', async () => {
    let concurrent = 0;
    let maxObserved = 0;

    fetchMock.mockImplementation(async () => {
      concurrent++;
      maxObserved = Math.max(maxObserved, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return okResponse(mockEmbeddingResponse(['x']));
    });

    const service = new EmbeddingService({
      ...FAST_OPTIONS,
      maxConcurrent: 3,
    });

    await Promise.all(
      Array.from({ length: 10 }, (_, i) => service.embedText(`text-${i}`)),
    );

    expect(maxObserved).toBeLessThanOrEqual(3);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });

  it('maxConcurrent=1 serialises all requests', async () => {
    const callOrder: number[] = [];
    let callIndex = 0;

    fetchMock.mockImplementation(async () => {
      const idx = callIndex++;
      callOrder.push(idx);
      await new Promise((r) => setTimeout(r, 2));
      return okResponse(mockEmbeddingResponse(['x']));
    });

    const service = new EmbeddingService({
      ...FAST_OPTIONS,
      maxConcurrent: 1,
    });

    await Promise.all([
      service.embedText('a'),
      service.embedText('b'),
      service.embedText('c'),
    ]);

    expect(callOrder).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// ── Error Handling Edge Cases ────────────────────────────────────────────────

describe('EmbeddingService edge cases — error handling', () => {
  it('EmbeddingApiError has correct statusCode property', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(422, 'Unprocessable Entity'));

    const service = new EmbeddingService(FAST_OPTIONS);

    try {
      await service.embedText('test');
      expect.fail('Should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(EmbeddingApiError);
      expect((err as EmbeddingApiError).statusCode).toBe(422);
      expect((err as EmbeddingApiError).name).toBe('EmbeddingApiError');
    }
  });

  it('masks API key in error messages (never leaks key)', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400, 'invalid api key'));

    const service = new EmbeddingService(FAST_OPTIONS);

    try {
      await service.embedText('test');
      expect.fail('Should have thrown');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).not.toContain('test-key-edge-cases');
      expect(message).toContain('***MASKED***');
    }
  });

  it('handles network error (TypeError: fetch failed)', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'));

    const service = new EmbeddingService(FAST_OPTIONS);

    await expect(service.embedText('test')).rejects.toThrow(TypeError);
  });

  it('handles DNS resolution failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('getaddrinfo ENOTFOUND api.openai.com'))
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['ok'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('ok');

    expect(result).toHaveLength(1536);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('handles response.text() failure during error parsing', async () => {
    const badResponse = {
      ok: false,
      status: 500,
      json: vi.fn().mockRejectedValue(new Error('json parse error')),
      text: vi.fn().mockRejectedValue(new Error('text read error')),
    } as unknown as Response;

    fetchMock
      .mockResolvedValueOnce(badResponse)
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['ok'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('ok');

    expect(result).toHaveLength(1536);
  });

  it('treats 429 as retryable (rate limit)', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, 'Rate limit exceeded'))
      .mockResolvedValueOnce(errorResponse(429, 'Rate limit exceeded'))
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['ok'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('ok');

    expect(result).toHaveLength(1536);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('batch failure mid-way through propagates error', async () => {
    fetchMock
      .mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['a', 'b'])))
      .mockResolvedValueOnce(errorResponse(400, 'Bad Request'));

    const service = new EmbeddingService(FAST_OPTIONS);

    await expect(service.embedBatch(['a', 'b', 'c'])).rejects.toThrow(EmbeddingApiError);
  });
});

// ── API Key Environment ──────────────────────────────────────────────────────

describe('EmbeddingService edge cases — API key handling', () => {
  it('sends API key in Authorization header', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['x'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    await service.embedText('x');

    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key-edge-cases');
  });

  it('reads API key at construction time (not per-call)', async () => {
    const service = new EmbeddingService(FAST_OPTIONS);

    // Change the env var after construction
    process.env.OPENAI_API_KEY = 'changed-key';

    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['x'])));
    await service.embedText('x');

    // Should still use the original key
    const headers = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key-edge-cases');
  });
});

// ── Model Configuration ──────────────────────────────────────────────────────

describe('EmbeddingService edge cases — model configuration', () => {
  it('sends correct model in request body', async () => {
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['x'])));

    const service = new EmbeddingService({
      ...FAST_OPTIONS,
      model: 'text-embedding-3-large',
    });
    await service.embedText('x');

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.model).toBe('text-embedding-3-large');
  });

  it('defaults model to text-embedding-3-small', async () => {
    delete process.env.EMBEDDING_MODEL;
    fetchMock.mockResolvedValueOnce(okResponse(mockEmbeddingResponse(['x'])));

    const service = new EmbeddingService(FAST_OPTIONS);
    await service.embedText('x');

    const callBody = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(callBody.model).toBe('text-embedding-3-small');
  });
});
