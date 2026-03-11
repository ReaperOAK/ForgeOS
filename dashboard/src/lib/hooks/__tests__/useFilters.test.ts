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
