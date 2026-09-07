import { describe, expect, it, vi } from 'vitest';
import { createFakePluginHost, type FakePluginHostOptions } from '@zana-ai/zcc-plugin-sdk/testing';
import plugin, {
  EMPTY_FORK_MAX_AGE_MS,
  EMPTY_FORK_SWEEP_PAGE_SIZE,
  REPLY_SEED_PREFIX,
  eventsContainUserMessage,
  resolveReplySeedText
} from './server.js';

const PLUGIN_ID = 'side-chat';

function makeThread(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'p1',
    hostId: 'h1',
    environmentId: 'e1',
    providerId: 'codex',
    status: 'idle',
    originKind: 'fork' as const,
    originPluginId: PLUGIN_ID,
    visibility: 'hidden' as const,
    archivedAt: null,
    createdAt: Date.now(),
    parentThreadId: 'thr_src',
    ...extra
  };
}

function userTurnEvent() {
  return {
    seq: 1,
    type: 'client/turn/requested',
    payload: { input: [{ type: 'text', text: 'a reply', mentions: [] }] }
  };
}

function seedOnlyEvent() {
  return {
    seq: 1,
    type: 'client/turn/requested',
    payload: {
      input: [{ type: 'text', text: 'seed', mentions: [], visibility: 'agent-only' }]
    }
  };
}

async function loadPlugin(options: FakePluginHostOptions = {}) {
  const host = createFakePluginHost({ pluginId: PLUGIN_ID, ...options });
  await plugin(host.zcc);
  return host;
}

describe('resolveReplySeedText', () => {
  it('returns the trimmed anchor even when it is the latest source message', () => {
    expect(resolveReplySeedText('  latest answer  ')).toBe('latest answer');
  });

  it('returns the trimmed anchor for an earlier message', () => {
    expect(resolveReplySeedText(' earlier answer ')).toBe('earlier answer');
  });

  it('returns null for an empty anchor (tip forks carry no seed)', () => {
    expect(resolveReplySeedText('  ')).toBeNull();
  });
});

describe('createSideChat rpc', () => {
  it('does not read source events to decide whether to include the anchor', async () => {
    const listThreadEvents = vi.fn();
    const forkThread = vi.fn(async () => ({ id: 'thr_fork' }));
    const { harness } = await loadPlugin({ forkThread, listThreadEvents });

    await harness.callRpc('createSideChat', {
      sourceThreadId: 'thr_src',
      sourceSeqEnd: 7,
      anchorText: 'latest answer'
    });

    expect(listThreadEvents).not.toHaveBeenCalled();
    expect(forkThread.mock.calls[0]?.[0].agentContextSeed?.[0]).toMatchObject({
      text: `${REPLY_SEED_PREFIX}latest answer`
    });
  });

  it('forks hidden with a seed when the anchor is an earlier message', async () => {
    const forkThread = vi.fn(async () => ({ id: 'thr_fork' }));
    const { harness } = await loadPlugin({ forkThread });

    const result = await harness.callRpc('createSideChat', {
      sourceThreadId: 'thr_src',
      sourceSeqEnd: 42,
      anchorText: 'earlier answer'
    });

    expect(result).toEqual({ threadId: 'thr_fork' });
    expect(forkThread).toHaveBeenCalledWith({
      threadId: 'thr_src',
      sourceSeqEnd: 42,
      visibility: 'hidden',
      agentContextSeed: [
        {
          type: 'text',
          text: `${REPLY_SEED_PREFIX}earlier answer`,
          mentions: [],
          visibility: 'agent-only'
        }
      ]
    });
  });

  it('falls back to a tip fork when the anchor predates any provider session', async () => {
    const sessionUnavailable = Object.assign(
      new Error('Cannot fork: source has no active session to clone'),
      { code: 'fork_source_session_unavailable' }
    );
    const forkThread = vi
      .fn()
      .mockRejectedValueOnce(sessionUnavailable)
      .mockResolvedValueOnce({ id: 'thr_tip_fork' });
    const { harness } = await loadPlugin({ forkThread });

    const result = await harness.callRpc('createSideChat', {
      sourceThreadId: 'thr_src',
      sourceSeqEnd: 1,
      anchorText: 'earlier answer'
    });

    expect(result).toEqual({ threadId: 'thr_tip_fork' });
    expect(forkThread).toHaveBeenCalledTimes(2);
    expect(forkThread.mock.calls[1]?.[0]).not.toHaveProperty('sourceSeqEnd');
    expect(forkThread.mock.calls[1]?.[0].agentContextSeed?.[0]?.text).toContain('earlier answer');
  });

  it('rethrows point-fork failures that are not missing-session errors', async () => {
    const forkThread = vi.fn().mockRejectedValue(new Error('HTTP 403: forbidden'));
    const { harness } = await loadPlugin({ forkThread });

    await expect(
      harness.callRpc('createSideChat', {
        sourceThreadId: 'thr_src',
        sourceSeqEnd: 3,
        anchorText: 'x'
      })
    ).rejects.toThrow('forbidden');
    expect(forkThread).toHaveBeenCalledTimes(1);
  });

  it('does not fall back on message text alone — only the structured code triggers it', async () => {
    const messageOnly = new Error('Cannot fork: source has no active session to clone');
    const forkThread = vi.fn().mockRejectedValue(messageOnly);
    const { harness } = await loadPlugin({ forkThread });

    await expect(
      harness.callRpc('createSideChat', {
        sourceThreadId: 'thr_src',
        sourceSeqEnd: 3,
        anchorText: 'x'
      })
    ).rejects.toThrow('no active session');
    expect(forkThread).toHaveBeenCalledTimes(1);
  });

  it('forks from the tip without a seed or sourceSeqEnd for empty anchors', async () => {
    const forkThread = vi.fn(async () => ({ id: 'thr_fork' }));
    const { harness } = await loadPlugin({ forkThread });

    await harness.callRpc('createSideChat', {
      sourceThreadId: 'thr_src',
      anchorText: ''
    });

    expect(forkThread).toHaveBeenCalledWith({
      threadId: 'thr_src',
      visibility: 'hidden'
    });
  });
});

