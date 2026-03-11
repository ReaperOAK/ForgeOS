import { render, screen, within } from '@testing-library/react';
import { PipelineBoard } from '@/components/pipeline/PipelineBoard';
import type { Ticket } from '@/lib/api/types';

// Mock StageColumn to isolate PipelineBoard
jest.mock('@/components/pipeline/StageColumn', () => ({
    StageColumn: ({
        stage,
        label,
        tickets,
    }: {
        stage: string;
        label: string;
        tickets: Ticket[];
    }) => (
        <div data-testid={`stage-${stage}`} data-label={label}>
            {tickets.map((t) => (
                <span key={t.ticket_id} data-testid={`ticket-${t.ticket_id}`}>
                    {t.ticket_id}
                </span>
            ))}
        </div>
    ),
}));

function makeTicket(overrides: Partial<Ticket> = {}): Ticket {
    return {
        id: '1',
        ticket_id: 'T-001',
        project_id: null,
        title: 'Test',
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

const EXPECTED_STAGES = [
    'READY',
    'RESEARCH',
    'ARCHITECT',
    'BACKEND',
    'FRONTEND',
    'QA',
    'SECURITY',
    'CI',
    'DOCUMENTATION',
    'VALIDATOR',
    'DONE',
];

describe('PipelineBoard', () => {
    it('renders 11 StageColumn components', () => {
        render(<PipelineBoard tickets={[]} isLoading={false} />);
        for (const stage of EXPECTED_STAGES) {
            expect(screen.getByTestId(`stage-${stage}`)).toBeInTheDocument();
        }
    });

    it('renders stages in correct SDLC order', () => {
        render(<PipelineBoard tickets={[]} isLoading={false} />);
        const columns = screen.getAllByTestId(/^stage-/);
        const stageOrder = columns.map((el) =>
            el.getAttribute('data-testid')!.replace('stage-', ''),
        );
        expect(stageOrder).toEqual(EXPECTED_STAGES);
    });

    it('groups tickets by stage', () => {
        const tickets = [
            makeTicket({ ticket_id: 'T-R1', stage: 'READY' }),
            makeTicket({ ticket_id: 'T-R2', stage: 'READY' }),
            makeTicket({ ticket_id: 'T-B1', stage: 'BACKEND' }),
            makeTicket({ ticket_id: 'T-D1', stage: 'DONE' }),
        ];
        render(<PipelineBoard tickets={tickets} isLoading={false} />);

        const readyCol = screen.getByTestId('stage-READY');
        expect(
            within(readyCol).getByTestId('ticket-T-R1'),
        ).toBeInTheDocument();
        expect(
            within(readyCol).getByTestId('ticket-T-R2'),
        ).toBeInTheDocument();

        const backendCol = screen.getByTestId('stage-BACKEND');
        expect(
            within(backendCol).getByTestId('ticket-T-B1'),
        ).toBeInTheDocument();

        const doneCol = screen.getByTestId('stage-DONE');
        expect(
            within(doneCol).getByTestId('ticket-T-D1'),
        ).toBeInTheDocument();

        // QA column should be empty
        const qaCol = screen.getByTestId('stage-QA');
        expect(within(qaCol).queryAllByTestId(/^ticket-/)).toHaveLength(0);
    });

    it('sorts tickets by priority (critical first) within a stage', () => {
        const tickets = [
            makeTicket({
                ticket_id: 'T-LOW',
                stage: 'READY',
                priority: 'low',
                updated_at: '2026-03-10T00:00:00Z',
            }),
            makeTicket({
                ticket_id: 'T-CRIT',
                stage: 'READY',
                priority: 'critical',
                updated_at: '2026-03-01T00:00:00Z',
            }),
            makeTicket({
                ticket_id: 'T-HIGH',
                stage: 'READY',
                priority: 'high',
                updated_at: '2026-03-05T00:00:00Z',
            }),
        ];
        render(<PipelineBoard tickets={tickets} isLoading={false} />);
        const readyCol = screen.getByTestId('stage-READY');
        const cardIds = within(readyCol)
            .getAllByTestId(/^ticket-/)
            .map((el) => el.textContent);
        expect(cardIds).toEqual(['T-CRIT', 'T-HIGH', 'T-LOW']);
    });

    it('shows loading skeleton when isLoading=true', () => {
        render(<PipelineBoard tickets={[]} isLoading={true} />);
        const loadingRegion = screen.getByLabelText('Loading pipeline');
        expect(loadingRegion).toHaveAttribute('aria-busy', 'true');
        // Should render 11 skeleton columns
        const skeletons =
            loadingRegion.querySelectorAll('.animate-pulse');
        expect(skeletons.length).toBe(11);
    });

    it('does not render stage columns when loading', () => {
        render(<PipelineBoard tickets={[]} isLoading={true} />);
        expect(screen.queryByTestId('stage-READY')).not.toBeInTheDocument();
    });

    it('has accessible region label', () => {
        render(<PipelineBoard tickets={[]} isLoading={false} />);
        expect(screen.getByRole('region')).toHaveAttribute(
            'aria-label',
            'Pipeline board',
        );
    });

    it('ignores tickets with unknown stage', () => {
        const tickets = [
            makeTicket({
                ticket_id: 'T-U1',
                stage: 'UNKNOWN_STAGE' as never,
            }),
        ];
        render(<PipelineBoard tickets={tickets} isLoading={false} />);
        // Should not crash and should not display the unknown ticket
        expect(
            screen.queryByTestId('ticket-T-U1'),
        ).not.toBeInTheDocument();
    });
});
