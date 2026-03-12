'use client';

export interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
}

/**
 * Toggleable chip used inside the FilterBar.
 * Renders as a small pill-shaped button with distinct active/inactive styling.
 */
export function FilterChip({ label, active, onClick }: FilterChipProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full border transition-colors focus-ring ${active
          ? 'bg-primary text-inverse border-primary'
          : 'bg-surface text-secondary border-border hover:bg-surface-alt'
        }`}
    >
      {label}
      {active && (
        <span className="ml-1 text-[10px]" aria-hidden="true">
          ✕
        </span>
      )}
    </button>
  );
}
