'use client';

export type StatusLevel = 'healthy' | 'degraded' | 'critical' | 'unknown';

interface StatusIndicatorProps {
  status: StatusLevel;
  label?: string;
  size?: 'sm' | 'md' | 'lg';
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
