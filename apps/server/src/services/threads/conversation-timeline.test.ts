import { afterEach, describe, expect, it, vi } from 'vitest';
import { storedEventsToMeta, conversationOutline, conversationTimeline } from './conversation-timeline.js';
import { registerThreadProvider } from './thread-provider-catalog.js';
import type { ProductHttpContext } from '../../http/product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({
  getConversationThread: vi.fn(() => ({
    id: '11111111-1111-4111-8111-111111111111',
    projectId: 'proj-1',
    hostId: 'host-1',
    environmentId: null,
    providerId: 'claude-code',
    status: 'idle',
    title: 'Hello'
  })),
  getEnvironment: vi.fn(() => null),
  listConversationThreadEvents: vi.fn(() => []),
  listConversationThreadEventsWindow: vi.fn(() => []),
  countConversationThreadEvents: vi.fn(() => 0)
}));

import { getConversationThread, listConversationThreadEvents, listConversationThreadEventsWindow, countConversationThreadEvents } from '@zana-ai/zcc-db';

describe('storedEventsToMeta', () => {
  it('unwraps nested event payloads and skips junk', () => {
    const meta = storedEventsToMeta([
      {
        id: 'a',
        threadId: 't1',
        sequence: 1,
        type: 'turn/started',
        payload: {
          event: {
            type: 'turn/started',
            threadId: 't1',
            providerThreadId: 'p1',
            scope: { kind: 'turn', turnId: 'turn-1' }
          }
        },
        createdAt: 1
      },
      {
        id: 'b',
        threadId: 't1',
        sequence: 2,
        type: 'noise',
        payload: { hello: true },
        createdAt: 2
      }
    ]);
    expect(meta).toHaveLength(1);
    expect(meta[0]?.event.type).toBe('turn/started');
  });
});

