import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = new URL('http://localhost:3011/mcp');
const token = 'forgeos_admin_CHANGE_ME_IMMEDIATELY';

const transport = new StreamableHTTPClientTransport(endpoint, {
  requestInit: { headers: { Authorization: `Bearer ${token}` } }
});

const client = new Client({ name: 'mcp-smoke-sdk', version: '1.0.0' });

try {
  await client.connect(transport);
  const listed = await client.listTools();
  console.log(JSON.stringify({ count: listed.tools?.length ?? 0, names: (listed.tools ?? []).map(t => t.name) }, null, 2));
} finally {
  try { await client.close(); } catch {}
}
