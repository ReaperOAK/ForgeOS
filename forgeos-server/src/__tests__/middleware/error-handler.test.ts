/**
 * Error handler middleware tests.
 *
 * Validates error classification (ForgeOS app errors, PostgreSQL errors,
 * generic errors), HTTP status mapping, production mode stack-trace
 * suppression, and the withErrorHandling MCP wrapper.
 *
 * @module __tests__/middleware/error-handler.test
 * @ticket TASK-FOS-02-003
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ForgeOSErrorCode } from '../../types/index.js';

// ── Mock pino before importing the module under test ─────────────────────────

const mockLoggerInfo = vi.fn();
const mockLoggerError = vi.fn();

vi.mock('pino', () => {
  const mockPino = () => ({
    info: mockLoggerInfo,
    error: mockLoggerError,
    warn: vi.fn(),
    debug: vi.fn(),
    level: 'info',
    child: vi.fn().mockReturnThis(),
  });
  return { default: mockPino };
});

const {
  errorHandler,
  withErrorHandling,
  mapPgErrorCode,
  httpStatusForCode,
} = await import('../../middleware/error-handler.js');

// ── Test Helpers ─────────────────────────────────────────────────────────────

interface MockRequest {
  requestId?: string;
  method: string;
  path: string;
}

interface MockResponse {
  statusCode: number;
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  headersSent: boolean;
}

function createMockReq(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    requestId: 'test-req-id',
    method: 'POST',
    path: '/mcp',
    ...overrides,
  };
}

function createMockRes(): MockResponse {
  const res: MockResponse = {
    statusCode: 200,
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    headersSent: false,
  };
  // status() returns res for chaining
  res.status = vi.fn().mockReturnValue(res);
  return res;
}

function createMockNext(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

/** Create a mock PostgreSQL DatabaseError. */
function createPgError(code: string, message = 'pg error'): Error & { code: string } {
  const err = new Error(message) as Error & { code: string; detail?: string };
  err.code = code;
  return err;
}

/** Create a ForgeOS application error. */
function createForgeOSError(
  errorCode: ForgeOSErrorCode,
  message = 'app error',
  statusCode?: number,
  details?: Record<string, unknown>,
  ticketId?: string,
): Error & { errorCode: ForgeOSErrorCode; statusCode?: number; details?: Record<string, unknown>; ticketId?: string } {
  const err = new Error(message) as Error & {
    errorCode: ForgeOSErrorCode;
    statusCode?: number;
    details?: Record<string, unknown>;
    ticketId?: string;
  };
  err.errorCode = errorCode;
  if (statusCode !== undefined) err.statusCode = statusCode;
  if (details !== undefined) err.details = details;
  if (ticketId !== undefined) err.ticketId = ticketId;
  return err;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('mapPgErrorCode', () => {
  it('maps unique_violation (23505) to ALREADY_CLAIMED', () => {
    expect(mapPgErrorCode('23505')).toBe(ForgeOSErrorCode.ALREADY_CLAIMED);
  });

  it('maps foreign_key_violation (23503) to TICKET_NOT_FOUND', () => {
    expect(mapPgErrorCode('23503')).toBe(ForgeOSErrorCode.TICKET_NOT_FOUND);
  });

  it('maps connection_failure (08006) to DB_UNAVAILABLE', () => {
    expect(mapPgErrorCode('08006')).toBe(ForgeOSErrorCode.DB_UNAVAILABLE);
  });

  it('maps admin_shutdown (57P01) to DB_UNAVAILABLE', () => {
    expect(mapPgErrorCode('57P01')).toBe(ForgeOSErrorCode.DB_UNAVAILABLE);
  });

  it('maps serialization_failure (40001) to INTERNAL_ERROR', () => {
    expect(mapPgErrorCode('40001')).toBe(ForgeOSErrorCode.INTERNAL_ERROR);
  });

  it('maps deadlock_detected (40P01) to INTERNAL_ERROR', () => {
    expect(mapPgErrorCode('40P01')).toBe(ForgeOSErrorCode.INTERNAL_ERROR);
  });

  it('maps undefined_table (42P01) to DB_UNAVAILABLE', () => {
    expect(mapPgErrorCode('42P01')).toBe(ForgeOSErrorCode.DB_UNAVAILABLE);
  });

  it('returns INTERNAL_ERROR for unknown pg error codes', () => {
    expect(mapPgErrorCode('99999')).toBe(ForgeOSErrorCode.INTERNAL_ERROR);
  });
});

describe('httpStatusForCode', () => {
  it('returns 404 for TICKET_NOT_FOUND', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.TICKET_NOT_FOUND)).toBe(404);
  });

  it('returns 409 for ALREADY_CLAIMED', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.ALREADY_CLAIMED)).toBe(409);
  });

  it('returns 403 for FORBIDDEN', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.FORBIDDEN)).toBe(403);
  });

  it('returns 401 for UNAUTHORIZED', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.UNAUTHORIZED)).toBe(401);
  });

  it('returns 429 for RATE_LIMITED', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.RATE_LIMITED)).toBe(429);
  });

  it('returns 500 for INTERNAL_ERROR', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.INTERNAL_ERROR)).toBe(500);
  });

  it('returns 503 for DB_UNAVAILABLE', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.DB_UNAVAILABLE)).toBe(503);
  });

  it('returns 410 for LEASE_EXPIRED', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.LEASE_EXPIRED)).toBe(410);
  });

  it('returns 400 for INVALID_TRANSITION', () => {
    expect(httpStatusForCode(ForgeOSErrorCode.INVALID_TRANSITION)).toBe(400);
  });
});

