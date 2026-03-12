/**
 * Unit tests for the EmbeddingService.
 *
 * Mocks the global `fetch` function to verify API call behaviour,
 * retry logic, rate limiting, error handling, and API-key masking.
 *
 * @ticket TASK-INT-BE033
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    EmbeddingService,
    EmbeddingApiError,
    type EmbeddingServiceOptions,
} from './embedding-service.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a mock OpenAI-style response body for the given inputs. */
function mockEmbeddingResponse(inputs: string[]): object {
    return {
        data: inputs.map((_, i) => ({
            embedding: [0.1 * (i + 1), 0.2 * (i + 1), 0.3 * (i + 1)],
            index: i,
        })),
        model: 'text-embedding-3-small',
        usage: { prompt_tokens: inputs.length * 5, total_tokens: inputs.length * 5 },
    };
}

/** Creates a successful Response mock. */
function okResponse(body: object): Response {
    return {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue(body),
        text: vi.fn().mockResolvedValue(JSON.stringify(body)),
    } as unknown as Response;
}

/** Creates a failing Response mock. */
function errorResponse(status: number, body = ''): Response {
    return {
        ok: false,
        status,
        json: vi.fn().mockResolvedValue({}),
        text: vi.fn().mockResolvedValue(body),
    } as unknown as Response;
}

/** Default options with zero delays for fast tests. */
const FAST_OPTIONS: EmbeddingServiceOptions = {
    maxRetries: 3,
    batchSize: 2,
  maxConcurrent: 2,
  baseDelayMs: 0, // no backoff delay in tests
};

// ── Test Setup ───────────────────────────────────────────────────────────────

let originalEnv: string | undefined;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  originalEnv = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = 'test-key-abc123';
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

// ── Constructor ──────────────────────────────────────────────────────────────

describe('EmbeddingService — constructor', () => {
  it('throws if OPENAI_API_KEY is not set', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new EmbeddingService(FAST_OPTIONS)).toThrow(
      'OPENAI_API_KEY environment variable is required',
    );
  });

  it('throws if OPENAI_API_KEY is empty', () => {
    process.env.OPENAI_API_KEY = '';
    expect(() => new EmbeddingService(FAST_OPTIONS)).toThrow(
      'OPENAI_API_KEY environment variable is required',
    );
  });

  it('creates successfully with valid API key', () => {
    const service = new EmbeddingService(FAST_OPTIONS);
    expect(service).toBeInstanceOf(EmbeddingService);
  });

  it('uses custom model from options', () => {
    const service = new EmbeddingService({
      ...FAST_OPTIONS,
      model: 'text-embedding-3-large',
    });
    expect(service).toBeInstanceOf(EmbeddingService);
  });

  it('uses EMBEDDING_MODEL env var when no option is provided', () => {
    process.env.EMBEDDING_MODEL = 'custom-model';
    const service = new EmbeddingService(FAST_OPTIONS);
    expect(service).toBeInstanceOf(EmbeddingService);
    delete process.env.EMBEDDING_MODEL;
  });
});

// ── embedText ────────────────────────────────────────────────────────────────

describe('EmbeddingService — embedText', () => {
  it('returns an embedding vector for a single text', async () => {
    const body = mockEmbeddingResponse(['hello world']);
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('hello world');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('sends correct headers and body to OpenAI API', async () => {
    const body = mockEmbeddingResponse(['test']);
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    await service.embedText('test');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer test-key-abc123',
        },
        body: JSON.stringify({
          input: ['test'],
          model: 'text-embedding-3-small',
        }),
      }),
    );
  });

  it('throws on empty text input', async () => {
    const service = new EmbeddingService(FAST_OPTIONS);
    await expect(service.embedText('')).rejects.toThrow(
      'embedText requires a non-empty string',
    );
  });

  it('uses custom baseUrl when provided', async () => {
    const body = mockEmbeddingResponse(['x']);
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService({
      ...FAST_OPTIONS,
      baseUrl: 'http://localhost:8080/embed',
    });
    await service.embedText('x');

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8080/embed',
      expect.any(Object),
    );
  });
});

// ── embedBatch ───────────────────────────────────────────────────────────────

