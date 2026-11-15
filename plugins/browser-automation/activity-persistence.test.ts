import { expect, it, vi } from 'vitest';
import browserPlugin from './server.js';
import { createFakePluginHost, makeThreadResponse } from '../../packages/plugin-sdk/src/testing/index.js';
const threadId = 'activity-test';
  it.each([new Error('synthetic activity storage failure'), 'storage offline'])('Browser returns successful output if final activity persistence fails: %s', async (failure) => {
    const worker = vi.fn(async ({ method }: { method: string }) => method === 'prepare' ? { status: 'ready', version: 'test', source: 'release' } : method === 'run' ? { text: 'done', images: [], exitCode: 0 } : null);
    const host = createFakePluginHost({ pluginId: 'browser-automation', agentSkillIds: ['browser-automation'], experimental_callHostRpc: worker });
    host.harness.sdk.stub('threads.get', async () => makeThreadResponse({ id: threadId }));
    host.harness.sdk.stub('hosts.list', async () => [{ id: 'local-host', name: 'Review host' }]);
    await browserPlugin(host.bb);
    let spy: ReturnType<typeof vi.spyOn> | undefined;
    try {
      const session = await host.harness.behavior.callRpc('open', { threadId, selection: { backend: 'local', hostId: 'local-host' } }) as { id: string };
      spy = vi.spyOn(host.bb.storage.kv, 'set').mockRejectedValue(failure);
      await expect(host.harness.behavior.callRpc('run', { threadId, sessionId: session.id, script: 'return 1', timeoutMs: 1000 })).resolves.toMatchObject({ text: 'done', exitCode: 0 });
    } finally {
      spy?.mockRestore();
      await host.harness.lifecycle.dispose();
    }
  });

it('keeps a successful result when its session is closed while the browser is running', async () => {
  let release!: (value: { text: string; images: never[]; exitCode: number }) => void;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const worker = vi.fn(async ({ method }: { method: string }) => {
    if (method === 'prepare') return { status: 'ready', version: 'test', source: 'release' };
    if (method === 'run') {
      started();
      return new Promise(resolve => { release = resolve; });
    }
    return null;
  });
  const host = createFakePluginHost({ pluginId: 'browser-automation', agentSkillIds: ['browser-automation'], experimental_callHostRpc: worker });
  host.harness.sdk.stub('threads.get', async () => makeThreadResponse({ id: threadId }));
  host.harness.sdk.stub('hosts.list', async () => [{ id: 'local-host', name: 'Review host' }]);
  await browserPlugin(host.bb);
  try {
    const session = await host.harness.behavior.callRpc('open', { threadId, selection: { backend: 'local', hostId: 'local-host' } }) as { id: string };
    const running = host.harness.behavior.callRpc('run', { threadId, sessionId: session.id, script: 'return 1', timeoutMs: 1000 });
    await ready;
    await host.harness.behavior.callRpc('close', { threadId, sessionId: session.id });
    release({ text: 'done', images: [], exitCode: 0 });
    await expect(running).resolves.toMatchObject({ text: 'done', exitCode: 0 });
    expect(await host.harness.behavior.callRpc('list', { threadId })).toMatchObject([{ id: session.id, state: 'closed' }]);
  } finally { await host.harness.lifecycle.dispose(); }
});
