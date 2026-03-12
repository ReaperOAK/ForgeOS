import { apiClient, isApiError } from './client';
import type { ApiError } from './types';

// ── Request types ────────────────────────────────────────────────────────────

export interface ClaimRequest {
  ticketId: string;
  agent: string;
  machine: string;
  operator: string;
}

export interface ReleaseRequest {
  ticketId: string;
}

export interface AdvanceRequest {
  ticketId: string;
  evidence: string;
}

export interface ForceReleaseRequest {
  ticketId: string;
  reason: string;
}

// ── Response types ───────────────────────────────────────────────────────────

export interface OperationResponse {
  success: boolean;
  message: string;
  ticketId: string;
  timestamp: string;
}

// ── Operator action type ─────────────────────────────────────────────────────

export type OperatorAction = 'claim' | 'release' | 'advance' | 'force-release';

// ── HTTP helper ──────────────────────────────────────────────────────────────

const DEFAULT_TIMEOUT = 10_000;

/**
 * Parse a non-OK fetch response into a typed {@link ApiError}.
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

/**
 * Send a POST request to the ForgeOS API.
 */
async function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

  try {
    const response = await fetch(`${apiClient.getBaseUrl()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
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

// ── API functions ────────────────────────────────────────────────────────────

/**
 * Claim a ticket for an operator.
 * Backend endpoint: POST /api/tickets/:id/claim
 */
export async function claimTicket(req: ClaimRequest): Promise<OperationResponse> {
  return post<OperationResponse>(
    `/api/tickets/${encodeURIComponent(req.ticketId)}/claim`,
    { agent: req.agent, machine: req.machine, operator: req.operator },
  );
}

/**
 * Release a claim on a ticket.
 * Backend endpoint: POST /api/tickets/:id/release
 */
export async function releaseTicket(req: ReleaseRequest): Promise<OperationResponse> {
  return post<OperationResponse>(
    `/api/tickets/${encodeURIComponent(req.ticketId)}/release`,
    {},
  );
}

/**
 * Advance a ticket to the next SDLC stage.
 * Backend endpoint: POST /api/tickets/:id/advance
 */
export async function advanceTicket(req: AdvanceRequest): Promise<OperationResponse> {
  return post<OperationResponse>(
    `/api/tickets/${encodeURIComponent(req.ticketId)}/advance`,
    { evidence: req.evidence },
  );
}

/**
 * Force-release another operator's claim on a ticket.
 * Backend endpoint: POST /api/tickets/:id/force-release
 */
export async function forceReleaseTicket(req: ForceReleaseRequest): Promise<OperationResponse> {
  return post<OperationResponse>(
    `/api/tickets/${encodeURIComponent(req.ticketId)}/force-release`,
    { reason: req.reason },
  );
}
