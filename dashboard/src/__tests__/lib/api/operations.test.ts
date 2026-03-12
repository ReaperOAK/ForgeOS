import {
    claimTicket,
    releaseTicket,
    advanceTicket,
    forceReleaseTicket,
} from '@/lib/api/operations';
import type {
    ClaimRequest,
    ReleaseRequest,
    AdvanceRequest,
    ForceReleaseRequest,
    OperationResponse,
} from '@/lib/api/operations';

// ── Mock fetch ───────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// Mock apiClient.getBaseUrl()
jest.mock('@/lib/api/client', () => ({
    apiClient: { getBaseUrl: () => 'http://localhost:3000' },
    isApiError: (e: unknown) =>
        typeof e === 'object' &&
        e !== null &&
        'message' in e &&
        'status' in e &&
        typeof (e as Record<string, unknown>).message === 'string' &&
        typeof (e as Record<string, unknown>).status === 'number',
}));

afterEach(() => {
    mockFetch.mockReset();
});

const successResponse: OperationResponse = {
    success: true,
    message: 'Operation completed',
    ticketId: 'FORGEOS-TEST-1',
    timestamp: '2026-03-12T10:00:00Z',
};

function mockOk(data: OperationResponse) {
    mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => data,
    });
}

function mockError(status: number, body: Record<string, unknown> = {}) {
    mockFetch.mockResolvedValueOnce({
        ok: false,
        status,
        statusText: 'Error',
        json: async () => body,
    });
}

// ── claimTicket ──────────────────────────────────────────────────────────────

describe('claimTicket', () => {
    const req: ClaimRequest = {
        ticketId: 'FORGEOS-TEST-1',
        agent: 'operator',
        machine: 'dashboard',
        operator: 'Ticketer',
    };

    it('sends POST to /api/tickets/:id/claim with correct body', async () => {
        mockOk(successResponse);
        const result = await claimTicket(req);

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:3000/api/tickets/FORGEOS-TEST-1/claim',
            expect.objectContaining({
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ agent: 'operator', machine: 'dashboard', operator: 'Ticketer' }),
            }),
        );
        expect(result).toEqual(successResponse);
    });

    it('throws ApiError on 401 response', async () => {
        mockError(401, { message: 'Unauthorized' });

        await expect(claimTicket(req)).rejects.toEqual(
            expect.objectContaining({ status: 401, message: 'Unauthorized' }),
        );
    });

    it('throws ApiError on 409 conflict', async () => {
        mockError(409, { message: 'Ticket already claimed' });

        await expect(claimTicket(req)).rejects.toEqual(
            expect.objectContaining({ status: 409, message: 'Ticket already claimed' }),
        );
    });

    it('encodes ticket IDs with special characters', async () => {
        mockOk(successResponse);
        await claimTicket({ ...req, ticketId: 'TEST/SPECIAL' });

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:3000/api/tickets/TEST%2FSPECIAL/claim',
            expect.anything(),
        );
    });
});

// ── releaseTicket ────────────────────────────────────────────────────────────

describe('releaseTicket', () => {
    const req: ReleaseRequest = { ticketId: 'FORGEOS-TEST-1' };

    it('sends POST to /api/tickets/:id/release', async () => {
        mockOk(successResponse);
        const result = await releaseTicket(req);

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:3000/api/tickets/FORGEOS-TEST-1/release',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({}),
            }),
        );
        expect(result).toEqual(successResponse);
    });

    it('throws ApiError on 404', async () => {
        mockError(404, { message: 'Ticket not found' });
        await expect(releaseTicket(req)).rejects.toEqual(
            expect.objectContaining({ status: 404, message: 'Ticket not found' }),
        );
    });
});

// ── advanceTicket ────────────────────────────────────────────────────────────

describe('advanceTicket', () => {
    const req: AdvanceRequest = { ticketId: 'FORGEOS-TEST-1', evidence: 'All tests pass' };

    it('sends POST with evidence in body', async () => {
        mockOk(successResponse);
        const result = await advanceTicket(req);

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:3000/api/tickets/FORGEOS-TEST-1/advance',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ evidence: 'All tests pass' }),
            }),
        );
        expect(result).toEqual(successResponse);
    });

    it('throws ApiError on 403', async () => {
        mockError(403, { message: 'Insufficient permissions' });
        await expect(advanceTicket(req)).rejects.toEqual(
            expect.objectContaining({ status: 403, message: 'Insufficient permissions' }),
        );
    });
});

// ── forceReleaseTicket ───────────────────────────────────────────────────────

describe('forceReleaseTicket', () => {
    const req: ForceReleaseRequest = {
        ticketId: 'FORGEOS-TEST-1',
        reason: 'Operator unresponsive for 2 hours',
    };

    it('sends POST with reason in body', async () => {
        mockOk(successResponse);
        const result = await forceReleaseTicket(req);

        expect(mockFetch).toHaveBeenCalledWith(
            'http://localhost:3000/api/tickets/FORGEOS-TEST-1/force-release',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ reason: 'Operator unresponsive for 2 hours' }),
            }),
        );
        expect(result).toEqual(successResponse);
    });

    it('throws ApiError on 500', async () => {
        mockError(500, { message: 'Internal server error' });
        await expect(forceReleaseTicket(req)).rejects.toEqual(
            expect.objectContaining({ status: 500, message: 'Internal server error' }),
        );
    });
});

// ── Network error handling ───────────────────────────────────────────────────

describe('network error handling', () => {
    it('wraps generic Error as ApiError with NETWORK_ERROR code', async () => {
        mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

        await expect(claimTicket({
            ticketId: 'T1',
            agent: 'a',
            machine: 'm',
            operator: 'o',
        })).rejects.toEqual(
            expect.objectContaining({
                status: 0,
                code: 'NETWORK_ERROR',
                message: 'Failed to fetch',
            }),
        );
    });

    it('handles AbortError as timeout', async () => {
        const abortError = new DOMException('Aborted', 'AbortError');
        mockFetch.mockRejectedValueOnce(abortError);

        await expect(releaseTicket({ ticketId: 'T1' })).rejects.toEqual(
            expect.objectContaining({
                status: 0,
                code: 'NETWORK_ERROR',
                message: 'Request timeout',
            }),
        );
    });

    it('handles non-JSON error response body', async () => {
        mockFetch.mockResolvedValueOnce({
            ok: false,
            status: 502,
            statusText: 'Bad Gateway',
            json: async () => { throw new Error('not json'); },
        });

        await expect(advanceTicket({ ticketId: 'T1', evidence: 'e' })).rejects.toEqual(
            expect.objectContaining({ status: 502, message: 'Bad Gateway' }),
        );
    });
});
