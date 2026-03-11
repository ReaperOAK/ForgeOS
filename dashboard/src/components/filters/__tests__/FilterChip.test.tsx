import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FilterChip } from '@/components/filters/FilterChip';

describe('FilterChip', () => {
  it('renders label text', () => {
    render(<FilterChip label="Backend" active={false} onClick={jest.fn()} />);
    expect(screen.getByText('Backend')).toBeInTheDocument();
  });

  it('marks active chip with aria-selected', () => {
    render(<FilterChip label="Ready" active={true} onClick={jest.fn()} />);
    const chip = screen.getByRole('option');
    expect(chip).toHaveAttribute('aria-selected', 'true');
  });

  it('marks inactive chip with aria-selected false', () => {
    render(<FilterChip label="Ready" active={false} onClick={jest.fn()} />);
    const chip = screen.getByRole('option');
    expect(chip).toHaveAttribute('aria-selected', 'false');
  });

  it('shows dismiss indicator when active', () => {
    render(<FilterChip label="Ready" active={true} onClick={jest.fn()} />);
    expect(screen.getByText('✕')).toBeInTheDocument();
  });

  it('does not show dismiss indicator when inactive', () => {
    render(<FilterChip label="Ready" active={false} onClick={jest.fn()} />);
    expect(screen.queryByText('✕')).not.toBeInTheDocument();
  });

  it('invokes onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = jest.fn();
    render(<FilterChip label="QA" active={false} onClick={onClick} />);
    await user.click(screen.getByRole('option'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