describe('conversationTimeline', () => {
  it('404s for an unknown thread', () => {
    vi.mocked(getConversationThread).mockReturnValueOnce(null);
    expect(() => conversationTimeline({ db: {} } as ProductHttpContext, 'missing')).toThrow(/not registered/);
  });

  it('returns an empty projection for a thread with no events', () => {
    vi.mocked(listConversationThreadEventsWindow).mockReturnValueOnce([]);
    const timeline = conversationTimeline({ db: {}, dataDir: '/tmp' } as ProductHttpContext, '11111111-1111-4111-8111-111111111111');
    expect(timeline.rows).toEqual([]);
    expect(timeline.activeThinking).toBeNull();
    expect(timeline.activeWorkflows).toEqual([]);
    expect(timeline.timelinePage.hasOlderRows).toBe(false);
    expect(timeline.maxSeq).toBe(0);
  });

  it('caps the latest window and reports an older cursor', () => {
    vi.mocked(countConversationThreadEvents).mockReturnValueOnce(3);
    vi.mocked(listConversationThreadEventsWindow).mockReturnValueOnce([{
      id: 'evt-2',
      threadId: '11111111-1111-4111-8111-111111111111',
      sequence: 2,
      type: 'noise',
      payload: {},
      createdAt: 2
    }]);
    const timeline = conversationTimeline(
      { db: {}, dataDir: '/tmp' } as ProductHttpContext,
      '11111111-1111-4111-8111-111111111111',
      { segmentLimit: '1' }
    );
    expect(timeline.timelinePage.hasOlderRows).toBe(true);
    expect(timeline.timelinePage.olderCursor).toEqual({ anchorSeq: 2, anchorId: 'evt-2' });
    expect(timeline.maxSeq).toBe(2);
  });

  it('returns streamed reasoning as activeThinking on a live thread', () => {
    const threadId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: threadId,
      projectId: 'proj-1',
      hostId: 'host-1',
      environmentId: null,
      providerId: 'claude-code',
      status: 'active',
      title: 'Hello'
    });
    vi.mocked(listConversationThreadEventsWindow).mockReturnValueOnce([
      {
        id: 'evt-1',
        threadId,
        sequence: 1,
        type: 'turn/started',
        payload: {
          type: 'turn/started',
          threadId,
          providerThreadId: 'p1',
          scope: { kind: 'turn', turnId: 'turn-1' }
        },
        createdAt: 1
      },
      {
        id: 'evt-2',
        threadId,
        sequence: 2,
        type: 'item/reasoning/textDelta',
        payload: {
          type: 'item/reasoning/textDelta',
          threadId,
          providerThreadId: 'p1',
          scope: { kind: 'turn', turnId: 'turn-1' },
          itemId: 'reasoning-1',
          delta: 'Considering the approach.'
        },
        createdAt: 2
      }
    ]);
    const timeline = conversationTimeline({ db: {}, dataDir: '/tmp' } as ProductHttpContext, threadId);
    expect(timeline.activeThinking).toMatchObject({
      id: 'reasoning-1',
      text: 'Considering the approach.'
    });
    expect(timeline.rows).toEqual([]);
  });

  it('projects a latest window that dropped turn/started instead of failing the timeline', () => {
    const threadId = '11111111-1111-4111-8111-111111111111';
    vi.mocked(getConversationThread).mockReturnValueOnce({
      id: threadId,
      projectId: 'proj-1',
      hostId: 'host-1',
      environmentId: null,
      providerId: 'pi',
      status: 'idle',
      title: 'Hello'
    });
    vi.mocked(listConversationThreadEventsWindow).mockReturnValueOnce([
      {
        id: 'evt-200',
        threadId,
        sequence: 200,
        type: 'item/agentMessage/delta',
        payload: {
          type: 'item/agentMessage/delta',
          threadId,
          providerThreadId: 'p1',
          scope: { kind: 'turn', turnId: 'turn-1' },
          itemId: 'assistant-1',
          delta: 'Hello from the tail of a long turn.'
        },
        createdAt: 200
      },
      {
        id: 'evt-201',
        threadId,
        sequence: 201,
        type: 'turn/completed',
        payload: {
          type: 'turn/completed',
          threadId,
          providerThreadId: 'p1',
          scope: { kind: 'turn', turnId: 'turn-1' },
          status: 'completed'
        },
        createdAt: 201
      }
    ]);
    const timeline = conversationTimeline({ db: {}, dataDir: '/tmp' } as ProductHttpContext, threadId);
    expect(timeline.status).toBe('idle');
    expect(timeline.activeThinking).toBeNull();
    expect(JSON.stringify(timeline.rows)).toContain('Hello from the tail of a long turn.');
  });
});

describe('conversationOutline', () => {
  it('returns an empty outline when there are no conversation rows', () => {
    vi.mocked(listConversationThreadEvents).mockReturnValueOnce([]);
    const outline = conversationOutline({ db: {}, dataDir: '/tmp' } as ProductHttpContext, '11111111-1111-4111-8111-111111111111');
    expect(outline.items).toEqual([]);
    expect(outline.maxSeq).toBe(0);
  });
});

describe('conversationItemsFromRows', () => {
  it('collects conversation rows including turn children', async () => {
    const { conversationItemsFromRows } = await import('./conversation-timeline.js');
    expect(conversationItemsFromRows([
      { kind: 'system', id: 's' },
      {
        kind: 'turn',
        id: 't',
        children: [{
          kind: 'conversation',
          id: 'u1',
          role: 'user',
          text: '  hello\nworld  ',
          attachments: { webImages: 1, localImages: 1, localFiles: 2 }
        }]
      },
      { kind: 'conversation', id: 'a1', role: 'assistant', text: 'Done', attachments: null }
    ])).toEqual([
      {
        id: 'u1',
        role: 'user',
        preview: 'hello world',
        attachmentSummary: { imageCount: 2, fileCount: 2 }
      },
      { id: 'a1', role: 'assistant', preview: 'Done', attachmentSummary: null }
    ]);
  });
});

