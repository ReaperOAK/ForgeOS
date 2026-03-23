#!/usr/bin/env node
const FORGEOS_URL = process.env.FORGEOS_URL ?? 'http://localhost:3011/mcp';
const FORGEOS_API_KEY = process.env.FORGEOS_API_KEY ?? '';

const headers = {
  'Content-Type': 'application/json',
  'Accept': 'application/json, text/event-stream',
  'Authorization': 'Bearer ' + FORGEOS_API_KEY,
};

async function callForgeOS(method, params) {
  const body = JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params: params ?? {} });
  const res = await fetch(FORGEOS_URL, { method: 'POST', headers, body });
  const text = await res.text();
  // Parse SSE format: "event: message\ndata: {...}"
  for (const line of text.split('\n')) {
    if (line.startsWith('data: ')) {
      try { return JSON.parse(line.slice(6)); } catch {}
    }
  }
  try { return JSON.parse(text); } catch { return { error: { code: -32603, message: text } }; }
}

function writeMsg(msg) {
  process.stdout.write(JSON.stringify(msg) + '\n');
}

async function handle(raw) {
  let id = null;
  try {
    const p = JSON.parse(raw);
    id = p.id;
    const res = await callForgeOS(p.method, p.params);
    res.id = id;
    writeMsg(res);
  } catch (err) {
    writeMsg({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message ?? 'Internal error' } });
  }
}

let buffer = '';
let pending = 0;
let stdinDone = false;

function checkDone() {
  if (stdinDone && pending === 0) process.exit(0);
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) {
      pending++;
      handle(trimmed).finally(() => { pending--; checkDone(); });
    }
  }
});

process.stdin.on('end', () => { stdinDone = true; checkDone(); });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
