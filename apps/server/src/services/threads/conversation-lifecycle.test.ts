import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerThreadProvider } from './thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { archiveConversation, cancelConversationPlan, forkConversation, resumeConversation, sendConversationTurn, stopConversation, unarchiveConversation } from './conversation-lifecycle.js';
import { conversationTimeline } from './conversation-timeline.js';
import {
  hasLatestRootTurnCompleted,
  hasTerminalClientTurnRequestEvent,
  settleLiveTurnCommandFailure
} from './conversation-turn-settlement.js';
import { LIVE_TURN_COMMAND_TIMEOUT_MS } from '../../http/host-hub.js';

const thread = {
  id: '11111111-1111-4111-8111-111111111111',
  projectId: 'proj-1',
  hostId: 'host-1',
  environmentId: '22222222-2222-4222-8222-222222222222',
  providerId: 'claude-code',
  status: 'idle' as const,
  originKind: null,
  originPluginId: null,
  visibility: 'visible' as const,
  title: 'Hello',
  providerThreadId: 'prov-1',
  parentThreadId: null,
  archivedAt: null,
  pinnedAt: null,
  pinOrder: null,
  createdAt: 1,
  updatedAt: 1
};

vi.mock('@zana-ai/zcc-db', () => {
  const listConversationThreadEvents = vi.fn(() => [{
    id: 'evt-1',
    threadId: thread.id,
    sequence: 1,
    type: 'turn/completed',
    payload: {
        type: 'turn/completed',
        threadId: thread.id,
        scope: { kind: 'turn', turnId: 'turn-1' }
      },
    createdAt: 1
  }]);
  return {
  DEFERRED_THREAD_MESSAGE_CAP: 50,
  getConversationThread: vi.fn(() => thread),
  applyConversationThreadLifecycleEvent: vi.fn((_db, args) => {
    const nextStatus = args.event.type === 'run.started' ? 'active'
      : args.event.type === 'run.failed' ? 'error'
        : args.event.type === 'stop.requested' ? 'stopping'
          : args.event.type === 'stop.settled' || args.event.type === 'run.succeeded' ? 'idle'
            : thread.status;
    return { applied: true, thread: { ...thread, id: args.threadId, status: nextStatus } };
  }),
  getLatestSessionForHost: vi.fn(() => null),
  listLiveConversationThreadsForHost: vi.fn(() => []),
  setConversationProviderThreadId: vi.fn(),
  archiveConversationThread: vi.fn(),
  unarchiveConversationThread: vi.fn((_db, id) => ({ ...thread, id, archivedAt: null })),
  appendConversationThreadEvent: vi.fn((_db, input) => ({
    id: 'evt-client',
    threadId: input.threadId,
    sequence: 2,
    type: input.type,
    payload: input.payload,
    createdAt: 2
  })),
  createConversationThread: vi.fn((_db, input) => ({
    ...thread,
    id: '33333333-3333-4333-8333-333333333333',
    originKind: input.originKind ?? null,
    originPluginId: input.originPluginId ?? null,
    visibility: input.visibility ?? 'visible',
    parentThreadId: input.parentThreadId ?? null,
    title: input.title,
    status: input.status ?? 'starting'
  })),
  copyConversationThreadEvents: vi.fn((_db, input) => input.rows.map((row: { type: string }, index: number) => ({
    ...row,
    id: `fork-evt-${index + 1}`,
    threadId: input.targetThreadId,
    sequence: index + 1
  }))),
  countDeferredThreadMessages: vi.fn(() => 0),
  countActiveConversationTurns: vi.fn(() => 0),
  createDeferredThreadMessage: vi.fn((_db, input) => ({
    id: 'dmsg_1',
    threadId: input.threadId,
    kind: input.kind,
    payload: input.payload,
    createdAt: 1,
    status: 'queued',
    paused: false,
    sendAfter: null,
    failureReason: null,
    groupBoundaryId: null,
    updatedAt: 1
  })),
  deleteDeferredThreadMessagesForThread: vi.fn(() => 0),
  pauseDeferredThreadMessagesForThread: vi.fn(() => 0),
  resumeDeferredThreadMessagesForThread: vi.fn(() => 0),
  isThreadQueueAutoSendPaused: vi.fn(() => false),
  listDueDeferredThreadMessages: vi.fn(() => []),
  markDeferredThreadMessageDispatching: vi.fn(() => true),
  markDeferredThreadMessageFailed: vi.fn(() => true),
  listDeferredThreadMessages: vi.fn(() => []),
  deleteDeferredThreadMessage: vi.fn(() => false),
  getEnvironment: vi.fn(() => ({ id: thread.environmentId, path: '/tmp/proj' })),
  getThreadPlanByRootThread: vi.fn(() => null),
  getThreadExecutionState: vi.fn(() => null),
  latestThreadPlanRevision: vi.fn(() => null),
  listThreadPlanTasks: vi.fn(() => []),
  listThreadPlanReferences: vi.fn(() => []),
  upsertThreadExecutionState: vi.fn(),
  createThreadPlan: vi.fn((_db, input) => ({
    id: 'plan-1',
    rootThreadId: input.rootThreadId,
    status: 'draft',
    filePath: null,
    createdAt: 1,
    updatedAt: 1
  })),
  addThreadPlanReference: vi.fn(),
  hasPendingInteractionForThread: vi.fn(() => false),
  countLiveThreadsForEnvironment: vi.fn(() => 1),
  countConversationThreadEvents: vi.fn(() => listConversationThreadEvents().length),
  listConversationThreadEventsWindow: vi.fn(() => listConversationThreadEvents()),
  nextConversationEventSequence: vi.fn(() => 1),
  maxConversationEventSequenceByThreadIds: vi.fn(() => ({})),
  listConversationThreadsForHost: vi.fn(() => []),
  listConversationThreadsByProject: vi.fn(() => []),
  getHost: vi.fn(() => ({ id: 'host-1', maxPermissionMode: 'full' })),
  listConversationThreadEvents
  };
});

