import type { ReactNode } from 'react';

interface MetricCardProps {
    label: string;
    value: number | string;
    icon?: ReactNode;
    trend?: { direction: 'up' | 'down' | 'flat'; value: string };
    isLoading?: boolean;
}

export function MetricCard({
    label,
    value,
    icon,
    trend,
    isLoading,
}: MetricCardProps) {
    if (isLoading) {
        return (
            <div
                className="bg-surface border border-border rounded-lg p-4"
                role="status"
                aria-label={`${label}: loading`}
            >
                <div className="animate-pulse space-y-3">
                    <div className="h-4 bg-surface-alt rounded w-1/2" />
                    <div className="h-8 bg-surface-alt rounded w-3/4" />
                </div>
            </div>
        );
    }

    return (
        <div
            className="bg-surface border border-border rounded-lg p-4"
            role="status"
            aria-label={`${label}: ${value}`}
        >
            <div className="flex items-center gap-2 text-muted mb-2">
                {icon && <span aria-hidden="true">{icon}</span>}
                <span className="text-sm font-medium">{label}</span>
            </div>
            <div className="flex items-end gap-2">
                <span className="text-4xl font-bold text-primary">{value}</span>
                {trend && (
                    <span
                        className={`text-xs font-semibold mb-1 ${trend.direction === 'up'
                                ? 'text-success'
                                : trend.direction === 'down'
                                    ? 'text-error'
                                    : 'text-muted'
                            }`}
                    >
                        {trend.direction === 'up'
                            ? '↑'
                            : trend.direction === 'down'
                                ? '↓'
                                : '→'}{' '}
                        {trend.value}
                    </span>
                )}
            </div>
        </div>
    );
}
