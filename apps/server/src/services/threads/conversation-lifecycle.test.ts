import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerThreadProvider } from './thread-provider-catalog.js';
import { PluginHostArtifactRegistry } from '../../plugins/plugin-host-artifact-registry.js';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { archiveConversation, cancelConversationPlan, forkConversation, resumeConversation, sendConversationTurn, stopConversation, unarchiveConversation } from './conversation-lifecycle.js';
import { conversationTimeline } from './conversation-timeline.js';

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
  updateConversationThreadStatus: vi.fn((_db, id, status) => ({ ...thread, id, status })),
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
  createDeferredThreadMessage: vi.fn((_db, input) => ({
    id: 'dmsg_1',
    threadId: input.threadId,
    kind: input.kind,
    payload: input.payload,
    createdAt: 1
  })),
  deleteDeferredThreadMessagesForThread: vi.fn(() => 0),
  listDeferredThreadMessages: vi.fn(() => []),
  deleteDeferredThreadMessage: vi.fn(() => false),
  getEnvironment: vi.fn(() => ({ id: thread.environmentId, path: '/tmp/proj' })),
  hasPendingInteractionForThread: vi.fn(() => false),
  countLiveThreadsForEnvironment: vi.fn(() => 1),
  countConversationThreadEvents: vi.fn(() => listConversationThreadEvents().length),
  listConversationThreadEventsWindow: vi.fn(() => listConversationThreadEvents()),
  nextConversationEventSequence: vi.fn(() => 1),
  maxConversationEventSequenceByThreadIds: vi.fn(() => ({})),
  listConversationThreadEvents
  };
});

import {
  appendConversationThreadEvent,
  copyConversationThreadEvents,
  createConversationThread,
  deleteDeferredThreadMessagesForThread,
  getConversationThread,
  getEnvironment,
  listConversationThreadEvents,
  listConversationThreadEventsWindow,
  setConversationProviderThreadId,
  unarchiveConversationThread,
  updateConversationThreadStatus
} from '@zana-ai/zcc-db';

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
    db: {},
    dataDir: '/tmp/zcc-data',
    hub: { emit: vi.fn() },
    hostHub: { callHostOnlineRpc },
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
  vi.mocked(updateConversationThreadStatus).mockImplementation((_db, id, status) => ({ ...thread, id, status }));
  vi.mocked(listConversationThreadEventsWindow).mockImplementation(() => listConversationThreadEvents());
  vi.mocked(setConversationProviderThreadId).mockReset();
});

afterEach(() => {
  for (const handle of providerHandles.splice(0)) handle.unregister();
});

describe('conversation lifecycle', () => {
  it('sends a follow-up turn through turn.submit', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    await sendConversationTurn(ctx(callHostOnlineRpc), thread.id, [{ type: 'text', text: 'follow up' }], 'queue-if-active');
    expect(updateConversationThreadStatus).toHaveBeenCalledWith(expect.anything(), thread.id, 'active');
    expect(updateConversationThreadStatus).not.toHaveBeenCalledWith(expect.anything(), thread.id, 'error');
    expect(appendConversationThreadEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        threadId: thread.id,
        type: 'client/turn/requested'
      })
    );
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        input: ['follow up'],
        mode: 'queue-if-active',
        clientRequestId: expect.stringMatching(/^creq_/),
        resume: expect.objectContaining({
          providerThreadId: 'prov-1',
          providerId: 'claude-code',
          cwd: '/tmp/proj'
        })
      })
    }));
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
    expect(callHostOnlineRpc.mock.calls.map((call) => call[0].command.type)).toEqual([
      'turn.submit',
      'thread.resume',
      'turn.submit'
    ]);
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
    await expect(
      sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }])
    ).rejects.toMatchObject({ code: 'not_resumable' });
    expect(callHostOnlineRpc).toHaveBeenCalledTimes(1);
    expect(updateConversationThreadStatus).toHaveBeenCalledWith(expect.anything(), thread.id, 'error');
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
        dynamicTools: [expect.objectContaining({ name: 'sf_soql' })],
        instructions: 'Use sf_soql.'
      })
    }));
    callHostOnlineRpc.mockClear();
    callHostOnlineRpc.mockResolvedValue({ threadId: thread.id, accepted: true });
    await sendConversationTurn(product, thread.id, [{ type: 'text', text: 'follow up' }]);
    expect(callHostOnlineRpc).toHaveBeenCalledWith(expect.objectContaining({
      command: expect.objectContaining({
        type: 'turn.submit',
        resume: expect.objectContaining({
          dynamicTools: [expect.objectContaining({ name: 'sf_soql' })],
          instructions: 'Use sf_soql.'
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
    const command = callHostOnlineRpc.mock.calls[0]?.[0] as { command: { dynamicTools?: unknown } };
    expect(command.command.dynamicTools).toBeUndefined();
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
    expect(work).toEqual(expect.arrayContaining(['tool', 'command']));
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
    expect(context.plugins?.emitThreadEvent).toHaveBeenNthCalledWith(1, {
      name: 'thread.archived',
      threadId: thread.id,
      projectId: thread.projectId
    });
    expect(context.plugins?.emitThreadEvent).toHaveBeenNthCalledWith(2, {
      name: 'thread.deleted',
      threadId: thread.id,
      projectId: thread.projectId
    });
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
});
