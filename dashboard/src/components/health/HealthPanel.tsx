'use client';

import type { ReactNode } from 'react';
import { StatusIndicator, type StatusLevel } from './StatusIndicator';

interface HealthPanelProps {
  title: string;
  status?: StatusLevel;
  badge?: { count: number };
  children: ReactNode;
}

export function HealthPanel({ title, status, badge, children }: HealthPanelProps) {
  const titleId = `health-panel-${title.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <section
      role="region"
      aria-labelledby={titleId}
      className="bg-surface border border-border rounded-lg"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
          {status && <StatusIndicator status={status} size="sm" pulse={status === 'critical'} />}
        </div>
        {badge && badge.count > 0 && (
          <span
            className="inline-flex items-center justify-center min-w-[1.5rem] h-6 px-2 text-xs font-semibold rounded-full bg-error text-inverse"
            aria-label={`${badge.count} alert${badge.count !== 1 ? 's' : ''}`}
          >
            {badge.count}
          </span>
        )}
      </div>
      <div className="p-4 space-y-2">
        {children}
      </div>
    </section>
  );
}
