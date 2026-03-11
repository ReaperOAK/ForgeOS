'use client';

/** Direction of a metric's recent change. */
export type TrendDirection = 'up' | 'down' | 'flat';

/** Visual severity level applied to a metric value. */
export type Severity = 'normal' | 'warning' | 'critical';

/** Props for {@link MetricCard}. */
interface MetricCardProps {
  /** Human-readable metric name shown above the value. */
  label: string;
  /** Current numeric or string value to display. */
  value: string | number;
  /** Optional unit suffix (e.g. "ms", "%"). */
  unit?: string;
  /** Trend arrow with direction and descriptive text (e.g. "+12%"). */
  trend?: { direction: TrendDirection; value: string };
  /** Applies a colored left border and tints the value text. */
  severity?: Severity;
  /** Renders a skeleton placeholder when `true`. */
  loading?: boolean;
}

const severityBorder: Record<Severity, string> = {
  normal: '',
  warning: 'border-l-[3px] border-l-warning',
  critical: 'border-l-[3px] border-l-error',
};

const severityValueColor: Record<Severity, string> = {
  normal: 'text-foreground',
  warning: 'text-warning',
  critical: 'text-error',
};

const trendIcon: Record<TrendDirection, string> = {
  up: '↑',
  down: '↓',
  flat: '→',
};

const trendColor: Record<TrendDirection, string> = {
  up: 'text-success',
  down: 'text-error',
  flat: 'text-muted',
};

/**
 * Displays a single metric with its label, value, optional unit,
 * trend indicator, and severity styling.
 *
 * Shows a skeleton loader when `loading` is `true`. Uses
 * `role="status"` for accessibility.
 *
 * @example
 * ```tsx
 * <MetricCard label="P99 Latency" value={42} unit="ms" />
 * <MetricCard label="Failures" value={3} severity="warning" />
 * ```
 */
export function MetricCard({
  label,
  value,
  unit,
  trend,
  severity = 'normal',
  loading = false,
}: MetricCardProps) {
  if (loading) {
    return (
      <div
        className="bg-surface-alt border border-border rounded-lg p-4"
        role="status"
        aria-label={`${label}: loading`}
      >
        <div className="animate-pulse space-y-3">
          <div className="h-3.5 bg-surface rounded w-1/2" />
          <div className="h-6 bg-surface rounded w-3/4" />
        </div>
      </div>
    );
  }

  const displayValue = value === '' || value === null || value === undefined ? '—' : value;

  return (
    <div
      className={`bg-surface-alt border border-border rounded-lg p-4 min-w-0 ${severityBorder[severity]}`}
      role="status"
      aria-label={`${label}: ${displayValue}${unit ? ` ${unit}` : ''}`}
    >
      <p className="text-sm font-medium text-muted mb-1 truncate">{label}</p>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold font-mono ${severityValueColor[severity]}`}>
          {displayValue}
        </span>
        {unit && (
          <span className="text-sm text-muted">{unit}</span>
        )}
      </div>
      {trend && (
        <p
          className={`text-xs font-mono mt-1 ${trendColor[trend.direction]}`}
          aria-label={`Change: ${trend.direction} ${trend.value}`}
        >
          {trendIcon[trend.direction]} {trend.value}
        </p>
      )}
    </div>
  );
}
