import { describe, expect, it, vi } from 'vitest';
import { searchConversationThreads } from './conversation-search.js';
import type { ProductHttpContext } from '../../http/product-context.js';

vi.mock('@zana-ai/zcc-db', () => ({
  listVisibleConversationThreads: vi.fn(() => [
    { id: 'thr-alpha', projectId: 'p1', providerId: 'claude-code', title: 'Alpha review' },
    { id: 'thr-beta', projectId: 'p2', providerId: 'cursor', title: 'Beta' }
  ])
}));

vi.mock('./conversation-create.js', () => ({
  conversationThreadViews: vi.fn((_ctx: unknown, threads: Array<{ id: string; title: string; projectId: string; providerId: string }>) => threads),
  conversationThreadView: vi.fn((_ctx: unknown, thread: unknown) => thread)
}));

describe('searchConversationThreads', () => {
  const ctx = { db: {} } as ProductHttpContext;

  it('returns an empty list for a blank query', () => {
    expect(searchConversationThreads(ctx, '   ')).toEqual({ threads: [] });
  });

  it('matches title, id, provider, and project and caps results', () => {
    expect(searchConversationThreads(ctx, 'alpha').threads.map((row) => row.id)).toEqual(['thr-alpha']);
    expect(searchConversationThreads(ctx, 'p2').threads.map((row) => row.id)).toEqual(['thr-beta']);
    expect(searchConversationThreads(ctx, 'cursor', 'p1').threads).toEqual([]);
  });
});
