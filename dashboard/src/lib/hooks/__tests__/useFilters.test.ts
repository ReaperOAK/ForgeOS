import { parseFromUrl, encodeToUrl, DEFAULT_FILTERS } from '@/lib/hooks/useFilters';
import type { FilterState } from '@/lib/hooks/useFilters';

describe('parseFromUrl', () => {
  it('returns defaults for empty params', () => {
    const params = new URLSearchParams();
    expect(parseFromUrl(params)).toEqual(DEFAULT_FILTERS);
  });

  it('parses comma-separated stage values', () => {
    const params = new URLSearchParams('stage=READY,QA');
    const result = parseFromUrl(params);
    expect(result.stage).toEqual(['READY', 'QA']);
  });

  it('parses sort field', () => {
    const params = new URLSearchParams('sort=created_at');
    expect(parseFromUrl(params).sort).toBe('created_at');
  });

  it('ignores invalid sort field', () => {
    const params = new URLSearchParams('sort=invalid');
    expect(parseFromUrl(params).sort).toBe('priority');
  });

  it('parses sortDir', () => {
    const params = new URLSearchParams('sortDir=asc');
    expect(parseFromUrl(params).sortDir).toBe('asc');
  });

  it('ignores invalid sortDir', () => {
    const params = new URLSearchParams('sortDir=sideways');
    expect(parseFromUrl(params).sortDir).toBe('desc');
  });

  it('parses multiple filter groups simultaneously', () => {
    const params = new URLSearchParams(
      'stage=BACKEND&type=frontend&priority=high,medium',
    );
    const result = parseFromUrl(params);
    expect(result.stage).toEqual(['BACKEND']);
    expect(result.type).toEqual(['frontend']);
    expect(result.priority).toEqual(['high', 'medium']);
  });
});

describe('encodeToUrl', () => {
  it('returns empty string for defaults', () => {
    expect(encodeToUrl(DEFAULT_FILTERS)).toBe('');
  });

  it('encodes stage filters', () => {
    const state: FilterState = { ...DEFAULT_FILTERS, stage: ['READY', 'QA'] };
    expect(encodeToUrl(state)).toContain('stage=READY%2CQA');
  });

  it('encodes sort when non-default', () => {
    const state: FilterState = { ...DEFAULT_FILTERS, sort: 'updated_at' };
    expect(encodeToUrl(state)).toContain('sort=updated_at');
  });

  it('does not encode sort when default', () => {
    const state: FilterState = { ...DEFAULT_FILTERS, sort: 'priority' };
    expect(encodeToUrl(state)).not.toContain('sort=');
  });

  it('encodes sortDir when non-default', () => {
    const state: FilterState = { ...DEFAULT_FILTERS, sortDir: 'asc' };
    expect(encodeToUrl(state)).toContain('sortDir=asc');
  });

  it('round-trips through parse/encode', () => {
    const state: FilterState = {
      ...DEFAULT_FILTERS,
      stage: ['READY'],
      type: ['backend'],
      sort: 'created_at',
      sortDir: 'asc',
    };
    const encoded = encodeToUrl(state);
    const params = new URLSearchParams(encoded);
    const parsed = parseFromUrl(params);
    expect(parsed).toEqual(state);
  });
});

// --- Hook integration tests ------------------------------------------------

import { renderHook, act } from '@testing-library/react';
import { useFilters } from '@/lib/hooks/useFilters';

const mockReplace = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  usePathname: () => '/pipeline',
  useSearchParams: () => mockSearchParams,
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSearchParams = new URLSearchParams();
});

describe('useFilters hook', () => {
  it('returns default filters when URL has no params', () => {
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters).toEqual(DEFAULT_FILTERS);
    expect(result.current.hasActiveFilters).toBe(false);
    expect(result.current.activeFilterCount).toBe(0);
  });

  it('parses initial filters from URL', () => {
    mockSearchParams = new URLSearchParams('stage=READY,QA&sort=created_at');
    const { result } = renderHook(() => useFilters());
    expect(result.current.filters.stage).toEqual(['READY', 'QA']);
    expect(result.current.filters.sort).toBe('created_at');
    expect(result.current.activeFilterCount).toBe(2);
  });

  it('toggleFilter adds a filter and updates URL', () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.toggleFilter('stage', 'READY');
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const url = mockReplace.mock.calls[0][0] as string;
    expect(url).toContain('stage=READY');
  });

  it('toggleFilter removes an existing filter', () => {
    mockSearchParams = new URLSearchParams('stage=READY,QA');
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.toggleFilter('stage', 'READY');
    });
    const url = mockReplace.mock.calls[0][0] as string;
    expect(url).toContain('stage=QA');
    expect(url).not.toContain('READY');
  });

  it('setSort updates sort field in URL', () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.setSort('updated_at');
    });
    const url = mockReplace.mock.calls[0][0] as string;
    expect(url).toContain('sort=updated_at');
  });

  it('setSortDir updates sort direction in URL', () => {
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.setSortDir('asc');
    });
    const url = mockReplace.mock.calls[0][0] as string;
    expect(url).toContain('sortDir=asc');
  });

  it('clearAll resets URL to defaults', () => {
    mockSearchParams = new URLSearchParams('stage=READY&type=backend');
    const { result } = renderHook(() => useFilters());
    act(() => {
      result.current.clearAll();
    });
    const url = mockReplace.mock.calls[0][0] as string;
    expect(url).toBe('/pipeline');
  });

  it('hasActiveFilters is true when filters exist', () => {
    mockSearchParams = new URLSearchParams('priority=high');
    const { result } = renderHook(() => useFilters());
    expect(result.current.hasActiveFilters).toBe(true);
    expect(result.current.activeFilterCount).toBe(1);
  });

  it('provides all required functions', () => {
    const { result } = renderHook(() => useFilters());
    expect(typeof result.current.toggleFilter).toBe('function');
    expect(typeof result.current.setSort).toBe('function');
    expect(typeof result.current.setSortDir).toBe('function');
    expect(typeof result.current.clearAll).toBe('function');
  });
});
