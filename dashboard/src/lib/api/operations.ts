import { apiClient, isApiError } from './client';
import type { ApiError } from './types';

// ── Request types ────────────────────────────────────────────────────────────

/** Parameters for claiming a ticket. */
export interface ClaimRequest {
    /** The ticket to claim. */
    ticketId: string;
    /** Agent identifier (e.g., `'operator'`). */
    agent: string;
    /** Machine hostname or identifier. */
    machine: string;
    /** Human operator performing the claim. */
    operator: string;
}

/** Parameters for releasing a ticket claim. */
export interface ReleaseRequest {
    /** The ticket whose claim should be released. */
    ticketId: string;
}

/** Parameters for advancing a ticket to the next stage. */
export interface AdvanceRequest {
    /** The ticket to advance. */
    ticketId: string;
    /** Evidence or rationale supporting the stage advancement. */
    evidence: string;
}

/** Parameters for force-releasing another operator's claim. */
export interface ForceReleaseRequest {
    /** The ticket to force-release. */
    ticketId: string;
    /** Mandatory reason explaining why the force release is needed. */
    reason: string;
}

// ── Response types ───────────────────────────────────────────────────────────

/** Standard response returned from all ticket operation endpoints. */
export interface OperationResponse {
    /** Whether the operation succeeded. */
    success: boolean;
    /** Human-readable result message. */
    message: string;
    /** ID of the affected ticket. */
    ticketId: string;
    /** ISO-8601 server timestamp of the operation. */
    timestamp: string;
}

// ── Operator action type ─────────────────────────────────────────────────────

/** Union of supported operator action identifiers. */
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
