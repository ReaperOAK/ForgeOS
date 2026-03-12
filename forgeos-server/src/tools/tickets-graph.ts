/**
 * tickets.graph — Ticket Dependency Graph.
 *
 * Returns the dependency graph for tickets, showing parent-child
 * relationships and dependency edges. Used by dispatchers and dashboards
 * to visualise the ticket DAG and identify blocked/unblocked tickets.
 *
 * @module tools/tickets-graph
 * @ticket TASK-FOS-03-011
 */

import { z } from 'zod';
import { pool } from '../db/pool.js';
import { logger } from '../middleware/logging.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

// ── Zod Input Schema ─────────────────────────────────────────────────────────

/**
 * Zod input schema for the `tickets.graph` MCP tool.
 *
 * - `project_id` (optional) — Filter graph to a specific project.
 * - `root_ticket_id` (optional) — Return only the sub-graph rooted at this ticket.
 */
export const ticketsGraphSchema = z.object({
    project_id: z
        .string()
        .uuid()
        .optional()
        .describe('Optional: filter graph to a specific project'),
    root_ticket_id: z
        .string()
        .optional()
        .describe('Optional: return sub-graph rooted at this ticket'),
});

/** Validated input type derived from the Zod schema. */
type TicketsGraphInput = z.infer<typeof ticketsGraphSchema>;

// ── Graph Node & Edge Types ──────────────────────────────────────────────────

interface GraphNode {
    ticket_id: string;
    title: string;
    stage: string;
    status: string;
    parent_id: string | null;
}

interface GraphEdge {
    from: string;
    to: string;
    type: 'parent_child' | 'depends_on';
}

interface TicketGraph {
    nodes: GraphNode[];
    edges: GraphEdge[];
    total_nodes: number;
    total_edges: number;
}

// ── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handler for the `tickets.graph` MCP tool.
 *
 * Queries the tickets table for nodes and builds edges from both
 * `parent_id` (parent-child) and `depends_on` (dependency) relationships.
 *
 * @param input - Validated input parameters
 * @returns MCP CallToolResult with the dependency graph as JSON
 */
export async function ticketsGraphHandler(
    input: TicketsGraphInput,
): Promise<CallToolResult> {
    const { project_id, root_ticket_id } = input;

    try {
        logger.info(
            { event: 'tickets_graph_request', project_id, root_ticket_id },
            'Building ticket dependency graph',
        );

        // Build WHERE clauses
        const conditions: string[] = [];
        const params: (string | undefined)[] = [];
        let paramIdx = 1;

        if (project_id) {
            conditions.push(`t.project_id = $${paramIdx++}`);
            params.push(project_id);
        }

        if (root_ticket_id) {
            conditions.push(`(t.ticket_id = $${paramIdx} OR t.parent_id = $${paramIdx})`);
            params.push(root_ticket_id);
            paramIdx++;
        }

        const whereClause = conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : '';

        // Query nodes
        const nodesResult = await pool.query<GraphNode>(
            `SELECT ticket_id, title, stage, status, parent_id
         FROM tickets t
         ${whereClause}
         ORDER BY created_at ASC`,
            params.filter((p): p is string => p !== undefined),
        );

        const nodes: GraphNode[] = nodesResult.rows;

        // Build edges from parent_id and depends_on
        const edges: GraphEdge[] = [];

        for (const node of nodes) {
            if (node.parent_id) {
                edges.push({
                    from: node.parent_id,
                    to: node.ticket_id,
                    type: 'parent_child',
                });
            }
        }

        // Query depends_on edges
        const ticketIds = nodes.map((n) => n.ticket_id);
        if (ticketIds.length > 0) {
            const depsResult = await pool.query<{ ticket_id: string; dep: string }>(
                `SELECT ticket_id, unnest(depends_on) AS dep
           FROM tickets
          WHERE ticket_id = ANY($1)
            AND depends_on IS NOT NULL`,
                [ticketIds],
            );

            for (const row of depsResult.rows) {
                edges.push({
                    from: row.dep,
                    to: row.ticket_id,
                    type: 'depends_on',
                });
            }
        }

        const graph: TicketGraph = {
            nodes,
            edges,
            total_nodes: nodes.length,
            total_edges: edges.length,
        };

        logger.info(
            {
                event: 'tickets_graph_complete',
                total_nodes: graph.total_nodes,
                total_edges: graph.total_edges,
            },
            'Ticket graph built successfully',
        );

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify(graph),
                },
            ],
        };
    } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);

        logger.error(
            {
                event: 'tickets_graph_error',
                error: errorMessage,
                project_id,
                root_ticket_id,
            },
            'Failed to build ticket graph',
        );

        return {
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        error: 'GRAPH_ERROR',
                        message: errorMessage,
                        timestamp: new Date().toISOString(),
                    }),
                },
            ],
            isError: true,
        };
    }
}
