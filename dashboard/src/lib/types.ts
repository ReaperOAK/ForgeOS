export type Theme = 'dark' | 'light';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'disconnected';

export type HealthStatus = 'connected' | 'warning' | 'error' | 'checking';

export interface BreadcrumbItem {
    label: string;
    href?: string;
}

export interface NavItem {
    label: string;
    route: string;
}

export interface HealthCheckResult {
    healthy: boolean;
    responseTime: number;
    message?: string;
}
