import { describe, it, expect, vi } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerAgentRegistryTools } from '../agent-registry-mcp-tools.js';
import { registerAgentMessagingTools } from '../agent-messaging-mcp-tools.js';
import { createAgentRegistryStore } from '../agent-registry-store.js';
import { createAgentMessageLog } from '../agent-message-log.js';

function setup(teamLaunchId?: string) {
  const registry = createAgentRegistryStore();
  registry.upsert({ sessionId: 'cli-1', projectId: 'p1', cwd: '/p1', handle: 'caller', teamLaunchId });
  registry.upsert({ sessionId: 'cli-2', projectId: 'p1', cwd: '/p1', handle: 'reviewer', teamLaunchId });
  const tools = new Map<string, (input: any) => Promise<any>>();
  const server = { registerTool(name: string, _meta: unknown, handler: (input: any) => Promise<any>) { tools.set(name, handler); } } as unknown as McpServer;
  const threadPeers = vi.fn(async () => [{ sessionId: 'thread-1', handle: 'builder', kind: 'thread' }]);
  const sendToThread = vi.fn(async () => ({ ok: true, delivery: 'queued' }));
  registerAgentRegistryTools(server, { sessionId: 'cli-1', projectId: 'p1', registry, getAgentStatus: () => 'working', threadPeers, teamLaunchId });
  const log = createAgentMessageLog();
  registerAgentMessagingTools(server, { sessionId: 'cli-1', projectId: 'p1', registry, messageLog: log,
    getAgentStatus: () => 'working', injectToSession: () => false, sendToThread });
  return { call: (name: string, input = {}) => tools.get(name)!(input), threadPeers, sendToThread, log, registry };
}
const value = (result: any) => JSON.parse(result.content[0].text);
describe('CLI tools share the native thread peer directory', () => {
  it('merges list and find results and avoids a native handle when registering', async () => {
    const fixture = setup();
    expect(value(await fixture.call('list_agents'))).toEqual(expect.arrayContaining([expect.objectContaining({ sessionId: 'cli-2' }), expect.objectContaining({ sessionId: 'thread-1', kind: 'thread' })]));
    expect(value(await fixture.call('find_agent', { handle: 'builder' }))).toEqual([expect.objectContaining({ sessionId: 'thread-1' })]);
    expect((await fixture.call('register_agent', { handle: 'builder' })).content[0].text).toContain('builder-2');
    expect(fixture.registry.get('cli-1')?.handle).toBe('builder-2');
  });
  it('keeps squad discovery isolated and tolerates an unavailable thread directory', async () => {
    const squad = setup('squad-1');
    expect(value(await squad.call('list_agents'))).toHaveLength(1);
    expect(value(await squad.call('find_agent', { handle: 'reviewer' }))).toHaveLength(1);
    await squad.call('register_agent', { handle: 'builder' });
    expect(squad.threadPeers).not.toHaveBeenCalled();
    const fixture = setup(); fixture.threadPeers.mockRejectedValue(new Error('offline'));
    expect(value(await fixture.call('list_agents'))).toHaveLength(1);
    expect(value(await fixture.call('find_agent', { handle: 'reviewer' }))).toHaveLength(1);
    expect((await fixture.call('register_agent', { handle: 'builder' })).isError).not.toBe(true);
  });
  it('resolves CLI handles and raw ids before invoking the thread fallback', async () => {
    const fixture = setup();
    await fixture.call('agent_send', { to: 'cli-2', message: 'by id' });
    await fixture.call('agent_send', { to: 'reviewer', message: 'by handle' });
    expect(fixture.sendToThread).not.toHaveBeenCalled(); expect(fixture.log.pull('cli-2')).toHaveLength(2);
    expect(value(await fixture.call('agent_send', { to: 'builder', message: 'native target', allProjects: true }))).toMatchObject({ ok: true });
    expect(fixture.sendToThread).toHaveBeenCalledWith({ to: 'builder', message: 'native target', allProjects: true });
    fixture.sendToThread.mockRejectedValue(new Error('refused'));
    expect(await fixture.call('agent_send', { to: 'unknown', message: 'fail' })).toMatchObject({ isError: true });
  });
});
