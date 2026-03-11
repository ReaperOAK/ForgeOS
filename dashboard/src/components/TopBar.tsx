'use client';

import { Menu, Bell } from 'lucide-react';
import { Breadcrumb } from '@/components/Breadcrumb';
import { SearchBar } from '@/components/search/SearchBar';
import type { BreadcrumbItem } from '@/lib/types';

interface TopBarProps {
    breadcrumbs: BreadcrumbItem[];
    onMenuToggle?: () => void;
}

export function TopBar({ breadcrumbs, onMenuToggle }: TopBarProps) {
    return (
        <header
            role="banner"
            className="h-topbar flex items-center justify-between px-4 bg-surface border-b border-border sticky top-0 z-sticky"
        >
            <div className="flex items-center gap-3">
                <button
                    onClick={onMenuToggle}
                    className="p-2 rounded-md md:hidden hover:bg-surface-alt focus-ring"
                    aria-label="Open navigation menu"
                >
                    <Menu size={20} aria-hidden="true" />
                </button>
                <Breadcrumb items={breadcrumbs} />
            </div>

            <div className="flex items-center gap-2 flex-1 justify-center px-4 hidden sm:flex">
                <SearchBar />
            </div>

            <div className="flex items-center gap-2">
                <button
                    className="p-2 rounded-md hover:bg-surface-alt focus-ring relative"
                    aria-label="Notifications, 0 unread"
                >
                    <Bell size={18} aria-hidden="true" />
                </button>
                <div className="flex items-center gap-2 ml-2" aria-live="polite">
                    <span
                        className="w-2 h-2 rounded-full bg-success"
                        aria-hidden="true"
                    />
                    <span className="text-xs text-muted hidden sm:inline">Live</span>
                </div>
            </div>
        </header>
    );
}
