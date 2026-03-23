/**
 * Seed Agent Definitions — loads agent profiles from .github/agents/*.agent.md
 * into the centralized agent_definitions database table.
 *
 * This script enables Phase 8 repository decoupling by migrating agent
 * definitions from filesystem markdown files to database storage.
 *
 * Usage:
 *   npx tsx src/db/seed-agent-definitions.ts
 *
 * @module db/seed-agent-definitions
 * @ticket TASK-PC-BE-010
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { pool } from './pool.js';
import { logger } from '../middleware/logging.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface AgentYamlFrontmatter {
    name?: string;
    description?: string;
    'user-invocable'?: boolean;
    tools?: string[];
    model?: string;
}

interface ParsedAgentDefinition {
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
    source_file: string;
}

// ── Stage Mapping ────────────────────────────────────────────────────────────

const AGENT_NAME_TO_STAGE: Record<string, string> = {
    'Architect': 'ARCHITECT',
    'Backend': 'BACKEND',
    'CIReviewer': 'CI',
    'CTO': 'ARCHITECT',
    'DevOps': 'BACKEND',
    'Documentation': 'DOCUMENTATION',
    'Frontend': 'FRONTEND',
    'ProductManager': 'PRODUCT_MANAGER',
    'QA': 'QA',
    'Research': 'RESEARCH',
    'Security': 'SECURITY',
    'Ticketer': 'READY',
    'TODO': 'READY',
    'UIDesigner': 'UI_DESIGN',
    'Validator': 'VALIDATOR',
};

// ── Parser ───────────────────────────────────────────────────────────────────

function parseYamlFrontmatter(content: string): AgentYamlFrontmatter {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatterMatch) {
        return {};
    }

    const frontmatter = frontmatterMatch[1]!;
    const result: AgentYamlFrontmatter = {};

    // Simple YAML parser for our specific needs
    const nameMatch = frontmatter.match(/name:\s*['"]?([^'"\n]+)['"]?/);
    if (nameMatch) result.name = nameMatch[1]!.trim();

    const descMatch = frontmatter.match(/description:\s*['"]?([^'"\n]+)['"]?/);
    if (descMatch) result.description = descMatch[1]!.trim();

    const modelMatch = frontmatter.match(/model:\s*(.+)/);
    if (modelMatch) result.model = modelMatch[1]!.trim();

    const toolsMatch = frontmatter.match(/tools:\s*\[(.+)\]/);
    if (toolsMatch) {
        result.tools = toolsMatch[1]!
            .split(',')
            .map(t => t.trim().replace(/['"]/g, ''))
            .filter(t => t.length > 0);
    }

    return result;
}

function extractSection(content: string, sectionName: string): string | null {
    const patterns = [
        new RegExp(`## \\d*\\.?\\s*${sectionName}[\\s\\S]*?(?=## \\d|$)`, 'i'),
        new RegExp(`## ${sectionName}[\\s\\S]*?(?=##|$)`, 'i'),
    ];

    for (const pattern of patterns) {
        const match = content.match(pattern);
        if (match) {
            return match[0].replace(new RegExp(`^## \\d*\\.?\\s*${sectionName}\\s*`, 'i'), '').trim();
        }
    }

    return null;
}

function extractListItems(section: string | null): string[] {
    if (!section) return [];

    const items: string[] = [];
    const lines = section.split('\n');

    for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
            items.push(trimmed.substring(2).trim());
        } else if (trimmed.startsWith('❌ ') || trimmed.startsWith('✅ ')) {
            items.push(trimmed.substring(2).trim());
        }
    }

    return items;
}

function extractScopeSection(content: string, includeOrExclude: 'Included' | 'Excluded'): string[] {
    const scopeSection = extractSection(content, 'Scope');
    if (!scopeSection) return [];

    const subsection = extractSection(scopeSection, includeOrExclude);
    return extractListItems(subsection);
}

function extractForbiddenActions(content: string): string[] {
    const forbiddenSection = extractSection(content, 'Forbidden Actions');
    if (!forbiddenSection) {
        const explicitSection = extractSection(content, 'Explicit Forbidden Actions');
        return extractListItems(explicitSection);
    }
    return extractListItems(forbiddenSection);
}

function extractEvidenceRequirements(content: string): string[] {
    const evidenceSection = extractSection(content, 'Evidence Requirements');
    return extractListItems(evidenceSection);
}

function extractBootSequence(content: string): string[] {
    const bootSection = extractSection(content, 'Boot Sequence');
    if (!bootSection) return [];

    const items: string[] = [];
    const lines = bootSection.split('\n');
    let inList = false;

    for (const line of lines) {
        const trimmed = line.trim();
        if (/^\d+\./.test(trimmed)) {
            items.push(trimmed.replace(/^\d+\.\s*/, ''));
            inList = true;
        } else if (inList && trimmed.startsWith('- ')) {
            items.push(trimmed.substring(2));
        } else if (trimmed === '' || trimmed.startsWith('#')) {
            inList = false;
        }
    }

    return items;
}

