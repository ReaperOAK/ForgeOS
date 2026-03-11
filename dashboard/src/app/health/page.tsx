'use client';

import { useState, useEffect, useCallback } from 'react';
import { RefreshCw } from 'lucide-react';
import { HealthStatusCard } from '@/components/HealthStatusCard';
import { apiClient } from '@/lib/api-client';
import type { HealthStatus } from '@/lib/types';

interface ServiceState {
    serviceName: string;
    status: HealthStatus;
    endpoint: string;
    responseTime?: string;
    lastChecked?: string;
    message?: string;
    isPrimary?: boolean;
}

const initialServices: ServiceState[] = [
    {
        serviceName: 'ForgeOS API',
        status: 'checking',
        endpoint: '/api/health',
        isPrimary: true,
    },
    {
        serviceName: 'Database',
        status: 'checking',
        endpoint: '/api/health/db',
    },
    {
        serviceName: 'MCP Server',
        status: 'checking',
        endpoint: '/api/health/mcp',
    },
    {
        serviceName: 'SSE Events',
        status: 'checking',
        endpoint: '/api/events',
    },
];

export default function HealthPage() {
    const [services, setServices] = useState<ServiceState[]>(initialServices);

    const checkAllServices = useCallback(async () => {
        setServices((prev) =>
            prev.map((s) => ({ ...s, status: 'checking' as const })),
        );

        const result = await apiClient.healthCheck();
        const now = new Date().toLocaleTimeString();

        setServices((prev) =>
            prev.map((s) => ({
                ...s,
                status: (s.isPrimary
                    ? result.healthy
                        ? 'connected'
                        : 'error'
                    : result.healthy
                        ? 'connected'
                        : 'warning') as HealthStatus,
                responseTime: s.isPrimary ? `${result.responseTime}ms` : undefined,
                lastChecked: now,
                message: !result.healthy
                    ? s.isPrimary
                        ? result.message
                        : 'Depends on primary API'
                    : undefined,
            })),
        );
    }, []);

    useEffect(() => {
        checkAllServices();
    }, [checkAllServices]);

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold">Health Check</h1>
                <button
                    onClick={checkAllServices}
                    className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-inverse hover:bg-primary-hover focus-ring transition-colors"
                >
                    <RefreshCw size={16} aria-hidden="true" />
                    Check All
                </button>
            </div>

            <p className="text-muted text-sm mb-4">
                API Base URL:{' '}
                <code className="font-mono text-xs bg-surface-alt px-2 py-1 rounded">
                    {apiClient.getBaseUrl()}
                </code>
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {services.map((service) => (
                    <HealthStatusCard
                        key={service.serviceName}
                        {...service}
                        onCheck={checkAllServices}
                    />
                ))}
            </div>
        </div>
    );
}