describe('errorHandler', () => {
  let req: MockRequest;
  let res: MockResponse;
  let next: ReturnType<typeof vi.fn>;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    req = createMockReq();
    res = createMockRes();
    next = createMockNext();
    process.env.NODE_ENV = 'development';
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  // ── ForgeOS Application Errors ──

  it('handles ForgeOS application errors with correct status code', () => {
    const err = createForgeOSError(ForgeOSErrorCode.TICKET_NOT_FOUND, 'Ticket missing', 404);

    errorHandler(err, req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.TICKET_NOT_FOUND,
        message: 'Ticket missing',
      }),
    );
  });

  it('includes details and ticket_id when present on ForgeOS error', () => {
    const err = createForgeOSError(
      ForgeOSErrorCode.FILE_CONFLICT,
      'File locked',
      409,
      { conflicting_file: 'src/main.ts' },
      'TASK-001',
    );

    errorHandler(err, req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(responseBody.details).toEqual({ conflicting_file: 'src/main.ts' });
    expect(responseBody.ticket_id).toBe('TASK-001');
  });

  it('defaults to httpStatusForCode when statusCode not set on ForgeOS error', () => {
    const err = createForgeOSError(ForgeOSErrorCode.UNAUTHORIZED, 'No token');
    // statusCode not explicitly set

    errorHandler(err, req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  // ── PostgreSQL Errors ──

  it('maps PostgreSQL unique_violation to 409 ALREADY_CLAIMED', () => {
    const err = createPgError('23505', 'duplicate key');

    errorHandler(err, req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.ALREADY_CLAIMED,
      }),
    );
  });

  it('maps PostgreSQL connection_failure to 503 DB_UNAVAILABLE', () => {
    const err = createPgError('08006', 'connection refused');

    errorHandler(err, req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.DB_UNAVAILABLE,
      }),
    );
  });

  it('maps unknown pg error code to 500 INTERNAL_ERROR', () => {
    const err = createPgError('99999', 'unknown pg error');

    errorHandler(err, req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.INTERNAL_ERROR,
      }),
    );
  });

  // ── Generic Errors ──

  it('handles generic Error with 500 INTERNAL_ERROR', () => {
    const err = new Error('Something broke');

    errorHandler(err, req as never, res as never, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ForgeOSErrorCode.INTERNAL_ERROR,
        message: 'Something broke',
      }),
    );
  });

  // ── Production Mode ──

  it('never leaks error message in production', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('Sensitive internal details about DB schema');

    errorHandler(err, req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(responseBody.message).toBe('An error occurred');
    expect(responseBody.message).not.toContain('Sensitive');
  });

  it('never leaks stack trace in production', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('Internal failure');

    errorHandler(err, req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(responseBody).not.toHaveProperty('stack');
    expect(JSON.stringify(responseBody)).not.toContain('at ');
  });

  // ── Response Structure ──

  it('includes timestamp in ISO 8601 format', () => {
    const err = new Error('test');

    errorHandler(err, req as never, res as never, next);

    const responseBody = (res.json as ReturnType<typeof vi.fn>).mock.calls[0][0] as Record<string, unknown>;
    expect(responseBody.timestamp).toBeDefined();
    expect(new Date(responseBody.timestamp as string).toISOString()).toBe(responseBody.timestamp);
  });

  // ── Logging ──

  it('logs the error with structured context', () => {
    const err = new Error('handler failure');
    req.requestId = 'log-test-id';

    errorHandler(err, req as never, res as never, next);

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({
        errorCode: ForgeOSErrorCode.INTERNAL_ERROR,
        statusCode: 500,
        requestId: 'log-test-id',
        method: 'POST',
        path: '/mcp',
      }),
      'Request error',
    );
  });

  it('logs only message (not full error) in production', () => {
    process.env.NODE_ENV = 'production';
    const err = new Error('secret details');

    errorHandler(err, req as never, res as never, next);

    const logData = mockLoggerError.mock.calls[0][0] as Record<string, unknown>;
    const loggedErr = logData.err as Record<string, unknown>;
    expect(loggedErr).toEqual({ message: 'secret details' });
    expect(loggedErr).not.toHaveProperty('stack');
  });
});

