/**
 * Agent Definition Provider — loads agent definitions from the centralized
 * database storage instead of repository markdown files.
 *
 * This service enables the Prompt Compiler to retrieve agent context
 * without filesystem access, supporting Phase 8 repository decoupling.
 *
 * @module services/agent-definition-provider
 * @ticket TASK-PC-BE-010
 */

import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface AgentDefinition {
    id: string;
    agent_name: string;
    agent_role: string;
    description: string;
    stage: string;
    model: string | null;
    tools: string[];
    constraints: Record<string, unknown>;
    forbidden_actions: string[];
    scope_included: string[];
    scope_excluded: string[];
    evidence_requirements: string[];
    boot_sequence: string[];
    execution_workflow: Record<string, unknown>;
    metadata: Record<string, unknown>;
    version: number;
    created_at: string;
    updated_at: string;
}

export interface AgentDefinitionRow {
    id: string;
    agent_name: string;
    agent_role: string;
    description: string;
    stage: string;
    model: string | null;
    tools: unknown;
    constraints: unknown;
    forbidden_actions: unknown;
    scope_included: unknown;
    scope_excluded: unknown;
    evidence_requirements: unknown;
    boot_sequence: unknown;
    execution_workflow: unknown;
    metadata: unknown;
    source_file: string | null;
    version: number;
    is_active: boolean;
    created_at: Date | string;
    updated_at: Date | string;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Retrieve agent definition by name from the database.
 *
 * @param agentName - Agent name (e.g., 'Backend', 'Frontend', 'QA')
 * @returns Agent definition or null if not found
 */
export async function getAgentByName(agentName: string): Promise<AgentDefinition | null> {
    logger.info({ agentName }, 'agent-definition-provider: loading agent by name');

    try {
        const result = await pool.query<AgentDefinitionRow>(
            'SELECT * FROM get_agent_by_name($1)',
            [agentName],
        );

        if (result.rows.length === 0) {
            logger.debug({ agentName }, 'agent-definition-provider: agent not found');
            return null;
        }

        return mapRowToDefinition(result.rows[0]!);
    } catch (err) {
        logger.error(
            {
                agentName,
                error: err instanceof Error ? err.message : String(err),
            },
            'agent-definition-provider: failed to load agent by name',
        );
        return null;
    }
}

/**
 * Retrieve agent definition by SDLC stage from the database.
 *
 * @param stage - SDLC stage (e.g., 'BACKEND', 'FRONTEND', 'QA')
 * @returns Agent definition or null if not found
 */
export async function getAgentByStage(stage: string): Promise<AgentDefinition | null> {
    logger.info({ stage }, 'agent-definition-provider: loading agent by stage');

    try {
        const result = await pool.query<AgentDefinitionRow>(
            'SELECT * FROM get_agent_by_stage($1)',
            [stage],
        );

        if (result.rows.length === 0) {
            logger.debug({ stage }, 'agent-definition-provider: no agent for stage');
            return null;
        }

        return mapRowToDefinition(result.rows[0]!);
    } catch (err) {
        logger.error(
            {
                stage,
                error: err instanceof Error ? err.message : String(err),
            },
            'agent-definition-provider: failed to load agent by stage',
        );
        return null;
    }
}

/**
 * Retrieve all active agent definitions from the database.
 *
 * @returns Array of all active agent definitions
 */
export async function getAllActiveAgents(): Promise<AgentDefinition[]> {
    logger.info('agent-definition-provider: loading all active agents');

    try {
        const result = await pool.query<AgentDefinitionRow>(
            `SELECT * FROM agent_definitions
             WHERE is_active = TRUE
             ORDER BY stage, agent_name`,
        );

        return result.rows.map(mapRowToDefinition);
    } catch (err) {
        logger.error(
            { error: err instanceof Error ? err.message : String(err) },
            'agent-definition-provider: failed to load all active agents',
        );
        return [];
    }
}

/**
 * Build agent context string for the Prompt Compiler.
 *
 * Generates a formatted context block containing agent role, constraints,
 * forbidden actions, and scope that can be injected into compiled prompts.
 *
 * @param agentDef - Agent definition to format
 * @returns Formatted agent context string
 */
export function buildAgentContext(agentDef: AgentDefinition): string {
    const sections: string[] = [];

    sections.push(`**Agent Role:** ${agentDef.agent_role}`);
    sections.push(`**Description:** ${agentDef.description}`);
    sections.push(`**SDLC Stage:** ${agentDef.stage}`);

    if (agentDef.model) {
        sections.push(`**Model:** ${agentDef.model}`);
    }

    if (agentDef.tools.length > 0) {
        sections.push(`**Tools:** ${agentDef.tools.join(', ')}`);
    }

    if (agentDef.forbidden_actions.length > 0) {
        sections.push(`**Forbidden Actions:**\n${agentDef.forbidden_actions.map(a => `- ${a}`).join('\n')}`);
    }

    if (agentDef.scope_included.length > 0) {
        sections.push(`**Scope Included:**\n${agentDef.scope_included.map(s => `- ${s}`).join('\n')}`);
    }

    if (agentDef.scope_excluded.length > 0) {
        sections.push(`**Scope Excluded:**\n${agentDef.scope_excluded.map(s => `- ${s}`).join('\n')}`);
    }

    if (agentDef.evidence_requirements.length > 0) {
        sections.push(`**Evidence Requirements:**\n${agentDef.evidence_requirements.map(e => `- ${e}`).join('\n')}`);
    }

    return sections.join('\n\n');
}

/**
 * Format agent definition for the ROLE section of an execution packet.
 *
 * @param agentDef - Agent definition to format
 * @returns Formatted ROLE section content
 */
export function formatAgentRole(agentDef: AgentDefinition): string {
    return `You are the **${agentDef.agent_name}** subagent.

${agentDef.description}

Your SDLC stage is **${agentDef.stage}**.`;
}

// ── Internal Helpers ──────────────────────────────────────────────────────────

function mapRowToDefinition(row: AgentDefinitionRow): AgentDefinition {
    return {
        id: row.id,
        agent_name: row.agent_name,
        agent_role: row.agent_role,
        description: row.description,
        stage: row.stage,
        model: row.model,
        tools: safeStringArray(row.tools),
        constraints: safeRecord(row.constraints),
        forbidden_actions: safeStringArray(row.forbidden_actions),
        scope_included: safeStringArray(row.scope_included),
        scope_excluded: safeStringArray(row.scope_excluded),
        evidence_requirements: safeStringArray(row.evidence_requirements),
        boot_sequence: safeStringArray(row.boot_sequence),
        execution_workflow: safeRecord(row.execution_workflow),
        metadata: safeRecord(row.metadata),
        version: row.version,
        created_at: toDate(row.created_at),
        updated_at: toDate(row.updated_at),
    };
}

function safeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
}

function safeRecord(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return {};
    }
    return value as Record<string, unknown>;
}

function toDate(value: Date | string): string {
    if (value instanceof Date) {
        return value.toISOString();
    }
    return String(value);
}