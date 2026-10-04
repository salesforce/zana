// Plain, directly-runnable ESM (no build step for this fixture — the host
// spawns `node ./mcp-server.js` literally; see package.json zcc.mcpServers).
// Inherits the Claude CLI's cwd, which is the current project root, so the
// relative marker path below lands inside the project workspace — the same
// relative path server.ts reads/writes via zcc.sdk.files.*Project (confined,
// Rule 2). This file writes with plain node:fs since it has no RPC/HTTP
// callback into its own plugin process (no such channel is host-provided).
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const MARKER_RELATIVE_PATH = '.zcc-hooks-probe/tool-marker.json';
const HISTORY_MAX = 20;
const EMPTY_MARKER = { count: 0, history: [] };

function markerPath() {
  return join(process.cwd(), MARKER_RELATIVE_PATH);
}

async function readMarker() {
  try {
    const raw = await readFile(markerPath(), 'utf8');
    return JSON.parse(raw);
  } catch {
    return EMPTY_MARKER;
  }
}

// tmp + rename — atomic on the same filesystem, matching the repo's shared-
// file-write convention (CLAUDE.md Rule 4) despite running outside the main
// plugin process.
async function writeMarker(next) {
  const target = markerPath();
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(next), 'utf8');
  await rename(tmp, target).catch(async (err) => {
    await unlink(tmp).catch(() => {});
    throw err;
  });
}

async function recordInvocation(invocationId) {
  const current = await readMarker();
  const next = {
    count: current.count + 1,
    history: [...current.history, { source: 'mcp-tool', invocationId, at: Date.now() }].slice(-HISTORY_MAX)
  };
  await writeMarker(next);
  return next;
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
    const marker = await recordInvocation(randomUUID());
    return { content: [{ type: 'text', text: JSON.stringify({ ok: true, marker }) }] };
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