import {
  appendConversationThreadEvent,
  copyConversationThreadEvents,
  createConversationThread,
  createDeferredThreadMessage,
  deleteDeferredThreadMessagesForThread,
  getConversationThread,
  getEnvironment,
  archiveConversationThread,
  listConversationThreadEvents,
  listConversationThreadEventsWindow,
  listConversationThreadsByProject,
  pauseDeferredThreadMessagesForThread,
  setConversationProviderThreadId,
  unarchiveConversationThread,
  applyConversationThreadLifecycleEvent,
  getThreadExecutionState,
  upsertThreadExecutionState
} from '@zana-ai/zcc-db';

function lifecycleCall(type: 'run.started' | 'run.failed' | 'stop.requested' | 'stop.settled' | 'run.succeeded') {
  return [expect.anything(), expect.objectContaining({ threadId: thread.id, event: { type } })];
}

function pendingInteractionsStub(overrides?: {
  hasPendingThreadInteraction?: boolean;
}): ProductHttpContext['pendingInteractions'] {
  return {
    hasPendingThreadInteraction: () => overrides?.hasPendingThreadInteraction ?? false,
    interruptPendingInteractionsForThreadIds: vi.fn(() => [])
  } as unknown as ProductHttpContext['pendingInteractions'];
}

function ctx(callHostOnlineRpc: (input: unknown) => Promise<unknown>): ProductHttpContext {
  const pluginHostArtifacts = new PluginHostArtifactRegistry();
  pluginHostArtifacts.set('test', {
    path: '/tmp/host.js',
    digest: 'a'.repeat(64),
    byteLength: 12,
    generation: 'g1'
  });
  return {
    db: { transaction: (fn: () => unknown) => fn() },
    dataDir: '/tmp/zcc-data',
    hub: { emit: vi.fn() },
    hostHub: { callHostOnlineRpc, connectedHostIds: () => ['host-1'] },
    pluginHostArtifacts,
    plugins: {
      emitThreadEvent: vi.fn().mockResolvedValue(undefined)
    },
    pendingInteractions: pendingInteractionsStub()
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
      },
      composerActions: ['plan']
    })
  );
  vi.mocked(getConversationThread).mockReturnValue(thread);
  vi.mocked(applyConversationThreadLifecycleEvent).mockImplementation((_db, args) => {
    const nextStatus = args.event.type === 'run.started' ? 'active'
      : args.event.type === 'run.failed' ? 'error'
        : args.event.type === 'stop.requested' ? 'stopping'
          : args.event.type === 'stop.settled' || args.event.type === 'run.succeeded' ? 'idle'
            : thread.status;
    return { applied: true, thread: { ...thread, id: args.threadId, status: nextStatus } };
  });
  vi.mocked(listConversationThreadEventsWindow).mockImplementation(() => listConversationThreadEvents());
  vi.mocked(setConversationProviderThreadId).mockReset();
  vi.mocked(createDeferredThreadMessage).mockClear();
  vi.mocked(pauseDeferredThreadMessagesForThread).mockClear();
  vi.mocked(deleteDeferredThreadMessagesForThread).mockClear();
});

afterEach(() => {
  for (const handle of providerHandles.splice(0)) handle.unregister();
});

