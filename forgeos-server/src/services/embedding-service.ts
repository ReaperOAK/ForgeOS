/**
 * Embedding Service — OpenAI text-embedding API integration.
 *
 * Provides {@link EmbeddingService.embedText} for single-text embedding
 * and {@link EmbeddingService.embedBatch} for batch processing with
 * configurable chunk sizes.
 *
 * Features:
 * - Retry with exponential backoff (configurable attempts).
 * - Configurable max concurrent requests for rate limiting.
 * - API key read exclusively from `OPENAI_API_KEY` env var.
 * - API key is NEVER logged — masked as `***MASKED***` in error context.
 *
 * @module services/embedding-service
 * @ticket TASK-INT-BE033
 */

import { logger } from '../middleware/logging.js';

// ── Public Types ─────────────────────────────────────────────────────────────

/** Configuration options for {@link EmbeddingService}. */
export interface EmbeddingServiceOptions {
    /** OpenAI model name. Defaults to env `EMBEDDING_MODEL` or `text-embedding-3-small`. */
    model?: string;
    /** Maximum retry attempts on transient failures. Defaults to `3`. */
    maxRetries?: number;
    /** Number of texts per API call in batch mode. Defaults to `100`. */
    batchSize?: number;
    /** Maximum concurrent API requests for rate limiting. Defaults to `5`. */
    maxConcurrent?: number;
    /** Base delay in ms for exponential backoff. Defaults to `1000`. */
    baseDelayMs?: number;
    /** Override the API base URL (useful for testing). */
    baseUrl?: string;
}

/** Shape of a single embedding object in the OpenAI response. */
interface EmbeddingResponseItem {
    embedding: number[];
    index: number;
}

/** Shape of the OpenAI embeddings API response body. */
interface EmbeddingApiResponse {
    data: EmbeddingResponseItem[];
    model: string;
    usage: { prompt_tokens: number; total_tokens: number };
}

// ── Errors ───────────────────────────────────────────────────────────────────

/** Thrown when the OpenAI API returns a non-OK HTTP status. */
export class EmbeddingApiError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'EmbeddingApiError';
  }
}

// ── Concurrency Limiter ──────────────────────────────────────────────────────

/**
 * Simple semaphore for bounding concurrent async operations.
 * Used to enforce rate-limiting on outbound API calls.
 */
class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.active < this.maxConcurrent) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.waiting.push(() => {
        this.active++;
        resolve();
      });
    });
  }

  release(): void {
    this.active--;
    const next = this.waiting.shift();
    if (next) {
      next();
    }
  }
}

// ── Service ──────────────────────────────────────────────────────────────────

/**
 * Embedding service that interfaces with the OpenAI embeddings API.
 *
 * Reads `OPENAI_API_KEY` from the environment at construction time.
 * The key is never logged or included in error messages.
 */
export class EmbeddingService {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly maxRetries: number;
  private readonly batchSize: number;
  private readonly baseDelayMs: number;
  private readonly limiter: ConcurrencyLimiter;

  constructor(options?: EmbeddingServiceOptions) {
    const apiKey = process.env.OPENAI_API_KEY ?? '';
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required');
    }
    this.apiKey = apiKey;
    this.model =
      options?.model ?? process.env.EMBEDDING_MODEL ?? 'text-embedding-3-small';
    this.baseUrl = options?.baseUrl ?? 'https://api.openai.com/v1/embeddings';
    this.maxRetries = options?.maxRetries ?? 3;
    this.batchSize = options?.batchSize ?? 100;
    this.baseDelayMs = options?.baseDelayMs ?? 1000;
    this.limiter = new ConcurrencyLimiter(options?.maxConcurrent ?? 5);

    logger.info(
      { model: this.model, maxRetries: this.maxRetries, batchSize: this.batchSize },
      'embedding-service: initialised',
    );
  }

  /**
   * Embed a single text string.
   *
   * @param text - The input text to embed.
   * @returns A vector of floating-point numbers.
   */
  async embedText(text: string): Promise<number[]> {
    if (!text) {
      throw new Error('embedText requires a non-empty string');
    }
    const response = await this.callApi([text]);
    return response[0];
  }

  /**
   * Embed multiple texts in batches.
   *
   * Splits `texts` into chunks of `batchSize` and calls the API
   * sequentially per chunk, respecting the concurrency limiter.
   *
   * @param texts     - Array of input texts.
   * @param batchSize - Override the default batch size for this call.
   * @returns An array of embedding vectors, one per input text.
   */
  async embedBatch(texts: string[], batchSize?: number): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const size = batchSize ?? this.batchSize;
    const results: number[][] = [];

    for (let i = 0; i < texts.length; i += size) {
      const batch = texts.slice(i, i + size);
      const embeddings = await this.callApi(batch);
      results.push(...embeddings);
    }

    return results;
  }

  /**
   * Call the OpenAI embeddings API with retry and backoff.
   *
   * Acquires a concurrency permit before making the request, and
   * releases it regardless of success or failure. Retries on
   * transient errors (5xx, network failures) with exponential backoff.
   *
   * @param input - Array of text strings to embed in one API call.
   * @returns Array of embedding vectors in input order.
   * @throws {EmbeddingApiError} on non-retryable API errors (4xx except 429).
   */
  private async callApi(input: string[]): Promise<number[][]> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      await this.limiter.acquire();
      try {
        const response = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({ input, model: this.model }),
        });

        if (!response.ok) {
          const statusCode = response.status;
          const body = await response.text().catch(() => '');

          // 4xx errors (except 429 rate-limit) are not retryable
          if (statusCode >= 400 && statusCode < 500 && statusCode !== 429) {
            throw new EmbeddingApiError(
              statusCode,
              `OpenAI API error ${statusCode}: ${body} (auth: ***MASKED***)`,
            );
          }

          throw new EmbeddingApiError(
            statusCode,
            `OpenAI API error ${statusCode} (retryable)`,
          );
        }

        const data = (await response.json()) as EmbeddingApiResponse;
        return data.data.map((d) => d.embedding);
      } catch (err) {
        lastError = err as Error;

        // Non-retryable client errors bubble immediately
        if (err instanceof EmbeddingApiError && err.statusCode >= 400 && err.statusCode < 500 && err.statusCode !== 429) {
          throw err;
        }

        if (attempt < this.maxRetries) {
          const delay = Math.pow(2, attempt) * this.baseDelayMs;
          logger.warn(
            { attempt: attempt + 1, maxRetries: this.maxRetries, delayMs: delay },
            'embedding-service: retrying after transient error',
          );
          await new Promise<void>((r) => setTimeout(r, delay));
        }
      } finally {
        this.limiter.release();
      }
    }

    logger.error(
      { maxRetries: this.maxRetries, auth: '***MASKED***' },
      'embedding-service: all retries exhausted',
    );
    throw lastError;
  }
}
