import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerThreadProvider } from './thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import {
  archiveConversationOnHost,
  clearConversationGoal,
  renameConversationOnHost,
  unarchiveConversationOnHost
} from './thread-host-commands.js';

const thread = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'proj-1',
  hostId: 'host-1',
  environmentId: '22222222-2222-4222-8222-222222222222',
  providerId: 'codex',
  status: 'idle' as const,
  originKind: null,
  visibility: 'visible' as const,
  title: 'Hello',
  providerThreadId: 'prov-1',
  parentThreadId: null,
  archivedAt: null,
  createdAt: 1,
  updatedAt: 1
};

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(() => thread),
  getEnvironment: vi.fn(() => ({ id: thread.environmentId, path: '/tmp/proj' })),
  listConversationThreadEventsWindow: vi.fn(() => []),
  setConversationProviderThreadId: vi.fn()
}));

import { getConversationThread, getEnvironment } from '@zana-ai/zcc-db';

function stubArtifacts(pluginId = 'test'): PluginHostArtifactRegistry {
  const artifacts = new PluginHostArtifactRegistry();
  artifacts.set(pluginId, {
    path: '/tmp/host.js',
    digest: 'a'.repeat(64),
    byteLength: 12,
    generation: 'g1'
  });
  return artifacts;
}

function ctx(callHostOnlineRpc: (input: unknown) => Promise<unknown>): ProductHttpContext {
  return {
    db: {},
    dataDir: '/tmp/zcc-data',
    hub: { emit: vi.fn() },
    hostHub: { callHostOnlineRpc },
    pluginHostArtifacts: stubArtifacts()
  } as unknown as ProductHttpContext;
}

const providerHandles: Array<{ unregister(): void }> = [];

beforeEach(() => {
  providerHandles.push(
    registerThreadProvider('test', {
      id: 'codex',
      displayName: 'Codex',
      capabilities: {
        supportsServiceTier: false,
        fork: 'checkpoint',
        supportsThreadArchive: true,
        supportsThreadRename: true,
        permissionModes: ['full']
      }
    })
  );
  vi.mocked(getConversationThread).mockReturnValue(thread);
  vi.mocked(getEnvironment).mockReturnValue({ id: thread.environmentId, path: '/tmp/proj' } as never);
});

afterEach(() => {
  for (const handle of providerHandles.splice(0)) handle.unregister();
});

describe('thread host commands', () => {
  it('renames on the host when the provider supports it', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, renamed: true }));
    await renameConversationOnHost(ctx(callHostOnlineRpc), thread, 'Hello 2');
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: thread.hostId,
      command: {
        type: 'thread.rename',
        threadId: thread.id,
        environmentId: thread.environmentId,
        title: 'Hello 2'
      }
    });
  });

  it('skips rename when the provider does not support it', async () => {
    const callHostOnlineRpc = vi.fn();
    await renameConversationOnHost(ctx(callHostOnlineRpc), { ...thread, providerId: 'claude-code' }, 'Hello 2');
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('swallows a failed live rename', async () => {
    const callHostOnlineRpc = vi.fn(async () => {
      throw Object.assign(new Error('thread is not running on this host'), { code: 'unknown_thread' });
    });
    await expect(renameConversationOnHost(ctx(callHostOnlineRpc), thread, 'Hello 2')).resolves.toBeUndefined();
  });

  it('archives on the host before environment teardown', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, archived: true }));
    await archiveConversationOnHost(ctx(callHostOnlineRpc), thread);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      hostId: thread.hostId,
      command: expect.objectContaining({
        type: 'thread.archive',
        threadId: thread.id,
        environmentId: thread.environmentId,
        providerId: 'codex',
        providerThreadId: 'prov-1',
        cwd: '/tmp/proj'
      })
    }));
  });

  it('skips archive when the environment has no path', async () => {
    vi.mocked(getEnvironment).mockReturnValue({ id: thread.environmentId, path: null } as never);
    const callHostOnlineRpc = vi.fn();
    await archiveConversationOnHost(ctx(callHostOnlineRpc), thread);
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('skips archive RPC when the provider cannot archive', async () => {
    const callHostOnlineRpc = vi.fn();
    await archiveConversationOnHost(ctx(callHostOnlineRpc), { ...thread, providerId: 'claude-code' });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('unarchives on the host when the environment is still present', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, unarchived: true }));
    await unarchiveConversationOnHost(ctx(callHostOnlineRpc), { ...thread, archivedAt: 9 });
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({ type: 'thread.unarchive', providerThreadId: 'prov-1' })
    }));
  });

  it('409s unarchive when the environment is gone', async () => {
    vi.mocked(getEnvironment).mockReturnValue(null);
    const callHostOnlineRpc = vi.fn();
    await expect(unarchiveConversationOnHost(ctx(callHostOnlineRpc), thread))
      .rejects.toMatchObject({ status: 409, code: 'environment_not_ready' });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('clears a Codex goal and retries after unknown_thread', async () => {
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'thread.goal.clear' && callHostOnlineRpc.mock.calls.length === 1) {
        throw Object.assign(new Error('thread is not running on this host'), { code: 'unknown_thread' });
      }
      if (input.command.type === 'thread.resume') return { threadId: thread.id, resumed: true, providerThreadId: 'prov-1' };
      return { threadId: thread.id, cleared: true };
    });
    await expect(clearConversationGoal(ctx(callHostOnlineRpc), thread.id)).resolves.toEqual({ ok: true });
    expect(callHostOnlineRpc.mock.calls.map((call) => (call[0] as { command: { type: string } }).command.type)).toEqual([
      'thread.goal.clear',
      'thread.resume',
      'thread.goal.clear'
    ]);
  });

  it('rejects goal clear for a non-Codex provider', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, providerId: 'claude-code' });
    await expect(clearConversationGoal(ctx(vi.fn()), thread.id))
      .rejects.toMatchObject({ status: 409, code: 'invalid_request' });
  });

  it('404s goal clear for an unknown thread and 409s without an environment', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce(null);
    await expect(clearConversationGoal(ctx(vi.fn()), thread.id))
      .rejects.toMatchObject({ status: 404, code: 'unknown-thread' });
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, environmentId: null });
    await expect(clearConversationGoal(ctx(vi.fn()), thread.id))
      .rejects.toMatchObject({ status: 409, code: 'environment_not_ready' });
  });

  it('rethrows a non-unknown_thread goal-clear failure', async () => {
    const callHostOnlineRpc = vi.fn(async () => {
      throw Object.assign(new Error('host down'), { code: 'host-unavailable' });
    });
    await expect(clearConversationGoal(ctx(callHostOnlineRpc), thread.id)).rejects.toMatchObject({
      code: 'host-unavailable'
    });
  });
});