describe('provider/unhandled timeline flag', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });
  const threadId = '11111111-1111-4111-8111-111111111111';
  const unhandled = {
    id: 'evt-u',
    threadId,
    sequence: 1,
    type: 'provider/unhandled',
    payload: {
      type: 'provider/unhandled',
      threadId,
      providerThreadId: 'p1',
      providerId: 'codex',
      rawType: 'session.updated',
      rawEvent: { jsonrpc: '2.0' as const, method: 'session.updated' },
      scope: { kind: 'thread' as const }
    },
    createdAt: 1
  };

  it('drops provider/unhandled rows when the debug flag is off', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.mocked(listConversationThreadEventsWindow).mockReturnValueOnce([unhandled]);
    const timeline = conversationTimeline({
      db: {},
      dataDir: '/tmp',
      config: { getConfig: () => ({ showUnhandledProviderEvents: false }) }
    } as ProductHttpContext, threadId);
    expect(JSON.stringify(timeline.rows)).not.toMatch(/provider-unhandled/);
  });

  it('surfaces provider/unhandled rows when the debug flag is on', () => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.mocked(listConversationThreadEventsWindow).mockReturnValueOnce([unhandled]);
    const timeline = conversationTimeline({
      db: {},
      dataDir: '/tmp',
      config: { getConfig: () => ({ showUnhandledProviderEvents: true }) }
    } as ProductHttpContext, threadId);
    expect(JSON.stringify(timeline.rows)).toMatch(/provider-unhandled/);
  });
});

describe('activePromptMode plan detection', () => {
  const threadId = '11111111-1111-4111-8111-111111111111';
  const requestId = 'creq_23456789ab';
  const planEvents = [
    {
      id: 'evt-req',
      threadId,
      sequence: 1,
      type: 'client/turn/requested',
      payload: {
        type: 'client/turn/requested',
        threadId,
        scope: { kind: 'thread' as const },
        direction: 'outbound' as const,
        requestId,
        source: 'tell' as const,
        initiator: 'user' as const,
        senderThreadId: null,
        input: [{
          type: 'text' as const,
          text: '/plan inspect the failing command',
          mentions: [{
            start: 0,
            end: 5,
            resource: {
              kind: 'command' as const,
              trigger: '/',
              name: 'plan',
              source: 'command',
              origin: 'user' as const,
              label: 'plan',
              argumentHint: null
            }
          }]
        }],
        target: { kind: 'new-turn' as const },
        request: { method: 'turn/start' as const, params: {} },
        execution: {
          model: 'default',
          serviceTier: 'default' as const,
          reasoningLevel: 'medium' as const,
          permissionMode: 'accept-edits' as const,
          source: 'client/turn/requested' as const
        }
      },
      createdAt: 1
    },
    {
      id: 'evt-start',
      threadId,
      sequence: 2,
      type: 'turn/started',
      payload: {
        type: 'turn/started',
        threadId,
        providerThreadId: 'p1',
        scope: { kind: 'turn' as const, turnId: 'turn-plan-1' }
      },
      createdAt: 2
    },
    {
      id: 'evt-accepted',
      threadId,
      sequence: 3,
      type: 'turn/input/accepted',
      payload: {
        type: 'turn/input/accepted',
        threadId,
        providerThreadId: 'p1',
        clientRequestId: requestId,
        scope: { kind: 'turn' as const, turnId: 'turn-plan-1' }
      },
      createdAt: 3
    }
  ];

  it('projects activePromptMode from a live /plan turn when the provider declares plan', () => {
    const handle = registerThreadProvider('test', {
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
    });
    try {
      vi.mocked(getConversationThread).mockReturnValueOnce({
        id: threadId,
        projectId: 'proj-1',
        hostId: 'host-1',
        environmentId: null,
        providerId: 'claude-code',
        status: 'active',
        title: 'Hello'
      } as never);
      vi.mocked(listConversationThreadEventsWindow).mockReturnValueOnce(planEvents as never);
      const timeline = conversationTimeline({ db: {}, dataDir: '/tmp' } as ProductHttpContext, threadId);
      expect(timeline.activePromptMode).toEqual({
        mode: 'plan',
        providerId: 'claude-code',
        prompt: 'inspect the failing command'
      });
    } finally {
      handle.unregister();
    }
  });
});
