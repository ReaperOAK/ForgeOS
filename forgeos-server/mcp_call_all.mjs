import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = new URL('http://localhost:3011/mcp');
const token = process.env.FORGEOS_API_KEY || 'forgeos_admin_CHANGE_ME';

const SMOKE_TICKET = 'TEST-BE-001';
const sampleArgs = {
  'tickets.next': { stage: 'BACKEND' },
  'tickets.claim': {
    ticket_id: SMOKE_TICKET,
    agent_name: 'mcp-smoke-tester',
    machine_id: 'local',
    operator: 'copilot',
    lease_minutes: 5,
  },
  'tickets.reject': { ticket_id: SMOKE_TICKET, reason: 'smoke-test: validating reject endpoint works correctly' },
  'tickets.spawn': {
    parent_id: SMOKE_TICKET,
    title: 'MCP smoke child ticket',
    type: 'backend',
    priority: 'low',
    acceptance_criteria: ['smoke test passes'],
    file_paths: [],
    depends_on: [],
  },
  'tickets.complete': {
    ticket_id: SMOKE_TICKET,
    evidence: { artifacts: ['smoke.ts'], test_results: 'smoke test passed', confidence: 'LOW' },
  },
  'tickets.extend': { ticket_id: SMOKE_TICKET, agent_name: 'mcp-smoke-tester', duration_minutes: 5 },
  'tickets.update': { ticket_id: SMOKE_TICKET, metadata: { smoke_test: true } },
  'tickets.release': { ticket_id: SMOKE_TICKET, agent_name: 'mcp-smoke-tester' },
  'tickets.stats': {},
  'tickets.graph': {},
  'tickets.list': { limit: 5, offset: 0 },
  'tickets.get': { ticket_id: SMOKE_TICKET },
  'tickets.payload': { ticket_id: SMOKE_TICKET, agent_role: 'Backend' },
  'code.search_symbols': { name_pattern: '%ticket%' },
  'code.blast_radius': { file_path: 'forgeos-server/src/server.ts', max_depth: 5 },
  'code.get_imports': { file_path: 'forgeos-server/src/server.ts', max_depth: 5 },
  'init.index': { root_path: '/home/reaperoak/Documents/ForgeOS', force: false },
  'init.orient': { root_path: '/home/reaperoak/Documents/ForgeOS/forgeos-server' },
  'memory.add_lesson': {
    ticket_id: 'MCP-SMOKE-TEST',
    stage: 'VALIDATION',
    agent_role: 'CTO',
    lesson_text: 'Automated MCP all-tools smoke test lesson.',
    category: 'testing',
    tags: ['smoke', 'mcp'],
  },
  'memory.search_lessons': { query: 'smoke mcp validation lesson', limit: 5, threshold: 0.6 },
  'memory.get_context': { file_path: 'forgeos-server/src/server.ts', max_lessons: 3 },
};

const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } },
});
const client = new Client({ name: 'mcp-all-tools-smoke', version: '1.0.0' });

// Ordered test sequence — lifecycle-aware
const testSequence = [
  // Read-only tools first
  { name: 'tickets.stats', args: {} },
  { name: 'tickets.graph', args: {} },
  { name: 'tickets.list', args: { limit: 5, offset: 0 } },
  { name: 'tickets.get', args: { ticket_id: SMOKE_TICKET } },
  { name: 'tickets.next', args: { stage: 'BACKEND' } },
  { name: 'tickets.payload', args: { ticket_id: SMOKE_TICKET, agent_role: 'Backend' } },
  // Code intelligence
  { name: 'code.search_symbols', args: { name_pattern: '%ticket%' } },
  { name: 'code.blast_radius', args: { file_path: 'forgeos-server/src/server.ts', max_depth: 5 } },
  { name: 'code.get_imports', args: { file_path: 'forgeos-server/src/server.ts', max_depth: 5 } },
  // Init tools
  { name: 'init.index', args: { root_path: '/home/reaperoak/Documents/ForgeOS', force: false } },
  { name: 'init.orient', args: { root_path: '/home/reaperoak/Documents/ForgeOS/forgeos-server' } },
  // Memory tools
  { name: 'memory.add_lesson', args: {
    ticket_id: 'MCP-SMOKE-TEST',
    stage: 'VALIDATION',
    agent_role: 'CTO',
    lesson_text: 'Automated MCP all-tools smoke test lesson.',
    category: 'testing',
    tags: ['smoke', 'mcp'],
  }},
  { name: 'memory.search_lessons', args: { query: 'smoke mcp validation lesson', limit: 5, threshold: 0.6 } },
  { name: 'memory.get_context', args: { file_path: 'forgeos-server/src/server.ts' } },
  // Lifecycle chain: claim → extend → update → spawn → complete → release
  { name: 'tickets.claim', args: {
    ticket_id: SMOKE_TICKET,
    agent_name: 'mcp-smoke-tester',
    machine_id: 'local',
    operator: 'copilot',
    lease_minutes: 5,
  }},
  { name: 'tickets.extend', args: { ticket_id: SMOKE_TICKET, agent_name: 'mcp-smoke-tester', duration_minutes: 5 } },
  { name: 'tickets.update', args: { ticket_id: SMOKE_TICKET, metadata: { smoke_test: true } } },
  { name: 'tickets.spawn', args: {
    parent_id: SMOKE_TICKET,
    title: 'MCP smoke child ticket',
    type: 'backend',
    priority: 'low',
    acceptance_criteria: ['smoke test passes'],
    file_paths: [],
    depends_on: [],
  }},
  { name: 'tickets.complete', args: {
    ticket_id: SMOKE_TICKET,
    evidence: { artifacts: ['smoke.ts'], test_results: 'smoke test passed', confidence: 'LOW' },
  }},
  // Release (will work on a now-unclaimed ticket — expect graceful failure)
  { name: 'tickets.release', args: { ticket_id: SMOKE_TICKET, agent_name: 'mcp-smoke-tester' } },
  // Reject (expect NOT_CLAIM_OWNER since ticket already advanced — graceful failure)
  { name: 'tickets.reject', args: { ticket_id: SMOKE_TICKET, reason: 'smoke-test: validating reject endpoint works correctly' } },
  // attach_prompts last (slow LLM call)
  { name: 'tickets.attach_prompts', args: { ticket_id: SMOKE_TICKET, force_regenerate: true, limit: 1 } },
];

const rows = [];

try {
  await client.connect(transport);
  const listed = await client.listTools();
  const registeredNames = new Set((listed.tools || []).map((t) => t.name));
  console.log(`Registered tools: ${registeredNames.size}`);

  for (const { name, args } of testSequence) {
    if (!registeredNames.has(name)) {
      rows.push({ tool: name, ok: false, error: 'NOT_REGISTERED' });
      continue;
    }
    try {
      const res = await client.callTool({ name, arguments: args });
      const text = Array.isArray(res?.content) && typeof res.content[0]?.text === 'string'
        ? res.content[0].text
        : '';
      const isError = text.includes('"error"');
      rows.push({ tool: name, ok: true, isError, preview: text.slice(0, 140).replace(/\s+/g, ' ') });
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
