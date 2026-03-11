'use client';

import { X, SlidersHorizontal, ArrowUpDown } from 'lucide-react';
import { FilterChip } from './FilterChip';
import type {
  FilterState,
  SortField,
  UseFiltersResult,
} from '@/lib/hooks/useFilters';
import type { TicketStage, TicketType, TicketPriority } from '@/lib/api/types';

export interface FilterBarProps {
  filters: UseFiltersResult;
  /** Available values extracted from the current ticket set. */
  availableOperators?: string[];
  availableMachines?: string[];
  availableAgents?: string[];
}

const STAGES: { value: TicketStage; label: string }[] = [
  { value: 'READY', label: 'Ready' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'ARCHITECT', label: 'Architect' },
  { value: 'BACKEND', label: 'Backend' },
  { value: 'FRONTEND', label: 'Frontend' },
  { value: 'QA', label: 'QA' },
  { value: 'SECURITY', label: 'Security' },
  { value: 'CI', label: 'CI' },
  { value: 'DOCUMENTATION', label: 'Docs' },
  { value: 'VALIDATOR', label: 'Validation' },
  { value: 'DONE', label: 'Done' },
];

const TYPES: { value: TicketType; label: string }[] = [
  { value: 'backend', label: 'Backend' },
  { value: 'frontend', label: 'Frontend' },
  { value: 'fullstack', label: 'Fullstack' },
  { value: 'infra', label: 'Infra' },
  { value: 'security', label: 'Security' },
  { value: 'docs', label: 'Docs' },
  { value: 'research', label: 'Research' },
  { value: 'architecture', label: 'Architecture' },
  { value: 'product', label: 'Product' },
  { value: 'design', label: 'Design' },
];

const PRIORITIES: { value: TicketPriority; label: string }[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'priority', label: 'Priority' },
  { value: 'created_at', label: 'Created Date' },
  { value: 'updated_at', label: 'Last Updated' },
  { value: 'ticket_id', label: 'Ticket ID' },
];

/**
 * Filter bar with chip-based filters and sort controls for the pipeline view.
 *
 * Renders groups for stage, type, priority, and dynamic values (operator,
 * machine, agent). Includes a sort dropdown and a clear-all button.
 */
export function FilterBar({
  filters,
  availableOperators = [],
  availableMachines = [],
  availableAgents = [],
}: FilterBarProps) {
  const {
    filters: state,
    toggleFilter,
    setSort,
    clearAll,
    hasActiveFilters,
    activeFilterCount,
  } = filters;

  return (
    <div
      className="bg-surface border border-border rounded-lg p-3 space-y-3"
      role="toolbar"
      aria-label="Ticket filters"
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <SlidersHorizontal size={14} className="text-muted" aria-hidden="true" />
          <span className="text-sm font-medium text-secondary">Filters</span>
          {activeFilterCount > 0 && (
            <span className="text-xs px-1.5 py-0.5 rounded-full bg-primary text-inverse font-medium">
              {activeFilterCount}
            </span>
          )}
        </div>
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="flex items-center gap-1 text-xs text-muted hover:text-foreground transition-colors focus-ring px-2 py-1 rounded"
            aria-label="Clear all filters"
          >
            <X size={12} aria-hidden="true" />
            Clear all
          </button>
        )}
      </div>

      {/* Filter groups */}
      <div className="space-y-2">
        <FilterGroup
          label="Stage"
          options={STAGES}
          activeValues={state.stage}
          onToggle={(v) => toggleFilter('stage', v)}
        />
        <FilterGroup
          label="Type"
          options={TYPES}
          activeValues={state.type}
          onToggle={(v) => toggleFilter('type', v)}
        />
        <FilterGroup
          label="Priority"
          options={PRIORITIES}
          activeValues={state.priority}
          onToggle={(v) => toggleFilter('priority', v)}
        />
        {availableOperators.length > 0 && (
          <FilterGroup
            label="Operator"
            options={availableOperators.map((o) => ({ value: o, label: o }))}
            activeValues={state.operator}
            onToggle={(v) => toggleFilter('operator', v)}
          />
        )}
        {availableMachines.length > 0 && (
          <FilterGroup
            label="Machine"
            options={availableMachines.map((m) => ({ value: m, label: m }))}
            activeValues={state.machine}
            onToggle={(v) => toggleFilter('machine', v)}
          />
        )}
        {availableAgents.length > 0 && (
          <FilterGroup
            label="Agent"
            options={availableAgents.map((a) => ({ value: a, label: a }))}
            activeValues={state.agent}
            onToggle={(v) => toggleFilter('agent', v)}
          />
        )}
      </div>

      {/* Sort dropdown */}
      <div className="flex items-center gap-2 pt-1 border-t border-border">
        <ArrowUpDown size={14} className="text-muted" aria-hidden="true" />
        <label htmlFor="sort-select" className="text-xs text-secondary">
          Sort by:
        </label>
        <select
          id="sort-select"
          value={state.sort}
          onChange={(e) => setSort(e.target.value as SortField)}
          className="text-xs bg-surface border border-border rounded px-2 py-1 focus-ring"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** Internal grouped set of filter chips. */
function FilterGroup({
  label,
  options,
  activeValues,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string }[];
  activeValues: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <div>
      <span className="text-[10px] uppercase tracking-wider text-muted font-semibold">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5 mt-1" role="listbox" aria-label={`${label} filter`}>
        {options.map((opt) => (
          <FilterChip
            key={opt.value}
            label={opt.label}
            active={activeValues.includes(opt.value)}
            onClick={() => onToggle(opt.value)}
          />
        ))}
      </div>
    </div>
  );
}
