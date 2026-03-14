import type { HealthCheckResult } from '@/lib/types';

const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3011';
const DEFAULT_TIMEOUT = 10_000;

interface ApiResponse<T> {
    data: T;
    status: number;
}

interface ApiError {
    message: string;
    status: number;
}

class ApiClient {
    private baseUrl: string;
    private timeout: number;

    constructor(
        baseUrl: string = API_BASE_URL,
        timeout: number = DEFAULT_TIMEOUT,
    ) {
        this.baseUrl = baseUrl;
        this.timeout = timeout;
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    async get<T>(path: string): Promise<ApiResponse<T>> {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);

        try {
            const response = await fetch(`${this.baseUrl}${path}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' },
                signal: controller.signal,
            });

            if (!response.ok) {
                const error: ApiError = {
                    message: `HTTP ${response.status}: ${response.statusText}`,
                    status: response.status,
                };
                throw error;
            }

            const data = (await response.json()) as T;
            return { data, status: response.status };
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async healthCheck(): Promise<HealthCheckResult> {
        const start = performance.now();
        try {
            const response = await this.get<{ status: string }>('/api/health');
            const responseTime = Math.round(performance.now() - start);
            return { healthy: response.data.status === 'ok', responseTime };
        } catch (err) {
            const responseTime = Math.round(performance.now() - start);
            const message =
                err instanceof Error ? err.message : 'Connection failed';
            return { healthy: false, responseTime, message };
        }
    }
}

export const apiClient = new ApiClient();
export type { ApiResponse, ApiError };
