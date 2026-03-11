import type { Theme, ConnectionStatus, HealthStatus, BreadcrumbItem, NavItem, HealthCheckResult } from '@/lib/types';

describe('types', () => {
    it('Theme accepts dark and light', () => {
        const dark: Theme = 'dark';
        const light: Theme = 'light';
        expect(dark).toBe('dark');
        expect(light).toBe('light');
    });

    it('ConnectionStatus accepts valid values', () => {
        const statuses: ConnectionStatus[] = ['connected', 'reconnecting', 'disconnected'];
        expect(statuses).toHaveLength(3);
    });

    it('HealthStatus accepts valid values', () => {
        const statuses: HealthStatus[] = ['connected', 'warning', 'error', 'checking'];
        expect(statuses).toHaveLength(4);
    });

    it('BreadcrumbItem can have optional href', () => {
        const withHref: BreadcrumbItem = { label: 'Home', href: '/' };
        const withoutHref: BreadcrumbItem = { label: 'Current' };
        expect(withHref.href).toBe('/');
        expect(withoutHref.href).toBeUndefined();
    });

    it('NavItem has label and route', () => {
        const item: NavItem = { label: 'Dashboard', route: '/' };
        expect(item.label).toBe('Dashboard');
        expect(item.route).toBe('/');
    });

    it('HealthCheckResult has required fields', () => {
        const healthy: HealthCheckResult = { healthy: true, responseTime: 42 };
        const unhealthy: HealthCheckResult = { healthy: false, responseTime: 0, message: 'fail' };
        expect(healthy.healthy).toBe(true);
        expect(unhealthy.message).toBe('fail');
    });
});
