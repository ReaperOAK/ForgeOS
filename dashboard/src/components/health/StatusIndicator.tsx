'use client';

/** Traffic-light status level for system health indicators. */
export type StatusLevel = 'healthy' | 'degraded' | 'critical' | 'unknown';

/** Props for {@link StatusIndicator}. */
interface StatusIndicatorProps {
  /** Current health status — drives the dot color. */
  status: StatusLevel;
  /** Override the default human-readable label (e.g. "Healthy"). */
  label?: string;
  /** Dot diameter: `sm` (6 px), `md` (8 px), or `lg` (12 px). */
  size?: 'sm' | 'md' | 'lg';
  /** Adds a pulse-ring animation when `status` is `critical`. */
  pulse?: boolean;
}

const sizeMap = {
  sm: 'h-1.5 w-1.5',
  md: 'h-2 w-2',
  lg: 'h-3 w-3',
} as const;

const colorMap: Record<StatusLevel, string> = {
  healthy: 'bg-success',
  degraded: 'bg-warning',
  critical: 'bg-error',
  unknown: 'bg-muted',
};

const textMap: Record<StatusLevel, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  critical: 'Critical',
  unknown: 'Unknown',
};

/**
 * Colored dot with an optional label indicating system health.
 *
 * Renders green (healthy), yellow (degraded), red (critical), or
 * grey (unknown). Includes `role="status"` and `aria-live="polite"`
 * for assistive technology.
 *
 * @example
 * ```tsx
 * <StatusIndicator status="healthy" size="sm" />
 * <StatusIndicator status="critical" pulse />
 * ```
 */
export function StatusIndicator({
  status,
  label,
  size = 'md',
  pulse = false,
}: StatusIndicatorProps) {
  const displayLabel = label ?? textMap[status];
  const showPulse = pulse && status === 'critical';

  return (
    <span
      role="status"
      aria-live="polite"
      aria-label={`${displayLabel} status: ${status}`}
      className="inline-flex items-center gap-1.5"
    >
      <span
        aria-hidden="true"
        className={`
          ${sizeMap[size]} ${colorMap[status]} rounded-full inline-block shrink-0
          ${showPulse ? 'animate-pulse-ring' : ''}
        `}
        style={showPulse ? {
          animation: 'pulse-ring 1.5s ease infinite',
        } : undefined}
      />
      <span className="text-sm font-medium">{displayLabel}</span>
    </span>
  );
}
