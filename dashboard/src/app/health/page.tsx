'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { RefreshCw, AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { HealthPanel } from '@/components/health/HealthPanel';
import { MetricCard, type Severity } from '@/components/health/MetricCard';
import type { StatusLevel } from '@/components/health/StatusIndicator';
import { apiClient } from '@/lib/api-client';

const REFRESH_INTERVAL = 30_000;

interface DatabaseHealth {
    pool: { active: number; max: number };
    latency: { p50: number; p99: number };
    latencyTrend?: { p50: string; p99: string };
}

interface McpHealth {
    uptime: string;
    connectedAgents: number;
    requestsPerMin: number;
    agentTrend?: string;
    requestTrend?: string;
}

interface WebhookHealth {
    successRate: number;
    pendingQueue: number;
    failedDeliveries: number;
}

interface AlertEntry {
    id: string;
    severity: 'critical' | 'warning' | 'info';
    message: string;
    timestamp: string;
}

interface HealthData {
    database: DatabaseHealth;
    mcp: McpHealth;
    webhooks: WebhookHealth;
    alerts: AlertEntry[];
}

const defaultHealth: HealthData = {
    database: { pool: { active: 0, max: 0 }, latency: { p50: 0, p99: 0 } },
    mcp: { uptime: '—', connectedAgents: 0, requestsPerMin: 0 },
    webhooks: { successRate: 0, pendingQueue: 0, failedDeliveries: 0 },
    alerts: [],
};

function computeDbStatus(db: DatabaseHealth): StatusLevel {
    const utilization = db.pool.max > 0 ? db.pool.active / db.pool.max : 0;
    if (utilization > 0.9 || db.latency.p99 > 100) return 'critical';
    if (utilization > 0.7 || db.latency.p99 > 50) return 'degraded';
    return 'healthy';
}

function computeMcpStatus(mcp: McpHealth): StatusLevel {
    if (mcp.connectedAgents === 0) return 'critical';
    if (mcp.requestsPerMin === 0) return 'degraded';
    return 'healthy';
}

function computeWebhookStatus(wh: WebhookHealth): StatusLevel {
    if (wh.successRate < 90) return 'critical';
    if (wh.successRate < 98 || wh.failedDeliveries > 5) return 'degraded';
    return 'healthy';
}

function failedSeverity(count: number): Severity {
    if (count > 10) return 'critical';
    if (count > 0) return 'warning';
    return 'normal';
}

const alertIcon = {
    critical: AlertCircle,
    warning: AlertTriangle,
    info: Info,
} as const;

const alertColor = {
    critical: 'text-error',
    warning: 'text-warning',
    info: 'text-info',
} as const;

