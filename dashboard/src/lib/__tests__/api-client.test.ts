import { apiClient } from '@/lib/api-client';

describe('ApiClient', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('getBaseUrl returns configured base URL', () => {
        expect(apiClient.getBaseUrl()).toBe('http://localhost:3000');
    });

    it('get() returns parsed data on success', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: 'ok' }),
        });

        const result = await apiClient.get<{ status: string }>('/api/health');
        expect(result.data).toEqual({ status: 'ok' });
        expect(result.status).toBe(200);
    });

    it('get() throws on non-ok response', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
        });

        await expect(apiClient.get('/api/fail')).rejects.toEqual({
            message: 'HTTP 500: Internal Server Error',
            status: 500,
        });
    });

    it('get() calls fetch with correct URL and headers', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({}),
        });

        await apiClient.get('/test');
        expect(global.fetch).toHaveBeenCalledWith(
            'http://localhost:3000/test',
            expect.objectContaining({
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
            }),
        );
    });

    it('healthCheck returns healthy result on success', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: 'ok' }),
        });

        const result = await apiClient.healthCheck();
        expect(result.healthy).toBe(true);
        expect(result.responseTime).toBeGreaterThanOrEqual(0);
    });

    it('healthCheck returns unhealthy on failure', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('Connection refused'));

        const result = await apiClient.healthCheck();
        expect(result.healthy).toBe(false);
        expect(result.message).toBe('Connection refused');
    });

    it('healthCheck returns unhealthy for non-ok status', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            status: 200,
            json: () => Promise.resolve({ status: 'degraded' }),
        });

        const result = await apiClient.healthCheck();
        expect(result.healthy).toBe(false);
    });
});
