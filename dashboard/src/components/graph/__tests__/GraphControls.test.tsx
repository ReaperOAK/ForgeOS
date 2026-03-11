import { render, screen } from '@testing-library/react';
import { GraphControls } from '@/components/graph/GraphControls';
import userEvent from '@testing-library/user-event';

describe('GraphControls', () => {
  const defaultProps = {
    scale: 1,
    onZoomIn: jest.fn(),
    onZoomOut: jest.fn(),
    onFitToView: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders zoom in, zoom out, and fit-to-view buttons', () => {
    render(<GraphControls {...defaultProps} />);
    expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /zoom out/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fit to view/i })).toBeInTheDocument();
  });

  it('displays current scale as percentage', () => {
    render(<GraphControls {...defaultProps} scale={0.75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('displays 100% at scale 1', () => {
    render(<GraphControls {...defaultProps} scale={1} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('displays 200% at scale 2', () => {
    render(<GraphControls {...defaultProps} scale={2} />);
    expect(screen.getByText('200%')).toBeInTheDocument();
  });

  it('calls onZoomIn when zoom in button is clicked', async () => {
    const user = userEvent.setup();
    render(<GraphControls {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /zoom in/i }));
    expect(defaultProps.onZoomIn).toHaveBeenCalledTimes(1);
  });

  it('calls onZoomOut when zoom out button is clicked', async () => {
    const user = userEvent.setup();
    render(<GraphControls {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /zoom out/i }));
    expect(defaultProps.onZoomOut).toHaveBeenCalledTimes(1);
  });

  it('calls onFitToView when fit button is clicked', async () => {
    const user = userEvent.setup();
    render(<GraphControls {...defaultProps} />);
    await user.click(screen.getByRole('button', { name: /fit to view/i }));
    expect(defaultProps.onFitToView).toHaveBeenCalledTimes(1);
  });

  it('renders a toolbar with accessible label', () => {
    render(<GraphControls {...defaultProps} />);
    expect(screen.getByRole('toolbar', { name: /graph controls/i })).toBeInTheDocument();
  });
});