export default function HealthPage() {
    const [health, setHealth] = useState<HealthData>(defaultHealth);
    const [loading, setLoading] = useState(true);
    const [lastUpdated, setLastUpdated] = useState<string>('');
    const [refreshing, setRefreshing] = useState(false);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const fetchHealth = useCallback(async (isManual = false) => {
        if (isManual) setRefreshing(true);
        try {
            const res = await apiClient.get<HealthData>('/api/health');
            setHealth(res.data);
        } catch {
            // Retain last-good data on error
        } finally {
            setLastUpdated(new Date().toLocaleTimeString());
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchHealth();
        intervalRef.current = setInterval(() => fetchHealth(), REFRESH_INTERVAL);
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [fetchHealth]);

    const { database, mcp, webhooks, alerts } = health;

    return (
        <div className="p-6 space-y-6">
            <div className="flex items-center justify-between">
                <h1 className="text-2xl font-bold">System Health</h1>
                <div className="flex items-center gap-3">
                    {lastUpdated && (
                        <span className="text-sm text-muted">
                            Last updated: {lastUpdated}
                        </span>
                    )}
                    <button
                        onClick={() => fetchHealth(true)}
                        disabled={refreshing}
                        className="flex items-center gap-2 px-3 py-2 text-sm font-medium rounded-lg bg-primary text-inverse hover:bg-primary-hover focus-ring transition-colors disabled:opacity-50"
                        aria-label="Refresh health data"
                    >
                        <RefreshCw
                            size={16}
                            aria-hidden="true"
                            className={refreshing ? 'animate-spin' : ''}
                        />
                        Refresh
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Database Panel */}
                <HealthPanel title="Database" status={loading ? 'unknown' : computeDbStatus(database)}>
                    <MetricCard
                        label="Connection Pool"
                        value={`${database.pool.active}/${database.pool.max}`}
                        unit="active"
                        loading={loading}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <MetricCard
                            label="P50 Latency"
                            value={database.latency.p50}
                            unit="ms"
                            trend={database.latencyTrend ? { direction: 'down', value: database.latencyTrend.p50 } : undefined}
                            loading={loading}
                        />
                        <MetricCard
                            label="P99 Latency"
                            value={database.latency.p99}
                            unit="ms"
                            trend={database.latencyTrend ? { direction: 'up', value: database.latencyTrend.p99 } : undefined}
                            loading={loading}
                        />
                    </div>
                </HealthPanel>

                {/* MCP Server Panel */}
                <HealthPanel title="MCP Server" status={loading ? 'unknown' : computeMcpStatus(mcp)}>
                    <MetricCard
                        label="Uptime"
                        value={mcp.uptime}
                        loading={loading}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <MetricCard
                            label="Connected Agents"
                            value={mcp.connectedAgents}
                            trend={mcp.agentTrend ? { direction: 'up', value: mcp.agentTrend } : undefined}
                            loading={loading}
                        />
                        <MetricCard
                            label="Requests/min"
                            value={mcp.requestsPerMin}
                            trend={mcp.requestTrend ? { direction: 'up', value: mcp.requestTrend } : undefined}
                            loading={loading}
                        />
                    </div>
                </HealthPanel>

                {/* Webhooks Panel */}
                <HealthPanel title="Webhooks" status={loading ? 'unknown' : computeWebhookStatus(webhooks)}>
                    <MetricCard
                        label="Success Rate"
                        value={webhooks.successRate}
                        unit="%"
                        loading={loading}
                    />
                    <div className="grid grid-cols-2 gap-2">
                        <MetricCard
                            label="Pending Queue"
                            value={webhooks.pendingQueue}
                            loading={loading}
                        />
                        <MetricCard
                            label="Failed Deliveries"
                            value={webhooks.failedDeliveries}
                            severity={failedSeverity(webhooks.failedDeliveries)}
                            loading={loading}
                        />
                    </div>
                </HealthPanel>

                {/* Alerts Panel */}
                <HealthPanel title="Alerts" badge={{ count: alerts.length }}>
                    {loading ? (
                        <div className="animate-pulse space-y-2">
                            <div className="h-10 bg-surface-alt rounded" />
                            <div className="h-10 bg-surface-alt rounded" />
                        </div>
                    ) : alerts.length === 0 ? (
                        <p className="text-sm text-muted py-4 text-center" role="status">
                            No active alerts
                        </p>
                    ) : (
                        <ul className="space-y-2" aria-label="Recent alerts">
                            {alerts.map((alert) => {
                                const Icon = alertIcon[alert.severity];
                                return (
                                    <li
                                        key={alert.id}
                                        className="flex items-start gap-2 bg-surface-alt border border-border rounded-lg p-3"
                                        role="listitem"
                                    >
                                        <Icon
                                            size={16}
                                            className={`shrink-0 mt-0.5 ${alertColor[alert.severity]}`}
                                            aria-hidden="true"
                                        />
                                        <div className="min-w-0 flex-1">
                                            <p className="text-sm font-medium truncate">{alert.message}</p>
                                            <p className="text-xs text-muted">{alert.timestamp}</p>
                                        </div>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </HealthPanel>
            </div>
        </div>
    );
}
