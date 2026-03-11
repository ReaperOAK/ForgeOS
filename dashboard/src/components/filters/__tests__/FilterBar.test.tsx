import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterBar } from '@/components/filters/FilterBar';
import type { UseFiltersResult, FilterState } from '@/lib/hooks/useFilters';

function makeFiltersResult(overrides: Partial<FilterState> = {}): UseFiltersResult {
  const filters: FilterState = {
    stage: [],
    type: [],
    priority: [],
    operator: [],
    machine: [],
    agent: [],
    sort: 'priority',
    sortDir: 'desc',
    ...overrides,
  };

  return {
    filters,
    toggleFilter: jest.fn(),
    setSort: jest.fn(),
    setSortDir: jest.fn(),
    clearAll: jest.fn(),
    hasActiveFilters: Object.values(overrides).some(
      (v) => Array.isArray(v) && v.length > 0,
    ),
    activeFilterCount: Object.values(overrides).reduce(
      (sum: number, v) => sum + (Array.isArray(v) ? v.length : 0),
      0,
    ),
  };
}

describe('FilterBar', () => {
  it('renders filter group labels', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    expect(screen.getByText('Stage')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    // "Priority" appears both as a group label and a sort option
    expect(screen.getAllByText('Priority').length).toBeGreaterThanOrEqual(1);
  });

  it('renders stage chips', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('QA')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('highlights active filter chips', () => {
    const result = makeFiltersResult({ priority: ['high'] });
    render(<FilterBar filters={result} />);
    const chip = screen.getByText('High').closest('button');
    expect(chip).toHaveAttribute('aria-selected', 'true');
  });

  it('invokes toggleFilter on chip click', async () => {
    const user = userEvent.setup();
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    // "Fullstack" is unique to the Type group — safe to getByText
    await user.click(screen.getByText('Fullstack'));
    expect(result.toggleFilter).toHaveBeenCalledWith('type', 'fullstack');
  });

  it('shows Clear all button when filters are active', () => {
    const result = makeFiltersResult({ stage: ['READY'] });
    render(<FilterBar filters={result} />);
    expect(screen.getByLabelText('Clear all filters')).toBeInTheDocument();
  });

  it('hides Clear all button when no filters active', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    expect(screen.queryByLabelText('Clear all filters')).not.toBeInTheDocument();
  });

  it('invokes clearAll on Clear button click', async () => {
    const user = userEvent.setup();
    const result = makeFiltersResult({ stage: ['READY'] });
    render(<FilterBar filters={result} />);
    await user.click(screen.getByLabelText('Clear all filters'));
    expect(result.clearAll).toHaveBeenCalledTimes(1);
  });

  it('renders sort dropdown with default value', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    const select = screen.getByLabelText('Sort by:') as HTMLSelectElement;
    expect(select.value).toBe('priority');
  });

  it('invokes setSort on dropdown change', async () => {
    const user = userEvent.setup();
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    await user.selectOptions(screen.getByLabelText('Sort by:'), 'created_at');
    expect(result.setSort).toHaveBeenCalledWith('created_at');
  });

  it('shows badge with active filter count', () => {
    const result = makeFiltersResult({ stage: ['READY', 'QA'], type: ['backend'] });
    render(<FilterBar filters={result} />);
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('renders dynamic operator chips when provided', () => {
    const result = makeFiltersResult();
    render(
      <FilterBar filters={result} availableOperators={['alice', 'bob']} />,
    );
    expect(screen.getByText('Operator')).toBeInTheDocument();
    expect(screen.getByText('alice')).toBeInTheDocument();
    expect(screen.getByText('bob')).toBeInTheDocument();
  });

  it('hides operator group when array is empty', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} availableOperators={[]} />);
    expect(screen.queryByText('Operator')).not.toBeInTheDocument();
  });

  it('has accessible toolbar role', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    expect(screen.getByRole('toolbar')).toHaveAttribute(
      'aria-label',
      'Ticket filters',
    );
  });

  it('renders dynamic machine chips when provided', () => {
    const result = makeFiltersResult();
    render(
      <FilterBar filters={result} availableMachines={['pop-os', 'ubuntu']} />,
    );
    expect(screen.getByText('Machine')).toBeInTheDocument();
    expect(screen.getByText('pop-os')).toBeInTheDocument();
    expect(screen.getByText('ubuntu')).toBeInTheDocument();
  });

  it('hides machine group when array is empty', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} availableMachines={[]} />);
    expect(screen.queryByText('Machine')).not.toBeInTheDocument();
  });

  it('renders dynamic agent chips when provided', () => {
    const result = makeFiltersResult();
    render(
      <FilterBar filters={result} availableAgents={['agent-alpha', 'agent-beta']} />,
    );
    expect(screen.getByText('Agent')).toBeInTheDocument();
    expect(screen.getByText('agent-alpha')).toBeInTheDocument();
    expect(screen.getByText('agent-beta')).toBeInTheDocument();
  });

  it('hides agent group when array is empty', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} availableAgents={[]} />);
    expect(screen.queryByText('Agent')).not.toBeInTheDocument();
  });

  it('toggles operator filter on chip click', async () => {
    const user = userEvent.setup();
    const result = makeFiltersResult();
    render(
      <FilterBar filters={result} availableOperators={['alice']} />,
    );
    await user.click(screen.getByText('alice'));
    expect(result.toggleFilter).toHaveBeenCalledWith('operator', 'alice');
  });

  it('toggles machine filter on chip click', async () => {
    const user = userEvent.setup();
    const result = makeFiltersResult();
    render(
      <FilterBar filters={result} availableMachines={['pop-os']} />,
    );
    await user.click(screen.getByText('pop-os'));
    expect(result.toggleFilter).toHaveBeenCalledWith('machine', 'pop-os');
  });

  it('toggles agent filter on chip click', async () => {
    const user = userEvent.setup();
    const result = makeFiltersResult();
    render(
      <FilterBar filters={result} availableAgents={['agent-alpha']} />,
    );
    await user.click(screen.getByText('agent-alpha'));
    expect(result.toggleFilter).toHaveBeenCalledWith('agent', 'agent-alpha');
  });

  it('renders all sort options in dropdown', () => {
    const result = makeFiltersResult();
    render(<FilterBar filters={result} />);
    const select = screen.getByLabelText('Sort by:') as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(['priority', 'created_at', 'updated_at', 'ticket_id']);
  });
});