describe('sendToMain rpc', () => {
  it('queues the text on the source thread with the fork as sender', async () => {
    const createQueuedMessage = vi.fn(async () => ({ id: 'qm_1' }));
    const { harness } = await loadPlugin({ createQueuedMessage });

    const result = await harness.callRpc('sendToMain', {
      sourceThreadId: 'thr_src',
      senderThreadId: 'thr_fork',
      text: 'the answer'
    });

    expect(result).toEqual({ ok: true });
    expect(createQueuedMessage).toHaveBeenCalledWith({
      threadId: 'thr_src',
      input: [{ type: 'text', text: 'the answer', mentions: [] }],
      senderThreadId: 'thr_fork'
    });
  });
});

describe('empty-fork sweep', () => {
  it('eventsContainUserMessage ignores agent-only seed turns', () => {
    expect(eventsContainUserMessage([userTurnEvent()])).toBe(true);
    expect(eventsContainUserMessage([seedOnlyEvent()])).toBe(false);
  });

  it('archives only old forks without user messages', async () => {
    const now = Date.now();
    const old = now - EMPTY_FORK_MAX_AGE_MS - 60_000;
    const listThreads = vi.fn(async () => [
      makeThread('thr_empty_old', { createdAt: old }),
      makeThread('thr_replied_old', { createdAt: old }),
      makeThread('thr_empty_young', { createdAt: now - 60_000 }),
      makeThread('thr_foreign', { originPluginId: 'some-other-plugin', createdAt: old })
    ]);
    const listThreadEvents = vi.fn(async ({ threadId }: { threadId: string }) =>
      threadId === 'thr_replied_old' ? [userTurnEvent()] : [seedOnlyEvent()]
    );
    const archiveThread = vi.fn(async (args: { threadId: string }) => ({ id: args.threadId }));
    const { harness } = await loadPlugin({
      listThreads,
      listThreadEvents,
      archiveThread,
      listQueuedMessages: async () => []
    });

    await harness.runSchedule('empty-fork-cleanup');

    expect(listThreads).toHaveBeenCalledWith({
      includeHidden: true,
      originKind: 'fork',
      originPluginId: PLUGIN_ID,
      archived: false,
      limit: EMPTY_FORK_SWEEP_PAGE_SIZE,
      offset: 0
    });
    expect(archiveThread.mock.calls.map(([args]) => args)).toEqual([{ threadId: 'thr_empty_old' }]);
    expect(listThreadEvents.mock.calls.map(([args]) => args.threadId)).toEqual([
      'thr_empty_old',
      'thr_replied_old'
    ]);
  });

  it('advances the page offset by the forks it left behind', async () => {
    const now = Date.now();
    const old = now - EMPTY_FORK_MAX_AGE_MS - 60_000;
    const firstPage = Array.from({ length: EMPTY_FORK_SWEEP_PAGE_SIZE }, (_unused, index) =>
      makeThread(index === 0 ? 'thr_replied' : `thr_empty_${index}`, { createdAt: old })
    );
    const listThreads = vi.fn(async ({ offset }: { offset?: number }) =>
      offset === 0 ? firstPage : []
    );
    const { harness } = await loadPlugin({
      listThreads,
      listThreadEvents: async ({ threadId }: { threadId: string }) =>
        threadId === 'thr_replied' ? [userTurnEvent()] : [],
      archiveThread: async (args: { threadId: string }) => ({ id: args.threadId }),
      listQueuedMessages: async () => []
    });

    await harness.runSchedule('empty-fork-cleanup');

    expect(listThreads.mock.calls.map(([args]) => args.offset)).toEqual([0, 1]);
  });

  it('keeps an old empty-event fork that has queued-but-unsent input', async () => {
    const archiveThread = vi.fn(async (args: { threadId: string }) => ({ id: args.threadId }));
    const { harness } = await loadPlugin({
      listThreads: async () => [
        makeThread('thr_queued_only', { createdAt: Date.now() - EMPTY_FORK_MAX_AGE_MS - 60_000 })
      ],
      listThreadEvents: async () => [],
      archiveThread,
      listQueuedMessages: vi.fn(async () => [{ id: 'qm_1' }])
    });

    await harness.runSchedule('empty-fork-cleanup');

    expect(archiveThread).not.toHaveBeenCalled();
  });

  it('remembers a kept fork and stops re-reading its events', async () => {
    const listThreadEvents = vi.fn(async () => [userTurnEvent()]);
    const archiveThread = vi.fn(async (args: { threadId: string }) => ({ id: args.threadId }));
    const { harness } = await loadPlugin({
      listThreads: async () => [
        makeThread('thr_has_work', { createdAt: Date.now() - EMPTY_FORK_MAX_AGE_MS - 60_000 })
      ],
      listThreadEvents,
      archiveThread,
      listQueuedMessages: async () => []
    });

    await harness.runSchedule('empty-fork-cleanup');
    await harness.runSchedule('empty-fork-cleanup');

    expect(listThreadEvents).toHaveBeenCalledTimes(1);
    expect(archiveThread).not.toHaveBeenCalled();
  });

  it('retries a fork whose event read failed', async () => {
    const listThreadEvents = vi.fn(async () => {
      throw new Error('events unavailable');
    });
    const { harness } = await loadPlugin({
      listThreads: async () => [
        makeThread('thr_unreadable', { createdAt: Date.now() - EMPTY_FORK_MAX_AGE_MS - 60_000 })
      ],
      listThreadEvents,
      archiveThread: async (args: { threadId: string }) => ({ id: args.threadId }),
      listQueuedMessages: async () => []
    });

    await harness.runSchedule('empty-fork-cleanup');
    await harness.runSchedule('empty-fork-cleanup');

    expect(listThreadEvents).toHaveBeenCalledTimes(2);
  });

  it('fails closed when the queued-message read fails', async () => {
    const archiveThread = vi.fn(async (args: { threadId: string }) => ({ id: args.threadId }));
    const { harness } = await loadPlugin({
      listThreads: async () => [
        makeThread('thr_unreadable_queue', { createdAt: Date.now() - EMPTY_FORK_MAX_AGE_MS - 60_000 })
      ],
      listThreadEvents: async () => [],
      archiveThread,
      listQueuedMessages: vi.fn(async () => {
        throw new Error('queue read boom');
      })
    });

    await harness.runSchedule('empty-fork-cleanup');

    expect(archiveThread).not.toHaveBeenCalled();
  });
});
