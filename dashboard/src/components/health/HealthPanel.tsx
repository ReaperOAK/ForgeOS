'use client';

import type { ReactNode } from 'react';
import { StatusIndicator, type StatusLevel } from './StatusIndicator';

/** Props for {@link HealthPanel}. */
interface HealthPanelProps {
  /** Panel heading displayed in the header bar. */
  title: string;
  /** Optional health status indicator rendered beside the title. */
  status?: StatusLevel;
  /** Optional alert badge rendered on the right side of the header. */
  badge?: { count: number };
  /** Panel body content — typically {@link MetricCard} components. */
  children: ReactNode;
}

/**
 * Card container for a group of health metrics.
 *
 * Renders a bordered section with a header (title, status dot, badge)
 * and a body slot for child metric cards.
 *
 * @example
 * ```tsx
 * <HealthPanel title="Database" status="healthy">
 *   <MetricCard label="Pool" value="5/20" />
 * </HealthPanel>
 * ```
 */
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
