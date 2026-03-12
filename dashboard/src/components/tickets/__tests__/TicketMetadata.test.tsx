import { render, screen, within } from '@testing-library/react';
import { TicketMetadata } from '@/components/tickets/TicketMetadata';
import type { TicketDetail } from '@/lib/api';

const baseTicket: TicketDetail = {
    id: 'uuid-1',
    ticket_id: 'FORGEOS-FE004',
    project_id: null,
    title: 'Implement Ticket Detail View',
    description: 'Build the ticket detail page with metadata, history, and dependencies.',
    type: 'frontend',
    priority: 'critical',
    status: 'CLAIMED',
    stage: 'QA',
    sdlc_flow: ['READY', 'FRONTEND', 'QA', 'SECURITY', 'DONE'],
    claimed_by: 'agent-1',
    claimed_by_name: 'FrontendEngineer',
    machine_id: 'pop-os',
    operator: 'Ticketer',
    lease_expiry: '2026-03-11T15:30:00Z',
    lease_duration_minutes: 30,
    depends_on: ['FORGEOS-FE002'],
    file_paths: [
        'dashboard/src/app/tickets/[id]/page.tsx',
        'dashboard/src/components/tickets/TicketMetadata.tsx',
    ],
    acceptance_criteria: [
        'Ticket detail page loads ticket data by ID',
        'TicketMetadata panel displays all fields',
    ],
    tags: ['dashboard', 'frontend'],
    rework_count: 1,
    max_reworks: 3,
    metadata: {},
    parent_id: null,
    source_task_file: null,
    created_at: '2026-03-05T18:00:00Z',
    updated_at: '2026-03-11T14:00:00Z',
    completed_at: null,
    dependency_status: [
        { ticket_id: 'FORGEOS-FE002', title: 'Pipeline Board', status: 'DONE', is_resolved: true },
    ],
};

describe('TicketMetadata', () => {
    it('renders ticket ID in monospace', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        const idEl = screen.getByText('FORGEOS-FE004');
        expect(idEl).toBeInTheDocument();
        expect(idEl.className).toContain('font-mono');
    });

    it('renders ticket title as heading', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByRole('heading', { level: 1, name: /Implement Ticket Detail View/ }))
            .toBeInTheDocument();
    });

    it('renders priority badge with correct label', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        const badge = screen.getByText('critical');
        expect(badge).toBeInTheDocument();
        expect(badge.className).toContain('bg-error');
    });

    it('renders status badge', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByText('CLAIMED')).toBeInTheDocument();
    });

    it('renders description text', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByText(/Build the ticket detail page/)).toBeInTheDocument();
    });

    it('displays type field capitalized', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        const typeField = screen.getByText('Type').closest('div')!;
        expect(within(typeField).getByText('frontend')).toBeInTheDocument();
    });

    it('displays stage in monospace', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        const stage = screen.getByText('QA');
        expect(stage.className).toContain('font-mono');
    });

    it('displays claimed_by_name when available', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByText('FrontendEngineer')).toBeInTheDocument();
    });

    it('displays machine_id', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByText('pop-os')).toBeInTheDocument();
    });

    it('displays operator', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByText('Ticketer')).toBeInTheDocument();
    });

    it('formats lease_expiry as timestamp', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        // formatTimestamp uses toLocaleString — just verify it's not "—"
        const field = screen.getByText('Lease Expiry').closest('div')!;
        const dd = within(field).getByRole('definition');
        expect(dd.textContent).not.toBe('—');
    });

    it('displays rework count / max', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByText('1 / 3')).toBeInTheDocument();
    });

    it('renders acceptance criteria as a list', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        const list = screen.getByRole('list', { name: /Acceptance criteria checklist/ });
        const items = within(list).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        expect(items[0]).toHaveTextContent('Ticket detail page loads ticket data by ID');
        expect(items[1]).toHaveTextContent('TicketMetadata panel displays all fields');
    });

    it('renders file paths with monospace font', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        const fileList = screen.getByRole('list', { name: /File paths/ });
        const items = within(fileList).getAllByRole('listitem');
        expect(items).toHaveLength(2);
        items.forEach((item) => {
            expect(item.className).toContain('font-mono');
        });
    });

    it('renders tags as pills', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByText('dashboard')).toBeInTheDocument();
        // 'frontend' appears in both type field and tags — verify at least 2 elements
        const allFrontend = screen.getAllByText('frontend');
        expect(allFrontend.length).toBeGreaterThanOrEqual(2);
    });

    it('shows em-dash when claimed_by is null', () => {
        const ticket = { ...baseTicket, claimed_by: null, claimed_by_name: null };
        render(<TicketMetadata ticket={ticket} />);
        const field = screen.getByText('Claimed By').closest('div')!;
        const dd = within(field).getByRole('definition');
        expect(dd.textContent).toBe('—');
    });

    it('shows em-dash when machine_id is null', () => {
        const ticket = { ...baseTicket, machine_id: null };
        render(<TicketMetadata ticket={ticket} />);
        const field = screen.getByText('Machine').closest('div')!;
        const dd = within(field).getByRole('definition');
        expect(dd.textContent).toBe('—');
    });

    it('shows em-dash when lease_expiry is null', () => {
        const ticket = { ...baseTicket, lease_expiry: null };
        render(<TicketMetadata ticket={ticket} />);
        const field = screen.getByText('Lease Expiry').closest('div')!;
        const dd = within(field).getByRole('definition');
        expect(dd.textContent).toBe('—');
    });

    it('hides acceptance criteria section when empty', () => {
        const ticket = { ...baseTicket, acceptance_criteria: [] };
        render(<TicketMetadata ticket={ticket} />);
        expect(screen.queryByText('Acceptance Criteria')).not.toBeInTheDocument();
    });

    it('hides file paths section when empty', () => {
        const ticket = { ...baseTicket, file_paths: [] };
        render(<TicketMetadata ticket={ticket} />);
        expect(screen.queryByRole('list', { name: /File paths/ })).not.toBeInTheDocument();
    });

    it('hides tags section when empty', () => {
        const ticket = { ...baseTicket, tags: [] };
        render(<TicketMetadata ticket={ticket} />);
        expect(screen.queryByText('dashboard')).not.toBeInTheDocument();
    });

    it('renders section with appropriate aria-label', () => {
        render(<TicketMetadata ticket={baseTicket} />);
        expect(screen.getByLabelText('Ticket metadata')).toBeInTheDocument();
    });

    it('renders high priority with warning color', () => {
        const ticket = { ...baseTicket, priority: 'high' as const };
        render(<TicketMetadata ticket={ticket} />);
        const badge = screen.getByText('high');
        expect(badge.className).toContain('bg-warning');
    });

    it('renders medium priority with info color', () => {
        const ticket = { ...baseTicket, priority: 'medium' as const };
        render(<TicketMetadata ticket={ticket} />);
        const badge = screen.getByText('medium');
        expect(badge.className).toContain('bg-info');
    });

    it('renders DONE status with success color', () => {
        const ticket = { ...baseTicket, status: 'DONE' as const };
        render(<TicketMetadata ticket={ticket} />);
        const badge = screen.getByText('DONE');
        expect(badge.className).toContain('bg-success');
    });

    it('omits description when null', () => {
        const ticket = { ...baseTicket, description: null };
        render(<TicketMetadata ticket={ticket} />);
        expect(screen.queryByText(/Build the ticket detail page/)).not.toBeInTheDocument();
    });
});
