'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import type { TicketStage, TicketType, TicketPriority } from '@/lib/api/types';

export type SortField = 'priority' | 'created_at' | 'updated_at' | 'ticket_id';
export type SortDirection = 'asc' | 'desc';

export interface FilterState {
  stage: TicketStage[];
  type: TicketType[];
  priority: TicketPriority[];
  operator: string[];
  machine: string[];
  agent: string[];
  sort: SortField;
  sortDir: SortDirection;
}

const DEFAULT_FILTERS: FilterState = {
  stage: [],
  type: [],
  priority: [],
  operator: [],
  machine: [],
  agent: [],
  sort: 'priority',
  sortDir: 'desc',
};

const ARRAY_KEYS: (keyof Pick<FilterState, 'stage' | 'type' | 'priority' | 'operator' | 'machine' | 'agent'>)[] = [
  'stage', 'type', 'priority', 'operator', 'machine', 'agent',
];

/** Parse URL search params into a FilterState. */
function parseFromUrl(searchParams: URLSearchParams): FilterState {
  const state = { ...DEFAULT_FILTERS };

  for (const key of ARRAY_KEYS) {
    const raw = searchParams.get(key);
    if (raw) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state as any)[key] = raw.split(',').filter(Boolean);
    }
  }

  const sort = searchParams.get('sort');
  if (sort && ['priority', 'created_at', 'updated_at', 'ticket_id'].includes(sort)) {
    state.sort = sort as SortField;
  }

  const sortDir = searchParams.get('sortDir');
  if (sortDir === 'asc' || sortDir === 'desc') {
    state.sortDir = sortDir;
  }

  return state;
}

/** Encode FilterState into URL search params string. */
function encodeToUrl(state: FilterState): string {
  const params = new URLSearchParams();

  for (const key of ARRAY_KEYS) {
    if (state[key].length > 0) {
      params.set(key, state[key].join(','));
    }
  }

  if (state.sort !== DEFAULT_FILTERS.sort) {
    params.set('sort', state.sort);
  }

  if (state.sortDir !== DEFAULT_FILTERS.sortDir) {
    params.set('sortDir', state.sortDir);
  }

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export interface UseFiltersResult {
  filters: FilterState;
  toggleFilter: (key: keyof Pick<FilterState, 'stage' | 'type' | 'priority' | 'operator' | 'machine' | 'agent'>, value: string) => void;
  setSort: (field: SortField) => void;
  setSortDir: (dir: SortDirection) => void;
  clearAll: () => void;
  hasActiveFilters: boolean;
  activeFilterCount: number;
}

/**
 * React hook managing ticket filter/sort state synced with URL query params.
 *
 * Reads initial state from the URL on mount, and writes back to the URL
 * on every filter/sort change for bookmarkability.
 */
export function useFilters(): UseFiltersResult {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const filters = useMemo(() => parseFromUrl(searchParams), [searchParams]);

  const updateUrl = useCallback(
    (nextState: FilterState) => {
      const qs = encodeToUrl(nextState);
      router.replace(`${pathname}${qs}`, { scroll: false });
    },
    [router, pathname],
  );

  const toggleFilter = useCallback(
    (key: keyof Pick<FilterState, 'stage' | 'type' | 'priority' | 'operator' | 'machine' | 'agent'>, value: string) => {
      const next = { ...filters };
      const arr = [...next[key]];
      const idx = arr.indexOf(value as never);
      if (idx >= 0) {
        arr.splice(idx, 1);
      } else {
        arr.push(value as never);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (next as any)[key] = arr;
      updateUrl(next);
    },
    [filters, updateUrl],
  );

  const setSort = useCallback(
    (field: SortField) => {
      updateUrl({ ...filters, sort: field });
    },
    [filters, updateUrl],
  );

  const setSortDir = useCallback(
    (dir: SortDirection) => {
      updateUrl({ ...filters, sortDir: dir });
    },
    [filters, updateUrl],
  );

  const clearAll = useCallback(() => {
    updateUrl(DEFAULT_FILTERS);
  }, [updateUrl]);

  const activeFilterCount = ARRAY_KEYS.reduce(
    (sum, key) => sum + filters[key].length,
    0,
  );

  return {
    filters,
    toggleFilter,
    setSort,
    setSortDir,
    clearAll,
    hasActiveFilters: activeFilterCount > 0,
    activeFilterCount,
  };
}

// Export for testing
export { DEFAULT_FILTERS, parseFromUrl, encodeToUrl };
