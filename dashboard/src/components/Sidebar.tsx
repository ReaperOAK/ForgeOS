'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
    Home,
    LayoutDashboard,
    Clock,
    Users,
    HeartPulse,
    GitBranch,
    Monitor,
    Settings,
    ChevronLeft,
    ChevronRight,
} from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

interface SidebarProps {
    isCollapsed: boolean;
    onToggleCollapse: () => void;
}

const navItems = [
    { label: 'Dashboard', icon: Home, route: '/' },
    { label: 'Pipeline', icon: LayoutDashboard, route: '/pipeline' },
    { label: 'Graph', icon: GitBranch, route: '/graph' },
    { label: 'Claims', icon: Clock, route: '/claims' },
    { label: 'Agents', icon: Users, route: '/agents' },
    { label: 'Machines', icon: Monitor, route: '/machines' },
    { label: 'Health', icon: HeartPulse, route: '/health' },
    { label: 'Settings', icon: Settings, route: '/settings' },
];

export function Sidebar({ isCollapsed, onToggleCollapse }: SidebarProps) {
    const pathname = usePathname();

    return (
        <aside
            className={`hidden md:flex flex-col bg-surface border-r border-border transition-all duration-normal ${isCollapsed ? 'w-sidebar-collapsed' : 'w-sidebar-expanded'
                }`}
        >
            <div className="flex items-center justify-between h-topbar px-4 border-b border-border">
                {!isCollapsed && (
                    <span className="font-bold text-lg text-primary">ForgeOS</span>
                )}
                <button
                    onClick={onToggleCollapse}
                    className="p-2 rounded-md hover:bg-primary-muted focus-ring"
                    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {isCollapsed ? (
                        <ChevronRight size={18} aria-hidden="true" />
                    ) : (
                        <ChevronLeft size={18} aria-hidden="true" />
                    )}
                </button>
            </div>

            <nav
                role="navigation"
                aria-label="Main navigation"
                className="flex-1 py-4"
            >
                <ul className="space-y-1 px-2">
                    {navItems.map(({ label, icon: Icon, route }) => {
                        const isActive = pathname === route;
                        return (
                            <li key={route}>
                                <Link
                                    href={route}
                                    className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isActive
                                        ? 'bg-primary-muted text-primary'
                                        : 'text-muted hover:bg-surface-alt hover:text-foreground'
                                        } focus-ring`}
                                    aria-current={isActive ? 'page' : undefined}
                                    title={isCollapsed ? label : undefined}
                                >
                                    <Icon size={20} aria-hidden="true" />
                                    {!isCollapsed && <span>{label}</span>}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            <div className="border-t border-border p-4">
                {!isCollapsed && (
                    <div className="flex items-center gap-3 mb-3">
                        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-inverse">
                            RO
                        </div>
                        <div>
                            <p className="text-sm font-medium">ReaperOAK</p>
                            <p className="text-xs text-muted">Operator</p>
                        </div>
                    </div>
                )}
                <ThemeToggle compact={isCollapsed} />
            </div>
        </aside>
    );
}