describe('conversation lifecycle', () => {
  it('sends a follow-up turn through turn.submit', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(ctx(callHostOnlineRpc), thread.id, [{ type: 'text', text: 'follow up' }], 'queue-if-active');
    expect(applyConversationThreadLifecycleEvent).toHaveBeenCalledWith(...lifecycleCall('run.started'));
    expect(applyConversationThreadLifecycleEvent).not.toHaveBeenCalledWith(...lifecycleCall('run.failed'));
    expect(appendConversationThreadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: thread.id,
        type: 'client/turn/requested'
      })
    );
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      timeoutMs: LIVE_TURN_COMMAND_TIMEOUT_MS,
      command: expect.objectContaining({
        type: 'turn.submit',
        input: ['follow up'],
        mode: 'start',
        clientRequestId: expect.stringMatching(/^creq_/),
        resume: expect.objectContaining({
          providerThreadId: 'prov-1',
          providerId: 'claude-code',
          cwd: '/tmp/proj',
          permissionMode: 'accept-edits'
        }),
        permissionEscalation: 'ask'
      })
    }));
    expect(upsertThreadExecutionState).toHaveBeenCalledWith(expect.anything(), {
      threadId: thread.id,
      requestedMode: 'agent',
      effectiveMode: 'agent'
    });
  });

  it('appends agent-only plugin mention context before turn.submit', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    const resolveMention = vi.fn(async () => ({ ok: true as const, context: 'Issue body' }));
    const context = {
      ...ctx(callHostOnlineRpc),
      plugins: { resolveMention, emitThreadEvent: vi.fn(async () => undefined) }
    } as unknown as ProductHttpContext;
    await sendConversationTurn(context, thread.id, [{
      type: 'text',
      text: 'fix @bug',
      mentions: [{
        start: 4,
        end: 8,
        resource: { kind: 'plugin', pluginId: 'github', itemId: 'issue:acme/app#1', label: 'bug' }
      }]
    }]);
    expect(resolveMention).toHaveBeenCalledWith({ pluginId: 'github', itemId: 'issue:acme/app#1' });
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        input: expect.arrayContaining([
          'fix @bug',
          expect.stringContaining('Issue body')
        ])
      })
    }));
  });

  it('sends an image-only follow-up as a host disk marker', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(
      ctx(callHostOnlineRpc),
      thread.id,
      [{ type: 'localImage', path: 'shot.png' }]
    );
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        input: [
          '[Attached image. It is on disk at /tmp/zcc-data/attachments/proj-1/shot.png — use the Read tool to view it.]'
        ]
      })
    }));
  });

  it('forwards model and reasoningLevel on follow-up turn.submit', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(
      ctx(callHostOnlineRpc),
      thread.id,
      [{ type: 'text', text: 'follow up' }],
      'auto',
      { model: 'claude-sonnet-5', reasoningLevel: 'high' }
    );
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        model: 'claude-sonnet-5',
        reasoningLevel: 'high'
      })
    }));
  });

  it('resumes then resubmits when the host no longer has the thread', async () => {
    let submits = 0;
    const callHostOnlineRpc = vi.fn(async (input: { command: { type: string } }) => {
      if (input.command.type === 'turn.submit') {
        submits += 1;
        if (submits === 1) {
          throw Object.assign(new Error('thread is not running on this host'), { code: 'unknown_thread' });
        }
        return { threadId: thread.id, accepted: true };
      }
      return { threadId: thread.id, resumed: true, providerThreadId: 'prov-1' };
    });
    await sendConversationTurn(ctx(callHostOnlineRpc), thread.id, [{ type: 'text', text: 'follow up' }]);
    await vi.waitFor(() => {
      expect(callHostOnlineRpc.mock.calls.map((call) => call[0].command.type)).toEqual([
        'turn.submit',
        'thread.resume',
        'turn.submit'
      ]);
    });
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'thread.resume',
        providerThreadId: 'prov-1'
      })
    }));
  });

  it('does not resume a follow-up when the host has no provider session to restore', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, providerThreadId: null });
    const callHostOnlineRpc = vi.fn(async () => {
      throw Object.assign(new Error('thread is not running on this host'), { code: 'unknown_thread' });
    });
    const product = ctx(callHostOnlineRpc);
    const sent = await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }]);
    expect(sent.id).toBe(thread.id);
    await vi.waitFor(() => {
      expect(applyConversationThreadLifecycleEvent).toHaveBeenCalledWith(...lifecycleCall('run.failed'));
    });
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
    expect(product.hub.emit).toHaveBeenCalledWith(
      'threads:updated',
      expect.objectContaining({ id: thread.id, status: 'error' })
    );
  });

  it('recovers a provider session from stored events before sending a follow-up', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, providerThreadId: null });
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      {
        id: 'evt-identity',
        threadId: thread.id,
        sequence: 1,
        type: 'thread/identity',
        payload: { type: 'thread/identity', providerThreadId: 'prov-from-event' },
        createdAt: 1
      }
    ]);
    vi.mocked(setConversationProviderThreadId).mockReturnValue({
      ...thread,
      providerThreadId: 'prov-from-event'
    });
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(ctx(callHostOnlineRpc), thread.id, [{ type: 'text', text: 'follow up' }]);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        resume: expect.objectContaining({ providerThreadId: 'prov-from-event' })
      })
    }));
  });

  it('resumes with the stored providerThreadId', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, resumed: true, providerThreadId: 'prov-1' }));
    await resumeConversation(ctx(callHostOnlineRpc), thread.id);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'thread.resume',
        providerThreadId: 'prov-1',
        providerId: 'claude-code'
      })
    }));
  });

  it('packs plugin tools onto thread.resume and turn.submit resume', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, resumed: true, providerThreadId: 'prov-1' }));
    const product = ctx(callHostOnlineRpc);
    product.plugins = {
      sessionTools: async () => ({
        tools: [{ name: 'sf_soql', description: 'SOQL', inputSchema: { type: 'object' } }],
        instructions: 'Use sf_soql.'
      }),
      emitThreadEvent: vi.fn(async () => undefined)
    } as ProductHttpContext['plugins'];
    await resumeConversation(product, thread.id);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'thread.resume',
        dynamicTools: expect.arrayContaining([
          expect.objectContaining({ name: 'preview_file' }),
          expect.objectContaining({ name: 'sf_soql' })
        ]),
        instructions: expect.stringContaining('Use sf_soql.')
      })
    }));
    callHostOnlineRpc.mockClear();
    callHostOnlineRpc.mockResolvedValue({ threadId: thread.id, accepted: true });
    await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }]);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        resume: expect.objectContaining({
          dynamicTools: expect.arrayContaining([
            expect.objectContaining({ name: 'preview_file' }),
            expect.objectContaining({ name: 'sf_soql' })
          ]),
          instructions: expect.stringContaining('Use sf_soql.')
        })
      })
    }));
  });

  it('still resumes when plugin sessionTools throws', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, resumed: true, providerThreadId: 'prov-1' }));
    const product = ctx(callHostOnlineRpc);
    product.plugins = {
      sessionTools: async () => {
        throw new Error('configure failed');
      },
      emitThreadEvent: vi.fn(async () => undefined)
    } as ProductHttpContext['plugins'];
    await resumeConversation(product, thread.id);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'thread.resume',
        providerThreadId: 'prov-1'
      })
    }));
    const command = callHostOnlineRpc.mock.calls[0]?.[0] as { command: { dynamicTools?: Array<{ name?: string }> } };
    expect(command.command.dynamicTools?.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(['preview_file', 'browser_open', 'inbox_push'])
    );
    expect(command.command.dynamicTools?.[0]?.name).toBe('preview_file');
  });

  it('forks a child conversation thread without mixing PTY rows', async () => {
    const namer = { request: vi.fn(), reserve: vi.fn() };
    const product = ctx(async () => ({}));
    product.threadTitleNamer = namer as unknown as ProductHttpContext['threadTitleNamer'];
    const forked = await forkConversation(product, thread.id);
    expect(createConversationThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parentThreadId: thread.id,
        originKind: 'fork'
      })
    );
    expect(forked.originKind).toBe('fork');
    expect(forked.parentThreadId).toBe(thread.id);
    expect(namer.reserve).toHaveBeenCalledWith(forked.id);
    expect(namer.request).not.toHaveBeenCalled();
  });

  it('forks a hidden plugin-owned child with an agent-only seed', async () => {
    const product = ctx(async () => ({}));
    const forked = await forkConversation(product, thread.id, {
      visibility: 'hidden',
      originPluginId: 'side-chat',
      agentContextSeed: [{
        type: 'text',
        text: 'Replying to this earlier message in the conversation:\n\nhello',
        mentions: [],
        visibility: 'agent-only'
      }]
    });
    expect(createConversationThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parentThreadId: thread.id,
        originKind: 'fork',
        originPluginId: 'side-chat',
        visibility: 'hidden'
      })
    );
    expect(forked.visibility).toBe('hidden');
    expect(forked.originPluginId).toBe('side-chat');
    expect(appendConversationThreadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: forked.id,
        type: 'client/turn/requested'
      })
    );
  });

  it('archives hidden children when the source thread is archived', async () => {
    const child = {
      ...thread,
      id: '44444444-4444-4444-8444-444444444444',
      parentThreadId: thread.id,
      originKind: 'fork' as const,
      originPluginId: 'side-chat',
      visibility: 'hidden' as const,
      title: 'Side'
    };
    vi.mocked(getConversationThread).mockImplementation((_db, id) => {
      if (id === child.id) return child;
      return { ...thread };
    });
    vi.mocked(listConversationThreadsByProject).mockImplementation((_db, _projectId, _archived, opts) => (
      opts?.includeHidden ? [child] : []
    ));
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, stopped: true }));
    const context = ctx(callHostOnlineRpc);
    await archiveConversation(context, thread.id);
    expect(archiveConversationThread).toHaveBeenCalledWith(expect.anything(), child.id);
    expect(archiveConversationThread).toHaveBeenCalledWith(expect.anything(), thread.id);
  });

  it('copies completed source history into a fork and leaves the source untouched', async () => {
    const sourceEvents = [
      {
        id: 'evt-1',
        threadId: thread.id,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: thread.id,
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 1
      },
      {
        id: 'evt-2',
        threadId: thread.id,
        sequence: 2,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId: thread.id,
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 2
      },
      {
        id: 'evt-identity',
        threadId: thread.id,
        sequence: 3,
        type: 'thread/identity',
        payload: { type: 'thread/identity', threadId: thread.id, scope: { kind: 'thread' } },
        createdAt: 3
      }
    ];
    vi.mocked(listConversationThreadEvents).mockReturnValue(sourceEvents);
    const product = ctx(async () => ({}));
    const forked = await forkConversation(product, thread.id);
    expect(copyConversationThreadEvents).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        targetThreadId: forked.id
      })
    );
    const copied = vi.mocked(copyConversationThreadEvents).mock.calls.at(-1)?.[1] as {
      rows: Array<{ type: string }>;
    };
    expect(copied.rows.map((row) => row.type)).toEqual(['turn/started', 'turn/completed']);
    expect(listConversationThreadEvents).toHaveBeenCalledWith(expect.anything(), thread.id);
  });

  it('copies no events when the source thread is empty', async () => {
    vi.mocked(listConversationThreadEvents).mockReturnValue([]);
    vi.mocked(copyConversationThreadEvents).mockClear();
    await forkConversation(ctx(async () => ({})), thread.id);
    expect(copyConversationThreadEvents).not.toHaveBeenCalled();
  });

  it('rejects a mid-session fork when the provider cannot rewind', async () => {
    providerHandles.push(
      registerThreadProvider('tip-only', {
        id: 'acp-cursor',
        displayName: 'Cursor',
        capabilities: {
          supportsServiceTier: false,
          fork: 'tip',
          supportsThreadArchive: false,
          supportsThreadRename: false,
          permissionModes: ['full']
        },
        composerActions: []
      })
    );
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, providerId: 'acp-cursor' });
    vi.mocked(listConversationThreadEvents).mockReturnValue([
      {
        id: 'evt-1',
        threadId: thread.id,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: thread.id,
          scope: { kind: 'turn', turnId: 't1' },
          providerThreadId: 'prov-1'
        },
        createdAt: 1
      },
      {
        id: 'evt-2',
        threadId: thread.id,
        sequence: 2,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId: thread.id,
          scope: { kind: 'turn', turnId: 't1' },
          providerThreadId: 'prov-1',
          providerCheckpointId: 'cp-1'
        },
        createdAt: 2
      },
      {
        id: 'evt-3',
        threadId: thread.id,
        sequence: 3,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: thread.id,
          scope: { kind: 'turn', turnId: 't2' },
          providerThreadId: 'prov-1'
        },
        createdAt: 3
      },
      {
        id: 'evt-4',
        threadId: thread.id,
        sequence: 4,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId: thread.id,
          scope: { kind: 'turn', turnId: 't2' },
          providerThreadId: 'prov-1',
          providerCheckpointId: 'cp-2'
        },
        createdAt: 4
      }
    ]);
    await expect(forkConversation(ctx(async () => ({})), thread.id, { sourceSeqEnd: 2 }))
      .rejects.toMatchObject({ code: 'fork_source_session_unavailable', status: 409 });
  });

  it('starts a fork from the copied checkpoint instead of a blank turn.submit', async () => {
    const forkId = '33333333-3333-4333-8333-333333333333';
    const forked = {
      ...thread,
      id: forkId,
      originKind: 'fork' as const,
      parentThreadId: thread.id,
      providerThreadId: null,
      title: 'Hello (fork)',
      status: 'idle' as const
    };
    vi.mocked(getConversationThread).mockReturnValue(forked);
    vi.mocked(listConversationThreadEvents).mockReturnValue([
      {
        id: 'fork-evt-1',
        threadId: forkId,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: forkId,
          scope: { kind: 'turn', turnId: 'turn-1' },
          providerThreadId: 'prov-source'
        },
        createdAt: 1
      },
      {
        id: 'fork-evt-2',
        threadId: forkId,
        sequence: 2,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId: forkId,
          scope: { kind: 'turn', turnId: 'turn-1' },
          providerThreadId: 'prov-source',
          providerCheckpointId: 'cp-9'
        },
        createdAt: 2
      }
    ]);
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: forkId, started: true, providerThreadId: 'prov-fork' }));
    await sendConversationTurn(ctx(callHostOnlineRpc), forkId, [{ type: 'text', text: 'continue from here' }]);
    await Promise.resolve();
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'thread.start',
        providerThreadId: 'prov-source',
        providerCheckpointId: 'cp-9',
        input: ['continue from here']
      })
    }));
    expect(setConversationProviderThreadId).toHaveBeenCalledWith(expect.anything(), forkId, 'prov-fork');
  });

  it('retries the tab namer from a later prompt on a still-unnamed thread', async () => {
    const namer = { request: vi.fn(), reserve: vi.fn() };
    const product = ctx(async () => ({ threadId: thread.id, accepted: true }));
    product.threadTitleNamer = namer as unknown as ProductHttpContext['threadTitleNamer'];
    await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }]);
    expect(namer.request).toHaveBeenCalledWith(thread.id, 'follow up');
  });

  it('does not rename a forked thread from a later prompt', async () => {
    const namer = { request: vi.fn(), reserve: vi.fn() };
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, originKind: 'fork', title: 'Hello (fork)' });
    const product = ctx(async () => ({ threadId: thread.id, accepted: true }));
    product.threadTitleNamer = namer as unknown as ProductHttpContext['threadTitleNamer'];
    await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }]);
    expect(namer.request).not.toHaveBeenCalled();
  });

  it('projects stored events into a timeline', () => {
    vi.mocked(listConversationThreadEvents).mockReturnValue([
      {
        id: 'evt-1',
        threadId: thread.id,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 1
      },
      {
        id: 'evt-2',
        threadId: thread.id,
        sequence: 2,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          status: 'completed',
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 2
      }
    ]);
    const timeline = conversationTimeline(ctx(async () => ({})), thread.id);
    expect(timeline.threadId).toBe(thread.id);
    expect(timeline.events).toHaveLength(2);
    expect(timeline).toMatchObject({
      activeThinking: null,
      pendingTodos: null,
      goal: null,
      activePromptMode: null,
      activeWorkflows: []
    });
  });

  it('relativizes file-change paths against the environment workspace root', () => {
    vi.mocked(listConversationThreadEvents).mockReturnValue([
      {
        id: 'evt-start',
        threadId: thread.id,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 1
      },
      {
        id: 'evt-fc',
        threadId: thread.id,
        sequence: 2,
        type: 'item/completed',
        payload: {
          type: 'item/completed',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          scope: { kind: 'turn', turnId: 'turn-1' },
          item: {
            type: 'fileChange',
            id: 'fc-1',
            changes: [{ path: '/tmp/proj/README.md', kind: 'update' }],
            status: 'completed',
            approvalStatus: null
          }
        },
        createdAt: 2
      }
    ]);
    const timeline = conversationTimeline(ctx(async () => ({})), thread.id);
    const paths: string[] = [];
    const walk = (rows: Array<{ kind?: string; workKind?: string; change?: { path?: string }; children?: unknown; childRows?: unknown }>) => {
      for (const row of rows) {
        if (row.kind === 'work' && row.workKind === 'file-change' && row.change?.path) {
          paths.push(row.change.path);
        }
        if (Array.isArray(row.children)) walk(row.children as typeof rows);
        if (Array.isArray(row.childRows)) walk(row.childRows as typeof rows);
      }
    };
    walk(timeline.rows as typeof paths extends never ? never : Parameters<typeof walk>[0]);
    expect(paths).toContain('README.md');
  });

  it('projects completed Read and command work inside a turn', () => {
    const scope = { kind: 'turn', turnId: 'turn-1' };
    vi.mocked(listConversationThreadEvents).mockReturnValue([
      {
        id: 'evt-start',
        threadId: thread.id,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          scope
        },
        createdAt: 1
      },
      {
        id: 'evt-read',
        threadId: thread.id,
        sequence: 2,
        type: 'item/completed',
        payload: {
          type: 'item/completed',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          scope,
          item: {
            type: 'toolCall',
            id: 'read-1',
            tool: 'Read',
            arguments: { file_path: '/tmp/proj/README.md' },
            status: 'completed',
            result: 'ok'
          }
        },
        createdAt: 2
      },
      {
        id: 'evt-ls',
        threadId: thread.id,
        sequence: 3,
        type: 'item/completed',
        payload: {
          type: 'item/completed',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          scope,
          item: {
            type: 'commandExecution',
            id: 'cmd-1',
            command: 'ls -la',
            cwd: '/tmp/proj',
            status: 'completed',
            approvalStatus: null,
            aggregatedOutput: 'README.md'
          }
        },
        createdAt: 3
      },
      {
        id: 'evt-done',
        threadId: thread.id,
        sequence: 4,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          status: 'completed',
          scope
        },
        createdAt: 4
      }
    ]);
    const timeline = conversationTimeline(ctx(async () => ({})), thread.id, {
      includeNestedRows: 'true',
      summaryOnly: 'false'
    });
    const work: string[] = [];
    const walk = (rows: Array<{ kind?: string; workKind?: string; command?: string; toolName?: string; children?: unknown; childRows?: unknown }>) => {
      for (const row of rows) {
        if (row.kind === 'work' && row.workKind) work.push(row.workKind);
        if (Array.isArray(row.children)) walk(row.children as typeof rows);
        if (Array.isArray(row.childRows)) walk(row.childRows as typeof rows);
      }
    };
    walk(timeline.rows as Parameters<typeof walk>[0]);
    expect(work).toEqual(expect.arrayContaining(['file-read', 'command']));
  });

  it('queues a send while a pending interaction is open', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    const { createDeferredThreadMessage } = await import('@zana-ai/zcc-db');
    const context = {
      ...ctx(callHostOnlineRpc),
      pendingInteractions: pendingInteractionsStub({ hasPendingThreadInteraction: true })
    };
    await expect(sendConversationTurn(context, thread.id, [{ type: 'text', text: 'follow up' }]))
      .resolves.toMatchObject({ id: thread.id });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    expect(createDeferredThreadMessage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadId: thread.id, kind: 'send' })
    );
  });

  it('still 409s a start send while a pending interaction is open', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    const context = {
      ...ctx(callHostOnlineRpc),
      pendingInteractions: pendingInteractionsStub({ hasPendingThreadInteraction: true })
    };
    await expect(sendConversationTurn(context, thread.id, [{ type: 'text', text: 'follow up' }], 'start'))
      .rejects.toMatchObject({ status: 409, code: 'awaiting_user_interaction' });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('interrupts pending interactions when stopping a thread', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, status: 'active' });
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, stopped: true }));
    const context = ctx(callHostOnlineRpc);
    await stopConversation(context, thread.id);
    expect(context.pendingInteractions.interruptPendingInteractionsForThreadIds).toHaveBeenCalledWith({
      threadIds: [thread.id],
      reason: 'thread-stopped'
    });
  });

  it('interrupts pending interactions when archiving a thread', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, stopped: true }));
    const context = ctx(callHostOnlineRpc);
    await archiveConversation(context, thread.id);
    expect(context.pendingInteractions.interruptPendingInteractionsForThreadIds).toHaveBeenCalledWith({
      threadIds: [thread.id],
      reason: 'thread-deleted'
    });
    expect(deleteDeferredThreadMessagesForThread).toHaveBeenCalledWith(context.db, thread.id);
    expect(context.plugins?.emitThreadEvent).toHaveBeenNthCalledWith(1, expect.objectContaining({
      name: 'thread.archived',
      threadId: thread.id,
      projectId: thread.projectId
    }));
    expect(context.plugins?.emitThreadEvent).toHaveBeenNthCalledWith(2, expect.objectContaining({
      name: 'thread.deleted',
      threadId: thread.id,
      projectId: thread.projectId
    }));
  });

  it('409s cancelPlan when plan mode is not active', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ cancelled: true }));
    await expect(cancelConversationPlan(ctx(callHostOnlineRpc), thread.id))
      .rejects.toMatchObject({ status: 409, code: 'invalid_request', message: 'Plan mode is not active' });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
  });

  it('cancels an active plan turn through thread.plan.cancel', async () => {
    const requestId = 'creq_23456789ab';
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, status: 'active' });
    vi.mocked(listConversationThreadEvents).mockReturnValue([
      {
        id: 'evt-req',
        threadId: thread.id,
        sequence: 1,
        type: 'client/turn/requested',
        payload: {
          type: 'client/turn/requested',
          threadId: thread.id,
          scope: { kind: 'thread' },
          direction: 'outbound',
          requestId,
          source: 'tell',
          initiator: 'user',
          senderThreadId: null,
          input: [{
            type: 'text',
            text: '/plan inspect the failing command',
            mentions: [{
              start: 0,
              end: 5,
              resource: {
                kind: 'command',
                trigger: '/',
                name: 'plan',
                source: 'command',
                origin: 'user',
                label: 'plan',
                argumentHint: null
              }
            }]
          }],
          target: { kind: 'new-turn' },
          request: { method: 'turn/start', params: {} },
          execution: {
            model: 'default',
            serviceTier: 'default',
            reasoningLevel: 'medium',
            permissionMode: 'accept-edits',
            source: 'client/turn/requested'
          }
        },
        createdAt: 1
      },
      {
        id: 'evt-accepted',
        threadId: thread.id,
        sequence: 2,
        type: 'turn/input/accepted',
        payload: {
          type: 'turn/input/accepted',
          threadId: thread.id,
          providerThreadId: 'prov-1',
          clientRequestId: requestId,
          scope: { kind: 'turn', turnId: 'turn-plan-1' }
        },
        createdAt: 2
      }
    ] as never);
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, cancelled: true }));
    await expect(cancelConversationPlan(ctx(callHostOnlineRpc), thread.id)).resolves.toEqual({ ok: true });
    expect(callHostOnlineRpc).toHaveBeenCalledWith({
      hostId: thread.hostId,
      command: {
        type: 'thread.plan.cancel',
        threadId: thread.id,
        expectedTurnId: 'turn-plan-1'
      }
    });
    expect(upsertThreadExecutionState).toHaveBeenCalledWith(expect.anything(), {
      threadId: thread.id,
      requestedMode: 'agent',
      effectiveMode: 'agent'
    });
  });

  it('records slash plan mode on send and ACP plan from execution.acpMode', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(ctx(callHostOnlineRpc), thread.id, [{
      type: 'text',
      text: '/plan inspect the failing command',
      mentions: [{
        start: 0,
        end: 5,
        resource: {
          kind: 'command',
          trigger: '/',
          name: 'plan',
          source: 'command',
          origin: 'builtin',
          label: 'plan',
          argumentHint: null
        }
      }]
    }]);
    expect(upsertThreadExecutionState).toHaveBeenCalledWith(expect.anything(), {
      threadId: thread.id,
      requestedMode: 'plan',
      effectiveMode: 'plan'
    });

    vi.mocked(upsertThreadExecutionState).mockClear();
    await sendConversationTurn(
      ctx(callHostOnlineRpc),
      thread.id,
      [{ type: 'text', text: 'follow up' }],
      'auto',
      { acpMode: 'plan' }
    );
    expect(upsertThreadExecutionState).toHaveBeenCalledWith(expect.anything(), {
      threadId: thread.id,
      requestedMode: 'plan',
      effectiveMode: 'plan'
    });
  });

  it('exits sticky plan when no live plan turn is active', async () => {
    vi.mocked(getThreadExecutionState).mockReturnValueOnce({
      threadId: thread.id,
      requestedMode: 'plan',
      effectiveMode: 'plan',
      updatedAt: 1
    });
    const callHostOnlineRpc = vi.fn(async () => ({ cancelled: true }));
    await expect(cancelConversationPlan(ctx(callHostOnlineRpc), thread.id)).resolves.toEqual({ ok: true });
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    expect(upsertThreadExecutionState).toHaveBeenCalledWith(expect.anything(), {
      threadId: thread.id,
      requestedMode: 'agent',
      effectiveMode: 'agent'
    });
  });

  it('unarchives a conversation thread when the environment still exists', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, archivedAt: 9 });
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, unarchived: true }));
    const restored = await unarchiveConversation(ctx(callHostOnlineRpc), thread.id);
    expect(unarchiveConversationThread).toHaveBeenCalled();
    expect(restored.archivedAt).toBeNull();
  });

  it('409s unarchive when the environment is gone', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, archivedAt: 9 });
    vi.mocked(getEnvironment).mockReturnValueOnce(null);
    await expect(unarchiveConversation(ctx(vi.fn()), thread.id))
      .rejects.toMatchObject({ status: 409, code: 'environment_not_ready' });
  });

  it('queues a send when the host is offline', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    const context = ctx(callHostOnlineRpc);
    context.hostHub.connectedHostIds = () => [];
    await sendConversationTurn(context, thread.id, [{ type: 'text', text: 'offline' }]);
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    expect(createDeferredThreadMessage).toHaveBeenCalled();
  });

  it('queues queue-if-active while the thread is already active', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, status: 'active' });
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(
      ctx(callHostOnlineRpc),
      thread.id,
      [{ type: 'text', text: 'later' }],
      'queue-if-active'
    );
    expect(callHostOnlineRpc).not.toHaveBeenCalled();
    expect(createDeferredThreadMessage).toHaveBeenCalled();
  });

  it('drains queue-if-active onto an active thread as auto', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, status: 'active' });
    vi.mocked(applyConversationThreadLifecycleEvent).mockReturnValueOnce({
      applied: false,
      reason: 'illegal-transition',
      detail: 'no transition for run.started from status active'
    });
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(
      ctx(callHostOnlineRpc),
      thread.id,
      [{ type: 'text', text: 'now' }],
      'queue-if-active',
      undefined,
      { drain: true }
    );
    expect(createDeferredThreadMessage).not.toHaveBeenCalled();
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        input: ['now'],
        mode: 'auto',
        permissionEscalation: 'deny'
      })
    }));
  });

  it('pauses queued sends on stop instead of dropping them', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, status: 'active' });
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, stopped: true }));
    const context = ctx(callHostOnlineRpc);
    await stopConversation(context, thread.id);
    expect(pauseDeferredThreadMessagesForThread).toHaveBeenCalledWith(context.db, thread.id);
    expect(deleteDeferredThreadMessagesForThread).not.toHaveBeenCalled();
  });

  it('stays stopping when the host stop RPC times out', async () => {
    vi.mocked(getConversationThread).mockReturnValue({ ...thread, status: 'active' });
    const { HostUnavailableError } = await import('../../http/host-hub.js');
    const callHostOnlineRpc = vi.fn(async () => {
      throw new HostUnavailableError('host host-1 RPC timed out');
    });
    const next = await stopConversation(ctx(callHostOnlineRpc), thread.id);
    expect(next.status).toBe('stopping');
    expect(applyConversationThreadLifecycleEvent).toHaveBeenCalledWith(...lifecycleCall('stop.requested'));
  });

  it('releases an idle thread without interrupt events', async () => {
    vi.mocked(applyConversationThreadLifecycleEvent).mockClear();
    vi.mocked(pauseDeferredThreadMessagesForThread).mockClear();
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, stopped: true }));
    const context = ctx(callHostOnlineRpc);
    const next = await stopConversation(context, thread.id);
    expect(next.status).toBe('idle');
    expect(applyConversationThreadLifecycleEvent).not.toHaveBeenCalled();
    expect(pauseDeferredThreadMessagesForThread).not.toHaveBeenCalled();
  });

  it('returns while a live turn.submit RPC is still running', async () => {
    vi.mocked(applyConversationThreadLifecycleEvent).mockClear();
    const callHostOnlineRpc = vi.fn(() => new Promise(() => {}));
    const startedAt = Date.now();
    const sent = await sendConversationTurn(
      ctx(callHostOnlineRpc),
      thread.id,
      [{ type: 'text', text: 'follow up' }]
    );
    expect(Date.now() - startedAt).toBeLessThan(1000);
    expect(sent.id).toBe(thread.id);
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
    expect(applyConversationThreadLifecycleEvent).toHaveBeenCalledWith(...lifecycleCall('run.started'));
    expect(applyConversationThreadLifecycleEvent).not.toHaveBeenCalledWith(...lifecycleCall('run.failed'));
  });

  it('does not flip a live thread to error after the request was accepted', async () => {
    vi.mocked(applyConversationThreadLifecycleEvent).mockClear();
    vi.mocked(appendConversationThreadEvent).mockClear();
    let rejectRpc: (error: unknown) => void = () => undefined;
    const callHostOnlineRpc = vi.fn(() => new Promise((_resolve, reject) => {
      rejectRpc = reject;
    }));
    const product = ctx(callHostOnlineRpc);
    await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }]);
    const requestId = (callHostOnlineRpc.mock.calls[0]?.[0] as { command: { clientRequestId: string } })
      .command.clientRequestId;
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([{
      id: 'acc',
      threadId: thread.id,
      sequence: 2,
      type: 'turn/input/accepted',
      payload: {
        type: 'turn/input/accepted',
        clientRequestId: requestId,
        threadId: thread.id,
        providerThreadId: 'prov-1',
        scope: { kind: 'thread' }
      },
      createdAt: 2
    }]);
    rejectRpc(new Error('socket closed'));
    await vi.waitFor(() => {
      expect(hasTerminalClientTurnRequestEvent(product, { threadId: thread.id, requestId })).toBe(true);
    });
    expect(applyConversationThreadLifecycleEvent).not.toHaveBeenCalledWith(...lifecycleCall('run.failed'));
    expect(appendConversationThreadEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'client/turn/rejected' })
    );
  });

  it('settles a pre-acceptance follow-up without erroring an open root turn', async () => {
    vi.mocked(applyConversationThreadLifecycleEvent).mockClear();
    vi.mocked(appendConversationThreadEvent).mockClear();
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([{
      id: 'start',
      threadId: thread.id,
      sequence: 1,
      type: 'turn/started',
      payload: {
        type: 'turn/started',
        threadId: thread.id,
        providerThreadId: 'prov-1',
        scope: { kind: 'turn', turnId: 'turn-live' }
      },
      createdAt: 1
    }]);
    const callHostOnlineRpc = vi.fn(async () => {
      throw new Error('transport failed');
    });
    const product = ctx(callHostOnlineRpc);
    const sent = await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'Is it done ?' }]);
    expect(sent.id).toBe(thread.id);
    await vi.waitFor(() => {
      expect(appendConversationThreadEvent).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'client/turn/rejected' })
      );
    });
    expect(applyConversationThreadLifecycleEvent).not.toHaveBeenCalledWith(...lifecycleCall('run.failed'));
  });

  it('settles a pre-acceptance failure to error when no root turn is open', async () => {
    const callHostOnlineRpc = vi.fn(async () => {
      throw new Error('transport failed');
    });
    const product = ctx(callHostOnlineRpc);
    await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }]);
    await vi.waitFor(() => {
      expect(applyConversationThreadLifecycleEvent).toHaveBeenCalledWith(...lifecycleCall('run.failed'));
    });
    expect(appendConversationThreadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'client/turn/rejected' })
    );
  });

  it('skips error settlement when the latest root turn already completed', () => {
    vi.mocked(applyConversationThreadLifecycleEvent).mockClear();
    vi.mocked(appendConversationThreadEvent).mockClear();
    const product = ctx(async () => ({}));
    vi.mocked(listConversationThreadEventsWindow).mockReturnValue([
      {
        id: 'start',
        threadId: thread.id,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId: thread.id,
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 1
      },
      {
        id: 'done',
        threadId: thread.id,
        sequence: 2,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId: thread.id,
          status: 'completed',
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 2
      }
    ]);
    expect(hasLatestRootTurnCompleted(product, thread.id)).toBe(true);
    settleLiveTurnCommandFailure(product, {
      thread,
      commandType: 'turn.submit',
      clientRequestId: 'creq_23456789ab',
      error: new Error('late transport')
    });
    expect(appendConversationThreadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: 'client/turn/rejected' })
    );
    expect(applyConversationThreadLifecycleEvent).not.toHaveBeenCalledWith(...lifecycleCall('run.failed'));
  });
});
