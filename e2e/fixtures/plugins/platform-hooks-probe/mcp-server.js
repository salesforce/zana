// Plain, directly-runnable ESM (no build step for this fixture — the host
// spawns `node ./mcp-server.js` literally; see package.json zcc.mcpServers).
// Inherits the Claude CLI's cwd, which is the current project root, so the
// relative journal path below lands inside the project workspace. The server
// reads it via zcc.sdk.files.readProject (confined, Rule 2). This file writes
// with plain node:fs since it has no RPC/HTTP
// callback into its own plugin process (no such channel is host-provided).
import { randomUUID } from 'node:crypto';
import { appendFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const JOURNAL_RELATIVE_PATH = '.zcc-hooks-probe/mcp-invocations.jsonl';
const JOURNAL_MAX_BYTES = 1024 * 1024;

function journalPath() {
  return join(process.cwd(), JOURNAL_RELATIVE_PATH);
}

async function recordInvocation(invocationId) {
  const target = journalPath();
  await mkdir(dirname(target), { recursive: true });
  const size = await stat(target).then((file) => file.size, (error) => {
    if (error.code === 'ENOENT') return 0;
    throw error;
  });
  const entry = { source: 'mcp-tool', invocationId, at: Date.now() };
  const line = `${JSON.stringify(entry)}\n`;
  if (size + Buffer.byteLength(line) > JOURNAL_MAX_BYTES) throw new Error('MCP marker journal is full');
  // One short O_APPEND write per invocation; no read/rename of the server's
  // CAS file, so concurrent MCP calls cannot discard each other's records.
  await appendFile(target, line, 'utf8');
  return entry;
}

const server = new McpServer({ name: 'platform-hooks-probe', version: '0.1.0' }, { capabilities: { tools: {} } });

server.registerTool(
  'platform-hooks-probe',
  {
    description:
      'Harmless probe tool. Writes a bounded marker to a fixed path inside the current project; no side effects outside the fixture.',
    inputSchema: {}
  },
  async () => {
    const entry = await recordInvocation(randomUUID());
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, entry }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
