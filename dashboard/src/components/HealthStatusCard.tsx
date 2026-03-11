'use client';

import { CheckCircle, AlertTriangle, XCircle, Loader2 } from 'lucide-react';
import type { HealthStatus } from '@/lib/types';

interface HealthStatusCardProps {
    serviceName: string;
    status: HealthStatus;
    endpoint?: string;
    baseUrl?: string;
    responseTime?: string;
    lastChecked?: string;
    message?: string;
    onCheck?: () => void;
    isPrimary?: boolean;
}

const statusConfig = {
    connected: {
        icon: CheckCircle,
        color: 'text-success',
        border: 'border-l-success',
        label: 'Connected',
    },
    warning: {
        icon: AlertTriangle,
        color: 'text-warning',
        border: 'border-l-warning',
        label: 'Warning',
    },
    error: {
        icon: XCircle,
        color: 'text-error',
        border: 'border-l-error',
        label: 'Error',
    },
    checking: {
        icon: Loader2,
        color: 'text-info',
        border: 'border-l-info',
        label: 'Checking...',
    },
} as const;

export function HealthStatusCard({
    serviceName,
    status,
    endpoint,
    responseTime,
    lastChecked,
    message,
    onCheck,
    isPrimary,
}: HealthStatusCardProps) {
    const config = statusConfig[status];
    const Icon = config.icon;

    return (
        <div
            className={`bg-surface border border-border ${config.border} border-l-4 rounded-lg ${isPrimary ? 'p-6' : 'p-4'
                }`}
            role="status"
            aria-label={`${serviceName}: ${config.label}`}
        >
            <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                    <Icon
                        size={isPrimary ? 24 : 18}
                        className={`${config.color} ${status === 'checking' ? 'animate-spin' : ''}`}
                        aria-hidden="true"
                    />
                    <div>
                        <h3
                            className={`font-semibold ${isPrimary ? 'text-lg' : 'text-sm'}`}
                        >
                            {serviceName}
                        </h3>
                        <p className={`text-xs ${config.color}`}>{config.label}</p>
                    </div>
                </div>
                {responseTime && (
                    <span className="text-xs text-muted font-mono">{responseTime}</span>
                )}
            </div>

            {endpoint && (
                <p className="mt-2 text-xs font-mono text-muted truncate">{endpoint}</p>
            )}

            {message && <p className="mt-2 text-sm text-muted">{message}</p>}

            <div className="mt-3 flex items-center justify-between">
                {lastChecked && (
                    <span className="text-xs text-muted">{lastChecked}</span>
                )}
                {onCheck && (
                    <button
                        onClick={onCheck}
                        className="text-xs text-primary hover:text-primary-hover font-medium focus-ring rounded px-2 py-1"
                    >
                        Check Now
                    </button>
                )}
            </div>
        </div>
    );
}
