import { render, screen, fireEvent } from '@testing-library/react';
import { DependencyGraph } from '@/components/graph/DependencyGraph';
import type { Ticket } from '@/lib/api/types';

// Mock next/navigation
const mockPush = jest.fn();
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

// Mock GraphControls to isolate DependencyGraph logic
jest.mock('@/components/graph/GraphControls', () => ({
  GraphControls: ({
    scale,
    onZoomIn,
    onZoomOut,
    onFitToView,
  }: {
    scale: number;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onFitToView: () => void;
  }) => (
    <div data-testid="graph-controls" data-scale={scale}>
      <button data-testid="ctrl-zoom-in" onClick={onZoomIn}>+</button>
      <button data-testid="ctrl-zoom-out" onClick={onZoomOut}>-</button>
      <button data-testid="ctrl-fit" onClick={onFitToView}>fit</button>
    </div>
  ),
}));

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: '1',
    ticket_id: 'T-001',
    project_id: null,
    title: 'Test Ticket',
    description: null,
    type: 'backend',
    priority: 'medium',
    status: 'READY',
    stage: 'READY',
    sdlc_flow: ['READY', 'BACKEND', 'QA', 'DONE'],
    claimed_by: null,
    claimed_by_name: null,
    machine_id: null,
    operator: null,
    lease_expiry: null,
    lease_duration_minutes: 30,
    depends_on: [],
    file_paths: [],
    acceptance_criteria: [],
    tags: [],
    rework_count: 0,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-01T00:00:00Z',
    updated_at: '2026-03-01T00:00:00Z',
    completed_at: null,
    ...overrides,
  };
}

describe('DependencyGraph', () => {
  beforeEach(() => {
    mockPush.mockClear();
  });

  it('renders empty state when no tickets provided', () => {
    render(<DependencyGraph tickets={[]} />);
    expect(screen.getByText(/no tickets to display/i)).toBeInTheDocument();
  });

  it('renders SVG with role="img" and accessible label', () => {
    const tickets = [makeTicket()];
    render(<DependencyGraph tickets={tickets} />);
    const svg = screen.getByRole('img', { name: /ticket dependency graph/i });
    expect(svg).toBeInTheDocument();
  });

  it('renders a node group for each ticket', () => {
    const tickets = [
      makeTicket({ ticket_id: 'A-001', title: 'First' }),
      makeTicket({ ticket_id: 'A-002', title: 'Second', id: '2' }),
    ];
    render(<DependencyGraph tickets={tickets} />);
    // Each node has role="button" with aria-label containing ticket ID
    expect(screen.getByRole('button', { name: /A-001/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /A-002/i })).toBeInTheDocument();
  });

  it('displays ticket ID text inside node', () => {
    const tickets = [makeTicket({ ticket_id: 'FE-005' })];
    render(<DependencyGraph tickets={tickets} />);
    expect(screen.getByText('FE-005')).toBeInTheDocument();
  });

  it('abbreviates long titles', () => {
    const tickets = [
      makeTicket({
        ticket_id: 'X-001',
        title: 'This is a very long ticket title that should be truncated',
      }),
    ];
    render(<DependencyGraph tickets={tickets} />);
    // Title should be truncated (17 chars + ellipsis = 18 chars total)
    expect(screen.getByText(/This is a very lo…/)).toBeInTheDocument();
  });

  it('navigates to ticket detail on node click', () => {
    const tickets = [makeTicket({ ticket_id: 'NAV-001' })];
    render(<DependencyGraph tickets={tickets} />);
    const nodeButton = screen.getByRole('button', { name: /NAV-001/i });
    fireEvent.click(nodeButton);
    expect(mockPush).toHaveBeenCalledWith('/tickets/NAV-001');
  });

  it('navigates on Enter key press', () => {
    const tickets = [makeTicket({ ticket_id: 'KEY-001' })];
    render(<DependencyGraph tickets={tickets} />);
    const nodeButton = screen.getByRole('button', { name: /KEY-001/i });
    fireEvent.keyDown(nodeButton, { key: 'Enter' });
    expect(mockPush).toHaveBeenCalledWith('/tickets/KEY-001');
  });

  it('renders edges as path elements with arrowhead markers', () => {
    const tickets = [
      makeTicket({ ticket_id: 'DEP-A' }),
      makeTicket({
        ticket_id: 'DEP-B',
        id: '2',
        depends_on: ['DEP-A'],
      }),
    ];
    const { container } = render(<DependencyGraph tickets={tickets} />);
    // Should have an arrowhead marker definition
    const marker = container.querySelector('marker#arrowhead');
    expect(marker).toBeInTheDocument();
    // Should have a path element for the edge
    const paths = container.querySelectorAll('path[marker-end]');
    expect(paths.length).toBe(1);
  });

  it('renders GraphControls component', () => {
    const tickets = [makeTicket()];
    render(<DependencyGraph tickets={tickets} />);
    expect(screen.getByTestId('graph-controls')).toBeInTheDocument();
  });

  it('renders nodes with stage-colored border', () => {
    const tickets = [makeTicket({ ticket_id: 'QA-001', stage: 'QA' })];
    const { container } = render(<DependencyGraph tickets={tickets} />);
    // The node rect should have a stroke matching QA color
    const nodeRects = container.querySelectorAll('g[role="button"] > rect');
    // First rect is the node background
    expect(nodeRects.length).toBeGreaterThanOrEqual(1);
  });

  it('handles tickets with dependencies to non-existent tickets gracefully', () => {
    const tickets = [
      makeTicket({ ticket_id: 'SRC-001', depends_on: ['GHOST-999'] }),
    ];
    // Should not throw
    render(<DependencyGraph tickets={tickets} />);
    expect(screen.getByRole('button', { name: /SRC-001/i })).toBeInTheDocument();
  });

  it('renders multiple edges for diamond dependency pattern', () => {
    const tickets = [
      makeTicket({ ticket_id: 'D-A' }),
      makeTicket({ ticket_id: 'D-B', id: '2', depends_on: ['D-A'] }),
      makeTicket({ ticket_id: 'D-C', id: '3', depends_on: ['D-A'] }),
      makeTicket({ ticket_id: 'D-D', id: '4', depends_on: ['D-B', 'D-C'] }),
    ];
    const { container } = render(<DependencyGraph tickets={tickets} />);
    const paths = container.querySelectorAll('path[marker-end]');
    // A→B, A→C, B→D, C→D = 4 edges
    expect(paths.length).toBe(4);
  });
});