describe('withErrorHandling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns handler result on success', async () => {
    const expected = { content: [{ type: 'text', text: 'ok' }] };

    const result = await withErrorHandling(async () => expected);

    expect(result).toEqual(expected);
  });

  it('catches ForgeOS errors and returns MCP error content', async () => {
    const err = createForgeOSError(ForgeOSErrorCode.TICKET_NOT_FOUND, 'Not found');

    const result = await withErrorHandling(async () => {
      throw err;
    });

    expect(result).toHaveProperty('content');
    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe('text');

    const parsed = JSON.parse(content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBe(ForgeOSErrorCode.TICKET_NOT_FOUND);
    expect(parsed.message).toBe('Not found');
    expect(parsed.timestamp).toBeDefined();
  });

  it('catches PostgreSQL errors and maps them correctly', async () => {
    const pgErr = createPgError('23505', 'unique violation');

    const result = await withErrorHandling(async () => {
      throw pgErr;
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBe(ForgeOSErrorCode.ALREADY_CLAIMED);
  });

  it('catches generic errors as INTERNAL_ERROR', async () => {
    const result = await withErrorHandling(async () => {
      throw new Error('generic boom');
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBe(ForgeOSErrorCode.INTERNAL_ERROR);
    expect(parsed.message).toBe('generic boom');
  });

  it('handles non-Error thrown values', async () => {
    const result = await withErrorHandling(async () => {
      throw 'string error'; // eslint-disable-line no-throw-literal
    });

    const content = (result as { content: Array<{ type: string; text: string }> }).content;
    const parsed = JSON.parse(content[0].text) as Record<string, unknown>;
    expect(parsed.error).toBe(ForgeOSErrorCode.INTERNAL_ERROR);
    expect(parsed.message).toBe('string error');
  });

  it('logs the error via structured logger', async () => {
    const err = new Error('logged error');

    await withErrorHandling(async () => {
      throw err;
    });

    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ errorCode: ForgeOSErrorCode.INTERNAL_ERROR }),
      'MCP tool handler error',
    );
  });

  it('returns well-formed MCP content structure', async () => {
    const result = await withErrorHandling(async () => {
      throw new Error('structure test');
    });

    const typedResult = result as { content: Array<{ type: string; text: string }> };
    expect(typedResult.content).toBeInstanceOf(Array);
    expect(typedResult.content[0]).toHaveProperty('type', 'text');
    expect(typedResult.content[0]).toHaveProperty('text');
    // text must be valid JSON
    expect(() => JSON.parse(typedResult.content[0].text)).not.toThrow();
  });
});