function parseAgentFile(filePath: string): ParsedAgentDefinition | null {
    try {
        const content = readFileSync(filePath, 'utf-8');
        const frontmatter = parseYamlFrontmatter(content);
        const fileName = basename(filePath, '.agent.md');
        const agentName = frontmatter.name || fileName;

        const stage = AGENT_NAME_TO_STAGE[agentName];
        if (!stage) {
            logger.warn({ agentName, filePath }, 'seed-agent-definitions: unknown agent, skipping');
            return null;
        }

        return {
            agent_name: agentName,
            agent_role: agentName,
            description: frontmatter.description || `The ${agentName} subagent`,
            stage,
            model: frontmatter.model || null,
            tools: frontmatter.tools || [],
            constraints: {},
            forbidden_actions: extractForbiddenActions(content),
            scope_included: extractScopeSection(content, 'Included'),
            scope_excluded: extractScopeSection(content, 'Excluded'),
            evidence_requirements: extractEvidenceRequirements(content),
            boot_sequence: extractBootSequence(content),
            execution_workflow: {},
            metadata: {
                user_invocable: frontmatter['user-invocable'] ?? false,
                raw_frontmatter: frontmatter,
            },
            source_file: filePath,
        };
    } catch (err) {
        logger.error(
            {
                filePath,
                error: err instanceof Error ? err.message : String(err),
            },
            'seed-agent-definitions: failed to parse agent file',
        );
        return null;
    }
}

// ── Database Operations ──────────────────────────────────────────────────────

async function upsertAgentDefinition(agent: ParsedAgentDefinition): Promise<void> {
    await pool.query(
        `INSERT INTO agent_definitions (
            agent_name, agent_role, description, stage, model,
            tools, constraints, forbidden_actions, scope_included,
            scope_excluded, evidence_requirements, boot_sequence,
            execution_workflow, metadata, source_file, version, is_active
        ) VALUES (
            $1, $2, $3, $4, $5,
            $6::jsonb, $7::jsonb, $8, $9,
            $10, $11, $12,
            $13::jsonb, $14::jsonb, $15, 1, TRUE
        )
        ON CONFLICT (agent_name) DO UPDATE SET
            agent_role = EXCLUDED.agent_role,
            description = EXCLUDED.description,
            stage = EXCLUDED.stage,
            model = EXCLUDED.model,
            tools = EXCLUDED.tools,
            constraints = EXCLUDED.constraints,
            forbidden_actions = EXCLUDED.forbidden_actions,
            scope_included = EXCLUDED.scope_included,
            scope_excluded = EXCLUDED.scope_excluded,
            evidence_requirements = EXCLUDED.evidence_requirements,
            boot_sequence = EXCLUDED.boot_sequence,
            execution_workflow = EXCLUDED.execution_workflow,
            metadata = EXCLUDED.metadata,
            source_file = EXCLUDED.source_file,
            version = agent_definitions.version + 1,
            is_active = TRUE,
            updated_at = NOW()`,
        [
            agent.agent_name,
            agent.agent_role,
            agent.description,
            agent.stage,
            agent.model,
            JSON.stringify(agent.tools),
            JSON.stringify(agent.constraints),
            agent.forbidden_actions,
            agent.scope_included,
            agent.scope_excluded,
            agent.evidence_requirements,
            agent.boot_sequence,
            JSON.stringify(agent.execution_workflow),
            JSON.stringify(agent.metadata),
            agent.source_file,
        ],
    );

    logger.info(
        { agentName: agent.agent_name, stage: agent.stage },
        'seed-agent-definitions: upserted agent definition',
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
    const agentsDir = join(process.cwd(), '..', '.github', 'agents');

    logger.info({ agentsDir }, 'seed-agent-definitions: scanning agent files');

    try {
        const files = readdirSync(agentsDir)
            .filter(f => f.endsWith('.agent.md'))
            .map(f => join(agentsDir, f));

        logger.info({ fileCount: files.length }, 'seed-agent-definitions: found agent files');

        let successCount = 0;
        let skipCount = 0;

        for (const filePath of files) {
            const agent = parseAgentFile(filePath);
            if (!agent) {
                skipCount++;
                continue;
            }

            await upsertAgentDefinition(agent);
            successCount++;
        }

        logger.info(
            { successCount, skipCount, total: files.length },
            'seed-agent-definitions: completed seeding',
        );
    } catch (err) {
        logger.error(
            { error: err instanceof Error ? err.message : String(err) },
            'seed-agent-definitions: failed to scan agent directory',
        );
        throw err;
    }
}

// ── Entry Point ──────────────────────────────────────────────────────────────

main()
    .then(() => {
        logger.info('seed-agent-definitions: done');
        process.exit(0);
    })
    .catch((err) => {
        logger.error({ err }, 'seed-agent-definitions: fatal error');
        process.exit(1);
    });