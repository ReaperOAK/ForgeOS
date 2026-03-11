'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, Home, LayoutDashboard, Clock, Users, HeartPulse, Settings } from 'lucide-react';
import { ThemeToggle } from '@/components/ThemeToggle';

interface MobileSidebarProps {
  isOpen: boolean;
  onClose: () => void;
}

const navItems = [
  { label: 'Dashboard', icon: Home, route: '/' },
  { label: 'Pipeline', icon: LayoutDashboard, route: '/pipeline' },
  { label: 'Claims', icon: Clock, route: '/claims' },
  { label: 'Agents', icon: Users, route: '/agents' },
  { label: 'Health', icon: HeartPulse, route: '/health' },
  { label: 'Settings', icon: Settings, route: '/settings' },
];

export function MobileSidebar({ isOpen, onClose }: MobileSidebarProps) {
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    closeRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-overlay md:hidden">
      <div className="absolute inset-0 bg-scrim" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        className="absolute inset-y-0 left-0 w-sidebar-expanded bg-surface border-r border-border flex flex-col animate-slide-in"
      >
        <div className="flex items-center justify-between h-topbar px-4 border-b border-border">
          <span className="font-bold text-lg text-primary">ForgeOS</span>
          <button
            ref={closeRef}
            onClick={onClose}
            className="p-2 rounded-md hover:bg-surface-alt focus-ring"
            aria-label="Close navigation"
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <nav role="navigation" aria-label="Main navigation" className="flex-1 py-4">
          <ul className="space-y-1 px-2">
            {navItems.map(({ label, icon: Icon, route }) => {
              const isActive = pathname === route;
              return (
                <li key={route}>
                  <Link
                    href={route}
                    onClick={onClose}
                    className={`flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium min-h-[44px] ${
                      isActive
                        ? 'bg-primary-muted text-primary'
                        : 'text-muted hover:bg-surface-alt hover:text-foreground'
                    } focus-ring`}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    <Icon size={20} aria-hidden="true" />
                    <span>{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-border p-4">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center text-xs font-bold text-inverse">
              RO
            </div>
            <div>
              <p className="text-sm font-medium">ReaperOAK</p>
              <p className="text-xs text-muted">Operator</p>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </aside>
    </div>
  );
}
