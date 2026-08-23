import { describe, expect, it, vi } from 'vitest';
import { storedEventsToMeta, conversationTimeline } from './conversation-timeline.js';
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
  listConversationThreadEvents: vi.fn(() => [])
}));

import { getConversationThread, listConversationThreadEvents } from '@zana-ai/zcc-db';

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
    vi.mocked(listConversationThreadEvents).mockReturnValueOnce([]);
    const timeline = conversationTimeline({ db: {} } as ProductHttpContext, '11111111-1111-4111-8111-111111111111');
    expect(timeline.rows).toEqual([]);
    expect(timeline.activeThinking).toBeNull();
    expect(timeline.activeWorkflows).toEqual([]);
  });
});
