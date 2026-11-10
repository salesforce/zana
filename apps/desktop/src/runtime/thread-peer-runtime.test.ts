import { expect, it, vi } from 'vitest';
import { createThreadPeerRuntime } from './thread-peer-runtime.js';
import { createAgentRegistryStore } from '@zana-ai/zcc-server/services/agents/agent-registry-store';
import { createAgentMessageLog } from '@zana-ai/zcc-server/services/agents/agent-message-log';
import type { AppConfig } from '@zana-ai/zcc-domain/product';

it('uses live main identity, excludes squads and preserves the latest peer hop', async () => {
  const registry = createAgentRegistryStore(), log = createAgentMessageLog();
  const sessions = new Map([['cli', { projectId: 'p', title: 'Live title' }], ['untitled', { projectId: 'p' }]]);
  const teamLaunchSessions = new Map<string, string>();
  const fetcher = vi.fn(async (_url: unknown, input: RequestInit | undefined) => Response.json({ ok: true, value: JSON.parse(input!.body as string).caller }));
  const runtime = createThreadPeerRuntime({ serverUrl: () => 'http://localhost', credential: () => 'test-only-secret'.repeat(4), fetch: fetcher as typeof fetch,
    store: { getConfig: () => ({}) }, ptys: { getSession: id => sessions.get(id), reply: () => true },
    teamLaunchSessions, registry, log, agentStatus: { get: () => 'idle' }, wrapUpClose: { isWrappingUp: () => false } });
  expect(await runtime.threadPeerTools('cli', 'list_agents', {})).toMatchObject({ sessionId: 'cli', projectId: 'p', displayName: 'Live title', hops: 0 });
  expect(await runtime.threadPeerTools('untitled', 'list_agents', {})).toMatchObject({ displayName: 'untitled' });
  registry.upsert({ sessionId: 'cli', projectId: 'p', cwd: '/tmp', handle: 'reviewer' });
  log.append({ fromSessionId: 'thread', fromHandle: 'Builder', toSessionId: 'other', toHandle: 'Other', projectId: 'p', body: 'unrelated' });
  log.append({ fromSessionId: 'thread', fromHandle: 'Builder', toSessionId: 'cli', toHandle: 'Reviewer', projectId: 'p',
    body: '[zcc message from thread:thread; hops:3; kind:thread]\nPeer: Builder\nCheck this' });
  expect(await runtime.threadPeerTools('cli', 'find_agent', {})).toMatchObject({ displayName: 'reviewer', hops: 3 });
  teamLaunchSessions.set('cli', 'private');
  await expect(runtime.threadPeerTools('cli', 'list_agents', {})).rejects.toThrow('live CLI');
  await expect(runtime.threadPeerTools('exited', 'list_agents', {})).rejects.toThrow('live CLI');
  expect(fetcher).toHaveBeenCalledTimes(3);
});

it('rechecks current configuration, generation, status and wrap-up before CLI injection', () => {
  const registry = createAgentRegistryStore(), log = createAgentMessageLog();
  registry.upsert({ sessionId: 'cli', projectId: 'p', cwd: '/tmp' });
  let config: Partial<AppConfig> = {}, wrapping = false;
  const reply = vi.fn(() => true);
  const runtime = createThreadPeerRuntime({ serverUrl: () => 'http://localhost', credential: () => 'unused',
    store: { getConfig: () => config }, ptys: { getSession: () => undefined, reply },
    teamLaunchSessions: new Map(), registry, log, agentStatus: { get: () => 'idle' }, wrapUpClose: { isWrappingUp: () => wrapping } });
  const input = { to: 'cli', projectId: 'p', fromSessionId: 'thread', fromHandle: 'Builder', message: 'Reviewed', generation: 0 };
  expect(runtime.sendPeerMessage(input)).toMatchObject({ ok: true, delivered: true });
  config = { threadCommunicationEnabled: false };
  expect(runtime.sendPeerMessage(input).ok).toBe(false);
  config = { threadCommunicationEnabled: true, threadCommunicationGeneration: 2 };
  expect(runtime.sendPeerMessage(input).ok).toBe(false);
  wrapping = true;
  expect(runtime.sendPeerMessage({ ...input, generation: 2 }).ok).toBe(false);
  expect(reply).toHaveBeenCalledOnce();
});
