'use client';

import { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from '@/components/Sidebar';
import { TopBar } from '@/components/TopBar';
import { MobileSidebar } from '@/components/MobileSidebar';

const routeLabels: Record<string, string> = {
    '/': 'Overview',
    '/pipeline': 'Pipeline',
    '/claims': 'Claims',
    '/agents': 'Agents',
    '/health': 'Health Check',
    '/settings': 'Settings',
};

export function DashboardShell({ children }: { children: React.ReactNode }) {
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);
    const pathname = usePathname();

    const breadcrumbs =
        pathname === '/'
            ? [
                { label: 'Dashboard', href: '/' },
                { label: 'Overview' },
            ]
            : [
                { label: 'Dashboard', href: '/' },
                { label: routeLabels[pathname] || pathname.slice(1) },
            ];

    const toggleSidebar = useCallback(
        () => setSidebarCollapsed((prev) => !prev),
        [],
    );
    const openMobile = useCallback(() => setMobileOpen(true), []);
    const closeMobile = useCallback(() => setMobileOpen(false), []);

    return (
        <div className="flex h-screen overflow-hidden bg-background">
            <Sidebar isCollapsed={sidebarCollapsed} onToggleCollapse={toggleSidebar} />
            <MobileSidebar isOpen={mobileOpen} onClose={closeMobile} />
            <div className="flex flex-col flex-1 min-w-0">
                <TopBar breadcrumbs={breadcrumbs} onMenuToggle={openMobile} />
                <main className="flex-1 overflow-y-auto p-4 md:p-8">{children}</main>
            </div>
        </div>
    );
}
