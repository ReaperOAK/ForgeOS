/**
 * Agent Definition Provider Tests
 *
 * Validates that agent definitions can be loaded from the centralized
 * database storage, supporting Phase 8 repository decoupling.
 *
 * @module services/agent-definition-provider.test
 * @ticket TASK-PC-BE-010
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    getAgentByName,
    getAgentByStage,
    getAllActiveAgents,
    buildAgentContext,
    formatAgentRole,
    type AgentDefinition,
} from './agent-definition-provider.js';

// Mock the pool
vi.mock('../db/pool.js', () => ({
    pool: {
        query: vi.fn(),
    },
}));

// Mock the logger
vi.mock('../middleware/logging.js', () => ({
    logger: {
        info: vi.fn(),
        debug: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
    },
}));

const { pool } = await import('../db/pool.js');

function createMockAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
    return {
        id: '550e8400-e29b-41d4-a716-446655440000',
        agent_name: 'Backend',
        agent_role: 'Backend',
        description: 'Implements server-side logic, APIs, database operations',
        stage: 'BACKEND',
        model: 'Claude Opus 4.6',
        tools: ['memory/*', 'oraios/serena/*', 'execute/*'],
        constraints: {},
        forbidden_actions: [
            'NEVER modify CI/CD pipeline configurations',
            'NEVER skip TDD cycle',
        ],
        scope_included: ['src/', 'api/', 'tests/'],
        scope_excluded: ['frontend/', 'ci/'],
        evidence_requirements: [
            'All acceptance criteria met',
            'Tests written with ≥80% coverage',
        ],
        boot_sequence: [
            'Read .github/guardian/STOP_ALL',
            'Read all .github/instructions/*.instructions.md',
            'Call tickets.payload(ticket_id)',
        ],
        execution_workflow: {
            tdd: 'red-green-refactor',
        },
        metadata: {
            user_invocable: false,
        },
        version: 1,
        created_at: '2026-03-23T00:00:00.000Z',
        updated_at: '2026-03-23T00:00:00.000Z',
        ...overrides,
    };
}

describe('AgentDefinitionProvider', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('getAgentByName', () => {
        it('should return agent definition when found', async () => {
            const mockAgent = createMockAgent();
            (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
                rows: [{
                    ...mockAgent,
                    tools: JSON.stringify(mockAgent.tools),
                    constraints: JSON.stringify(mockAgent.constraints),
                    execution_workflow: JSON.stringify(mockAgent.execution_workflow),
                    metadata: JSON.stringify(mockAgent.metadata),
                    created_at: new Date(mockAgent.created_at),
                    updated_at: new Date(mockAgent.updated_at),
                }],
            });

            const result = await getAgentByName('Backend');

            expect(result).not.toBeNull();
            expect(result!.agent_name).toBe('Backend');
            expect(result!.stage).toBe('BACKEND');
            expect(result!.forbidden_actions).toContain('NEVER skip TDD cycle');
        });

        it('should return null when agent not found', async () => {
            (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({ rows: [] });

            const result = await getAgentByName('NonExistent');

            expect(result).toBeNull();
        });

        it('should handle database errors gracefully', async () => {
            (pool.query as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('DB error'));

            const result = await getAgentByName('Backend');

            expect(result).toBeNull();
        });
    });

    describe('getAgentByStage', () => {
        it('should return agent definition for stage', async () => {
            const mockAgent = createMockAgent();
            (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
                rows: [{
                    ...mockAgent,
                    tools: JSON.stringify(mockAgent.tools),
                    constraints: JSON.stringify(mockAgent.constraints),
                    execution_workflow: JSON.stringify(mockAgent.execution_workflow),
                    metadata: JSON.stringify(mockAgent.metadata),
                    created_at: new Date(mockAgent.created_at),
                    updated_at: new Date(mockAgent.updated_at),
                }],
            });

            const result = await getAgentByStage('BACKEND');

            expect(result).not.toBeNull();
            expect(result!.stage).toBe('BACKEND');
        });
    });

    describe('getAllActiveAgents', () => {
        it('should return all active agents', async () => {
            const mockAgents = [
                createMockAgent({ agent_name: 'Backend', stage: 'BACKEND' }),
                createMockAgent({ agent_name: 'Frontend', stage: 'FRONTEND' }),
            ];
            (pool.query as ReturnType<typeof vi.fn>).mockResolvedValue({
                rows: mockAgents.map(a => ({
                    ...a,
                    tools: JSON.stringify(a.tools),
                    constraints: JSON.stringify(a.constraints),
                    execution_workflow: JSON.stringify(a.execution_workflow),
                    metadata: JSON.stringify(a.metadata),
                    created_at: new Date(a.created_at),
                    updated_at: new Date(a.updated_at),
                })),
            });

            const result = await getAllActiveAgents();

            expect(result).toHaveLength(2);
            expect(result[0]!.agent_name).toBe('Backend');
            expect(result[1]!.agent_name).toBe('Frontend');
        });
    });

    describe('buildAgentContext', () => {
        it('should format agent context with all sections', () => {
            const agent = createMockAgent();
            const context = buildAgentContext(agent);

            expect(context).toContain('**Agent Role:** Backend');
            expect(context).toContain('**Description:** Implements server-side logic');
            expect(context).toContain('**SDLC Stage:** BACKEND');
            expect(context).toContain('**Forbidden Actions:**');
            expect(context).toContain('- NEVER skip TDD cycle');
            expect(context).toContain('**Scope Included:**');
            expect(context).toContain('- src/');
        });

        it('should handle empty arrays gracefully', () => {
            const agent = createMockAgent({
                forbidden_actions: [],
                scope_included: [],
                scope_excluded: [],
                evidence_requirements: [],
            });
            const context = buildAgentContext(agent);

            expect(context).toContain('**Agent Role:** Backend');
            expect(context).not.toContain('**Forbidden Actions:**');
        });
    });

    describe('formatAgentRole', () => {
        it('should format ROLE section for execution packet', () => {
            const agent = createMockAgent();
            const role = formatAgentRole(agent);

            expect(role).toContain('You are the **Backend** subagent');
            expect(role).toContain('Implements server-side logic');
            expect(role).toContain('Your SDLC stage is **BACKEND**');
        });
    });
});