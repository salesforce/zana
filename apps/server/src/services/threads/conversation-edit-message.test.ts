import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerThreadProvider } from './thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { editConversationMessage, latestProviderCheckpoint } from './conversation-edit-message.js';

const thread = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'proj-1',
  hostId: 'host-1',
  environmentId: '22222222-2222-4222-8222-222222222222',
  providerId: 'claude-code',
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
  listConversationThreadEvents: vi.fn(() => []),
  listConversationThreadEventsWindow: vi.fn(() => []),
  setConversationProviderThreadId: vi.fn(),
  deleteConversationThreadEventsAfter: vi.fn(() => 1)
}));

vi.mock('./conversation-lifecycle.js', () => ({
  sendConversationTurn: vi.fn(async () => thread),
  stopConversation: vi.fn(async () => ({ ...thread, status: 'idle' }))
}));

import {
  deleteConversationThreadEventsAfter,
  getConversationThread,
  getEnvironment,
  listConversationThreadEvents
} from '@zana-ai/zcc-db';
import { sendConversationTurn, stopConversation } from './conversation-lifecycle.js';

function ctx(callHostOnlineRpc: (input: unknown) => Promise<unknown>): ProductHttpContext {
  const pluginHostArtifacts = new PluginHostArtifactRegistry();
  pluginHostArtifacts.set('test', {
    path: '/tmp/host.js',
    digest: 'a'.repeat(64),
    byteLength: 12,
    generation: 'g1'
  });
  return {
    db: {},
    dataDir: '/tmp/zcc-data',
    hub: { emit: vi.fn() },
    hostHub: { callHostOnlineRpc },
    pluginHostArtifacts,
    pendingInteractions: {
      hasPendingThreadInteraction: () => false
    }
  } as unknown as ProductHttpContext;
}

const providerHandles: Array<{ unregister(): void }> = [];

beforeEach(() => {
  providerHandles.push(
    registerThreadProvider('test', {
      id: 'claude-code',
      displayName: 'Claude Code',
      capabilities: {
        supportsServiceTier: false,
        fork: 'checkpoint',
        supportsThreadArchive: false,
        supportsThreadRename: false,
        permissionModes: ['full']
      }
    })
  );
  vi.mocked(getConversationThread).mockReturnValue(thread);
  vi.mocked(listConversationThreadEvents).mockReturnValue([
    {
      id: 'evt-1',
      threadId: thread.id,
      sequence: 4,
      type: 'turn/completed',
      payload: { type: 'turn/completed', providerCheckpointId: 'cp-4' },
      createdAt: 4
    }
  ]);
  vi.mocked(sendConversationTurn).mockClear();
  vi.mocked(stopConversation).mockClear();
  vi.mocked(deleteConversationThreadEventsAfter).mockClear();
});

afterEach(() => {
  for (const handle of providerHandles.splice(0)) handle.unregister();
});

describe('latestProviderCheckpoint', () => {
  it('reads a nested providerCheckpointId from the newest event', () => {
    expect(latestProviderCheckpoint([
      { sequence: 1, payload: { providerCheckpointId: 'old' } },
      { sequence: 2, payload: { event: { providerCheckpointId: 'new' } } }
    ])).toEqual({ sequence: 2, checkpoint: 'new' });
    expect(latestProviderCheckpoint([
      { sequence: 3, payload: { payload: { providerCheckpointId: 'wrapped' } } }
    ])).toEqual({ sequence: 3, checkpoint: 'wrapped' });
  });
});

describe('editConversationMessage', () => {
  it('prepares a rewind, truncates events, then submits the replacement turn', async () => {
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'thread.rewind.prepare') {
        return { threadId: thread.id, prepared: true, providerThreadId: 'prov-rewound' };
      }
      return {};
    });
    await expect(editConversationMessage(ctx(callHostOnlineRpc), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).resolves.toEqual({
      ok: true,
      operationId: 'op-1',
      requestSequence: 4
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'thread.rewind.prepare',
        sourceProviderThreadId: 'prov-1',
        retainThroughProviderCheckpoint: 'cp-4'
      })
    }));
    expect(deleteConversationThreadEventsAfter).toHaveBeenCalledWith(expect.anything(), thread.id, 4);
    expect(sendConversationTurn).toHaveBeenCalledWith(
      expect.anything(),
      thread.id,
      [{ type: 'text', text: 'replacement' }],
      'auto',
      expect.objectContaining({})
    );
    expect(stopConversation).not.toHaveBeenCalled();
  });

  it('stops an active thread before rewind', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, status: 'active' });
    const callHostOnlineRpc = vi.fn(async () => ({
      threadId: thread.id,
      prepared: true,
      providerThreadId: 'prov-rewound'
    }));
    await editConversationMessage(ctx(callHostOnlineRpc), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    });
    expect(stopConversation).toHaveBeenCalled();
  });

  it('discards a staged rewind when submit fails', async () => {
    vi.mocked(sendConversationTurn).mockRejectedValueOnce(new Error('submit failed'));
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'thread.rewind.prepare') {
        return { threadId: thread.id, prepared: true, providerThreadId: 'prov-rewound' };
      }
      return { leaseId: 'lease', discarded: true };
    });
    await expect(editConversationMessage(ctx(callHostOnlineRpc), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).rejects.toThrow('submit failed');
    expect(callHostOnlineRpc.mock.calls.map((call) => (call[0] as { command: { type: string } }).command.type))
      .toEqual(['thread.rewind.prepare', 'thread.rewind.discard']);
  });

  it('409s when the thread has no checkpoint', async () => {
    vi.mocked(listConversationThreadEvents).mockReturnValue([]);
    await expect(editConversationMessage(ctx(vi.fn()), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).rejects.toMatchObject({ status: 409, code: 'invalid_request' });
  });

  it('rejects unknown, non-rewind, pending, and unrecovered threads', async () => {
    vi.mocked(getConversationThread).mockReturnValueOnce(null);
    await expect(editConversationMessage(ctx(vi.fn()), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).rejects.toMatchObject({ status: 404, code: 'unknown-thread' });

    vi.mocked(getConversationThread).mockReturnValue({ ...thread, providerId: 'acp-cursor' });
    await expect(editConversationMessage(ctx(vi.fn()), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).rejects.toMatchObject({ status: 409, code: 'invalid_request' });

    vi.mocked(getConversationThread).mockReturnValue(thread);
    const pending = ctx(vi.fn());
    pending.pendingInteractions.hasPendingThreadInteraction = () => true;
    await expect(editConversationMessage(pending, thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).rejects.toMatchObject({ status: 409, code: 'awaiting_user_interaction' });

    vi.mocked(getConversationThread).mockReturnValue({ ...thread, providerThreadId: null });
    await expect(editConversationMessage(ctx(vi.fn()), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).rejects.toMatchObject({ status: 409, code: 'not_resumable' });

    vi.mocked(getConversationThread).mockReturnValue(thread);
    vi.mocked(getEnvironment).mockReturnValueOnce(null);
    await expect(editConversationMessage(ctx(vi.fn()), thread.id, {
      operationId: 'op-1',
      input: [{ type: 'text', text: 'replacement' }]
    })).rejects.toMatchObject({ status: 409, code: 'environment_not_ready' });
  });
});
