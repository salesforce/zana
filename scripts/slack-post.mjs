// Post a message to the watched Slack channel via the SAME local AI Expert
// Suite MCP gateway the bot reads — so a `run <prompt>` lands as a real inbound
// command from the authed user, driving the relay end-to-end.
//
// Usage: node scripts/slack-post.mjs "run say hello"
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHANNEL = process.env.ZCC_SLACK_CHANNEL || 'C0BD8JWDLCR';
const message = process.argv.slice(2).join(' ');
if (!message) {
  console.error('usage: node scripts/slack-post.mjs "<text>"');
  process.exit(1);
}

const CFG = join(homedir(), '.aisuite', 'marketplaces', 'aisuite', 'plugins', 'slack', '.mcp.json');
const cfg = JSON.parse(readFileSync(CFG, 'utf8'));
const slack = cfg.mcpServers?.slack;
const url = slack?.url;
const auth = slack?.headers?.Authorization ?? slack?.headers?.authorization ?? '';
const token = auth.replace(/^Bearer\s+/i, '');
if (!url || !token) {
  console.error('gateway config incomplete');
  process.exit(1);
}

let nextId = 1;
async function rpc(method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params })
  });
  const ct = res.headers.get('content-type') || '';
  const raw = await res.text();
  if (!res.ok) {
    console.error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
    process.exit(1);
  }
  // The gateway may answer JSON or SSE (text/event-stream). Extract the JSON.
  let jsonText = raw;
  if (ct.includes('text/event-stream') || raw.startsWith('event:') || raw.includes('\ndata:')) {
    const dataLines = raw
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .filter(Boolean);
    jsonText = dataLines[dataLines.length - 1] ?? raw;
  }
  let data;
  try {
    data = JSON.parse(jsonText);
  } catch {
    console.error(`unparseable response: ${raw.slice(0, 300)}`);
    process.exit(1);
  }
  if (data.error) {
    console.error(`MCP error: ${JSON.stringify(data.error)}`);
    process.exit(1);
  }
  return data.result;
}

await rpc('initialize', {
  protocolVersion: '2024-11-05',
  capabilities: {},
  clientInfo: { name: 'zcc-slack-driver', version: '1' }
});
const result = await rpc('tools/call', {
  name: 'slack_send_message',
  arguments: { channel_id: CHANNEL, message }
});
const text =
  result?.content?.map?.((c) => c.text).filter(Boolean).join('\n') ?? JSON.stringify(result);
console.log(`[post] sent to ${CHANNEL}: ${message}`);
console.log(`[post] gateway said: ${text.slice(0, 300)}`);
