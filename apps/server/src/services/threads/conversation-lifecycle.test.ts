import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProductHttpContext } from '../../http/product-context.js';
import { ThreadCreateError } from '../../http/thread-create.js';
import { archiveConversation, forkConversation, resumeConversation, sendConversationTurn, stopConversation } from './conversation-lifecycle.js';
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
  getConversationThread: vi.fn(() => thread),
  updateConversationThreadStatus: vi.fn((_db, id, status) => ({ ...thread, id, status })),
  setConversationProviderThreadId: vi.fn(),
  archiveConversationThread: vi.fn(),
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
  getEnvironment: vi.fn(() => ({ id: thread.environmentId, path: '/tmp/proj' })),
  hasPendingInteractionForThread: vi.fn(() => false),
  countLiveThreadsForEnvironment: vi.fn(() => 1),
  countConversationThreadEvents: vi.fn(() => listConversationThreadEvents().length),
  listConversationThreadEventsWindow: vi.fn(() => listConversationThreadEvents()),
  listConversationThreadEvents
  };
});

import {
  appendConversationThreadEvent,
  createConversationThread,
  getConversationThread,
  listConversationThreadEvents,
  listConversationThreadEventsWindow,
  setConversationProviderThreadId,
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
  return {
    db: {},
    dataDir: '/tmp/zcc-data',
    hub: { emit: vi.fn() },
    hostHub: { callHostOnlineRpc },
    pendingInteractions: pendingInteractionsStub()
  } as unknown as ProductHttpContext;
}

beforeEach(() => {
  vi.mocked(getConversationThread).mockReturnValue(thread);
  vi.mocked(updateConversationThreadStatus).mockImplementation((_db, id, status) => ({ ...thread, id, status }));
  vi.mocked(listConversationThreadEventsWindow).mockImplementation(() => listConversationThreadEvents());
  vi.mocked(setConversationProviderThreadId).mockReset();
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
        resume: expect.objectContaining({
          providerThreadId: 'prov-1',
          providerId: 'claude-code',
          cwd: '/tmp/proj'
        })
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

  it('forks a child conversation thread without mixing PTY rows', async () => {
    const forked = await forkConversation(ctx(async () => ({})), thread.id);
    expect(createConversationThread).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        parentThreadId: thread.id,
        originKind: 'fork'
      })
    );
    expect(forked.originKind).toBe('fork');
    expect(forked.parentThreadId).toBe(thread.id);
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
    const timeline = conversationTimeline(ctx(async () => ({})), thread.id);
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

  it('blocks send while a pending interaction is open', async () => {
    const callHostOnlineRpc = vi.fn(async () => ({ threadId: thread.id, accepted: true }));
    const context = {
      ...ctx(callHostOnlineRpc),
      pendingInteractions: pendingInteractionsStub({ hasPendingThreadInteraction: true })
    };
    await expect(sendConversationTurn(context, thread.id, [{ type: 'text', text: 'follow up' }]))
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
  });
});
