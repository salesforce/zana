/**
 * The MCP route tells execution.start how its owner receives a `[Squad report]`: the
 * Modern agent-tool bridge marks a thread's route (`?route=thread`); any other session
 * route is a CLI Agent PTY.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer, type McpServerHandle } from './mcp-server.js';
import { createMemoryInboxStore, createMemorySuggestionsStore } from '@zana-ai/zcc-server';
import { controlCredentialForSession } from '@zana-ai/zcc-host-daemon/control-credential';

let handle: McpServerHandle | null = null;
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close().catch(() => undefined);
  await handle?.close();
  handle = null;
});

async function startOwnedRun(query: string) {
  const start = vi.fn(async () => ({ ok: true as const, value: { id: 'execution-1', state: 'RUNNING' } }));
  handle = await startMcpServer({
    inboxStore: createMemoryInboxStore(),
    suggestionsStore: createMemorySuggestionsStore(),
    projects: { get: (id) => (id === 'proj-1' ? { id, name: 'Proj', path: '/tmp/proj-1', createdAt: 0, lastActiveAt: 0 } : null) },
    executionService: { start } as never,
    resolveExecutionLaunchApproval: () => 'direct',
    validateTeamRouteIdentity: () => true,
    validateLaunchRouteIdentity: async () => true,
    log: () => {}
  });
  const client = new Client({ name: 'owner', version: '0.0.0' });
  const credential = controlCredentialForSession('owner-1');
  await client.connect(new StreamableHTTPClientTransport(new URL(`${handle.url}/mcp/proj-1/owner-1/${encodeURIComponent(credential)}${query}`)));
  clients.push(client);
  const result = await client.callTool({
    name: 'execution.start',
    arguments: { version: 1, teamId: 'team-1', launchRequestId: 'request-1', slots: [{ initialTask: 'work' }], notify: true }
  });
  expect(result.isError).toBeFalsy();
  return start.mock.calls[0] as unknown[];
}

describe('execution.start report target from the MCP route', () => {
  it('reports to a Modern thread when the bridge marks the route', async () => {
    expect((await startOwnedRun('?route=thread'))[3]).toEqual({ reportTo: { kind: 'thread', id: 'owner-1', role: 'owner' } });
  });

  it('reports to a CLI Agent PTY otherwise', async () => {
    expect((await startOwnedRun(''))[3]).toEqual({ reportTo: { kind: 'pty', id: 'owner-1', role: 'owner' } });
  });
});
