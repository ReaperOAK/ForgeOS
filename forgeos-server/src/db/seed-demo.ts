/**
 * Optional demo data seeder for ForgeOS MCP Server.
 *
 * Creates demo agents (backend, frontend, qa, security) and a sample
 * READY ticket for smoke testing the full ticket lifecycle.
 *
 * Usage: npm run seed:demo
 *
 * @module db/seed-demo
 */

import { getPool } from './pool.js';
import { logger } from '../middleware/logging.js';

async function seedDemo(): Promise<void> {
    const pool = getPool();

    logger.info({ event: 'seed_demo_start' }, 'Seeding demo data');

    // Ensure project exists (seed.ts should have created it)
    const projectResult = await pool.query<{ id: string }>(
        `SELECT id FROM projects WHERE name = 'ForgeOS' LIMIT 1`,
    );
    if (projectResult.rows.length === 0) {
        throw new Error(
            'Default project "ForgeOS" not found. Run the server first to trigger initial seed.',
        );
    }
    const projectId = projectResult.rows[0]!.id;

    // Create demo agents with scoped permissions
    await pool.query(`
    INSERT INTO agents (name, role, permissions) VALUES
      ('backend-agent', 'backend', '["tickets.claim","tickets.complete","tickets.update","tickets.extend"]'::jsonb),
      ('frontend-agent', 'frontend', '["tickets.claim","tickets.complete","tickets.update","tickets.extend"]'::jsonb),
      ('qa-agent', 'qa', '["tickets.claim","tickets.reject","tickets.complete","tickets.extend"]'::jsonb),
      ('security-agent', 'security', '["tickets.claim","tickets.reject","tickets.complete","tickets.extend"]'::jsonb)
    ON CONFLICT (name, role) DO NOTHING
  `);
    logger.info({ event: 'seed_demo_agents' }, 'Demo agents created');

    // Create a demo ticket in READY state
    await pool.query(
        `INSERT INTO tickets (ticket_id, project_id, title, description, type, priority, status, stage, sdlc_flow, acceptance_criteria)
     VALUES (
       'DEMO-001', $1,
       'Demo Backend Task',
       'A sample ticket for smoke testing the MCP server lifecycle.',
       'backend'::ticket_type,
       'medium'::ticket_priority,
       'READY'::ticket_status,
       'BACKEND'::ticket_stage,
       ARRAY['BACKEND','QA','SECURITY','CI','DOCUMENTATION','VALIDATOR','DONE']::ticket_stage[],
       ARRAY['Compiles without errors', 'Tests pass']
     )
     ON CONFLICT (ticket_id) DO NOTHING`,
        [projectId],
    );
    logger.info({ event: 'seed_demo_ticket' }, 'Demo ticket DEMO-001 created');

    logger.info({ event: 'seed_demo_complete' }, 'Demo data seeded successfully');
    await pool.end();
}

seedDemo().catch((err) => {
    console.error('Demo seed failed:', err);
    process.exit(1);
});
