// Minimal stdio MCP server: initialize + empty tool list. Newline-delimited JSON-RPC.
const { createInterface } = require('node:readline');
createInterface({ input: process.stdin }).on('line', (line) => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  if (msg.id === undefined) return;
  const result = msg.method === 'initialize'
    ? { protocolVersion: msg.params?.protocolVersion ?? '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fixture-mcp', version: '1.0.0' } }
    : msg.method === 'tools/list' ? { tools: [] } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\n');
});
