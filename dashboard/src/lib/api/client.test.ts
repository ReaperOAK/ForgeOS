import { apiClient, isApiError, buildQueryString } from './client';
import type { ApiError } from './types';

// ── helpers ──────────────────────────────────────────────────────────────────

function mockFetchSuccess(body: unknown, status = 200): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response);
}

function mockFetchError(
  status: number,
  body?: Record<string, unknown>,
): void {
  global.fetch = jest.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Not Found',
    json: body ? () => Promise.resolve(body) : () => Promise.reject(new Error('no json')),
  } as unknown as Response);
}

// ── isApiError ───────────────────────────────────────────────────────────────

describe('isApiError', () => {
  it('returns true for a valid ApiError object', () => {
    const err: ApiError = { message: 'fail', status: 400 };
    expect(isApiError(err)).toBe(true);
  });

  it('returns true when optional fields are present', () => {
    const err: ApiError = {
      message: 'fail',
      status: 422,
      code: 'VALIDATION',
      details: { field: 'name' },
    };
    expect(isApiError(err)).toBe(true);
  });

  it('returns false for null', () => {
    expect(isApiError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isApiError(undefined)).toBe(false);
  });

  it('returns false for a non-object', () => {
    expect(isApiError('string')).toBe(false);
  });

  it('returns false when message is missing', () => {
    expect(isApiError({ status: 400 })).toBe(false);
  });

  it('returns false when status is missing', () => {
    expect(isApiError({ message: 'fail' })).toBe(false);
  });

  it('returns false when message is not a string', () => {
    expect(isApiError({ message: 123, status: 400 })).toBe(false);
  });

  it('returns false when status is not a number', () => {
    expect(isApiError({ message: 'fail', status: '400' })).toBe(false);
  });
});

// ── buildQueryString ─────────────────────────────────────────────────────────

describe('buildQueryString', () => {
  it('returns empty string for empty params', () => {
    expect(buildQueryString({})).toBe('');
  });

  it('builds query string from string params', () => {
    const qs = buildQueryString({ stage: 'QA', type: 'backend' });
    expect(qs).toBe('?stage=QA&type=backend');
  });

  it('builds query string from number params', () => {
    const qs = buildQueryString({ limit: 10, offset: 0 });
    expect(qs).toBe('?limit=10&offset=0');
  });

  it('omits undefined values', () => {
    const qs = buildQueryString({ stage: 'QA', type: undefined });
    expect(qs).toBe('?stage=QA');
  });

  it('returns empty string when all values are undefined', () => {
    const qs = buildQueryString({ a: undefined, b: undefined });
    expect(qs).toBe('');
  });

  it('handles mixed defined/undefined params', () => {
    const qs = buildQueryString({
      stage: 'BACKEND',
      type: undefined,
      limit: 25,
    });
    expect(qs).toContain('stage=BACKEND');
    expect(qs).toContain('limit=25');
    expect(qs).not.toContain('type');
  });
});

// ── ForgeApiClient (via apiClient singleton) ─────────────────────────────────

describe('ForgeApiClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getBaseUrl', () => {
    it('returns the configured base URL', () => {
      // default is process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011'
      expect(apiClient.getBaseUrl()).toBeTruthy();
    });
  });

  describe('get() — success', () => {
    it('returns parsed JSON on 200', async () => {
      const payload = { id: '1', name: 'test' };
      mockFetchSuccess(payload);

      const result = await apiClient.get<typeof payload>('/test');
      expect(result).toEqual(payload);
    });

    it('sends GET with correct URL and headers', async () => {
      mockFetchSuccess({});

      await apiClient.get('/api/test');

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/api/test'),
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
    });

    it('includes AbortSignal for timeout', async () => {
      mockFetchSuccess({});

      await apiClient.get('/api/test');

      const callArgs = (global.fetch as jest.Mock).mock.calls[0];
      expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
    });
  });

  describe('get() — HTTP errors', () => {
    it('throws ApiError with parsed JSON body on 400', async () => {
      mockFetchError(400, {
        message: 'Bad Request',
        code: 'VALIDATION_ERROR',
        details: { field: 'stage' },
      });

      try {
        await apiClient.get('/fail');
        fail('should have thrown');
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(400);
        expect(apiErr.message).toBe('Bad Request');
        expect(apiErr.code).toBe('VALIDATION_ERROR');
        expect(apiErr.details).toEqual({ field: 'stage' });
      }
    });

    it('throws ApiError with statusText when body has no message', async () => {
      mockFetchError(500, {});

      try {
        await apiClient.get('/fail');
        fail('should have thrown');
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(500);
        expect(apiErr.message).toBe('Not Found'); // statusText from mock
      }
    });

    it('throws ApiError with fallback when JSON parse fails', async () => {
      mockFetchError(502);

      try {
        await apiClient.get('/fail');
        fail('should have thrown');
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(502);
        expect(apiErr.message).toBe('Not Found'); // statusText fallback
      }
    });

    it('reads error field from body when message field is absent', async () => {
      mockFetchError(403, { error: 'Forbidden access' });

      try {
        await apiClient.get('/forbidden');
        fail('should have thrown');
      } catch (error) {
        const apiErr = error as ApiError;
        expect(apiErr.message).toBe('Forbidden access');
        expect(apiErr.status).toBe(403);
      }
    });
  });

  describe('get() — network errors', () => {
    it('wraps generic errors as NETWORK_ERROR ApiError', async () => {
      global.fetch = jest.fn().mockRejectedValue(new TypeError('fetch failed'));

      try {
        await apiClient.get('/network-fail');
        fail('should have thrown');
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.code).toBe('NETWORK_ERROR');
        expect(apiErr.message).toBe('fetch failed');
      }
    });

    it('wraps AbortError as timeout ApiError', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      global.fetch = jest.fn().mockRejectedValue(abortError);

      try {
        await apiClient.get('/timeout');
        fail('should have thrown');
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.code).toBe('NETWORK_ERROR');
        expect(apiErr.message).toBe('Request timeout');
      }
    });

    it('handles non-Error thrown values', async () => {
      global.fetch = jest.fn().mockRejectedValue('string error');

      try {
        await apiClient.get('/weird');
        fail('should have thrown');
      } catch (error) {
        expect(isApiError(error)).toBe(true);
        const apiErr = error as ApiError;
        expect(apiErr.status).toBe(0);
        expect(apiErr.code).toBe('NETWORK_ERROR');
        expect(apiErr.message).toBe('Network error');
      }
    });
  });
});
