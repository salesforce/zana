import { describe, expect, it, vi } from 'vitest';
import { storedEventsToMeta, conversationOutline, conversationTimeline } from './conversation-timeline.js';
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
