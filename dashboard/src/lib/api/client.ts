import type { ApiClientConfig, ApiError } from './types';

/** Default client configuration. Uses `NEXT_PUBLIC_API_URL` or localhost:3000. */
const DEFAULT_CONFIG: ApiClientConfig = {
  baseUrl: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3000',
  timeout: 10_000,
  headers: {
    'Content-Type': 'application/json',
  },
};

/**
 * Parse a non-OK fetch response into a typed {@link ApiError}.
 * Falls back to status text when the body is not valid JSON.
 */
async function parseErrorResponse(response: Response): Promise<ApiError> {
  try {
    const body = await response.json();
    return {
      message: body.message || body.error || response.statusText,
      status: response.status,
      code: body.code,
      details: body.details,
    };
  } catch {
    return {
      message: response.statusText || `HTTP ${response.status}`,
      status: response.status,
    };
  }
}

/** Type guard that narrows an unknown value to {@link ApiError}. */
export function isApiError(error: unknown): error is ApiError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    'status' in error &&
    typeof (error as ApiError).message === 'string' &&
    typeof (error as ApiError).status === 'number'
  );
}

/**
 * Build a URL query string from a key-value map, omitting undefined values.
 * @returns The query string prefixed with `?`, or an empty string if no params.
 */
export function buildQueryString(
  params: Record<string, string | number | undefined>,
): string {
  const searchParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      searchParams.set(key, String(value));
    }
  }
  const qs = searchParams.toString();
  return qs ? `?${qs}` : '';
}

/**
 * HTTP client for the ForgeOS REST API.
 *
 * Wraps `fetch` with timeout handling, JSON parsing, and typed error responses.
 * Base URL is read from `NEXT_PUBLIC_API_URL` at construction time.
 */
class ForgeApiClient {
  private config: ApiClientConfig;

  constructor(config: Partial<ApiClientConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      headers: { ...DEFAULT_CONFIG.headers, ...config.headers },
    };
  }

  /** Return the configured base URL. */
  getBaseUrl(): string {
    return this.config.baseUrl;
  }

  /**
   * Send a GET request and return the parsed JSON body.
   * @throws {ApiError} On non-OK response or network failure.
   */
  async get<T>(path: string): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    try {
      const response = await fetch(`${this.config.baseUrl}${path}`, {
        method: 'GET',
        headers: this.config.headers,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await parseErrorResponse(response);
      }

      return (await response.json()) as T;
    } catch (error: unknown) {
      if (isApiError(error)) {
        throw error;
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        const apiError: ApiError = {
          message: 'Request timeout',
          status: 0,
          code: 'NETWORK_ERROR',
        };
        throw apiError;
      }
      const apiError: ApiError = {
        message: error instanceof Error ? error.message : 'Network error',
        status: 0,
        code: 'NETWORK_ERROR',
      };
      throw apiError;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

/** Singleton API client instance used by all endpoint functions. */
export const apiClient = new ForgeApiClient();