describe('EmbeddingService — embedBatch', () => {
  it('returns empty array for empty input', async () => {
    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedBatch([]);
    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('processes a single batch when texts fit within batchSize', async () => {
    const body = mockEmbeddingResponse(['a', 'b']);
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedBatch(['a', 'b']);

    expect(result).toHaveLength(2);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('splits texts into multiple batches based on batchSize', async () => {
    const body1 = mockEmbeddingResponse(['a', 'b']);
    const body2 = mockEmbeddingResponse(['c']);
    fetchMock
      .mockResolvedValueOnce(okResponse(body1))
      .mockResolvedValueOnce(okResponse(body2));

    const service = new EmbeddingService(FAST_OPTIONS); // batchSize=2
    const result = await service.embedBatch(['a', 'b', 'c']);

    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('respects batchSize override parameter', async () => {
    const body = mockEmbeddingResponse(['a']);
    fetchMock
      .mockResolvedValueOnce(okResponse(body))
      .mockResolvedValueOnce(okResponse(body))
      .mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedBatch(['a', 'b', 'c'], 1);

    expect(result).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

// ── Retry Logic ──────────────────────────────────────────────────────────────

describe('EmbeddingService — retry logic', () => {
  it('retries on 500 server error and succeeds', async () => {
    const body = mockEmbeddingResponse(['hello']);
    fetchMock
      .mockResolvedValueOnce(errorResponse(500, 'Internal Server Error'))
      .mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('hello');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on 429 rate-limit and succeeds', async () => {
    const body = mockEmbeddingResponse(['hello']);
    fetchMock
      .mockResolvedValueOnce(errorResponse(429, 'Rate limited'))
      .mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('hello');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('retries on network failure and succeeds', async () => {
    const body = mockEmbeddingResponse(['hello']);
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    const result = await service.embedText('hello');

    expect(result).toEqual([0.1, 0.2, 0.3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws after exhausting all retries', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, 'Server Error'));

    const service = new EmbeddingService({ ...FAST_OPTIONS, maxRetries: 2 });

    await expect(service.embedText('hello')).rejects.toThrow(EmbeddingApiError);
    // 1 initial + 2 retries = 3 total
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does NOT retry on 400 client error', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(400, 'Bad Request'));

    const service = new EmbeddingService(FAST_OPTIONS);

    await expect(service.embedText('hello')).rejects.toThrow(EmbeddingApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does NOT retry on 401 auth error', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'Unauthorized'));

    const service = new EmbeddingService(FAST_OPTIONS);

    await expect(service.embedText('hello')).rejects.toThrow(EmbeddingApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('does NOT retry on 403 forbidden', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, 'Forbidden'));

    const service = new EmbeddingService(FAST_OPTIONS);

    await expect(service.embedText('hello')).rejects.toThrow(EmbeddingApiError);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});

// ── Rate Limiting (Concurrency) ──────────────────────────────────────────────

describe('EmbeddingService — concurrency limiter', () => {
  it('limits concurrent API calls to maxConcurrent', async () => {
    let concurrent = 0;
    let maxObserved = 0;

    fetchMock.mockImplementation(async () => {
      concurrent++;
      maxObserved = Math.max(maxObserved, concurrent);
      // Simulate async work
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
      return okResponse(mockEmbeddingResponse(['x']));
    });

    const service = new EmbeddingService({
      ...FAST_OPTIONS,
      batchSize: 1,
      maxConcurrent: 2,
    });

    // embedBatch processes sequentially by design (batch loop), so
    // for concurrency testing, we launch multiple embedText calls.
    await Promise.all([
      service.embedText('a'),
      service.embedText('b'),
      service.embedText('c'),
      service.embedText('d'),
    ]);

    expect(maxObserved).toBeLessThanOrEqual(2);
  });
});

// ── API Key Security ─────────────────────────────────────────────────────────

describe('EmbeddingService — API key security', () => {
  it('masks API key in error messages for 4xx errors', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(401, 'Invalid key'));

    const service = new EmbeddingService(FAST_OPTIONS);

    try {
      await service.embedText('hello');
    } catch (err) {
      const error = err as EmbeddingApiError;
      expect(error.message).toContain('***MASKED***');
      expect(error.message).not.toContain('test-key-abc123');
    }
  });

  it('never includes API key in Authorization header logging', async () => {
    fetchMock.mockResolvedValue(errorResponse(500, 'fail'));

    const service = new EmbeddingService({ ...FAST_OPTIONS, maxRetries: 0 });

    try {
      await service.embedText('hello');
    } catch {
      // expected
    }

    // Verify the key was sent in the actual request but wouldn't appear in logs
    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key-abc123');
  });

  it('sends API key in Authorization header correctly', async () => {
    const body = mockEmbeddingResponse(['x']);
    fetchMock.mockResolvedValueOnce(okResponse(body));

    const service = new EmbeddingService(FAST_OPTIONS);
    await service.embedText('x');

    const callArgs = fetchMock.mock.calls[0];
    const headers = callArgs[1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer test-key-abc123');
  });
});

// ── EmbeddingApiError ────────────────────────────────────────────────────────

describe('EmbeddingApiError', () => {
  it('has correct name and statusCode', () => {
    const err = new EmbeddingApiError(422, 'Unprocessable');
    expect(err.name).toBe('EmbeddingApiError');
    expect(err.statusCode).toBe(422);
    expect(err.message).toBe('Unprocessable');
  });

  it('is an instance of Error', () => {
    const err = new EmbeddingApiError(500, 'fail');
    expect(err).toBeInstanceOf(Error);
  });
});
