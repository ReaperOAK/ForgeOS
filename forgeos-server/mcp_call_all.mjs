import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = new URL('http://localhost:3011/mcp');
const token = 'forgeos_admin_CHANGE_ME_IMMEDIATELY';

const sampleArgs = {
  'tickets.next': { stage: 'BACKEND' },
  'tickets.claim': {
    ticket_id: 'FORGEOS-BE076',
    claimed_by: 'mcp-smoke-tester',
    machine_id: 'local',
    operator: 'copilot',
    lease_minutes: 5,
  },
  'tickets.reject': { ticket_id: 'FORGEOS-BE076', reason: 'smoke-test', claimed_by: 'mcp-smoke-tester' },
  'tickets.spawn': {
    parent_ticket_id: 'FORGEOS-BE076',
    title: 'MCP smoke child ticket',
    description: 'temporary smoke test payload',
    ticket_type: 'backend',
    priority: 'low',
    acceptance_criteria: ['smoke'],
    file_paths: [],
    tags: ['smoke-test'],
    depends_on: [],
  },
  'tickets.complete': {
    ticket_id: 'FORGEOS-BE076',
    claimed_by: 'mcp-smoke-tester',
    evidence: { artifacts: ['smoke'], test_results: 'smoke', confidence: 'LOW' },
  },
  'tickets.extend': { ticket_id: 'FORGEOS-BE076', claimed_by: 'mcp-smoke-tester', lease_minutes: 5 },
  'tickets.update': { ticket_id: 'FORGEOS-BE076', claimed_by: 'mcp-smoke-tester', metadata_patch: { smoke_test: true } },
  'tickets.release': { ticket_id: 'FORGEOS-BE076', claimed_by: 'mcp-smoke-tester' },
  'tickets.stats': {},
  'tickets.graph': {},
  'tickets.list': { limit: 5, offset: 0 },
  'tickets.get': { ticket_id: 'FORGEOS-BE076' },
  'tickets.payload': { ticket_id: 'FORGEOS-BE076', agent_role: 'Backend' },
  'code.search_symbols': { name_pattern: '%ticket%' },
  'code.blast_radius': { file_path: 'forgeos-server/src/server.ts', max_depth: 5 },
  'code.get_imports': { file_path: 'forgeos-server/src/server.ts', max_depth: 5 },
  'init.index': { root_path: '/home/Ticketer/Documents/ForgeOS', force: false },
  'init.orient': { root_path: '/home/Ticketer/Documents/ForgeOS/forgeos-server' },
  'memory.add_lesson': {
    ticket_id: 'MCP-SMOKE-TEST',
    stage: 'VALIDATION',
    agent_role: 'CTO',
    lesson_text: 'Automated MCP all-tools smoke test lesson.',
    category: 'testing',
    tags: ['smoke', 'mcp'],
  },
  'memory.search_lessons': { query: 'smoke mcp validation lesson', limit: 5, min_similarity: 0.6 },
  'memory.get_context': { file_path: 'forgeos-server/src/server.ts', max_lessons: 3 },
};

const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: 'mcp-all-tools-smoke', version: '1.0.0' });

const rows = [];

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const names = (listed.tools || []).map((t) => t.name);

  for (const name of names) {
    const args = sampleArgs[name] ?? {};
    try {
      const res = await client.callTool({ name, arguments: args });
      const text = Array.isArray(res?.content) && typeof res.content[0]?.text === 'string'
        ? res.content[0].text
        : '';
      rows.push({ tool: name, ok: true, preview: text.slice(0, 120).replace(/\s+/g, ' ') });
    } catch (e) {
      rows.push({ tool: name, ok: false, error: e?.message || String(e) });
    }
  }

  const passed = rows.filter((r) => r.ok).length;
  const failed = rows.length - passed;
  console.log(JSON.stringify({ summary: { total: rows.length, passed, failed }, rows }, null, 2));
} finally {
  try { await client.close(); } catch { }
}
