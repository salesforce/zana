import { expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startMcpServer } from '../../mcp/mcp-server.js';
import { createMemoryInboxStore } from '../../inbox/inbox-store.js';
import { createAgentRegistryStore } from '../agent-registry-store.js';
import { createAgentMessageLog } from '../agent-message-log.js';

it.each([false, true])('wires the real CLI MCP bridge with squad=%s', async squad => {
  const registry = createAgentRegistryStore();
  registry.upsert({ sessionId: 'cli', projectId: 'project', cwd: '/tmp', handle: 'caller', ...(squad ? { teamLaunchId: 'team' } : {}) });
  const threadPeerTools = vi.fn(async (_session: string, name: string) => name === 'agent_send'
    ? { ok: true, delivery: 'awaiting-review' } : [{ sessionId: 'thread', kind: 'thread', handle: 'reviewer' }]);
  const server = await startMcpServer({ inboxStore: createMemoryInboxStore(),
    projects: { get: id => id === 'project' ? { id, name: 'Project', path: '/tmp', createdAt: 0, lastActiveAt: 0 } : null },
    agentRegistry: registry, agentMessageLog: createAgentMessageLog(), getAgentStatus: () => 'working',
    injectToSession: () => false, getTeamLaunchId: () => squad ? 'team' : undefined,
    threadPeerTools, log: () => {} });
  const client = new Client({ name: 'peer-regression', version: '1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(new URL(`${server.url}/mcp/project/cli`)));
    const list = await client.callTool({ name: 'list_agents', arguments: {} });
    const found = await client.callTool({ name: 'find_agent', arguments: { handle: 'reviewer' } });
    const sent = await client.callTool({ name: 'agent_send', arguments: { to: 'thread', message: 'Review this' } });
    if (squad) {
      expect(threadPeerTools).not.toHaveBeenCalled();
      expect(sent.isError).toBe(true);
    } else {
      expect(JSON.parse((list.content as Array<{text:string}>)[0].text)).toEqual([expect.objectContaining({ sessionId: 'thread' })]);
      expect(JSON.parse((found.content as Array<{text:string}>)[0].text)).toHaveLength(1);
      expect(threadPeerTools).toHaveBeenCalledWith('cli', 'agent_send', { to: 'thread', message: 'Review this', allProjects: undefined });
      expect(JSON.parse((sent.content as Array<{text:string}>)[0].text)).toMatchObject({ delivery: 'awaiting-review' });
    }
  } finally { await client.close(); await server.close(); }
});
